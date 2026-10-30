// Inventory: materials with stock worked out from their movements. Chemical Delivery adds OUT movements here.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "Inventory";
  const MOVE_TYPES = [["IN", "IN (received)"], ["OUT", "OUT (issued)"]];
  let tab = "materials", state = {}, items = [], moves = [];

  async function load() { [items, moves] = await Promise.all([H.list("inventory_items"), H.list("inventory_moves")]); }
  const stock = item => H.number(item.opening_stock) + moves.filter(move => move.item_id === item.id).reduce((sum, move) => sum + (move.type === "IN" ? 1 : -1) * H.number(move.qty), 0);
  const low = item => stock(item) <= H.number(item.min_stock);
  const value = item => stock(item) * H.number(item.unit_cost);

  function openItem(row, copy) {
    const id = copy ? null : row?.id;
    H.form({
      title: id ? `Edit ${row.name}` : "Add Material", wide: true, values: row ? { ...row, name: copy ? `${row.name} (copy)` : row.name } : { uom: "Nos" },
      fields: [
        { key: "name", label: "Material", required: true }, { key: "code", label: "Code" }, { key: "category", label: "Category", type: "combo", options: [...new Set(items.map(item => item.category).filter(Boolean)), "Chemicals", "Spare parts", "Consumables", "Equipment"] },
        { key: "uom", label: "Unit", type: "combo", options: ["Drum", "Can", "Kg", "Ltr", "Bag", "Nos", "Set", "Pcs", "Mtr"] },
        { key: "opening_stock", label: "Opening Stock", type: "number" }, { key: "min_stock", label: "Minimum Stock", type: "number", hint: "Shown as low at or below this level." },
        { key: "unit_cost", label: "Unit Cost (AED)", type: "number" }, { key: "location", label: "Store Location" }, { key: "supplier", label: "Supplier" },
        { key: "notes", label: "Notes", type: "textarea", full: true },
      ],
      submit: output => { const { id: _i, created_at: _c, updated_at: _u, ...fields } = output; return H.save("inventory_items", id, fields); },
    }).then(saved => { if (saved) H.show(PAGE); });
  }
  H.editors.material = async id => { await load(); const row = items.find(item => item.id === id); if (row) { H.app().navigate(PAGE); openItem(row); } };
  function openMove(item) {
    H.form({
      title: `Stock Movement · ${item.name}`, values: { date: H.today(), type: "IN", item_id: item.id },
      fields: [
        { key: "type", label: "Type", type: "select", options: MOVE_TYPES }, { key: "qty", label: "Quantity", type: "number", required: true },
        { key: "date", label: "Date", type: "date", required: true }, { key: "reference", label: "Reference" },
        { key: "project", label: "Project" }, { key: "client", label: "Client" }, { key: "notes", label: "Notes", type: "textarea", full: true },
      ],
      submit: values => H.post("/inventory_moves", values),
    }).then(saved => { if (saved) H.show(PAGE); });
  }
  function drawMaterials(host) {
    const categories = [...new Set(items.map(item => item.category).filter(Boolean))].sort();
    const stats = document.createElement("div");
    stats.innerHTML = H.stats([
      { value: items.length, label: "Materials" }, { value: `AED ${H.money(items.reduce((sum, item) => sum + value(item), 0))}`, label: "Stock value", tone: "green" },
      { value: items.filter(low).length, label: "Low / zero", tone: "red" },
    ]);
    host.append(stats);
    H.toolbar(host, [
      { type: "search", key: "q", placeholder: "Search material, code, supplier" },
      { type: "select", key: "category", label: "Category", options: [["", "All categories"], ...categories] },
      { type: "check", key: "low", label: "Low / zero only" },
      { type: "button", label: "＋ Add Material", primary: true, edit: true, onClick: () => openItem() },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Inventory") },
    ], () => paint(), state);
    const table = H.table(host, {
      id: "inventory", eyebrow: "STOCK", title: "Materials", empty: "No materials yet.",
      columns: [
        { key: "code", label: "Code" }, { key: "name", label: "Material" }, { key: "category", label: "Category" }, { key: "uom", label: "Unit" },
        { key: "stock", label: "Stock", value: stock, html: row => low(row) ? H.badge(stock(row), "red") : `<b>${stock(row)}</b>` },
        { key: "min_stock", label: "Minimum" }, { key: "unit_cost", label: "Unit Cost", value: row => H.money(row.unit_cost) },
        { key: "value", label: "Stock Value", value: row => H.money(value(row)) }, { key: "location", label: "Location" }, { key: "supplier", label: "Supplier" },
      ],
      actions: [
        { key: "move", title: "Stock In / Out", edit: true }, { key: "edit", title: "Edit", edit: true },
        { key: "clone", title: "Clone", edit: true }, { key: "files", title: "Files" }, { key: "delete", title: "Delete", edit: true },
      ],
      on: {
        move: openMove, edit: row => openItem(row), clone: row => openItem(row, true), files: row => H.files(row.id, { title: `Files · ${row.name}` }),
        delete: async row => { if (await H.confirm(`Delete ${row.name} and its movements?`)) { try { await H.del(`/inventory_items/${row.id}`); H.show(PAGE); } catch (error) { H.fail(error); } } },
      },
    });
    const paint = () => table.show(items.filter(item => (!state.category || item.category === state.category) && (!state.low || low(item)) && H.matches(state.q, [item.name, item.code, item.supplier, item.category])));
    paint();
  }
  function drawMoves(host) {
    const moveState = {};
    const name = row => items.find(item => item.id === row.item_id)?.name || "(removed)";
    H.toolbar(host, [
      { type: "search", key: "q", placeholder: "Search material, project, client, reference" },
      { type: "select", key: "type", label: "Type", options: [["", "IN and OUT"], "IN", "OUT"] },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", "Stock Movements") },
    ], () => paint(), moveState);
    const table = H.table(host, {
      id: "inventory-moves", eyebrow: "STOCK", title: "Stock Movements", empty: "No stock movements yet.",
      columns: [
        { key: "date", label: "Date", value: row => H.date(row.date) }, { key: "item", label: "Material", value: name },
        { key: "type", label: "Type", value: row => row.type, html: row => H.badge(row.type, row.type === "IN" ? "green" : "amber") }, { key: "qty", label: "Qty" },
        { key: "project", label: "Project" }, { key: "client", label: "Client" },
        { key: "reference", label: "Reference", value: row => (row.reference || "").startsWith("chemical:") ? "Chemical delivery" : row.reference }, { key: "notes", label: "Notes", className: "wrap" },
      ],
      actions: [{ key: "delete", title: "Delete", edit: true, show: row => !(row.reference || "").startsWith("chemical:") }],
      on: { delete: async row => { if (await H.confirm("Delete this movement?")) { try { await H.del(`/inventory_moves/${row.id}`); H.show(PAGE); } catch (error) { H.fail(error); } } } },
    });
    const paint = () => table.show([...moves].sort((a, b) => (b.date || "").localeCompare(a.date || "")).filter(row => (!moveState.type || row.type === moveState.type) && H.matches(moveState.q, [name(row), row.project, row.client, row.reference])));
    paint();
  }
  H.page(PAGE, {
    async render(host) {
      await load();
      H.tabs(host, [["materials", "Materials"], ["moves", "Stock Movements"]], tab, next => { tab = next; H.show(PAGE); });
      if (tab === "materials") drawMaterials(host); else drawMoves(host);
    },
  });
})();
