# Wolgan Operations Hub: Customer Requirements

Source: the Functions & Features Reference the customer shared on 30 Oct 2026, for Wolgan Water Treatment LLC.
These are the features the Wolgan website must cover. The website's own Approvals step and admin/employee logins stay.

## 0. Features common to every section

- Shared data: all users see the same live data. Edits are saved at once; the last save on the same record wins. People with view-only access can read but not change anything.
- Clone: the clone button copies a line and opens the copy in the edit form so it can be changed before saving (names get "(copy)"; delivery notes get the next DN number; attachments are not copied).
- Edit / delete: every line has edit and delete. Deleting always asks for confirmation.
- Filtered downloads: Excel buttons export only the rows currently shown after search and filters. PDF buttons use the same filtered rows.
- Table spacing: drag a column heading edge to widen or narrow it (double-click resets); drag the grip at the top-left of a table to change row height and spacing.
- Settings: 16 page layouts, spacing, page zoom, menu show/hide/reorder, inventory link. Theme: 20 themes plus custom colours and text size; both can be saved as team defaults.
- Top search: finds materials, contracts, staff and assets and opens them for editing.
- Share: shows the dashboard link.
- Attachments: uploads are stored with the dashboard.

## 1. AMC & Site Visits

Purpose: one register of every AMC contract with its visits, reports, GRN, lab report and invoice status. It has three tabs: Contract tracker, Master schedule sheet, Projects & GRN.

### 1.1 Contract tracker

- Summary strip: active contracts, expired, expiring within 60 days, visits overdue, reports pending, GRN pending, lab pending, invoices pending.
- Filters: search (client, project, SO, system details, visitor, contact); status (Expired, Expiring <=60d, Visit overdue, Report pending, GRN pending, Lab pending, Invoice pending); client; source (AMC / AMC + Schedule / Schedule only); Active contracts only / Closed / All.
- Columns (one field per column): client; site/project (click it for the full project sheet) with contact name, mobile, alternate number and map; system details; SO; start date; expiry with a coloured days-left badge; last visit; next due; visited by; report (Pending / Submitted / Not required); GRN (blank / Requested / Pending / Received / Not applicable); lab report (Pending / Sample sent / Received / Not applicable); invoice (Pending / Submitted / Not applicable) with invoice number.
- Inline status changes: the four status dropdowns save immediately. Setting invoice to Submitted fills today as the invoice date if empty.
- Row buttons: project sheet, log a site visit, edit, renew with new SO, close (reopen on closed rows), clone, delete.
- Add / edit contract form: client, project/site, SO, contract period text, start date, expiry date, system details, visit frequency (Monthly, Bimonthly, Quarterly, Half-yearly, Yearly, On call), last visit, next due, who visited, report, GRN, lab, microbiology, Legionella, location/area, contact person, mobile, alternate number, map link, contract status (Active/Closed), closed date, close reason, invoice status, invoice number, invoice date.
- Log visit: visit date, who visited, report status, lab status. It marks that month Done in the schedule and recalculates last visit and next due.
- Auto schedule: when frequency, start or expiry is changed (and via Auto-update schedule), future months (this month onward) are set to Due according to frequency, only inside the contract dates. Done, Missed and N/A months are never overwritten. On-call contracts are left alone.
- Source comparison: each contract shows whether it came from the AMC sheet, the Service Schedule, or both.

### 1.2 Master schedule sheet

- Month range: From / To month boxes and year buttons (up to 36 months at once). The current month is highlighted.
- Cells: click to cycle Due -> Done -> Missed -> Not applicable -> blank. Each change updates last visit and next due.
- Columns: project and client with expiry badge, one column per month, done count, due count, edit and clone.
- Filters: search, client. Only active contracts are listed. Excel exports the shown rows and months.

### 1.3 Projects & GRN

- Table: project, quote, PO, SO, work/GRN status (Waiting GRN, Pending GRN, GRN Received, In progress, Work Completed, Invoiced or any text). Add, edit, clone, delete. A GRN-type status marks the matching contract's GRN as pending.

