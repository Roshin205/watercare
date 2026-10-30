// Site Directory: every active contract's site with its contacts and map link. Changes are made on the contract itself.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "Site Directory";
  let state = {};
  H.page(PAGE, {
    async render(host) {
      const contracts = await H.list("contracts");
      const clients = [...new Set(contracts.map(row => row.client).filter(Boolean))].sort();
      const rows = () => contracts.filter(row => (state.scope === "all" || row.status !== "Closed") && (!state.client || row.client === state.client)
        && H.matches(state.q, [row.site, row.client, row.location, row.contact, row.mobile, row.alternate, row.so]));
      const bar = H.toolbar(host, [
        { type: "search", key: "q", placeholder: "Search site, client, area, contact" },
        { type: "select", key: "client", label: "Client", options: [["", "All clients"], ...clients] },
        { type: "select", key: "scope", label: "Contracts", options: [["active", "Active sites"], ["all", "All sites"]], value: "active" },
        { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Site Directory") },
        { type: "note", key: "shown" },
      ], () => paint(), state);
      const table = H.table(host, {
        id: "sites", eyebrow: "SITES", title: "Site Directory", empty: "No sites yet. Sites come from the contracts on AMC & Site Visits.",
        columns: [
          { key: "site", label: "Site", value: row => row.site, html: row => `<a href="#" class="hub-link" data-act="sheet">${esc(row.site)}</a>` },
          { key: "client", label: "Client" }, { key: "location", label: "Location / Area" }, { key: "contact", label: "Contact Person" },
          { key: "mobile", label: "Mobile", value: row => row.mobile, html: row => row.mobile ? `<a href="tel:${esc(row.mobile)}">${esc(row.mobile)}</a>` : "–" },
          { key: "alternate", label: "Alternate" },
          { key: "map_link", label: "Map", value: row => row.map_link, html: H.mapLink },
          { key: "expiry", label: "Contract Expiry", value: row => H.date(row.expiry), html: row => `${esc(H.date(row.expiry)) || "–"} ${H.dueBadge(row.expiry)}` },
        ],
        actions: [{ key: "sheet", title: "View" }, { key: "edit", title: "Edit", edit: true }],
        on: { sheet: row => H.openSheet(row.id, () => H.show(PAGE)), edit: row => H.openContractForm(row, { done: () => H.show(PAGE) }) },
      });
      function paint() { const shown = rows(); table.show(shown); bar.note("shown", `${shown.length} sites`); }
      paint();
    },
  });
})();
