// Engineer Visit Schedule: the same schedule as the AMC master sheet, one row per visit.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "Engineer Visit Schedule";
  const STATES = [["due", "Due"], ["done", "Done"], ["missed", "Missed"], ["na", "Not applicable"]];
  const LABEL = Object.fromEntries(STATES);
  let range = null, state = {}, contracts = [], staff = [];

  const visitRows = () => {
    const rows = [];
    const months = new Set(H.monthsBetween(range.from, range.to));
    contracts.forEach(contract => {
      if (contract.status === "Closed") return;
      const entries = Object.entries(contract.schedule || {}).sort();
      entries.forEach(([month, visit], index) => {
        if (months.has(month)) rows.push({ contract, month, ...visit, following: entries.slice(index + 1).find(([, later]) => later.status === "due")?.[1]?.date || "" });
      });
    });
    return rows.sort((a, b) => a.month.localeCompare(b.month) || (a.contract.site || "").localeCompare(b.contract.site || ""));
  };
  const matches = row => (!state.status || row.status === state.status)
    && (!state.engineer || (state.engineer === "unallocated" ? !row.engineer : row.engineer === state.engineer))
    && (!state.client || row.contract.client === state.client)
    && H.matches(state.q, [row.contract.site, row.contract.client, row.contract.so, row.engineer, row.contract.contact, row.contract.mobile]);
  const change = async (row, values) => {
    try { Object.assign(row.contract, (await H.post(`/contracts/${row.contract.id}/schedule`, { month: row.month, ...values })).data); H.show(PAGE); }
    catch (error) { H.fail(error); }
  };
  function addVisit() {
    H.form({
      title: "Add Visit", saveLabel: "Add Visit", values: { date: H.today() },
      fields: [
        { key: "id", label: "Site", type: "select", full: true, required: true, options: [["", "Choose a site"], ...contracts.filter(row => row.status !== "Closed").map(row => [row.id, `${row.site} · ${row.client || ""}`])] },
        { key: "date", label: "Planned Date", type: "date", required: true }, { key: "engineer", label: "Engineer", type: "combo", options: staff },
      ],
      submit: values => H.post(`/contracts/${values.id}/schedule`, { month: H.monthKey(values.date), status: "due", date: values.date, engineer: values.engineer }),
    }).then(saved => { if (saved) H.show(PAGE); });
  }
  function allocateAll(rows) {
    if (!rows.length) { H.notice("No visits are shown.", true); return; }
    H.form({
      title: `Allocate Engineer To ${rows.length} Visit${rows.length === 1 ? "" : "s"}`, saveLabel: "Allocate", values: {},
      fields: [{ key: "engineer", label: "Engineer", type: "combo", options: staff, required: true, full: true }],
      submit: values => H.post("/contracts/allocate", { engineer: values.engineer, visits: rows.map(row => ({ id: row.contract.id, month: row.month })) }),
    }).then(saved => { if (saved) H.show(PAGE); });
  }
  const columns = readOnly => [
    { key: "month", label: "Month", value: row => H.monthLabel(row.month), html: row => readOnly ? esc(H.monthLabel(row.month)) : `<select class="hub-inline-select" data-change="month" aria-label="Move visit">${H.options(H.monthsBetween(H.shiftMonth(range.from, -1), H.shiftMonth(range.to, 1)).map(month => [month, H.monthLabel(month)]), row.month)}</select>` },
    { key: "client", label: "Client", value: row => row.contract.client },
    { key: "site", label: "Site", value: row => row.contract.site, html: row => readOnly ? esc(row.contract.site) : `<a href="#" class="hub-link" data-act="sheet">${esc(row.contract.site)}</a>` },
    { key: "contact", label: "Site Contact", value: row => [row.contract.contact, row.contract.mobile].filter(Boolean).join(" · "), html: row => H.contactLine(row.contract) },
    { key: "date", label: "Planned Date", value: row => H.date(row.date), html: row => readOnly ? esc(H.date(row.date)) : `<input type="date" class="hub-inline-select" data-change="date" value="${esc(row.date || "")}" aria-label="Planned date">` },
    { key: "engineer", label: "Allocated Engineer", value: row => row.engineer, html: row => readOnly ? esc(row.engineer) : `<select class="hub-inline-select" data-change="engineer" aria-label="Engineer">${H.options(["", ...new Set([...staff, row.engineer || ""])], row.engineer || "")}</select>` },
    { key: "status", label: "Status", value: row => LABEL[row.status], html: row => `${readOnly ? H.badge(LABEL[row.status]) : `<select class="hub-inline-select" data-change="status" aria-label="Status">${H.options(STATES, row.status)}</select>`}${row.approval ? ` ${H.badge(row.approval, { Approved: "green", Rejected: "red" }[row.approval] || "amber")}` : ""}` },
    { key: "following", label: "Next Schedule Date", value: row => H.date(row.following) || "–" },
  ];
  function nextFree(row) {
    let month = H.shiftMonth(row.month, 1);
    while (row.contract.schedule?.[month]) month = H.shiftMonth(month, 1);
    return month;
  }

  H.page(PAGE, {
    async render(host) {
      const readOnly = !H.canEdit;
      contracts = await H.list("contracts");
      staff = await H.staffNames();
      const year = H.today().slice(0, 4);
      range ||= { from: `${year}-01`, to: `${year}-12` };
      const months = H.monthsBetween(range.from, range.to);
      const pickMonth = month => { range = { from: month, to: month }; H.show(PAGE); };
      const strip = document.createElement("div");
      strip.className = "hub-tabs";
      strip.innerHTML = months.map(month => {
        const inMonth = contracts.filter(row => row.status !== "Closed" && row.schedule?.[month]);
        return `<button type="button" data-month="${month}" class="${months.length === 1 ? "active" : ""}">${H.monthLabel(month)} ${inMonth.filter(row => row.schedule[month].status === "done").length}/${inMonth.length}</button>`;
      }).join("");
      strip.onclick = event => { const button = event.target.closest("[data-month]"); if (button) pickMonth(button.dataset.month); };
      const shift = change => { range = { from: H.shiftMonth(range.from, change * 12), to: H.shiftMonth(range.to, change * 12) }; H.show(PAGE); };
      const shownYear = range.from.slice(0, 4);
      const stats = document.createElement("div");
      const bar = H.toolbar(host, [
        { type: "button", label: "← Year", onClick: () => shift(-1) }, { type: "button", label: "Year →", onClick: () => shift(1) },
        { type: "month", key: "from", label: "From" }, { type: "month", key: "to", label: "To" },
        { type: "button", label: "Full Year", onClick: () => { range = { from: `${shownYear}-01`, to: `${shownYear}-12` }; H.show(PAGE); } },
      ], next => { if (next.from && next.to && next.from <= next.to) { range = { from: next.from, to: next.to }; H.show(PAGE); } }, { ...range });
      host.append(strip, stats);
      const engineers = [...new Set(visitRows().map(row => row.engineer).filter(Boolean))].sort();
      const clients = [...new Set(contracts.map(row => row.client).filter(Boolean))].sort();
      H.toolbar(host, [
        { type: "search", key: "q", placeholder: "Search site, client, SO, engineer, contact" },
        { type: "select", key: "status", label: "Status", options: [["", "All status"], ["due", "Due"], ["done", "Done"], ["missed", "Missed"]] },
        { type: "select", key: "engineer", label: "Engineer", options: [["", "All engineers"], ["unallocated", "Unallocated"], ...engineers] },
        { type: "select", key: "client", label: "Client", options: [["", "All clients"], ...clients] },
        { type: "button", label: "＋ Add Visit", primary: true, edit: true, onClick: addVisit },
        { type: "button", label: "Allocate Engineer", edit: true, onClick: () => allocateAll(visitRows().filter(matches)) },
        { type: "button", label: "Auto-update Schedule", edit: true, onClick: async () => { try { await H.post("/contracts/auto-schedule"); H.show(PAGE); } catch (error) { H.fail(error); } } },
        { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Engineer Visit Schedule") },
        { type: "button", label: "PDF", onClick: () => table.export("pdf", "Engineer Visit Schedule") },
        { type: "button", label: "Print", onClick: () => H.print("Engineer Visit Schedule", table.element.innerHTML) },
      ], () => paint(), state);
      const table = H.table(host, {
        id: "visits", eyebrow: "ENGINEER VISITS", title: "Visit Schedule", limit: 700, empty: "No visits match these filters.",
        columns: columns(readOnly),
        actions: readOnly ? [] : [{ key: "copy", title: "Copy To Next Month" }, { key: "remove", title: "Remove" }],
        on: {
          sheet: row => H.openSheet(row.contract.id, () => H.show(PAGE)),
          copy: row => { const month = nextFree(row); return H.post(`/contracts/${row.contract.id}/schedule`, { month, status: "due", date: `${month}-01`, engineer: row.engineer || "" }).then(() => H.show(PAGE)).catch(H.fail); },
          remove: async row => { if (await H.confirm(`Remove the ${H.monthLabel(row.month)} visit to ${row.contract.site}?`, { action: "Remove" })) change(row, { remove: true }); },
        },
        change: {
          month: (row, value) => change(row, { move_to: value }), date: (row, value) => change(row, { date: value }),
          engineer: (row, value) => change(row, { engineer: value }), status: (row, value) => change(row, { status: value }),
        },
      });
      function paint() {
        const rows = visitRows().filter(matches), count = status => rows.filter(row => row.status === status).length;
        stats.innerHTML = H.stats([
          { value: rows.length, label: "Visits shown" }, { value: count("done"), label: "Done", tone: "green" }, { value: count("due"), label: "Not done / due", tone: "amber" },
          { value: count("missed"), label: "Missed", tone: "red" }, { value: rows.filter(row => !row.engineer).length, label: "Unallocated", tone: "amber" },
        ]);
        table.show(rows);
      }
      paint();
      return bar;
    },
  });
})();
