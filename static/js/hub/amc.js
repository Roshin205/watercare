// AMC & Site Visits: contract tracker, master schedule sheet, Projects & GRN and the project sheet popup.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "AMC & Site Visits";
  const FREQUENCIES = ["Monthly", "Bimonthly", "Quarterly", "Half-yearly", "Yearly", "On call"];
  const REPORT = ["Pending", "Submitted", "Not required"], GRN = ["", "Requested", "Pending", "Received", "Not applicable"];
  const LAB = ["Pending", "Sample sent", "Received", "Not applicable"], INVOICE = ["Pending", "Submitted", "Not applicable"];
  const SOURCES = ["AMC", "AMC + Schedule", "Schedule only"], CLOSE_REASONS = ["Expired", "Renewed", "Terminated", "Other"];
  const GRN_STATUSES = ["Waiting GRN", "Pending GRN", "GRN Received", "In progress", "Work Completed", "Invoiced"];
  const CYCLE = ["due", "done", "missed", "na", ""];
  const MARK = { due: "●", done: "✓", missed: "×", na: "–", "": "" };
  H.visitMark = MARK;
  let tab = "tracker", contracts = [], filters = { scope: "active" }, range = null;

  const isActive = row => row.status !== "Closed";
  const overdue = row => row.next_due && H.daysLeft(row.next_due) < 0;
  const expired = row => row.expiry && H.daysLeft(row.expiry) < 0;
  const expiring = row => { const left = H.daysLeft(row.expiry); return left !== null && left >= 0 && left <= 60; };
  const TESTS = {
    Expired: expired, "Expiring ≤60d": expiring, "Visit overdue": overdue, "Report pending": row => row.report === "Pending",
    "GRN pending": row => row.grn === "Pending" || row.grn === "Requested", "Lab pending": row => row.lab === "Pending" || row.lab === "Sample sent",
    "Invoice pending": row => row.invoice === "Pending",
  };
  async function load() { contracts = await H.list("contracts"); }
  H.loadContracts = load;

  // ---- Contract form ----------------------------------------------------------------------------------------------
  function contractFields(staff, clients) {
    return [
      { type: "section", label: "Contract", key: "s1" },
      { key: "client", label: "Client", type: "combo", options: clients, required: true },
      { key: "site", label: "Project / Site", required: true },
      { key: "service", label: "Service", type: "select", options: ["", ...H.app().services().filter(service => service.is_active).map(service => service.name)] },
      { key: "so", label: "SO Number" }, { key: "period_text", label: "Contract Period", hint: "For example: Jul 26 to Mar 27" },
      { key: "start", label: "Start Date", type: "date" }, { key: "expiry", label: "Expiry Date", type: "date" },
      { key: "system_details", label: "System Details", type: "textarea", full: true },
      { key: "frequency", label: "Visit Frequency", type: "select", options: ["", ...FREQUENCIES] },
      { key: "engineer", label: "Assigned Engineer", type: "combo", options: staff, hint: "Allocated to each new visit on the schedule." },
      { key: "visit_time", label: "Visit Time", type: "time" },
      { key: "source", label: "Source", type: "select", options: SOURCES },
      { type: "section", label: "Visits", key: "s2" },
      { key: "last_visit", label: "Last Visit", type: "date" }, { key: "next_due", label: "Next Due", type: "date" },
      { key: "visited_by", label: "Who Visited", type: "combo", options: staff },
      { key: "report", label: "Report", type: "select", options: REPORT }, { key: "grn", label: "GRN", type: "select", options: GRN },
      { key: "lab", label: "Lab Report", type: "select", options: LAB },
      { key: "microbiology", label: "Microbiology", type: "select", options: ["", "Yes", "No"] },
      { key: "legionella", label: "Legionella", type: "select", options: ["", "Yes", "No"] },
      { type: "section", label: "Site Contact", key: "s3" },
      { key: "location", label: "Location / Area" }, { key: "contact", label: "Contact Person" },
      { key: "mobile", label: "Mobile" }, { key: "alternate", label: "Alternate Number" },
      { key: "map_link", label: "Map Link", full: true },
      { key: "map", type: "custom", html: H.app().locationPickerHtml(), keys: ["latitude", "longitude"] },
      { type: "section", label: "Contract Status & Invoice", key: "s4" },
      { key: "status", label: "Contract Status", type: "select", options: ["Active", "Closed"] },
      { key: "closed_date", label: "Closed Date", type: "date" },
      { key: "close_reason", label: "Close Reason", type: "select", options: ["", ...CLOSE_REASONS] },
      { key: "invoice", label: "Invoice Status", type: "select", options: INVOICE }, { key: "invoice_no", label: "Invoice Number" },
      { key: "invoice_date", label: "Invoice Date", type: "date" },
    ];
  }
  async function openContract(row, { copy = false, done, preset } = {}) {
    const [staff, clients] = await Promise.all([H.staffNames(), H.clients().catch(() => [])]);
    const values = row ? { ...row } : { status: "Active", report: "Pending", lab: "Pending", invoice: "Pending", source: "AMC", ...preset };
    if (copy) { values.site = `${row.site} (copy)`; delete values.schedule; delete values.id; }
    const id = copy ? null : row?.id;
    return H.form({
      title: id ? `Edit ${row.site}` : "Add Contract", wide: true, fields: contractFields(staff, clients.map(client => client.name)), values,
      onOpen: form => H.app().initPicker({ latitude: values.latitude === "" ? null : values.latitude, longitude: values.longitude === "" ? null : values.longitude }, form),
      submit: output => {
        const { id: _i, created_at: _c, updated_at: _u, client_id: _l, renewed_from: _f, renewed_to: _t, schedule: _s, map: _m, ...fields } = output;
        return H.save("contracts", id, fields);
      },
    }).then(saved => { if (saved) done?.(); });
  }
  H.editors.contract = async id => {
    await load();
    const row = contracts.find(item => item.id === id);
    if (row) openContract(row, { done: () => H.refresh(PAGE) });
  };
  function logVisit(row, done) {
    H.staffNames().then(staff => H.form({
      title: `Log Site Visit · ${row.site}`, saveLabel: "Log Visit", values: { date: H.today(), report: row.report, lab: row.lab },
      fields: [
        { key: "date", label: "Visit Date", type: "date", required: true }, { key: "engineer", label: "Who Visited", type: "combo", options: staff },
        { key: "report", label: "Report", type: "select", options: REPORT }, { key: "lab", label: "Lab Report", type: "select", options: LAB },
      ],
      submit: values => H.post(`/contracts/${row.id}/visit`, values),
    })).then(saved => { if (saved) done(); });
  }
  function closeContract(row, done) {
    H.form({
      title: `Close ${row.site}`, saveLabel: "Close Contract", values: { closed_date: H.today(), close_reason: expired(row) ? "Expired" : "Other" },
      fields: [
        { key: "closed_date", label: "Closed Date", type: "date", required: true },
        { key: "close_reason", label: "Reason", type: "select", options: CLOSE_REASONS },
        { key: "close_note", label: "Note", type: "textarea", full: true },
      ],
      submit: values => H.post(`/contracts/${row.id}/close`, values),
    }).then(saved => { if (saved) done(); });
  }
  function renewContract(row, done) {
    H.form({
      title: `Renew ${row.site}`, saveLabel: "Renew Contract", values: { start: row.expiry ? H.addDays(row.expiry, 1) : "", copy_samples: true, copy_ppm: true, copy_chemicals: true },
      fields: [
        { key: "so", label: "New SO Number", required: true }, { key: "period_text", label: "Contract Period" },
        { key: "start", label: "Start Date", type: "date", required: true }, { key: "expiry", label: "Expiry Date", type: "date", required: true },
        { key: "copy_samples", label: "Copy sample schedules", type: "check" }, { key: "copy_ppm", label: "Copy PPM planner", type: "check" },
        { key: "copy_chemicals", label: "Copy chemical lines (deliveries restart at zero)", type: "check" },
      ],
      submit: values => H.post(`/contracts/${row.id}/renew`, values),
    }).then(saved => { if (saved) done(); });
  }
  async function reopen(row, done) {
    if (await H.confirm(`Reopen ${row.site}?`, { action: "Reopen", danger: false })) {
      try { await H.post(`/contracts/${row.id}/reopen`); done(); } catch (error) { H.fail(error); }
    }
  }
  async function removeContract(row, done) {
    if (await H.confirm(`Delete the contract for ${row.site}? This cannot be undone from this page.`)) {
      try { await H.del(`/contracts/${row.id}`); done(); } catch (error) { H.fail(error); }
    }
  }

  // ---- Contract tracker -------------------------------------------------------------------------------------------
  const sourceLabel = row => row.source || "AMC";
  function drawTracker(host) {
    const refresh = () => H.show(PAGE);
    const inScope = contracts.filter(row => filters.scope === "all" || (filters.scope === "closed" ? !isActive(row) : isActive(row)));
    const count = test => inScope.filter(test).length;
    const stats = document.createElement("div");
    stats.innerHTML = H.stats([
      { value: count(() => true), label: filters.scope === "closed" ? "Closed contracts" : "Active contracts" },
      { value: count(expired), label: "Expired", tone: "red", filter: "Expired" }, { value: count(expiring), label: "Expiring ≤60d", tone: "amber", filter: "Expiring ≤60d" },
      { value: count(overdue), label: "Visits overdue", tone: "red", filter: "Visit overdue" }, { value: count(TESTS["Report pending"]), label: "Reports pending", tone: "amber", filter: "Report pending" },
      { value: count(TESTS["GRN pending"]), label: "GRN pending", tone: "amber", filter: "GRN pending" }, { value: count(TESTS["Lab pending"]), label: "Lab pending", tone: "amber", filter: "Lab pending" },
      { value: count(TESTS["Invoice pending"]), label: "Invoices pending", tone: "amber", filter: "Invoice pending" },
    ]);
    stats.onclick = event => { const card = event.target.closest("[data-stat]"); if (card) { filters.status = card.dataset.stat; H.show(PAGE); } };
    host.append(stats);
    const clients = [...new Set(contracts.map(row => row.client).filter(Boolean))].sort();
    const bar = H.toolbar(host, [
      { type: "search", key: "q", placeholder: "Search client, project, SO, system, visitor, contact" },
      { type: "select", key: "status", label: "Status", options: [["", "All status"], ...Object.keys(TESTS)] },
      { type: "select", key: "client", label: "Client", options: [["", "All clients"], ...clients] },
      { type: "select", key: "service", label: "Service", options: [["", "All services"], ...H.app().services().map(service => service.name)] },
      { type: "select", key: "source", label: "Source", options: [["", "All sources"], ...SOURCES] },
      { type: "select", key: "scope", label: "Contracts", options: [["active", "Active contracts only"], ["closed", "Closed"], ["all", "All"]], value: filters.scope },
      { type: "button", label: "＋ Add Contract", primary: true, edit: true, onClick: () => openContract(null, { done: refresh }) },
      { type: "button", label: "Auto-update Schedule", edit: true, onClick: async () => {
        try { const result = await H.post("/contracts/auto-schedule"); H.notice(`Schedule updated on ${result.changed} contract(s).`); refresh(); } catch (error) { H.fail(error); }
      } },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", "AMC Contracts") },
      { type: "note", key: "shown" },
    ], () => { if (bar) { paint(); } }, filters);
    const table = H.table(host, {
      id: "amc-tracker", eyebrow: "AMC CONTRACTS", title: "Contract Tracker", empty: "No contracts match these filters.",
      columns: [
        { key: "n", label: "#", value: (row, index) => index + 1, width: 36 },
        { key: "client", label: "Client" },
        { key: "service", label: "Service" },
        { key: "site", label: "Site / Project", value: row => row.site, width: 190, html: row => `<a href="#" class="hub-link" data-act="sheet">${esc(row.site)}</a>${row.status === "Closed" ? ` ${H.badge("Closed", "grey")}` : ""}<br>${H.contactLine(row)}` },
        { key: "source", label: "Source", value: sourceLabel }, { key: "system_details", label: "System Details", width: 180, className: "wrap" },
        { key: "so", label: "SO" },
        { key: "start", label: "Start", value: row => H.date(row.start) },
        { key: "expiry", label: "Expiry", value: row => H.date(row.expiry), html: row => `${esc(H.date(row.expiry)) || "–"}<br>${H.dueBadge(row.expiry)}` },
        { key: "last_visit", label: "Last Visit", value: row => H.date(row.last_visit) || "–" },
        { key: "next_due", label: "Next Due", value: row => H.date(row.next_due), html: row => `${esc(H.date(row.next_due)) || "–"}<br>${H.dueBadge(row.next_due, { warn: 7 })}` },
        { key: "visited_by", label: "Visited By", value: row => row.visited_by || "–" },
        { key: "report", label: "Report", value: row => row.report, html: row => H.inlineSelect("report", row.report, REPORT) },
        { key: "grn", label: "GRN", value: row => row.grn, html: row => H.inlineSelect("grn", row.grn || "", GRN) },
        { key: "lab", label: "Lab", value: row => row.lab, html: row => H.inlineSelect("lab", row.lab, LAB) },
        { key: "invoice", label: "Invoice", value: row => [row.invoice, row.invoice_no].filter(Boolean).join(" · "), html: row => `${H.inlineSelect("invoice", row.invoice, INVOICE)}${row.invoice_no ? `<br><small>${esc(row.invoice_no)}</small>` : ""}` },
      ],
      actions: [
        { key: "sheet", title: "View" }, { key: "visit", title: "Log Visit", edit: true, show: isActive },
        { key: "edit", title: "Edit", edit: true }, { key: "files", title: "Files" }, { key: "renew", title: "Renew", edit: true },
        { key: "close", title: "Close", edit: true, show: isActive }, { key: "reopen", title: "Reopen", edit: true, show: row => !isActive(row) },
        { key: "clone", title: "Clone", edit: true }, { key: "delete", title: "Delete", edit: true },
      ],
      on: {
        sheet: row => openSheet(row.id, refresh), visit: row => logVisit(row, refresh), edit: row => openContract(row, { done: refresh }),
        files: row => H.files(row.id, { title: `Files · ${row.site}`, kinds: ["Contract", "Drawing", "Report", "Other"] }),
        renew: row => renewContract(row, refresh), close: row => closeContract(row, refresh), reopen: row => reopen(row, refresh),
        clone: row => openContract(row, { copy: true, done: refresh }), delete: row => removeContract(row, refresh),
      },
      change: Object.fromEntries(["report", "grn", "lab", "invoice"].map(key => [key, async (row, value) => {
        try { Object.assign(row, (await H.patch(`/contracts/${row.id}`, { [key]: value })).data); paint(); } catch (error) { H.fail(error); }
      }])),
    });
    function paint() {
      const { q = "", status = "", client = "", source = "", scope = "active", service = "" } = filters;
      const rows = contracts.filter(row => (scope === "all" || (scope === "closed" ? !isActive(row) : isActive(row)))
        && (!status || TESTS[status](row)) && (!client || row.client === client) && (!source || sourceLabel(row) === source) && (!service || row.service === service)
        && H.matches(q, [row.client, row.site, row.so, row.system_details, row.visited_by, row.contact, row.mobile, row.location]));
      table.show(rows);
      bar.note("shown", `${rows.length} shown · click a site name for the full project sheet`);
    }
    paint();
  }

  // ---- Master schedule sheet --------------------------------------------------------------------------------------
  function drawMaster(host) {
    range ||= { from: `${H.today().slice(0, 4)}-01`, to: `${H.today().slice(0, 4)}-12` };
    const state = { ...range, q: filters.masterQ || "", client: filters.masterClient || "" };
    const clients = [...new Set(contracts.map(row => row.client).filter(Boolean))].sort();
    const shiftYear = change => { range = { from: H.shiftMonth(range.from, change * 12), to: H.shiftMonth(range.to, change * 12) }; H.show(PAGE); };
    H.toolbar(host, [
      { type: "button", label: "← Year", onClick: () => shiftYear(-1) }, { type: "button", label: "Year →", onClick: () => shiftYear(1) },
      { type: "month", key: "from", label: "From" }, { type: "month", key: "to", label: "To" },
      { type: "search", key: "q", placeholder: "Search site or client" },
      { type: "select", key: "client", label: "Client", options: [["", "All clients"], ...clients] },
      { type: "button", label: "Excel", onClick: () => H.exportRows("xlsx", "Master Schedule", columns(), rows()) },
    ], next => {
      if (next.from !== range.from || next.to !== range.to) {
        if (next.from && next.to && next.from <= next.to) { range = { from: next.from, to: next.to }; filters.masterQ = next.q; filters.masterClient = next.client; H.show(PAGE); }
        return;
      }
      filters.masterQ = next.q; filters.masterClient = next.client; table.show(rows());
    }, state);
    const months = H.monthsBetween(range.from, range.to), current = H.thisMonth();
    const rows = () => contracts.filter(row => isActive(row) && (!filters.masterClient || row.client === filters.masterClient) && H.matches(filters.masterQ, [row.site, row.client, row.so]));
    const state_of = (row, month) => row.schedule?.[month]?.status || "";
    const columns = () => [
      { key: "site", label: "Project", width: 200, value: row => row.site, html: row => `<a href="#" class="hub-link" data-act="sheet">${esc(row.site)}</a><br><small>${esc(row.client || "")}</small> ${H.dueBadge(row.expiry)}` },
      ...months.map(month => ({
        key: month, label: H.monthLabel(month), value: row => MARK[state_of(row, month)], className: month === current ? "hub-this-month" : "",
        html: row => `<button type="button" class="hub-cell ${state_of(row, month)}" data-act="cycle" data-month="${month}"${H.canEdit ? "" : " disabled"} title="${esc(H.monthLabel(month))}">${MARK[state_of(row, month)]}</button>`,
      })),
      { key: "done", label: "✓", value: row => months.filter(month => state_of(row, month) === "done").length },
      { key: "due", label: "●", value: row => months.filter(month => state_of(row, month) === "due").length },
    ];
    const table = H.table(host, {
      id: "amc-master", eyebrow: "VISIT SCHEDULE", title: "Master Schedule Sheet", matrix: true, columns: columns(), empty: "No active contracts match.",
      actions: [{ key: "edit", title: "Edit", edit: true }, { key: "clone", title: "Clone", edit: true }],
      on: {
        sheet: row => openSheet(row.id, () => H.show(PAGE)),
        edit: row => openContract(row, { done: () => H.show(PAGE) }), clone: row => openContract(row, { copy: true, done: () => H.show(PAGE) }),
        cycle: async (row, event) => {
          const month = event.target.dataset.month, next = CYCLE[(CYCLE.indexOf(state_of(row, month)) + 1) % CYCLE.length];
          try { Object.assign(row, (await H.post(`/contracts/${row.id}/schedule`, { month, status: next })).data); table.show(rows()); } catch (error) { H.fail(error); }
        },
      },
    });
    table.show(rows());
  }

  // ---- Projects & GRN ---------------------------------------------------------------------------------------------
  async function drawGrn(host) {
    const refresh = () => H.show(PAGE), projects = await H.list("grn_projects");
    const open = (row, copy) => H.form({
      title: row && !copy ? "Edit Project" : "Add Project", values: row ? { ...row, project: copy ? `${row.project} (copy)` : row.project } : {},
      fields: [
        { key: "project", label: "Project", required: true }, { key: "quote", label: "Quote" }, { key: "po", label: "PO" }, { key: "so", label: "SO" },
        { key: "status", label: "Work / GRN Status", type: "combo", options: GRN_STATUSES, full: true },
      ],
      submit: ({ project, quote, po, so, status }) => H.save("grn_projects", copy ? null : row?.id, { project, quote, po, so, status }),
    }).then(saved => { if (saved) refresh(); });
    const state = {};
    H.toolbar(host, [
      { type: "search", key: "q", placeholder: "Search project, quote, PO, SO" },
      { type: "button", label: "＋ Add Project", primary: true, edit: true, onClick: () => open() },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Projects and GRN") },
    ], () => paint(), state);
    const table = H.table(host, {
      id: "amc-grn", eyebrow: "WORK ORDERS", title: "Projects & GRN", empty: "No projects yet.",
      columns: [{ key: "project", label: "Project" }, { key: "quote", label: "Quote" }, { key: "po", label: "PO" }, { key: "so", label: "SO" }, { key: "status", label: "Work / GRN Status" }],
      actions: [{ key: "edit", title: "Edit", edit: true }, { key: "clone", title: "Clone", edit: true }, { key: "delete", title: "Delete", edit: true }],
      on: {
        edit: row => open(row), clone: row => open(row, true),
        delete: async row => { if (await H.confirm(`Delete ${row.project}?`)) { try { await H.del(`/grn_projects/${row.id}`); refresh(); } catch (error) { H.fail(error); } } },
      },
    });
    const paint = () => table.show(projects.filter(row => H.matches(state.q, [row.project, row.quote, row.po, row.so, row.status])));
    paint();
  }

  H.page(PAGE, {
    async render(host) {
      await load();
      H.tabs(host, [["tracker", "Contract Tracker"], ["master", "Master Schedule Sheet"], ["grn", "Projects & GRN"]], tab, next => { tab = next; H.show(PAGE); });
      if (tab === "tracker") drawTracker(host);
      else if (tab === "master") drawMaster(host);
      else await drawGrn(host);
    },
  });

  // ---- Project sheet popup ----------------------------------------------------------------------------------------
  async function openSheet(id, changed = () => {}) {
    await load();
    const row = contracts.find(item => item.id === id);
    if (!row) { H.notice("This contract is no longer available.", true); return; }
    const after = async () => { popup.close(); changed(); await openSheet(id, changed); };
    const popup = H.popup({
      title: row.site, eyebrow: "PROJECT SHEET", html: "<p>Loading…</p>",
      tools: [
        ...(H.canEdit ? [{ label: "Edit", primary: true, onClick: () => openContract(row, { done: after }) },
          { label: "Renew", onClick: () => renewContract(row, after) },
          isActive(row) ? { label: "Close Contract", onClick: () => closeContract(row, after) } : { label: "Reopen Contract", onClick: () => reopen(row, after) },
          { label: "Make Certificate", onClick: () => { popup.close(); H.makeCertificate(row); } }] : []),
        { label: "Files", onClick: () => H.files(row.id, { title: `Files · ${row.site}`, kinds: ["Contract", "Drawing", "Report", "Other"] }) },
        { label: "Copy Link", onClick: () => { navigator.clipboard?.writeText(`${location.origin}/#/contract/${row.id}`); H.notice("Link copied. Anyone signed in with access can open it."); } },
        { label: "Print", onClick: () => H.print(row.site, popup.body.innerHTML) },
      ],
    });
    popup.body.style.background = H.ui.sheet_color || "";
    const [samples, planners, lines, notes] = await Promise.all([
      H.list("samples", `?parent=${id}`), H.list("ppm_planners", `?parent=${id}`), H.list("chemical_lines", `?parent=${id}`), H.list("delivery_notes", `?parent=${id}`),
    ]);
    const visits = Object.values(row.schedule || {}), states = status => visits.filter(visit => visit.status === status).length;
    const completions = Object.entries(row.schedule || {}).filter(([, visit]) => visit.completion).sort();
    const late = visits.filter(visit => visit.status === "due" && H.daysLeft(visit.date) < 0).length;
    const delivered = lines.reduce((sum, line) => sum + Object.values(line.months || {}).reduce((total, value) => total + H.number(value), 0), 0);
    const contracted = lines.reduce((sum, line) => sum + H.number(line.contract_qty), 0);
    const years = [...new Set([...Object.keys(row.schedule || {}).map(month => month.slice(0, 4)), H.today().slice(0, 4)])].sort();
    const detail = (label, value) => `<div><span>${esc(label)}</span><strong>${value || "–"}</strong></div>`;
    const stateOf = month => row.schedule?.[month]?.status || "";
    const matrix = `<div class="hub-scroll"><table class="hub-matrix"><thead><tr><th>Year</th>${H.monthNames.map(name => `<th>${name}</th>`).join("")}</tr></thead><tbody>${years.map(year => `<tr><th>${year}</th>${H.monthNames.map((_, index) => { const month = `${year}-${String(index + 1).padStart(2, "0")}`; return `<td class="${month === H.thisMonth() ? "hub-this-month" : ""}"><button type="button" class="hub-cell ${stateOf(month)}" data-cycle="${month}"${H.canEdit ? "" : " disabled"} aria-label="${esc(H.monthLabel(month))}">${MARK[stateOf(month)]}</button></td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`;
    popup.body.innerHTML = `<div class="hub-sheet-tools"><label>Background<input type="color" id="sheet-color" value="${esc(H.ui.sheet_color || "#ffffff")}"></label></div>
      ${H.section("Contract", `<div class="hub-details">${detail("Client", esc(row.client))}${detail("SO Number", esc(row.so))}${detail("Contact Person", esc(row.contact))}${detail("Mobile", esc(row.mobile))}${detail("Alternate", esc(row.alternate))}${detail("Location", esc(row.location))}${detail("Map", H.mapLink(row))}${detail("Contract Period", esc(row.period_text))}${detail("Start → Expiry", `${esc(H.date(row.start))} → ${esc(H.date(row.expiry))} ${H.dueBadge(row.expiry)}`)}${detail("Visit Frequency", esc(row.frequency))}${detail("Invoice / GRN / Lab", esc([row.invoice, row.grn || "–", row.lab].join(" / ")))}${detail("System Details", esc(row.system_details))}</div>`)}
      ${H.stats([
        { value: visits.length, label: "Visits Scheduled" }, { value: states("done"), label: "Completed", tone: "green" }, { value: states("due"), label: "Pending / Due", tone: "amber" },
        { value: late, label: "Overdue", tone: late ? "red" : "" }, { value: states("missed"), label: "Missed", tone: states("missed") ? "red" : "" }, { value: samples.length, label: "Sample Schedules" },
        { value: `${delivered}/${contracted}`, label: "Chemicals Delivered" }, { value: notes.length, label: "Delivery Notes" },
      ])}
      ${H.section("Visit Schedule", matrix, H.canEdit ? "Click a month to change: ● Due, ✓ Done, × Missed, – N/A" : "")}
      ${H.section("Visit Completions", H.grid(["Visit", "Engineer", "Actual Date", "Timing", "Approval", "Actions"], completions.map(([month, visit]) => [esc(H.monthLabel(month)), esc(visit.engineer || visit.completion?.by), esc(H.date(visit.completion?.date)), esc(visit.completion?.timing), H.badge(visit.approval, { Approved: "green", Rejected: "red" }[visit.approval] || "amber"), `<span class="hub-row-actions"><button type="button" data-completion="${month}">View</button></span>`]), "No visit completions yet."))}
      ${H.section("Water Sampling", H.grid(["System", "Test", "Duration", "Next Due", "Days Left", "Last Collected", "Status", "Report"], samples.map(sample => [esc(sample.water_system), esc(sample.test), esc(sample.duration), esc(H.date(sample.next_due)), H.dueBadge(sample.next_due, { warn: 7, late: "Overdue" }), esc(H.date(sample.collection_date)), esc(sample.status), esc(sample.report)]), "No sample schedules."))}
      ${H.section("PPM Planner", planners.map(planner => (planner.groups || []).some(group => group.rows?.length) ? `<p class="hub-note">Year ${esc(planner.year)}</p>${H.plannerSummary(planner)}` : "").join("") || '<p class="hub-note">No planner yet.</p>')}
      ${H.section("Chemical Delivery", H.grid(["Chemical", "UoM", "Contract Qty", "Delivered", "Remaining", "Last Delivery"], lines.map(line => { const total = Object.values(line.months || {}).reduce((sum, value) => sum + H.number(value), 0), last = Object.keys(line.months || {}).sort().pop(); return [esc(line.chemical), esc(line.uom), esc(line.contract_qty), `<b>${total}</b>`, Math.max(H.number(line.contract_qty) - total, 0), esc(last || "")]; }), "No chemical lines."))}
      ${H.section("Delivery Notes", H.grid(["DN", "Date", "Items", "Driver", "Amount", "Status"], notes.map(note => [esc(note.dn), esc(H.date(note.date)), esc((note.items || []).map(item => `${item.name} × ${item.qty}`).join(", ")), esc(note.driver), esc(note.amount), esc(note.status)]), "No delivery notes."))}`;
    popup.querySelector("#sheet-color").oninput = event => { popup.body.style.background = event.target.value; };
    popup.querySelector("#sheet-color").onchange = event => H.saveUi({ sheet_color: event.target.value }).catch(H.fail);
    popup.body.onclick = async event => {
      const view = event.target.closest("[data-completion]");
      if (view) {
        const visit = row.schedule[view.dataset.completion];
        H.openCompletion({ contractId: row.id, month: view.dataset.completion, site: row.site, client: row.client, planned: visit.date, engineer: visit.engineer, approval: visit.approval, reason: visit.reason, completion: visit.completion, readOnly: true });
        return;
      }
      const cell = event.target.closest("[data-cycle]");
      if (!cell) return;
      const month = cell.dataset.cycle, next = CYCLE[(CYCLE.indexOf(stateOf(month)) + 1) % CYCLE.length];
      try { await H.post(`/contracts/${row.id}/schedule`, { month, status: next }); popup.close(); changed(); openSheet(id, changed); } catch (error) { H.fail(error); }
    };
  }
  H.openSheet = openSheet;
  H.openContractForm = openContract;
})();
