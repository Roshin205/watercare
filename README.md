# WaterCare

WaterCare is a Flask application for employee-managed client, project, engineer, water-testing, tank-cleaning, schedule, and report records. The existing Arabic-inspired interface and its calendar, client filtering, date-wise work list, project map, completion approvals, and report exports remain served by Flask.

## Where it runs

| Part | Cloudflare service | In this repository |
| --- | --- | --- |
| Website and API (the Flask app) | Python Worker `watercare` | `cloudflare/worker.py`, `backend/`, `templates/`, `wrangler.jsonc`, `pyproject.toml` |
| CSS, JavaScript, images under `/static` | Workers Static Assets (served without running the Worker) | `static/` |
| Database | D1 database `watercare` (binding `DB`) | `d1-migrations/` |
| Photos, certificate templates, documents | Private R2 bucket `watercare-files` (binding `FILES`) | `backend/utils/storage.py` |
| Certificate PDFs | Worker `watercare-pdf` + a LibreOffice Container (binding `PDF`) | `pdf-converter/` |

Plan: **Workers Paid ($5/month)**. A sign-in checks two PBKDF2 hashes (about 0.5 s of CPU), which is far over the free
plan's 10 ms per request, and Containers are only offered on the paid plan. D1 and R2 usage stays within their included
amounts for a company of this size.

How the Flask app fits Workers: Flask runs through Cloudflare's WSGI adapter. SQLAlchemy builds the same SQLite SQL as
before and `backend/d1.py` sends it to D1 through the binding (parameterised `?` placeholders, never string-joined
values). D1 has no multi-statement transactions, so each statement is saved on its own. Python's `hashlib` has no
PBKDF2 or scrypt inside Workers, so `backend/security/passwords.py` uses the runtime's Web Crypto API and writes the same
`pbkdf2:sha256:600000$salt$hash` format a normal Python server reads.

## Local setup

1. Install Python 3.12 or newer. Install packages with `pip install -r requirements-local.txt`.
2. Copy `.env.example` to `.env` and set a private random `SECRET_KEY`. Without `DATABASE_URL` the app uses the SQLite
   file `instance/watercare.db` and keeps uploads in `instance/uploads`.
3. Create or update the local tables with `flask --app main:app db upgrade`.
4. Create the first administrator with `flask --app main:app create-admin`.
5. Start with `python main.py` and open http://127.0.0.1:5000.

Tests: `python -m pytest`. Run them again through the D1 driver with `WATERCARE_TEST_D1=1 python -m pytest`.

### Running the Worker locally (Cloudflare's runtime, local D1 and R2)

Needs Node.js 20+ and `uv` (`pip install uv`).

```bash
cp .dev.vars.example .dev.vars          # then put a random 64-character SECRET_KEY in it
npx wrangler d1 migrations apply watercare --local
python scripts/d1_admin.py --email you@example.com --local
uv run pywrangler dev
```

Open http://localhost:8787. Certificates need the PDF converter; without it the download explains that it is missing.

On Windows, keep the project on drive C: when running `pywrangler`. A path bug in `uv` points the Pyodide environment at
the wrong drive for projects on D: (error "Python interpreter not found ... pyodide-venv"). Running from a C: folder,
WSL or another computer avoids it.

## Deploying to Cloudflare

One-time setup (logged in with `npx wrangler login`, Workers Paid plan active):

```bash
npx wrangler d1 create watercare                 # copy the printed database_id into wrangler.jsonc
npx wrangler r2 bucket create watercare-files    # stays private: no public access or custom domain on it
npx wrangler d1 migrations apply watercare --remote
npx wrangler secret put SECRET_KEY               # paste a random value of at least 32 characters
python scripts/d1_admin.py --email you@example.com --remote
```

Deploy the PDF converter first (Docker Desktop must be running, it builds the container image), then the website:

```bash
cd pdf-converter && npm install && npx wrangler deploy && cd ..
uv run pywrangler deploy
```

