// Shared parts of the Operations pages: API calls, tables, filters, forms, popups, files and downloads.
// Each section (amc.js, samples.js, ...) registers a page here with H.page(); app.js shows it when its menu button is pressed.
// Everything is drawn with the site's own classes (.panel, .filter-bar, .table-wrap, .status-badge, .form-grid).
window.WolganHub = (() => {
  let app = null, showing = 0;
  const pages = {};
  const H = {
    settings: {}, ui: {}, sections: [], canEdit: false, identity: false, role: "", current: "",
    editors: {},  // record type -> function that opens its edit form, for the top search and shared links
  };
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  H.esc = esc;
  H.page = (name, definition) => { pages[name] = definition; };
  H.has = name => Boolean(pages[name]);
  H.date = value => app.showDate(value);
  H.app = () => app;

  // ---- Server ------------------------------------------------------------------------------------------------------
  H.api = (path, options) => app.request(`/hub${path}`, options);
  H.post = (path, body) => H.api(path, { method: "POST", body: JSON.stringify(body || {}) });
  H.patch = (path, body) => H.api(path, { method: "PATCH", body: JSON.stringify(body) });
  H.put = (path, body) => H.api(path, { method: "PUT", body: JSON.stringify(body) });
  H.del = path => H.api(path, { method: "DELETE" });
  H.list = async (collection, query = "") => (await H.api(`/${collection}${query}`)).data || [];
  H.save = (collection, id, values) => id ? H.patch(`/${collection}/${id}`, values) : H.post(`/${collection}`, values);
  H.upload = (path, fields) => {
    const body = new FormData();
    Object.entries(fields).forEach(([key, value]) => body.append(key, value));
    return H.api(path, { method: "POST", body });
  };
  async function saveBlob(response, fallback) {
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error?.message || `Download failed (${response.status}).`);
    }
    const named = /filename="?([^";]+)"?/.exec(response.headers.get("content-disposition") || "");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await response.blob());
    link.download = named ? named[1] : fallback;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  }
  H.downloadPost = async (path, body, fallback) => saveBlob(await fetch(`/api/hub${path}`, {
    method: "POST", credentials: "same-origin", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "X-CSRF-Token": app.csrf() },
  }), fallback);
  H.downloadGet = async (path, fallback) => saveBlob(await fetch(`/api/hub${path}`, { credentials: "same-origin" }), fallback);

  // ---- Dates and numbers -------------------------------------------------------------------------------------------
  H.today = () => app.isoDate(new Date());
  H.monthKey = value => String(value || "").slice(0, 7);
  H.thisMonth = () => H.monthKey(H.today());
  H.shiftMonth = (month, count) => {
    const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + count;
    return `${String(Math.floor(total / 12)).padStart(4, "0")}-${String(total % 12 + 1).padStart(2, "0")}`;
  };
  H.monthsBetween = (from, to) => {
    const months = [];
    for (let month = from; month <= to && months.length < 36; month = H.shiftMonth(month, 1)) months.push(month);
    return months;
  };
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  H.monthNames = MONTH_NAMES;
  H.monthLabel = month => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(2, 4)}`;
  H.addDays = (value, days) => { const day = new Date(`${value}T00:00:00`); day.setDate(day.getDate() + days); return app.isoDate(day); };
  H.addMonths = (value, months) => {
    const [year, month, day] = value.split("-").map(Number), last = new Date(year, month - 1 + months + 1, 0).getDate();
    return app.isoDate(new Date(year, month - 1 + months, Math.min(day, last)));
  };
  H.daysLeft = value => value ? Math.round((new Date(`${value}T00:00:00`) - new Date(`${H.today()}T00:00:00`)) / 86400000) : null;
  H.number = value => Number(value) || 0;
  H.money = value => H.number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });

  // ---- Small pieces of page ----------------------------------------------------------------------------------------
  const TONES = { green: "approval-approved", amber: "approval-submitted-for-approval", red: "approval-rejected", grey: "approval-pending", blue: "" };
  H.badge = (text, tone = "") => `<span class="status-badge ${TONES[tone] ?? ""}">${esc(text)}</span>`;
  // Days-left badge: red once passed, amber inside the warning window, green otherwise.
  H.dueBadge = (value, { warn = 60, late = "Expired" } = {}) => {
    const left = H.daysLeft(value);
    if (left === null) return "";
    if (left < 0) return H.badge(`${late} ${-left}d`, "red");
    return H.badge(left <= warn ? `${left}d left` : `${left}d`, left <= warn ? "amber" : "green");
  };
  H.safeLink = url => /^https?:\/\//i.test(url || "") ? url : `https://www.google.com/maps/search/${encodeURIComponent(url || "")}`;
  H.mapLink = row => {
    const link = row.map_link || (row.latitude !== undefined && row.latitude !== "" && row.latitude !== null ? `https://www.google.com/maps?q=${row.latitude},${row.longitude}` : "");
    return link ? `<a href="${esc(H.safeLink(link))}" target="_blank" rel="noopener">Open Map</a>` : "";
  };
  H.contactLine = row => `<span class="hub-contact">${[esc(row.contact), row.mobile ? `<a href="tel:${esc(row.mobile)}">${esc(row.mobile)}</a>` : "", esc(row.alternate), H.mapLink(row)].filter(Boolean).join(" · ") || "No contact details"}</span>`;
  // Headings and labels start every word with a capital, the same as the rest of the site.
  const titleCase = text => String(text).replace(/(^|[\s/(])([a-z])/g, (_, before, letter) => before + letter.toUpperCase());
  H.stats = cards => `<div class="hub-summary">${cards.map(card => `<div class="hub-figure ${card.tone || ""}${card.filter ? " link" : ""}"${card.filter ? ` data-stat="${esc(card.filter)}" role="button" tabindex="0"` : ""}><span>${esc(titleCase(card.label))}</span><strong>${esc(card.value)}</strong></div>`).join("")}</div>`;
  H.notice = (message, isError = false) => {
    if (isError) return app.showError(message);
    app.showNotice(message);
  };
  H.fail = error => app.showError(error.message || String(error));
  H.options = (choices, chosen) => choices.map(choice => {
    const [value, label] = Array.isArray(choice) ? choice : [choice, choice];
    return `<option value="${esc(value)}"${String(value) === String(chosen ?? "") ? " selected" : ""}>${esc(label)}</option>`;
  }).join("");
  H.tabs = (host, tabs, active, select) => {
    const bar = document.createElement("div");
    bar.className = "hub-tabs";
    bar.setAttribute("role", "tablist");
    bar.innerHTML = tabs.map(([key, label]) => `<button type="button" role="tab" aria-selected="${key === active}" data-tab="${esc(key)}" class="${key === active ? "active" : ""}">${esc(label)}</button>`).join("");
    bar.onclick = event => { const tab = event.target.closest("[data-tab]"); if (tab) select(tab.dataset.tab); };
    host.append(bar);
  };
  H.breadcrumb = (host, crumbs) => {
    const bar = document.createElement("nav");
    bar.className = "hub-crumbs";
    bar.innerHTML = crumbs.map(([label], index) => index === crumbs.length - 1 ? `<span>${esc(label)}</span>` : `<button type="button" data-crumb="${index}">${esc(label)}</button>`).join(" › ");
    bar.onclick = event => { const crumb = event.target.closest("[data-crumb]"); if (crumb) crumbs[Number(crumb.dataset.crumb)][1](); };
    host.append(bar);
  };

  // Filter bar, the same one as the Projects page. Controls report through `change(state)`.
  H.toolbar = (host, items, change, state = {}) => {
    const bar = document.createElement("section");
    bar.className = "filter-bar hub-filters";
    const buttons = {};
    const hasFilters = items.some(item => ["select", "date", "month", "check"].includes(item.type) || (item.type === "button" && !item.primary));
    bar.innerHTML = items.map((item, index) => {
      if (item.edit && !H.canEdit) return "";
      if (item.type === "search") return `<input class="filter-search" type="search" data-key="${item.key}" placeholder="${esc(item.placeholder || "Search")}" value="${esc(state[item.key] || "")}" aria-label="Search" autocomplete="off">`;
      if (item.type === "select") return `<select data-key="${item.key}" aria-label="${esc(item.label)}">${H.options(item.options, state[item.key] ?? item.value ?? "")}</select>`;
      if (item.type === "date" || item.type === "month") return `<label>${esc(item.label)}<input type="${item.type}" data-key="${item.key}" value="${esc(state[item.key] || "")}"></label>`;
      if (item.type === "check") return `<label><input type="checkbox" data-key="${item.key}"${state[item.key] ? " checked" : ""}> ${esc(item.label)}</label>`;
      if (item.type === "note") return `<span class="hub-note" data-note="${item.key}"></span>`;
      buttons[index] = item;
      return `<button type="button" data-button="${index}" class="${item.primary ? "primary" : "outline"}">${esc(item.label)}</button>`;
    }).join("") + (hasFilters ? '<button type="button" class="outline filter-toggle" data-more-filters>Filters</button>' : "");
    items.forEach(item => { if ((item.type === "select") && state[item.key] === undefined) state[item.key] = item.value ?? ""; });
    const read = input => { state[input.dataset.key] = input.type === "checkbox" ? input.checked : input.value; change(state); };
    let timer;
    bar.oninput = event => { if (event.target.dataset.key && event.target.type === "search") { clearTimeout(timer); timer = setTimeout(() => read(event.target), 200); } };
    bar.onchange = event => { if (event.target.dataset.key && event.target.type !== "search") read(event.target); };
    bar.onclick = event => {
      if (event.target.closest("[data-more-filters]")) bar.classList.toggle("filters-open");
      const button = event.target.closest("[data-button]");
      if (button) buttons[button.dataset.button].onClick();
    };
    bar.note = (key, text) => { const note = bar.querySelector(`[data-note="${key}"]`); if (note) note.textContent = text; };
    host.append(bar);
    return bar;
  };
  H.matches = (search, parts) => !search || parts.filter(part => part !== undefined && part !== null).join(" ").toLowerCase().includes(search.toLowerCase());
  // A section of a popup or page, in the same card as the completion form.
  H.section = (title, html, note = "") => `<section class="completion-section"><h3>${esc(title)}${note ? ` <small class="muted">${esc(note)}</small>` : ""}</h3>${html}</section>`;
  // A plain read-only table for popups: stacks into cards on phones like every other table.
  H.grid = (headers, rows, empty = "Nothing to show yet.") => `<div class="table-wrap hub-wrap"><table><thead><tr>${headers.map(header => `<th>${esc(header)}</th>`).join("")}</tr></thead><tbody>${rows.map(cells => `<tr>${cells.map((cell, index) => `<td data-label="${esc(headers[index])}"><div>${cell}</div></td>`).join("")}</tr>`).join("") || `<tr><td class="hub-empty" colspan="${headers.length}">${esc(empty)}</td></tr>`}</tbody></table></div>`;

  // ---- Tables ------------------------------------------------------------------------------------------------------
  const remembered = (key, fallback) => { try { return JSON.parse(localStorage.getItem(`wolgan.${key}`)) ?? fallback; } catch { return fallback; } };
  const remember = (key, value) => { try { localStorage.setItem(`wolgan.${key}`, JSON.stringify(value)); } catch { /* private window: spacing is simply not kept */ } };
  function closeMenu() { document.querySelector(".hub-more-menu")?.remove(); }
  addEventListener("click", event => { if (!event.target.closest(".hub-more-menu, [data-more]")) closeMenu(); });
  addEventListener("scroll", closeMenu, true);

  /* columns: {key, label, value(row) for text and exports, html(row) for the cell, width}; actions: {key, title,
     edit (needs edit rights), show(row)}; on: {action: (row, event)}; change: {key: (row, value)} for inline selects.
     title/eyebrow head the panel; matrix keeps a wide grid scrolling sideways on phones instead of stacking it. */
  H.table = (host, config) => {
    const panel = document.createElement("section");
    panel.className = "panel hub-table-panel";
    panel.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">${esc(config.eyebrow || "BUSINESS RECORDS")}</p><h2>${esc(config.title || H.current)}</h2></div><span class="position"></span></div>`;
    const wrap = document.createElement("div");
    wrap.className = config.matrix ? "hub-scroll" : "table-wrap hub-wrap";
    const spacing = remembered(`spacing.${config.id}`, null);
    if (spacing !== null) wrap.style.setProperty("--hub-row-pad", `${spacing}px`);
    panel.append(wrap);
    host.append(panel);
    const widths = remembered(`widths.${config.id}`, {});
    const actions = (config.actions || []).filter(action => !action.edit || H.canEdit);
    const position = panel.querySelector(".position");
    let rows = [];
    const cell = (column, row, index) => column.html ? column.html(row, index) : esc(column.value ? column.value(row, index) : row[column.key]);
    const rowActions = row => {
      const usable = actions.filter(action => !action.show || action.show(row));
      const shown = usable.length > 3 ? usable.slice(0, 2) : usable;
      return `${shown.map(action => `<button type="button" data-act="${action.key}">${esc(action.title)}</button>`).join("")}${usable.length > 3 ? '<button type="button" data-more>More</button>' : ""}`;
    };
    function draw() {
      const limit = config.limit || 1000, shown = rows.slice(0, limit), span = config.columns.length + (actions.length ? 1 : 0);
      position.textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
      const note = rows.length > limit ? `<p class="hub-note">Showing the first ${limit} of ${rows.length} rows. Narrow the filters to see the rest.</p>` : "";
      wrap.innerHTML = `<button type="button" class="hub-grip" title="Drag to change row spacing" aria-label="Row spacing"></button><table><thead><tr>${config.columns.map(column => `<th data-col="${esc(column.key)}" style="${widths[column.key] ? `width:${widths[column.key]}px;min-width:${widths[column.key]}px` : column.width ? `min-width:${column.width}px` : ""}">${esc(column.label)}<span class="hub-resize" title="Drag to resize, double-click to reset"></span></th>`).join("")}${actions.length ? "<th>Actions</th>" : ""}</tr></thead><tbody>${shown.map((row, index) => `${config.group?.(row, index, shown) ? `<tr class="date-group"><th colspan="${span}">${config.group(row, index, shown)}</th></tr>` : ""}<tr data-index="${index}" class="${config.rowClass?.(row) || ""}">${config.columns.map(column => `<td data-label="${esc(column.label)}" class="${column.className || ""}"><div>${cell(column, row, index)}</div></td>`).join("")}${actions.length ? `<td data-label="Actions" class="hub-row-actions">${rowActions(row)}</td>` : ""}</tr>`).join("") || `<tr><td class="hub-empty" colspan="${span}">${esc(config.empty || "No records yet.")}</td></tr>`}</tbody>${config.footer && shown.length ? `<tfoot>${config.footer(rows)}</tfoot>` : ""}</table>${note}`;
      wrap.current = shown;
    }
    function openMore(button, row) {
      closeMenu();
      const usable = actions.filter(action => !action.show || action.show(row)).slice(2);
      const menu = document.createElement("div"), box = button.getBoundingClientRect();
      menu.className = "hub-more-menu";
      menu.innerHTML = usable.map(action => `<button type="button" data-pick="${action.key}">${esc(action.title)}</button>`).join("");
      menu.style.top = `${Math.min(box.bottom + 4, innerHeight - usable.length * 38 - 12)}px`;
      menu.style.left = `${Math.max(8, box.right - 150)}px`;
      menu.onclick = event => { const pick = event.target.closest("[data-pick]"); if (pick) { closeMenu(); config.on?.[pick.dataset.pick]?.(row, event); } };
      document.body.append(menu);
    }
    wrap.onclick = event => {
      const button = event.target.closest("[data-act]"), more = event.target.closest("[data-more]"), line = event.target.closest("tr[data-index]");
      if (more && line) { openMore(more, wrap.current[Number(line.dataset.index)]); return; }
      if (button && line) { event.preventDefault(); config.on?.[button.dataset.act]?.(wrap.current[Number(line.dataset.index)], event); }
    };
    wrap.onchange = event => {
      const key = event.target.dataset.change, line = event.target.closest("tr[data-index]");
      if (key && line) config.change?.[key]?.(wrap.current[Number(line.dataset.index)], event.target.value, event.target);
    };
    wrap.onpointerdown = event => {
      const handle = event.target.closest(".hub-resize");
      if (handle) {
        const th = handle.parentElement, key = th.dataset.col, start = event.clientX, width = th.offsetWidth;
        event.preventDefault();
        const move = moved => { const size = Math.max(40, width + moved.clientX - start); th.style.width = th.style.minWidth = `${size}px`; widths[key] = size; };
        const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); remember(`widths.${config.id}`, widths); };
        addEventListener("pointermove", move); addEventListener("pointerup", up);
      } else if (event.target.closest(".hub-grip")) {
        const start = event.clientY, base = parseFloat(getComputedStyle(wrap).getPropertyValue("--hub-row-pad")) || 10;
        event.preventDefault();
        let size = base;
        const move = moved => { size = Math.min(30, Math.max(2, base + (moved.clientY - start) / 4)); wrap.style.setProperty("--hub-row-pad", `${size}px`); };
        const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); remember(`spacing.${config.id}`, size); };
        addEventListener("pointermove", move); addEventListener("pointerup", up);
      }
    };
    wrap.ondblclick = event => {
      const handle = event.target.closest(".hub-resize");
      if (handle) { const th = handle.parentElement; th.style.width = th.style.minWidth = ""; delete widths[th.dataset.col]; remember(`widths.${config.id}`, widths); }
    };
    return {
      element: wrap,
      show(next) { rows = next; draw(); },
      rows: () => rows,
      export(format, title) { return H.exportRows(format, title, config.columns, rows); },
    };
  };
  H.exportRows = async (format, title, columns, rows) => {
    const used = columns.filter(column => !column.noExport);
    const text = (column, row, index) => column.export ? column.export(row, index) : column.value ? column.value(row, index) : row[column.key];
    try {
      await H.downloadPost("/export", {
        title, format, headers: used.map(column => column.label),
        rows: rows.map((row, index) => used.map(column => { const value = text(column, row, index); return value === undefined || value === null ? "" : value; })),
      }, `${title}.${format}`);
    } catch (error) { H.fail(error); }
  };
  H.inlineSelect = (key, value, choices, disabled = !H.canEdit) => `<select class="hub-inline-select" data-change="${key}"${disabled ? " disabled" : ""} aria-label="${esc(key)}">${H.options(choices.includes(value ?? "") ? choices : [value, ...choices], value ?? "")}</select>`;

  // ---- Dialogs -----------------------------------------------------------------------------------------------------
  function dialog(className) {
    const element = document.createElement("dialog");
    element.className = `hub-dialog ${className || ""}`;
    document.body.append(element);
    element.addEventListener("close", () => element.remove());
    return element;
  }
  H.confirm = (message, { action = "Delete", danger = true } = {}) => new Promise(resolve => {
    const element = dialog("approval-confirm-dialog");
    element.innerHTML = `<form method="dialog"><div class="panel-heading"><h2>Please Confirm</h2></div><p>${esc(message)}</p><div class="schedule-actions"><button class="outline" value="no">Cancel</button><button class="primary${danger ? " danger" : ""}" value="yes">${esc(action)}</button></div></form>`;
    element.addEventListener("close", () => resolve(element.returnValue === "yes"));
    element.showModal();
  });
  // fields: {key, label, type, options, required, full, hint, hidden(values), readonly}; type "section" is a sub-heading.
  function fieldHtml(field, value) {
    const id = `hub-${field.key}`, required = field.required ? " required" : "", lock = field.readonly ? " readonly" : "";
    if (field.type === "section") return `<h3 class="hub-form-section">${esc(field.label)}</h3>`;
    if (field.type === "custom") return field.html;
    if (field.type === "check") return `<label class="hub-check"><input type="checkbox" name="${field.key}"${value ? " checked" : ""}> ${esc(field.label)}</label>`;
    let control;
    if (field.type === "select") {
      const known = field.options.some(option => String(Array.isArray(option) ? option[0] : option) === String(value ?? ""));
      control = `<select name="${field.key}"${required}>${H.options(known || !value ? field.options : [value, ...field.options], value ?? "")}</select>`;
    } else if (field.type === "textarea") control = `<textarea name="${field.key}" rows="${field.rows || 3}"${required}${lock}>${esc(value ?? "")}</textarea>`;
    else if (field.type === "combo") control = `<input name="${field.key}" list="${id}-list" value="${esc(value ?? "")}" autocomplete="off"${required}><datalist id="${id}-list">${(field.options || []).map(option => `<option value="${esc(option)}">`).join("")}</datalist>`;
    else control = `<input name="${field.key}" type="${field.type || "text"}" value="${esc(value ?? "")}"${field.type === "number" ? ' step="any"' : ""}${required}${lock}>`;
    return `<label class="${field.full ? "wide" : ""}">${esc(field.label)}${field.required ? " *" : ""}${control}${field.hint ? `<small class="muted">${esc(field.hint)}</small>` : ""}</label>`;
  }
  H.form = ({ title, fields, values = {}, submit, onChange, onOpen, saveLabel = "Save", wide = false }) => new Promise(resolve => {
    const element = dialog(wide ? "wide" : "");
    let result = null;
    const shown = fields.filter(field => !field.hidden || !field.hidden(values));
    element.innerHTML = `<form novalidate><div class="panel-heading"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-close aria-label="Close">×</button></div><div class="form-grid">${shown.map(field => fieldHtml(field, values[field.key])).join("")}</div><p class="hub-form-message" role="alert"></p><div class="schedule-actions"><button type="button" class="outline" data-close>Cancel</button><button class="primary">${esc(saveLabel)}</button></div></form>`;
    const form = element.querySelector("form");
    const read = () => {
      const output = { ...values };
      shown.forEach(field => {
        if (field.type === "section") return;
        if (field.type === "custom") { field.keys.forEach(key => { output[key] = form.elements[key].value.trim(); }); return; }
        const input = form.elements[field.key];
        output[field.key] = field.type === "check" ? input.checked : input.value.trim();
      });
      return output;
    };
    element.addEventListener("click", event => { if (event.target.closest("[data-close]")) element.close(); });
    form.oninput = event => onChange?.(read(), name => form.elements[name], event.target.name);
    form.onsubmit = async event => {
      event.preventDefault();
      const message = form.querySelector(".hub-form-message"), output = read();
      const missing = shown.find(field => field.required && !output[field.key]);
      if (missing) { message.textContent = `${missing.label} is required.`; return; }
      const button = form.querySelector(".primary");
      button.disabled = true; message.textContent = "";
      try { result = (submit ? await submit(output) : output) ?? output; element.close(); }
      catch (error) { message.textContent = error.message; button.disabled = false; }
    };
    element.addEventListener("close", () => resolve(result));
    element.showModal();
    onOpen?.(form);
  });
  // A full popup. Buttons in `tools` run with the popup open; the × only closes the popup.
  H.popup = ({ title, eyebrow = "", html, tools = [], wide = true, className = "" }) => {
    const element = dialog(`hub-popup ${wide ? "wide" : ""} ${className}`);
    element.innerHTML = `<div class="panel-heading hub-popup-head"><div>${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ""}<h2>${esc(title)}</h2></div><div class="hub-popup-tools">${tools.map((tool, index) => `<button type="button" class="${tool.primary ? "primary" : "outline"}" data-tool="${index}">${esc(tool.label)}</button>`).join("")}<button type="button" class="icon-button" data-close aria-label="Close this window" title="Close this window">×</button></div></div><div class="hub-popup-body">${html || ""}</div>`;
    element.addEventListener("click", event => {
      if (event.target.closest("[data-close]")) element.close();
      const tool = event.target.closest("[data-tool]");
      if (tool) tools[Number(tool.dataset.tool)].onClick(element);
    });
    element.body = element.querySelector(".hub-popup-body");
    element.showModal();
    return element;
  };
  H.print = (title, html) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0";
    document.body.append(frame);
    const target = frame.contentDocument;
    target.open();
    target.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="/static/css/app.css"><link rel="stylesheet" href="/static/css/hub.css"><style>body{margin:12mm;background:#fff}h1,h2,h3{margin:8px 0}</style></head><body class="hub-print">${html}</body></html>`);
    target.close();
    setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 1000); }, 600);
  };
  // Download a piece of page as a PDF made of page images, one A4 sheet at a time.
  const scripts = {};
  const loadScript = url => scripts[url] ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url; script.onload = resolve; script.onerror = () => reject(new Error("The PDF tool could not be loaded. Check the internet connection."));
    document.head.append(script);
  });
  H.pdfFromPages = async (pagesToDraw, name, landscape = false) => {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: landscape ? "landscape" : "portrait" });
    const width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight();
    for (let index = 0; index < pagesToDraw.length; index++) {
      const canvas = await window.html2canvas(pagesToDraw[index], { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      if (index) pdf.addPage();
      const scale = Math.min(width / canvas.width, height / canvas.height);
      const shownWidth = canvas.width * scale, shownHeight = canvas.height * scale;
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", (width - shownWidth) / 2, 0, shownWidth, shownHeight);
    }
    pdf.save(name);
  };

  // ---- Attachments -------------------------------------------------------------------------------------------------
  H.fileUrl = (id, inline) => `/api/hub/files/${encodeURIComponent(id)}${inline ? "?inline=1" : ""}`;
  H.files = async (recordId, { title = "Files", kinds = ["Other"], after } = {}) => {
    const popup = H.popup({ title, eyebrow: "ATTACHMENTS", wide: false, html: "<p>Loading files…</p>" });
    async function draw() {
      let files;
      try { files = (await H.api(`/files?record_id=${encodeURIComponent(recordId)}`)).data || []; }
      catch (error) { popup.body.innerHTML = `<p class="hub-form-message">${esc(error.message)}</p>`; return; }
      popup.body.innerHTML = `${H.canEdit ? `<form class="cert-row"><label>Type<select name="kind">${H.options(kinds)}</select></label><label>File<input name="file" type="file" required></label><button class="primary">Upload</button></form><p class="hub-form-message" role="alert"></p>` : ""}${H.grid(["Type", "File", "Added", "Actions"], files.map(file => [esc(file.image_type), esc(file.original_filename), esc(H.date(file.created_at.slice(0, 10))), `<span class="hub-row-actions"><a href="${H.fileUrl(file.id, true)}" target="_blank" rel="noopener">Open</a><a href="${H.fileUrl(file.id)}">Download</a>${H.canEdit ? `<button type="button" data-remove="${esc(file.id)}">Remove</button>` : ""}</span>`]), "No files yet.")}`;
      const form = popup.body.querySelector("form");
      if (form) form.onsubmit = async event => {
        event.preventDefault();
        const file = form.elements.file.files[0];
        if (!file) return;
        try { await H.upload("/files", { file, record_id: recordId, kind: form.elements.kind.value }); await draw(); after?.(); }
        catch (error) { popup.body.querySelector(".hub-form-message").textContent = error.message; }
      };
    }
    popup.body.onclick = async event => {
      const remove = event.target.closest("[data-remove]");
      if (remove && await H.confirm("Remove this file?", { action: "Remove" })) {
        try { await H.del(`/files/${remove.dataset.remove}`); await draw(); after?.(); } catch (error) { H.fail(error); }
      }
    };
    draw();
  };

  // ---- Shared look-ups ---------------------------------------------------------------------------------------------
  H.staffNames = async () => {
    const staff = await H.list("staff").catch(() => []);
    const names = staff.filter(person => (person.status || "Active") !== "Resigned" && person.status !== "Terminated").map(person => person.name);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  };
  H.siteField = (contracts, key = "contract_id") => ({
    key, label: "AMC / Site", type: "select", full: true,
    options: [["", "Not linked to a contract"], ...contracts.filter(contract => contract.status !== "Closed").map(contract => [contract.id, `${contract.site} · ${contract.client || ""}`])],
  });
  H.fromContract = (contracts, id) => contracts.find(contract => contract.id === id);
  H.clients = async () => (await app.request("/clients")).data || [];
  H.saveUi = async changes => {
    Object.assign(H.ui, changes);
    await H.put("/me/ui", H.ui);
  };

  // ---- Page shell --------------------------------------------------------------------------------------------------
  H.start = async bridge => {
    app = bridge;
    H.role = app.role();
    const boot = await H.api("/bootstrap");
    H.settings = boot.settings; H.ui = boot.ui || {}; H.sections = boot.sections || [];
    H.canEdit = boot.edit; H.identity = boot.identity; H.organizationId = boot.organization_id; H.staffId = boot.staff_id;
    H.afterStart?.();
  };
  H.show = async (name, params) => {
    const host = document.querySelector("#hub-page"), token = ++showing;
    // Nothing from the previous page stays on screen while this page's data loads; a refresh keeps the page in place.
    if (name !== H.current || !host.children.length) host.innerHTML = '<p class="muted">Loading…</p>';
    H.current = name;
    try {
      const body = document.createElement("div");
      await pages[name].render(body, params, () => token === showing);
      if (token === showing) host.replaceChildren(body);
    } catch (error) {
      if (token === showing) host.innerHTML = `<p class="hub-form-message">${esc(error.message)}</p>`;
    }
  };
  H.clearPage = () => { document.querySelector("#hub-page").innerHTML = ""; H.current = ""; };
  H.page("Settings", { render: host => app.drawSettings(host) });
  H.refresh = name => H.show(name);
  return H;
})();
