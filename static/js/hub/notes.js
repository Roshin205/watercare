// Delivery Notes: the list, flat item list, master sheet, and the editor with its live document preview.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "Delivery Notes";
  const STATUS = ["Pending", "Loaded", "In transit", "Delivered", "Returned"], SIGNED = ["Collected", "Pending", "Not required"];
  const FILE_KINDS = ["Delivery note", "Signed copy", "Other"];
  let tab = "notes", state = {}, notes = [], contracts = [], images = {};

  const types = () => H.settings.dn_types;
  const itemsText = note => (note.items || []).map(item => `${item.name} × ${item.qty}`).join(", ");
  const nextNumber = () => {
    const year = H.today().slice(2, 4);
    const used = notes.map(note => /^DN-(\d{2})-(\d+)$/.exec(note.dn || "")).filter(match => match && match[1] === year).map(match => Number(match[2]));
    return `DN-${year}-${String(Math.max(...used, H.number(H.settings.dn_start) - 1, 0) + 1).padStart(3, "0")}`;
  };
  async function load() {
    [notes, contracts] = await Promise.all([H.list("delivery_notes"), H.list("contracts")]);
    images = (await H.api("/company-images")).data || {};
    notes.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.dn || "").localeCompare(a.dn || ""));
  }
  const logo = () => images.logo ? H.fileUrl(images.logo, true) : "/static/icons/logo.png";
  const editable = (field, value) => `<span class="doc-editable" contenteditable="${H.canEdit}" data-field="${field}">${esc(value ?? "")}</span>`;
  // The printable note. With `live` true its text can be typed over and the form follows.
  function noteHtml(note, live = false) {
    const text = (field, value) => live ? editable(field, value) : esc(value ?? "");
    const company = H.app().company();
    return `<div class="doc-page"><div style="display:flex;justify-content:space-between;align-items:center"><img class="doc-logo" src="${logo()}" alt=""><div style="text-align:right"><h2 style="margin:0">Delivery Note</h2><b>${text("dn", note.dn)}</b><br>Date: ${esc(H.date(note.date))}</div></div>
      <h3 style="margin:14px 0 4px">${esc(company.name || "Wolgan")}</h3>
      <table><tr><th>Client</th><td>${text("client", note.client)}</td><th>SO No</th><td>${text("so", note.so)}</td></tr>
      <tr><th>Delivery Address</th><td>${text("address", note.address)}</td><th>PO / Reference</th><td>${text("po", note.po)}</td></tr>
      <tr><th>Site Contact</th><td>${text("contact", note.contact)}</td><th>Mobile</th><td>${text("mobile", note.mobile)}</td></tr>
      <tr><th>Type</th><td>${esc(note.type || "")}</td><th>Status</th><td>${esc(note.status || "")}</td></tr></table>
      <table><thead><tr><th>#</th><th>Item</th><th>Description / Size</th><th>Qty</th><th>Unit</th></tr></thead><tbody>${(note.items || []).map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.name)}</td><td>${esc(item.description)}</td><td>${esc(item.qty)}</td><td>${esc(item.unit)}</td></tr>`).join("") || '<tr><td colspan="5">No items</td></tr>'}</tbody></table>
      <table><tr><th>Delivery Person</th><td>${text("driver", note.driver)}</td><th>Mobile</th><td>${text("driver_mobile", note.driver_mobile)}</td></tr>
      <tr><th>Helpers</th><td>${text("helpers", note.helpers)}</td><th>Number Of Helpers</th><td>${text("helper_count", note.helper_count)}</td></tr></table>
      ${note.notes ? `<p><b>Notes:</b> ${text("notes", note.notes)}</p>` : ""}
      <div class="doc-signatures"><div>Delivered By: ${text("delivered_by", note.delivered_by)}<br><br>Signature &amp; Date</div><div>Received By: ${text("received_by", note.received_by)}<br><br>Signature, Stamp &amp; Date</div></div>
      ${images.footer ? `<div class="doc-footer"><img src="${H.fileUrl(images.footer, true)}" alt=""></div>` : ""}</div>`;
  }
  const downloadPdf = async (note, element) => {
    const sheet = element || (() => { const holder = document.createElement("div"); holder.style.cssText = "position:fixed;left:-9999px;top:0"; holder.innerHTML = noteHtml(note); document.body.append(holder); return holder; })();
    try { await H.pdfFromPages([sheet.querySelector(".doc-page")], `${note.dn || "delivery-note"}.pdf`); }
    catch (error) { H.fail(error); }
    if (!element) sheet.remove();
  };
  function preview(note) {
    H.popup({
      title: note.dn, html: noteHtml(note),
      tools: [
        { label: "PDF", primary: true, onClick: popup => downloadPdf(note, popup.body) },
        { label: "Print", onClick: () => H.print(note.dn, noteHtml(note)) },
        { label: "Copy Link", onClick: () => { navigator.clipboard?.writeText(`${location.origin}/#/note/${note.id}`); H.notice("Link copied. Anyone signed in with access can open this note."); } },
        ...(H.canEdit ? [{ label: "Edit", onClick: popup => { popup.close(); openEditor(note); } }] : []),
      ],
    });
  }
  H.openNote = async id => { await load(); const note = notes.find(row => row.id === id); if (note) preview(note); };

  // ---- Editor: live preview on the left, form on the right, with a divider that can be dragged. -------------------
  function openEditor(row, { copy = false } = {}) {
    const note = row ? JSON.parse(JSON.stringify(row)) : { date: H.today(), type: "Chemicals", status: "Pending", signed: "Pending", items: [{ name: "", description: "", qty: "", unit: "" }] };
    if (copy) { delete note.id; note.dn = ""; note.customer_text = ""; note.status = "Pending"; note.signed = "Pending"; note.received_by = ""; }
    if (!note.dn) note.dn = nextNumber();
    let dirty = false;
    const field = (key, label, type = "text", extra = "") => `<label>${label}<input name="${key}" type="${type}" value="${esc(note[key] ?? "")}" ${extra}></label>`;
    const popup = H.popup({
      title: row && !copy ? `Edit ${note.dn}` : "New Delivery Note", className: "hub-editor", html: "",
      tools: [
        { label: "Save", primary: true, onClick: () => save() },
        { label: "PDF", onClick: () => downloadPdf(note) },
        { label: "Files", onClick: () => note.id ? H.files(note.id, { title: `Files · ${note.dn}`, kinds: FILE_KINDS }) : H.notice("Save the note first, then add its files.", true) },
      ],
    });
    popup.body.style.padding = "0";
    popup.body.innerHTML = `<div class="hub-builder"><div class="hub-builder-preview"></div><form class="hub-builder-form">
      <h3>Delivery Note</h3>${field("dn", "DN Number")}${field("date", "Date", "date")}
      <label>AMC / Site<select name="contract_id">${H.options([["", "Not linked"], ...contracts.filter(item => item.status !== "Closed" || item.id === note.contract_id).map(item => [item.id, `${item.site} · ${item.client || ""}`])], note.contract_id || "")}</select></label>
      ${field("client", "Client")}${field("so", "SO No")}${field("po", "PO / Reference")}${field("address", "Address")}${field("contact", "Site Contact Person")}${field("mobile", "Site Mobile")}
      <label>Description Type<select name="type">${H.options(Object.keys(types()), note.type)}</select></label>
      <h3>Items</h3><div id="dn-items"></div><button type="button" class="outline" id="dn-add">＋ Add Item</button>
      <h3>Delivery</h3>${field("driver", "Delivery Person")}${field("driver_mobile", "Delivery Person Mobile")}${field("helpers", "Helper Names")}${field("helper_count", "Number Of Helpers", "number")}${field("amount", "Amount (AED)", "number")}
      <label>Status<select name="status">${H.options(STATUS, note.status)}</select></label>
      <label>Signed Delivery Note<select name="signed">${H.options(SIGNED, note.signed)}</select></label>
      ${field("delivered_by", "Delivered By")}${field("received_by", "Received By")}
      <label>Notes<textarea name="notes" rows="3">${esc(note.notes || "")}</textarea></label>
      <p class="hub-form-message" role="alert"></p></form></div>`;
    const form = popup.querySelector("form"), sheet = popup.querySelector(".hub-builder-preview"), itemHost = popup.querySelector("#dn-items");
    const drawPreview = () => { sheet.innerHTML = noteHtml(note, true); };
    function drawItems() {
      const type = types()[note.type] || { items: [], units: [] };
      itemHost.innerHTML = `<datalist id="dn-item-list">${type.items.map(item => `<option value="${esc(item)}">`).join("")}</datalist>${note.items.map((item, index) => `<div class="hub-block"><div class="hub-block-head"><span>Item ${index + 1}</span><button type="button" data-remove-item="${index}" >Remove</button></div><label>Item Name<input list="dn-item-list" data-item="name" data-index="${index}" value="${esc(item.name)}"></label><label>Description / Size<input data-item="description" data-index="${index}" value="${esc(item.description)}"></label><label>Qty<input type="number" step="any" data-item="qty" data-index="${index}" value="${esc(item.qty)}"></label><label>Unit<select data-item="unit" data-index="${index}">${H.options(["", ...new Set([...type.units, item.unit].filter(Boolean))], item.unit || "")}</select></label></div>`).join("")}`;
    }
    form.oninput = event => {
      dirty = true;
      const { item, index } = event.target.dataset;
      if (item) note.items[index][item] = event.target.value;
      else if (event.target.name) note[event.target.name] = event.target.value;
      if (event.target.name === "contract_id") {
        const contract = H.fromContract(contracts, event.target.value);
        if (contract) {
          Object.assign(note, { client: contract.client || "", so: contract.so || "", site: contract.site || "", address: contract.location || "", contact: contract.contact || "", mobile: contract.mobile || "" });
          ["client", "so", "address", "contact", "mobile"].forEach(key => { form.elements[key].value = note[key]; });
        }
      }
      if (event.target.name === "type") drawItems();
      drawPreview();
    };
    popup.querySelector(".hub-builder-preview").addEventListener("input", event => {
      const key = event.target.dataset.field;
      if (key) { dirty = true; note[key] = event.target.textContent; if (form.elements[key]) form.elements[key].value = note[key]; }
    });
    popup.querySelector("#dn-add").onclick = () => { note.items.push({ name: "", description: "", qty: "", unit: "" }); drawItems(); drawPreview(); };
    itemHost.onclick = event => {
      const remove = event.target.closest("[data-remove-item]");
      if (remove) { note.items.splice(Number(remove.dataset.removeItem), 1); dirty = true; drawItems(); drawPreview(); }
    };
    async function save() {
      const message = form.querySelector(".hub-form-message");
      message.textContent = "";
      const { id, created_at: _c, updated_at: _u, ...fields } = note;
      fields.items = fields.items.filter(item => item.name);
      if (!id) delete fields.customer_text;
      try {
        const saved = (await H.save("delivery_notes", id, fields)).data;
        Object.assign(note, saved);
        dirty = false; H.notice(`${saved.dn} saved.`); H.show(PAGE);
      } catch (error) { message.textContent = error.message; }
    }
    popup.addEventListener("cancel", event => { if (dirty && !window.confirm("Close without saving your changes?")) event.preventDefault(); });
    popup.querySelector("[data-close]").addEventListener("click", event => {
      if (dirty && !window.confirm("Close without saving your changes?")) { event.stopImmediatePropagation(); event.stopPropagation(); }
    }, true);
    drawItems(); drawPreview();
    let dragging = false;
    const grid = popup.querySelector(".hub-builder");
    grid.addEventListener("pointerdown", event => {
      const box = form.getBoundingClientRect();
      if (Math.abs(event.clientX - box.left) < 6) { dragging = true; event.preventDefault(); }
    });
    addEventListener("pointermove", event => {
      if (dragging) { const box = grid.getBoundingClientRect(); grid.style.gridTemplateColumns = `${Math.max(280, event.clientX - box.left)}px minmax(300px, 1fr)`; }
    });
    addEventListener("pointerup", () => { dragging = false; });
  }
  function listsForm() {
    H.form({
      title: "Lists", wide: true,
      values: { dn_start: H.settings.dn_start, types: Object.entries(types()).map(([name, type]) => `${name} = ${type.units.join(", ")} = ${type.items.join(", ")}`).join("\n") },
      fields: [
        { key: "dn_start", label: "Starting DN Number", type: "number", hint: "Numbering continues from here or from the last number used, whichever is higher." },
        { key: "types", label: "Types (Name = units = items)", type: "textarea", rows: 8, full: true, hint: "One type per line. Units and items are separated by commas." },
      ],
      submit: async values => {
        const parsed = {};
        values.types.split("\n").map(line => line.trim()).filter(Boolean).forEach(line => {
          const [name, units = "", list = ""] = line.split("=").map(part => part.trim());
          parsed[name] = { units: units.split(",").map(part => part.trim()).filter(Boolean), items: list.split(",").map(part => part.trim()).filter(Boolean) };
        });
        H.settings = (await H.put("/settings", { dn_start: H.number(values.dn_start) || 1, dn_types: parsed })).settings;
      },
    });
  }

  // ---- Shared filters ---------------------------------------------------------------------------------------------
  const filtered = () => notes.filter(note => (!state.so || (note.so || "").includes(state.so)) && (!state.status || note.status === state.status)
    && (!state.type || note.type === state.type) && (!state.driver || note.driver === state.driver) && (!state.client || note.client === state.client)
    && (!state.signed || note.signed === state.signed) && (!state.from || (note.date || "") >= state.from) && (!state.to || (note.date || "") <= state.to)
    && H.matches(state.q, [note.dn, note.client, note.driver, note.site, itemsText(note)]));
  const unique = key => [...new Set(notes.map(note => note[key]).filter(Boolean))].sort();
  const filterItems = extra => [
    { type: "search", key: "q", placeholder: "Search DN, client, driver, chemical" },
    { type: "search", key: "so", placeholder: "SO number" },
    { type: "select", key: "status", label: "Status", options: [["", "All status"], ...STATUS] },
    { type: "select", key: "type", label: "Type", options: [["", "All types"], ...Object.keys(types())] },
    { type: "select", key: "driver", label: "Driver", options: [["", "All drivers"], ...unique("driver")] },
    { type: "select", key: "client", label: "Client", options: [["", "All clients"], ...unique("client")] },
    ...extra,
    { type: "date", key: "from", label: "From" }, { type: "date", key: "to", label: "To" },
  ];
  const noteActions = [
    { key: "edit", title: "Edit", edit: true }, { key: "preview", title: "Preview" }, { key: "pdf", title: "PDF" },
    { key: "clone", title: "Clone", edit: true }, { key: "tracker", title: "Add To Chemical Delivery", edit: true },
    { key: "files", title: "Files" }, { key: "delete", title: "Delete", edit: true },
  ];
  const noteHandlers = {
    edit: row => openEditor(row), preview, pdf: row => downloadPdf(row), clone: row => openEditor(row, { copy: true }),
    files: row => H.files(row.id, { title: `Files · ${row.dn}`, kinds: FILE_KINDS }),
    tracker: async row => {
      try { const result = await H.post(`/delivery_notes/${row.id}/to-chemicals`); H.notice(`${result.added} item(s) added to Chemical Delivery. ${result.message || ""}`); } catch (error) { H.fail(error); }
    },
    delete: async row => { if (await H.confirm(`Delete ${row.dn}?`)) { try { await H.del(`/delivery_notes/${row.id}`); H.show(PAGE); } catch (error) { H.fail(error); } } },
  };
  function driverMonitor(rows) {
    const drivers = {};
    rows.forEach(note => {
      const row = drivers[note.driver || "(no driver)"] ||= { driver: note.driver || "(no driver)", deliveries: 0, delivered: 0, helpers: 0, amount: 0 };
      row.deliveries += 1; row.delivered += note.status === "Delivered" ? 1 : 0; row.helpers += H.number(note.helper_count); row.amount += H.number(note.amount);
    });
    H.exportRows("pdf", "Driver Monitor", [
      { key: "driver", label: "Driver" }, { key: "deliveries", label: "Deliveries" }, { key: "delivered", label: "Delivered" }, { key: "helpers", label: "Helpers" },
      { key: "amount", label: "Amount (AED)", value: row => H.money(row.amount) },
    ], Object.values(drivers));
  }

  function drawNotes(host) {
    const stats = document.createElement("div");
    host.append(stats);
    H.toolbar(host, [
      ...filterItems([]),
      { type: "button", label: "＋ New Delivery Note", primary: true, edit: true, onClick: () => openEditor() },
      { type: "button", label: "Lists", edit: true, onClick: listsForm },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Delivery Notes") },
      { type: "button", label: "Master PDF", onClick: () => table.export("pdf", "Delivery Notes") },
      { type: "button", label: "Driver Monitor PDF", onClick: () => driverMonitor(filtered()) },
    ], () => paint(), state);
    const table = H.table(host, {
      id: "notes", eyebrow: "DELIVERIES", title: "Delivery Notes", empty: "No delivery notes yet.",
      columns: [
        { key: "dn", label: "DN Number", value: row => row.dn, html: row => `<a href="#" class="hub-link" data-act="preview">${esc(row.dn)}</a>` },
        { key: "date", label: "Date", value: row => H.date(row.date) },
        { key: "client", label: "Client", width: 170, value: row => row.client, html: row => `${esc(row.client)}<br><small>${esc(row.address || "")}</small><br>${H.contactLine({ contact: row.contact, mobile: row.mobile })}` },
        { key: "so", label: "SO" }, { key: "type", label: "Type" }, { key: "items", label: "Items", className: "wrap", value: itemsText },
        { key: "driver", label: "Driver" }, { key: "driver_mobile", label: "Driver Mobile" },
        { key: "helpers", label: "Helpers", value: row => [row.helper_count, row.helpers].filter(Boolean).join(" · ") },
        { key: "amount", label: "Amount", value: row => H.money(row.amount) },
        { key: "status", label: "Status", value: row => row.status, html: row => H.inlineSelect("status", row.status, STATUS) },
        { key: "delivered_by", label: "Delivered By" },
      ],
      footer: rows => `<tr><td colspan="9">Total (${rows.length} notes)</td><td>${H.money(rows.reduce((sum, row) => sum + H.number(row.amount), 0))}</td><td colspan="3"></td></tr>`,
      actions: noteActions, on: noteHandlers,
      change: { status: async (row, value) => { try { Object.assign(row, (await H.patch(`/delivery_notes/${row.id}`, { status: value })).data); paint(); } catch (error) { H.fail(error); } } },
    });
    function paint() {
      const rows = filtered();
      stats.innerHTML = H.stats([
        { value: rows.length, label: "Notes" }, { value: rows.filter(row => row.status === "Delivered").length, label: "Delivered", tone: "green" },
        { value: rows.filter(row => ["Pending", "Loaded", "In transit"].includes(row.status)).length, label: "Pending / in transit", tone: "amber" },
        { value: `AED ${H.money(rows.reduce((sum, row) => sum + H.number(row.amount), 0))}`, label: "Total amount (filtered)" }, { value: nextNumber(), label: "Next DN number" },
      ]);
      table.show(rows);
    }
    paint();
  }
  function drawFlat(host) {
    const flatRows = () => filtered().flatMap(note => (note.items?.length ? note.items : [{}]).map(item => ({ note, item })));
    H.toolbar(host, [
      ...filterItems([]),
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Delivery Items") },
      { type: "button", label: "PDF", onClick: () => table.export("pdf", "Delivery Items") },
    ], () => table.show(flatRows()), state);
    const table = H.table(host, {
      id: "notes-flat", eyebrow: "DELIVERIES", title: "Delivered Items", empty: "No delivery items yet.",
      columns: [
        { key: "dn", label: "DN", value: row => row.note.dn }, { key: "date", label: "Date", value: row => H.date(row.note.date) }, { key: "client", label: "Client", value: row => row.note.client },
        { key: "so", label: "SO", value: row => row.note.so }, { key: "type", label: "Type", value: row => row.note.type }, { key: "item", label: "Item", value: row => row.item.name },
        { key: "description", label: "Description", value: row => row.item.description }, { key: "qty", label: "Qty", value: row => row.item.qty }, { key: "unit", label: "Unit", value: row => row.item.unit },
        { key: "driver", label: "Driver", value: row => row.note.driver }, { key: "helper", label: "Helper", value: row => row.note.helpers }, { key: "status", label: "Status", value: row => row.note.status },
        { key: "signed", label: "Signed", value: row => row.note.signed }, { key: "amount", label: "Amount", value: row => H.money(row.note.amount) },
      ],
    });
    table.show(flatRows());
  }
  function drawMaster(host) {
    H.toolbar(host, [
      { type: "search", key: "q", placeholder: "Search" }, { type: "search", key: "so", placeholder: "SO number" },
      { type: "select", key: "driver", label: "Driver", options: [["", "All drivers"], ...unique("driver")] },
      { type: "select", key: "signed", label: "Signed", options: [["", "All signed"], ...SIGNED] },
      { type: "date", key: "from", label: "From" }, { type: "date", key: "to", label: "To" },
      { type: "button", label: "＋ Add Row", primary: true, edit: true, onClick: async () => { try { await H.post("/delivery_notes", { date: H.today() }); H.show(PAGE); } catch (error) { H.fail(error); } } },
      { type: "button", label: "Update All Shown Rows", edit: true, onClick: updateAll },
      { type: "button", label: "Import Excel", edit: true, onClick: importSheet },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Delivery Master Sheet") },
      { type: "button", label: "PDF", onClick: () => table.export("pdf", "Delivery Master Sheet") },
    ], () => table.show(filtered()), state);
    const cell = (key, row, type = "text") => `<input class="hub-inline-select" style="max-width:none;min-width:${type === "date" ? 120 : 90}px" type="${type}" data-change="${key}" value="${esc(row[key] ?? "")}" aria-label="${esc(key)}"${H.canEdit ? "" : " disabled"}>`;
    const table = H.table(host, {
      id: "notes-master", eyebrow: "DELIVERIES", title: "Delivery Master Sheet", empty: "No delivery notes yet.",
      columns: [
        { key: "n", label: "S.No", value: (row, index) => index + 1 },
        { key: "date", label: "Date", value: row => H.date(row.date), html: row => cell("date", row, "date") }, { key: "so", label: "SO No", value: row => row.so, html: row => cell("so", row) },
        { key: "dn", label: "DN N", value: row => row.dn, html: row => `<a href="#" class="hub-link" data-act="preview">${esc(row.dn)}</a>` },
        { key: "customer_text", label: "Customer", value: row => row.customer_text, html: row => cell("customer_text", row).replace("min-width:90px", "min-width:240px") },
        { key: "address", label: "Delivery Address", value: row => row.address, html: row => cell("address", row) }, { key: "driver", label: "Delivery Person", value: row => row.driver, html: row => cell("driver", row) },
        { key: "signed", label: "Signed Delivery Note", value: row => row.signed, html: row => `${H.inlineSelect("signed", row.signed, SIGNED)} ${H.badge(row.signed, row.signed === "Collected" ? "green" : row.signed === "Pending" ? "amber" : "grey")}` },
        { key: "amount", label: "Amount", value: row => row.amount, html: row => cell("amount", row, "number") }, { key: "helpers", label: "Helper", value: row => row.helpers, html: row => cell("helpers", row) },
      ],
      actions: [{ key: "edit", title: "Edit", edit: true }, { key: "preview", title: "Preview" }, { key: "clone", title: "Clone", edit: true }, { key: "pdf", title: "PDF" }, { key: "delete", title: "Delete", edit: true }],
      on: noteHandlers,
      change: Object.fromEntries(["date", "so", "customer_text", "address", "driver", "signed", "amount", "helpers"].map(key => [key, async (row, value) => {
        try { Object.assign(row, (await H.patch(`/delivery_notes/${row.id}`, { [key]: value })).data); } catch (error) { H.fail(error); H.show(PAGE); }
      }])),
    });
    table.show(filtered());
    function updateAll() {
      const rows = filtered();
      if (!rows.length) { H.notice("No rows are shown.", true); return; }
      H.form({
        title: `Update ${rows.length} Shown Row${rows.length === 1 ? "" : "s"}`, saveLabel: "Update Rows", values: {},
        fields: [
          { key: "signed", label: "Signed Delivery Note", type: "select", options: ["", ...SIGNED] }, { key: "driver", label: "Delivery Person" }, { key: "helpers", label: "Helper" },
          { key: "status", label: "Status", type: "select", options: ["", ...STATUS] }, { key: "address", label: "Delivery Address" }, { key: "amount", label: "Amount", type: "number" },
        ],
        submit: values => {
          const changes = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
          if (!Object.keys(changes).length) throw new Error("Fill in at least one box.");
          return H.post("/delivery_notes/bulk", { ids: rows.map(row => row.id), values: changes });
        },
      }).then(saved => { if (saved) H.show(PAGE); });
    }
    function importSheet() {
      const input = document.createElement("input");
      input.type = "file"; input.accept = ".xlsx";
      input.onchange = async () => {
        try { const result = await H.upload("/delivery_notes/import", { file: input.files[0] }); H.notice(`${result.added} added, ${result.updated} updated.`); H.show(PAGE); } catch (error) { H.fail(error); }
      };
      input.click();
    }
  }
  H.page(PAGE, {
    async render(host) {
      await load();
      H.tabs(host, [["notes", "Delivery Notes"], ["flat", "Flat List"], ["master", "Delivery Master Sheet"]], tab, next => { tab = next; H.show(PAGE); });
      if (tab === "notes") drawNotes(host); else if (tab === "flat") drawFlat(host); else drawMaster(host);
    },
  });
})();
