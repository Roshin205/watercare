// Visit completions: the engineer's Work Completion form, and the office's Approvals page with its history.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "Approvals";
  let state = {};

  const timing = (actual, planned) => !actual ? "Choose an actual completion date" : actual === planned ? "Completed on the Scheduled Date" : actual < planned ? "Completed Before the Scheduled Date" : "Completed After the Scheduled Date";
  const photosOf = (files, side, month) => files.filter(file => file.image_type === `${side}:${month}`);
  const photoStrip = list => list.map(file => `<a href="${H.fileUrl(file.id, true)}" target="_blank" rel="noopener"><img src="${H.fileUrl(file.id, true)}" alt=""></a>`).join("");

  // Opens for the engineer to fill in, or read-only once it is waiting or approved.
  H.openCompletion = async ({ contractId, month, site, client, planned, engineer, approval, reason, completion = {}, readOnly, done }) => {
    const locked = readOnly || approval === "Pending Approval" || approval === "Approved";
    const popup = H.popup({ title: "Work Completion & Approval Form", eyebrow: "SITE VISIT", wide: false, html: "<p>Loading…</p>" });
    async function draw() {
      const files = (await H.api(`/files?record_id=${encodeURIComponent(contractId)}`)).data || [];
      const side = (name, label) => {
        const saved = photosOf(files, name, month);
        return `<div class="hub-completion-photos"><b>${label}</b>${saved.length ? `<div class="hub-photo-list">${photoStrip(saved)}</div>` : '<p class="hub-note">No photos yet.</p>'}${locked ? "" : `<input type="file" accept="image/png,image/jpeg" multiple data-side="${name}" aria-label="${label}">`}</div>`;
      };
      popup.body.innerHTML = `${H.section("1. Visit Details", `<div class="hub-details">${[["Client", client], ["Site", site], ["Scheduled Date", H.date(planned)], ["Engineer", engineer]].map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value) || "–"}</strong></div>`).join("")}</div>`)}
        ${H.section("2. Work Completion Photos", `${side("Before", "Before Image")}${side("After", "After Image")}`)}
        ${H.section("3. Work Completion Date", `<div class="form-grid"><label>Actual Completion Date<input type="date" id="completion-date" value="${esc(completion.date || H.today())}" max="${esc(H.today())}"${locked ? " disabled" : ""}></label><label>Notes<textarea id="completion-notes" rows="2"${locked ? " disabled" : ""}>${esc(completion.notes || "")}</textarea></label></div><p>Completion Category: <strong id="completion-timing">${esc(timing(completion.date || H.today(), planned))}</strong></p>`)}
        ${approval ? `<div class="approval-summary"><p><b>Approval:</b> ${esc(approval)}</p>${reason ? `<p><b>Rejection Reason:</b> ${esc(reason)}</p>` : ""}</div>` : ""}
        <p class="hub-form-message" role="alert"></p>
        ${locked ? "" : `<div class="schedule-actions"><button type="button" class="primary" id="completion-send">${approval === "Rejected" ? "Resubmit For Approval" : "Submit For Approval"}</button></div>`}`;
      const message = popup.querySelector(".hub-form-message"), date = popup.querySelector("#completion-date");
      date.onchange = () => { popup.querySelector("#completion-timing").textContent = timing(date.value, planned); };
      popup.querySelectorAll("[data-side]").forEach(input => {
        input.onchange = async () => {
          message.textContent = "";
          try {
            for (const file of input.files) await H.upload("/files", { file, record_id: contractId, kind: `${input.dataset.side}:${month}` });
            const notes = popup.querySelector("#completion-notes").value, chosen = date.value;
            await draw();
            popup.querySelector("#completion-notes").value = notes; popup.querySelector("#completion-date").value = chosen;
          } catch (error) { message.textContent = error.message; }
        };
      });
      const send = popup.querySelector("#completion-send");
      if (send) send.onclick = async () => {
        send.disabled = true;
        try {
          await H.post(`/contracts/${contractId}/complete`, { month, date: date.value, notes: popup.querySelector("#completion-notes").value });
          popup.close(); H.notice("Sent for approval."); done?.();
        } catch (error) { message.textContent = error.message; send.disabled = false; }
      };
    }
    draw().catch(error => { popup.body.innerHTML = `<p class="hub-form-message">${esc(error.message)}</p>`; });
  };

  function reject(row) {
    H.form({
      title: "Reject Completion", saveLabel: "Reject Completion", values: {},
      fields: [{ key: "reason", label: "Rejection Reason", type: "textarea", required: true, full: true }],
      submit: values => H.post(`/contracts/${row.contract_id}/reject`, { month: row.month, reason: values.reason }),
    }).then(saved => { if (saved) H.show(PAGE); });
  }
  async function approve(row) {
    if (!await H.confirm(`Approve the ${H.monthLabel(row.month)} visit to ${row.site}? This marks the visit as done.`, { action: "Approve", danger: false })) return;
    try {
      await H.post(`/contracts/${row.contract_id}/approve`, { month: row.month });
      H.notice("Visit approved. You can now make its certificate from the project sheet."); H.show(PAGE);
    } catch (error) { H.fail(error); }
  }
  H.page(PAGE, {
    async render(host) {
      const { pending, history } = await H.api("/approvals");
      const matches = row => H.matches(state.q, [row.client, row.site, row.engineer, row.by, row.reference, row.actor_name, row.reason]);
      H.toolbar(host, [{ type: "search", key: "q", placeholder: "Search site, client, engineer" }], () => paint(), state);
      const waiting = H.table(host, {
        id: "approvals", eyebrow: "COMPLETION REVIEW", title: "Awaiting Approval", empty: "Nothing is waiting for approval.",
        columns: [
          { key: "client", label: "Client" }, { key: "site", label: "Site", value: row => row.site, html: row => `<a href="#" class="hub-link" data-act="view">${esc(row.site)}</a>` },
          { key: "month", label: "Visit", value: row => H.monthLabel(row.month) }, { key: "engineer", label: "Engineer", value: row => row.engineer || row.by },
          { key: "date", label: "Actual Completion Date", value: row => H.date(row.date) }, { key: "timing", label: "Completion Timing" },
        ],
        actions: [{ key: "view", title: "View" }, { key: "approve", title: "Approve" }, { key: "reject", title: "Reject" }],
        on: {
          view: row => H.openCompletion({ contractId: row.contract_id, month: row.month, site: row.site, client: row.client, planned: row.planned, engineer: row.engineer || row.by, approval: "Pending Approval", completion: row }),
          approve, reject,
        },
      });
      const past = H.table(host, {
        id: "approval-history", eyebrow: "AUDIT TRAIL", title: "Approval History", empty: "No approvals yet.",
        columns: [
          { key: "at", label: "Date & Time", value: row => H.app().formatDateTime(row.at) }, { key: "reference", label: "Site / Visit", className: "wrap" },
          { key: "change", label: "Status Change", value: row => `${row.previous_status} → ${row.new_status}` }, { key: "action", label: "Action" },
          { key: "actor_name", label: "By" }, { key: "reason", label: "Rejection Reason", className: "wrap" },
        ],
      });
      function paint() { waiting.show(pending.filter(matches)); past.show(history.filter(matches)); }
      paint();
    },
  });
})();
