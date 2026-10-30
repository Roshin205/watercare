# Wolgan

Wolgan is a Flask application that runs Wolgan Water Treatment's operations: AMC contracts and site visits, lab samples, PPM planners, chemical delivery, delivery notes, inventory, staff, equipment, and reports and certificates. The customer's full feature list is in `docs/customer-requirements.md`.

## Where it runs

| Part | Cloudflare service | In this repository |
| --- | --- | --- |
| Website and API (the Flask app) | Python Worker `watercare` | `cloudflare/worker.py`, `backend/`, `templates/`, `wrangler.jsonc`, `pyproject.toml` |
| CSS, JavaScript, images under `/static` | Workers Static Assets (served without running the Worker) | `static/` |
| Database | D1 database `watercare` (binding `DB`) | `d1-migrations/` |
| Photos and documents | Private R2 bucket `watercare-files` (binding `FILES`) | `backend/utils/storage.py` |

Plan: **Workers Paid ($5/month)**. A sign-in checks two PBKDF2 hashes, and the Operations pages read whole sections at a time, which is far over the free plan's 10 ms per request. D1 and R2 usage stays within their included amounts for a company of this size.

How the Flask app fits Workers: Flask runs through Cloudflare's WSGI adapter. SQLAlchemy builds the same SQLite SQL as before and `backend/d1.py` sends it to D1 through the binding (parameterised `?` placeholders, never string-joined values). D1 has no multi-statement transactions, so each statement is saved on its own. Python's `hashlib` has no PBKDF2 or scrypt inside Workers, so `backend/security/passwords.py` uses the runtime's Web Crypto API and writes the same `pbkdf2:sha256:100000$salt$hash` format a normal Python server reads. Cloudflare's Web Crypto refuses PBKDF2 above 100,000 iterations (the local `pywrangler dev` runtime does not enforce this), so hashes made with more cannot be checked in the Worker and those accounts need a new password.

## Local setup

Try it with sample data (its own database under `instance/`, never the real one, nothing sent to Cloudflare). The first run prints a random sign-in and keeps it in `instance/demo-login.txt`:

```bash
python scripts/local_demo.py --reset
```

To run against your own local database:

1. Install Python 3.12 or newer. Install packages with `pip install -r requirements-local.txt`.
2. Copy `.env.example` to `.env` and set a private random `SECRET_KEY`. Without `DATABASE_URL` the app uses the SQLite file `instance/watercare.db` and keeps uploads in `instance/uploads`.
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

Open http://localhost:8787.

On Windows, keep the project on drive C: when running `pywrangler`. A path bug in `uv` points the Pyodide environment at the wrong drive for projects on D: (error "Python interpreter not found ... pyodide-venv"). Running from a C: folder, WSL or another computer avoids it.

## Deploying to Cloudflare

One-time setup (logged in with `npx wrangler login`, Workers Paid plan active):

```bash
npx wrangler d1 create watercare                 # copy the printed database_id into wrangler.jsonc
npx wrangler r2 bucket create watercare-files    # stays private: no public access or custom domain on it
npx wrangler d1 migrations apply watercare --remote
npx wrangler secret put SECRET_KEY               # paste a random value of at least 32 characters
python scripts/d1_admin.py --email you@example.com --remote
uv run pywrangler deploy
```

Later updates: new database changes go in a new numbered file in `d1-migrations/` and are applied with `npx wrangler d1 migrations apply watercare --remote` before deploying the code that uses them (`uv run pywrangler deploy`).

`d1-migrations/0004_retire_old_sections.sql` is one-way. It copies projects into AMC contracts and engineers into staff profiles, then drops the old project, engineer, certificate template, water testing and tank cleaning tables. D1 Time Travel can undo it for 30 days.

Check the deployed site at `https://watercare.<your-subdomain>.workers.dev/api/health` (`{"status": "ok"}`), and follow the Worker's logs with `npx wrangler tail watercare`.

`scripts/d1_admin.py` also resets the administrator's password and private key: run it again with the same email. Passwords are hashed on your computer and only the hashes are sent to D1.

## How the code is arranged

- `backend/routes/api.py`: sign-in, company and personal settings, Clients and Services.
- `backend/routes/hub.py`: everything else. Every record is a row in `hub_records`; `backend/utils/hub_schema.py` lists the fields each kind of record accepts, and `backend/utils/hub_logic.py` holds the visit, sample and numbering rules.
- `static/js/app.js`: sign-in, the page shell, and the dashboard (calendar, overview, map).
- `static/js/hub/`: one file per section, sharing the tables, forms and downloads in `core.js`. Pages are drawn with the site's own `.panel`, `.filter-bar`, `.table-wrap`, `.status-badge` and `.form-grid`; `static/css/hub.css` only adds what those do not cover.

## Dashboard

The dashboard shows the key figures, the site map, Project Overview and the calendar. Pages open from the side menu only.

- **Calendar and Project Overview** list the month's site visits and lab sample due dates. Choose a day, or use **Today** and **All dates**. The work type filter narrows them to site visits, lab samples or one service. Editors can drag a due visit onto a calendar date to move it.
- **Site map** shows a pin for every contract with a saved position, coloured by what needs attention: grey Due, gold Pending Approval, green Visit Done, red Rejected. Nearby pins group into a numbered circle that splits as you zoom in, and each pin opens a card with the site's details.

