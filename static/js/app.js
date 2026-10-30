(() => {
  const $ = (selector) => document.querySelector(selector);
  const places = window.WaterCarePlaces;
  const hub = window.WolganHub;  // the Operations pages (static/js/hub/)
  const api = "/api";
  // Service Coordinators and Accountants (and the account-owning Administrator) can edit and approve; everyone else views.
  const EDITOR_ROLES = ["administrator", "service_coordinator", "accountant"];
  const ROLE_LABELS = { administrator: "Administrator", service_coordinator: "Service Coordinator", accountant: "Accountant", employee: "Staff", viewer: "Viewer" };
  let csrfToken = "", loginType = "admin", markerById = {}, currentUser = {};
  // Settings > Display (the user's own choice, else the company's) and the company details from Settings > Company.
  let prefs = { date_format: "YYYY-MM-DD", time_format: "24h", time_zone: "" }, company = {};
  const DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"];
  const DEV_CONTACT = "https://mail.google.com/mail/?view=cm&fs=1&to=devroshinvp@gmail.com&su=Wolgan%20website%20enquiry";
  let page = "Dashboard", selectedDate = new Date(), month = new Date(), dayMode = false;
  let tasks = [], clients = [], locations = [], allLocations = [], services = [], currentRole = "", filterTimer = null;
  let projectMap = null, projectMarkers = null, pickerMap = null, basemapStyle = null;
  const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
  const BASEMAP_ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
  const STATUS_LABELS = { pending: "Due", "pending-approval": "Pending Approval", approved: "Visit Done", rejected: "Rejected" };
  const WORK_TYPES = ["Site visit", "Lab sample"];

  const canEdit = () => EDITOR_ROLES.includes(currentRole);
  const isStaff = () => currentRole === "employee";

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
  function showNotice(message) { showError(message); $("#notice").classList.remove("error"); }
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
      currentUser = current.user;
      $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
      currentRole = current.role;
      if (isStaff()) {
        // Staff get "Work Assigned To You" with the same map inside it, instead of the separate map panel.
        const panel = $("#assigned-panel"), slot = $("#assigned-map-slot"), mapPanel = document.querySelector(".map-panel");
        panel.classList.remove("hidden"); $("#dashboard").classList.add("has-assigned");
        slot.append($("#project-map"), $("#map-legend"), $("#map-message"));
        mapPanel.classList.add("hidden");
        $("#client-filter").classList.add("hidden");
      }
      showUserLabel();
      await hub.start(hubBridge);
      await Promise.all([loadPreferences(), loadClients(), loadServices()]);
      navigate("Dashboard"); hub.openLink();
    } catch (error) {
      csrfToken = "";
      $("#app").classList.add("hidden"); $("#login").classList.remove("hidden");
      $("#login-message").textContent = error.message;
    }
  }
  function showUserLabel() {
    $("#user-email").textContent = `${currentUser.full_name || currentUser.email || "Employee"} | ${ROLE_LABELS[currentRole] || currentRole}`;
  }
  async function loadPreferences() {
    try {
      const settings = await request("/settings");
      const organization = settings.organization || {}, mine = settings.user || {};
      company = organization;
      prefs = {
        date_format: mine.date_format || organization.date_format || "YYYY-MM-DD",
        time_format: mine.time_format || organization.time_format || "24h",
        time_zone: mine.time_zone || "",  // blank: this device's time zone
      };
    } catch (error) { showError(error.message); }
    renderSupport();
  }
  function renderSupport() {
    const phone = company.support_phone || "", email = company.support_email || "", box = $("#support-box");
    box.classList.toggle("hidden", !phone && !email);
    box.innerHTML = `<b>Need help?</b>${phone ? `<a href="tel:${escapeHtml(phone.replace(/[^0-9+]/g, ""))}">${escapeHtml(phone)}</a>` : ""}${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : ""}`;
  }
  async function loadClients() {
    if (isStaff()) return;
    try {
      clients = (await request("/clients")).data || [];
      const selected = $("#client-filter").value;
      $("#client-filter").innerHTML = '<option value="">All clients</option>' + clients.map(client => `<option value="${escapeHtml(client.id)}">${escapeHtml(client.name)}</option>`).join("");
      $("#client-filter").value = clients.some(client => client.id === selected) ? selected : "";
    } catch (error) { showError(error.message); }
  }
  async function loadServices() {
    const selected = $("#project-filter").value;
    try { if (!isStaff()) services = (await request("/services")).data || []; }
    catch (error) { showError(error.message); }
    $("#project-filter").innerHTML = '<option value="">All work types</option>' + [...WORK_TYPES, ...services.map(service => service.name)].map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("");
    $("#project-filter").value = selected;
  }
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function slug(value) { return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
  function isoDate(dateValue) { return `${dateValue.getFullYear()}-${String(dateValue.getMonth() + 1).padStart(2, "0")}-${String(dateValue.getDate()).padStart(2, "0")}`; }
  function showDate(value, format = prefs.date_format) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
    if (!match) return value || "";
    const [, year, monthNumber, day] = match;
    return { "DD/MM/YYYY": `${day}/${monthNumber}/${year}`, "MM/DD/YYYY": `${monthNumber}/${day}/${year}` }[format] || `${year}-${monthNumber}-${day}`;
  }
  function showTime(value) {
    const match = /^(\d{1,2}):(\d{2})/.exec(value || "");
    if (!match || prefs.time_format !== "12h") return value || "";
    const hour = Number(match[1]);
    return `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
  }
  function formatDateTime(value) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value || "";
    let parts;
    try {
      parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        ...(prefs.time_zone ? { timeZone: prefs.time_zone } : {}),
      }).formatToParts(parsed);
    } catch { return parsed.toLocaleString(); }  // a time zone this browser does not know
    const part = Object.fromEntries(parts.map(({ type, value: text }) => [type, text]));
    return `${showDate(`${part.year}-${part.month}-${part.day}`)} ${showTime(`${part.hour}:${part.minute}`)}`;
  }
  function dayHeading(value) {
    if (!value) return "No date set";
    const [year, monthNumber, day] = value.split("-").map(Number);
    return new Date(year, monthNumber - 1, day).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function filterValues() {
    return { search: $("#search-filter").value.trim(), client: $("#client-filter").value, project: $("#project-filter").value };
  }
  function textMatches(parts, search) {
    return !search || parts.filter(part => part != null).join(" ").toLowerCase().includes(search.toLowerCase());
  }

  // ---- Dashboard: site visits and lab samples on the calendar and overview ---------------------------------------
  async function loadTasks() {
    const first = new Date(month.getFullYear(), month.getMonth(), 1), last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    try { tasks = await hub.calendarItems(isoDate(first), isoDate(last), $("#client-filter").value); }
    catch (error) { showError(error.message); tasks = []; }
    renderCalendar(); renderOverview();
  }
  function refreshDashboard() { loadTasks(); loadLocations(); if (isStaff()) hub.drawAssigned($("#assigned-list"), $("#assigned-count")).catch(error => showError(error.message)); }
  function selectDay(value) {
    const [year, monthNumber, day] = value.split("-").map(Number);
    selectedDate = new Date(year, monthNumber - 1, day); dayMode = true;
    if (year !== month.getFullYear() || monthNumber - 1 !== month.getMonth()) { month = new Date(year, monthNumber - 1, 1); loadTasks(); }
    else { renderCalendar(); renderOverview(); }
    applyMapFilters();
  }
  function showAllDates() {
    dayMode = false; $("#date-filter").value = "";
    renderCalendar(); renderOverview(); applyMapFilters();
  }
  function shownTasks() {
    const { search, project } = filterValues();
    return tasks.filter(task => !project || task.project?.service === project || (project === "Site visit" && task.record_type === "visit") || (project === "Lab sample" && task.record_type === "sample"))
      .filter(task => textMatches([task.title, task.location, task.description, task.engineer_name, task.status, task.project?.client_name, task.project?.name, task.project?.so_no, task.project?.service, task.approval], search));
  }
  function renderCalendar() {
    const calendar = $("#calendar"), y = month.getFullYear(), m = month.getMonth(), shown = shownTasks();
    $("#month-label").textContent = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    calendar.innerHTML = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(day => `<span class="weekday">${day}</span>`).join("");
    const offset = (new Date(y, m, 1).getDay() + 6) % 7, count = new Date(y, m + 1, 0).getDate();
    for (let i = 0; i < offset; i++) calendar.insertAdjacentHTML("beforeend", '<span class="calendar-empty" aria-hidden="true"></span>');
    for (let day = 1; day <= count; day++) {
      const value = isoDate(new Date(y, m, day)), work = shown.filter(task => task.scheduled_date === value);
      const button = document.createElement("button");
      button.className = `day${value === isoDate(new Date()) ? " today" : ""}${dayMode && value === isoDate(selectedDate) ? " selected" : ""}${work.length ? " has-projects" : ""}`;
      button.dataset.date = value;
      button.innerHTML = `<span class="day-number">${day}</span><span class="calendar-day-projects">${work.slice(0, 3).map(task => `<span class="calendar-day-project is-${task.record_type}" title="${escapeHtml(`${task.title} · ${task.status}`)}">${escapeHtml(task.project.name)}</span>`).join("")}${work.length > 3 ? `<span class="calendar-more">+${work.length - 3} more</span>` : ""}</span>`;
      button.setAttribute("aria-label", `${value}${work.length ? `, ${work.map(task => task.title).join(", ")}` : ""}`);
      button.onclick = () => selectDay(value);
      calendar.append(button);
    }
  }
  function renderOverview() {
    const date = dayMode ? isoDate(selectedDate) : "", heading = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const shown = shownTasks().filter(task => !date || task.scheduled_date === date);
    if (date) $("#date-filter").value = date;
    $("#task-count").textContent = date
      ? (shown.length ? `Work for ${dayHeading(date)}. Choose "All dates" to see the whole month.` : `No work matches ${dayHeading(date)}.`)
      : (shown.length ? `All work in ${heading}${canEdit() ? ". Drag a visit onto a calendar date to move it" : ""}.` : "No work matches these filters.");
    let previousDay = null;
    $("#task-list").innerHTML = shown.map(task => {
      const headingRow = task.scheduled_date !== previousDay ? `<h3 class="date-heading">${escapeHtml(dayHeading(task.scheduled_date))}</h3>` : "";
      previousDay = task.scheduled_date;
      return headingRow + taskItem(task);
    }).join("") || '<p class="empty">No work to show.</p>';
    $("#task-position").textContent = `${shown.length} item${shown.length === 1 ? "" : "s"}`;
  }
  function taskItem(task) {
    const project = task.project || {}, id = escapeHtml(task.id), visit = task.record_type === "visit";
    const details = [
      ["Service", project.service],
      ["Engineer", task.engineer_name || "Engineer not assigned"],
      ["Location", task.location || "Location not set"],
      ["Time", showTime(task.scheduled_time)],
      ["SO No", project.so_no],
      ["Completion", task.completion?.timing],
      ["Actual completion date", showDate(task.completion?.date)],
      ["Rejection reason", task.approval === "Rejected" ? task.rejection_reason : ""],
      ["Details", task.description],
    ].filter(([, value]) => value !== undefined && value !== null && value !== "");
    const movable = canEdit() && visit && task.status === "Due";
    const actions = [
      ...(isStaff() ? [] : [`<button class="outline" data-site-sheet="${escapeHtml(task.contract_id)}">Open Project Sheet</button>`]),
      `<button class="outline" data-locate="${escapeHtml(task.contract_id)}">Tap To Know The Location</button>`,
      ...(visit ? [hub.completionButton(task)] : []),
    ].join("");
    return `<details class="task-item"${movable ? ` data-visit="${id}"` : ""}><summary><span class="task-names"><strong>${escapeHtml(project.client_name || "Client not set")}</strong><strong>${escapeHtml(project.name || task.title)}</strong></span><span class="task-meta"><span class="status-badge">${escapeHtml(visit ? task.status : task.title.split(" · ")[0])}</span>${task.approval ? `<span class="status-badge approval-${slug(task.approval)}">${escapeHtml(task.approval)}</span>` : ""}${task.scheduled_time ? `<span class="task-time">${escapeHtml(showTime(task.scheduled_time))}</span>` : ""}</span></summary><dl class="task-details">${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><div class="header-actions task-actions">${actions}</div></details>`;
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
  async function moveVisit(id, date) {
    const task = tasks.find(item => item.id === id);
    if (!task || task.scheduled_date === date) return;
    try {
      await request(`/hub/contracts/${encodeURIComponent(task.contract_id)}/schedule`, { method: "POST", body: JSON.stringify({ month: task.month, date, move_to: date.slice(0, 7) }) });
      showNotice(`Visit to ${task.project.name} moved to ${showDate(date)}.`); refreshDashboard();
    } catch (error) { showError(error.message); }
  }
  function enableCalendarScheduling(container) {
    let active = null, suppressedClick = false;
    container.addEventListener("pointerdown", event => {
      const item = event.target.closest(".task-item[data-visit]");
      if (!item || event.pointerType === "touch" || event.target.closest("button, a, input, select, textarea")) return;
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
        if (day) moveVisit(current.item.dataset.visit, day.dataset.date);
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

  // ---- Pages ---------------------------------------------------------------------------------------------------
  function resetFilters() {
    ["#search-filter", "#client-filter", "#project-filter", "#date-filter"].forEach(id => { $(id).value = ""; });
    dayMode = false;
  }
  function markMenu() {
    $("#navigation").querySelectorAll("button").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  }
  function navigate(nextPage) {
    if (nextPage !== "Dashboard" && !hub.has(nextPage)) return;
    if (isStaff() && !["Dashboard", "Settings"].includes(nextPage)) return;
    if (nextPage !== page) resetFilters();
    page = nextPage; hideError();
    const dashboard = page === "Dashboard";
    $("#page-title").textContent = page;
    markMenu();
    $("#dashboard").classList.toggle("hidden", !dashboard);
    $("#filter-bar").classList.toggle("hidden", !dashboard);
    $("#hub-page").classList.toggle("hidden", dashboard);
    $("#hub-overview").classList.add("hidden"); $("#hub-figures").classList.add("hidden");
    if (dashboard) { hub.clearPage(); refreshDashboard(); hub.showOverview(); }
    else hub.show(page);
    syncMobileTabs(); updateFilterToggle();
  }
  function applyFilters() {
    updateFilterToggle();
    loadLocations(); loadTasks();
  }

  // ---- Map ------------------------------------------------------------------------------------------------------
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
  function locationPicker() {
    return `<div class="wide location-picker"><span>Map Location</span><p class="picker-help">Search on the map and apply a suggestion, or click the map to drop a pin and drag it to the exact spot. You can also type or paste coordinates.</p><div class="picker-shell"><div id="location-picker-map" class="picker-map" role="application" aria-label="Click the map to place the project pin"></div><div class="map-search floating"><input name="location_search" type="search" placeholder="Search a place, address or coordinates" autocomplete="off" aria-label="Search map location" aria-controls="map-search-results"><button type="button" id="map-search-button" class="outline">Search</button><ul id="map-search-results" class="map-results" aria-live="polite"></ul></div></div><div class="coordinate-inputs"><label>Latitude<input name="latitude" type="number" step="any" min="-90" max="90" placeholder="e.g. 25.285400"></label><label>Longitude<input name="longitude" type="number" step="any" min="-180" max="180" placeholder="e.g. 51.531000"></label><button type="button" id="clear-location" class="text-button">Clear location</button></div><p id="picker-status" class="picker-status"></p></div>`;
  }
  function initLocationPicker(existing, root = $("#form-fields")) {
    const field = name => root.querySelector(`[name="${name}"]`);
    const status = root.querySelector("#picker-status"), latitude = field("latitude"), longitude = field("longitude"), search = field("location_search");
    const results = root.querySelector("#map-search-results"), locationInput = field("location");
    if (pickerMap) { pickerMap.remove(); pickerMap = null; }
    if (existing.latitude != null && existing.longitude != null) { latitude.value = Number(existing.latitude).toFixed(6); longitude.value = Number(existing.longitude).toFixed(6); }
    if (!window.L) { status.textContent = "The map could not load. You can still type the coordinates, and the rest of the project saves."; return; }
    pickerMap = L.map(root.querySelector("#location-picker-map"), { scrollWheelZoom: true, zoomControl: false, minZoom: 2, maxZoom: 19 });
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
    root.querySelector("#clear-location").onclick = clear;
    root.querySelector("#map-search-button").onclick = () => runSearch(true);
    search.oninput = () => { clearTimeout(typingTimer); typingTimer = setTimeout(() => runSearch(false), 450); };
    search.onkeydown = event => {
      if (event.key === "Enter") { event.preventDefault(); runSearch(true); }
      if (event.key === "Escape" && suggestions.length) { event.preventDefault(); clearSuggestions(); }
    };
    results.onclick = event => { const choice = event.target.closest("[data-place]"); if (choice) apply(Number(choice.dataset.place)); };
    latitude.onchange = typedCoordinates; longitude.onchange = typedCoordinates;
    setTimeout(() => pickerMap?.invalidateSize(), 60);
  }
  function locateSite(contractId) {
    const marker = markerById[contractId];
    if (!marker || !projectMap) { showError("This site has no map location yet. Edit the contract to add one."); return; }
    hideError();
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
    const key = statusKey(item);
    const rows = [
      ["Engineer", item.engineer_name],
      ["Service", item.service],
      ["Next Visit", showDate(item.next_due)],
      ["Details", item.system_details],
      ["Location", item.location || `${Number(item.latitude).toFixed(5)}, ${Number(item.longitude).toFixed(5)}`],
    ].filter(([, value]) => value);
    const action = isStaff() ? "" : `<button type="button" class="primary map-card-action" data-site-sheet="${escapeHtml(item.id)}">Open Project Sheet</button>`;
    return `<div class="map-card"><strong class="map-card-client">${escapeHtml(item.client_name || "Client not set")}</strong><strong class="map-card-project">${escapeHtml(item.name)}</strong><div class="map-card-badges"><span class="status-badge approval-${key}">${escapeHtml(STATUS_LABELS[key])}</span></div><dl class="map-card-details">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>${action}</div>`;
  }
  function renderLegend() {
    const counts = locations.reduce((totals, item) => ({ ...totals, [statusKey(item)]: (totals[statusKey(item)] || 0) + 1 }), {});
    $("#map-legend").innerHTML = locations.length ? Object.keys(STATUS_LABELS).map(key => `<span class="legend-item"><span class="legend-dot status-${key}"></span>${escapeHtml(STATUS_LABELS[key])}<b>${counts[key] || 0}</b></span>`).join("") : "";
  }
  async function loadLocations() {
    try { allLocations = await hub.siteLocations($("#client-filter").value); }
    catch (error) { $("#map-message").textContent = error.message; return; }
    applyMapFilters();
  }
  function applyMapFilters() {
    const map = ensureProjectMap(), { search, project } = filterValues(), day = dayMode ? isoDate(selectedDate) : "";
    locations = allLocations.filter(item => (!project || WORK_TYPES.includes(project) || item.service === project)
      && textMatches([item.client_name, item.name, item.engineer_name, item.location, item.service, item.so_no, item.system_details, item.approval_status], search)
      && (!day || tasks.some(task => task.contract_id === item.id && task.scheduled_date === day)));
    $("#map-count").textContent = `${locations.length} located site${locations.length === 1 ? "" : "s"}`;
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
      : allLocations.length ? "No located sites match these filters." : "No site has a saved map location yet. Edit a contract to add one.";
    fitProjects();
  }

  // ---- Settings -------------------------------------------------------------------------------------------------
  function choiceOptions(choices, chosen) {
    return choices.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === chosen ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
  }
  function timeZoneOptions(chosen) {
    let zones;
    try { zones = Intl.supportedValuesOf("timeZone"); } catch { zones = ["UTC"]; }
    if (chosen && !zones.includes(chosen)) zones = [chosen, ...zones];
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
    return choiceOptions([["", `Automatic (this device: ${device})`], ...zones.map(zone => [zone, zone.replaceAll("_", " ")])], chosen);
  }
  function drawSettings(host) {
    const today = isoDate(new Date()), saved = message => showNotice(message);
    host.innerHTML = `<div id="settings-page">
      <section class="cert-section"><h3>My Account</h3>
        <form id="settings-name" class="cert-row"><label>Your name<input name="full_name" maxlength="255" required value="${escapeHtml(currentUser.full_name || "")}"></label>
        <label>Email<input value="${escapeHtml(currentUser.email || "")}" disabled></label>
        <button class="primary" type="submit">Save name</button></form>${hub.myPictureField()}</section>
      ${currentRole === "administrator" ? `<section class="cert-section"><h3>Company</h3>
        <p class="hint">The company name goes at the top of exported reports. The support phone and email appear for everyone under "Need help?" in the menu.</p>
        <form id="settings-company" class="cert-row"><label>Company name<input name="name" maxlength="255" value="${escapeHtml(company.name || "")}"></label>
        <label>Support phone<input name="support_phone" type="tel" maxlength="40" value="${escapeHtml(company.support_phone || "")}"></label>
        <label>Support email<input name="support_email" type="email" maxlength="320" value="${escapeHtml(company.support_email || "")}"></label>
        <button class="primary" type="submit">Save company details</button></form></section>` : ""}
      <section class="cert-section"><h3>Display</h3>
        <p class="hint">How dates and times appear for you on every page and in the reports you export.</p>
        <form id="settings-display" class="cert-row">
        <label>Date format<select name="date_format">${choiceOptions(DATE_FORMATS.map(format => [format, `${showDate(today, format)} (${format})`]), prefs.date_format)}</select></label>
        <label>Time format<select name="time_format">${choiceOptions([["24h", "24-hour (14:30)"], ["12h", "12-hour (2:30 PM)"]], prefs.time_format)}</select></label>
        <label>Time zone<select name="time_zone">${timeZoneOptions(prefs.time_zone)}</select></label>
        <button class="primary" type="submit">Save display</button></form></section>
      <section class="cert-section"><h3>About</h3>
        <p>Wolgan · Website created by <b>Roshin VP</b></p>
        <p>For any request or enquiries: <a class="contact-dev" href="${escapeHtml(DEV_CONTACT)}" target="_blank" rel="noopener">devroshinvp@gmail.com</a></p></section>
    </div>`;
    const values = form => Object.fromEntries(new FormData(form).entries());
    host.querySelector("#settings-name").onsubmit = async event => {
      event.preventDefault();
      try {
        currentUser.full_name = (await request("/hub/me/profile", { method: "PATCH", body: JSON.stringify(values(event.currentTarget)) })).data.full_name;
        showUserLabel(); saved("Name saved.");
      } catch (error) { showError(error.message); }
    };
    const companyForm = host.querySelector("#settings-company");
    if (companyForm) companyForm.onsubmit = async event => {
      event.preventDefault();
      const details = values(event.currentTarget);
      try {
        await request("/settings", { method: "PATCH", body: JSON.stringify({ organization: details }) });
        Object.assign(company, details); renderSupport(); saved("Company details saved.");
      } catch (error) { showError(error.message); }
    };
    host.querySelector("#settings-display").onsubmit = async event => {
      event.preventDefault();
      const display = values(event.currentTarget);
      try {
        await request("/settings", { method: "PATCH", body: JSON.stringify({ user: display }) });
        prefs = { ...prefs, ...display }; saved("Display saved. Dates and times now follow it.");
      } catch (error) { showError(error.message); }
    };
    hub.renderSettings(host.querySelector("#settings-page"));
  }

  // ---- Sign-in, menu and phones ---------------------------------------------------------------------------------
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
    $("#login-hint").textContent = type === "admin" ? "Admin login needs your email, password and private key." : "Staff login needs only your email and password.";
    $("#login-message").textContent = "";
  }
  document.querySelectorAll(".login-tabs button").forEach(tab => { tab.onclick = () => chooseLoginType(tab.dataset.loginType); });
  $("#forgot").onclick = () => {
    $("#login-message").textContent = "Contact your Wolgan administrator to reset your password.";
  };
  $("#logout").onclick = async () => {
    try { await request("/auth/logout", { method: "POST" }); }
    finally { csrfToken = ""; location.reload(); }
  };
  $("#navigation").onclick = event => {
    const action = event.target.closest("[data-action]"), button = event.target.closest("[data-page]");
    if (action || button) setNavOpen(false);
    if (action) hub.openContractForm(null, { done: () => navigate("AMC & Site Visits") });
    else if (button) navigate(button.dataset.page);
  };
  // Phones: the sidebar slides in from the left, and a tab bar at the bottom mirrors the most used pages.
  function setNavOpen(open) {
    document.body.classList.toggle("nav-open", open);
    $("#nav-toggle").setAttribute("aria-expanded", String(open));
    $("#nav-backdrop").hidden = !open;
  }
  function syncMobileTabs() {
    $("#mobile-title").textContent = page;
    $("#mobile-tabs").querySelectorAll("[data-tab-page], [data-tab-action]").forEach(tab => {
      const source = tab.dataset.tabPage
        ? $(`#navigation [data-page="${tab.dataset.tabPage}"]`) : $(`#navigation [data-action="${tab.dataset.tabAction}"]`);
      tab.classList.toggle("hidden", !source || source.classList.contains("hidden"));
      tab.classList.toggle("active", tab.dataset.tabPage === page);
    });
  }
  $("#nav-toggle").onclick = () => setNavOpen(!document.body.classList.contains("nav-open"));
  $("#nav-backdrop").onclick = () => setNavOpen(false);
  document.addEventListener("keydown", event => { if (event.key === "Escape") setNavOpen(false); });
  $("#mobile-tabs").onclick = event => {
    const tab = event.target.closest("button");
    if (!tab) return;
    if ("tabMenu" in tab.dataset) { setNavOpen(true); return; }
    const source = tab.dataset.tabPage ? $(`#navigation [data-page="${tab.dataset.tabPage}"]`) : $(`#navigation [data-action="${tab.dataset.tabAction}"]`);
    source?.click();
  };
  function updateFilterToggle() {
    const values = filterValues();
    const count = [values.client, values.project, $("#date-filter").value].filter(Boolean).length;
    $("#filter-toggle").textContent = count ? `Filters (${count})` : "Filters";
  }
  $("#filter-toggle").onclick = () => {
    const open = $("#filter-bar").classList.toggle("filters-open");
    $("#filter-toggle").setAttribute("aria-expanded", String(open));
  };
  $("#today").onclick = () => selectDay(isoDate(new Date()));
  $("#all-dates").onclick = showAllDates;
  $("#date-filter").onchange = () => {
    const value = $("#date-filter").value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) selectDay(value);
    else if (!value) showAllDates();
  };
  $("#search-filter").oninput = () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilters, 300); };
  ["#client-filter", "#project-filter"].forEach(id => { $(id).onchange = applyFilters; });
  $("#clear-filters").onclick = () => { resetFilters(); applyFilters(); };
  enableCalendarScheduling($("#task-list"));
  $("#previous-month").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); loadTasks(); };
  $("#next-month").onclick = () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); loadTasks(); };
  document.addEventListener("click", event => {
    const sheet = event.target.closest("[data-site-sheet]"), locate = event.target.closest("[data-locate]"), complete = event.target.closest("[data-complete]");
    if (sheet) { projectMap?.closePopup(); hub.openSheet(sheet.dataset.siteSheet, refreshDashboard); }
    if (locate) locateSite(locate.dataset.locate);
    if (complete) hub.openVisitCompletion(tasks.find(task => task.id === complete.dataset.complete) || hub.findAssigned(complete.dataset.complete), refreshDashboard);
  });
  // Every password box gets a show/hide eye, including ones the page creates later (such as the staff login form).
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
  // On phones each table row becomes a card, so every cell carries its column name to show beside the value.
  function labelTableCells() {
    document.querySelectorAll("table").forEach(table => {
      const heads = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
      table.querySelectorAll("tbody tr").forEach(row => {
        let column = 0;
        [...row.children].forEach(cell => {
          if (cell.tagName === "TD" && !cell.hasAttribute("data-label")) cell.dataset.label = cell.colSpan > 1 ? "" : heads[column] || "";
          column += cell.colSpan || 1;
        });
      });
    });
  }
  let domWorkPending = false;
  const afterDomChange = () => {
    if (domWorkPending) return;
    domWorkPending = true;
    setTimeout(() => { domWorkPending = false; addPasswordToggles(); labelTableCells(); }, 0);
  };
  addPasswordToggles();
  new MutationObserver(afterDomChange).observe(document.body, { childList: true, subtree: true });
  const hubBridge = {
    request, showError, showNotice, showDate, isoDate, navigate, canEdit, markMenu, formatDateTime, loadServices, drawSettings, refreshDashboard,
    role: () => currentRole, page: () => page, csrf: () => csrfToken, company: () => company,
    services: () => services, locationPickerHtml: locationPicker, initPicker: initLocationPicker,
  };
  initialize();
})();
