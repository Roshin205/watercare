// Chemical Delivery: contracted quantities and monthly deliveries per site, linked to Inventory.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "Chemical Delivery";
  let openSite = null, state = {}, lines = [], contracts = [], range = null;

  const delivered = line => Object.values(line.months || {}).reduce((sum, value) => sum + H.number(value), 0);
  const remaining = line => Math.max(H.number(line.contract_qty) - delivered(line), 0);
  const over = line => Math.max(delivered(line) - H.number(line.contract_qty), 0);
  const lastDelivery = line => Object.keys(line.months || {}).sort().pop() || "";
  const siteKey = line => line.contract_id || `name:${line.site || "(no site)"}`;
  const uomOptions = () => [...new Set(Object.values(H.settings.dn_types).flatMap(type => type.units))];

  function lineFields() {
    return [
      H.siteField(contracts),
      { key: "site", label: "Sheet / Site Name" }, { key: "block", label: "Block / Period" }, { key: "so", label: "SO" }, { key: "system", label: "System" },
      { key: "supplier", label: "Supplier" }, { key: "chemical", label: "Chemical", type: "combo", options: H.settings.chemicals, required: true },
      { key: "description", label: "Description" }, { key: "uom", label: "UoM", type: "combo", options: uomOptions() },
      { key: "contract_qty", label: "Contract Qty", type: "number" }, { key: "notes", label: "Notes", type: "textarea", full: true },
    ];
  }
  function openLine(row, { copy, preset } = {}) {
    const id = copy ? null : row?.id;
    H.form({
      title: id ? "Edit Chemical Line" : "Add Chemical Line", wide: true, fields: lineFields(), values: row ? { ...row } : { ...preset },
      onChange(output, input, changed) {
        const contract = H.fromContract(contracts, output.contract_id);
        if (changed === "contract_id" && contract) { input("site").value = contract.site || ""; input("so").value = contract.so || ""; }
      },
      submit(output) {
        const { id: _i, created_at: _c, updated_at: _u, ...fields } = output;
        const contract = H.fromContract(contracts, output.contract_id);
        return H.save("chemical_lines", id, { ...fields, client: contract?.client || fields.client || "", months: copy ? {} : row?.months || {} });
      },
    }).then(saved => { if (saved) H.show(PAGE); });
  }
  const removeLine = async row => {
    if (await H.confirm(`Delete ${row.chemical}? Stock taken by its deliveries is put back.`)) {
      try { await H.del(`/chemical_lines/${row.id}`); H.show(PAGE); } catch (error) { H.fail(error); }
    }
  };
  function chemicalList() {
    H.form({
      title: "Chemical List", values: { chemicals: H.settings.chemicals.join("\n") },
      fields: [{ key: "chemicals", label: "Chemicals (one per line)", type: "textarea", rows: 12, full: true }],
      submit: async values => { H.settings = (await H.put("/settings", { chemicals: values.chemicals.split("\n").map(line => line.trim()).filter(Boolean) })).settings; },
    });
  }

  function drawSites(host) {
    const groups = {};
    lines.forEach(line => {
      const group = groups[siteKey(line)] ||= { key: siteKey(line), site: line.site || H.fromContract(contracts, line.contract_id)?.site || "(no site)", client: line.client, so: line.so, linked: Boolean(line.contract_id), lines: [] };
      group.lines.push(line);
    });
    const all = Object.values(groups), clients = [...new Set(all.map(row => row.client).filter(Boolean))].sort();
    const totals = list => ({ contract: list.reduce((sum, line) => sum + H.number(line.contract_qty), 0), done: list.reduce((sum, line) => sum + delivered(line), 0), left: list.reduce((sum, line) => sum + remaining(line), 0), last: list.map(lastDelivery).sort().pop() || "" });
    const stats = document.createElement("div");
    const allLines = lines;
    stats.innerHTML = H.stats([
      { value: all.length, label: "Sites" }, { value: allLines.length, label: "Chemical lines" }, { value: allLines.reduce((sum, line) => sum + delivered(line), 0), label: "Total delivered", tone: "green" },
      { value: allLines.filter(over).length, label: "Over-delivered lines", tone: "red" }, { value: all.filter(row => !row.linked).length, label: "Not linked", tone: "amber" },
    ]);
    host.append(stats);
    H.toolbar(host, [
      { type: "search", key: "q", placeholder: "Search site, client, SO" },
      { type: "select", key: "client", label: "Client", options: [["", "All clients"], ...clients] },
      { type: "select", key: "linked", label: "Linked", options: [["", "Linked and unlinked"], ["yes", "Linked"], ["no", "Unlinked"]] },
      { type: "button", label: "＋ Add Chemical Line", primary: true, edit: true, onClick: () => openLine() },
      { type: "button", label: "Chemical List", edit: true, onClick: chemicalList },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Chemical Delivery Sites") },
    ], () => paint(), state);
    const table = H.table(host, {
      id: "chem-sites", eyebrow: "CHEMICAL DELIVERY", title: "Sites", empty: "No chemical lines yet.",
      columns: [
        { key: "site", label: "Site", value: row => row.site, html: row => `<a href="#" class="hub-link" data-act="open">${esc(row.site)}</a>${row.linked ? "" : ` ${H.badge("Not linked", "amber")}`}` },
        { key: "client", label: "Client" }, { key: "so", label: "SO" }, { key: "count", label: "Lines", value: row => row.lines.length },
        { key: "contract", label: "Contract Qty", value: row => totals(row.lines).contract }, { key: "done", label: "Delivered", value: row => totals(row.lines).done },
        { key: "left", label: "Remaining", value: row => totals(row.lines).left }, { key: "last", label: "Last Delivery", value: row => totals(row.lines).last },
      ],
      on: { open: row => { openSite = row.key; H.show(PAGE); } },
    });
    const paint = () => table.show(all.filter(row => (!state.client || row.client === state.client) && (!state.linked || (state.linked === "yes") === row.linked) && H.matches(state.q, [row.site, row.client, row.so])));
    paint();
  }
  function drawSite(host) {
    const own = lines.filter(line => siteKey(line) === openSite);
    if (!own.length) { openSite = null; drawSites(host); return; }
    const first = own[0], contract = H.fromContract(contracts, first.contract_id);
    H.breadcrumb(host, [["Chemical Delivery", () => { openSite = null; H.show(PAGE); }], [first.site || contract?.site || "(no site)"]]);
    const strip = document.createElement("div");
    strip.className = "panel hub-strip";
    strip.innerHTML = `<strong>${esc(first.site || contract?.site || "")}</strong>${contract ? H.contactLine(contract) : ""}`;
    if (contract) { const open = document.createElement("button"); open.className = "outline"; open.textContent = "Project Sheet"; open.onclick = () => H.openSheet(contract.id, () => H.show(PAGE)); strip.append(open); }
    host.append(strip);
    const now = H.thisMonth();
    range ||= { from: H.shiftMonth(now, -5), to: H.shiftMonth(now, 6) };
    const shift = change => { range = { from: H.shiftMonth(range.from, change * 12), to: H.shiftMonth(range.to, change * 12) }; H.show(PAGE); };
    const capped = H.settings.cap_deliveries;
    H.toolbar(host, [
      { type: "button", label: "← Year", onClick: () => shift(-1) }, { type: "button", label: "Year →", onClick: () => shift(1) },
      { type: "month", key: "from", label: "From" }, { type: "month", key: "to", label: "To" },
      { type: "button", label: "＋ Add Line", primary: true, edit: true, onClick: () => openLine(null, { preset: { contract_id: first.contract_id, site: first.site, so: first.so, block: first.block } }) },
      { type: "button", label: capped ? "Cap: On" : "Cap: Off", edit: true, onClick: async () => { try { H.settings = (await H.put("/settings", { cap_deliveries: !capped })).settings; H.show(PAGE); } catch (error) { H.fail(error); } } },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", `Chemical Delivery ${first.site || ""}`) },
    ], next => { if (next.from && next.to && next.from <= next.to) { range = { from: next.from, to: next.to }; H.show(PAGE); } }, { ...range });
    const months = H.monthsBetween(range.from, range.to);
    const sorted = [...own].sort((a, b) => (a.block || "").localeCompare(b.block || ""));
    const table = H.table(host, {
      id: "chem-sheet", eyebrow: "CHEMICAL DELIVERY", title: "Delivery Sheet", matrix: true,
      group: (row, index, rows) => index === 0 || (rows[index - 1].block || "") !== (row.block || "") ? `${esc(row.block || "Lines")}${row.so ? ` · SO ${esc(row.so)}` : ""}` : "",
      columns: [
        { key: "chemical", label: "Chemical", width: 190, value: row => row.chemical, html: row => `${esc(row.chemical)}${row.system ? ` ${H.badge(row.system)}` : ""}<br><small>${esc([row.description, row.supplier].filter(Boolean).join(" · "))}</small>` },
        { key: "uom", label: "UoM" }, { key: "contract_qty", label: "Contract Qty" },
        ...months.map(month => ({
          key: month, label: H.monthLabel(month), value: row => row.months?.[month] ?? "", className: month === now ? "hub-this-month" : "",
          html: row => `<input class="hub-month-input" data-change="month" data-month="${month}" value="${esc(row.months?.[month] ?? "")}" aria-label="${esc(H.monthLabel(month))}"${H.canEdit ? "" : " disabled"}>`,
        })),
        { key: "delivered", label: "Delivered", value: delivered, html: row => `<b>${delivered(row)}</b>` },
        { key: "remaining", label: "Remaining", value: remaining, html: row => over(row) ? `<span title="Exceeded the contract by ${over(row)}">0*</span>` : remaining(row) },
      ],
      actions: [{ key: "edit", title: "Edit", edit: true }, { key: "clone", title: "Clone", edit: true }, { key: "delete", title: "Delete", edit: true }],
      on: { edit: row => openLine(row), clone: row => openLine(row, { copy: true }), delete: removeLine },
      change: {
        month: async (row, value, input) => {
          try {
            const result = await H.post(`/chemical_lines/${row.id}/month`, { month: input.dataset.month, qty: value });
            row.months = result.data.months;
            if (result.message) H.notice(result.message);
            table.show(sorted);
          } catch (error) { H.fail(error); input.value = row.months?.[input.dataset.month] ?? ""; }
        },
      },
    });
    table.show(sorted);
  }
  H.page(PAGE, {
    async render(host) {
      [lines, contracts] = await Promise.all([H.list("chemical_lines"), H.list("contracts")]);
      if (openSite) drawSite(host); else drawSites(host);
    },
  });
})();