**Staff dashboard:** a staff member signs in with the Staff login and sees **Work Assigned To You** with the map inside it, plus their own calendar and overview. Each visit has **Tap To Know The Location**, **Open Map** and **Mark Visit Done**.

## Site visits and approvals

A staff member presses **Mark Visit Done**, uploads before and after photos, and enters the actual date. The form shows whether the work was before, on or after the scheduled date, and the server works that out again from the two dates. The visit goes to **Approvals** as Pending Approval. An approver can approve (the visit becomes Done and the contract's last visit and next due dates update) or reject with a reason (the staff member corrects and resubmits). Every step is kept in the approval history. The office can also use **Log Visit** on a contract, which saves at once with no approval.

## Certificates

Certificates are built on screen in **Reports & Certificates**. Press **Make Certificate** on a project sheet, or choose a contract under **Pick From Contract**, and the client, site, location, service wording, SO reference, engineer, last visit date and expiry are filled in. Validity comes from the contract's service on the **Services** page, and six months if it has none. Every field can still be edited, and the certificate downloads as PDF or Word or prints directly.

## Roles and access

Flask stores the signed-in identity in a signed, HTTP-only session cookie. Mutating API requests also require the session CSRF token. The server reloads the account and active organization membership for each request and enforces role permissions and organization scoping on every API call; the interface only hides controls a role cannot use.

| Role | Access |
| --- | --- |
| Administrator | Full access, plus creating logins and changing company settings |
| Service Coordinator | View and edit all records; approve or reject visit completions |
| Accountant | View and edit all records; approve or reject visit completions |
| Staff (`employee`) | Their own dashboard and allocated visits; may submit a completion with photos |
| Viewer | View-only for all records |

Passport, visa, Emirates ID and date-of-birth details are only for the administrator and accountant roles.

### Sign-in

- **Admin login** (administrators, service coordinators and accountants): email, password **and a private key**. The key is stored only as a hash and is never shown again.
- **Staff login** (staff and viewers): email and password only. Admin-level accounts are refused here and told to use the Admin login, and the reverse.

Logins are created by administrators on **Staff Profiles** with **Create Login**, which sets the email, password (12+ characters), access level and, for coordinators and accountants, a private key. **Reset Login** changes the password. A login stops working when its staff member is marked Resigned or Terminated, or deleted.

There is no public registration route. Set or change an administrator's key from the command line (it prompts, so the key never appears in shell history):

```bash
flask --app main:app set-admin-key --email you@example.com
```

## Documents

On Cloudflare, uploads are stored in the private R2 bucket `watercare-files` under keys like `<organization>/hub/<record>/<random>-<file name>`, and their names, types and sizes are stored in D1 (`uploaded_documents`). Files are only served through the signed-in, organization-scoped `/api/hub/files/<id>` route; the bucket itself is never public. Upload types are checked by their actual content (PDF, Word, Excel, PNG, JPEG, WebP), up to 20 MB. Locally the same keys are used under `STORAGE_PATH`.

D1 has Time Travel (restore to any point in the last 30 days on the paid plan); R2 objects are kept until deleted. **Settings > Sharing And Backup** downloads every Operations record for longer-term copies.

## Map

Site locations are set in the contract form and stored as latitude and longitude. In the form, a user can:

- type a place or address and pick from the suggestions that appear (each one is also shown as a gold dot on the map; **Apply** or click the dot to use it),
- click the map to drop a pin manually and drag the pin to the exact spot,
- type latitude and longitude, or paste a pair such as `25.2854, 51.531` into the search box.

The map uses free services that need **no API key**:

- [Leaflet](https://leafletjs.com) 1.9.4 with [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) 1.5.3 for grouped pins.
- [OpenFreeMap](https://openfreemap.org) "Positron" vector basemap (free, no registration, attribution shown on the map), drawn by [MapLibre GL JS](https://maplibre.org) 5.24.0 through the [maplibre-gl-leaflet](https://github.com/maplibre/maplibre-gl-leaflet) 0.1.4 bridge. If it cannot load, the map falls back to toned-down [OpenStreetMap](https://www.openstreetmap.org) tiles under the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- [Photon](https://photon.komoot.io) by komoot for suggestions while typing, and [Nominatim](https://nominatim.org) as a backup when the Search button finds nothing, under its [usage policy](https://operations.osmfoundation.org/policies/nominatim/). Search text is sent to these OpenStreetMap-based services.

All map libraries load from unpkg with Subresource Integrity hashes.

## Moving existing records and files

1. Apply the D1 schema first: `npx wrangler d1 migrations apply watercare --remote`.
2. Export the rows: `python scripts/export_to_d1.py --source instance/watercare.db --out d1-import.sql`. The script prints each table's row count and lists accounts whose passwords cannot be checked in the Worker (they need a new password: `scripts/d1_admin.py` for administrators, **Reset Login** for staff).
3. Load them: `npx wrangler d1 execute watercare --remote --file d1-import.sql`, then delete `d1-import.sql`.
4. Copy the files under the same keys: `python scripts/export_to_d1.py --source instance/watercare.db --upload-files --remote`.

## GitHub safety

Never commit `.env`, database URLs, passwords, or session keys. The `.gitignore` excludes local secret/configuration files, SQLite databases, uploads, and Python build artifacts. Previously disclosed credentials must be revoked and replaced before deployment.