Later updates: `uv run pywrangler deploy` (and `npx wrangler deploy` in `pdf-converter/` if that changed). New database
changes go in a new numbered file in `d1-migrations/` and are applied with
`npx wrangler d1 migrations apply watercare --remote` before deploying the code that uses them.

Check the deployed site at `https://watercare.<your-subdomain>.workers.dev/api/health` (`{"status": "ok"}`), and follow
the Worker's logs with `npx wrangler tail watercare`.

`scripts/d1_admin.py` also resets the administrator's password and private key: run it again with the same email.
Passwords are hashed on your computer and only the hashes are sent to D1.

## Moving existing records and files

Nothing is deleted from the old database or the old upload folder; the steps only copy.

1. Apply the D1 schema first: `npx wrangler d1 migrations apply watercare --remote`.
2. Export the rows: `python scripts/export_to_d1.py --source instance/watercare.db --out d1-import.sql`. The script
   prints each table's row count and lists accounts whose passwords are stored as `scrypt` (those cannot be checked in
   the Worker and need a new password: `scripts/d1_admin.py` for administrators, the Engineers page for employees).
3. Load them: `npx wrangler d1 execute watercare --remote --file d1-import.sql`, then delete `d1-import.sql`.
4. Copy the files under the same keys: `python scripts/export_to_d1.py --source instance/watercare.db --upload-files --remote`.
5. Compare counts before switching users over, for example
   `npx wrangler d1 execute watercare --remote --command "SELECT COUNT(*) FROM projects"`.

Administrators can create `service_coordinator`, `accountant`, `employee`, and `viewer` login accounts through `POST /api/auth/users`; passwords must be at least 12 characters. An employee account also gets an engineer profile; add its Engineer ID on the Engineers page. Employees change their own passwords through `POST /api/auth/change-password`. The command `flask --app main:app set-password` lets an operator reset an account after verifying the request. Passwords are stored as PBKDF2 hashes and are never returned by the API.

## Database

D1 is authoritative once the site runs on Cloudflare. `d1-migrations/0001_initial_schema.sql` creates every table, foreign key and index; it was generated from the local Alembic migrations, so a local SQLite database and D1 have the same layout and records copy across unchanged. Locally the Alembic revisions in `migrations/` still manage `instance/watercare.db`. A test (`test_d1_migration_creates_every_table_and_column_the_app_uses`) fails if the D1 schema misses anything the app uses.

Schema history:

Revision `202610260006` adds Engineer IDs (unique per organization), custom schedule dates, invoice numbers, approval status and rejection reason, project latitude/longitude, and the `approval_history` table. It only adds columns and tables. Existing projects keep their Monthly/Weekly schedule values; projects that are not yet completed start with approval status `Pending`, and projects completed before approvals existed keep a blank approval status. Any `manager` accounts become `service_coordinator` accounts. Locally, `flask --app main:app db upgrade` applies it; on Cloudflare the D1 schema already contains it.

Revision `202610270007` adds the project priority date and rank used to persist manual work-order changes. It adds columns only; existing projects remain in date order until someone reorders them.

Revision `202610280008` adds the actual completion date and completion engineer name. It maps existing completion timing and awaiting-approval values to the current form labels while preserving project and approval history data. Locally, `flask --app main:app db upgrade` applies it; on Cloudflare the D1 schema already contains it.

## Authentication and access control

Flask stores authenticated employee identity in a signed, HTTP-only session cookie. Mutating API requests also require the session CSRF token. The server reloads the account and active organization membership for each request and enforces role permissions and organization scoping on every API call; the interface only hides controls a role cannot use.

| Role | Access |
| --- | --- |
| Administrator | Full access, plus creating login accounts and changing organization settings |
| Service Coordinator | View and edit all records; approve or reject completions |
| Accountant | View and edit all records; approve or reject completions |
| Employee | View-only for work assigned to their engineer profile; may submit a completion (with invoice number and before/after photos) for an assigned project |
| Viewer | View-only for all organization records |

