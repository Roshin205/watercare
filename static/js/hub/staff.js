// Staff Profiles (cards with documents and expiry badges) and the Staff Schedule (daily and monthly).
(() => {
  const H = window.WolganHub, esc = H.esc;
  const STATUS = ["Active", "Resigned", "Terminated", "On leave"], FILE_KINDS = ["Photo", "Passport", "Emirates ID", "Visa", "Other"];
  const PROFILES = "Staff Profiles", SCHEDULE = "Staff Schedule";
  let state = {}, staff = [], index = {};

  const expiring = person => ["eid_expiry", "visa_expiry", "passport_expiry"].some(key => { const left = H.daysLeft(person[key]); return left !== null && left <= 60; });
  const initials = name => (name || "?").split(/\s+/).slice(0, 2).map(word => word[0]).join("").toUpperCase();
  H.avatar = (person, photo, extra = "") => `<span class="hub-avatar ${extra}">${photo ? `<img src="${H.fileUrl(photo, true)}" alt="">` : esc(initials(person.name))}</span>`;
  H.staffPhotos = async () => (await H.api("/file-index?collection=staff")).data || {};
  async function load() { [staff, index] = await Promise.all([H.list("staff"), H.staffPhotos()]); }

  let chosenPicture = () => null;
  const pictureField = (row, id) => `<div class="wide hub-picture-field">${H.avatar(row || {}, id ? index[id]?.photo : "")}<label>Profile Picture<input type="file" name="picture" accept="image/png,image/jpeg,image/webp"><small class="muted">JPG, PNG or WebP, up to 20 MB. It shows on staff cards, attendance and schedules.</small></label></div>`;
  function openLogin(person) {
    const admin = role => ["service_coordinator", "accountant"].includes(role);
    H.form({
      title: person.user_id ? `Reset Login · ${person.name}` : `Create Login · ${person.name}`, saveLabel: person.user_id ? "Save Login" : "Create Login", values: { email: person.email || "", role: "employee" },
      fields: [
        { key: "email", label: "Email (Used To Sign In)", type: "email", required: !person.user_id, readonly: Boolean(person.user_id) },
        { key: "role", label: "Access Level", type: "select", options: [["employee", "Staff (own visits only)"], ["viewer", "Viewer (read only)"], ["service_coordinator", "Service Coordinator"], ["accountant", "Accountant"]] },
        { key: "password", label: "Password (12+ Characters)", type: "password", required: true },
        { key: "access_key", label: "Private Key (Coordinator And Accountant Only)", type: "password" },
      ],
      submit: values => {
        if (!admin(values.role)) delete values.access_key;
        return H.post(`/staff/${person.id}/login`, values);
      },
    }).then(saved => { if (saved) { H.notice(saved.message); H.show(PROFILES); } });
  }
  function openProfile(row, copy) {
    const id = copy ? null : row?.id;
    const values = row ? { ...row } : { status: "Active" };
    if (copy) { values.name = `${row.name} (copy)`; values.employee_id = ""; }
    H.form({
      title: id ? `Edit ${row.name}` : "Add Staff Member", wide: true, values,
      fields: [
        { key: "picture", type: "custom", keys: [], html: pictureField(row, id) },
        { key: "name", label: "Name", required: true }, { key: "position", label: "Position / Tag" }, { key: "employee_id", label: "Employee ID" }, { key: "mobile", label: "Mobile" },
        { key: "email", label: "Email", type: "email" }, { key: "status", label: "Status", type: "select", options: STATUS },
        { key: "specialization", label: "Specialization" }, { key: "availability", label: "Availability" },
        { key: "joined", label: "Date Joined", type: "date" }, { key: "left", label: "Date Terminated / Resigned", type: "date" },
        ...(H.identity ? [
          { key: "s1", label: "Identity Documents", type: "section" }, { key: "dob", label: "Date Of Birth", type: "date" },
          { key: "eid_no", label: "EID Number" }, { key: "eid_renewal", label: "EID Renewal Date", type: "date" }, { key: "eid_expiry", label: "EID Expiry", type: "date" },
          { key: "visa_no", label: "Visa Number" }, { key: "visa_renewal", label: "Visa Renewal Date", type: "date" }, { key: "visa_expiry", label: "Visa Expiry", type: "date" },
          { key: "passport_no", label: "Passport Number" }, { key: "passport_expiry", label: "Passport Expiry", type: "date" },
        ] : []),
        { key: "s2", label: "Vehicle & Notes", type: "section" },
        { key: "vehicle_no", label: "Vehicle Number" }, { key: "vehicle_name", label: "Vehicle Name" }, { key: "notes", label: "Notes", type: "textarea", full: true },
      ],
      onOpen: form => {
        const input = form.querySelector("[name=picture]"), preview = form.querySelector(".hub-avatar");
        input.onchange = () => { if (input.files[0]) preview.innerHTML = `<img src="${URL.createObjectURL(input.files[0])}" alt="">`; };
        chosenPicture = () => input.files[0];
      },
      submit: async output => {
        const { id: _i, created_at: _c, updated_at: _u, s1: _a, s2: _b, picture: _p, user_id: _l, ...fields } = output;
        const saved = await H.save("staff", id, fields), picture = chosenPicture();
        if (picture) await H.upload("/files", { file: picture, record_id: saved.data.id, kind: "Photo" });
        return saved;
      },
    }).then(saved => { if (saved) H.show(document.querySelector(".sidebar nav button.active")?.dataset.page === "Attendance" ? "Attendance" : PROFILES); });
  }
  H.openProfile = openProfile;
  H.editors.staff = async id => { await load(); const row = staff.find(person => person.id === id); if (row) { H.app().navigate(PROFILES); openProfile(row); } };
  const openFiles = row => H.files(row.id, { title: `Files · ${row.name}`, kinds: H.identity ? FILE_KINDS : ["Photo"], after: () => H.show(PROFILES) });
  const line = (label, value) => value ? `<dt>${esc(label)}</dt><dd>${value}</dd>` : "";
  function card(person) {
    const files = index[person.id] || {}, statusTone = { Active: "green", "On leave": "amber" }[person.status] || "grey";
    return `<article class="hub-profile" data-id="${esc(person.id)}"><div class="hub-profile-top"><button type="button" class="hub-avatar" data-do="files" title="Manage files">${files.photo ? `<img src="${H.fileUrl(files.photo, true)}" alt="">` : esc(initials(person.name))}</button><div><strong>${esc(person.name)}</strong> ${H.badge(person.status || "Active", statusTone)}<br><small>${esc(person.position || "")}</small></div></div>
      <dl>${line("Employee ID", esc(person.employee_id))}${line("Mobile", person.mobile ? `<a href="tel:${esc(person.mobile)}">${esc(person.mobile)}</a>` : "")}${line("Email", person.email ? `<a href="mailto:${esc(person.email)}">${esc(person.email)}</a>` : "")}${line("Date Of Birth", esc(H.date(person.dob)))}${line("Joined", esc(H.date(person.joined)))}${line("Left", esc(H.date(person.left)))}
      ${line("EID", person.eid_no || person.eid_expiry ? `${esc(person.eid_no || "")} ${H.dueBadge(person.eid_expiry)}${person.eid_renewal ? ` <small>renew ${esc(H.date(person.eid_renewal))}</small>` : ""}` : "")}
      ${line("Visa", person.visa_no || person.visa_expiry ? `${esc(person.visa_no || "")} ${H.dueBadge(person.visa_expiry)}${person.visa_renewal ? ` <small>renew ${esc(H.date(person.visa_renewal))}</small>` : ""}` : "")}
      ${line("Passport", person.passport_no || person.passport_expiry ? `${esc(person.passport_no || "")} ${H.dueBadge(person.passport_expiry)}` : "")}
      ${line("Specialization", esc(person.specialization))}${line("Availability", esc(person.availability))}${line("Vehicle", esc([person.vehicle_no, person.vehicle_name].filter(Boolean).join(" · ")))}${line("Files", esc((files.kinds || []).join(", ")))}</dl>
      <div class="hub-profile-actions">${H.canEdit ? '<button type="button" data-do="edit">Edit</button><button type="button" data-do="clone">Clone</button>' : ""}<button type="button" data-do="files">Files</button>${H.role === "administrator" ? `<button type="button" data-do="login">${person.user_id ? "Reset Login" : "Create Login"}</button>` : ""}${H.canEdit ? '<button type="button" data-do="delete">Delete</button>' : ""}</div></article>`;
  }
  H.page(PROFILES, {
    async render(host) {
      await load();
      const stats = document.createElement("div"), left = staff.filter(person => (person.status || "Active") !== "Active");
      stats.innerHTML = H.stats([
        { value: staff.length, label: "Total staff" }, { value: staff.length - left.length, label: "Active", tone: "green" }, { value: left.length, label: "Left / on leave", tone: "amber" },
        ...(H.identity ? [{ value: staff.filter(expiring).length, label: "Documents expiring ≤60d", tone: "red" }] : []),
      ]);
      host.append(stats);
      const shown = () => staff.filter(person => (!state.status || person.status === state.status) && H.matches(state.q, [person.name, person.position, person.employee_id, person.eid_no, person.visa_no, person.vehicle_no, person.vehicle_name]));
      H.toolbar(host, [
        { type: "search", key: "q", placeholder: "Search name, position, ID, EID, visa, vehicle" },
        { type: "select", key: "status", label: "Status", options: [["", "All status"], ...STATUS] },
        { type: "button", label: "＋ Add Staff", primary: true, edit: true, onClick: () => openProfile() },
        { type: "button", label: "Excel", onClick: () => H.exportRows("xlsx", "Staff List", [
          { key: "name", label: "Name" }, { key: "position", label: "Position" }, { key: "employee_id", label: "Employee ID" }, { key: "mobile", label: "Mobile" }, { key: "email", label: "Email" }, { key: "status", label: "Status" },
          { key: "joined", label: "Date Joined" }, { key: "vehicle_no", label: "Vehicle Number" }, { key: "vehicle_name", label: "Vehicle Name" }, { key: "notes", label: "Notes" },
          ...(H.identity ? [{ key: "eid_expiry", label: "EID Expiry" }, { key: "visa_expiry", label: "Visa Expiry" }, { key: "passport_expiry", label: "Passport Expiry" }] : []),
        ], shown()) },
        { type: "button", label: "Upload CSV", edit: true, onClick: () => {
          const input = document.createElement("input");
          input.type = "file"; input.accept = ".csv";
          input.onchange = async () => {
            try { const result = await H.upload("/staff/import", { file: input.files[0] }); H.notice(`${result.added} added, ${result.updated} updated.`); H.show(PROFILES); } catch (error) { H.fail(error); }
          };
          input.click();
        } },
      ], () => paint(), state);
      const grid = document.createElement("div");
      grid.className = "hub-profiles";
      host.append(grid);
      const paint = () => { grid.innerHTML = shown().map(card).join("") || '<p class="hub-note">No staff yet.</p>'; };
      grid.onclick = async event => {
        const action = event.target.closest("[data-do]");
        if (!action) return;
        const person = staff.find(row => row.id === action.closest("[data-id]").dataset.id);
        if (action.dataset.do === "edit") openProfile(person);
        if (action.dataset.do === "clone") openProfile(person, true);
        if (action.dataset.do === "files") openFiles(person);
        if (action.dataset.do === "login") openLogin(person);
        if (action.dataset.do === "delete" && await H.confirm(`Delete ${person.name} and their attachments?`)) {
          try { await H.del(`/staff/${person.id}`); H.show(PROFILES); } catch (error) { H.fail(error); }
        }
      };
      paint();
    },
  });

  // ---- Staff Schedule ---------------------------------------------------------------------------------------------
  const SHIFTS = ["08:00 - 17:00", "08:00 - 13:00", "13:00 - 22:00", "Night", "Off"], STATES = ["Planned", "Done", "Cancelled"];
  let view = "daily", day = null, month = null, scheduleState = {};
  function openEntry(row, copy) {
    const id = copy ? null : row?.id;
    Promise.all([H.staffNames(), H.list("contracts")]).then(([names, contracts]) => H.form({
      title: id ? "Edit Schedule Entry" : "Add Schedule Entry", values: row ? { ...row } : { date: day, status: "Planned" },
      fields: [
        { key: "date", label: "Date", type: "date", required: true }, { key: "staff", label: "Staff", type: "combo", options: names, required: true },
        { key: "shift", label: "Shift", type: "combo", options: SHIFTS }, { key: "site", label: "Site", type: "combo", options: contracts.filter(item => item.status !== "Closed").map(item => item.site) },
        { key: "task", label: "Task" }, { key: "status", label: "Status", type: "select", options: STATES }, { key: "notes", label: "Notes", type: "textarea", full: true },
      ],
      submit: output => { const { id: _i, created_at: _c, updated_at: _u, ...fields } = output; return H.save("staff_schedule", id, fields); },
    })).then(saved => { if (saved) H.show(SCHEDULE); });
  }
  H.page(SCHEDULE, {
    async render(host) {
      day ||= H.today(); month ||= H.thisMonth();
      const shownMonth = view === "daily" ? H.monthKey(day) : month;
      const entries = (await H.list("staff_schedule", `?period=${shownMonth}`)).sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.staff || "").localeCompare(b.staff || ""));
      H.tabs(host, [["daily", "Daily"], ["monthly", "Monthly"]], view, next => { view = next; H.show(SCHEDULE); });
      const rows = () => (view === "daily" ? entries.filter(row => row.date === day) : entries).filter(row => H.matches(scheduleState.q, [row.staff, row.site, row.task, row.shift]));
      const title = view === "daily" ? `Staff Schedule ${day}` : `Staff Schedule ${month}`;
      const move = change => { if (view === "daily") day = H.addDays(day, change); else month = H.shiftMonth(month, change); H.show(SCHEDULE); };
      H.toolbar(host, [
        { type: "button", label: "←", onClick: () => move(-1) },
        view === "daily" ? { type: "date", key: "day", label: "Day" } : { type: "month", key: "month", label: "Month" },
        { type: "button", label: "→", onClick: () => move(1) },
        { type: "search", key: "q", placeholder: "Search staff, site, task" },
        { type: "button", label: "＋ Add Entry", primary: true, edit: true, onClick: () => openEntry() },
        { type: "button", label: "Excel", onClick: () => table.export("xlsx", title) }, { type: "button", label: "PDF", onClick: () => table.export("pdf", title) },
      ], next => {
        if (next.day && next.day !== day) { day = next.day; H.show(SCHEDULE); return; }
        if (next.month && next.month !== month) { month = next.month; H.show(SCHEDULE); return; }
        table.show(rows());
      }, Object.assign(scheduleState, { day, month }));
      const table = H.table(host, {
        id: "staff-schedule", eyebrow: "STAFF", title: "Schedule", empty: "Nothing scheduled.",
        columns: [
          { key: "date", label: "Date", value: row => H.date(row.date) }, { key: "staff", label: "Staff" }, { key: "shift", label: "Shift" }, { key: "site", label: "Site" },
          { key: "task", label: "Task" }, { key: "status", label: "Status", value: row => row.status, html: row => H.badge(row.status || "Planned", { Done: "green", Cancelled: "grey" }[row.status] || "blue") }, { key: "notes", label: "Notes", className: "wrap" },
        ],
        actions: [{ key: "edit", title: "Edit", edit: true }, { key: "clone", title: "Clone", edit: true }, { key: "delete", title: "Delete", edit: true }],
        on: {
          edit: row => openEntry(row), clone: row => openEntry(row, true),
          delete: async row => { if (await H.confirm("Delete this entry?")) { try { await H.del(`/staff_schedule/${row.id}`); H.show(SCHEDULE); } catch (error) { H.fail(error); } } },
        },
      });
      table.show(rows());
    },
  });
})();
