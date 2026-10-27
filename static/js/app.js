(() => {
  const $ = (selector) => document.querySelector(selector);
  const jsonFields = window.WaterCareJsonFields;
  const places = window.WaterCarePlaces;
  const api = "/api";
  // Service Coordinators and Accountants (and the account-owning Administrator) can edit and approve; everyone else views.
  const EDITOR_ROLES = ["administrator", "service_coordinator", "accountant"];
  const ROLE_LABELS = { administrator: "Administrator", service_coordinator: "Service Coordinator", accountant: "Accountant", employee: "Employee", viewer: "Viewer" };
  const FREQUENCY_OPTIONS = ["Quarterly", "Alternative", "Custom"];
  const FREQUENCY_GROUPS = [
    { toggle: null, frequency: "engineer_visit", date: "engineer_visit_custom_date" },
    { toggle: "microbiology", frequency: "microbiology_frequency", date: "microbiology_custom_date" },
    { toggle: "legionella", frequency: "legionella_frequency", date: "legionella_custom_date" },
  ];
  const resources = {
    Projects: { path: "projects", fields: ["client_name", "name", "service", "so_no", "start_date", "visit_time", "end_date", "location", "location_map", "system_details", "engineer_name", "engineer_visit", "engineer_visit_custom_date", "microbiology", "microbiology_frequency", "microbiology_custom_date", "legionella", "legionella_frequency", "legionella_custom_date"], columns: ["client_name", "name", "service", "so_no", "start_date", "visit_time", "end_date", "location", "engineer_name", "engineer_visit", "approval_status"] },
    Services: { path: "services", fields: ["name", "description", "certificate_text", "validity_months", "is_active"], columns: ["name", "description", "certificate_text", "validity_months", "is_active"] },
    Clients: { path: "clients", fields: ["name", "organization_name", "contact_person", "phone", "email", "address", "category", "notes"], columns: ["name", "contact_person", "phone", "email"] },
    Engineers: { path: "engineers", fields: ["engineer_code", "full_name", "email", "phone", "specialization", "availability"], columns: ["engineer_code", "full_name", "specialization", "email", "phone"] }
  };
  const fieldLabels = { name: "Name", description: "Description", certificate_text: "Certificate wording", validity_months: "Valid for (months)", is_active: "Status", engineer_code: "Engineer ID", full_name: "Engineer name", engineer_id: "Engineer", approval_status: "approval" };
  let csrfToken = "", loginType = "admin", markerById = {}, currentUserId = "";
  // Which filter bar controls each page uses; "day" narrows the dashboard to one date, "range" is a from/to pair.
  const PAGE_FILTERS = {
    Dashboard: ["search", "client", "project", "day"],
    Projects: ["search", "client", "project", "range"],
    Services: ["search"],
    Clients: ["search"],
    Engineers: ["search"],
    Approvals: ["search", "client", "project", "range"],
    Reports: ["search", "client", "project", "range"],
  };
  const REPORT_FILTERS = { projects: PAGE_FILTERS.Projects, clients: ["search", "client"] };
  let page = "Dashboard", selectedDate = new Date(), month = new Date(), dayMode = false;
  let tasks = [], records = [], clients = [], engineers = [], locations = [], editingId = null, currentRole = "";
  let services = [], overviewProjects = [], projectOptions = [], allLocations = [], approvalItems = [], approvalHistory = [], filterTimer = null;
  let scheduleProjectId = "", scheduleMode = "single", scheduleStart = "", scheduleEnd = "", scheduleMonth = new Date(), pickingScheduleEnd = false;
  let completionScheduledDate = "";
  let projectMap = null, projectMarkers = null, pickerMap = null, approvingProjectId = null, rejectingProjectId = null, basemapStyle = null;
  const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
  const BASEMAP_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  const STATUS_LABELS = { pending: "Pending", "pending-approval": "Pending Approval", "submitted-for-approval": "Pending Approval", approved: "Approved", rejected: "Rejected", completed: "Completed" };

  const canEdit = () => EDITOR_ROLES.includes(currentRole);
  const canSubmit = () => canEdit() || currentRole === "employee";

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (csrfToken && !["GET", "HEAD", "OPTIONS"].includes((options.method || "GET").toUpperCase())) headers.set("X-CSRF-Token", csrfToken);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    const response = await fetch(`${api}${path}`, { ...options, headers, credentials: "same-origin" });
    const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
    if (!response.ok) throw new Error(body?.error?.message || `Request failed (${response.status}).`);
    return body;
  }
  function showError(message) {
    const notice = $("#notice"); notice.textContent = message; notice.classList.remove("hidden"); notice.classList.add("error");
  }
  function hideError() { $("#notice").classList.add("hidden"); $("#notice").classList.remove("error"); }
  async function signIn(email, password, loginType, accessKey) {
    const body = { email, password, login_type: loginType };
    if (loginType === "admin") body.access_key = accessKey;
    const result = await request("/auth/login", { method: "POST", body: JSON.stringify(body) });
    csrfToken = result.csrf_token;
    await initialize();
  }
  async function initialize() {
    try {
      const current = await request("/auth/me");
      csrfToken = current.csrf_token || csrfToken;
      currentUserId = current.user.id;
      $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
      currentRole = current.role;
      document.querySelectorAll("[data-action]").forEach(button => {
        button.classList.toggle("hidden", !canEdit());
      });
      // Approving is for the admin-level roles only; everyone else never sees the page.
      $('#navigation [data-page="Approvals"]').classList.toggle("hidden", !canEdit());
      $('#navigation [data-page="Certificates"]').classList.toggle("hidden", !canEdit());
      $('#navigation [data-page="Services"]').classList.toggle("hidden", currentRole !== "administrator");
      if (currentRole === "employee") {
        // Engineers get "Work assigned to you" with the same map inside it, instead of the separate map panel.
        const panel = $("#assigned-panel"), slot = $("#assigned-map-slot"), mapPanel = document.querySelector(".map-panel");
        if (panel && slot && mapPanel) {
          panel.classList.remove("hidden"); $("#dashboard").classList.add("has-assigned");
          slot.append($("#project-map"), $("#map-legend"), $("#map-message"));
          mapPanel.classList.add("hidden");
        }
      }
      $("#user-email").textContent = `${current.user.email || "Employee"} | ${ROLE_LABELS[current.role] || current.role}`;
      await Promise.all([loadClients(), loadEngineers(), loadProjectOptions(), loadServices()]); navigate("Dashboard");
    } catch (error) {
      csrfToken = "";
      $("#app").classList.add("hidden"); $("#login").classList.remove("hidden");
      $("#login-message").textContent = error.message;
    }
  }
  async function loadClients() {
    try {
      const response = await request("/clients?limit=200");
      clients = response.data || [];
      const selected = $("#client-filter").value;
      $("#client-filter").innerHTML = '<option value="">All clients</option>' + clients.map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`).join("");
      $("#client-filter").value = clients.some(client => client.id === selected) ? selected : "";
    } catch (error) { showError(error.message); }
  }
  async function loadProjectOptions() {
    try {
      projectOptions = (await request("/projects?limit=200")).data || [];
    } catch (error) { showError(error.message); }
    updateResetButtons();
  }
  async function loadEngineers() {
    try { engineers = ((await request("/engineers?limit=200")).data || []).filter(engineer => engineer.is_active !== false); }
    catch (error) { showError(error.message); }
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
  function isoDate(dateValue) { return `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, "0")}-${String(dateValue.getDate()).padStart(2, "0")}`; }
  function formatDateTime(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value || "" : parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }
  function engineerLabel(engineer) { return engineer.engineer_code ? `${engineer.full_name} (${engineer.engineer_code})` : engineer.full_name; }
  function scheduleText(project, group) {
    if (group.toggle && project[group.toggle] === "No") return "No";
    const frequency = project[group.frequency];
    if (!frequency) return "";
    return frequency === "Custom" && project[group.date] ? `Custom · ${project[group.date]}` : frequency;
  }
  function projectDay(project) { return project.start_date || project.scheduled_date || project.contract_period || ""; }
  function dayHeading(value) {
    if (!value) return "No date set";
    const [year, monthNumber, day] = value.split("-").map(Number);
    return new Date(year, monthNumber - 1, day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  // Mirrors the server's project order: manual slot date, position in that slot, then the project's own date.
  function compareProjectOrder(first, second) {
    const key = project => [project.priority_date || projectDay(project) || "9999-12-31", Number(project.priority_rank ?? 0), projectDay(project) || "9999-12-31", project.created_at || ""];
    const [a, b] = [key(first), key(second)];
    for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
    return 0;
  }
  function filterValues() {
    return { search: $("#search-filter").value.trim(), client: $("#client-filter").value, project: $("#project-filter").value, from: $("#from-filter").value, to: $("#to-filter").value };
  }
  function filterParams(kinds) {
    const values = filterValues(), params = new URLSearchParams();
    if (kinds.includes("search") && values.search) params.set("search", values.search);
    if (kinds.includes("client") && values.client) params.set("client_id", values.client);
    if (kinds.includes("project") && values.project) params.set("service", values.project);
    if (kinds.includes("range") && values.from) params.set("from", values.from);
    if (kinds.includes("range") && values.to) params.set("to", values.to);
    return params;
  }
  function textMatches(parts, search) {
    return !search || parts.filter(part => part != null).join(" ").toLowerCase().includes(search.toLowerCase());
  }
  function inDateRange(value, from, to) { return (!from || (value && value >= from)) && (!to || (value && value <= to)); }
  function cellValue(record, field) {
    if (field === "engineer_visit") return scheduleText(record, FREQUENCY_GROUPS[0]);
    if (field === "is_active") return record.is_active ? "Active" : "Inactive";
    if (field === "approval_status") return record.approval_status || (record.status === "Completed" ? "Completed" : "");
    return record[field];
  }

  async function loadTasks() {
    const first = new Date(month.getFullYear(), month.getMonth(), 1), last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const params = new URLSearchParams({ from: isoDate(first), to: isoDate(last) });
    if ($("#client-filter").value) params.set("client_id", $("#client-filter").value);
    try { tasks = (await request(`/dashboard/tasks?${params}`)).data || []; }
    catch (error) { showError(error.message); tasks = []; }
    renderCalendar(); renderOverview();
  }
  async function loadOverview() {
    try {
      const params = filterParams(["search", "client", "project"]);
      params.set("limit", "200");
      overviewProjects = (await request(`/projects?${params}`)).data || [];
    } catch (error) { showError(error.message); overviewProjects = []; }
    renderOverview(); renderCalendar();
  }
  function refreshDashboard() { loadTasks(); loadOverview(); loadLocations(); if (currentRole === "employee") loadProjectOptions().then(renderAssigned); }
  function selectDay(value) {
    const [year, monthNumber, day] = value.split("-").map(Number);
    selectedDate = new Date(year, monthNumber - 1, day); dayMode = true;
    if (year !== month.getFullYear() || monthNumber - 1 !== month.getMonth()) { month = new Date(year, monthNumber - 1, 1); loadTasks(); }
    else { renderCalendar(); renderOverview(); }
    applyMapFilters();
  }
  function showAllDates() {
    dayMode = false; $("#date-filter").value = "";
    renderCalendar(); loadOverview(); applyMapFilters();
  }
  function renderCalendar() {
    const calendar = $("#calendar"), y = month.getFullYear(), m = month.getMonth();
    $("#month-label").textContent = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    calendar.innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => `<span class="weekday">${day}</span>`).join("");
    const offset = (new Date(y, m, 1).getDay() + 6) % 7, count = new Date(y, m + 1, 0).getDate();
    for (let i = 0; i < offset; i++) calendar.insertAdjacentHTML("beforeend", '<span class="calendar-empty" aria-hidden="true"></span>');
    const withTasks = new Set(tasks.filter(task => task.record_type !== "project").map(task => task.scheduled_date));
    for (let day = 1; day <= count; day++) {
      const value = isoDate(new Date(y, m, day));
      const scheduled = overviewProjects.filter(project => {
        const start = projectDay(project), end = project.end_date || start;
        return start && end && start <= value && value <= end;
      });
      const button = document.createElement("button");
      button.className = `day${value === isoDate(new Date()) ? " today" : ""}${dayMode && value === isoDate(selectedDate) ? " selected" : ""}${withTasks.has(value) ? " has-tasks" : ""}${scheduled.length ? " has-projects" : ""}`;
      button.dataset.date = value;
      button.innerHTML = `<span class="day-number">${day}</span><span class="calendar-day-projects">${scheduled.slice(0, 3).map(project => {
        const start = projectDay(project), end = project.end_date || start;
        const segment = `${start === value ? " range-start" : ""}${end === value ? " range-end" : ""}${start < value ? " range-before" : ""}${end > value ? " range-after" : ""}`;
        return `<span class="calendar-day-project calendar-color-${calendarProjectColor(project)}${segment}" title="${escapeHtml(`${project.client_name || ""} ${project.name} · ${start}${end !== start ? ` to ${end}` : ""}`)}">${escapeHtml(project.name)}</span>`;
      }).join("")}${scheduled.length > 3 ? `<span class="calendar-more">+${scheduled.length - 3} more</span>` : ""}</span>`;
      button.setAttribute("aria-label", `${value}${scheduled.length ? `, ${scheduled.map(project => project.name).join(", ")}` : ""}${withTasks.has(value) ? ", other scheduled tasks" : ""}`);
      button.onclick = () => selectDay(value);
      calendar.append(button);
    }
  }
  function scheduleProjectName(project) { return [project.client_name, project.name].filter(Boolean).join(" · "); }
  function calendarProjectColor(project) {
    const identity = String(project.id || project.name || "");
    let hash = 0;
    for (const character of identity) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return hash % 5;
  }
  function openScheduleDialog(projectId, droppedDate) {
    if (!canEdit()) return;
    const project = [...projectOptions, ...overviewProjects].find(item => item.id === projectId);
    if (!project) { showError("This project is no longer available. Refresh the page and try again."); return; }
    scheduleProjectId = project.id;
    scheduleMode = "single";
    scheduleStart = droppedDate;
    scheduleEnd = droppedDate;
    scheduleMonth = new Date(Number(droppedDate.slice(0, 4)), Number(droppedDate.slice(5, 7)) - 1, 1);
    pickingScheduleEnd = false;
    $("#schedule-title").textContent = "Schedule project";
    $("#schedule-project-name").textContent = scheduleProjectName(project);
    $("#schedule-message").textContent = "";
    $("#schedule-form").querySelector('[name="schedule-mode"][value="single"]').checked = true;
    updateScheduleDateFields();
    renderScheduleCalendar();
    if (!$("#schedule-dialog").open) $("#schedule-dialog").showModal();
  }
  function updateScheduleDateFields() {
    $("#schedule-start").value = scheduleStart;
    $("#schedule-end").value = scheduleEnd;
    $("#schedule-end-field").classList.toggle("hidden", scheduleMode !== "range");
    $("#schedule-end").required = scheduleMode === "range";
    $("#schedule-instruction").textContent = scheduleMode === "single"
      ? "Choose the project date on the calendar."
      : scheduleEnd
        ? `Project period: ${scheduleStart} to ${scheduleEnd}. Select another date to mark a new range.`
        : "Choose the start date, then choose the end date on the calendar.";
  }
  function showScheduleMonth(value) {
    if (!value) return;
    const [year, monthNumber] = value.split("-").map(Number);
    scheduleMonth = new Date(year, monthNumber - 1, 1);
  }
  function chooseScheduleDate(value) {
    if (scheduleMode === "single") {
      scheduleStart = value; scheduleEnd = value;
    } else if (!pickingScheduleEnd || !scheduleStart) {
      scheduleStart = value; scheduleEnd = ""; pickingScheduleEnd = true;
    } else {
      const firstDate = scheduleStart;
      scheduleStart = value < firstDate ? value : firstDate;
      scheduleEnd = value < firstDate ? firstDate : value;
      pickingScheduleEnd = false;
    }
    $("#schedule-message").textContent = "";
    updateScheduleDateFields();
    renderScheduleCalendar();
  }
  function renderScheduleCalendar() {
    const calendar = $("#schedule-calendar"), year = scheduleMonth.getFullYear(), monthIndex = scheduleMonth.getMonth();
    $("#schedule-month-label").textContent = scheduleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    calendar.innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => `<span class="weekday">${day}</span>`).join("");
    const offset = (new Date(year, monthIndex, 1).getDay() + 6) % 7, count = new Date(year, monthIndex + 1, 0).getDate();
    for (let index = 0; index < offset; index++) calendar.insertAdjacentHTML("beforeend", '<span class="calendar-empty" aria-hidden="true"></span>');
    for (let day = 1; day <= count; day++) {
      const value = isoDate(new Date(year, monthIndex, day)), button = document.createElement("button");
      const inRange = scheduleMode === "range" && scheduleStart && scheduleEnd && scheduleStart <= value && value <= scheduleEnd;
      button.type = "button";
      button.dataset.date = value;
      button.className = `day schedule-day${value === isoDate(new Date()) ? " today" : ""}${value === scheduleStart ? " selected range-start" : ""}${value === scheduleEnd && scheduleMode === "range" && scheduleEnd ? " range-end" : ""}${inRange && value !== scheduleStart && value !== scheduleEnd ? " range-middle" : ""}`;
      button.innerHTML = `<span class="day-number">${day}</span>`;
      button.setAttribute("aria-label", value);
      button.setAttribute("aria-pressed", String(inRange || value === scheduleStart));
      button.onclick = () => chooseScheduleDate(value);
      calendar.append(button);
    }
  }
  async function saveSchedule(event) {
    event.preventDefault();
    if (!scheduleStart || (scheduleMode === "range" && !scheduleEnd)) {
      $("#schedule-message").textContent = "Choose both the start and end dates for this project period.";
      return;
    }
    if (scheduleEnd && scheduleEnd < scheduleStart) {
      $("#schedule-message").textContent = "The end date must be on or after the start date.";
      return;
    }
    const endDate = scheduleMode === "single" ? scheduleStart : scheduleEnd;
    try {
      await request(`/projects/${encodeURIComponent(scheduleProjectId)}`, {
        method: "PATCH", body: JSON.stringify({ start_date: scheduleStart, end_date: endDate }),
      });
      $("#schedule-dialog").close();
      await Promise.all([loadProjectOptions(), loadTasks(), loadOverview(), loadLocations()]);
      if (page === "Projects") await loadRecords();
    } catch (error) { $("#schedule-message").textContent = error.message; }
  }
  function projectAsTask(project) {
    return {
      id: project.id, title: project.name, status: project.status, scheduled_date: projectDay(project),
      scheduled_time: project.visit_time || project.scheduled_time, location: project.location,
      description: project.system_details || project.description, record_type: "project", project, engineer_name: project.engineer_name,
    };
  }
  function renderOverview() {
    const { search, project } = filterValues(), reorder = canEdit();
    let html, count;
    if (dayMode) {
      const date = isoDate(selectedDate);
      $("#date-filter").value = date;
      const matching = tasks.filter(task => task.scheduled_date === date)
        .filter(task => !project || (task.project?.service || { cleaning: "Tank cleaning", water_testing: "Water testing" }[task.record_type]) === project)
        .filter(task => textMatches([task.title, task.location, task.description, task.engineer_name, task.status, task.project?.client_name, task.project?.name, task.project?.so_no, task.project?.service, task.project?.approval_status], search));
      // Projects follow the saved priority order; cleaning and water-test visits keep their time order after them.
      const ordered = [...matching.filter(task => task.record_type === "project").sort((a, b) => compareProjectOrder(a.project, b.project)), ...matching.filter(task => task.record_type !== "project")];
      count = ordered.length;
      $("#task-count").textContent = count ? `Work for ${dayHeading(date)}. Choose "All dates" to see every project.` : `No work matches ${dayHeading(date)}.`;
      html = count ? `<h3 class="date-heading">${escapeHtml(dayHeading(date))}</h3>${ordered.map(task => taskItem(task, reorder)).join("")}` : '<p class="empty">No scheduled work for this date.</p>';
    } else {
      let previousDay = null;
      count = overviewProjects.length;
      $("#task-count").textContent = count ? `All projects in work order${reorder ? ". Drag the handle to move a project up or down" : ""}.` : "No projects match these filters.";
      html = count ? overviewProjects.map(item => {
        const day = projectDay(item), heading = day !== previousDay ? `<h3 class="date-heading">${escapeHtml(dayHeading(day))}</h3>` : "";
        previousDay = day;
        return heading + taskItem(projectAsTask(item), reorder);
      }).join("") : '<p class="empty">No projects match these filters.</p>';
    }
    $("#task-position").textContent = `${count} item${count === 1 ? "" : "s"}`;
    $("#task-list").innerHTML = html;
  }
  function dragHandle() { return '<button type="button" class="drag-handle" title="Drag to reorder or schedule on the calendar" aria-label="Drag to change the work order or drop on a calendar date. Arrow keys also move it."></button>'; }
  function taskItem(task, reorder = false) {
    const project = task.project || {}, approval = task.record_type === "project" ? project.approval_status : "";
    const service = project.service || { cleaning: "Tank cleaning", water_testing: "Water testing" }[task.record_type] || task.title;
    const details = [
      ["Service", service],
      ["Dates", project.start_date ? `${project.start_date}${project.end_date && project.end_date !== project.start_date ? ` to ${project.end_date}` : ""}` : ""],
      ["Engineer", task.engineer_name || project.engineer_name || "Engineer not assigned"],
      ["Location", task.location || project.location || "Location not set"],
      ["Time", task.scheduled_time || "Time not set"],
      ["SO No", project.so_no],
      ["Engineer visit", scheduleText(project, FREQUENCY_GROUPS[0])],
      ["Microbiology", scheduleText(project, FREQUENCY_GROUPS[1])],
      ["Legionella", scheduleText(project, FREQUENCY_GROUPS[2])],
      ["Completion", project.completion_status],
      ["Actual completion date", project.completion_date],
      ["Completion engineer", project.completion_engineer_name],
      ["Invoice No.", project.invoice_number],
      ["Rejection reason", approval === "Rejected" ? project.rejection_reason : ""],
      ["Details", task.description || task.notes || project.system_details],
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    const movable = reorder && task.record_type === "project" && project.id;
    return `<details class="task-item"${movable ? ` data-project-id="${escapeHtml(project.id)}"` : ""}><summary>${movable ? dragHandle() : ""}<span class="task-names"><strong>${escapeHtml(project.client_name || "Client not set")}</strong><strong>${escapeHtml(project.name || task.title)}</strong></span><span class="task-meta"><span class="status-badge">${escapeHtml(task.status || "Scheduled")}</span>${approval ? `<span class="status-badge approval-${slug(approval)}">${escapeHtml(approval)}</span>` : ""}${task.scheduled_time ? `<span class="task-time">${escapeHtml(task.scheduled_time)}</span>` : ""}</span></summary><dl class="task-details">${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>${projectActions(project, true)}</details>`;
  }
  function certificateButton(project, outline) {
    return project.approval_status === "Approved" ? `<button${outline ? ' class="outline"' : ""} data-project-certificate="${escapeHtml(project.id)}">Download certificate</button>` : "";
  }
  function completionButton(project, outline) {
    const id = escapeHtml(project.id), approval = project.approval_status, className = outline ? ' class="outline"' : "";
    if (canSubmit() && project.status !== "Completed" && !["Pending Approval", "Submitted for Approval", "Approved"].includes(approval)) {
      return `<button${className} data-project-complete="${id}">${approval === "Rejected" ? "Correct &amp; Resubmit" : "Mark as Completed"}</button>`;
    }
    return `<button${className} data-project-images="${id}">View Completion</button>${certificateButton(project, outline)}`;
  }
  function decisionButtons(project, outline) {
    if (!canEdit() || !["Pending Approval", "Submitted for Approval"].includes(project.approval_status)) return "";
    const id = escapeHtml(project.id), className = outline ? "outline" : "";
    return `<button class="${className} approve-button" data-approve="${id}">Approve</button><button class="${className} reject-button" data-reject="${id}">Reject</button>`;
  }
  function projectActions(project, outline) {
    if (!project.id) return "";
    const edit = canEdit() ? `<button class="outline" data-project-edit="${escapeHtml(project.id)}">Edit</button><button class="outline" data-locate="${escapeHtml(project.id)}">Tap to know the location</button>` : "";
    return `<div class="header-actions task-actions">${edit}${completionButton(project, outline)}${decisionButtons(project, outline)}</div>`;
  }

  function resetFilters() {
    ["#search-filter", "#client-filter", "#project-filter", "#from-filter", "#to-filter", "#date-filter"].forEach(id => { $(id).value = ""; });
    dayMode = false;
  }
  function navigate(nextPage) {
    if ((nextPage === "Approvals" || nextPage === "Certificates") && !canEdit()) return;
    if (nextPage === "Services" && currentRole !== "administrator") return;
    if (nextPage !== page) resetFilters();
    page = nextPage; hideError();
    $("#cert-host")?.remove(); $("#table-body").closest(".table-wrap").classList.remove("hidden");
    $("#page-title").textContent = page;
    $("#navigation").querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.page === page));
    $("#dashboard").classList.toggle("hidden", page !== "Dashboard");
    $("#approvals").classList.toggle("hidden", page !== "Approvals");
    $("#records").classList.toggle("hidden", !resources[page] && page !== "Reports" && page !== "Settings" && page !== "Certificates");
    const kinds = PAGE_FILTERS[page] || [];
    $("#filter-bar").classList.toggle("hidden", !kinds.length);
    $("#filter-bar").querySelectorAll("[data-filter]").forEach(control => control.classList.toggle("hidden", !kinds.includes(control.dataset.filter)));
    $("#add-record").classList.toggle("hidden", !resources[page] || !canEdit());
    updateResetButtons();
    if (page === "Dashboard") refreshDashboard();
    else if (resources[page]) loadRecords();
    else if (page === "Approvals") renderApprovals();
    else if (page === "Reports") renderReports();
    else if (page === "Settings") renderSettings();
    else if (page === "Certificates") renderCertificates();
  }
  function applyFilters() {
    if (page === "Dashboard") refreshDashboard();
    else if (resources[page]) loadRecords();
    else if (page === "Approvals") renderApprovalTables();
  }
  function updateResetButtons() {
    const manualOrder = canEdit() && projectOptions.some(project => project.priority_date);
    $("#reset-order").classList.toggle("hidden", !manualOrder || page !== "Projects");
    $("#reset-order-dashboard").classList.toggle("hidden", !manualOrder);
  }
  async function loadRecords() {
    const definition = resources[page], reorder = page === "Projects" && canEdit();
    const photoColumn = page === "Engineers", columnCount = definition.columns.length + 1 + (reorder ? 1 : 0) + (photoColumn ? 1 : 0);
    $("#records-title").textContent = page;
    $("#table-head").innerHTML = `<tr>${reorder ? '<th class="handle-col" aria-label="Work order"></th>' : ""}${photoColumn ? "<th>Photo</th>" : ""}${definition.columns.map(field => `<th>${escapeHtml(fieldLabels[field] || field.replaceAll("_", " "))}</th>`).join("")}<th>Actions</th></tr>`;
    try {
      const query = filterParams(PAGE_FILTERS[page]);
      query.set("limit", "200");
      const response = await request(`/${definition.path}?${query}`);
      records = response.data || [];
      $("#records-count").textContent = `${records.length}${records.length === 200 ? "+" : ""} record${records.length === 1 ? "" : "s"}`;
      let previousDay = null;
      $("#table-body").innerHTML = records.map(record => {
        if (page !== "Projects") return `<tr>${photoColumn ? `<td>${engineerAvatar(record)}</td>` : ""}${definition.columns.map(field => `<td>${escapeHtml(cellValue(record, field))}</td>`).join("")}<td>${rowActions(record)}</td></tr>`;
        record.client_name ||= clients.find(client => client.id === record.client_id)?.name || "";
        const day = projectDay(record), heading = day !== previousDay ? `<tr class="date-group"><th colspan="${columnCount}">${escapeHtml(dayHeading(day))}</th></tr>` : "";
        previousDay = day;
        return `${heading}<tr${reorder ? ` data-project-id="${escapeHtml(record.id)}"` : ""}>${reorder ? `<td class="handle-col">${dragHandle()}</td>` : ""}${definition.columns.map(field => `<td>${escapeHtml(cellValue(record, field))}</td>`).join("")}<td>${rowActions(record)}</td></tr>`;
      }).join("") || `<tr><td colspan="${columnCount}">${filterParams(PAGE_FILTERS[page]).toString() ? "No records match these filters." : "No records yet."}</td></tr>`;
    } catch (error) { showError(error.message); }
  }
  function autoScroll(scroller, y) {
    const edge = 48, step = 14;
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      if (y < box.top + edge) scroller.scrollTop -= step;
      else if (y > box.bottom - edge) scroller.scrollTop += step;
    }
    if (y < edge) window.scrollBy(0, -step);
    else if (y > innerHeight - edge) window.scrollBy(0, step);
  }
  async function refreshAfterReorder() {
    await loadProjectOptions();
    if (page === "Projects") await loadRecords();
    else await Promise.all([loadTasks(), loadOverview()]);
  }
  function enableReorder(container) {
    // Pointer events cover mouse, pen and touch; the handle owns the gesture so the page doesn't scroll instead.
    const items = () => [...container.querySelectorAll("[data-project-id]")];
    const save = async item => {
      const list = items(), index = list.indexOf(item);
      const body = { above_id: list[index - 1]?.dataset.projectId ?? null, below_id: list[index + 1]?.dataset.projectId ?? null };
      try { await request(`/projects/${encodeURIComponent(item.dataset.projectId)}/move`, { method: "POST", body: JSON.stringify(body) }); }
      catch (error) { showError(error.message); }
      await refreshAfterReorder();
    };
    container.addEventListener("click", event => { if (event.target.closest(".drag-handle")) event.preventDefault(); });
    container.addEventListener("pointerdown", event => {
      const handle = event.target.closest(".drag-handle"), item = handle?.closest("[data-project-id]");
      if (!item || event.button > 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const pointerId = event.pointerId;
      const startOrder = items().map(element => element.dataset.projectId).join();
      const scroller = container.closest(".task-list") || null;
      let lastX = event.clientX, lastY = event.clientY, finished = false, hoveredDay = null;
      const reposition = () => {
        const hit = document.elementFromPoint(lastX, lastY);
        const calendarDay = container.id === "task-list" ? hit?.closest("#calendar .day") : null;
        if (hoveredDay !== calendarDay) {
          hoveredDay?.classList.remove("drop-target");
          hoveredDay = calendarDay;
          hoveredDay?.classList.add("drop-target");
        }
        if (calendarDay) return;
        const target = hit?.closest("[data-project-id]");
        if (!target || target === item || !container.contains(target)) return;
        const box = target.getBoundingClientRect();
        target[lastY < box.top + box.height / 2 ? "before" : "after"](item);
      };
      const timer = setInterval(() => { autoScroll(scroller, lastY); reposition(); }, 30);
      const move = moveEvent => {
        if (moveEvent.pointerId !== pointerId) return;
        lastX = moveEvent.clientX; lastY = moveEvent.clientY; reposition();
      };
      const finish = finishEvent => {
        if (finishEvent.pointerId !== pointerId) return;
        if (finished) return;
        if (Number.isFinite(finishEvent.clientX) && Number.isFinite(finishEvent.clientY)) {
          lastX = finishEvent.clientX; lastY = finishEvent.clientY;
        }
        finished = true; clearInterval(timer);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        item.classList.remove("dragging");
        const droppedDay = container.id === "task-list" ? document.elementFromPoint(lastX, lastY)?.closest("#calendar .day") : null;
        hoveredDay?.classList.remove("drop-target");
        if (droppedDay) { openScheduleDialog(item.dataset.projectId, droppedDay.dataset.date); return; }
        if (items().map(element => element.dataset.projectId).join() !== startOrder) save(item);
      };
      item.classList.add("dragging");
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    });
    container.addEventListener("keydown", event => {
      const item = event.target.closest(".drag-handle")?.closest("[data-project-id]");
      if (!item || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const list = items(), target = list[list.indexOf(item) + (event.key === "ArrowUp" ? -1 : 1)];
      if (!target) return;
      target[event.key === "ArrowUp" ? "before" : "after"](item);
      const id = item.dataset.projectId;
      save(item).then(() => container.querySelector(`[data-project-id="${CSS.escape(id)}"] .drag-handle`)?.focus());
    });
  }
  function enableCalendarScheduling(container) {
    let active = null, suppressedClick = false;
    container.addEventListener("pointerdown", event => {
      const item = event.target.closest(".task-item[data-project-id]");
      if (!item || event.pointerType === "touch" || event.target.closest("button, a, input, select, textarea, .drag-handle")) return;
      active = { item, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, dragging: false, day: null };
      const updateDropTarget = () => {
        const day = active?.dragging ? document.elementFromPoint(active.x, active.y)?.closest("#calendar .day") || null : null;
        if (!active || active.day === day) return;
        active.day?.classList.remove("drop-target");
        active.day = day;
        active.day?.classList.add("drop-target");
      };
      const scrollTimer = setInterval(() => {
        if (!active?.dragging) return;
        autoScroll(null, active.y);
        updateDropTarget();
      }, 30);
      const move = moveEvent => {
        if (!active || moveEvent.pointerId !== active.pointerId) return;
        active.x = moveEvent.clientX; active.y = moveEvent.clientY;
        if (!active.dragging && Math.hypot(active.x - active.startX, active.y - active.startY) < 8) return;
        active.dragging = true;
        // Capture only once a real drag starts; capturing on press would swallow ordinary clicks on the row.
        try { item.setPointerCapture(active.pointerId); } catch { /* the pointer may already be released */ }
        moveEvent.preventDefault();
        item.classList.add("calendar-dragging");
        updateDropTarget();
        autoScroll(null, active.y);
      };
      const finish = finishEvent => {
        if (!active || finishEvent.pointerId !== active.pointerId) return;
        const current = active;
        if (Number.isFinite(finishEvent.clientX) && Number.isFinite(finishEvent.clientY)) {
          current.x = finishEvent.clientX; current.y = finishEvent.clientY;
        }
        const day = document.elementFromPoint(current.x, current.y)?.closest("#calendar .day") || current.day;
        clearInterval(scrollTimer);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        current.item.classList.remove("calendar-dragging");
        current.day?.classList.remove("drop-target");
        active = null;
        if (!current.dragging) return;
        finishEvent.preventDefault();
        suppressedClick = true;
        setTimeout(() => { suppressedClick = false; }, 0);
        if (day) openScheduleDialog(current.item.dataset.projectId, day.dataset.date);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    });
    container.addEventListener("click", event => {
      if (!suppressedClick) return;
      event.preventDefault(); event.stopPropagation();
      suppressedClick = false;
    }, true);
  }
  async function resetOrder() {
    if (!confirm("Put every project back in date order? Manual moves will be cleared.")) return;
    try { await request("/projects/order/reset", { method: "POST" }); await refreshAfterReorder(); }
    catch (error) { showError(error.message); }
  }
  function engineerAvatar(engineer) {
    const initials = escapeHtml((engineer.full_name || "?").split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase());
    return engineer.photo_id
      ? `<img class="avatar" src="${api}/uploads/${encodeURIComponent(engineer.photo_id)}?inline=1" alt="Photo of ${escapeHtml(engineer.full_name)}" loading="lazy">`
      : `<span class="avatar avatar-empty" aria-hidden="true">${initials}</span>`;
  }
  // Editors can set anyone's photo; an employee only sees their own engineer profile, so they can set only theirs.
  function photoButton(engineer) {
    if (!canEdit() && engineer.user_id !== currentUserId) return "";
    return `<label class="photo-upload">${engineer.photo_id ? "Change photo" : "Upload photo"}<input type="file" accept="image/png,image/jpeg" data-photo-for="${escapeHtml(engineer.id)}" hidden></label>`;
  }
  async function uploadEngineerPhoto(input) {
    const file = input.files[0], engineerId = input.dataset.photoFor;
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { showError("The photo must be 15 MB or smaller."); input.value = ""; return; }
    const form = new FormData();
    form.append("related_type", "engineer"); form.append("related_id", engineerId); form.append("image_type", "profile"); form.append("file", file);
    try { await request("/uploads", { method: "POST", body: form }); hideError(); await loadRecords(); }
    catch (error) { showError(error.message); input.value = ""; }
  }
  function rowActions(record) {
    const id = escapeHtml(record.id);
    if (page === "Engineers") return `${photoButton(record)}${canEdit() ? `<button data-edit="${id}">Edit</button><button data-delete="${id}">Archive</button>` : ""}`;
    if (page !== "Projects") return canEdit() ? `<button data-edit="${id}">Edit</button><button data-delete="${id}">Archive</button>` : "";
    // The Projects page is view-only for everyone who cannot edit; completions are marked from the dashboard.
    if (!canEdit()) return `<button data-project-images="${id}">View Completion</button>${certificateButton(record, false)}`;
    return `<button data-edit="${id}">Edit</button><button data-add-project="${escapeHtml(record.client_name)}">Add New</button><button data-project-delete="${id}">Delete</button>${completionButton(record, false)}${decisionButtons(record, false)}<button data-delete="${id}">Archive</button>`;
  }
  function frequencyOptions(selected, stored) {
    const options = [...FREQUENCY_OPTIONS];
    // A project saved with an earlier option (Monthly, Weekly) keeps it until someone picks a current option.
    if (stored && stored !== "No" && !options.includes(stored)) options.unshift(stored);
    return `<option value="">Choose option</option>${options.map(choice => `<option value="${escapeHtml(choice)}" ${selected === choice ? "selected" : ""}>${escapeHtml(choice)}${FREQUENCY_OPTIONS.includes(choice) ? "" : " (previous option)"}</option>`).join("")}`;
  }
  function engineerControl(existing) {
    const assigned = engineers.find(engineer => existing.assigned_engineer_ids?.includes(engineer.id))
      || engineers.filter(engineer => engineer.full_name === existing.engineer_name).at(0);
    const other = !assigned && existing.engineer_name ? existing.engineer_name : "";
    return `<select name="engineer_choice" required><option value="">Choose engineer</option>${engineers.map(engineer => `<option value="${escapeHtml(engineer.id)}" ${assigned?.id === engineer.id ? "selected" : ""}>${escapeHtml(engineerLabel(engineer))}</option>`).join("")}<option value="__other__" ${other ? "selected" : ""}>Other (type a name)</option></select><input name="engineer_other" type="text" placeholder="Engineer name" value="${escapeHtml(other)}">`;
  }
  function locationPicker() {
    return `<div class="wide location-picker"><span>Map Location</span><p class="picker-help">Search on the map and apply a suggestion, or click the map to drop a pin and drag it to the exact spot. You can also type or paste coordinates.</p><div class="picker-shell"><div id="location-picker-map" class="picker-map" role="application" aria-label="Click the map to place the project pin"></div><div class="map-search floating"><input name="location_search" type="search" placeholder="Search a place, address or coordinates" autocomplete="off" aria-label="Search map location" aria-controls="map-search-results"><button type="button" id="map-search-button" class="outline">Search</button><ul id="map-search-results" class="map-results" aria-live="polite"></ul></div></div><div class="coordinate-inputs"><label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" placeholder="e.g. 25.285400"></label><label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" placeholder="e.g. 51.531000"></label><button type="button" id="clear-location" class="text-button">Clear location</button></div><p id="picker-status" class="picker-status"></p></div>`;
  }
  async function openForm(id, defaults = {}) {
    editingId = id || null;
    const definition = resources[page], existing = { ...defaults, ...(records.find(record => record.id === id) || {}) };
    $("#form-title").textContent = `${id ? "Edit" : "Add"} ${page.toLowerCase().replace(/s$/, "")}`;
    $("#form-message").textContent = "";
    // Only administrators set an employee's sign-in password, so the field exists only for them.
    const formFields = page === "Engineers" && currentRole === "administrator" ? [...definition.fields, "login_password"] : definition.fields;
    $("#form-fields").innerHTML = formFields.map(field => {
      const labels = { client_name: "Client", name: "Project", service: "Service", so_no: "SO No", start_date: "Start Date", visit_time: "Engineer Visit Time", end_date: "End Date", location: "Location", system_details: "System Details", engineer_name: "Engineer", engineer_visit: "Engineer Visit", engineer_visit_custom_date: "Engineer Visit Date", microbiology: "Microbiology", microbiology_frequency: "Microbiology Options", microbiology_custom_date: "Microbiology Date", legionella: "Legionella", legionella_frequency: "Legionella Options", legionella_custom_date: "Legionella Date" };
      if (page === "Projects" && field === "location_map") return locationPicker();
      const engineerLabels = { email: "Email (Gmail used to sign in)", login_password: id ? "New login password (leave blank to keep)" : "Login password (12+ characters)" };
      const label = page === "Projects" ? labels[field] : (page === "Engineers" && engineerLabels[field]) || fieldLabels[field] || field.replaceAll("_", " ");
      let control, className = "";
      if (page === "Projects" && field === "service") {
        const options = services.filter(service => service.is_active || service.name === existing[field]).map(service => service.name);
        control = `<select name="${field}" required><option value="">Choose service</option>${options.map(option => `<option ${existing[field] === option ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select>`;
      }
      else if (page === "Projects" && ["microbiology", "legionella"].includes(field)) {
        const selected = existing[field] || "";
        control = `<select name="${field}" required><option value="">Choose option</option>${["Yes", "No"].map(choice => `<option ${selected === choice ? "selected" : ""}>${choice}</option>`).join("")}</select>`;
      }
      else if (page === "Projects" && ["engineer_visit", "microbiology_frequency", "legionella_frequency"].includes(field)) {
        control = `<select name="${field}" ${field === "engineer_visit" ? "required" : ""}>${frequencyOptions(existing[field] || "", existing[field])}</select>`;
      }
      else if (page === "Projects" && field.endsWith("_custom_date")) {
        className = "custom-date hidden";
        control = `<input name="${field}" type="date" value="${escapeHtml(existing[field] || "")}" disabled>`;
      }
      else if (page === "Projects" && field === "engineer_name") control = engineerControl(existing);
      else if (page === "Projects" && field === "so_no") control = `<input name="${field}" type="number" min="0" step="1" value="${escapeHtml(existing[field] ?? "")}" required>`;
      else if (page === "Projects" && ["start_date", "end_date"].includes(field)) control = `<input name="${field}" type="date" value="${escapeHtml(existing[field] || "")}" required>`;
      else if (page === "Projects" && field === "visit_time") control = `<input name="${field}" type="time" value="${escapeHtml(existing.visit_time || existing.start_time || existing.scheduled_time || "")}">`;
      else if (page === "Projects") {
        const value = field === "client_name" ? existing.client_name || clients.find(client => client.id === existing.client_id)?.name || "" : existing[field] || "";
        control = `<input name="${field}" type="text" value="${escapeHtml(value)}" required>`;
      }
      else if (page === "Services" && field === "validity_months") control = `<input name="${field}" type="number" min="1" max="120" step="1" value="${escapeHtml(existing[field] ?? 6)}" required>`;
      else if (page === "Services" && field === "is_active") control = `<select name="${field}"><option value="true">Active</option><option value="false" ${existing.is_active === false ? "selected" : ""}>Inactive</option></select>`;
      else if (page === "Services" && field === "certificate_text") control = `<input name="${field}" maxlength="300" placeholder="e.g. Domestic Water Tank and Pipeline Network." value="${escapeHtml(existing[field] || "")}">`;
      else if (field === "client_id") control = `<select name="${field}" required><option value="">Choose client</option>${clients.map(client => `<option value="${escapeHtml(client.id)}" ${existing[field] === client.id ? "selected" : ""}>${escapeHtml(client.name)}</option>`).join("")}</select>`;
      else if (field === "login_password") control = `<input name="password" type="password" autocomplete="new-password" minlength="12" maxlength="512" placeholder="Employee signs in with this">`;
      else if (field === "engineer_id") control = `<select name="${field}"><option value="">Choose engineer</option>${engineers.map(engineer => `<option value="${escapeHtml(engineer.id)}" ${existing[field] === engineer.id ? "selected" : ""}>${escapeHtml(engineerLabel(engineer))}</option>`).join("")}</select>`;
      else if (["description", "notes", "address", "observations", "procedure", "materials_used", "test_parameters", "test_results", "reference_limits", "interpretation", "laboratory_details"].includes(field)) {
        className = "wide";
        control = jsonFields.fields.includes(field)
          ? `<textarea name="${field}" placeholder='{"pH": 7.2}'>${escapeHtml(jsonFields.toText(existing[field]))}</textarea>`
          : `<textarea name="${field}">${escapeHtml(existing[field] || "")}</textarea>`;
      }
      else if (field === "status") {
        const choices = page === "Projects" ? ["Planned", "Scheduled", "In Progress", "Completed", "On Hold", "Cancelled"] : ["Scheduled", "In Progress", "Completed", "Overdue", "Cancelled"];
        control = `<select name="${field}"><option value="">Choose status</option>${choices.map(choice => `<option ${existing[field] === choice ? "selected" : ""}>${choice}</option>`).join("")}</select>`;
      } else {
        const type = field.endsWith("_date") || field === "cleaning_date" || field === "collection_date" ? "date" : field.endsWith("_time") ? "time" : "text";
        const required = ["name", "full_name", "engineer_code", "client_id"].includes(field) || field.endsWith("_date");
        control = `<input name="${field}" type="${type}" value="${escapeHtml(existing[field] || "")}" ${field === "engineer_code" ? 'maxlength="50"' : ""} ${required ? "required" : ""}>`;
      }
      return `<label class="${className}" data-field="${field}">${escapeHtml(label)}${control}</label>`;
    }).join("");
    if (page === "Projects") wireProjectForm(existing);
    $("#record-dialog").showModal();
    if (page === "Projects") initLocationPicker(existing);
  }
  function wireProjectForm(existing) {
    const field = name => $(`#form-fields [name="${name}"]`);
    FREQUENCY_GROUPS.forEach(group => {
      const frequency = field(group.frequency), dateInput = field(group.date), toggle = group.toggle && field(group.toggle);
      const syncDate = () => {
        const custom = frequency.value === "Custom";
        dateInput.closest("label").classList.toggle("hidden", !custom);
        dateInput.disabled = !custom; dateInput.required = custom;
      };
      const syncToggle = () => {
        if (!toggle) return;
        const current = frequency.value;
        frequency.innerHTML = toggle.value === "No" ? "<option>No</option>" : frequencyOptions(current !== "No" ? current : "", existing[group.frequency]);
        frequency.value = toggle.value === "No" ? "No" : current !== "No" ? current : "";
        frequency.required = toggle.value === "Yes";
        syncDate();
      };
      frequency.addEventListener("change", syncDate);
      if (toggle) toggle.addEventListener("change", syncToggle);
      syncToggle(); syncDate();
    });
    const choice = field("engineer_choice"), other = field("engineer_other");
    const syncEngineer = () => { const typed = choice.value === "__other__"; other.classList.toggle("hidden", !typed); other.required = typed; };
    choice.addEventListener("change", syncEngineer); syncEngineer();
  }
  function brandBasemapStyle(style) {
    // English names first (then Latin transliteration), and WaterCare's cream, teal and sage instead of the default greys.
    const englishName = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name:latin"], ["get", "name"]];
    style.layers.forEach(layer => {
      const id = layer.id;
      if (layer.type === "symbol" && JSON.stringify(layer.layout?.["text-field"] ?? "").includes("name")) layer.layout["text-field"] = englishName;
      if (layer.type === "background") layer.paint = { ...layer.paint, "background-color": "#f6f4ee" };
      if (layer.type === "fill" && id === "water") layer.paint = { ...layer.paint, "fill-color": "#d3e6e8" };
      if (layer.type === "fill" && /^(park|landcover_wood|landcover_grass)/.test(id)) layer.paint = { ...layer.paint, "fill-color": "#e4eedc" };
      // The stock style paints roads white and buildings pale grey on near-white land, so they disappear; give them clear colours.
      if (id === "building") { layer.minzoom = 13; layer.paint = { ...layer.paint, "fill-color": "#d8cdb8", "fill-outline-color": "#b9ab90" }; }
      if (layer.type === "line" && /^(highway_minor|highway_path)$/.test(id)) layer.paint = { ...layer.paint, "line-color": id === "highway_path" ? "#cbbfa6" : "#ffffff", "line-opacity": 1 };
      if (layer.type === "line" && /_casing$/.test(id) && /(highway|tunnel|bridge)/.test(id)) layer.paint = { ...layer.paint, "line-color": "#b3a78f" };
      if (layer.type === "line" && /^highway_major_inner$/.test(id)) layer.paint = { ...layer.paint, "line-color": "#ffffff" };
      if (layer.type === "line" && /(motorway_inner|motorway_bridge_inner|tunnel_motorway_inner)$/.test(id)) layer.paint = { ...layer.paint, "line-color": "#f4c77a" };
    });
    return style;
  }
  function loadBasemapStyle() {
    basemapStyle ||= fetch(BASEMAP_STYLE_URL).then(response => {
      if (!response.ok) throw new Error("Basemap style unavailable.");
      return response.json();
    }).then(brandBasemapStyle);
    return basemapStyle;
  }
  function addFallbackTiles(map) {
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, className: "muted-tiles",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  }
  async function addBasemap(map) {
    try {
      if (!window.maplibregl || !L.maplibreGL) throw new Error("Vector maps are unavailable.");
      const style = structuredClone(await loadBasemapStyle());
      if (!document.body.contains(map.getContainer())) return;
      L.maplibreGL({ style, attributionControl: { customAttribution: BASEMAP_ATTRIBUTION } }).addTo(map);
    } catch {
      // No WebGL, a blocked CDN or an OpenFreeMap outage: keep the map usable with toned-down OpenStreetMap tiles.
      if (document.body.contains(map.getContainer())) addFallbackTiles(map);
    }
  }
  function watchSize(map) {
    // Leaflet only measures its box on window resizes; dialogs, wrapping text and phone layouts change it without one.
    if (!window.ResizeObserver) return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    map.on("unload", () => observer.disconnect());
  }
  function statusKey(item) { return slug(item.approval_status || (item.status === "Completed" ? "Completed" : "Pending")); }
  function pinIcon(status = "project") {
    return L.divIcon({ className: "map-pin-icon", html: `<span class="map-pin status-${status}"></span>`, iconSize: [24, 24], iconAnchor: [12, 29], popupAnchor: [0, -28] });
  }
  function clusterIcon(cluster) {
    return L.divIcon({ className: "map-cluster", html: `<span>${cluster.getChildCount()}</span>`, iconSize: [42, 42] });
  }
  function fitButton(onFit) {
    const Fit = L.Control.extend({
      onAdd() {
        const button = L.DomUtil.create("button", "map-fit-button leaflet-bar");
        button.type = "button"; button.title = "Show all projects"; button.setAttribute("aria-label", "Show all projects");
        button.innerHTML = '<span aria-hidden="true">⤢</span>';
        L.DomEvent.disableClickPropagation(button);
        L.DomEvent.on(button, "click", onFit);
        return button;
      },
    });
    return new Fit({ position: "topleft" });
  }
  async function findPlaces(query, signal, explicit) {
    const center = pickerMap && pickerMap.getZoom() >= 5 ? pickerMap.getCenter() : null;
    const params = new URLSearchParams({ q: query, limit: "6", lang: "en" });
    if (center) { params.set("lat", center.lat.toFixed(4)); params.set("lon", center.lng.toFixed(4)); }
    let found = [];
    try {
      const response = await fetch(`https://photon.komoot.io/api/?${params}`, { signal });
      if (!response.ok) throw new Error("Place suggestions are unavailable.");
      found = places.fromPhoton(await response.json());
    } catch (error) {
      if (error.name === "AbortError" || !explicit) throw error;
    }
    if (found.length || !explicit) return found;
    // Nominatim allows a search per button press but not search-as-you-type, so it only backs up the Search button.
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: "jsonv2", limit: "6", q: query, "accept-language": "en" })}`, { signal });
    if (!response.ok) throw new Error("Location search is unavailable.");
    return places.fromNominatim(await response.json());
  }
  async function addressAt(lat, lng, signal) {
    const point = { lat: lat.toFixed(6), lon: lng.toFixed(6) };
    try {
      const response = await fetch(`https://photon.komoot.io/reverse?${new URLSearchParams({ ...point, lang: "en" })}`, { signal });
      if (response.ok) { const [found] = places.fromPhoton(await response.json()); if (found) return places.fullName(found); }
    } catch (error) { if (error.name === "AbortError") throw error; }
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${new URLSearchParams({ ...point, format: "jsonv2", "accept-language": "en", zoom: "18" })}`, { signal });
    if (!response.ok) return "";
    const [found] = places.fromNominatimReverse(await response.json());
    return found ? places.fullName(found) : "";
  }
  function initLocationPicker(existing) {
    const field = name => $(`#form-fields [name="${name}"]`);
    const status = $("#picker-status"), latitude = field("latitude"), longitude = field("longitude"), search = field("location_search");
    const results = $("#map-search-results"), locationInput = field("location");
    if (pickerMap) { pickerMap.remove(); pickerMap = null; }
    if (existing.latitude != null && existing.longitude != null) { latitude.value = Number(existing.latitude).toFixed(6); longitude.value = Number(existing.longitude).toFixed(6); }
    if (!window.L) { status.textContent = "The map could not load. You can still type the coordinates, and the rest of the project saves."; return; }
    pickerMap = L.map("location-picker-map", { scrollWheelZoom: true, zoomControl: false, minZoom: 2, maxZoom: 19 });
    L.control.zoom({ position: "bottomright" }).addTo(pickerMap);
    watchSize(pickerMap);
    const candidates = L.layerGroup().addTo(pickerMap);
    let marker = null, suggestions = [], autoFilled = "", typingTimer = null, pending = null;
    const describe = () => {
      status.textContent = marker ? `Pin set at ${latitude.value}, ${longitude.value}. Drag the pin to fine-tune it.` : "No location saved yet. Search, click the map, or type the coordinates.";
    };
    let addressRequest = null, addressEdited = false;
    locationInput.addEventListener("input", () => { addressEdited = locationInput.value !== autoFilled; });
    // Looks up the street address of the pin; skipped for saved pins and search results, which already have an address.
    const fillAddress = async (lat, lng) => {
      addressRequest?.abort();
      if (addressEdited && locationInput.value.trim()) return;
      const request = addressRequest = new AbortController();
      status.textContent = `Pin set at ${latitude.value}, ${longitude.value}. Finding the address…`;
      try {
        const address = (await addressAt(lat, lng, request.signal)).slice(0, 500);
        if (request.signal.aborted) return;
        if (address && !(addressEdited && locationInput.value.trim())) { locationInput.value = address; autoFilled = address; addressEdited = false; }
        status.textContent = address ? `Pin set at ${latitude.value}, ${longitude.value}. Address filled from the map; you can edit it.` : `Pin set at ${latitude.value}, ${longitude.value}. No address was found here, so type one in Location.`;
      } catch (error) {
        if (error.name !== "AbortError") status.textContent = `Pin set at ${latitude.value}, ${longitude.value}. The address could not be looked up; type it in Location.`;
      }
    };
    const place = (lat, lng, zoom, lookup = false) => {
      latitude.value = lat.toFixed(6); longitude.value = lng.toFixed(6);
      if (marker) marker.setLatLng([lat, lng]);
      else {
        marker = L.marker([lat, lng], { icon: pinIcon(), draggable: true, autoPan: true, title: "Project location (drag to adjust)" }).addTo(pickerMap);
        marker.on("dragend", () => { const point = marker.getLatLng(); place(point.lat, point.lng, 0, true); });
      }
      if (zoom) pickerMap.setView([lat, lng], zoom);
      describe();
      if (lookup) fillAddress(lat, lng);
    };
    const clearSuggestions = () => { suggestions = []; candidates.clearLayers(); results.innerHTML = ""; };
    const clear = () => {
      latitude.value = ""; longitude.value = "";
      if (marker) { marker.remove(); marker = null; }
      describe();
    };
    const apply = index => {
      const chosen = suggestions[index];
      if (!chosen) return;
      place(chosen.lat, chosen.lng, 16);
      const name = places.fullName(chosen).slice(0, 500);
      if (chosen.type !== "coordinates" && (!locationInput.value.trim() || locationInput.value === autoFilled)) { locationInput.value = name; autoFilled = name; }
      search.value = chosen.label;
      clearSuggestions();
    };
    const show = (found, query) => {
      suggestions = found; candidates.clearLayers();
      if (!found.length) { results.innerHTML = `<li class="muted">No places match “${escapeHtml(query)}”. Click the map to drop a pin instead.</li>`; return; }
      results.innerHTML = found.map((item, index) => `<li><button type="button" data-place="${index}"><span class="place-name">${escapeHtml(item.label)}</span><span class="place-detail">${escapeHtml([item.type, item.detail].filter(Boolean).join(" · "))}</span><span class="place-apply">Apply</span></button></li>`).join("");
      found.forEach((item, index) => {
        L.circleMarker([item.lat, item.lng], { radius: 8, color: "#fff", weight: 2, fillColor: "#C7A567", fillOpacity: 0.95, bubblingMouseEvents: false })
          .bindTooltip(`${escapeHtml(item.label)} · click to apply`).on("click", () => apply(index)).addTo(candidates);
      });
      pickerMap.fitBounds(L.latLngBounds(found.map(item => [item.lat, item.lng])), { padding: [30, 30], maxZoom: 15 });
    };
    const runSearch = async explicit => {
      const query = search.value.trim();
      clearTimeout(typingTimer); pending?.abort();
      const typed = places.coordinatePair(query);
      if (typed) { show([{ label: `${typed[0]}, ${typed[1]}`, detail: "Typed coordinates", type: "coordinates", lat: typed[0], lng: typed[1] }], query); return; }
      if (query.length < 3) { clearSuggestions(); if (explicit && query) results.innerHTML = '<li class="muted">Type at least 3 characters to search.</li>'; return; }
      pending = new AbortController();
      results.innerHTML = '<li class="muted">Searching…</li>';
      try { show(await findPlaces(query, pending.signal, explicit), query); }
      catch (error) { if (error.name !== "AbortError") results.innerHTML = '<li class="muted">Location search is unavailable right now. Click the map or type the coordinates instead.</li>'; }
    };
    const typedCoordinates = () => {
      const point = places.coordinates(latitude.value, longitude.value);
      if (point) place(point[0], point[1], Math.max(pickerMap.getZoom(), 15), true);
      else if (!latitude.value && !longitude.value) clear();
      else status.textContent = "Enter both latitude (-90 to 90) and longitude (-180 to 180).";
    };
    const saved = places.coordinates(latitude.value, longitude.value);
    if (saved) place(saved[0], saved[1], 15);
    else {
      describe();
      if (locations.length) pickerMap.fitBounds(L.latLngBounds(locations.map(item => [item.latitude, item.longitude])), { padding: [30, 30], maxZoom: 12 });
      else pickerMap.setView([20, 0], 2);
    }
    addBasemap(pickerMap);
    pickerMap.on("click", event => { clearSuggestions(); place(event.latlng.lat, event.latlng.lng, 0, true); });
    $("#clear-location").onclick = clear;
    $("#map-search-button").onclick = () => runSearch(true);
    search.oninput = () => { clearTimeout(typingTimer); typingTimer = setTimeout(() => runSearch(false), 450); };
    search.onkeydown = event => {
      if (event.key === "Enter") { event.preventDefault(); runSearch(true); }
      if (event.key === "Escape" && suggestions.length) { event.preventDefault(); clearSuggestions(); }
    };
    results.onclick = event => { const choice = event.target.closest("[data-place]"); if (choice) apply(Number(choice.dataset.place)); };
    latitude.onchange = typedCoordinates; longitude.onchange = typedCoordinates;
    setTimeout(() => pickerMap?.invalidateSize(), 60);
  }
  async function saveRecord(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    if (page === "Projects") {
      values.so_no = Number(values.so_no);
      ["microbiology", "legionella"].forEach(key => {
        if (values[key] === "No") values[`${key}_frequency`] = "No";
      });
      const engineer = engineers.find(item => item.id === values.engineer_choice);
      values.engineer_name = engineer ? engineer.full_name : (values.engineer_other || "").trim();
      values.assigned_engineer_ids = engineer ? [engineer.id] : [];
      const point = places.coordinates(values.latitude, values.longitude);
      if (!point && (values.latitude || values.longitude)) { $("#form-message").textContent = "Enter both latitude and longitude, or clear the location."; return; }
      [values.latitude, values.longitude] = point || [null, null];
      ["engineer_choice", "engineer_other", "location_search"].forEach(key => delete values[key]);
    }
    if (page === "Services") { values.validity_months = Number(values.validity_months); values.is_active = values.is_active !== "false"; }
    Object.keys(values).forEach(key => { if (values[key] === "") delete values[key]; });
    const jsonError = jsonFields.parseInto(values);
    if (jsonError) { $("#form-message").textContent = jsonError; return; }
    try {
      await request(`/${resources[page].path}${editingId ? `/${editingId}` : ""}`, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(values) });
      $("#record-dialog").close(); await loadRecords(); await loadClients();
      if (page === "Engineers") await loadEngineers();
      if (page === "Projects") await loadProjectOptions();
      if (page === "Services") await loadServices();
    } catch (error) { $("#form-message").textContent = error.message; }
  }
  async function openCompletionForm(projectId, readOnly = false) {
    $("#completion-message").textContent = "";
    let project = {}, files = [], history = [];
    try {
      [project, files, history] = await Promise.all([
        request(`/projects/${encodeURIComponent(projectId)}`).then(body => body.data),
        request(`/uploads?related_type=project&related_id=${encodeURIComponent(projectId)}`).then(body => body.data || []),
        request(`/approval-history?project_id=${encodeURIComponent(projectId)}`).then(body => body.data || []),
      ]);
    } catch (error) { showError(error.message); return; }
    const approval = project.approval_status;
    $("#completion-project-id").value = projectId;
    $("#completion-client-name").textContent = project.client_name || "";
    $("#completion-project-name").textContent = project.name || "";
    completionScheduledDate = project.start_date || project.scheduled_date || project.contract_period || "";
    $("#completion-scheduled-date").textContent = completionScheduledDate || "No scheduled date";
    $("#completion-date").value = project.completion_date || completionScheduledDate;
    $("#completion-engineer-name").value = project.completion_engineer_name
      || (project.engineer_name === "Unassigned" ? "" : project.engineer_name || "");
    $("#invoice-number").value = project.invoice_number || "";
    $("#before-images").value = "";
    $("#after-images").value = "";
    $("#completion-submit").classList.toggle("hidden", readOnly);
    $("#completion-form").querySelectorAll("input,select").forEach(control => { control.disabled = readOnly; });
    $("#completion-image-inputs").classList.toggle("hidden", readOnly);
    $("#completion-title").textContent = readOnly ? "Work Completion Record" : approval === "Rejected" ? "Correct & Resubmit Completion" : "Work Completion & Approval Form";
    const saved = files.filter(file => file.image_type);
    $("#before-images").required = !readOnly && !saved.some(file => file.image_type === "before");
    $("#after-images").required = !readOnly && !saved.some(file => file.image_type === "after");
    $("#saved-project-images").innerHTML = saved.map(file => `<figure><img src="${api}/uploads/${encodeURIComponent(file.id)}?inline=1" alt="${escapeHtml(file.image_type)} image: ${escapeHtml(file.original_filename)}"><figcaption>${escapeHtml(file.image_type === "before" ? "Before" : "After")} · ${escapeHtml(file.original_filename)}</figcaption></figure>`).join("") || '<p class="muted">No project images saved.</p>';
    $("#completion-approval").classList.toggle("hidden", !approval && project.status !== "Completed");
    $("#completion-approval").innerHTML = `<p><b>${escapeHtml(project.client_name || "")}</b> · <b>${escapeHtml(project.name || "")}</b></p><p>Approval status: <span class="status-badge approval-${slug(approval)}">${escapeHtml(approval || "Completed before approvals")}</span></p>${project.completion_engineer_name ? `<p>Engineer: ${escapeHtml(project.completion_engineer_name)}</p>` : ""}${project.completion_date ? `<p>Actual completion date: ${escapeHtml(project.completion_date)}</p>` : ""}${approval === "Rejected" && project.rejection_reason ? `<p class="rejection">Rejection reason: ${escapeHtml(project.rejection_reason)}</p>` : ""}`;
    $("#completion-history").innerHTML = history.length ? `<h3>Approval history</h3><ol>${history.map(entry => `<li><b>${escapeHtml(entry.action)}</b> · ${escapeHtml(entry.previous_status)} → ${escapeHtml(entry.new_status)} · ${escapeHtml(entry.actor_name)} · ${escapeHtml(formatDateTime(entry.created_at))}${entry.reason ? `<br><span class="rejection">Reason: ${escapeHtml(entry.reason)}</span>` : ""}</li>`).join("")}</ol>` : "";
    updateCompletionDateFields();
    $("#completion-dialog").showModal();
  }
  async function editProject(projectId) {
    navigate("Projects");
    await loadRecords();
    openForm(projectId);
  }
  function updateCompletionDateFields() {
    const input = $("#completion-date");
    const actualDate = input.value;
    const submit = $("#completion-submit");
    let category = "Choose an actual completion date";
    if (completionScheduledDate && actualDate) {
      category = actualDate < completionScheduledDate
        ? "Completed Before the Scheduled Date"
        : actualDate > completionScheduledDate
          ? "Completed After the Scheduled Date"
          : "Completed on the Scheduled Date";
    }
    $("#completion-category").textContent = category;
    $("#completion-date-help").textContent = completionScheduledDate
      ? `The completion category is determined from the scheduled date (${completionScheduledDate}).`
      : "This project has no scheduled date. Add one before submitting completion.";
    submit.disabled = !completionScheduledDate || !actualDate
      || $("#completion-title").textContent === "Work Completion Record";
  }
  async function refreshAfterApprovalChange() {
    if (resources[page]) await loadRecords();
    if (page === "Approvals") await renderApprovals();
    if (page === "Dashboard") refreshDashboard();
  }
  async function submitCompletion(event) {
    event.preventDefault();
    const submit = $("#completion-submit");
    if (submit.disabled) return;
    submit.disabled = true;
    const projectId = $("#completion-project-id").value;
    const files = [
      ...Array.from($("#before-images").files, file => ({ file, imageType: "before" })),
      ...Array.from($("#after-images").files, file => ({ file, imageType: "after" })),
    ];
    try {
      const savedImages = Array.from($("#saved-project-images").querySelectorAll("img"));
      const hasBefore = files.some(item => item.imageType === "before") || savedImages.some(image => image.alt.startsWith("before image:"));
      const hasAfter = files.some(item => item.imageType === "after") || savedImages.some(image => image.alt.startsWith("after image:"));
      if (!hasBefore || !hasAfter) throw new Error("Upload both before-work and after-work photos before submitting.");
      const completionDate = $("#completion-date").value;
      if (!completionDate || !completionScheduledDate) throw new Error("A scheduled date and actual completion date are required.");
      for (const item of files) {
        const form = new FormData();
        form.append("related_type", "project");
        form.append("related_id", projectId);
        form.append("image_type", item.imageType);
        form.append("file", item.file);
        await request("/uploads", { method: "POST", body: form });
      }
      const payload = {
        completion_date: completionDate,
        completion_engineer_name: $("#completion-engineer-name").value.trim(),
        invoice_number: $("#invoice-number").value.trim(),
      };
      await request(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(payload) });
      $("#completion-dialog").close();
      await refreshAfterApprovalChange();
    } catch (error) {
      $("#completion-message").textContent = error.message;
      submit.disabled = false;
    }
  }
  function openApproveDialog(projectId) {
    const project = approvalItems.find(item => item.id === projectId)
      || records.find(item => item.id === projectId)
      || tasks.map(task => task.project).find(item => item?.id === projectId)
      || {};
    approvingProjectId = projectId;
    $("#approve-reference").textContent = [project.client_name, project.name].filter(Boolean).join(" · ");
    $("#approve-message").textContent = "";
    $("#confirm-approve").disabled = false;
    $("#approve-dialog").showModal();
  }
  async function submitApproval(event) {
    event.preventDefault();
    if (!approvingProjectId) return;
    const button = $("#confirm-approve");
    button.disabled = true;
    $("#approve-message").textContent = "";
    try {
      await request(`/projects/${encodeURIComponent(approvingProjectId)}/approve`, { method: "POST" });
      $("#approve-dialog").close();
      approvingProjectId = null;
      await refreshAfterApprovalChange();
    } catch (error) {
      $("#approve-message").textContent = error.message;
      button.disabled = false;
    }
  }
  function openRejectDialog(projectId) {
    const project = records.find(record => record.id === projectId) || tasks.map(task => task.project).find(item => item?.id === projectId) || {};
    rejectingProjectId = projectId;
    $("#reject-reference").textContent = [project.client_name, project.name].filter(Boolean).join(" · ");
    $("#reject-reason").value = ""; $("#reject-message").textContent = "";
    $("#reject-dialog").showModal();
  }
  async function submitRejection(event) {
    event.preventDefault();
    try {
      await request(`/projects/${encodeURIComponent(rejectingProjectId)}/reject`, { method: "POST", body: JSON.stringify({ reason: $("#reject-reason").value }) });
      $("#reject-dialog").close();
      await refreshAfterApprovalChange();
    } catch (error) { $("#reject-message").textContent = error.message; }
  }
  async function renderApprovals() {
    try {
      const [pending, history] = await Promise.all([request("/approvals"), request("/approval-history")]);
      approvalItems = pending.data || [];
      approvalItems.forEach(record => { record.client_name ||= clients.find(client => client.id === record.client_id)?.name || ""; });
      approvalHistory = history.data || [];
      records = approvalItems;
      renderApprovalTables();
    } catch (error) { showError(error.message); }
  }
  function renderApprovalTables() {
    const { search, client, project, from, to } = filterValues();
    const clientOf = projectId => projectOptions.find(item => item.id === projectId)?.client_id;
    const shown = approvalItems.filter(record => (!client || record.client_id === client) && (!project || record.service === project)
      && inDateRange((record.completion_date || record.updated_at || "").slice(0, 10), from, to)
      && textMatches([record.client_name, record.name, record.engineer_name, record.completion_engineer_name, record.completion_date, record.completion_status, record.invoice_number, record.so_no], search));
    const history = approvalHistory.filter(entry => (!client || clientOf(entry.project_id) === client) && (!project || projectOptions.find(item => item.id === entry.project_id)?.service === project)
      && inDateRange((entry.created_at || "").slice(0, 10), from, to)
      && textMatches([entry.reference, entry.action, entry.actor_name, entry.reason, entry.previous_status, entry.new_status], search));
    const filtered = Boolean(search || client || project || from || to);
    $("#approval-count").textContent = `${shown.length} awaiting`;
    $("#approval-body").innerHTML = shown.map(record => `<tr><td><strong>${escapeHtml(record.client_name)}</strong></td><td><strong>${escapeHtml(record.name)}</strong></td><td>${escapeHtml(record.completion_engineer_name || record.engineer_name)}</td><td>${escapeHtml(record.completion_date || "—")}</td><td>${escapeHtml(record.completion_status)}</td><td>${escapeHtml(record.invoice_number || "—")}</td><td><button data-project-images="${escapeHtml(record.id)}">View Completion</button>${decisionButtons(record, false)}</td></tr>`).join("") || `<tr><td colspan="7">${filtered ? "No completions awaiting approval match these filters." : "No completions are awaiting approval."}</td></tr>`;
    $("#history-body").innerHTML = history.map(entry => `<tr><td>${escapeHtml(formatDateTime(entry.created_at))}</td><td>${escapeHtml(entry.reference)}</td><td>${escapeHtml(entry.previous_status)} → ${escapeHtml(entry.new_status)}</td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.actor_name)}</td><td>${escapeHtml(entry.reason || "")}</td></tr>`).join("") || `<tr><td colspan="6">${filtered ? "No approval activity matches these filters." : "No approval activity yet."}</td></tr>`;
  }
  // "Work assigned to you": the signed-in engineer's own jobs, with a button that goes to the job's place on the map.
  function renderAssigned() {
    const panel = $("#assigned-panel");
    if (!panel) return;
    if (currentRole !== "employee") { panel.classList.add("hidden"); return; }
    const open = projectOptions.filter(project => project.status !== "Completed").sort(compareProjectOrder);
    $("#assigned-count").textContent = `${open.length} open job${open.length === 1 ? "" : "s"}`;
    $("#assigned-list").innerHTML = open.map(project => {
      const located = project.latitude != null && project.longitude != null, key = statusKey(project);
      const when = [projectDay(project), project.visit_time].filter(Boolean).join(" · ");
      return `<div class="assigned-job" data-job="${escapeHtml(project.id)}"><div class="assigned-main"><strong>${escapeHtml(project.client_name || "Client not set")}</strong><strong>${escapeHtml(project.name)}</strong><span>${escapeHtml([when, project.service, project.location].filter(Boolean).join(" · "))}</span></div><span class="status-badge approval-${key}">${escapeHtml(STATUS_LABELS[key] || project.approval_status || "Pending")}</span><div class="assigned-actions">${located ? `<button class="outline" data-locate="${escapeHtml(project.id)}">Go to location</button>` : '<span class="no-location">No map location yet</span>'}${completionButton(project, true)}</div></div>`;
    }).join("") || '<p class="muted">No work is assigned to you right now.</p>';
  }
  function locateProject(projectId) {
    const marker = markerById[projectId];
    if (!marker || !projectMap) { showError("This project has no map location yet. Edit the project to add one."); return; }
    hideError();
    document.querySelectorAll(".assigned-job").forEach(job => job.classList.toggle("active", job.dataset.job === projectId));
    $("#project-map").scrollIntoView({ behavior: "smooth", block: "center" });
    const open = () => { projectMap.setView(marker.getLatLng(), Math.max(projectMap.getZoom(), 16)); marker.openPopup(); };
    if (projectMarkers.zoomToShowLayer) projectMarkers.zoomToShowLayer(marker, open); else open();
  }
  function fitProjects() {
    projectMap.invalidateSize();
    if (locations.length) projectMap.fitBounds(L.latLngBounds(locations.map(item => [item.latitude, item.longitude])), { padding: [40, 40], maxZoom: 16 });
    else projectMap.setView([20, 0], 2);
  }
  function ensureProjectMap() {
    if (!window.L) { $("#map-message").textContent = "The map could not load. Check the internet connection and reload the page."; return null; }
    if (!projectMap) {
      projectMap = L.map("project-map", { scrollWheelZoom: true, zoomControl: false, minZoom: 2, maxZoom: 19 }).setView([20, 0], 2);
      L.control.zoom({ position: "topleft" }).addTo(projectMap);
      fitButton(fitProjects).addTo(projectMap);
      watchSize(projectMap);
      addBasemap(projectMap);
      projectMarkers = (L.markerClusterGroup
        ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 45, spiderfyOnMaxZoom: true, iconCreateFunction: clusterIcon })
        : L.layerGroup()).addTo(projectMap);
    }
    setTimeout(() => projectMap.invalidateSize(), 0);
    return projectMap;
  }
  function popupHtml(item) {
    const key = statusKey(item), id = escapeHtml(item.id);
    const rows = [
      ["Engineer", item.engineer_name || "Engineer not assigned"],
      ["Task", [item.service, item.so_no != null ? `SO ${item.so_no}` : "", item.start_date ? `${item.start_date} to ${item.end_date || item.start_date}` : "", item.visit_time ? `visit ${item.visit_time}` : ""].filter(Boolean).join(" · ")],
      ["Engineer visit", scheduleText(item, FREQUENCY_GROUPS[0])],
      ["Details", item.system_details || item.description],
      ["Location", item.location || `${Number(item.latitude).toFixed(5)}, ${Number(item.longitude).toFixed(5)}`],
    ].filter(([, value]) => value);
    const action = canEdit()
      ? `<button type="button" class="primary map-card-action" data-project-edit="${id}">Open project</button>`
      : `<button type="button" class="outline map-card-action" data-project-images="${id}">View completion</button>`;
    return `<div class="map-card"><strong class="map-card-client">${escapeHtml(item.client_name || "Client not set")}</strong><strong class="map-card-project">${escapeHtml(item.name)}</strong><div class="map-card-badges"><span class="status-badge approval-${key}">${escapeHtml(STATUS_LABELS[key] || item.approval_status)}</span>${item.status ? `<span class="status-badge project-status">${escapeHtml(item.status)}</span>` : ""}</div><dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>${action}</div>`;
  }
  function renderLegend() {
    const counts = locations.reduce((totals, item) => ({ ...totals, [statusKey(item)]: (totals[statusKey(item)] || 0) + 1 }), {});
    const shown = ["pending", "submitted-for-approval", "approved", "rejected", "completed"].filter(key => key !== "completed" || counts.completed);
    $("#map-legend").innerHTML = locations.length ? shown.map(key => `<span class="legend-item"><span class="legend-dot status-${key}"></span>${escapeHtml(STATUS_LABELS[key])}<b>${counts[key] || 0}</b></span>`).join("") : "";
  }
  async function loadLocations() {
    const params = new URLSearchParams();
    if ($("#client-filter").value) params.set("client_id", $("#client-filter").value);
    try { allLocations = (await request(`/dashboard/locations?${params}`)).data || []; }
    catch (error) { $("#map-message").textContent = error.message; return; }
    applyMapFilters();
  }
  function applyMapFilters() {
    const map = ensureProjectMap(), { search, project } = filterValues(), day = dayMode ? isoDate(selectedDate) : "";
    locations = allLocations.filter(item => (!project || item.service === project)
      && textMatches([item.client_name, item.name, item.engineer_name, item.location, item.service, item.so_no, item.system_details, item.status, item.approval_status], search)
      && (!day || (item.start_date && item.start_date <= day && (item.end_date || item.start_date) >= day)));
    $("#map-count").textContent = `${locations.length} located project${locations.length === 1 ? "" : "s"}`;
    renderLegend();
    if (!map) return;
    projectMarkers.clearLayers();
    projectMap.invalidateSize();
    // A card bigger than the map makes Leaflet pan the pin out of view, which closes the card on phones.
    const size = projectMap.getSize(), cardWidth = Math.max(170, Math.min(260, size.x - 50)), cardHeight = Math.max(160, size.y - 90);
    const markers = locations.map(item => {
      const key = statusKey(item), label = `${item.client_name || ""} · ${item.name} (${STATUS_LABELS[key]})`;
      return L.marker([item.latitude, item.longitude], { icon: pinIcon(key), title: label, alt: label })
        .bindPopup(popupHtml(item), { className: `wc-popup popup-${key}`, maxWidth: cardWidth, minWidth: cardWidth, maxHeight: cardHeight, autoPanPadding: [16, 16] });
    });
    markerById = Object.fromEntries(locations.map((item, index) => [item.id, markers[index]]));
    if (projectMarkers.addLayers) projectMarkers.addLayers(markers);
    else markers.forEach(marker => marker.addTo(projectMarkers));
    $("#map-message").textContent = locations.length ? ""
      : allLocations.length ? "No located projects match these filters." : "No project has a saved map location yet. Edit a project to add one.";
    fitProjects();
  }
  function renderReports() {
    $("#records-title").textContent = "Reports & exports";
    $("#records-count").textContent = "Downloads use the filters above";
    $("#table-head").innerHTML = "<tr><th>Report</th><th>File format</th><th>Action</th></tr>";
    const choices = [["Projects","projects"],["Clients","clients"]];
    $("#table-body").innerHTML = choices.map(([label, value]) => `<tr><td>${label}</td><td>CSV · Excel · PDF</td><td>${["csv","xlsx","pdf"].map(format => `<a href="${api}/reports/export?resource=${value}&format=${format}" data-report="${value}" data-format="${format}">${format.toUpperCase()}</a>`).join(" · ")}</td></tr>`).join("");
  }
  async function renderSettings() {
    $("#records-title").textContent = "Settings";
    $("#records-count").textContent = "";
    $("#table-head").innerHTML = "<tr><th>Preference</th><th>Value</th></tr>";
    try {
      const settings = await request("/settings");
      const org = settings.organization || {}, user = settings.user || {};
      $("#table-body").innerHTML = `<tr><td colspan="2"><form id="settings-form">
        <label>Organization name<input name="org_name" value="${escapeHtml(org.name || "")}" ${currentRole === "administrator" ? "" : "disabled"}></label>
        <label>Support contact<input name="support_contact" value="${escapeHtml(org.support_contact || "")}" ${currentRole === "administrator" ? "" : "disabled"}></label>
        <label>Time zone<input name="time_zone" value="${escapeHtml(user.time_zone || org.time_zone || "UTC")}"></label>
        <label>Date format<input name="date_format" value="${escapeHtml(user.date_format || org.date_format || "YYYY-MM-DD")}"></label>
        <label>Time format<select name="time_format"><option value="24h" ${user.time_format !== "12h" ? "selected" : ""}>24-hour</option><option value="12h" ${user.time_format === "12h" ? "selected" : ""}>12-hour</option></select></label>
        <label>Appearance<select name="appearance"><option>system</option><option ${user.appearance === "light" ? "selected" : ""}>light</option><option ${user.appearance === "dark" ? "selected" : ""}>dark</option></select></label>
        <button class="primary" type="submit">Save settings</button></form></td></tr>`;
      $("#settings-form").onsubmit = async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const values = Object.fromEntries(form.entries());
        const payload = {
          user: { time_zone: values.time_zone, date_format: values.date_format, time_format: values.time_format, appearance: values.appearance },
        };
        if (currentRole === "administrator") payload.organization = { name: values.org_name, support_contact: values.support_contact };
        try { await request("/settings", { method: "PATCH", body: JSON.stringify(payload) }); showError("Settings saved."); $("#notice").classList.remove("error"); }
        catch (error) { showError(error.message); }
      };
    } catch (error) { showError(error.message); }
  }
  async function downloadFile(response, fallbackName) {
    const blob = await response.blob(), link = document.createElement("a");
    const named = /filename="?([^";]+)"?/.exec(response.headers.get("content-disposition") || "");
    link.href = URL.createObjectURL(blob); link.download = named ? named[1] : fallbackName; link.click(); URL.revokeObjectURL(link.href);
  }
  async function renderCertificates() {
    $("#records-title").textContent = "Certificates";
    $("#records-count").textContent = "";
    $("#table-head").innerHTML = "";
    let templates = [];
    try {
      await loadServices();
      templates = (await request("/certificate-templates")).data || [];
    } catch (error) { showError(error.message); return; }
    const active = services.filter(service => service.is_active);
    const upload = `<section class="cert-section"><h3>Upload new statement templates</h3>
      <form id="cert-upload" class="cert-row"><label>Template name<input name="name" maxlength="200" placeholder="e.g. Disinfection certificate"></label>
      <label>Certificate type<select name="service" required><option value="">Choose a service</option>${active.map(service => `<option>${escapeHtml(service.name)}</option>`).join("")}</select></label>
      <div class="file-field"><label class="primary file-pick"><input name="file" type="file" accept=".pptx,.docx" required><span>Select the editable file</span></label><small class="file-name">No file selected</small></div>
      <button class="primary" type="submit">Upload template</button></form></section>`;
    const saved = templates.map(template => `<tr><td><strong>${escapeHtml(template.name)}</strong><br><small>${escapeHtml(template.original_filename)}</small></td>
      <td>${escapeHtml(template.service)}</td><td>${escapeHtml(template.file_type.toUpperCase())}</td><td>${escapeHtml((template.created_at || "").slice(0, 10))}</td>
      <td><button data-cert-view="${escapeHtml(template.id)}">View</button><button data-cert-delete="${escapeHtml(template.id)}">Delete</button></td></tr>`).join("");
    const wrap = $("#table-body").closest(".table-wrap");
    let host = $("#cert-host");
    if (!host) { host = document.createElement("div"); host.id = "cert-host"; wrap.after(host); }
    wrap.classList.add("hidden");
    host.innerHTML = `<div id="cert-page">${upload}
      <section class="cert-section"><h3>Saved templates</h3>
      <div class="table-scroll"><table class="cert-table"><thead><tr><th>Template</th><th>Certificate type</th><th>Type</th><th>Uploaded</th><th>Action</th></tr></thead>
      <tbody>${saved || '<tr><td colspan="5">No templates yet. Upload one above to get started.</td></tr>'}</tbody></table></div></section></div>`;
    const picker = $("#cert-upload [name=file]");
    picker.onchange = () => { $("#cert-upload .file-name").textContent = picker.files[0]?.name || "No file selected"; };
    $("#cert-upload").onsubmit = async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      if (!form.get("name")) form.delete("name");
      try {
        await request("/certificate-templates", { method: "POST", body: form });
        await renderCertificates();
        showError("Template saved."); $("#notice").classList.remove("error");
      } catch (error) { showError(error.message); }
    };
    $("#cert-page").onclick = async event => {
      const view = event.target.closest("[data-cert-view]");
      if (view) { await viewCertificateTemplate(view); return; }
      const remove = event.target.closest("[data-cert-delete]");
      if (!remove || !confirm("Delete this template? Certificates already downloaded are not affected.")) return;
      try { await request(`/certificate-templates/${remove.dataset.certDelete}`, { method: "DELETE" }); await renderCertificates(); }
      catch (error) { showError(error.message); }
    };
  }
  async function viewCertificateTemplate(button) {
    const label = button.textContent;
    button.disabled = true; button.textContent = "Preparing…";
    try {
      const response = await fetch(`${api}/certificate-templates/${encodeURIComponent(button.dataset.certView)}/preview`, { credentials: "same-origin" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message || "The preview could not be created.");
      const url = URL.createObjectURL(await response.blob()), dialog = document.createElement("dialog");
      dialog.className = "cert-preview";
      dialog.innerHTML = `<div class="cert-preview-bar"><strong>Certificate preview</strong><button type="button" class="outline" data-close>Close</button></div><iframe title="Certificate preview" src="${url}"></iframe>`;
      dialog.onclick = event => { if (event.target.closest("[data-close]") || event.target === dialog) dialog.close(); };
      dialog.onclose = () => { URL.revokeObjectURL(url); dialog.remove(); };
      document.body.append(dialog); dialog.showModal(); hideError();
    } catch (error) { showError(error.message); }
    finally { button.disabled = false; button.textContent = label; }
  }
  async function downloadCertificate(projectId, button) {
    const label = button?.textContent;
    if (button) { button.disabled = true; button.textContent = "Preparing PDF…"; }
    try {
      const response = await fetch(`${api}/projects/${encodeURIComponent(projectId)}/certificate`, { credentials: "same-origin" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message || "The certificate could not be generated.");
      await downloadFile(response, "certificate.pdf");
      hideError();
    } catch (error) { showError(error.message); }
    finally { if (button) { button.disabled = false; button.textContent = label; } }
  }
  async function loadServices() {
    try {
      services = (await request("/services?limit=200")).data || [];
      services.sort((a, b) => a.name.localeCompare(b.name));
      const selected = $("#project-filter").value;
      $("#project-filter").innerHTML = '<option value="">All project types</option>' + services.map(service => `<option value="${escapeHtml(service.name)}">${escapeHtml(service.name)}</option>`).join("");
      $("#project-filter").value = services.some(service => service.name === selected) ? selected : "";
    } catch (error) { showError(error.message); }
  }
  function handleProjectAction(event) {
    const target = selector => event.target.closest(selector);
    if (target("[data-project-edit]")) { editProject(target("[data-project-edit]").dataset.projectEdit); return true; }
    if (target("[data-project-complete]")) { openCompletionForm(target("[data-project-complete]").dataset.projectComplete); return true; }
    if (target("[data-project-certificate]")) { downloadCertificate(target("[data-project-certificate]").dataset.projectCertificate, target("[data-project-certificate]")); return true; }
    if (target("[data-project-images]")) { openCompletionForm(target("[data-project-images]").dataset.projectImages, true); return true; }
    if (target("[data-locate]")) { locateProject(target("[data-locate]").dataset.locate); return true; }
    if (target("[data-approve]")) { openApproveDialog(target("[data-approve]").dataset.approve); return true; }
    if (target("[data-reject]")) { openRejectDialog(target("[data-reject]").dataset.reject); return true; }
    return false;
  }
  $("#login-form").addEventListener("submit", async event => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    try { await signIn(values.get("email"), values.get("password"), loginType, values.get("access_key")); }
    catch (error) { $("#login-message").textContent = error.message; }
  });
  function chooseLoginType(type) {
    loginType = type;
    document.querySelectorAll(".login-tabs button").forEach(tab => {
      const selected = tab.dataset.loginType === type;
      tab.classList.toggle("active", selected); tab.setAttribute("aria-selected", String(selected));
    });
    $("#key-field").classList.toggle("hidden", type !== "admin");
    $("#key-field input").required = type === "admin";
    if (type !== "admin") $("#key-field input").value = "";
    $("#login-hint").textContent = type === "admin" ? "Admin login needs your email, password and private key." : "Client login needs only your email and password.";
    $("#login-message").textContent = "";
  }
  document.querySelectorAll(".login-tabs button").forEach(tab => { tab.onclick = () => chooseLoginType(tab.dataset.loginType); });
  $("#forgot").onclick = () => {
    $("#login-message").textContent = "Contact your WaterCare administrator to reset your password.";
  };
  $("#logout").onclick = async () => {
    try { await request("/auth/logout", { method: "POST" }); }
    finally { csrfToken = ""; location.reload(); }
  };
  $("#navigation").onclick = event => {
    const action = event.target.closest("[data-action]");
    const button = event.target.closest("[data-page]");
    if (action) {
      navigate("Projects");
      openForm();
    } else if (button) navigate(button.dataset.page);
  };
  $("#today").onclick = () => selectDay(isoDate(new Date()));
  $("#all-dates").onclick = showAllDates;
  $("#date-filter").onchange = () => {
    const value = $("#date-filter").value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) selectDay(value);
    else if (!value) showAllDates();
  };
  $("#search-filter").oninput = () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilters, 300); };
  ["#client-filter", "#project-filter", "#from-filter", "#to-filter"].forEach(id => { $(id).onchange = applyFilters; });
  $("#clear-filters").onclick = () => { resetFilters(); if (page === "Dashboard") renderCalendar(); applyFilters(); };
  $("#reset-order").onclick = resetOrder;
  $("#reset-order-dashboard").onclick = resetOrder;
  enableReorder($("#task-list"));
  enableReorder($("#table-body"));
  enableCalendarScheduling($("#task-list"));
  $("#schedule-form").onsubmit = saveSchedule;
  $("#close-schedule-dialog").onclick = () => $("#schedule-dialog").close();
  $("#cancel-schedule").onclick = () => $("#schedule-dialog").close();
  $("#schedule-form").querySelectorAll('[name="schedule-mode"]').forEach(input => {
    input.onchange = () => {
      scheduleMode = input.value;
      if (scheduleMode === "single") { scheduleEnd = scheduleStart; pickingScheduleEnd = false; }
      else { scheduleEnd = ""; pickingScheduleEnd = true; }
      $("#schedule-message").textContent = "";
      updateScheduleDateFields(); renderScheduleCalendar();
    };
  });
  $("#schedule-start").onchange = event => {
    scheduleStart = event.currentTarget.value;
    showScheduleMonth(scheduleStart);
    if (scheduleMode === "single") scheduleEnd = scheduleStart;
    else if (scheduleEnd && scheduleEnd < scheduleStart) scheduleEnd = "";
    pickingScheduleEnd = scheduleMode === "range" && !scheduleEnd;
    $("#schedule-message").textContent = "";
    updateScheduleDateFields(); renderScheduleCalendar();
  };
  $("#schedule-end").onchange = event => {
    scheduleEnd = event.currentTarget.value;
    showScheduleMonth(scheduleEnd);
    pickingScheduleEnd = !scheduleEnd;
    $("#schedule-message").textContent = scheduleEnd && scheduleEnd < scheduleStart
      ? "The end date must be on or after the start date."
      : "";
    updateScheduleDateFields(); renderScheduleCalendar();
  };
  $("#schedule-previous-month").onclick = () => { scheduleMonth = new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth() - 1, 1); renderScheduleCalendar(); };
  $("#schedule-next-month").onclick = () => { scheduleMonth = new Date(scheduleMonth.getFullYear(), scheduleMonth.getMonth() + 1, 1); renderScheduleCalendar(); };
  $("#clients-link").onclick = () => navigate("Clients");
  $("#previous-month").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); loadTasks(); };
  $("#next-month").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); loadTasks(); };
  // Wrapped so a false return never cancels the click (which would stop <details> items from expanding).
  $("#task-list").onclick = event => { handleProjectAction(event); };
  const assignedPanel = $("#assigned-panel");
  if (assignedPanel) assignedPanel.onclick = event => { handleProjectAction(event); };
  $("#project-map").onclick = event => { if (handleProjectAction(event)) projectMap?.closePopup(); };
  $("#approvals").onclick = event => { handleProjectAction(event); };
  $("#add-record").onclick = () => openForm();
  $("#close-dialog").onclick = () => $("#record-dialog").close();
  $("#close-completion-dialog").onclick = () => $("#completion-dialog").close();
  $("#close-approve-dialog").onclick = () => $("#approve-dialog").close();
  $("#cancel-approve").onclick = () => $("#approve-dialog").close();
  $("#close-reject-dialog").onclick = () => $("#reject-dialog").close();
  $("#record-form").onsubmit = saveRecord;
  $("#completion-form").onsubmit = submitCompletion;
  $("#approve-form").onsubmit = submitApproval;
  $("#reject-form").onsubmit = submitRejection;
  $("#completion-date").onchange = updateCompletionDateFields;
  $("#table-body").addEventListener("change", event => { if (event.target.matches("[data-photo-for]")) uploadEngineerPhoto(event.target); });
  $("#table-body").onclick = async event => {
    if (handleProjectAction(event)) return;
    const addProject = event.target.closest("[data-add-project]");
    if (addProject) return openForm(null, { client_name: addProject.dataset.addProject });
    const deleteProject = event.target.closest("[data-project-delete]");
    if (deleteProject && confirm("Permanently delete this project, its project tasks, and all saved project documents? This cannot be undone.")) {
      try {
        await request(`/projects/${deleteProject.dataset.projectDelete}/permanent`, { method: "DELETE" });
        await Promise.all([loadRecords(), loadProjectOptions()]);
      } catch (error) { showError(error.message); }
      return;
    }
    const edit = event.target.closest("[data-edit]"), remove = event.target.closest("[data-delete]");
    if (edit) openForm(edit.dataset.edit);
    if (remove && confirm("Archive this record? Historical records are retained.")) {
      try { await request(`/${resources[page].path}/${remove.dataset.delete}`, { method: "DELETE" }); await loadRecords(); if (page === "Projects") await loadProjectOptions(); if (page === "Services") await loadServices(); }
      catch (error) { showError(error.message); }
    }
    const report = event.target.closest("[data-report]");
    if (report) {
      event.preventDefault();
      try {
        // Exports follow the filter bar, keeping only the filters each report supports.
        const params = filterParams(REPORT_FILTERS[report.dataset.report] || []);
        const response = await fetch(`${report.href}${params.toString() ? `&${params}` : ""}`, { credentials: "same-origin" });
        if (!response.ok) throw new Error("Report export failed.");
        const blob = await response.blob(), link = document.createElement("a");
        link.href = URL.createObjectURL(blob); link.download = `watercare-${report.dataset.report}-report.${report.dataset.format}`; link.click(); URL.revokeObjectURL(link.href);
      } catch (error) { showError(error.message); }
    }
  };
  // Every password box gets a show/hide eye, including ones the page creates later (such as the Engineers form).
  const EYE_OPEN = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.4-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  function addPasswordToggles(root = document) {
    root.querySelectorAll('input[type="password"]:not([data-eye])').forEach(input => {
      input.dataset.eye = "1";
      const wrap = document.createElement("span"), button = document.createElement("button");
      wrap.className = "password-wrap";
      button.type = "button"; button.className = "password-eye"; button.innerHTML = EYE_OPEN;
      button.setAttribute("aria-label", "Show password"); button.setAttribute("aria-pressed", "false");
      button.onclick = () => {
        const visible = input.type === "password";
        input.type = visible ? "text" : "password";
        button.innerHTML = visible ? EYE_OFF : EYE_OPEN;
        button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
        button.setAttribute("aria-pressed", String(visible));
        input.focus();
      };
      input.before(wrap); wrap.append(input, button);
    });
  }
  addPasswordToggles();
  new MutationObserver(() => addPasswordToggles()).observe(document.body, { childList: true, subtree: true });
  initialize();
})();