A worker submits the Work Completion & Approval Form against the existing project. Client, project, and scheduled-date details are prefilled; the worker enters the invoice number and completion engineer, uploads before- and after-work photos, and selects the actual completion date. The form displays whether completion was before, on, or after the scheduled date, and the server independently derives and saves that category from the two dates. Submissions are marked **Pending Approval** and shown to Service Coordinators, Accountants, and Administrators with the completion details and photos. An approver can approve (the project becomes **Approved** and **Completed**) or reject with a reason (**Rejected**; the worker can correct and resubmit). Every status change is recorded in `approval_history`.

There is no public registration route. Create accounts only for authorized employees. For a password reset, verify the employee through the organization’s normal process and reset it from the Engineers page (employees) or with `scripts/d1_admin.py` (the administrator).

## Project work order and filters

The Projects page and dashboard list projects by scheduled date, with a bold date heading for each group. Service Coordinators, Accountants, and Administrators can drag a project's handle to reorder work within or across dates; touch dragging and keyboard arrow keys are supported as well. On the dashboard, drag a project card onto a calendar day to schedule or reschedule it. Choose a single day or a range; range dates can be picked on the calendar or entered directly, and every covered day shows the project. The shared order and schedule are saved in the database. If a project is rescheduled, it returns to its new date group. Use **Reset to date order** to clear manual ordering and restore the scheduled-date order.

The dashboard starts with all projects. Choose a calendar day or use the date field to show work for one day; **All dates** returns to the full list. List pages provide search, client, project, and date-range filters. Search checks project and client names, sites, engineer names, and SO numbers. Report downloads and the dashboard map use the active filters too. The dashboard filter uses one date rather than a date range, and includes **Today** and **All dates** shortcuts. Interface transitions and hover effects are lightweight and respect the device's reduced-motion preference.

## Sign-in: Admin login and Client login

The sign-in page has two tabs:

- **Admin login** (administrators, service coordinators and accountants): email, password **and a private key**. The key is stored only as a hash in the `users.access_key_hash` column and is never shown again. Accounts without a key cannot use the Admin login.
- **Client login** (employees and viewers): email and password only. Admin-level accounts are refused here and told to use the Admin login, and the reverse.

Set or change a key from the command line (it prompts, so the key never appears in shell history):

```bash
flask --app main:app set-admin-key --email you@example.com
```

`create-admin` now asks for the key too. Administrators create admin-level accounts through `POST /api/auth/users` with an `access_key` of at least 12 characters.

**Employee logins** are created by administrators on the Engineers page: enter the Engineer ID, name, the Gmail used to sign in and a login password (12+ characters). Editing the engineer with a new password resets it. Only administrators can see or use the password field.

**What each role sees:** employees can sign in, mark their assigned work as completed from the dashboard (everything else is view-only), view the Projects page without edit buttons, and move and zoom the map freely. They never see the Approvals page; only administrators, service coordinators and accountants approve or reject. Administrators and coordinators also get a small "Tap to know the location" button on each dashboard project that opens its place on the map.

## Documents

On Cloudflare, uploads (before/after photos, engineer photos, certificate templates) are stored in the private R2 bucket `watercare-files` under keys like `<organization>/<kind>/<record>/<random>-<file name>`, and their names, types, sizes and links to projects, engineers and clients are stored in D1 (`uploaded_documents`, `certificate_templates`). Files are only served through the signed-in, organization-scoped `/api/uploads/<id>` route; the bucket itself is never public. Upload types are checked by their actual content (PDF, Excel, PNG, JPEG, PowerPoint, Word), up to 15 MB. Locally the same keys are used under `STORAGE_PATH`.

D1 has Time Travel (restore to any point in the last 30 days on the paid plan); R2 objects are kept until deleted. Export both periodically if you need longer-term copies.

## Project map

