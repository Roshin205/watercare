(() => {
  const $ = (selector) => document.querySelector(selector);
  const api = "/api";
  const resources = {
    Projects: { path: "projects", fields: ["name", "category", "client_id", "location", "description", "start_date", "scheduled_date", "scheduled_time", "status", "notes", "assigned_engineer_ids"], columns: ["name", "category", "status", "scheduled_date"] },
    "Cleaning Records": { path: "cleaning-records", fields: ["client_id", "site_name", "tank_identification", "tank_type", "capacity", "location", "cleaning_date", "cleaning_time", "engineer_id", "procedure", "materials_used", "observations", "status", "next_recommended_date", "notes"], columns: ["site_name", "tank_identification", "status", "cleaning_date"] },
    "Water Testing": { path: "water-testing", fields: ["client_id", "project_id", "sampling_location", "collection_date", "collection_time", "engineer_id", "water_source", "testing_category", "sample_identification", "test_parameters", "test_results", "reference_limits", "interpretation", "laboratory_details", "status", "notes"], columns: ["sample_identification", "testing_category", "status", "collection_date"] },
    Clients: { path: "clients", fields: ["name", "organization_name", "contact_person", "phone", "email", "address", "category", "notes"], columns: ["name", "contact_person", "phone", "email"] },
    Engineers: { path: "engineers", fields: ["full_name", "email", "phone", "specialization", "availability"], columns: ["full_name", "specialization", "email", "phone"] }
  };
  let csrfToken = "";
  let page = "Dashboard", selectedDate = new Date(), month = new Date();
  let tasks = [], taskIndex = 0, records = [], clients = [], engineers = [], editingId = null, currentRole = "";

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
        button.classList.toggle("hidden", !["administrator", "manager"].includes(currentRole));
      });
      $("#user-email").textContent = `${current.user.email || "Employee"} | ${current.role}`;
      await loadClients(); navigate("Dashboard");
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
      $("#client-filter").innerHTML = '<option value="">All clients</option>' + clients.map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`).join("");
    } catch (error) { showError(error.message); }
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function isoDate(dateValue) { return `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, "0")}-${String(dateValue.getDate()).padStart(2, "0")}`; }
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
      button.onclick = () => { selectedDate = new Date(y, m, day); taskIndex = 0; renderCalendar(); renderTask(); };
      calendar.append(button);
    }
  }
  function renderTask() {
    const matching = tasks.filter(task => task.scheduled_date === isoDate(selectedDate));
    taskIndex = Math.min(taskIndex, Math.max(0, matching.length - 1));
    $("#task-position").textContent = matching.length ? `${taskIndex + 1} of ${matching.length}` : "0 of 0";
    $("#task-count").textContent = matching.length ? `${matching.length} task${matching.length === 1 ? "" : "s"} on ${isoDate(selectedDate)}` : "No tasks scheduled";
    if (!matching.length) { $("#task-card").innerHTML = '<p class="empty">No scheduled work for this date.</p>'; return; }
    const task = matching[taskIndex], project = task.project || {};
    const statusControl = currentRole === "employee" && task.record_type === "task" && task.engineer_id
      ? `<label>Update task status<select id="task-status-update">${["Scheduled", "In Progress", "Completed", "On Hold", "Cancelled"].map(status => `<option ${task.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label><button id="save-task-status" class="outline">Save status</button>`
      : "";
    $("#task-card").innerHTML = `<p class="eyebrow">${escapeHtml(task.status || "Scheduled")}</p><h3>${escapeHtml(task.title)}</h3><p class="detail">${escapeHtml(project.client_name || "")} · ${escapeHtml(project.name || "")}</p><p class="detail">♙ ${escapeHtml(task.engineer_name || "Engineer not assigned")}</p><p class="detail">⌖ ${escapeHtml(task.location || project.location || "Location not set")}</p><p class="detail">◷ ${escapeHtml(task.scheduled_time || "Time not set")} · ${escapeHtml(task.scheduled_date)}</p><p class="detail">${escapeHtml(task.description || task.notes || "")}</p>${statusControl}`;
  }
  function navigate(nextPage) {
    page = nextPage; hideError();
    $("#page-title").textContent = page;
    $("#navigation").querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.page === page));
    $("#dashboard").classList.toggle("hidden", page !== "Dashboard");
    $("#records").classList.toggle("hidden", !resources[page] && page !== "Reports" && page !== "Settings");
    $("#client-filter").classList.toggle("hidden", page !== "Dashboard");
    $("#today").classList.toggle("hidden", page !== "Dashboard");
    $("#add-record").classList.toggle("hidden", !resources[page] || !["administrator", "manager"].includes(currentRole));
    if (page === "Dashboard") loadTasks();
    else if (resources[page]) loadRecords();
    else if (page === "Reports") renderReports();
    else if (page === "Settings") renderSettings();
  }
  async function loadRecords() {
    const definition = resources[page];
    $("#records-title").textContent = page;
    $("#table-head").innerHTML = `<tr>${definition.columns.map(field => `<th>${escapeHtml(field.replaceAll("_", " "))}</th>`).join("")}<th>Actions</th></tr>`;
    try {
      const query = new URLSearchParams({ limit: "200" });
      if ($("#search").value && ["Clients", "Engineers"].includes(page)) query.set("search", $("#search").value);
      const response = await request(`/${definition.path}?${query}`);
      records = response.data || [];
      const canManage = ["administrator", "manager"].includes(currentRole);
      $("#table-body").innerHTML = records.map(record => `<tr>${definition.columns.map(field => `<td>${escapeHtml(record[field])}</td>`).join("")}<td>${canManage ? `<button data-edit="${escapeHtml(record.id)}">Edit</button><button data-delete="${escapeHtml(record.id)}">Archive</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="${definition.columns.length + 1}">No records yet.</td></tr>`;
    } catch (error) { showError(error.message); }
  }
  async function openForm(id) {
    editingId = id || null;
    const definition = resources[page], existing = records.find(record => record.id === id) || {};
    if (page === "Projects") {
      try { engineers = (await request("/engineers?limit=200")).data || []; }
      catch (error) { showError(error.message); }
    }
    $("#form-title").textContent = `${id ? "Edit" : "Add"} ${page.toLowerCase().replace(/s$/, "")}`;
    $("#form-message").textContent = "";
    $("#form-fields").innerHTML = definition.fields.map(field => {
      const label = field.replaceAll("_", " ");
      let control;
      if (field === "client_id") control = `<select name="${field}" required><option value="">Choose client</option>${clients.map(client => `<option value="${escapeHtml(client.id)}" ${existing[field] === client.id ? "selected" : ""}>${escapeHtml(client.name)}</option>`).join("")}</select>`;
      else if (field === "assigned_engineer_ids") control = `<select name="${field}" multiple size="3">${engineers.map(engineer => `<option value="${escapeHtml(engineer.id)}" ${existing[field]?.includes(engineer.id) ? "selected" : ""}>${escapeHtml(engineer.full_name)}</option>`).join("")}</select>`;
      else if (["description", "notes", "address", "observations", "procedure", "materials_used", "test_parameters", "test_results", "reference_limits", "interpretation", "laboratory_details"].includes(field)) control = `<textarea name="${field}">${escapeHtml(existing[field] || "")}</textarea>`;
      else if (field === "status") {
        const choices = page === "Projects" ? ["Planned", "Scheduled", "In Progress", "Completed", "On Hold", "Cancelled"] : ["Scheduled", "In Progress", "Completed", "Overdue", "Cancelled"];
        control = `<select name="${field}"><option value="">Choose status</option>${choices.map(choice => `<option ${existing[field] === choice ? "selected" : ""}>${choice}</option>`).join("")}</select>`;
      } else {
        const type = field.endsWith("_date") || field === "cleaning_date" || field === "collection_date" ? "date" : field.endsWith("_time") ? "time" : "text";
        control = `<input name="${field}" type="${type}" value="${escapeHtml(existing[field] || "")}" ${definition.fields.includes(field) && (field === "name" || field === "full_name" || field === "client_id" || field.endsWith("_date")) ? "required" : ""}>`;
      }
      return `<label class="${["description", "notes", "address", "observations", "procedure", "materials_used", "test_parameters", "test_results", "reference_limits", "interpretation", "laboratory_details"].includes(field) ? "wide" : ""}">${escapeHtml(label)}${control}</label>`;
    }).join("");
    $("#record-dialog").showModal();
  }
  async function saveRecord(event) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    if (page === "Projects") values.assigned_engineer_ids = formData.getAll("assigned_engineer_ids");
    Object.keys(values).forEach(key => { if (values[key] === "") delete values[key]; });
    try {
      await request(`/${resources[page].path}${editingId ? `/${editingId}` : ""}`, { method: editingId ? "PATCH" : "POST", body: JSON.stringify(values) });
      $("#record-dialog").close(); await loadRecords(); await loadClients();
      if (["Projects", "Cleaning Records", "Water Testing"].includes(page)) loadTasks();
    } catch (error) { $("#form-message").textContent = error.message; }
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
  $("#today").onclick = () => { selectedDate = new Date(); month = new Date(); taskIndex = 0; loadTasks(); };
  $("#clients-link").onclick = () => navigate("Clients");
  $("#client-filter").onchange = () => { taskIndex = 0; loadTasks(); };
  $("#previous-month").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); selectedDate = new Date(month); taskIndex = 0; loadTasks(); };
  $("#next-month").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); selectedDate = new Date(month); taskIndex = 0; loadTasks(); };
  $("#previous-task").onclick = () => { const matching = tasks.filter(task => task.scheduled_date === isoDate(selectedDate)); if (matching.length) { taskIndex = (taskIndex - 1 + matching.length) % matching.length; renderTask(); } };
  $("#next-task").onclick = () => { const matching = tasks.filter(task => task.scheduled_date === isoDate(selectedDate)); if (matching.length) { taskIndex = (taskIndex + 1) % matching.length; renderTask(); } };
  $("#task-card").onclick = async event => {
    if (!event.target.closest("#save-task-status")) return;
    const selected = tasks.filter(task => task.scheduled_date === isoDate(selectedDate))[taskIndex];
    try {
      await request(`/project_tasks/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: $("#task-status-update").value })
      });
      await loadTasks();
    } catch (error) { showError(error.message); }
  };
  $("#add-record").onclick = () => openForm();
  $("#close-dialog").onclick = () => $("#record-dialog").close();
  $("#record-form").onsubmit = saveRecord;
  $("#search").oninput = () => { if (resources[page]) loadRecords(); };
  $("#table-body").onclick = async event => {
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
