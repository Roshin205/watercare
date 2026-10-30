// Reports & Certificates: the saved list, the report builder with its live preview, and certificates.
(() => {
  const H = window.WolganHub, esc = H.esc;
  const PAGE = "Reports & Certificates";
  const KINDS = ["Tank cleaning report", "Work completion report", "Monthly report", "Blank report", "Certificate"];
  const RATIOS = { "4:3": 4 / 3, "3:4": 3 / 4, "1:1": 1, "16:9": 16 / 9, "3:2": 3 / 2, "2:3": 2 / 3 };
  const IMAGE_KINDS = [["logo", "Logo"], ["footer", "Footer Bar"], ["stamp", "Stamp"], ["signature", "Signature"], ["background", "Certificate Background"]];
  const BLOCK_NAMES = { heading: "Heading", subheading: "Sub-heading", text: "Text", list: "List", table: "Table", keyvalue: "Key-value Rows", photos: "Photos" };
  // Everything that can be downloaded in one place, beside the Excel and PDF buttons on each page.
  const EXPORTS = {
    "AMC Contracts": ["contracts", [["client", "Client"], ["site", "Site"], ["service", "Service"], ["so", "SO"], ["start", "Start"], ["expiry", "Expiry"], ["frequency", "Frequency"], ["last_visit", "Last Visit"], ["next_due", "Next Due"], ["report", "Report"], ["grn", "GRN"], ["lab", "Lab"], ["invoice", "Invoice"], ["invoice_no", "Invoice No."], ["status", "Status"]]],
    "Lab Samples": ["samples", [["client", "Client"], ["site", "Site"], ["water_system", "Water System"], ["test", "Test"], ["duration", "Duration"], ["collection_date", "Collected"], ["next_due", "Next Due"], ["status", "Status"], ["report", "Report"], ["laboratory", "Laboratory"], ["results", "Results"]]],
    "Delivery Notes": ["delivery_notes", [["dn", "DN"], ["date", "Date"], ["client", "Client"], ["so", "SO"], ["type", "Type"], ["driver", "Driver"], ["amount", "Amount"], ["status", "Status"], ["signed", "Signed"]]],
    "Inventory": ["inventory_items", [["code", "Code"], ["name", "Material"], ["category", "Category"], ["uom", "Unit"], ["opening_stock", "Opening Stock"], ["min_stock", "Minimum"], ["unit_cost", "Unit Cost"], ["supplier", "Supplier"]]],
    "Staff List": ["staff", [["name", "Name"], ["position", "Position"], ["employee_id", "Employee ID"], ["mobile", "Mobile"], ["email", "Email"], ["status", "Status"], ["joined", "Joined"]]],
    "Clients": ["", [["name", "Client"], ["contact_person", "Contact Person"], ["phone", "Phone"], ["email", "Email"], ["address", "Address"]]],
  };
  let state = {}, contracts = [], images = {}, tab = "documents";

  const copyOf = value => JSON.parse(JSON.stringify(value));
  const headingBlock = (text, page) => ({ type: "heading", text, page });
  const textBlock = (text, page) => ({ type: "text", text, page });
  function starterBlocks(kind) {
    if (kind === "Tank cleaning report") return [
      headingBlock("Tank Details", 1), { type: "keyvalue", rows: [{ key: "Tank Identification", value: "" }, { key: "Tank Type", value: "" }, { key: "Capacity", value: "" }, { key: "Cleaning Date", value: H.today() }, { key: "Next Recommended Date", value: H.addMonths(H.today(), 6) }], page: 1 },
      headingBlock("Introduction", 1), textBlock("This report covers the cleaning and disinfection of the water tanks at the above site.", 1),
      headingBlock("Scope Of Work", 1), { type: "list", items: ["Draining the tank", "Removing sediment", "Cleaning walls and floor", "Disinfection", "Refilling and flushing"], page: 1 },
      headingBlock("Materials Used", 2), textBlock("", 2), headingBlock("Observations", 2), textBlock("", 2), headingBlock("Photos", 2), { type: "photos", photos: [], columns: 2, ratio: "4:3", size: 100, page: 2 },
      headingBlock("Conclusion", 3), textBlock("", 3),
    ];
    if (kind === "Work completion report") return [
      headingBlock("Work Details", 1), { type: "keyvalue", rows: [{ key: "Work Order", value: "" }, { key: "Completed On", value: H.today() }, { key: "Engineer", value: "" }], page: 1 },
      headingBlock("Work Carried Out", 1), textBlock("", 1), headingBlock("Before And After Photos", 2), { type: "photos", photos: [], columns: 2, ratio: "4:3", size: 100, page: 2 },
    ];
    if (kind === "Monthly report") return [
      headingBlock("Summary", 1), textBlock("", 1), headingBlock("Visits This Month", 1), { type: "table", rows: [["Date", "Engineer", "Activity"], ["", "", ""]], page: 1 },
      headingBlock("Water Quality Results", 2), { type: "table", rows: [["Parameter", "Result", "Limit"], ["", "", ""]], page: 2 },
      headingBlock("Recommendations", 2), { type: "list", items: [""], page: 2 },
    ];
    return [headingBlock("New Heading", 1), textBlock("", 1)];
  }
  function newDoc(kind, contract) {
    // A certificate fills itself in from the contract, its service and its last visit; every field can still be edited.
    if (kind === "Certificate") {
      const service = H.app().services().find(item => item.name === contract?.service);
      const completed = contract?.last_visit || H.today(), months = service?.validity_months || 6;
      return { certificate: {
        company: H.app().company().name || "Wolgan Water Treatment LLC", heading: "Certificate Of Completion", client: contract?.client || "", project: contract?.site || "",
        location: contract?.location || "", wording: "This is to certify that the following work has been completed to the required standard.",
        work: service?.certificate_text || contract?.system_details || "", reference: contract?.so ? `SO ${contract.so}` : "", engineer: contract?.visited_by || contract?.engineer || "",
        service: contract?.service || "", completed, months, expiry: H.addMonths(completed, months), expiry_manual: false,
      } };
    }
    return {
      cover: { title: kind === "Blank report" ? "Report" : kind.replace(/\b[a-z]/g, letter => letter.toUpperCase()), subtitle: "", label: "Prepared For", name: contract?.client || "", label2: "", name2: "" },
      header: { document: kind, project: contract?.site || "", client: contract?.client || "" },
      control: { enabled: true, title1: "Document Control", title2: "", rows: [{ label: "Document", value: kind, label2: "Revision", value2: "0" }, { label: "Date", value: H.today(), label2: "Reference", value2: "" }], signoff: true, prepared: "", approved: "" },
      letter: { enabled: false, from: H.app().company().name || "", to: contract?.client || "", project: contract?.site || "", subject: "", body: "", includes: [], signer: "", client_name: "" },
      toc: true, blocks: starterBlocks(kind),
    };
  }

  // ---- The document, as A4 pages ----------------------------------------------------------------------------------
  const typed = (path, value, live, tag = "span") => live ? `<${tag} class="doc-editable" contenteditable="true" data-path="${path}">${esc(value ?? "")}</${tag}>` : `<${tag}>${esc(value ?? "").replaceAll("\n", "<br>")}</${tag}>`;
  const companyImage = kind => images[kind] ? H.fileUrl(images[kind], true) : "";
  const footer = () => companyImage("footer") ? `<div class="doc-footer"><img src="${companyImage("footer")}" alt=""></div>` : "";
  function headingNumbers(blocks) {
    let count = 0;
    return blocks.map(block => block.type === "heading" ? ++count : 0);
  }
  function blockHtml(block, index, number, live) {
    const path = `blocks.${index}`;
    if (block.type === "heading") return `<h2>${number}. ${typed(`${path}.text`, block.text, live)}</h2>`;
    if (block.type === "subheading") return `<h3>${typed(`${path}.text`, block.text, live)}</h3>`;
    if (block.type === "text") return `<p>${typed(`${path}.text`, block.text, live)}</p>`;
    if (block.type === "list") { const tag = block.numbered ? "ol" : "ul"; return `<${tag}>${(block.items || []).map(item => `<li>${esc(item)}</li>`).join("")}</${tag}>`; }
    if (block.type === "table") {
      const [head = [], ...rows] = block.rows || [];
      return `<table><thead><tr>${head.map(cell => `<th>${esc(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    if (block.type === "keyvalue") return `<table>${(block.rows || []).map(row => `<tr><th style="width:34%">${esc(row.key)}</th><td>${esc(row.value)}</td></tr>`).join("")}</table>`;
    if (block.type === "photos") {
      const ratio = RATIOS[block.ratio] || 4 / 3;
      return `<div class="doc-photos" style="grid-template-columns:repeat(${block.columns || 2},1fr);width:${block.size || 100}%">${(block.photos || []).map(photo => `<img src="${H.fileUrl(photo.file_id, true)}" alt="" style="aspect-ratio:${ratio}">`).join("")}</div>`;
    }
    return "";
  }
  function pagesHtml(report, live = false) {
    const doc = report.doc || {};
    if (report.kind === "Certificate") {
      const c = doc.certificate || {}, background = companyImage("background");
      return [`<div class="doc-page landscape bordered doc-certificate" style="${background ? `background-image:url('${background}')` : ""}">${companyImage("logo") ? `<img class="doc-logo" src="${companyImage("logo")}" alt="">` : ""}<h3>${typed("certificate.company", c.company, live)}</h3><h1>${typed("certificate.heading", c.heading, live)}</h1><p>${typed("certificate.wording", c.wording, live)}</p>
        <table style="width:74%;margin:18px auto"><tr><th>Client</th><td>${typed("certificate.client", c.client, live)}</td></tr><tr><th>Project / Villa</th><td>${typed("certificate.project", c.project, live)}</td></tr><tr><th>Location</th><td>${typed("certificate.location", c.location, live)}</td></tr><tr><th>Work Description</th><td>${typed("certificate.work", c.work, live)}</td></tr><tr><th>Reference</th><td>${typed("certificate.reference", c.reference, live)}</td></tr><tr><th>Engineer</th><td>${typed("certificate.engineer", c.engineer, live)}</td></tr><tr><th>Job Completed</th><td>${esc(H.date(c.completed))}</td></tr><tr><th>Expiry</th><td>${esc(H.date(c.expiry))}</td></tr></table>
        <div style="display:flex;justify-content:space-around;align-items:flex-end">${companyImage("signature") ? `<img src="${companyImage("signature")}" alt="" style="height:64px">` : "<span></span>"}${companyImage("stamp") ? `<img src="${companyImage("stamp")}" alt="" style="height:96px">` : "<span></span>"}</div>${footer()}</div>`];
    }
    const cover = doc.cover || {}, head = doc.header || {}, control = doc.control || {}, letter = doc.letter || {};
    const headLine = `<div class="doc-head-line"><span>${esc(head.document)}</span><span>${esc(head.project)}</span><span>${esc(head.client)}</span></div>`;
    const sheet = html => `<div class="doc-page bordered">${headLine}${html}${footer()}</div>`;
    const pages = [`<div class="doc-page bordered doc-cover">${companyImage("logo") ? `<img class="doc-logo" style="height:120px" src="${companyImage("logo")}" alt="">` : ""}<h1>${typed("cover.title", cover.title, live)}</h1><h2>${typed("cover.subtitle", cover.subtitle, live)}</h2><p style="margin-top:60px"><b>${typed("cover.label", cover.label, live)}</b><br>${typed("cover.name", cover.name, live)}</p>${cover.label2 || cover.name2 ? `<p><b>${typed("cover.label2", cover.label2, live)}</b><br>${typed("cover.name2", cover.name2, live)}</p>` : ""}${footer()}</div>`];
    if (control.enabled) pages.push(sheet(`<h2>${typed("control.title1", control.title1, live)}</h2><table>${(control.rows || []).map(row => `<tr><th>${esc(row.label)}</th><td>${esc(row.value)}</td><th>${esc(row.label2)}</th><td>${esc(row.value2)}</td></tr>`).join("")}</table>${control.title2 ? `<h3>${esc(control.title2)}</h3>` : ""}${control.signoff ? `<table><tr><th>Prepared By</th><td>${esc(control.prepared)}</td></tr><tr><th>Approved By</th><td>${esc(control.approved)}</td></tr></table>` : ""}`));
    if (letter.enabled) pages.push(sheet(`<p><b>From:</b> ${esc(letter.from)}<br><b>To:</b> ${esc(letter.to)}<br><b>Project:</b> ${esc(letter.project)}<br><b>Subject:</b> ${esc(letter.subject)}</p><p>${esc(letter.body).replaceAll("\n", "<br>")}</p>${(letter.includes || []).length ? `<p><b>This Report Includes:</b></p><ul>${letter.includes.map(item => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}<div class="doc-signatures"><div>${esc(letter.signer)}<br><br>Signature</div><div>${esc(letter.client_name)}<br><br>Client Signature &amp; Date</div></div>`));
    const blocks = doc.blocks || [], numbers = headingNumbers(blocks);
    const byPage = {};
    blocks.forEach((block, index) => { (byPage[Number(block.page) || 1] ||= []).push(index); });
    const numbersOfPages = Object.keys(byPage).map(Number).sort((a, b) => a - b);
    if (doc.toc) {
      const offset = pages.length + 2;
      const rows = blocks.map((block, index) => block.type === "heading" ? `<tr><td>${numbers[index]}. ${esc(block.text)}</td><td style="width:60px;text-align:right">${offset + numbersOfPages.indexOf(Number(block.page) || 1)}</td></tr>` : "").join("");
      pages.push(sheet(`<h2>Table Of Contents</h2><table>${rows}</table>`));
    }
    numbersOfPages.forEach(page => pages.push(sheet(byPage[page].map(index => blockHtml(blocks[index], index, numbers[index], live)).join(""))));
    return pages;
  }
  const setPath = (object, path, value) => {
    const keys = path.split("."), last = keys.pop();
    keys.reduce((node, key) => node[key], object)[last] = value;
  };
  const getPath = (object, path) => path.split(".").reduce((node, key) => node?.[key], object);
  const renderedPdf = async (report, holderElement) => {
    const name = `${(report.reference || report.project || report.kind).replace(/[^\w-]+/g, "-")}.pdf`;
    let holder = holderElement;
    if (!holder) { holder = document.createElement("div"); holder.style.cssText = "position:fixed;left:-3000px;top:0"; holder.innerHTML = pagesHtml(report).join(""); document.body.append(holder); await new Promise(resolve => setTimeout(resolve, 500)); }
    try { await H.pdfFromPages([...holder.querySelectorAll(".doc-page")], name, report.kind === "Certificate"); }
    catch (error) { H.fail(error); }
    if (!holderElement) holder.remove();
  };
  const word = report => H.downloadPost("/reports/word", { report }, `${report.reference || "report"}.docx`).catch(H.fail);
  function preview(report) {
    H.popup({
      title: report.project || report.kind, html: pagesHtml(report).join(""),
      tools: [
        { label: "PDF", primary: true, onClick: popup => renderedPdf(report, popup.body) }, { label: "Word", onClick: () => word(report) },
        { label: "Print", onClick: () => H.print(report.kind, pagesHtml(report).join("")) },
        { label: "Copy Link", onClick: () => { navigator.clipboard?.writeText(`${location.origin}/#/report/${report.id}`); H.notice("Link copied. Anyone signed in with access can open this report."); } },
        ...(H.canEdit ? [{ label: "Edit", onClick: popup => { popup.close(); openBuilder(report); } }] : []),
      ],
    });
  }
  H.openReport = async id => { await loadShared(); const report = (await H.list("reports")).find(row => row.id === id); if (report) preview(report); };

  // ---- Builder ----------------------------------------------------------------------------------------------------
  function openBuilder(source) {
    const report = copyOf(source);
    let dirty = false;
    const popup = H.popup({
      title: report.kind, className: "hub-editor",
      tools: [
        { label: "Save", primary: true, onClick: () => save(true) }, { label: "Save As Template", onClick: saveTemplate },
        { label: "Word", onClick: () => word(report) }, { label: "PDF", onClick: () => renderedPdf(report) },
        { label: "Print", onClick: () => H.print(report.kind, pagesHtml(report).join("")) },
      ],
    });
    popup.body.style.padding = "0";
    popup.body.innerHTML = '<div class="hub-builder"><div class="hub-builder-preview"></div><form class="hub-builder-form"></form></div>';
    const view = popup.querySelector(".hub-builder-preview"), form = popup.querySelector("form");
    const drawPreview = () => { view.innerHTML = pagesHtml(report, true).join(""); };
    const input = (label, path, type = "text") => `<label>${label}<input type="${type}" data-path="${path}" value="${esc(getPath(report, path) ?? "")}"></label>`;
    const area = (label, path, rows = 3) => `<label>${label}<textarea rows="${rows}" data-path="${path}">${esc(getPath(report, path) ?? "")}</textarea></label>`;
    const check = (label, path) => `<label class="hub-check"><input type="checkbox" data-path="${path}"${getPath(report, path) ? " checked" : ""}> ${label}</label>`;
    const details = `<h3>Report Details</h3><label>Pick From Contract<select id="doc-contract">${H.options([["", "Choose a contract to fill this in"], ...contracts.map(row => [row.id, `${row.site} · ${row.client || ""}`])], report.contract_id || "")}</select></label>${input("Project", "project")}${input("Reference Number", "reference")}${input("Date", "date", "date")}`;
    const imagesForm = () => `<h3>Company Images (All Documents)</h3>${IMAGE_KINDS.map(([kind, label]) => `<div class="hub-block"><div class="hub-block-head"><span>${label}</span>${images[kind] ? `<button type="button" data-image-remove="${kind}" >Remove</button>` : ""}</div>${images[kind] ? `<img src="${companyImage(kind)}" alt="" style="max-height:44px;max-width:100%">` : ""}<input type="file" accept="image/png,image/jpeg" data-image="${kind}" aria-label="Upload ${label}"></div>`).join("")}`;
    function blockForm(block, index) {
      const path = `blocks.${index}`;
      let body = "";
      if (["heading", "subheading", "text"].includes(block.type)) body = block.type === "text" ? area("Text", `${path}.text`, 4) : input("Text", `${path}.text`);
      if (block.type === "list") body = `<label>Items (one per line)<textarea rows="4" data-list="${index}">${esc((block.items || []).join("\n"))}</textarea></label>${check("Numbered", `${path}.numbered`)}`;
      if (block.type === "table") body = `<div class="hub-mini-table"><table>${(block.rows || []).map((row, r) => `<tr>${row.map((cell, c) => `<td><input data-cell="${index}:${r}:${c}" value="${esc(cell)}" aria-label="Cell"></td>`).join("")}</tr>`).join("")}</table></div><div class="hub-add-blocks"><button type="button" data-table="${index}:row+">＋ Row</button><button type="button" data-table="${index}:row-">− Row</button><button type="button" data-table="${index}:col+">＋ Column</button><button type="button" data-table="${index}:col-">− Column</button></div>`;
      if (block.type === "keyvalue") body = `${(block.rows || []).map((row, r) => `<label>${input("Label", `${path}.rows.${r}.key`)}${input("Value", `${path}.rows.${r}.value`)}</label>`).join("")}<div class="hub-add-blocks"><button type="button" data-kv="${index}:+">＋ Row</button><button type="button" data-kv="${index}:-">− Row</button></div>`;
      if (block.type === "photos") body = `<label>Photos Per Row<select data-path="${path}.columns" data-number="1">${H.options([1, 2, 3, 4, 5, 6], block.columns || 2)}</select></label><label>Ratio<select data-path="${path}.ratio">${H.options(Object.keys(RATIOS), block.ratio || "4:3")}</select></label><label>Size (${block.size || 100}%)<input type="range" min="10" max="100" data-path="${path}.size" data-number="1" value="${block.size || 100}"></label><div class="hub-add-blocks"><button type="button" data-fit="${index}">Fit All Photos On One Page</button></div><label>Add Photos<input type="file" accept="image/png,image/jpeg" multiple data-photos="${index}"></label><div class="hub-photo-list">${(block.photos || []).map((photo, p) => `<figure><img src="${H.fileUrl(photo.file_id, true)}" alt=""><figcaption><button type="button" data-photo="${index}:${p}:left" title="Move left">←</button><button type="button" data-photo="${index}:${p}:crop" >Crop</button><button type="button" data-photo="${index}:${p}:right" title="Move right">→</button><button type="button" data-photo="${index}:${p}:remove" title="Remove">×</button></figcaption></figure>`).join("")}</div>`;
      return `<div class="hub-block"><div class="hub-block-head"><span>${BLOCK_NAMES[block.type]}</span>Page<input type="number" min="1" data-path="${path}.page" data-number="1" value="${block.page || 1}" aria-label="Page number"><button type="button" data-move="${index}:-1" >Up</button><button type="button" data-move="${index}:1" >Down</button><button type="button" data-clone="${index}" >Clone</button><button type="button" data-delete="${index}" >Delete</button></div>${body}</div>`;
    }
    function drawForm() {
      if (report.kind === "Certificate") {
        form.innerHTML = `${details}<h3>Certificate</h3><label>Service<select id="cert-service">${H.options([["", "Choose a service to fill the wording"], ...H.app().services().filter(service => service.is_active).map(service => [service.name, service.name])], report.doc.certificate.service || "")}</select></label>${input("Company", "doc.certificate.company")}${input("Heading", "doc.certificate.heading")}${input("Client", "doc.certificate.client")}${input("Project / Villa", "doc.certificate.project")}${input("Location", "doc.certificate.location")}${area("Completion Wording", "doc.certificate.wording")}${area("Work Description", "doc.certificate.work")}${input("Reference Line", "doc.certificate.reference")}${input("Engineer", "doc.certificate.engineer")}${input("Job Completed Date", "doc.certificate.completed", "date")}${input("Expiry Date", "doc.certificate.expiry", "date")}${imagesForm()}`;
        return;
      }
      const control = report.doc.control ||= { rows: [] }, letter = report.doc.letter ||= {};
      form.innerHTML = `${details}<h3>Cover</h3>${input("Title", "doc.cover.title")}${input("Sub-title", "doc.cover.subtitle")}${input("Label", "doc.cover.label")}${input("Name", "doc.cover.name")}${input("Second Label", "doc.cover.label2")}${input("Second Name", "doc.cover.name2")}
        <h3>Header Lines</h3>${input("Document", "doc.header.document")}${input("Project / Site", "doc.header.project")}${input("Client", "doc.header.client")}
        <h3>Document Control</h3>${check("Show this page", "doc.control.enabled")}${control.enabled ? `${input("First Title Bar", "doc.control.title1")}${input("Second Title Bar", "doc.control.title2")}${(control.rows || []).map((row, r) => `<div class="hub-block">${input("Label", `doc.control.rows.${r}.label`)}${input("Value", `doc.control.rows.${r}.value`)}${input("Second Label", `doc.control.rows.${r}.label2`)}${input("Second Value", `doc.control.rows.${r}.value2`)}</div>`).join("")}<div class="hub-add-blocks"><button type="button" data-control="+">＋ Row</button><button type="button" data-control="-">− Row</button></div>${check("Show Prepared By / Approved By", "doc.control.signoff")}${control.signoff ? `${input("Prepared By", "doc.control.prepared")}${input("Approved By", "doc.control.approved")}` : ""}` : ""}
        <h3>Covering Letter</h3>${check("Show this page", "doc.letter.enabled")}${letter.enabled ? `${input("From", "doc.letter.from")}${input("To", "doc.letter.to")}${input("Project", "doc.letter.project")}${input("Subject", "doc.letter.subject")}${area("Body", "doc.letter.body", 6)}<label>Report Includes (one per line)<textarea rows="3" data-includes="1">${esc((letter.includes || []).join("\n"))}</textarea></label>${input("Signer", "doc.letter.signer")}${input("Client Name", "doc.letter.client_name")}` : ""}
        <h3>Contents</h3>${check("Automatic table of contents", "doc.toc")}<div class="hub-add-blocks"><button type="button" data-auto-pages="1">Each Heading On A New Page</button></div>${(report.doc.blocks || []).map(blockForm).join("")}
        <div class="hub-add-blocks">${Object.entries(BLOCK_NAMES).map(([type, name]) => `<button type="button" data-add="${type}">＋ ${name}</button>`).join("")}</div>${imagesForm()}`;
    }
    const changed = (redraw = false) => { dirty = true; if (redraw) drawForm(); drawPreview(); };
    form.addEventListener("change", event => {
      if (event.target.id === "doc-contract") {
        const contract = H.fromContract(contracts, event.target.value);
        report.contract_id = contract?.id || ""; report.project = contract?.site || report.project;
        if (contract && report.kind === "Certificate") report.doc.certificate = { ...report.doc.certificate, ...newDoc("Certificate", contract).certificate };
        else if (contract) {
          Object.assign(report.doc.header, { project: contract.site, client: contract.client || "" });
          report.doc.cover.name = contract.client || "";
        }
        changed(true);
        return;
      }
      if (event.target.id !== "cert-service") return;
      const service = H.app().services().find(item => item.name === event.target.value), c = report.doc.certificate;
      c.service = event.target.value;
      if (service) {
        c.work = service.certificate_text || c.work;
        c.expiry = H.addMonths(c.completed || H.today(), service.validity_months || 6);
        c.months = service.validity_months || 6; c.expiry_manual = false;
      }
      changed(true);
    });
    form.addEventListener("input", event => {
      const target = event.target, data = target.dataset;
      if (target.type === "file") return;
      if (data.path) {
        const value = target.type === "checkbox" ? target.checked : data.number ? Number(target.value) : target.value;
        setPath(report, data.path, value);
        if (data.path === "doc.certificate.completed" && value && !report.doc.certificate.expiry_manual) {
          report.doc.certificate.expiry = H.addMonths(value, report.doc.certificate.months || 6);
          form.querySelector('[data-path="doc.certificate.expiry"]').value = report.doc.certificate.expiry;
        }
        if (data.path === "doc.certificate.expiry") report.doc.certificate.expiry_manual = true;
        changed(target.type === "checkbox" || /\.(ratio|columns)$/.test(data.path));
      } else if (data.list) { report.doc.blocks[data.list].items = target.value.split("\n").filter(Boolean); changed(); }
      else if (data.cell) { const [b, r, c] = data.cell.split(":").map(Number); report.doc.blocks[b].rows[r][c] = target.value; changed(); }
      else if (data.includes) { report.doc.letter.includes = target.value.split("\n").filter(Boolean); changed(); }
    });
    view.addEventListener("input", event => {
      const path = event.target.dataset.path;
      if (!path) return;
      const full = path.startsWith("blocks") || path.startsWith("cover") || path.startsWith("control") || path.startsWith("certificate") ? `doc.${path}` : path;
      setPath(report, full, event.target.textContent);
      dirty = true;
      const box = form.querySelector(`[data-path="${full}"]`);
      if (box) box.value = event.target.textContent;
    });
    async function ensureSaved() { if (!report.id) await save(false); return report.id; }
    form.addEventListener("click", async event => {
      const data = event.target.closest("button")?.dataset;
      if (!data) return;
      const blocks = report.doc.blocks;
      if (data.add) { const page = Math.max(1, ...(blocks.map(block => Number(block.page) || 1))); blocks.push({ type: data.add, page, text: "", items: [], rows: data.add === "table" ? [["Column 1", "Column 2"], ["", ""]] : data.add === "keyvalue" ? [{ key: "", value: "" }] : [], photos: [], columns: 2, ratio: "4:3", size: 100 }); changed(true); }
      if (data.move) { const [index, step] = data.move.split(":").map(Number), to = index + step; if (blocks[to]) { [blocks[index], blocks[to]] = [blocks[to], blocks[index]]; changed(true); } }
      if (data.clone) { blocks.splice(Number(data.clone) + 1, 0, copyOf(blocks[data.clone])); changed(true); }
      if (data.delete !== undefined) { blocks.splice(Number(data.delete), 1); changed(true); }
      if (data.autoPages) { let page = 0; blocks.forEach(block => { if (block.type === "heading" || page === 0) page += 1; block.page = page; }); changed(true); }
      if (data.control) { const rows = report.doc.control.rows; if (data.control === "+") rows.push({ label: "", value: "", label2: "", value2: "" }); else rows.pop(); changed(true); }
      if (data.table) {
        const [index, action] = data.table.split(":"), rows = blocks[index].rows, width = rows[0]?.length || 1;
        if (action === "row+") rows.push(Array(width).fill(""));
        if (action === "row-" && rows.length > 1) rows.pop();
        if (action === "col+") rows.forEach(row => row.push(""));
        if (action === "col-" && width > 1) rows.forEach(row => row.pop());
        changed(true);
      }
      if (data.kv) { const [index, action] = data.kv.split(":"); if (action === "+") blocks[index].rows.push({ key: "", value: "" }); else blocks[index].rows.pop(); changed(true); }
      if (data.fit) fitPhotos(blocks[data.fit]);
      if (data.photo) {
        const [b, p, action] = data.photo.split(":"), photos = blocks[b].photos, index = Number(p);
        if (action === "remove") photos.splice(index, 1);
        if (action === "left" && index > 0) [photos[index - 1], photos[index]] = [photos[index], photos[index - 1]];
        if (action === "right" && photos[index + 1]) [photos[index + 1], photos[index]] = [photos[index], photos[index + 1]];
        if (action === "crop") { cropPhoto(photos[index], blocks[b], report.id, changed); return; }
        changed(true);
      }
      if (data.imageRemove && await H.confirm("Remove this image from all documents?", { action: "Remove" })) {
        try { await H.del(`/files/${images[data.imageRemove]}`); delete images[data.imageRemove]; changed(true); } catch (error) { H.fail(error); }
      }
    });
    form.addEventListener("change", async event => {
      const target = event.target, data = target.dataset;
      try {
        if (data.image) {
          const saved = (await H.upload("/files", { file: target.files[0], record_id: H.organizationId, kind: data.image })).data;
          images[data.image] = saved.id; changed(true);
        }
        if (data.photos) {
          const id = await ensureSaved();
          for (const file of target.files) {
            const saved = (await H.upload("/files", { file, record_id: id, kind: "Photo" })).data;
            report.doc.blocks[data.photos].photos.push({ file_id: saved.id, original_id: saved.id });
          }
          changed(true);
        }
      } catch (error) { H.fail(error); }
    });
    function fitPhotos(block) {
      const count = (block.photos || []).length, ratio = RATIOS[block.ratio] || 4 / 3, width = 682, height = 860;
      if (!count) { H.notice("Add photos first.", true); return; }
      let best = 6;
      for (let columns = 1; columns <= 6; columns++) {
        if (Math.ceil(count / columns) * (width / columns) / ratio <= height) { best = columns; break; }
      }
      const total = Math.ceil(count / best) * (width / best) / ratio;
      block.columns = best;
      block.size = total > height ? Math.max(10, Math.floor(height / total * 100)) : 100;
      changed(true);
    }
    async function save(notify) {
      const { id, created_at: _c, updated_at: _u, ...fields } = report;
      fields.title = fields.doc?.cover?.title || fields.doc?.certificate?.heading || fields.kind;
      fields.date ||= H.today();
      const saved = (await H.save("reports", id, fields)).data;
      Object.assign(report, saved);
      dirty = false;
      if (notify) { H.notice("Report saved."); H.show(PAGE); }
      return saved;
    }
    async function saveTemplate() {
      const name = await H.form({ title: "Save As Template", saveLabel: "Save Template", values: {}, fields: [{ key: "name", label: "Template Name", required: true, full: true }] });
      if (!name) return;
      const doc = copyOf(report.doc);
      (doc.blocks || []).forEach(block => { if (block.type === "photos") block.photos = []; });
      try { await H.post("/report_templates", { name: name.name, kind: report.kind, doc }); H.notice("Template saved. Its photos are not kept."); H.show(PAGE); } catch (error) { H.fail(error); }
    }
    popup.querySelector("[data-close]").addEventListener("click", event => {
      if (dirty && !window.confirm("Close without saving your changes?")) { event.stopImmediatePropagation(); event.stopPropagation(); }
    }, true);
    drawForm(); drawPreview();
  }
  // Drag, zoom and rotate inside the frame; the result is saved as a new file and the original stays.
  function cropPhoto(photo, block, reportId, changed) {
    let ratio = block.ratio || "4:3", zoom = 1, rotate = 0, fill = true, x = 0, y = 0;
    const popup = H.popup({
      title: "Crop Photo", wide: false,
      tools: [{ label: "Use This Crop", primary: true, onClick: async () => {
        canvas.toBlob(async blob => {
          try {
            const saved = (await H.upload("/files", { file: new File([blob], "cropped.jpg", { type: "image/jpeg" }), record_id: reportId, kind: "Photo" })).data;
            photo.file_id = saved.id; block.ratio = ratio; popup.close(); changed(true);
          } catch (error) { H.fail(error); }
        }, "image/jpeg", 0.92);
      } }],
      html: `<canvas width="640" height="480" style="width:100%;background:#222;touch-action:none;cursor:move"></canvas><div class="hub-form-grid" style="margin-top:10px"><label>Zoom<input type="range" min="1" max="4" step="0.05" value="1" id="crop-zoom"></label><label>Rotate<input type="range" min="-180" max="180" value="0" id="crop-rotate"></label><label>Ratio<select id="crop-ratio">${H.options(Object.keys(RATIOS), ratio)}</select></label><label>Mode<select id="crop-fill"><option value="fill">Fill frame</option><option value="fit">Fit whole photo</option></select></label></div>`,
    });
    const canvas = popup.querySelector("canvas"), context = canvas.getContext("2d"), image = new Image();
    function draw() {
      canvas.width = 640; canvas.height = Math.round(640 / RATIOS[ratio]);
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      const base = (fill ? Math.max : Math.min)(canvas.width / image.width, canvas.height / image.height) * zoom;
      context.save(); context.translate(canvas.width / 2 + x, canvas.height / 2 + y); context.rotate(rotate * Math.PI / 180);
      context.drawImage(image, -image.width * base / 2, -image.height * base / 2, image.width * base, image.height * base);
      context.restore();
    }
    image.onload = draw;
    image.src = H.fileUrl(photo.original_id || photo.file_id, true);
    popup.querySelector("#crop-zoom").oninput = event => { zoom = Number(event.target.value); draw(); };
    popup.querySelector("#crop-rotate").oninput = event => { rotate = Number(event.target.value); draw(); };
    popup.querySelector("#crop-ratio").onchange = event => { ratio = event.target.value; draw(); };
    popup.querySelector("#crop-fill").onchange = event => { fill = event.target.value === "fill"; draw(); };
    canvas.onpointerdown = down => {
      const startX = down.clientX - x, startY = down.clientY - y;
      canvas.setPointerCapture(down.pointerId);
      canvas.onpointermove = move => { x = move.clientX - startX; y = move.clientY - startY; draw(); };
      canvas.onpointerup = () => { canvas.onpointermove = null; };
    };
  }
  H.makeCertificate = async contract => {
    await loadShared();
    H.app().navigate(PAGE);
    openBuilder({ kind: "Certificate", project: contract.site, contract_id: contract.id, reference: "", date: H.today(), doc: newDoc("Certificate", contract) });
  };
  function drawExports(host) {
    const download = async (name, format) => {
      try {
        const [collection, fields] = EXPORTS[name];
        await H.exportRows(format, name, fields.map(([key, label]) => ({ key, label })), collection ? await H.list(collection) : await H.clients());
      } catch (error) { H.fail(error); }
    };
    const table = H.table(host, {
      id: "exports", eyebrow: "DOWNLOADS", title: "Data Exports",
      columns: [{ key: "name", label: "Report" }, { key: "formats", label: "File Format", value: () => "CSV · Excel · PDF" }],
      actions: [{ key: "csv", title: "CSV" }, { key: "xlsx", title: "Excel" }, { key: "pdf", title: "PDF" }],
      on: Object.fromEntries(["csv", "xlsx", "pdf"].map(format => [format, row => row.name === "Client Schedule"
        ? H.downloadGet(`/export/client-schedule?format=${format}`, `client-schedule.${format}`).catch(H.fail) : download(row.name, format)])),
    });
    table.show(["Client Schedule", ...Object.keys(EXPORTS)].map(name => ({ name })));
  }
  async function loadShared() {
    [contracts, images] = await Promise.all([H.list("contracts"), H.api("/company-images").then(result => result.data || {})]);
  }
  function startNew(templates) {
    H.form({
      title: "New Document", saveLabel: "Create",
      values: { kind: KINDS[0] },
      fields: [
        { key: "kind", label: "Type", type: "select", full: true, options: [...KINDS.map(kind => [kind, kind]), ...templates.map(template => [`template:${template.id}`, `Template: ${template.name}`])] },
        H.siteField(contracts),
      ],
    }).then(chosen => {
      if (!chosen) return;
      const contract = H.fromContract(contracts, chosen.contract_id), template = templates.find(row => `template:${row.id}` === chosen.kind);
      const kind = template ? template.kind : chosen.kind;
      openBuilder({ kind, project: contract?.site || "", contract_id: contract?.id || "", reference: "", date: H.today(), doc: template ? copyOf(template.doc) : newDoc(kind, contract) });
    });
  }
  H.page(PAGE, {
    async render(host) {
      H.tabs(host, [["documents", "Documents"], ["exports", "Data Exports"]], tab, next => { tab = next; H.show(PAGE); });
      if (tab === "exports") return drawExports(host);
      await loadShared();
      const [reports, templates] = await Promise.all([H.list("reports"), H.list("report_templates")]);
      reports.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
      H.toolbar(host, [
        { type: "search", key: "q", placeholder: "Search project, reference, type" },
        { type: "select", key: "kind", label: "Type", options: [["", "All types"], ...KINDS] },
        { type: "button", label: "＋ New Document", primary: true, edit: true, onClick: () => startNew(templates) },
      ], () => paint(), state);
      const table = H.table(host, {
        id: "reports", eyebrow: "DOCUMENTS", title: "Saved Documents", empty: "No reports yet. Press New Document to start.",
        columns: [
          { key: "kind", label: "Type", html: row => H.badge(row.kind, row.kind === "Certificate" ? "green" : "blue"), value: row => row.kind },
          { key: "project", label: "Project", value: row => row.project, html: row => `<a href="#" class="hub-link" data-act="preview">${esc(row.project || "(no project)")}</a>` },
          { key: "reference", label: "Reference Number" }, { key: "date", label: "Date", value: row => H.date(row.date) },
          { key: "updated", label: "Last Updated", value: row => H.date((row.updated_at || "").slice(0, 10)) },
        ],
        actions: [
          { key: "preview", title: "Preview" }, { key: "pdf", title: "PDF" }, { key: "edit", title: "Edit", edit: true },
          { key: "duplicate", title: "Duplicate", edit: true }, { key: "delete", title: "Delete", edit: true },
        ],
        on: {
          preview, pdf: row => renderedPdf(row), edit: row => openBuilder(row),
          duplicate: async row => {
            const { id: _i, created_at: _c, updated_at: _u, ...fields } = row;
            try { await H.post("/reports", { ...fields, reference: fields.reference ? `${fields.reference} (copy)` : "" }); H.show(PAGE); } catch (error) { H.fail(error); }
          },
          delete: async row => { if (await H.confirm(`Delete this ${row.kind}?`)) { try { await H.del(`/reports/${row.id}`); H.show(PAGE); } catch (error) { H.fail(error); } } },
        },
      });
      const paint = () => table.show(reports.filter(row => (!state.kind || row.kind === state.kind) && H.matches(state.q, [row.project, row.reference, row.kind])));
      paint();
      if (templates.length) {
        const list = H.table(host, {
          id: "report-templates", eyebrow: "DOCUMENTS", title: "Saved Templates", empty: "",
          columns: [{ key: "name", label: "Saved Template" }, { key: "kind", label: "Type" }],
          actions: [{ key: "delete", title: "Delete", edit: true }],
          on: { delete: async row => { if (await H.confirm(`Delete the template ${row.name}?`)) { try { await H.del(`/report_templates/${row.id}`); H.show(PAGE); } catch (error) { H.fail(error); } } } },
        });
        list.show(templates);
      }
    },
  });
})();
