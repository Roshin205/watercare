// Attendance: paint a code onto days, with public holidays, weekly off and the totals for each person.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "Attendance";
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  let tab = "grid", month = null, brush = "P";
  const inMonth = key => { const [year, number] = key.split("-").map(Number); return new Date(year, number, 0).getDate(); };
  const weekday = value => new Date(`${value}T00:00:00`).getDay();

  function drawHolidays(host, holidays) {
    const refresh = () => H.show(PAGE);
    const open = (row, copy) => H.form({
      title: row && !copy ? "Edit Holiday" : "Add Holiday", values: row ? { ...row } : {},
      fields: [{ key: "date", label: "Date", type: "date", required: true }, { key: "name", label: "Holiday", required: true }],
      submit: ({ date, name }) => H.save("holidays", copy ? null : row?.id, { date, name }),
    }).then(saved => { if (saved) refresh(); });
    H.toolbar(host, [
      { type: "button", label: "＋ Add Holiday", primary: true, edit: true, onClick: () => open() },
      { type: "note", key: "tip" },
    ], () => {}).note("tip", "Moon-sighted dates are approximate. Confirm them with the official announcement.");
    const table = H.table(host, {
      id: "holidays", eyebrow: "ATTENDANCE", title: "Public Holidays", empty: "No holidays yet.",
      columns: [{ key: "date", label: "Date", value: row => H.date(row.date) }, { key: "day", label: "Day", value: row => WEEKDAYS[weekday(row.date)] }, { key: "name", label: "Holiday" }],
      actions: [{ key: "edit", title: "Edit", edit: true }, { key: "clone", title: "Clone", edit: true }, { key: "delete", title: "Delete", edit: true }],
      on: {
        edit: row => open(row), clone: row => open(row, true),
        delete: async row => { if (await H.confirm(`Delete ${row.name}?`)) { try { await H.del(`/holidays/${row.id}`); refresh(); } catch (error) { H.fail(error); } } },
      },
    });
    table.show([...holidays].sort((a, b) => (a.date || "").localeCompare(b.date || "")));
  }
  function editCodes() {
    H.form({
      title: "Edit Codes", values: { codes: H.settings.attendance_codes.map(code => `${code.code} = ${code.name} = ${code.color}`).join("\n") },
      fields: [{ key: "codes", label: "Codes (CODE = Name = #colour)", type: "textarea", rows: 8, full: true }],
      submit: async values => {
        const codes = values.codes.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
          const [code, name, color] = line.split("=").map(part => part.trim());
          if (!code || !name) throw new Error(`Write "${line}" as CODE = Name = #colour.`);
          return { code, name, color: /^#[0-9a-f]{6}$/i.test(color || "") ? color : "#5d8ea1" };
        });
        H.settings = (await H.put("/settings", { attendance_codes: codes })).settings;
      },
    }).then(saved => { if (saved) H.show(PAGE); });
  }
  async function drawGrid(host, holidays) {
    const year = month.slice(0, 4);
    const [staff, marks, photos] = await Promise.all([H.list("staff"), H.list("attendance", `?from=${year}-01&to=${year}-12`), H.staffPhotos()]);
    const codes = H.settings.attendance_codes, colour = Object.fromEntries(codes.map(code => [code.code, code.color]));
    const days = Array.from({ length: inMonth(month) }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
    const off = H.number(H.settings.weekly_off), holidayNames = Object.fromEntries(holidays.map(day => [day.date, day.name]));
    const mark = {};
    marks.forEach(row => { mark[`${row.staff_id}:${row.date}`] = row.code; });
    const marked = id => days.some(day => mark[`${id}:${day}`]);
    const people = staff.filter(person => ["Active", "On leave", undefined, ""].includes(person.status) || marked(person.id));

    const move = change => { month = H.shiftMonth(month, change); H.show(PAGE); };
    H.toolbar(host, [
      { type: "button", label: "←", onClick: () => move(-1) }, { type: "month", key: "month", label: "Month" }, { type: "button", label: "→", onClick: () => move(1) },
      { type: "select", key: "off", label: "Weekly off", options: WEEKDAYS.map((name, index) => [index, `Off: ${name}`]), value: off },
      { type: "button", label: "Edit Codes", edit: true, onClick: editCodes },
      { type: "button", label: "＋ Add Worker", primary: true, edit: true, onClick: () => H.openProfile() },
      { type: "button", label: "Excel", onClick: () => H.exportRows("xlsx", `Attendance ${month}`, [
        { key: "name", label: "Name" }, { key: "position", label: "Position" },
        ...days.map(day => ({ key: day, label: day.slice(8), value: row => mark[`${row.id}:${day}`] || "" })),
        ...codes.map(code => ({ key: code.code, label: code.code, value: row => count(row.id, code.code) })),
      ], people) },
    ], async next => {
      if (next.month && next.month !== month) { month = next.month; H.show(PAGE); return; }
      if (Number(next.off) !== off) {
        try { H.settings = (await H.put("/settings", { weekly_off: Number(next.off) })).settings; H.show(PAGE); } catch (error) { H.fail(error); }
      }
    }, { month, off });
    const brushes = document.createElement("div");
    brushes.className = "hub-brushes";
    brushes.innerHTML = `<span class="hub-note">Choose a code, then click days:</span>${codes.map(code => `<button type="button" data-brush="${esc(code.code)}" class="${brush === code.code ? "active" : ""}"><i style="background:${esc(code.color)}"></i>${esc(code.code)} · ${esc(code.name)}</button>`).join("")}<button type="button" data-brush="" class="${brush === "" ? "active" : ""}">Clear</button>`;
    brushes.onclick = event => {
      const pick = event.target.closest("[data-brush]");
      if (pick) { brush = pick.dataset.brush; brushes.querySelectorAll("button").forEach(button => button.classList.toggle("active", button === pick)); }
    };
    if (H.canEdit) host.append(brushes);
    const panel = document.createElement("section"), wrap = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `<div class="panel-heading"><div><p class="eyebrow">ATTENDANCE</p><h2>${esc(new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</h2></div><span class="position">${people.length} staff</span></div>`;
    wrap.className = "hub-scroll";
    panel.append(wrap);
    host.append(panel);
    function count(id, code) { return days.filter(day => mark[`${id}:${day}`] === code).length; }
    const holidaysInMonth = days.filter(day => holidayNames[day]).length;
    const yearPresent = id => Object.keys(mark).filter(key => key.startsWith(`${id}:${year}`) && mark[key] === "P").length;
    function draw() {
      wrap.innerHTML = `<table class="hub-attendance"><thead><tr><th class="name">Staff</th>${days.map(day => `<th title="${esc(holidayNames[day] || "")}">${"SMTWTFS"[weekday(day)]}<br>${Number(day.slice(8))}</th>`).join("")}${codes.map(code => `<th>${esc(code.code)}</th>`).join("")}<th>Hol</th><th>Year P</th><th></th></tr></thead><tbody>${people.map(person => `<tr data-id="${esc(person.id)}"><td class="name"><div class="hub-person">${H.avatar(person, photos[person.id]?.photo, "small")}<div><b>${esc(person.name)}</b><br><small>${esc(person.position || "")}</small></div></div></td>${days.map(day => {
        const code = mark[`${person.id}:${day}`] || "", shade = holidayNames[day] ? " holiday" : weekday(day) === off ? " off" : "";
        return `<td><button type="button" class="day${code ? " marked" : shade}" data-day="${day}" style="${code ? `background:${esc(colour[code] || "#5d8ea1")}` : ""}" title="${esc(holidayNames[day] || "")}"${H.canEdit ? "" : " disabled"}>${esc(code)}</button></td>`;
      }).join("")}${codes.map(code => `<td>${count(person.id, code.code)}</td>`).join("")}<td>${holidaysInMonth + count(person.id, "H")}</td><td>${yearPresent(person.id)}</td><td class="hub-row-actions">${H.canEdit ? '<button type="button" data-row="fill" title="Mark working days present up to today">Fill</button><button type="button" data-row="edit">Edit</button><button type="button" data-row="delete">Remove</button>' : ""}</td></tr>`).join("") || `<tr><td class="hub-empty" colspan="${days.length + codes.length + 4}">No staff yet. Add a worker to start.</td></tr>`}</tbody></table>`;
    }
    async function save(list) {
      try { await H.put("/attendance", { marks: list }); }
      catch (error) { H.fail(error); H.show(PAGE); }
    }
    wrap.onclick = async event => {
      const line = event.target.closest("tr[data-id]");
      if (!line) return;
      const id = line.dataset.id, cell = event.target.closest("[data-day]"), row = event.target.closest("[data-row]");
      if (cell) {
        const day = cell.dataset.day;
        if (brush) mark[`${id}:${day}`] = brush; else delete mark[`${id}:${day}`];
        draw(); save([{ staff_id: id, date: day, code: brush }]);
      }
      if (row?.dataset.row === "fill") {
        const today = H.today();
        const fill = days.filter(day => day <= today && weekday(day) !== off && !holidayNames[day] && !mark[`${id}:${day}`]);
        fill.forEach(day => { mark[`${id}:${day}`] = "P"; });
        draw();
        if (fill.length) save(fill.map(day => ({ staff_id: id, date: day, code: "P" })));
      }
      if (row?.dataset.row === "edit") H.openProfile(people.find(person => person.id === id));
      if (row?.dataset.row === "delete") {
        const person = people.find(item => item.id === id);
        if (await H.confirm(`Remove ${person.name}? Their profile is deleted too.`)) { try { await H.del(`/staff/${id}`); H.show(PAGE); } catch (error) { H.fail(error); } }
      }
    };
    draw();
  }
  H.page(PAGE, {
    async render(host) {
      month ||= H.thisMonth();
      const holidays = await H.list("holidays");
      H.tabs(host, [["grid", "Attendance"], ["holidays", "Public Holidays"]], tab, next => { tab = next; H.show(PAGE); });
      if (tab === "grid") await drawGrid(host, holidays); else drawHolidays(host, holidays);
    },
  });
})();