### 1.4 Project sheet (popup)

Opens when a site name is clicked anywhere in the dashboard. It shows client, site, SO, contact, mobile, alternate, location, map, contract period, start -> expiry with days left, frequency, invoice/GRN/lab status and system details; counters for visits scheduled, completed, pending, overdue, missed, sample schedules, chemicals delivered vs contract, delivery notes; the visit matrix by year (clickable); water sampling table; PPM planner summary; chemical lines; delivery notes. A colour picker sets the sheet background (kept per user). Buttons: Edit, Renew, Close/Reopen, Share, Print.

### 1.5 Closing and renewing

- Close: closed date, reason (Expired, Renewed, Terminated, Other), note. Closed contracts disappear from the tracker, master schedule, visits, PPM list, Site Directory and counters unless Closed/All is chosen.
- Renew: new SO, period, start (defaults to the day after expiry), expiry, and Yes/No to copy sample schedules, PPM planner and chemical lines (deliveries restart at zero). The old contract is closed with reason Renewed and linked to the new one.

## 2. Lab Samples

Flow: Dashboard -> Lab Samples -> Client list -> the client's projects -> the project's samples grouped by water system. A breadcrumb returns to any level. An All samples flat list is also available.

### 2.1 Client list

- Columns: client, contact person, contact number, email, number of projects, samples, pending, due within 7 days, overdue. A row opens the client.
- Controls: search; "show clients without samples"; Add client; edit contact; Manage dropdown lists; Excel.

### 2.2 Client's projects

- Client contact strip with edit. Table: project, contract period with expiry badge, water systems with sample counts, samples, pending, next due, overdue, and Add sample.

### 2.3 Project sample sheet

- Header: project, client, contact person, mobile, alternate, map, contract period and expiry, Edit project/contact.
- Summary: samples, pending, due <=7 days, overdue, reports not received.
- Grouping: rows are grouped by water system (Domestic water, Chilled water, Swimming pool, Cooling tower, Other or your own), with a count per group.
- Columns: S.No; circuit details (system, sample points, collection contact, mobile, location or map link); test; duration period; next due date (bold, red/orange/green); days left (bold, "Overdue n d" when late); sample collection date (bold blue); qty due; status (Pending / Collected / Sent to lab); report (Not submitted / Received); notes; documents; actions mark collected, edit, clone, delete.
- Mark collected: asks collection date and collector, sets status Collected, report Not submitted, next due = collection date + duration days, expiry = same date.

### 2.4 Sample form

Project (type to search), water system (typed or chosen), test (Microbiology, Legionella, TPC or any you add), duration period (dropdown), circuit details/sample points, contact person for collection, mobile, collection location or map link, sample collection date, next due date (auto), expiry date (auto), qty due, status, report, collected by, notes. Contact, mobile and location are pre-filled from the site.

### 2.5 Automatic duration calculation

Monthly 30 days, Monthly twice 15, Bimonthly 60, Quarterly 90, Half-yearly 180, Yearly 365, Once 0 (no next date). Next due and expiry fill from collection date + days; typing in them manually keeps your value. Manage dropdown lists adds or changes tests, water systems and durations (written as Name = days).

### 2.6 All samples list

Filters: search, test, water system, status, report, due month, client. Columns add site, client, contact, contract period. Documents (lab report, chain of custody, photo, other) can be uploaded, opened, downloaded and removed.

## 3. Engineer Visit Schedule

Purpose: plan and track engineer visits for every active contract. It uses the same schedule data as the AMC master sheet, so a change in either place appears in both.

