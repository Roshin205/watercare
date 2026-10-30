// Lab Samples: client list -> the client's projects -> the project's samples by water system, plus the flat list.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "Lab Samples";
  const STATUS = ["Pending", "Collected", "Sent to lab"], REPORT = ["Not submitted", "Received"];
  const FILE_KINDS = ["Lab report", "Chain of custody", "Photo", "Other"];
  // Where the page is: "clients", {client} or {client, contract}; "all" is the flat list.
  let view = "clients", clients = [], contracts = [], samples = [], showEmpty = false, listState = {};

  const durations = () => H.settings.durations;
  const days = name => durations().find(option => option.name === name)?.days || 0;
  const sampleOverdue = row => row.next_due && H.daysLeft(row.next_due) < 0;
  const dueSoon = row => { const left = H.daysLeft(row.next_due); return left !== null && left >= 0 && left <= 7; };
  const dateClass = row => !row.next_due ? "" : sampleOverdue(row) ? "red" : dueSoon(row) ? "amber" : "green";
  const daysText = row => {
    const left = H.daysLeft(row.next_due);
    return left === null ? "–" : left < 0 ? `Overdue ${-left}d` : `${left}d`;
  };
  async function load() {
    [clients, contracts, samples] = await Promise.all([H.clients(), H.list("contracts"), H.list("samples")]);
  }
  const contractsOf = client => contracts.filter(row => row.status !== "Closed" && (row.client_id === client.id || row.client === client.name));
  const samplesOf = list => { const ids = new Set(list.map(row => row.id)); return samples.filter(row => ids.has(row.contract_id)); };

  function sampleFields(preset) {
    return [
      { ...H.siteField(contracts), required: !preset?.site, label: "Project", type: "select" },
      { key: "water_system", label: "Water System", type: "combo", options: H.settings.water_systems },
      { key: "test", label: "Test", type: "combo", options: H.settings.tests, required: true },
      { key: "duration", label: "Duration Period", type: "select", options: ["", ...durations().map(option => option.name)] },
      { key: "points", label: "Circuit Details / Sample Points", type: "textarea", full: true },
      { key: "contact", label: "Contact Person For Collection" }, { key: "mobile", label: "Mobile" },
      { key: "location", label: "Collection Location Or Map Link", full: true },
      { key: "collection_date", label: "Sample Collection Date", type: "date" },
      { key: "next_due", label: "Next Due Date (Auto)", type: "date" }, { key: "expiry", label: "Expiry Date (Auto)", type: "date" },
      { key: "qty_due", label: "Qty Due", type: "number" },
      { key: "status", label: "Status", type: "select", options: STATUS }, { key: "report", label: "Report", type: "select", options: REPORT },
      { key: "collected_by", label: "Collected By" }, { key: "laboratory", label: "Laboratory" },
      { key: "results", label: "Test Results And Limits", type: "textarea", full: true }, { key: "interpretation", label: "Interpretation", type: "textarea", full: true },
      { key: "notes", label: "Notes", type: "textarea", full: true },
    ];
  }
  function openSample(row, { contract, copy } = {}) {
    const site = contract || contracts.find(item => item.id === row?.contract_id);
    const values = row ? { ...row } : {
      contract_id: contract?.id || "", qty_due: 1, status: "Pending", report: "Not submitted",
      contact: contract?.contact || "", mobile: contract?.mobile || "", location: contract?.map_link || contract?.location || "",
    };
    const id = copy ? null : row?.id;
    let edited = { next_due: Boolean(row?.next_due), expiry: Boolean(row?.expiry) };
    H.form({
      title: id ? "Edit Sample" : "Add Sample", wide: true, fields: sampleFields(site), values,
      onChange(output, input, changed) {
        if (changed === "next_due") edited.next_due = true;
        if (changed === "expiry") edited.expiry = true;
        if (changed === "contract_id") {
          const chosen = contracts.find(item => item.id === output.contract_id);
          if (chosen) { input("contact").value = chosen.contact || ""; input("mobile").value = chosen.mobile || ""; input("location").value = chosen.map_link || chosen.location || ""; }
        }
        if (changed === "collection_date" || changed === "duration") {
          const count = days(output.duration);
          // Typing in the date boxes keeps your value; otherwise they follow the collection date.
          const next = output.collection_date && count ? H.addDays(output.collection_date, count) : "";
          if (!edited.next_due) input("next_due").value = next;
          if (!edited.expiry) input("expiry").value = next;
        }
      },
      submit(output) {
        const chosen = contracts.find(item => item.id === output.contract_id) || site;
        const { id: _i, created_at: _c, updated_at: _u, ...fields } = output;
        return H.save("samples", id, { ...fields, client: chosen?.client || fields.client || "", site: chosen?.site || fields.site || "(no site)" });
      },
    }).then(saved => { if (saved) H.show(PAGE); });
  }
  function markCollected(row) {
    H.staffNames().then(staff => H.form({
      title: "Mark Collected", saveLabel: "Mark Collected", values: { collection_date: H.today() },
      fields: [{ key: "collection_date", label: "Collection Date", type: "date", required: true }, { key: "collected_by", label: "Collected By", type: "combo", options: staff }],
      submit: values => H.post(`/samples/${row.id}/collect`, values),
    })).then(saved => { if (saved) H.show(PAGE); });
  }
  const sampleActions = [
    { key: "collect", title: "Collected", edit: true }, { key: "edit", title: "Edit", edit: true }, { key: "files", title: "Documents" }, { key: "clone", title: "Clone", edit: true }, { key: "delete", title: "Delete", edit: true },
  ];
  const sampleHandlers = contract => ({
    files: row => H.files(row.id, { title: `Documents · ${row.test}`, kinds: FILE_KINDS }), collect: markCollected,
    edit: row => openSample(row, { contract }), clone: row => openSample(row, { contract, copy: true }),
    delete: async row => { if (await H.confirm(`Delete this ${row.test} sample?`)) { try { await H.del(`/samples/${row.id}`); H.show(PAGE); } catch (error) { H.fail(error); } } },
  });
  const inlineChange = {
    status: async (row, value) => { try { Object.assign(row, (await H.patch(`/samples/${row.id}`, { status: value })).data); } catch (error) { H.fail(error); } },
    report: async (row, value) => { try { Object.assign(row, (await H.patch(`/samples/${row.id}`, { report: value })).data); } catch (error) { H.fail(error); } },
  };
  function openLists() {
    H.form({
      title: "Manage Dropdown Lists", wide: true,
      values: {
        tests: H.settings.tests.join("\n"), water_systems: H.settings.water_systems.join("\n"),
        durations: durations().map(option => `${option.name} = ${option.days}`).join("\n"),
      },
      fields: [
        { key: "tests", label: "Tests (one per line)", type: "textarea", rows: 7 }, { key: "water_systems", label: "Water Systems (one per line)", type: "textarea", rows: 7 },
        { key: "durations", label: "Durations (Name = days)", type: "textarea", rows: 7, hint: "For example: Quarterly = 90" },
      ],
      submit: async values => {
        const lines = text => text.split("\n").map(line => line.trim()).filter(Boolean);
        const parsed = lines(values.durations).map(line => {
          const [name, count] = line.split("=").map(part => part.trim());
          if (!name || !/^\d+$/.test(count || "")) throw new Error(`Write "${line}" as Name = days.`);
          return { name, days: Number(count) };
        });
        H.settings = (await H.put("/settings", { tests: lines(values.tests), water_systems: lines(values.water_systems), durations: parsed })).settings;
      },
    }).then(saved => { if (saved) H.show(PAGE); });
  }
  const clientForm = client => H.openClientForm(client).then(saved => { if (saved) H.show(PAGE); });

  function drawClients(host) {
    const state = { q: "", empty: showEmpty };
    const rows = () => clients.map(client => {
      const projects = contractsOf(client), own = samplesOf(projects);
      return { ...client, projects: projects.length, samples: own.length, pending: own.filter(row => row.status === "Pending").length, soon: own.filter(dueSoon).length, overdue: own.filter(sampleOverdue).length };
    }).filter(row => (state.empty || row.samples) && H.matches(state.q, [row.name, row.contact_person, row.phone, row.email]));
    H.toolbar(host, [
      { type: "search", key: "q", placeholder: "Search clients" }, { type: "check", key: "empty", label: "Show clients without samples" },
      { type: "button", label: "＋ Add Client", primary: true, edit: true, onClick: () => clientForm() },
      { type: "button", label: "Manage Lists", edit: true, onClick: openLists },
      { type: "button", label: "All Samples", onClick: () => { view = "all"; H.show(PAGE); } },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Lab Sample Clients") },
    ], () => { showEmpty = state.empty; table.show(rows()); }, state);
    const table = H.table(host, {
      id: "lab-clients", eyebrow: "LAB SAMPLES", title: "Clients", empty: 'No clients have samples yet. Tick "Show clients without samples" to add one.',
      columns: [
        { key: "name", label: "Client", value: row => row.name, html: row => `<a href="#" class="hub-link" data-act="open">${esc(row.name)}</a>` },
        { key: "contact_person", label: "Contact Person" }, { key: "phone", label: "Contact Number" }, { key: "email", label: "Email" },
        { key: "projects", label: "Projects" }, { key: "samples", label: "Samples" }, { key: "pending", label: "Pending" },
        { key: "soon", label: "Due ≤7 Days" }, { key: "overdue", label: "Overdue", html: row => row.overdue ? H.badge(row.overdue, "red") : "0", value: row => row.overdue },
      ],
      actions: [{ key: "edit", title: "Edit", edit: true }],
      on: { open: row => { view = { client: row.id }; H.show(PAGE); }, edit: clientForm },
    });
    table.show(rows());
  }
  function drawClient(host, client) {
    H.breadcrumb(host, [["Lab Samples", () => { view = "clients"; H.show(PAGE); }], [client.name]]);
    const strip = document.createElement("div");
    strip.className = "panel hub-strip";
    strip.innerHTML = `<strong>${esc(client.name)}</strong><span class="hub-note">${esc([client.contact_person, client.phone, client.email].filter(Boolean).join(" · ") || "No contact details")}</span>`;
    if (H.canEdit) { const edit = document.createElement("button"); edit.className = "outline"; edit.textContent = "Edit Contact"; edit.onclick = () => clientForm(client); strip.append(edit); }
    host.append(strip);
    const rows = contractsOf(client).map(contract => {
      const own = samples.filter(row => row.contract_id === contract.id), systems = {};
      own.forEach(row => { systems[row.water_system || "–"] = (systems[row.water_system || "–"] || 0) + 1; });
      const next = own.map(row => row.next_due).filter(Boolean).sort()[0];
      return { ...contract, systems, count: own.length, pending: own.filter(row => row.status === "Pending").length, next, overdue: own.filter(sampleOverdue).length };
    });
    const table = H.table(host, {
      id: "lab-projects", eyebrow: "LAB SAMPLES", title: "Projects", empty: "This client has no active contracts.",
      columns: [
        { key: "n", label: "S.No", value: (row, index) => index + 1 },
        { key: "site", label: "Project / Site", html: row => `<a href="#" class="hub-link" data-act="open">${esc(row.site)} ›</a>`, value: row => row.site },
        { key: "period_text", label: "Contract Period", html: row => `${esc(row.period_text || "–")} ${H.dueBadge(row.expiry)}`, value: row => row.period_text },
        { key: "systems", label: "Water Systems", value: row => Object.entries(row.systems).map(([name, count]) => `${name} ${count}`).join(", ") || "none", html: row => Object.entries(row.systems).map(([name, count]) => H.badge(`${name} ${count}`)).join(" ") || "none" },
        { key: "count", label: "Samples" }, { key: "pending", label: "Pending" },
        { key: "next", label: "Next Due", value: row => H.date(row.next) || "–", html: row => row.next ? H.badge(H.date(row.next), H.daysLeft(row.next) < 0 ? "red" : "green") : "–" },
        { key: "overdue", label: "Overdue", html: row => row.overdue ? H.badge(row.overdue, "red") : "0", value: row => row.overdue },
      ],
      actions: [{ key: "add", title: "Add Sample", edit: true }],
      on: { open: row => { view = { client: client.id, contract: row.id }; H.show(PAGE); }, add: row => openSample(null, { contract: row }) },
    });
    table.show(rows);
  }
  const circuit = row => `${esc(row.points || row.water_system || "–")}<br>${H.contactLine({ contact: row.contact, mobile: row.mobile, map_link: /^https?:/.test(row.location || "") ? row.location : "" })}`;
  function drawProject(host, client, contract) {
    H.breadcrumb(host, [["Lab Samples", () => { view = "clients"; H.show(PAGE); }], [client.name, () => { view = { client: client.id }; H.show(PAGE); }], [contract.site]]);
    const strip = document.createElement("div");
    strip.className = "panel hub-strip";
    strip.innerHTML = `<strong>${esc(contract.site)}</strong><span class="hub-note">${esc(contract.client || "")} · Contract: ${esc(contract.period_text || "–")}</span>${H.dueBadge(contract.expiry)}${H.contactLine(contract)}`;
    if (H.canEdit) { const edit = document.createElement("button"); edit.className = "outline"; edit.textContent = "Edit Project / Contact"; edit.onclick = () => H.openContractForm(contract, { done: () => H.show(PAGE) }); strip.append(edit); }
    host.append(strip);
    const own = samples.filter(row => row.contract_id === contract.id).sort((a, b) => (a.water_system || "").localeCompare(b.water_system || ""));
    const stats = document.createElement("div");
    stats.innerHTML = H.stats([
      { value: own.length, label: "Samples" }, { value: own.filter(row => row.status === "Pending").length, label: "Pending", tone: "amber" },
      { value: own.filter(dueSoon).length, label: "Due ≤7 days", tone: "amber" }, { value: own.filter(sampleOverdue).length, label: "Overdue", tone: "red" },
      { value: own.filter(row => row.report !== "Received").length, label: "Reports not received" },
    ]);
    host.append(stats);
    H.toolbar(host, [
      { type: "button", label: "＋ Add Sample", primary: true, edit: true, onClick: () => openSample(null, { contract }) },
      { type: "button", label: "Manage Lists", edit: true, onClick: openLists },
    ], () => {});
    const groupCounts = {};
    own.forEach(row => { groupCounts[row.water_system || "(no system)"] = (groupCounts[row.water_system || "(no system)"] || 0) + 1; });
    const table = H.table(host, {
      id: "lab-sheet", eyebrow: "LAB SAMPLES", title: "Sample Sheet", empty: "No samples yet. Add the first one.", change: inlineChange,
      group: (row, index, rows) => {
        const name = row.water_system || "(no system)";
        return index === 0 || (rows[index - 1].water_system || "(no system)") !== name ? `${esc(name)} – ${groupCounts[name]} sample${groupCounts[name] === 1 ? "" : "s"}` : "";
      },
      columns: [
        { key: "n", label: "S.No", value: (row, index) => index + 1 },
        { key: "points", label: "Circuit Details", width: 190, className: "wrap", value: row => row.points, html: circuit },
        { key: "test", label: "Test", html: row => H.badge(row.test), value: row => row.test },
        { key: "duration", label: "Duration Period" },
        { key: "next_due", label: "Next Due Date", value: row => H.date(row.next_due), html: row => row.next_due ? H.badge(H.date(row.next_due), dateClass(row)) : "–" },
        { key: "left", label: "Days Left", value: daysText, html: row => H.badge(daysText(row), dateClass(row)) },
        { key: "collection_date", label: "Sample Collection Date", value: row => H.date(row.collection_date), html: row => `<b class="hub-link">${esc(H.date(row.collection_date)) || "–"}</b>` },
        { key: "qty_due", label: "Qty Due" },
        { key: "status", label: "Status", value: row => row.status, html: row => H.inlineSelect("status", row.status, STATUS) },
        { key: "report", label: "Report", value: row => row.report, html: row => H.inlineSelect("report", row.report, REPORT) },
        { key: "notes", label: "Notes", className: "wrap" },
      ],
      actions: sampleActions, on: sampleHandlers(contract),
    });
    table.show(own);
  }
  function drawAll(host) {
    H.breadcrumb(host, [["Lab Samples", () => { view = "clients"; H.show(PAGE); }], ["All Samples"]]);
    const state = listState, by = id => contracts.find(row => row.id === id) || {};
    const months = [...new Set(samples.map(row => H.monthKey(row.next_due)).filter(Boolean))].sort();
    const names = [...new Set(samples.map(row => row.client).filter(Boolean))].sort();
    H.toolbar(host, [
      { type: "search", key: "q", placeholder: "Search samples" },
      { type: "select", key: "test", label: "Test", options: [["", "All tests"], ...H.settings.tests] },
      { type: "select", key: "water_system", label: "Water system", options: [["", "All water systems"], ...H.settings.water_systems] },
      { type: "select", key: "status", label: "Status", options: [["", "All status"], ...STATUS] },
      { type: "select", key: "report", label: "Report", options: [["", "All reports"], ...REPORT] },
      { type: "select", key: "month", label: "Due month", options: [["", "Any due month"], ...months.map(month => [month, H.monthLabel(month)])] },
      { type: "select", key: "client", label: "Client", options: [["", "All clients"], ...names] },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", "All Samples") },
    ], () => paint(), state);
    const table = H.table(host, {
      id: "lab-all", eyebrow: "LAB SAMPLES", title: "All Samples", empty: "No samples match these filters.", change: inlineChange,
      columns: [
        { key: "n", label: "S.No", value: (row, index) => index + 1 }, { key: "site", label: "Site" }, { key: "client", label: "Client" },
        { key: "contact", label: "Contact" }, { key: "period", label: "Contract Period", value: row => by(row.contract_id).period_text },
        { key: "water_system", label: "Water System" }, { key: "test", label: "Test" }, { key: "duration", label: "Duration" },
        { key: "next_due", label: "Next Due", value: row => H.date(row.next_due), html: row => row.next_due ? H.badge(H.date(row.next_due), dateClass(row)) : "–" },
        { key: "left", label: "Days Left", value: daysText },
        { key: "collection_date", label: "Collected", value: row => H.date(row.collection_date) },
        { key: "status", label: "Status", value: row => row.status, html: row => H.inlineSelect("status", row.status, STATUS) },
        { key: "report", label: "Report", value: row => row.report, html: row => H.inlineSelect("report", row.report, REPORT) },
      ],
      actions: sampleActions, on: sampleHandlers(),
    });
    const paint = () => table.show(samples.filter(row => (!state.test || row.test === state.test) && (!state.water_system || row.water_system === state.water_system)
      && (!state.status || row.status === state.status) && (!state.report || row.report === state.report)
      && (!state.month || H.monthKey(row.next_due) === state.month) && (!state.client || row.client === state.client)
      && H.matches(state.q, [row.site, row.client, row.test, row.points, row.water_system, row.contact, row.notes])));
    paint();
  }
  H.page(PAGE, {
    async render(host) {
      await load();
      if (view === "all") return drawAll(host);
      const client = view !== "clients" ? clients.find(row => row.id === view.client) : null;
      if (!client) { view = "clients"; return drawClients(host); }
      const contract = view.contract ? contracts.find(row => row.id === view.contract) : null;
      return contract ? drawProject(host, client, contract) : drawClient(host, client);
    },
  });
})();