Project locations are set in the project form and stored as latitude/longitude in the database. The dashboard map shows a pin for every located project, coloured by approval status (grey Pending, gold Awaiting approval, green Approved, red Rejected) with a legend and counts underneath. Nearby pins are grouped into a numbered circle that splits as you zoom in, and each pin opens a card with the client, project, engineer, task details, status and location, plus a button to open the project (or view its completion for view-only roles). In the form, a user can:

- type a place or address and pick from the suggestions that appear (each one is also shown as a gold dot on the map; **Apply** or click the dot to use it),
- click the map to drop a pin manually and drag the pin to the exact spot,
- type latitude and longitude, or paste a pair such as `25.2854, 51.531` into the search box.

Use the mouse wheel to zoom either the dashboard map or the project-form map.

The map uses free services that need **no API key**:

- [Leaflet](https://leafletjs.com) 1.9.4 with [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) 1.5.3 for grouped pins.
- [OpenFreeMap](https://openfreemap.org) "Positron" vector basemap (free, no registration, attribution shown on the map), drawn by [MapLibre GL JS](https://maplibre.org) 5.24.0 through the [maplibre-gl-leaflet](https://github.com/maplibre/maplibre-gl-leaflet) 0.1.4 bridge. The app recolours it to WaterCare's cream, teal and sage, and shows place names in English (falling back to Latin transliteration, then the local name).
- If the vector map cannot load (no WebGL, a blocked CDN or an OpenFreeMap outage), the map falls back to toned-down [OpenStreetMap](https://www.openstreetmap.org) tiles under the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

All map libraries load from unpkg with Subresource Integrity hashes.
- [Photon](https://photon.komoot.io) by komoot for the suggestions while typing (a 450 ms pause after typing, at least 3 characters, results biased toward the area shown on the map). The public server is free for fair use and may throttle heavy use.
- [Nominatim](https://nominatim.org) as a backup when the Search button finds nothing through Photon, under its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) (one request per press, never while typing).

Search text is sent to these OpenStreetMap-based services.

If usage grows beyond those policies, switch the tile URL in `static/js/app.js` to a commercial provider (for example MapTiler or Stadia Maps). Those services issue browser keys that are public by design; restrict such a key to your site's domain in the provider's dashboard and never place a secret or server key in frontend code. Without internet access the map shows a message and the rest of the project form still saves.

## GitHub safety

Never commit `.env`, database URLs, passwords, or session keys. The `.gitignore` excludes local secret/configuration files, SQLite databases, uploads, and Python build artifacts. Previously disclosed credentials must be revoked and replaced before deployment. If any credential-bearing revision is already in Git history, do not push that history; publish only a clean, sanitized source history after rotating the exposed credentials.

## Services and certificates

The **Services** page (administrators) lists the services the company offers. Water testing and Tank cleaning are
there to start with; each service has a certificate wording and a validity in months. Project forms, filters and
certificates all use this list.

The **Certificates** page (administrator, service coordinator, accountant) keeps one editable PowerPoint (.pptx) or Word
(.docx) template per certificate type (a service). In the template, type tags where data should go:
`{{client_name}}`, `{{project_name}}`, `{{location}}`, `{{service_text}}`, `{{reference}}`, `{{completion_date}}`,
`{{expiry_date}}`, `{{so_number}}`, `{{contract_period}}`, `{{engineer_name}}`, `{{invoice_number}}` and `{{issue_date}}`.
Once an engineer's completion is approved, everyone who can see that project gets a **Download certificate** button that
fills the newest template for the project's service and downloads it as a PDF. Fonts are kept as in the template and no
text is bold. On Cloudflare the PDF is made by LibreOffice in the `watercare-pdf` container; put licensed font files (for
example Trebuchet MS) in `pdf-converter/fonts/` so the PDF uses the template's fonts. Locally, LibreOffice or Microsoft
PowerPoint/Word on Windows is used. Without a converter the download shows an error.