- Period controls: year buttons; month range From/To boxes; month buttons showing done/total for each month; Full year.
- Summary: visits shown, done, not done/due, missed, unallocated.
- Filters: search (site, client, SO, engineer, contact); status Due/Done/Missed; engineer (including "unallocated"); client.
- Columns: month (dropdown that moves the visit to another month); client; site (click for project sheet); site contact, mobile and map; planned date (editable); allocated engineer (dropdown of staff, editable); status (Due / Done / Missed / Not applicable); next schedule date; actions duplicate to next month and remove from schedule.
- Actions: Add visit (site, planned date, engineer); Allocate engineer to all shown rows; Auto-update schedule (all AMC); Excel (filtered); PDF; Print.
- Behaviour: marking Done with an engineer sets "visited by" on the contract and recalculates last visit and next due. Up to 700 rows are drawn at once (narrow the filter for more). Closed contracts are excluded.

## 4. PPM Planner

Purpose: a yearly planned-maintenance sheet for each AMC site, shaped like the FVM planner.

- Site list: active contracts with search and client filter, contract expiry, and chips showing which planner years exist. Create planners for all sites builds one per site for the selected year (from that site's sample schedules, otherwise a default of Chemical Analysis monthly, Microbiological and Legionella quarterly).
- Editor: year buttons; first month box (the 12 columns start from any month you choose); activity text (editable); project and contact line.
- Structure: service groups (named, e.g. "Services for Cooling tower - site") each holding service rows: S.No, service details, frequency, 12 monthly cells, row total.
- Frequency fill: choosing Monthly (1 each month), Twice monthly (2), Bimonthly, Quarterly, Half-yearly or Yearly fills the months; As required clears them. Any month can then be typed over (blank = no service); green cells mark planned months.
- Buttons: Add service group; add row; clone row; clone group; delete row/group; Copy to next year; Print / PDF.
- Layout: fixed columns that fit one screen without sideways scrolling. Planners also appear in the project sheet and are copied on renewal.

## 5. Chemical Delivery

Purpose: track contracted chemical quantities and monthly deliveries per site.

- Site list: search (site, client, SO); client; Linked/Unlinked. Summary: sites, chemical lines, total delivered, over-delivered lines, not linked. Columns: site, client, SO, lines, contract qty, delivered, remaining, last delivery.
- Site sheet: site header with contact and project sheet; month range From/To boxes with year shift (up to 36 months); lines grouped by block/period with SO; columns: chemical (with system chip, description, supplier), UoM, contract qty, one editable cell per month, delivered (all months), remaining, actions edit, clone, delete.
- Remaining rule: remaining = contract qty - delivered, but never below 0. If deliveries exceed the contract, Remaining shows 0 with an asterisk; hovering shows how much it was exceeded.
- Cap option: the Cap button limits any entry to the contract quantity (off by default).
- Line form: linked AMC site, sheet/site name, block/period, SO, system, supplier, chemical (list), description, UoM, contract qty, notes.
- Inventory link: typing a monthly quantity creates or updates an OUT movement in Inventory for the matching item (matched by chemical name, project and client are recorded). Changing the number updates it; clearing the cell restores stock. If no matching item exists a message is shown and stock is unchanged. The link can be switched off in Settings.
- Other: Chemical list edits the dropdown names; Excel exports the filtered lines with the months currently displayed; the button on a delivery note adds its quantities here.

## 6. Delivery Notes

Three pages work on the same records: Delivery Notes (standard and flat list), the editor/preview, and the Delivery Master Sheet.

### 6.1 Delivery Notes page

- Numbering: the next number is automatic (DN-YY-NNN, continuing from the last used number; change the starting number in Lists).
- Summary: notes, delivered, pending/in transit, total amount (filtered), next DN number.
- Filters: search (DN, client, driver, chemical), SO number, status, type, driver, client, date range.
- Columns: DN number (click for the large preview), date, client and address with site contact and mobile, SO, type, items, driver, driver mobile, helpers and names, amount, status (inline dropdown), delivered by, files.
- Row buttons: edit, preview, PDF, clone (new number), add to chemical tracker, delete.
- Preview popup: full document with PDF, Print, Copy share link and Edit.
- Flat list: one row per item (DN, date, client, SO, type, item, description, qty, unit, driver, helper, status, signed, amount) with the same filters, Excel and PDF.
- Totals and PDFs: totals line for the filtered notes; Master PDF (filtered list); Driver monitor PDF (per driver: deliveries, delivered, helpers, amount); Excel (filtered).

### 6.2 Editor

- Layout: edit form on the right, live preview on the left, draggable divider. Click any text in the preview to type directly; the form updates.
- Fields: DN number, date, AMC/site (autofills client, SO, address, site contact and mobile), PO/reference, address, site contact person and mobile, description type, delivery person and mobile, helper names and number of helpers, amount, status (Pending, Loaded, In transit, Delivered, Returned), delivered by, received by, notes.
- Items table: item name (list changes with the type), description/size, qty, unit. Units follow the type: Chemicals - Drum, Can, Kg, Ltr, Bag, Nos; Spare parts - Nos, Qty, Set, Pcs, Mtr; Equipment, Consumables, Lab reagents and Other have their own lists. Item and unit lists are editable in Lists.
- Attachments: upload delivery note files (PDF/JPG/PNG/Word); view, download, remove.
- Buttons: Save, PDF (logo, items table, driver block, signature boxes, footer bar), Close (warns about unsaved edits).

### 6.3 Delivery Master Sheet

- Excel-style columns: S.No, Date, SO No, DN N, Customer (auto text "Delivery Note - DN-26-01 - Client - SO...", editable), Delivery Address, Delivery person, Signed Delivery Note (Collected / Pending / Not required, coloured), Amount, Helper.
- Inline editing of every cell updates the Delivery Notes page, driver monitor and filters at once.
- Tools: filters (search, SO, driver, signed, dates); Add row; Update all shown rows (signed, driver, helper, status, address, amount); Import Excel in the same column layout (creates or updates by DN number); Excel and PDF of filtered rows; per row full editor, preview, clone, PDF, delete.

## 7. Attendance

- Period: Oct 2026 to Sep 2028 with previous/next; weekly off day selector (default Sunday).
- Brushes: choose a code, then click days to paint. Defaults: P Present, A Absent, H Holiday, AL Annual vacation, EL Emergency leave, Clear (removes the mark). Edit codes adds, renames, recolours or removes codes (one per line: CODE = Name = #colour).
- Grid: staff photo or initials, name, position; day columns with weekday letters; public holidays and weekly off are shaded; holiday names show on hover.
- Row tools: edit name, position, employee ID, status; remove worker; mark all working days present up to today (skips weekly off, holidays and days already marked); Add worker.
- Totals per row: a count column for every code, Hol (public holidays plus personal H), and Year P (days present in the year).
- Shown staff: Active and On-leave workers, plus anyone with marks that month.
- Public holidays table: date and name for 2026-2028 with add, edit, clone, delete (moon-sighted dates are approximate; confirm with official announcements).
- Storage: each mark is stored as its own entry, so clearing a day removes only that day.

## 8. Staff Profiles

- Cards: large round photo (click to manage files; initials if none), name, status badge, position, employee ID, mobile (tap to call), email (tap to mail), date of birth, joined, left date, EID number with expiry badge and renewal date, visa number with expiry and renewal, passport number with expiry badge, vehicle number and name, file chips.
- Summary: total staff, active, left/on leave, documents expiring within 60 days. Expiring EID, visa and passport also appear on the dashboard.
- Filters: search (name, position, employee ID, EID, visa, vehicle); status (Active, Resigned, Terminated, On leave).
- Buttons per card: Edit, Clone (documents not copied), Files, delete (also removes attachments).
- Profile form: name, position/tag, employee ID, mobile, email, status, date of birth, date joined, date terminated/resigned, EID number, EID renewal date, EID expiry, visa number, visa renewal date, visa expiry, passport number, passport expiry, vehicle number, vehicle name, notes.
- Files: types Passport, Emirates ID, Visa, Photo, Other (PDF, JPG, PNG, WebP, up to 20 MB). Each file can be opened, downloaded or removed. The newest Photo becomes the profile picture everywhere (attendance, schedule, cards).
- Staff list: Download (Excel, filtered) and Upload CSV (matches by employee ID or name; adds new, updates existing).

## 9. Calibration

Purpose: register of meters and instruments with calibration dates and due alerts (built with the generic section engine, so it behaves like any custom section).

- Fields: instrument/meter, model, manufacturer (Mfg), serial number, in-charge (staff list), in-charge mobile, qty, working condition (Working Condition / Needs repair / Out of service), cost (AED), calibration date, calibration due/expiry date, notes.
- Auto date: if only the calibration date is entered, the due date is set 12 months later; it can be overwritten.
- Screen: records, shown, total cost, and a count of items due within 30 days or expired; search across all fields; condition filter; due date badge (green / orange / red); totals row.
- Row buttons: edit, clone (opens the copy), delete, certificates (upload/open/download/remove).
- Export: Excel of the filtered rows. The dashboard home card lists instruments due soon.
- Related, Assets: purchase date, supplier, supplier contact and mobile, cost per unit, total value (cost x qty), material in-charge; dashboard shows total asset value.
- New section: build any extra register (name, icon, columns of text/number/date/select/long text) with the same search, filter, clone, Excel and attachments.

## 10. Reports and Certificates

### 10.1 List

- Columns: type badge, project, reference number, date, last updated. Click the project name for the large preview.
- Preview popup: Download PDF, Word, Print, share link, Edit.
- Row buttons: preview, PDF, edit, duplicate, delete.
- New: Tank cleaning report, Work completion report (WCR), Monthly report, Blank report, any saved template, Certificate.

### 10.2 Report builder

- Front pages: cover (title, sub-title, label, name, optional second label/name), header lines (document, project/site, client), document control page (two title bars, rows of Label | Value | 2nd label | 2nd value, optional Prepared by / Approved by boxes), optional covering letter (from, to, project, subject, body, "report includes" list, signer, client name/signature/date block), automatic table of contents from the headings.
- Content blocks: heading (auto-numbered), sub-heading, text, list (bullet or numbered), table (add/remove rows and columns), key-value rows, photos.
- Moving content: every block has a Page number, up/down order, clone and delete. "Each heading on a new page" renumbers pages automatically. Add buttons add blocks.
- Photo blocks: photos per row 1-6; ratio (4:3, 3:4, 1:1, 16:9, 3:2, 2:3); size slider 10-100%; Fit all photos on one page (chooses columns and size); multi-file upload (auto-cropped to the ratio, original kept); reorder; remove; crop tool (drag, zoom, rotate, fill frame or fit whole photo, change ratio).
- Editing: form on the right with a draggable divider, live preview on the left, click-to-type directly in the preview.
- Company images (all documents): logo, footer bar, stamp, signature, certificate background; upload once, remove any time.
- Output: Save; Save as template (photos not stored in templates); Word .docx (header table on every page after the cover, footer bar, double page border); PDF (page images of the preview); Print.

### 10.3 Certificate

Fields: company, heading, client, project/villa, location, completion wording, work description, reference line, job completed date, expiry date (set to six months after completion automatically; editable once changed), stamp and background image. Landscape page; Word, PDF, print and preview as above; text can be edited directly in the preview.

## 11. Known limits and ideas for future updates

- Word and PDF files should be opened once to check page breaks, because the on-screen preview is an approximation.
- Photo ratios are fixed at upload; changing a block's ratio later needs a crop on each photo.
- Possible next updates: role-based permissions per section, automatic reminders (email/WhatsApp) for expiries and due samples, signature capture on delivery notes, barcode/QR on delivery notes, and a monthly management summary report.

## Sections shown in the Hub sidebar but not fully described above

Inventory, Site Directory, Staff Schedule, Assets. What the Hub screens show: Inventory lists materials with stock value and low/zero stock counts; Site Directory lists sites with contacts and map links; Staff Schedule has daily and monthly views with PDF; Assets lists equipment items with total asset value.
