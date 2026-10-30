// Registers: Assets, Calibration and every custom section run on this one engine; New Section builds more of them.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const ICONS = ["▪", "▫", "◆", "◇", "■", "□", "▲", "△", "●", "○", "★", "☆"];
  const pageName = section => section.system ? section.name : `Section: ${section.name}`;
  const states = {};

  const number = (row, key) => H.number(row.values?.[key]);
  const totalValue = row => number(row, "cost") * (row.values?.qty === "" || row.values?.qty === undefined ? 1 : number(row, "qty"));
  function columnField(column, staff) {
    const type = { number: "number", date: "date", select: "select", long: "textarea" }[column.type] || "text";
    return {
      key: column.key, label: column.label, required: column.required, type: column.staff ? "combo" : type,
      options: column.staff ? staff : ["", ...(column.options || [])], full: column.type === "long",
      hint: column.auto_from ? `Left blank, it is set ${column.auto_months || 12} months after the date above.` : "",
    };
  }
  function openRow(section, row, copy) {
    const name = pageName(section), id = copy ? null : row?.id, first = section.columns[0].key;
    H.staffNames().then(staff => H.form({
      title: id ? `Edit ${row.values[first] || "Record"}` : `Add To ${section.name}`, wide: section.columns.length > 6,
      fields: section.columns.map(column => columnField(column, staff)),
      values: row ? { ...row.values, [first]: copy ? `${row.values[first]} (copy)` : row.values[first] } : {},
      submit: values => {
        const clean = Object.fromEntries(section.columns.map(column => [column.key, values[column.key]]));
        return H.save("section_rows", id, { section_id: section.id, values: clean });
      },
    })).then(saved => { if (saved) H.show(name); });
  }
  H.editors.asset = async id => {
    const sections = await H.list("sections"), section = sections.find(item => item.system === "assets");
    const row = (await H.list("section_rows", `?parent=${section.id}`)).find(item => item.id === id);
    if (row) { H.app().navigate(section.name); openRow(section, row); }
  };
  function editSection(section) {
    openBuilder(section);
  }
  async function renderSection(host, section) {
    const name = pageName(section), rows = await H.list("section_rows", `?parent=${section.id}`);
    const state = states[section.id] ||= {};
    const columns = section.columns, filterColumn = columns.find(column => column.filter);
    const badge = columns.find(column => column.badge), assets = section.system === "assets";
    const dueSoon = row => { const left = H.daysLeft(row.values?.[badge?.key]); return left !== null && left <= 30; };
    const shown = () => rows.filter(row => (!filterColumn || !state.filter || row.values[filterColumn.key] === state.filter) && H.matches(state.q, Object.values(row.values || {})));
    const costed = columns.some(column => column.key === "cost");
    const stats = document.createElement("div");
    host.append(stats);
    H.toolbar(host, [
      { type: "search", key: "q", placeholder: "Search all fields" },
      ...(filterColumn ? [{ type: "select", key: "filter", label: filterColumn.label, options: [["", `Any ${filterColumn.label.toLowerCase()}`], ...filterColumn.options] }] : []),
      { type: "button", label: "＋ Add Record", primary: true, edit: true, onClick: () => openRow(section) },
      { type: "button", label: "Excel", onClick: () => table.export("xlsx", section.name) },
      ...(!section.system ? [{ type: "button", label: "Edit Section", edit: true, onClick: () => editSection(section) }] : []),
    ], () => paint(), state);
    const table = H.table(host, {
      id: `section-${section.id}`, empty: "No records yet.",
      columns: [
        ...columns.filter(column => column.type !== "long").map(column => ({
          key: column.key, label: column.label,
          value: row => column.type === "date" ? H.date(row.values[column.key]) : row.values[column.key],
          html: column.badge ? row => `${esc(H.date(row.values[column.key]))} ${H.dueBadge(row.values[column.key], { warn: 30 })}` : undefined,
        })),
        ...(assets ? [{ key: "total_value", label: "Total Value (AED)", value: row => H.money(totalValue(row)) }] : []),
      ],
      footer: rows => costed ? `<tr><td colspan="${columns.filter(column => column.type !== "long").length + (assets ? 1 : 0) + 1}">Total cost: AED ${H.money(rows.reduce((sum, row) => sum + (assets ? totalValue(row) : number(row, "cost")), 0))}</td></tr>` : "",
      actions: [
        { key: "edit", title: "Edit", edit: true }, { key: "clone", title: "Clone", edit: true },
        { key: "files", title: section.system === "calibration" ? "Certificates" : "Attachments" }, { key: "delete", title: "Delete", edit: true },
      ],
      on: {
        edit: row => openRow(section, row), clone: row => openRow(section, row, true),
        files: row => H.files(row.id, { title: `Files · ${row.values[columns[0].key]}`, kinds: section.system === "calibration" ? ["Certificate", "Other"] : ["Attachment", "Photo", "Other"] }),
        delete: async row => { if (await H.confirm("Delete this record?")) { try { await H.del(`/section_rows/${row.id}`); H.show(name); } catch (error) { H.fail(error); } } },
      },
    });
    function paint() {
      const list = shown();
      stats.innerHTML = H.stats([
        { value: rows.length, label: "Records" }, { value: list.length, label: "Shown" },
        ...(costed ? [{ value: `AED ${H.money(list.reduce((sum, row) => sum + (assets ? totalValue(row) : number(row, "cost")), 0))}`, label: assets ? "Total value" : "Total cost", tone: "green" }] : []),
        ...(badge ? [{ value: rows.filter(dueSoon).length, label: "Due ≤30d or expired", tone: "red" }] : []),
      ]);
      table.show(list);
    }
    paint();
  }
  H.registerSections = () => {
    H.sections.forEach(section => {
      H.page(pageName(section), {
        async render(host) {
          const full = (await H.list("sections")).find(item => item.id === section.id);
          if (!full) throw new Error("This section no longer exists.");
          await renderSection(host, full);
        },
      });
    });
  };

  // ---- New Section ------------------------------------------------------------------------------------------------
  const keyFor = (label, used) => {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50) || "column";
    let key = base, count = 2;
    while (used.has(key)) key = `${base}_${count++}`;
    used.add(key);
    return key;
  };
  function openBuilder(section) {
    const columns = section ? JSON.parse(JSON.stringify(section.columns)) : [{ label: "", type: "text" }];
    const popup = H.popup({
      title: section ? `Edit ${section.name}` : "New Section", eyebrow: "CUSTOM SECTION", wide: false,
      tools: [{ label: "Save Section", primary: true, onClick: () => save() }],
      html: `<div class="form-grid"><label>Section Name *<input id="section-name" value="${esc(section?.name || "")}"></label><label>Icon<select id="section-icon">${H.options(ICONS, section?.icon || ICONS[0])}</select></label></div><h3 class="hub-form-section">Columns</h3><div id="section-columns"></div><button type="button" class="outline" id="section-add">＋ Add Column</button><p class="hub-form-message" role="alert"></p>${section ? '<button type="button" class="outline" id="section-delete">Delete This Section</button>' : ""}`,
    });
    const list = popup.querySelector("#section-columns");
    function draw() {
      list.innerHTML = columns.map((column, index) => `<div class="hub-block form-grid" data-index="${index}"><label>Column Name<input data-key="label" value="${esc(column.label)}"></label><label>Type<select data-key="type">${H.options([["text", "Text"], ["number", "Number"], ["date", "Date"], ["select", "Select"], ["long", "Long text"]], column.type)}</select></label>${column.type === "select" ? `<label class="wide">Options (comma separated)<input data-key="options" value="${esc((column.options || []).join(", "))}"></label>` : ""}<label class="hub-check"><input type="checkbox" data-key="required"${column.required ? " checked" : ""}> Required</label><button type="button" class="outline" data-remove="${index}">Remove</button></div>`).join("");
    }
    list.oninput = event => {
      const key = event.target.dataset.key, column = columns[event.target.closest("[data-index]")?.dataset.index];
      if (!key || !column) return;
      if (key === "required") column.required = event.target.checked;
      else if (key === "options") column.options = event.target.value.split(",").map(part => part.trim()).filter(Boolean);
      else column[key] = event.target.value;
      if (key === "type") { column.options ||= []; draw(); }
    };
    list.onclick = event => { const remove = event.target.closest("[data-remove]"); if (remove) { columns.splice(Number(remove.dataset.remove), 1); draw(); } };
    popup.querySelector("#section-add").onclick = () => { columns.push({ label: "", type: "text" }); draw(); };
    popup.querySelector("#section-delete")?.addEventListener("click", async () => {
      if (await H.confirm(`Delete ${section.name} and all its records?`)) {
        try { await H.del(`/sections/${section.id}`); popup.close(); await reloadSections(); H.app().navigate("Dashboard"); } catch (error) { H.fail(error); }
      }
    });
    async function save() {
      const message = popup.querySelector(".hub-form-message"), name = popup.querySelector("#section-name").value.trim();
      if (!name) { message.textContent = "Enter a section name."; return; }
      const used = new Set(columns.filter(column => column.key).map(column => column.key));
      const prepared = columns.filter(column => column.label.trim()).map(column => ({ ...column, label: column.label.trim(), key: column.key || keyFor(column.label, used) }));
      try {
        const saved = (await H.save("sections", section?.id, { name, icon: popup.querySelector("#section-icon").value, columns: prepared })).data;
        popup.close(); await reloadSections(); H.app().navigate(pageName(saved));
      } catch (error) { message.textContent = error.message; }
    }
    draw();
  }
  async function reloadSections() {
    H.sections = (await H.api("/bootstrap")).sections;
    H.registerSections(); H.redrawMenu();
  }
  H.page("New Section", {
    render(host) {
      const custom = H.sections.filter(section => !section.system);
      host.innerHTML = `<section class="panel"><p class="eyebrow">CUSTOM SECTIONS</p><h2>Build A New Register</h2><p class="muted">Add your own page with custom columns. It gets the same search, filter, clone, Excel and attachments as every other register.</p><button type="button" class="primary" id="section-new">＋ New Section</button></section>${custom.length ? `<section class="panel"><p class="eyebrow">CUSTOM SECTIONS</p><h2>Your Sections</h2>${H.grid(["Section", "Actions"], custom.map(section => [`${esc(section.icon)} ${esc(section.name)}`, `<span class="hub-row-actions"><button type="button" data-open="${esc(pageName(section))}">Open</button></span>`]))}</section>` : ""}`;
      host.querySelector("#section-new").onclick = () => openBuilder();
      host.onclick = event => { const open = event.target.closest("[data-open]"); if (open) H.app().navigate(open.dataset.open); };
    },
  });
})();
