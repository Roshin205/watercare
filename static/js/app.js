(() => {
  const $ = (selector) => document.querySelector(selector);
  const jsonFields = window.WaterCareJsonFields;
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
  let page = "Dashboard", selectedDate = new Date(), month = new Date();
  let tasks = [], records = [], clients = [], engineers = [], locations = [], editingId = null, currentRole = "";
  let projectMap = null, projectMarkers = null, pickerMap = null, rejectingProjectId = null;

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
      await Promise.all([loadClients(), loadEngineers()]); navigate("Dashboard");
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
  function cellValue(record, field) {
    if (field === "engineer_visit") return scheduleText(record, FREQUENCY_GROUPS[0]);
    if (field === "approval_status") return record.approval_status || (record.status === "Completed" ? "Completed" : "");
    return record[field];
  }

  async function loadTasks() {
    const first = new Date(month.getFullYear(), month.getMonth(), 1), last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const params = new URLSearchParams({ from: isoDate(first), to: isoDate(last) });
    if ($("#client-filter").value) params.set("client_id", $("#client-filter").value);
    try { tasks = (await request(`/dashboard/tasks?${params}`)).data || []; renderCalendar(); renderTask(); }
    catch (error) { showError(error.message); tasks = []; renderCalendar(); renderTask(); }
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
      button.className = `day${value === isoDate(new Date()) ? " today" : ""}${value === isoDate(selectedDate) ? " selected" : ""}${withTasks.has(value) ? " has-tasks" : ""}`;
      button.textContent = day; button.setAttribute("aria-label", `${value}${withTasks.has(value) ? ", scheduled tasks" : ""}`);
      button.onclick = () => { selectedDate = new Date(y, m, day); renderCalendar(); renderTask(); };
      calendar.append(button);
    }
  }
  function renderTask() {
    const date = isoDate(selectedDate), matching = tasks.filter(task => task.scheduled_date === date);
    $("#date-filter").value = date;
    $("#task-position").textContent = `${matching.length} item${matching.length === 1 ? "" : "s"}`;
    $("#task-count").textContent = matching.length ? `Work recorded for ${date}` : `No tasks scheduled on ${date}`;
    $("#task-list").innerHTML = matching.length ? matching.map(taskItem).join("") : '<p class="empty">No scheduled work for this date.</p>';
  }
  function taskItem(task) {
    const project = task.project || {}, approval = task.record_type === "project" ? project.approval_status : "";
    const service = project.service || { cleaning: "Tank cleaning", water_testing: "Water testing" }[task.record_type] || task.title;
    const details = [
      ["Service", service],
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
    return `<details class="task-item"><summary><span class="task-names"><strong>${escapeHtml(project.client_name || "Client not set")}</strong><strong>${escapeHtml(project.name || task.title)}</strong></span><span class="task-meta"><span class="status-badge">${escapeHtml(task.status || "Scheduled")}</span>${approval ? `<span class="status-badge approval-${slug(approval)}">${escapeHtml(approval)}</span>` : ""}${task.scheduled_time ? `<span class="task-time">${escapeHtml(task.scheduled_time)}</span>` : ""}</span></summary><dl class="task-details">${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>${projectActions(project, true)}</details>`;
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

  function navigate(nextPage) {
    page = nextPage; hideError();
    $("#page-title").textContent = page;
    $("#navigation").querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.page === page));
    $("#dashboard").classList.toggle("hidden", page !== "Dashboard");
    $("#approvals").classList.toggle("hidden", page !== "Approvals");
    $("#records").classList.toggle("hidden", !resources[page] && page !== "Reports" && page !== "Settings");
    $("#client-filter").classList.toggle("hidden", page !== "Dashboard");
    $("#date-filter").classList.toggle("hidden", page !== "Dashboard");
    $("#today").classList.toggle("hidden", page !== "Dashboard");
    $("#add-record").classList.toggle("hidden", !resources[page] || !canEdit());
    if (page === "Dashboard") { loadTasks(); loadLocations(); }
    else if (resources[page]) loadRecords();
    else if (page === "Approvals") renderApprovals();
    else if (page === "Reports") renderReports();
    else if (page === "Settings") renderSettings();
  }
  async function loadRecords() {
    const definition = resources[page];
    $("#records-title").textContent = page;
    $("#table-head").innerHTML = `<tr>${definition.columns.map(field => `<th>${escapeHtml(fieldLabels[field] || field.replaceAll("_", " "))}</th>`).join("")}<th>Actions</th></tr>`;
    try {
      const query = new URLSearchParams({ limit: "200" });
      if ($("#search").value && ["Clients", "Engineers"].includes(page)) query.set("search", $("#search").value);
      const response = await request(`/${definition.path}?${query}`);
      records = response.data || [];
      if (page === "Projects") {
        records.forEach(record => {
          record.client_name ||= clients.find(client => client.id === record.client_id)?.name || "";
        });
      }
      $("#table-body").innerHTML = records.map(record => `<tr>${definition.columns.map(field => `<td>${escapeHtml(cellValue(record, field))}</td>`).join("")}<td>${rowActions(record)}</td></tr>`).join("") || `<tr><td colspan="${definition.columns.length + 1}">No records yet.</td></tr>`;
    } catch (error) { showError(error.message); }
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
    return `<div class="wide location-picker"><span>Map Location</span><div class="map-search"><input name="location_search" type="search" placeholder="Search for a place or address" aria-label="Search map location"><button type="button" id="map-search-button" class="outline">Search</button></div><ul id="map-search-results" class="map-results"></ul><div id="location-picker-map" class="picker-map" role="application" aria-label="Click the map to set the project location"></div><div class="picker-footer"><span id="picker-coordinates"></span><button type="button" id="clear-location" class="text-button">Clear location</button></div><input type="hidden" name="latitude"><input type="hidden" name="longitude"></div>`;
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
  function mapTiles(map) {
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
  }
  function pinIcon() { return L.divIcon({ className: "map-pin-icon", html: '<span class="map-pin"></span>', iconSize: [22, 22], iconAnchor: [11, 27], popupAnchor: [0, -26] }); }
  function initLocationPicker(existing) {
    const coordinates = $("#picker-coordinates"), latitude = $('#form-fields [name="latitude"]'), longitude = $('#form-fields [name="longitude"]');
    if (pickerMap) { pickerMap.remove(); pickerMap = null; }
    if (!window.L) { coordinates.textContent = "The map could not load. Check the internet connection; the rest of the project still saves."; return; }
    pickerMap = L.map("location-picker-map", { scrollWheelZoom: false });
    mapTiles(pickerMap);
    let marker = null;
    const place = (lat, lng, zoom) => {
      latitude.value = lat.toFixed(6); longitude.value = lng.toFixed(6);
      if (marker) marker.setLatLng([lat, lng]); else marker = L.marker([lat, lng], { icon: pinIcon(), keyboard: false }).addTo(pickerMap);
      coordinates.textContent = `Selected: ${latitude.value}, ${longitude.value}`;
      if (zoom) pickerMap.setView([lat, lng], zoom);
    };
    const clear = () => {
      latitude.value = ""; longitude.value = "";
      if (marker) { marker.remove(); marker = null; }
      coordinates.textContent = "No location saved. Click the map or search to place the site marker.";
    };
    if (existing.latitude != null && existing.longitude != null) place(Number(existing.latitude), Number(existing.longitude), 15);
    else {
      clear();
      if (locations.length) pickerMap.fitBounds(L.latLngBounds(locations.map(item => [item.latitude, item.longitude])), { padding: [30, 30], maxZoom: 12 });
      else pickerMap.setView([20, 0], 2);
    }
    pickerMap.on("click", event => place(event.latlng.lat, event.latlng.lng));
    $("#clear-location").onclick = clear;
    const search = async () => {
      const query = $('#form-fields [name="location_search"]').value.trim(), results = $("#map-search-results");
      if (!query) return;
      results.innerHTML = '<li class="muted">Searching…</li>';
      try {
        const params = new URLSearchParams({ format: "jsonv2", limit: "5", q: query, "accept-language": navigator.language || "en" });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
        if (!response.ok) throw new Error();
        const places = await response.json();
        results.innerHTML = places.map(item => `<li><button type="button" data-lat="${escapeHtml(item.lat)}" data-lng="${escapeHtml(item.lon)}" data-name="${escapeHtml(item.display_name)}">${escapeHtml(item.display_name)}</button></li>`).join("") || '<li class="muted">No places found. Click the map to set the location instead.</li>';
      } catch { results.innerHTML = '<li class="muted">Location search is unavailable. Click the map to set the location instead.</li>'; }
    };
    $("#map-search-button").onclick = search;
    $('#form-fields [name="location_search"]').onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); search(); } };
    $("#map-search-results").onclick = event => {
      const result = event.target.closest("[data-lat]");
      if (!result) return;
      place(Number(result.dataset.lat), Number(result.dataset.lng), 16);
      const locationInput = $('#form-fields [name="location"]');
      if (!locationInput.value.trim()) locationInput.value = result.dataset.name.slice(0, 500);
      $("#map-search-results").innerHTML = "";
    };
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
      values.latitude = values.latitude === "" ? null : Number(values.latitude);
      values.longitude = values.longitude === "" ? null : Number(values.longitude);
      ["engineer_choice", "engineer_other", "location_search"].forEach(key => delete values[key]);
    }
    Object.keys(values).forEach(key => { if (values[key] === "") delete values[key]; });
    const jsonError = jsonFields.parseInto(values);
    if (jsonError) { $("#form-message").textContent = jsonError; return; }
    try {
      await request(`/${resources[page].path}${editingId ? `/${editingId}` : ""}`, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(values) });
      $("#record-dialog").close(); await loadRecords(); await loadClients();
      if (page === "Engineers") await loadEngineers();
      if (["Projects", "Cleaning Records", "Water Testing"].includes(page)) loadTasks();
      if (page === "Projects") loadLocations();
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
    await loadTasks();
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
      records = pending.data || [];
      records.forEach(record => { record.client_name ||= clients.find(client => client.id === record.client_id)?.name || ""; });
      $("#approval-count").textContent = `${records.length} awaiting`;
      $("#approval-body").innerHTML = records.map(record => `<tr><td><strong>${escapeHtml(record.client_name)}</strong></td><td><strong>${escapeHtml(record.name)}</strong></td><td>${escapeHtml(record.engineer_name)}</td><td>${escapeHtml(record.completion_status)}${record.additional_duration ? ` (+${escapeHtml(record.additional_duration)} day(s))` : ""}</td><td>${escapeHtml(record.invoice_number || "—")}</td><td><button data-project-images="${escapeHtml(record.id)}">View Completion</button>${decisionButtons(record, false)}</td></tr>`).join("") || '<tr><td colspan="6">No completions are awaiting approval.</td></tr>';
      $("#history-body").innerHTML = (history.data || []).map(entry => `<tr><td>${escapeHtml(formatDateTime(entry.created_at))}</td><td>${escapeHtml(entry.reference)}</td><td>${escapeHtml(entry.previous_status)} → ${escapeHtml(entry.new_status)}</td><td>${escapeHtml(entry.action)}</td><td>${escapeHtml(entry.actor_name)}</td><td>${escapeHtml(entry.reason || "")}</td></tr>`).join("") || '<tr><td colspan="6">No approval activity yet.</td></tr>';
    } catch (error) { showError(error.message); }
  }
  function ensureProjectMap() {
    if (!window.L) { $("#map-message").textContent = "The map could not load. Check the internet connection and reload the page."; return null; }
    if (!projectMap) {
      projectMap = L.map("project-map", { scrollWheelZoom: false }).setView([20, 0], 2);
      mapTiles(projectMap);
      projectMarkers = L.layerGroup().addTo(projectMap);
    }
    setTimeout(() => projectMap.invalidateSize(), 0);
    return projectMap;
  }
  function popupHtml(item) {
    const rows = [
      ["Engineer", item.engineer_name || "Engineer not assigned"],
      ["Task", [item.service, item.so_no != null ? `SO ${item.so_no}` : "", item.start_date ? `${item.start_date} to ${item.end_date || item.start_date}` : "", item.visit_time ? `visit ${item.visit_time}` : ""].filter(Boolean).join(" · ")],
      ["Engineer visit", scheduleText(item, FREQUENCY_GROUPS[0])],
      ["Details", item.system_details || item.description],
      ["Status", [item.status, item.approval_status].filter(Boolean).join(" · ")],
      ["Location", item.location || `${Number(item.latitude).toFixed(5)}, ${Number(item.longitude).toFixed(5)}`],
    ].filter(([, value]) => value);
    return `<div class="map-popup"><strong>${escapeHtml(item.client_name || "Client not set")}</strong><strong class="project-name">${escapeHtml(item.name)}</strong><dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl></div>`;
  }
  async function loadLocations() {
    const map = ensureProjectMap();
    const params = new URLSearchParams();
    if ($("#client-filter").value) params.set("client_id", $("#client-filter").value);
    try { locations = (await request(`/dashboard/locations?${params}`)).data || []; }
    catch (error) { $("#map-message").textContent = error.message; return; }
    $("#map-count").textContent = `${locations.length} located project${locations.length === 1 ? "" : "s"}`;
    if (!map) return;
    projectMarkers.clearLayers();
    locations.forEach(item => {
      L.marker([item.latitude, item.longitude], { icon: pinIcon(), title: `${item.client_name || ""} · ${item.name}`, alt: `${item.client_name || ""} · ${item.name}` })
        .bindPopup(popupHtml(item), { maxWidth: 280 }).addTo(projectMarkers);
    });
    $("#map-message").textContent = locations.length ? "" : "No project has a saved map location yet. Edit a project to add one.";
    if (locations.length) projectMap.fitBounds(L.latLngBounds(locations.map(item => [item.latitude, item.longitude])), { padding: [30, 30], maxZoom: 14 });
  }
  function renderReports() {
    $("#records-title").textContent = "Reports & exports";
    $("#table-head").innerHTML = "<tr><th>Report</th><th>File format</th><th>Action</th></tr>";
    const choices = [["Projects","projects"],["Tank cleaning","cleaning"],["Water testing","water-testing"],["Clients","clients"]];
    $("#table-body").innerHTML = choices.map(([label, value]) => `<tr><td>${label}</td><td>CSV · Excel · PDF</td><td>${["csv","xlsx","pdf"].map(format => `<a href="${api}/reports/export?resource=${value}&format=${format}" data-report="${value}" data-format="${format}">${format.toUpperCase()}</a>`).join(" · ")}</td></tr>`).join("");
  }
  async function renderSettings() {
    $("#records-title").textContent = "Settings";
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
  $("#today").onclick = () => { selectedDate = new Date(); month = new Date(); loadTasks(); };
  $("#date-filter").onchange = () => {
    const value = $("#date-filter").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
    const [year, monthNumber, day] = value.split("-").map(Number);
    selectedDate = new Date(year, monthNumber - 1, day);
    if (year !== month.getFullYear() || monthNumber - 1 !== month.getMonth()) { month = new Date(year, monthNumber - 1, 1); loadTasks(); }
    else { renderCalendar(); renderTask(); }
  };
  $("#clients-link").onclick = () => navigate("Clients");
  $("#client-filter").onchange = () => { loadTasks(); loadLocations(); };
  $("#previous-month").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); selectedDate = new Date(month); loadTasks(); };
  $("#next-month").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); selectedDate = new Date(month); loadTasks(); };
  // Wrapped so a false return never cancels the click (which would stop <details> items from expanding).
  $("#task-list").onclick = event => { handleProjectAction(event); };
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
  $("#search").oninput = () => { if (resources[page]) loadRecords(); };
  $("#table-body").onclick = async event => {
    if (handleProjectAction(event)) return;
    const addProject = event.target.closest("[data-add-project]");
    if (addProject) return openForm(null, { client_name: addProject.dataset.addProject });
    const deleteProject = event.target.closest("[data-project-delete]");
    if (deleteProject && confirm("Permanently delete this project, its project tasks, and all saved project documents? This cannot be undone.")) {
      try {
        await request(`/projects/${deleteProject.dataset.projectDelete}/permanent`, { method: "DELETE" });
        await loadRecords();
        await loadTasks();
      } catch (error) { showError(error.message); }
      return;
    }
    const edit = event.target.closest("[data-edit]"), remove = event.target.closest("[data-delete]");
    if (edit) openForm(edit.dataset.edit);
    if (remove && confirm("Archive this record? Historical records are retained.")) {
      try { await request(`/${resources[page].path}/${remove.dataset.delete}`, { method: "DELETE" }); await loadRecords(); if (["Projects", "Cleaning Records", "Water Testing"].includes(page)) loadTasks(); }
      catch (error) { showError(error.message); }
    }
    const report = event.target.closest("[data-report]");
    if (report) {
      event.preventDefault();
      try {
        const response = await fetch(report.href, { credentials: "same-origin" });
        if (!response.ok) throw new Error("Report export failed.");
        const blob = await response.blob(), link = document.createElement("a");
        link.href = URL.createObjectURL(blob); link.download = `watercare-${report.dataset.report}-report.${report.dataset.format}`; link.click(); URL.revokeObjectURL(link.href);
      } catch (error) { showError(error.message); }
    }
  };
  initialize();
})();
