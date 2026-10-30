// PPM Planner: one yearly sheet per AMC site, in service groups with twelve monthly cells.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "PPM Planner";
  const FREQUENCY = { Monthly: 1, "Twice monthly": 1, Bimonthly: 2, Quarterly: 3, "Half-yearly": 6, Yearly: 12, "As required": 0 };
  let year = new Date().getFullYear(), state = {}, openId = null;

  const fill = frequency => {
    const step = FREQUENCY[frequency];
    return Array.from({ length: 12 }, (_, index) => step && index % step === 0 ? (frequency === "Twice monthly" ? 2 : 1) : "");
  };
  const total = row => (row.months || []).reduce((sum, value) => sum + H.number(value), 0);
  const monthNames = planner => Array.from({ length: 12 }, (_, index) => {
    const first = (planner.first_month || 1) - 1 + index, shifted = planner.year + Math.floor(first / 12);
    return `${H.monthNames[first % 12]} ${String(shifted).slice(2)}`;
  });
  H.plannerSummary = planner => {
    const names = monthNames(planner);
    return `<div class="hub-scroll"><table class="hub-matrix"><thead><tr><th>Service</th><th>Frequency</th>${names.map(name => `<th>${esc(name)}</th>`).join("")}<th>Total</th></tr></thead><tbody>${(planner.groups || []).flatMap(group => group.rows || []).map(row => `<tr><td style="text-align:left">${esc(row.service)}</td><td>${esc(row.frequency)}</td>${(row.months || []).map(value => `<td style="${value ? "background:#e9f3ee" : ""}">${esc(value)}</td>`).join("")}<td><b>${total(row)}</b></td></tr>`).join("")}</tbody></table></div>`;
  };

  function drawList(host, contracts, planners) {
    const clients = [...new Set(contracts.map(row => row.client).filter(Boolean))].sort();
    const rows = () => contracts.filter(row => row.status !== "Closed" && (!state.client || row.client === state.client) && H.matches(state.q, [row.site, row.client, row.so]));
    const yearsOf = id => planners.filter(planner => planner.contract_id === id).sort((a, b) => a.year - b.year);
    H.toolbar(host, [
      { type: "button", label: "←", onClick: () => { year -= 1; H.show(PAGE); } }, { type: "note", key: "year" }, { type: "button", label: "→", onClick: () => { year += 1; H.show(PAGE); } },
      { type: "search", key: "q", placeholder: "Search site or client" },
      { type: "select", key: "client", label: "Client", options: [["", "All clients"], ...clients] },
      { type: "button", label: "Create Planners For All Sites", primary: true, edit: true, onClick: async () => {
        try { const result = await H.post("/ppm_planners/generate", { year }); H.notice(`${result.created} planner(s) created for ${year}.`); H.show(PAGE); } catch (error) { H.fail(error); }
      } },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", `PPM Sites ${year}`) },
    ], () => table.show(rows()), state).note("year", `Year ${year}`);
    const table = H.table(host, {
      id: "ppm-sites", eyebrow: "PLANNED MAINTENANCE", title: "Sites", empty: "No active contracts yet.",
      columns: [
        { key: "site", label: "Site", html: row => `<a href="#" class="hub-link" data-act="open">${esc(row.site)}</a>`, value: row => row.site },
        { key: "client", label: "Client" }, { key: "so", label: "SO" },
        { key: "expiry", label: "Contract Expiry", value: row => H.date(row.expiry), html: row => `${esc(H.date(row.expiry)) || "–"} ${H.dueBadge(row.expiry)}` },
        { key: "years", label: "Planner Years", value: row => yearsOf(row.id).map(planner => planner.year).join(", "), html: row => yearsOf(row.id).map(planner => `<a href="#" class="hub-link" data-act="year" data-id="${esc(planner.id)}">${esc(planner.year)}</a>`).join(" · ") || '<span class="hub-note">None</span>' },
      ],
      actions: [{ key: "open", title: "Open" }],
      on: {
        year: (row, event) => { openId = event.target.dataset.id; H.show(PAGE); },
        open: async row => {
          const found = planners.find(planner => planner.contract_id === row.id && planner.year === year) || yearsOf(row.id).pop();
          if (found) { openId = found.id; H.show(PAGE); return; }
          if (!H.canEdit) { H.notice("This site has no planner yet.", true); return; }
          try {
            const created = (await H.post("/ppm_planners", {
              contract_id: row.id, client: row.client, site: row.site, contact: row.contact, year, first_month: 1,
              activity: "Planned Preventive Maintenance", groups: [{ name: `Services for ${row.site}`, rows: [] }],
            })).data;
            openId = created.id; H.show(PAGE);
          } catch (error) { H.fail(error); }
        },
      },
    });
    table.show(rows());
  }
  function drawPlanner(host, planner) {
    const readOnly = !H.canEdit, disabled = readOnly ? " disabled" : "";
    H.breadcrumb(host, [["PPM Planner", () => { openId = null; H.show(PAGE); }], [`${planner.site} · ${planner.year}`]]);
    const save = async () => {
      const { id, created_at: _c, updated_at: _u, ...fields } = planner;
      try { Object.assign(planner, (await H.patch(`/ppm_planners/${id}`, fields)).data); } catch (error) { H.fail(error); }
    };
    const sheet = document.createElement("div");
    sheet.style.cssText = "display:grid;gap:var(--hub-space)";
    const redraw = () => { draw(); save(); };
    H.toolbar(host, [
      { type: "select", key: "first_month", label: "First month", options: H.monthNames.map((name, index) => [index + 1, `Starts ${name}`]), value: planner.first_month || 1 },
      { type: "button", label: "＋ Add Service Group", primary: true, edit: true, onClick: () => { planner.groups.push({ name: `Services for ${planner.site}`, rows: [] }); redraw(); } },
      { type: "button", label: "Copy To Next Year", edit: true, onClick: async () => {
        const { id: _i, created_at: _c, updated_at: _u, ...fields } = planner;
        try { openId = (await H.post("/ppm_planners", { ...fields, year: planner.year + 1 })).data.id; H.show(PAGE); } catch (error) { H.fail(error); }
      } },
      { type: "button", label: "Print / PDF", onClick: () => H.print(`${planner.site} PPM ${planner.year}`, `<h2>${esc(planner.site)} – PPM Planner ${esc(planner.year)}</h2><p>${esc(planner.activity || "")}</p>${H.plannerSummary(planner)}`) },
    ], next => { if (Number(next.first_month) !== planner.first_month) { planner.first_month = Number(next.first_month); redraw(); } }, {});
    const heading = document.createElement("div");
    heading.className = "panel hub-planner-title";
    heading.innerHTML = `<input id="ppm-activity" value="${esc(planner.activity || "")}" aria-label="Activity" placeholder="Activity"${disabled}><span class="hub-note">${esc(planner.client || "")} · ${esc(planner.site)}${planner.contact ? ` · ${esc(planner.contact)}` : ""}</span>`;
    heading.querySelector("input").onchange = event => { planner.activity = event.target.value; save(); };
    host.append(heading, sheet);
    function draw() {
      const names = monthNames(planner);
      sheet.innerHTML = (planner.groups || []).map((group, g) => `<section class="panel hub-planner-group"><div class="hub-planner-title"><input value="${esc(group.name)}" data-group-name="${g}" aria-label="Group name"${disabled}>${readOnly ? "" : `<button type="button" class="outline" data-add-row="${g}">＋ Row</button><button type="button" class="outline" data-clone-group="${g}">Clone Group</button><button type="button" class="outline" data-delete-group="${g}">Delete Group</button>`}</div>
        <div class="hub-scroll"><table class="hub-planner"><thead><tr><th>S.No</th><th>Service Details</th><th>Frequency</th>${names.map(name => `<th>${esc(name)}</th>`).join("")}<th>Total</th><th></th></tr></thead><tbody>${(group.rows || []).map((row, r) => `<tr><td>${r + 1}</td><td><input class="text" value="${esc(row.service)}" data-field="service" data-g="${g}" data-r="${r}" aria-label="Service"${disabled}></td><td><select data-field="frequency" data-g="${g}" data-r="${r}" aria-label="Frequency"${disabled}>${H.options(Object.keys(FREQUENCY), row.frequency)}</select></td>${(row.months || []).map((value, m) => `<td class="${value ? "planned" : ""}"><input value="${esc(value)}" data-month="${m}" data-g="${g}" data-r="${r}" aria-label="${esc(names[m])}"${disabled}></td>`).join("")}<td><b>${total(row)}</b></td><td class="hub-row-actions">${readOnly ? "" : `<button type="button" data-clone-row="${g}:${r}">Clone</button><button type="button" data-delete-row="${g}:${r}">Delete</button>`}</td></tr>`).join("") || `<tr><td class="hub-empty" colspan="17">No services yet. Press ＋ Row.</td></tr>`}</tbody></table></div></section>`).join("") || '<p class="hub-note">No service groups yet.</p>';
    }
    sheet.onchange = event => {
      const { g, r, field, month, groupName } = event.target.dataset;
      if (groupName !== undefined) { planner.groups[groupName].name = event.target.value; save(); return; }
      const row = planner.groups[g]?.rows[r];
      if (!row) return;
      if (field === "frequency") { row.frequency = event.target.value; row.months = fill(row.frequency); }
      else if (field) row[field] = event.target.value;
      else if (month !== undefined) row.months[month] = event.target.value === "" ? "" : H.number(event.target.value) || event.target.value;
      redraw();
    };
    sheet.onclick = async event => {
      const data = event.target.dataset;
      if (data.addRow !== undefined) { planner.groups[data.addRow].rows.push({ service: "", frequency: "Monthly", months: fill("Monthly") }); redraw(); }
      if (data.cloneGroup !== undefined) { planner.groups.splice(Number(data.cloneGroup) + 1, 0, JSON.parse(JSON.stringify(planner.groups[data.cloneGroup]))); redraw(); }
      if (data.deleteGroup !== undefined && await H.confirm("Delete this service group?")) { planner.groups.splice(data.deleteGroup, 1); redraw(); }
      if (data.cloneRow) { const [g, r] = data.cloneRow.split(":").map(Number); planner.groups[g].rows.splice(r + 1, 0, JSON.parse(JSON.stringify(planner.groups[g].rows[r]))); redraw(); }
      if (data.deleteRow) { const [g, r] = data.deleteRow.split(":").map(Number); planner.groups[g].rows.splice(r, 1); redraw(); }
    };
    draw();
  }
  H.page(PAGE, {
    async render(host) {
      const [contracts, planners] = await Promise.all([H.list("contracts"), H.list("ppm_planners")]);
      const planner = openId && planners.find(row => row.id === openId);
      if (planner) { planner.groups ||= []; drawPlanner(host, planner); } else drawList(host, contracts, planners);
    },
  });
})();
