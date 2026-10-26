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
    "Cleaning Records": { path: "cleaning-records", fields: ["client_id", "site_name", "tank_identification", "tank_type", "capacity", "location", "cleaning_date", "cleaning_time", "engineer_id", "procedure", "materials_used", "observations", "status", "next_recommended_date", "notes"], columns: ["site_name", "tank_identification", "status", "cleaning_date"] },
    "Water Testing": { path: "water-testing", fields: ["client_id", "project_id", "sampling_location", "collection_date", "collection_time", "engineer_id", "water_source", "testing_category", "sample_identification", "test_parameters", "test_results", "reference_limits", "interpretation", "laboratory_details", "status", "notes"], columns: ["sample_identification", "testing_category", "status", "collection_date"] },
    Clients: { path: "clients", fields: ["name", "organization_name", "contact_person", "phone", "email", "address", "category", "notes"], columns: ["name", "contact_person", "phone", "email"] },
    Engineers: { path: "engineers", fields: ["engineer_code", "full_name", "email", "phone", "specialization", "availability"], columns: ["engineer_code", "full_name", "specialization", "email", "phone"] }
  };
  const fieldLabels = { engineer_code: "Engineer ID", full_name: "Engineer name", engineer_id: "Engineer", approval_status: "approval" };
  let csrfToken = "";
  // Which filter bar controls each page uses; "day" narrows the dashboard to one date, "range" is a from/to pair.
  const PAGE_FILTERS = {
    Dashboard: ["search", "client", "project", "day"],
    Projects: ["search", "client", "project", "range"],
    "Cleaning Records": ["search", "client", "range"],
    "Water Testing": ["search", "client", "project", "range"],
    Clients: ["search"],
    Engineers: ["search"],
    Approvals: ["search", "client", "project", "range"],
    Reports: ["search", "client", "project", "range"],
  };
  const REPORT_FILTERS = { projects: PAGE_FILTERS.Projects, cleaning: PAGE_FILTERS["Cleaning Records"], "water-testing": PAGE_FILTERS["Water Testing"], clients: ["search", "client"] };
  let page = "Dashboard", selectedDate = new Date(), month = new Date(), dayMode = false;
  let tasks = [], records = [], clients = [], engineers = [], locations = [], editingId = null, currentRole = "";
  let overviewProjects = [], projectOptions = [], allLocations = [], approvalItems = [], approvalHistory = [], filterTimer = null;
  let projectMap = null, projectMarkers = null, pickerMap = null, rejectingProjectId = null, basemapStyle = null;
  const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
  const BASEMAP_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  const STATUS_LABELS = { pending: "Pending", "submitted-for-approval": "Awaiting approval", approved: "Approved", rejected: "Rejected", completed: "Completed" };

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
  async function signIn(email, password) {
    const result = await request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    csrfToken = result.csrf_token;
    await initialize();
  }
  async function initialize() {
    try {
      const current = await request("/auth/me");
      csrfToken = current.csrf_token || csrfToken;
      $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
      currentRole = current.role;
      document.querySelectorAll("[data-action]").forEach(button => {
        button.classList.toggle("hidden", !canEdit());
      });
      $("#user-email").textContent = `${current.user.email || "Employee"} | ${ROLE_LABELS[current.role] || current.role}`;
      await Promise.all([loadClients(), loadEngineers(), loadProjectOptions()]); navigate("Dashboard");
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
      const selected = $("#project-filter").value;
      $("#project-filter").innerHTML = '<option value="">All projects</option>' + projectOptions.map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml([project.client_name, project.name].filter(Boolean).join(" · "))}</option>`).join("");
      $("#project-filter").value = projectOptions.some(project => project.id === selected) ? selected : "";
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
    if (kinds.includes("project") && values.project) params.set("project_id", values.project);
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
    if (dayMode) { renderOverview(); return; }
    try {
      const params = filterParams(["search", "client", "project"]);
      params.set("limit", "200");
      overviewProjects = (await request(`/projects?${params}`)).data || [];
    } catch (error) { showError(error.message); overviewProjects = []; }
    renderOverview();
  }
  function refreshDashboard() { loadTasks(); loadOverview(); loadLocations(); }
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
    for (let i = 0; i < offset; i++) calendar.insertAdjacentHTML("beforeend", "<span></span>");
    const withTasks = new Set(tasks.map(task => task.scheduled_date));
    for (let day = 1; day <= count; day++) {
      const value = isoDate(new Date(y, m, day));
      const button = document.createElement("button");
      button.className = `day${value === isoDate(new Date()) ? " today" : ""}${dayMode && value === isoDate(selectedDate) ? " selected" : ""}${withTasks.has(value) ? " has-tasks" : ""}`;
      button.textContent = day; button.setAttribute("aria-label", `${value}${withTasks.has(value) ? ", scheduled tasks" : ""}`);
      button.onclick = () => selectDay(value);
      calendar.append(button);
    }
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
        .filter(task => !project || task.project?.id === project)
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
  function dragHandle() { return '<button type="button" class="drag-handle" title="Drag to reorder" aria-label="Drag to change the work order. Arrow keys also move it."></button>'; }
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
      ["Invoice No.", project.invoice_number],
      ["Rejection reason", approval === "Rejected" ? project.rejection_reason : ""],
      ["Details", task.description || task.notes || project.system_details],
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    const movable = reorder && task.record_type === "project" && project.id;
    return `<details class="task-item"${movable ? ` data-project-id="${escapeHtml(project.id)}"` : ""}><summary>${movable ? dragHandle() : ""}<span class="task-names"><strong>${escapeHtml(project.client_name || "Client not set")}</strong><strong>${escapeHtml(project.name || task.title)}</strong></span><span class="task-meta"><span class="status-badge">${escapeHtml(task.status || "Scheduled")}</span>${approval ? `<span class="status-badge approval-${slug(approval)}">${escapeHtml(approval)}</span>` : ""}${task.scheduled_time ? `<span class="task-time">${escapeHtml(task.scheduled_time)}</span>` : ""}</span></summary><dl class="task-details">${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>${projectActions(project, true)}</details>`;
  }
  function completionButton(project, outline) {
    const id = escapeHtml(project.id), approval = project.approval_status, className = outline ? ' class="outline"' : "";
    if (canSubmit() && project.status !== "Completed" && !["Submitted for Approval", "Approved"].includes(approval)) {
      return `<button${className} data-project-complete="${id}">${approval === "Rejected" ? "Correct &amp; Resubmit" : "Mark as Completed"}</button>`;
    }
    return `<button${className} data-project-images="${id}">View Completion</button>`;
  }
  function decisionButtons(project, outline) {
    if (!canEdit() || project.approval_status !== "Submitted for Approval") return "";
    const id = escapeHtml(project.id), className = outline ? "outline" : "";
    return `<button class="${className} approve-button" data-approve="${id}">Approve</button><button class="${className} reject-button" data-reject="${id}">Reject</button>`;
  }
  function projectActions(project, outline) {
    if (!project.id) return "";
    const edit = canEdit() ? `<button class="outline" data-project-edit="${escapeHtml(project.id)}">Edit</button>` : "";
    return `<div class="header-actions task-actions">${edit}${completionButton(project, outline)}${decisionButtons(project, outline)}</div>`;
  }

  function resetFilters() {
    ["#search-filter", "#client-filter", "#project-filter", "#from-filter", "#to-filter", "#date-filter"].forEach(id => { $(id).value = ""; });
    dayMode = false;
  }
  function navigate(nextPage) {
    if (nextPage !== page) resetFilters();
    page = nextPage; hideError();
    $("#page-title").textContent = page;
    $("#navigation").querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.page === page));
    $("#dashboard").classList.toggle("hidden", page !== "Dashboard");
    $("#approvals").classList.toggle("hidden", page !== "Approvals");
    $("#records").classList.toggle("hidden", !resources[page] && page !== "Reports" && page !== "Settings");
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
    const columnCount = definition.columns.length + 1 + (reorder ? 1 : 0);
    $("#records-title").textContent = page;
    $("#table-head").innerHTML = `<tr>${reorder ? '<th class="handle-col" aria-label="Work order"></th>' : ""}${definition.columns.map(field => `<th>${escapeHtml(fieldLabels[field] || field.replaceAll("_", " "))}</th>`).join("")}<th>Actions</th></tr>`;
    try {
      const query = filterParams(PAGE_FILTERS[page]);
      query.set("limit", "200");
      const response = await request(`/${definition.path}?${query}`);
      records = response.data || [];
      $("#records-count").textContent = `${records.length}${records.length === 200 ? "+" : ""} record${records.length === 1 ? "" : "s"}`;
      let previousDay = null;
      $("#table-body").innerHTML = records.map(record => {
        if (page !== "Projects") return `<tr>${definition.columns.map(field => `<td>${escapeHtml(cellValue(record, field))}</td>`).join("")}<td>${rowActions(record)}</td></tr>`;
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
      let lastX = event.clientX, lastY = event.clientY, finished = false;
      const reposition = () => {
        const target = document.elementFromPoint(lastX, lastY)?.closest("[data-project-id]");
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
        finished = true; clearInterval(timer);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        item.classList.remove("dragging");
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
  async function resetOrder() {
    if (!confirm("Put every project back in date order? Manual moves will be cleared.")) return;
    try { await request("/projects/order/reset", { method: "POST" }); await refreshAfterReorder(); }
    catch (error) { showError(error.message); }
  }
  function rowActions(record) {
    const id = escapeHtml(record.id);
    if (page !== "Projects") return canEdit() ? `<button data-edit="${id}">Edit</button><button data-delete="${id}">Archive</button>` : "";
    if (!canEdit()) return completionButton(record, false);
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
    $("#form-fields").innerHTML = definition.fields.map(field => {
      const labels = { client_name: "Client", name: "Project", service: "Service", so_no: "SO No", start_date: "Start Date", visit_time: "Engineer Visit Time", end_date: "End Date", location: "Location", system_details: "System Details", engineer_name: "Engineer", engineer_visit: "Engineer Visit", engineer_visit_custom_date: "Engineer Visit Date", microbiology: "Microbiology", microbiology_frequency: "Microbiology Options", microbiology_custom_date: "Microbiology Date", legionella: "Legionella", legionella_frequency: "Legionella Options", legionella_custom_date: "Legionella Date" };
      if (page === "Projects" && field === "location_map") return locationPicker();
      const label = page === "Projects" ? labels[field] : fieldLabels[field] || field.replaceAll("_", " ");
      let control, className = "";
      if (page === "Projects" && field === "service") {
        const options = ["Water testing", "Tank cleaning"];
        control = `<select name="${field}" required><option value="">Choose service</option>${options.map(option => `<option ${existing[field] === option ? "selected" : ""}>${option}</option>`).join("")}</select>`;
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
      else if (field === "client_id") control = `<select name="${field}" required><option value="">Choose client</option>${clients.map(client => `<option value="${escapeHtml(client.id)}" ${existing[field] === client.id ? "selected" : ""}>${escapeHtml(client.name)}</option>`).join("")}</select>`;
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
    const place = (lat, lng, zoom) => {
      latitude.value = lat.toFixed(6); longitude.value = lng.toFixed(6);
      if (marker) marker.setLatLng([lat, lng]);
      else {
        marker = L.marker([lat, lng], { icon: pinIcon(), draggable: true, autoPan: true, title: "Project location (drag to adjust)" }).addTo(pickerMap);
        marker.on("dragend", () => { const point = marker.getLatLng(); place(point.lat, point.lng); });
      }
      if (zoom) pickerMap.setView([lat, lng], zoom);
      describe();
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
      if (point) place(point[0], point[1], Math.max(pickerMap.getZoom(), 15));
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
    pickerMap.on("click", event => { clearSuggestions(); place(event.latlng.lat, event.latlng.lng); });
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
    Object.keys(values).forEach(key => { if (values[key] === "") delete values[key]; });
    const jsonError = jsonFields.parseInto(values);
    if (jsonError) { $("#form-message").textContent = jsonError; return; }
    try {
      await request(`/${resources[page].path}${editingId ? `/${editingId}` : ""}`, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(values) });
      $("#record-dialog").close(); await loadRecords(); await loadClients();
      if (page === "Engineers") await loadEngineers();
      if (page === "Projects") await loadProjectOptions();
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
    $("#completion-status").value = project.completion_status || "";
    $("#expected-duration").value = project.expected_duration ?? "";
    $("#completed-duration").value = project.completed_duration ?? "";
    $("#invoice-number").value = project.invoice_number || "";
    $("#before-images").value = "";
    $("#after-images").value = "";
    $("#completion-duration-fields").classList.toggle("hidden", project.completion_status === "Completed Within Contract Period");
    $("#completion-submit").classList.toggle("hidden", readOnly);
    $("#completion-form").querySelectorAll("input,select").forEach(control => { control.disabled = readOnly; });
    $("#completion-image-inputs").classList.toggle("hidden", readOnly);
    $("#completion-title").textContent = readOnly ? "Completion Record" : approval === "Rejected" ? "Correct & Resubmit Completion" : "Mark Project as Completed";
    $("#additional-duration").textContent = project.additional_duration != null ? `Additional duration taken: ${project.additional_duration} day(s)` : "";
    const saved = files.filter(file => file.image_type);
    $("#before-images").required = !saved.some(file => file.image_type === "before");
    $("#after-images").required = !saved.some(file => file.image_type === "after");
    $("#saved-project-images").innerHTML = saved.map(file => `<figure><img src="${api}/uploads/${encodeURIComponent(file.id)}?inline=1" alt="${escapeHtml(file.image_type)} image: ${escapeHtml(file.original_filename)}"><figcaption>${escapeHtml(file.image_type === "before" ? "Before" : "After")} · ${escapeHtml(file.original_filename)}</figcaption></figure>`).join("") || '<p class="muted">No project images saved.</p>';
    $("#completion-approval").classList.toggle("hidden", !approval && project.status !== "Completed");
    $("#completion-approval").innerHTML = `<p><b>${escapeHtml(project.client_name || "")}</b> · <b>${escapeHtml(project.name || "")}</b></p><p>Approval status: <span class="status-badge approval-${slug(approval)}">${escapeHtml(approval || "Completed before approvals")}</span></p>${approval === "Rejected" && project.rejection_reason ? `<p class="rejection">Rejection reason: ${escapeHtml(project.rejection_reason)}</p>` : ""}`;
    $("#completion-history").innerHTML = history.length ? `<h3>Approval history</h3><ol>${history.map(entry => `<li><b>${escapeHtml(entry.action)}</b> · ${escapeHtml(entry.previous_status)} → ${escapeHtml(entry.new_status)} · ${escapeHtml(entry.actor_name)} · ${escapeHtml(formatDateTime(entry.created_at))}${entry.reason ? `<br><span class="rejection">Reason: ${escapeHtml(entry.reason)}</span>` : ""}</li>`).join("")}</ol>` : "";
    if (!readOnly) updateDurationVisibility();
    $("#completion-dialog").showModal();
  }
  async function editProject(projectId) {
    navigate("Projects");
    await loadRecords();
    openForm(projectId);
  }
  function updateDurationVisibility() {
    const visible = $("#completion-status").value !== "" && $("#completion-status").value !== "Completed Within Contract Period";
    $("#completion-duration-fields").classList.toggle("hidden", !visible);
    $("#expected-duration").required = visible;
    $("#completed-duration").required = visible;
    const expected = Number($("#expected-duration").value), completed = Number($("#completed-duration").value);
    $("#additional-duration").textContent = visible && $("#expected-duration").value !== "" && $("#completed-duration").value !== ""
      ? `Additional duration taken: ${Math.max(completed - expected, 0)} day(s)` : "";
  }
  async function refreshAfterApprovalChange() {
    if (resources[page]) await loadRecords();
    if (page === "Approvals") await renderApprovals();
    if (page === "Dashboard") refreshDashboard();
  }
  async function submitCompletion(event) {
    event.preventDefault();
    const projectId = $("#completion-project-id").value;
    const files = [
      ...Array.from($("#before-images").files, file => ({ file, imageType: "before" })),
      ...Array.from($("#after-images").files, file => ({ file, imageType: "after" })),
    ];
    try {
      for (const item of files) {
        const form = new FormData();
        form.append("related_type", "project");
        form.append("related_id", projectId);
        form.append("image_type", item.imageType);
        form.append("file", item.file);
        await request("/uploads", { method: "POST", body: form });
      }
      const payload = { completion_status: $("#completion-status").value, invoice_number: $("#invoice-number").value.trim() || null };
      if (payload.completion_status !== "Completed Within Contract Period") {
        payload.expected_duration = Number($("#expected-duration").value);
        payload.completed_duration = Number($("#completed-duration").value);
      }
      await request(`/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(payload) });
      $("#completion-dialog").close();
      await refreshAfterApprovalChange();
    } catch (error) { $("#completion-message").textContent = error.message; }
  }
  async function approveProject(projectId) {
    if (!confirm("Approve this completion? The project will be recorded as an approved completion.")) return;
    try { await request(`/projects/${encodeURIComponent(projectId)}/approve`, { method: "POST" }); await refreshAfterApprovalChange(); }
    catch (error) { showError(error.message); }
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
    const shown = approvalItems.filter(record => (!client || record.client_id === client) && (!project || record.id === project)
      && inDateRange((record.updated_at || "").slice(0, 10), from, to)
      && textMatches([record.client_name, record.name, record.engineer_name, record.completion_status, record.invoice_number, record.so_no], search));
    const history = approvalHistory.filter(entry => (!client || clientOf(entry.project_id) === client) && (!project || entry.project_id === project)
      && inDateRange((entry.created_at || "").slice(0, 10), from, to)
      && textMatches([entry.reference, entry.action, entry.actor_name, entry.reason, entry.previous_status, entry.new_status], search));
    const filtered = Boolean(search || client || project || from || to);
    $("#approval-count").textContent = `${shown.length} awaiting`;
    $("#approval-body").innerHTML = shown.map(record => `<tr><td><strong>${escapeHtml(record.client_name)}</strong></td><td><strong>${escapeHtml(record.name)}</strong></td><td>${escapeHtml(record.engineer_name)}</td><td>${escapeHtml(record.completion_status)}${record.additional_duration ? ` (+${escapeHtml(record.additional_duration)} day(s))` : ""}</td><td>${escapeHtml(record.invoice_number || "—")}</td><td><button data-project-images="${escapeHtml(record.id)}">View Completion</button>${decisionButtons(record, false)}</td></tr>`).join("") || `<tr><td colspan="6">${filtered ? "No completions awaiting approval match these filters." : "No completions are awaiting approval."}</td></tr>`;
    $("#history-body").innerHTML = history.map(entry => `<tr><td>${escapeHtml(formatDateTime(entry.created_at))}</td><td>${escapeHtml(entry.reference)}</td><td>${escapeHtml(entry.previous_status)} → ${escapeHtml(entry.new_status)}</td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.actor_name)}</td><td>${escapeHtml(entry.reason || "")}</td></tr>`).join("") || `<tr><td colspan="6">${filtered ? "No approval activity matches these filters." : "No approval activity yet."}</td></tr>`;
  }
  function fitProjects() {
    projectMap.invalidateSize();
    if (locations.length) projectMap.fitBounds(L.latLngBounds(locations.map(item => [item.latitude, item.longitude])), { padding: [40, 40], maxZoom: 14 });
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
    locations = allLocations.filter(item => (!project || item.id === project)
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
    const choices = [["Projects","projects"],["Tank cleaning","cleaning"],["Water testing","water-testing"],["Clients","clients"]];
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
  function handleProjectAction(event) {
    const target = selector => event.target.closest(selector);
    if (target("[data-project-edit]")) { editProject(target("[data-project-edit]").dataset.projectEdit); return true; }
    if (target("[data-project-complete]")) { openCompletionForm(target("[data-project-complete]").dataset.projectComplete); return true; }
    if (target("[data-project-images]")) { openCompletionForm(target("[data-project-images]").dataset.projectImages, true); return true; }
    if (target("[data-approve]")) { approveProject(target("[data-approve]").dataset.approve); return true; }
    if (target("[data-reject]")) { openRejectDialog(target("[data-reject]").dataset.reject); return true; }
    return false;
  }
  $("#login-form").addEventListener("submit", async event => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    try { await signIn(values.get("email"), values.get("password")); }
    catch (error) { $("#login-message").textContent = error.message; }
  });
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
      const destination = action.dataset.action === "add-project" ? "Projects" : "Cleaning Records";
      navigate(destination);
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
  $("#clients-link").onclick = () => navigate("Clients");
  $("#previous-month").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); loadTasks(); };
  $("#next-month").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); loadTasks(); };
  // Wrapped so a false return never cancels the click (which would stop <details> items from expanding).
  $("#task-list").onclick = event => { handleProjectAction(event); };
  $("#project-map").onclick = event => { if (handleProjectAction(event)) projectMap?.closePopup(); };
  $("#approvals").onclick = event => { handleProjectAction(event); };
  $("#add-record").onclick = () => openForm();
  $("#close-dialog").onclick = () => $("#record-dialog").close();
  $("#close-completion-dialog").onclick = () => $("#completion-dialog").close();
  $("#close-reject-dialog").onclick = () => $("#reject-dialog").close();
  $("#record-form").onsubmit = saveRecord;
  $("#completion-form").onsubmit = submitCompletion;
  $("#reject-form").onsubmit = submitRejection;
  $("#completion-status").onchange = updateDurationVisibility;
  ["expected-duration", "completed-duration"].forEach(id => { $(`#${id}`).oninput = updateDurationVisibility; });
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
      try { await request(`/${resources[page].path}/${remove.dataset.delete}`, { method: "DELETE" }); await loadRecords(); if (page === "Projects") await loadProjectOptions(); }
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
  initialize();
})();
