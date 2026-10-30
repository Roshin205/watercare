// The parts around the pages: the menu, top search, dashboard figures, display settings and shared links.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const MENU = [
    ["AMC & Sites", [["AMC & Site Visits", "◉"], ["Add Contract", "＋", "", "add-contract"], ["Lab Samples", "◍"], ["Engineer Visit Schedule", "▣"], ["PPM Planner", "▥"], ["Approvals", "✓"], ["Site Directory", "◎"]]],
    ["Supply", [["Chemical Delivery", "◐"], ["Delivery Notes", "▧"], ["Inventory", "▨"]]],
    ["Staff", [["Staff Profiles", "♙"], ["Staff Schedule", "◔"], ["Attendance", "◫"]]],
    ["Equipment", [["Assets", "◆"], ["Calibration", "◇"]]],
    ["Documents", [["Reports & Certificates", "✦"]]],
    ["Setup", [["Clients", "♧"], ["Services", "❖"], ["Settings", "⚙"]]],
  ];
  const THEMES = {
    Wolgan: ["#142B35", "#147D68"], Ocean: ["#0b3a5b", "#0e7490"], Lagoon: ["#0f4c5c", "#1b9aaa"], Forest: ["#1c3b2a", "#2f855a"],
    Emerald: ["#064e3b", "#059669"], Teal: ["#134e4a", "#0d9488"], Sky: ["#1e3a5f", "#2563eb"], Indigo: ["#2b2a6b", "#4f46e5"],
    Violet: ["#3b1f6b", "#7c3aed"], Plum: ["#4a1d4f", "#a21caf"], Rose: ["#5f1a37", "#be185d"], Crimson: ["#5a1414", "#b91c1c"],
    Sunset: ["#5b2a12", "#c2410c"], Amber: ["#57400f", "#b45309"], Olive: ["#3b3f14", "#65721f"], Slate: ["#1f2937", "#475569"],
    Graphite: ["#111827", "#374151"], Steel: ["#26394d", "#44617b"], Sand: ["#4b3f2f", "#8a7350"], Midnight: ["#0f172a", "#0369a1"],
  };
  const WIDTHS = { Full: "100%", Wide: "1500px", Standard: "1280px", Narrow: "1080px" };
  const DENSITIES = { Compact: [5, 10], Cosy: [8, 14], Comfortable: [12, 18], Spacious: [16, 24] };

  let assigned = [];
  const display = () => ({ ...(H.settings.team_ui || {}), ...H.ui });
  function applyDisplay() {
    const choice = display(), root = document.documentElement.style;
    const [navy, green] = THEMES[choice.theme] || [];
    const primary = choice.custom_primary || navy, accent = choice.custom_accent || green;
    if (primary) root.setProperty("--navy", primary); else root.removeProperty("--navy");
    if (accent) root.setProperty("--green", accent); else root.removeProperty("--green");
    root.setProperty("--hub-font", `${choice.text_size || 14}px`);
    const [rowPad, space] = DENSITIES[choice.density] || DENSITIES.Comfortable;
    root.setProperty("--hub-row-pad", `${rowPad}px`); root.setProperty("--hub-space", `${space}px`);
    document.querySelector(".main").style.maxWidth = WIDTHS[choice.width] || "";
    document.body.style.zoom = choice.zoom && choice.zoom !== 100 ? `${choice.zoom}%` : "";
  }
  const pageName = section => section.system ? section.name : `Section: ${section.name}`;
  function drawMenu() {
    const menu = document.querySelector("#hub-menu"), choice = display(), hidden = new Set(choice.menu_hidden || []);
    if (H.role === "employee") {
      menu.innerHTML = '<p class="nav-heading">Account</p><button data-page="Settings">⚙ <span>Settings</span></button>';
      return;
    }
    const custom = H.sections.filter(section => !section.system).map(section => [pageName(section), section.icon || "▪", section.name]);
    const groups = MENU.map(([heading, items]) => [heading, heading === "Equipment" ? [...items, ...custom] : items]);
    const order = choice.menu_order || [];
    const rank = name => { const place = order.indexOf(name); return place < 0 ? 1000 : place; };
    menu.innerHTML = groups.map(([heading, items]) => {
      const shown = [...items].sort((a, b) => rank(a[0]) - rank(b[0])).filter(([name]) => !hidden.has(name));
      if (heading === "Equipment" && H.canEdit) shown.push(["New Section", "＋"]);
      return shown.length ? `<p class="nav-heading">${esc(heading)}</p>${shown.map(([name, icon, label, action]) => action
        ? (H.canEdit ? `<button data-action="${action}">${esc(icon)} <span>${esc(name)}</span></button>` : "")
        : `<button data-page="${esc(name)}">${esc(icon)} <span>${esc(label || name)}</span></button>`).join("")}` : "";
    }).join("");
  }
  H.redrawMenu = drawMenu;
  // Top search: materials, contracts, staff and assets, opened for editing.
  function drawTop() {
    const top = document.querySelector("#hub-top");
    if (H.role === "employee") { top.innerHTML = ""; return; }
    top.innerHTML = '<input id="hub-search" type="search" placeholder="Search materials, contracts, staff, assets…" aria-label="Search everything" autocomplete="off"><div id="hub-results" class="hub-top-results" hidden></div>';
    let found = [], loaded = null, timer;
    const results = top.querySelector("#hub-results");
    async function index() {
      const [contracts, items, staff, sections] = await Promise.all([H.list("contracts"), H.list("inventory_items"), H.list("staff"), H.list("sections")]);
      const assets = sections.find(section => section.system === "assets");
      const rows = assets ? await H.list("section_rows", `?parent=${assets.id}`) : [];
      return [
        ...contracts.map(row => ({ label: row.site, detail: `Contract · ${row.client || ""} · SO ${row.so || "–"}`, text: [row.site, row.client, row.so].join(" "), open: () => H.editors.contract(row.id) })),
        ...items.map(row => ({ label: row.name, detail: `Material · ${row.category || ""}`, text: [row.name, row.code, row.category].join(" "), open: () => H.editors.material(row.id) })),
        ...staff.map(row => ({ label: row.name, detail: `Staff · ${row.position || ""}`, text: [row.name, row.position, row.employee_id].join(" "), open: () => H.editors.staff(row.id) })),
        ...rows.map(row => ({ label: row.values.item, detail: `Asset · ${row.values.model || ""}`, text: Object.values(row.values).join(" "), open: () => H.editors.asset(row.id) })),
      ];
    }
    const box = top.querySelector("#hub-search");
    box.oninput = event => {
      clearTimeout(timer);
      const search = event.target.value.trim();
      timer = setTimeout(async () => {
        if (!search) { results.hidden = true; return; }
        try { loaded ||= await index(); } catch (error) { H.fail(error); return; }
        found = loaded.filter(row => H.matches(search, [row.text])).slice(0, 30);
        results.innerHTML = found.map((row, position) => `<button type="button" data-found="${position}">${esc(row.label)}<small>${esc(row.detail)}</small></button>`).join("") || '<button type="button" disabled>No matches</button>';
        results.hidden = false;
      }, 200);
    };
    box.onfocus = () => { loaded = null; };
    results.onclick = event => {
      const pick = event.target.closest("[data-found]");
      if (pick) { results.hidden = true; box.value = ""; found[Number(pick.dataset.found)].open(); }
    };
    document.addEventListener("click", event => { if (!top.contains(event.target)) results.hidden = true; });
  }

  // Dashboard: the key figures above the map, and the detail panels under the calendar. Pages stay in the side menu.
  H.showOverview = async () => {
    const strip = document.querySelector("#hub-overview"), panels = document.querySelector("#hub-figures");
    if (H.role === "employee") return;
    let stats;
    try { stats = await H.api("/overview"); } catch (error) { H.fail(error); return; }
    if (H.app().page() !== "Dashboard") return;
    const { contracts: c, samples: s, inventory: i, staff: p, attendance: a, assets, calibration } = stats;
    strip.innerHTML = H.stats([
      { value: c.active, label: "Active Contracts" }, { value: c.overdue, label: "Visits Overdue", tone: c.overdue ? "red" : "" },
      { value: c.expiring, label: "Expiring ≤60 Days", tone: c.expiring ? "amber" : "" }, { value: s.pending, label: "Samples Pending", tone: s.pending ? "amber" : "" },
      { value: i.low, label: "Low / Zero Stock", tone: i.low ? "red" : "" }, { value: `${a.present} / ${p.active}`, label: "Present Today" },
    ]);
    const line = (label, value, tone = "") => `<li><span>${esc(label)}</span><b class="${tone}">${esc(value)}</b></li>`;
    const panel = (eyebrow, title, lines) => `<article class="panel"><p class="eyebrow">${esc(eyebrow)}</p><h2>${esc(title)}</h2><ul>${lines.join("") || '<li><span>Nothing to show yet.</span></li>'}</ul></article>`;
    panels.innerHTML = [
      panel("CONTRACTS", "AMC & Site Visits", [
        line("Visits This Month", c.visits_this_month), line("Done This Month", c.done_this_month, "green"), line("Expired", c.expired, c.expired ? "red" : ""),
        line("Reports Pending", c.reports_pending, c.reports_pending ? "amber" : ""), line("GRN Pending", c.grn_pending, c.grn_pending ? "amber" : ""),
        line("Lab Pending", c.lab_pending, c.lab_pending ? "amber" : ""), line("Invoices Pending", c.invoices_pending, c.invoices_pending ? "amber" : ""),
      ]),
      panel("STOCK", "Inventory", [
        line("Materials", i.items), line("Stock Value", `AED ${H.money(i.value)}`, "green"), line("Low / Zero", i.low, i.low ? "red" : ""),
        ...i.low_items.map(item => line(item.name, item.stock, "red")),
      ]),
      panel("TODAY", "Attendance", [
        line("Active Staff", p.active), line("Present", a.present, "green"), line("Absent", a.absent, a.absent ? "red" : ""), line("On Leave", a.leave, a.leave ? "amber" : ""),
        ...stats.holidays.map(day => line(day.name, H.date(day.date))),
      ]),
      ...(H.identity ? [panel("EXPIRING ≤60 DAYS", "Staff Documents", p.documents.map(item => line(`${item.name} · ${item.document}`, `${H.date(item.date)} (${item.days}d)`, item.days < 0 ? "red" : "amber")))] : []),
      panel("EQUIPMENT", "Assets & Calibration", [
        line("Total Asset Value", `AED ${H.money(assets?.value)}`, "green"), line("Assets", assets?.items || 0), line("Repair / Damaged", assets?.repair || 0, assets?.repair ? "amber" : ""),
        line("Calibration Due ≤30 Days", calibration?.due.length || 0, calibration?.due.length ? "red" : ""), ...(calibration?.due || []).map(item => line(item.name, H.date(item.date), "red")),
      ]),
    ].join("");
    strip.classList.remove("hidden"); panels.classList.remove("hidden");
  };
  // AMC visits and sample due dates join the dashboard calendar, and AMC sites join its map.
  H.calendarItems = async (from, to, clientId) => {
    const query = new URLSearchParams({ from, to });
    if (clientId) query.set("client_id", clientId);
    return (await H.api(`/calendar?${query}`)).data || [];
  };
  H.siteLocations = async clientId => {
    const rows = (await H.api(`/site-locations${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ""}`)).data || [];
    return rows.map(row => ({
      id: row.id, name: row.site, client_name: row.client, service: row.service, so_no: row.so, engineer_name: row.visited_by,
      location: row.location, latitude: Number(row.latitude), longitude: Number(row.longitude), system_details: row.system_details,
      approval_status: row.state, next_due: row.next_due,
    }));
  };
  // The button for a visit: what a staff member can do with it next.
  H.completionButton = task => {
    const key = esc(task.id);
    if (task.approval === "Pending Approval" || task.approval === "Approved" || task.status === "Done") return task.approval ? `<button class="outline" data-complete="${key}">View Completion</button>` : "";
    if (H.role !== "employee") return "";
    return `<button class="primary" data-complete="${key}">${task.approval === "Rejected" ? "Correct &amp; Resubmit" : "Mark Visit Done"}</button>`;
  };
  H.openVisitCompletion = (task, done) => H.openCompletion({
    contractId: task.contract_id || task.contract, month: task.month, site: task.project?.name || task.site, client: task.project?.client_name || task.client, planned: task.scheduled_date || task.planned,
    engineer: task.engineer_name || task.engineer, approval: task.approval, reason: task.rejection_reason || task.reason, completion: task.completion || {}, done,
  });
  // "Work Assigned To You": every open visit allocated to this staff member, with its map and completion buttons.
  H.drawAssigned = async (host, count) => {
    const contracts = await H.list("contracts"), visits = [];
    contracts.forEach(contract => Object.entries(contract.schedule || {}).forEach(([month, visit]) => {
      if (visit.status === "due" && visit.approval !== "Approved") visits.push({ contract, month, ...visit });
    }));
    visits.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    count.textContent = `${visits.length} open visit${visits.length === 1 ? "" : "s"}`;
    assigned = visits.map(visit => ({
      id: `${visit.contract.id}:${visit.month}`, contract_id: visit.contract.id, month: visit.month, status: "Due", approval: visit.approval, rejection_reason: visit.reason, completion: visit.completion,
      scheduled_date: visit.date, engineer_name: visit.engineer, project: { name: visit.contract.site, client_name: visit.contract.client },
    }));
    host.innerHTML = visits.map((visit, index) => `<div class="assigned-job"><div class="assigned-main"><strong>${esc(visit.contract.client || "Client not set")}</strong><strong>${esc(visit.contract.site)}</strong><span>${esc([H.date(visit.date), visit.contract.location, visit.contract.contact, visit.contract.mobile].filter(Boolean).join(" · "))}</span>${visit.approval ? `<span>${H.badge(visit.approval, { Rejected: "red" }[visit.approval] || "amber")}${visit.reason ? ` ${esc(visit.reason)}` : ""}</span>` : ""}</div><div class="assigned-actions"><button type="button" class="outline" data-locate="${esc(visit.contract.id)}">Tap To Know The Location</button>${H.mapLink(visit.contract)}${H.completionButton(assigned[index])}</div></div>`).join("") || '<p class="muted">No work is assigned to you right now.</p>';
  };
  H.findAssigned = id => assigned.find(task => task.id === id);

  // One place for a client: their details, contracts, samples and delivery notes.
  H.openClient = async id => {
    const [clients, contracts, samples, notes] = await Promise.all([H.clients(), H.list("contracts"), H.list("samples"), H.list("delivery_notes")]);
    const client = clients.find(row => row.id === id);
    if (!client) return;
    const own = contracts.filter(row => row.client_id === id), ids = new Set(own.map(row => row.id));
    const popup = H.popup({
      title: client.name, eyebrow: "CLIENT SUMMARY",
      html: `${H.section("Contact", `<div class="hub-details">${[["Contact Person", client.contact_person], ["Phone", client.phone], ["Email", client.email], ["Address", client.address]].map(([label, value]) => `<div><span>${label}</span><strong>${esc(value) || "–"}</strong></div>`).join("")}</div>`)}
        ${H.section("AMC Contracts", H.grid(["Site", "SO", "Service", "Expiry", "Next Due", "Status"], own.map(row => [`<a href="#" class="hub-link" data-sheet="${esc(row.id)}">${esc(row.site)}</a>`, esc(row.so), esc(row.service), `${esc(H.date(row.expiry))} ${H.dueBadge(row.expiry)}`, esc(H.date(row.next_due)), esc(row.status)]), "No contracts."))}
        ${H.section("Lab Samples", H.grid(["Site", "Test", "Next Due", "Status", "Report"], samples.filter(row => ids.has(row.contract_id)).map(row => [esc(row.site), esc(row.test), esc(H.date(row.next_due)), esc(row.status), esc(row.report)]), "No samples."))}
        ${H.section("Delivery Notes", H.grid(["DN", "Date", "Site", "Amount", "Status"], notes.filter(row => ids.has(row.contract_id)).map(row => [esc(row.dn), esc(H.date(row.date)), esc(row.site), esc(H.money(row.amount)), esc(row.status)]), "No delivery notes."))}`,
    });
    popup.body.onclick = event => { const link = event.target.closest("[data-sheet]"); if (link) { event.preventDefault(); popup.close(); H.openSheet(link.dataset.sheet); } };
  };

  // Settings > My Account: staff change their own picture here.
  H.myPictureField = () => H.staffId ? '<form id="my-picture" class="cert-row hub-my-picture"><label>Profile Picture<input type="file" name="file" accept="image/png,image/jpeg,image/webp" required></label><button class="primary" type="submit">Upload Picture</button></form>' : "";

  // Settings: look, menu, operations options and data.
  H.renderSettings = host => {
    const choice = display(), admin = H.canEdit;
    const all = MENU.flatMap(([, items]) => items.filter(item => !item[3]).map(([name]) => name)).filter(name => name !== "Settings");
    const order = [...(choice.menu_order || []).filter(name => all.includes(name)), ...all.filter(name => !(choice.menu_order || []).includes(name))];
    const hidden = new Set(choice.menu_hidden || []);
    const section = document.createElement("div");
    section.style.display = "contents";
    section.innerHTML = `<section class="cert-section"><h3>Look And Layout</h3><p class="hint">Your own choices.${admin ? " Save As Team Default applies them to everyone who has not chosen their own." : ""}</p>
      <form id="hub-look" class="cert-row">
        <label>Theme<select name="theme">${H.options([["", "Wolgan (default)"], ...Object.keys(THEMES).filter(name => name !== "Wolgan")], choice.theme)}</select></label>
        <label>Text size<select name="text_size">${H.options([12, 13, 14, 15, 16, 18], choice.text_size || 14)}</select></label>
        <label>Page zoom<select name="zoom">${H.options([[80, "80%"], [90, "90%"], [100, "100%"], [110, "110%"], [125, "125%"]], choice.zoom || 100)}</select></label>
        <label>Page width<select name="width">${H.options(Object.keys(WIDTHS), choice.width || "Full")}</select></label>
        <label>Spacing<select name="density">${H.options(Object.keys(DENSITIES), choice.density || "Comfortable")}</select></label>
        <label>Custom main colour<input type="color" name="custom_primary" value="${esc(choice.custom_primary || "#142B35")}"></label>
        <label>Custom accent colour<input type="color" name="custom_accent" value="${esc(choice.custom_accent || "#147D68")}"></label>
        <label><span><input type="checkbox" name="use_custom"${choice.custom_primary ? " checked" : ""}> Use custom colours</span></label>
        <button class="primary" type="submit">Save look</button>${admin ? '<button class="outline" type="button" id="hub-team">Save As Team Default</button>' : ""}
      </form></section>
      ${H.role === "employee" ? "" : `<section class="cert-section"><h3>Menu</h3><p class="hint">Untick a page to hide it. Use the arrows to reorder it inside its group.</p>
      <div id="hub-menu-list" class="hub-menu-list">${order.map(name => `<div data-name="${esc(name)}"><label><input type="checkbox"${hidden.has(name) ? "" : " checked"}> ${esc(name)}</label><span><button type="button" data-move="-1" aria-label="Move up">↑</button><button type="button" data-move="1" aria-label="Move down">↓</button></span></div>`).join("")}</div>
      <button class="primary" type="button" id="hub-menu-save">Save menu</button></section>`}
      ${admin ? `<section class="cert-section"><h3>Operations</h3><form id="hub-options" class="cert-row">
        <label><span><input type="checkbox" name="inventory_link"${H.settings.inventory_link ? " checked" : ""}> Chemical deliveries update inventory stock</span></label>
        <button class="primary" type="submit">Save options</button></form></section>` : ""}
      ${H.role === "employee" ? "" : `<section class="cert-section"><h3>Sharing And Backup</h3><p class="hint">Copy the website link to share with your team. They sign in with their own login.</p>
      <div class="cert-row"><button class="outline" type="button" id="hub-share">Copy Website Link</button>${H.role === "administrator" ? '<button class="outline" type="button" id="hub-backup">Download Backup</button>' : ""}</div></section>`}`;
    host.querySelector("section:last-child").before(section);
    const read = () => {
      const form = section.querySelector("#hub-look"), data = Object.fromEntries(new FormData(form).entries());
      const custom = form.elements.use_custom.checked;
      return { theme: data.theme, custom_primary: custom ? data.custom_primary : "", custom_accent: custom ? data.custom_accent : "", text_size: Number(data.text_size), zoom: Number(data.zoom), width: data.width, density: data.density };
    };
    section.querySelector("#hub-look").onsubmit = async event => {
      event.preventDefault();
      try { await H.saveUi(read()); applyDisplay(); H.notice("Look saved."); } catch (error) { H.fail(error); }
    };
    section.querySelector("#hub-team")?.addEventListener("click", async () => {
      try { H.settings = (await H.put("/settings", { team_ui: { ...H.settings.team_ui, ...read() } })).settings; applyDisplay(); H.notice("Saved as the team default."); } catch (error) { H.fail(error); }
    });
    host.querySelector("#my-picture")?.addEventListener("submit", async event => {
      event.preventDefault();
      try { await H.upload("/me/photo", { file: event.target.elements.file.files[0] }); event.target.reset(); H.notice("Picture saved."); } catch (error) { H.fail(error); }
    });
    const list = section.querySelector("#hub-menu-list");
    if (list) list.onclick = event => {
      const move = event.target.closest("[data-move]");
      if (!move) return;
      const row = move.closest("[data-name]");
      if (move.dataset.move === "-1" && row.previousElementSibling) row.previousElementSibling.before(row);
      if (move.dataset.move === "1" && row.nextElementSibling) row.nextElementSibling.after(row);
    };
    section.querySelector("#hub-menu-save")?.addEventListener("click", async () => {
      const rows = [...list.children];
      try {
        await H.saveUi({ menu_order: rows.map(row => row.dataset.name), menu_hidden: rows.filter(row => !row.querySelector("input").checked).map(row => row.dataset.name) });
        drawMenu(); H.app().markMenu(); H.notice("Menu saved.");
      } catch (error) { H.fail(error); }
    });
    section.querySelector("#hub-options")?.addEventListener("submit", async event => {
      event.preventDefault();
      try { H.settings = (await H.put("/settings", { inventory_link: event.target.elements.inventory_link.checked })).settings; H.notice("Options saved."); } catch (error) { H.fail(error); }
    });
    section.querySelector("#hub-share")?.addEventListener("click", () => { navigator.clipboard?.writeText(location.origin); H.notice(`Link copied: ${location.origin}`); });
    section.querySelector("#hub-backup")?.addEventListener("click", () => H.downloadGet("/backup", "wolgan-backup.json").catch(H.fail));
  };

  H.afterStart = () => { if (H.role !== "employee") H.registerSections(); drawMenu(); drawTop(); applyDisplay(); };
  // Links copied from a project sheet or delivery note open that record after sign-in.
  H.openLink = () => {
    const match = /^#\/(\w+)\/([\w-]+)$/.exec(location.hash);
    if (!match) return;
    if (match[1] === "contract") { H.app().navigate("AMC & Site Visits"); H.openSheet(match[2]); }
    if (match[1] === "note") { H.app().navigate("Delivery Notes"); H.openNote?.(match[2]); }
    if (match[1] === "report") { H.app().navigate("Reports & Certificates"); H.openReport?.(match[2]); }
  };
})();
