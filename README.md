# WaterCare

WaterCare is a Flask application for employee-managed client, project, engineer, water-testing, tank-cleaning, schedule, and report records. The existing Arabic-inspired interface and its calendar, client filtering, date-wise work list, project map, completion approvals, and report exports remain served by Flask.

## Local setup

1. Install Python 3.11 or newer and create a virtual environment.
2. Install packages with `pip install -r requirements.txt`.
3. Copy `.env.example` to `.env`. Set a private random `SECRET_KEY`; use a local PostgreSQL URL or leave `DATABASE_URL` unset for the local SQLite database.
4. Apply the additive schema migration with `flask --app main:app db upgrade`.
5. Create the first organization administrator using `flask --app main:app create-admin`.
6. Start development with `python main.py`.

Administrators can create `service_coordinator`, `accountant`, `employee`, and `viewer` login accounts through `POST /api/auth/users`; passwords must be at least 12 characters. An employee account also gets an engineer profile; add its Engineer ID on the Engineers page. Employees change their own passwords through `POST /api/auth/change-password`. The command `flask --app main:app set-password` lets an operator reset an account after verifying the request. Passwords are stored as Werkzeug hashes and are never returned by the API.

## Render deployment

Create or select a Render PostgreSQL instance, then set these environment variables on the existing Web Service:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Render PostgreSQL **internal** connection URL |
| `SECRET_KEY` | New, randomly generated private value |
| `FLASK_ENV` | `production` |
| `STORAGE_PATH` | `/var/data/uploads` when a persistent disk is mounted at `/var/data`; otherwise set a confirmed durable storage path |
| `LOG_LEVEL` | `INFO` |

Use `pip install -r requirements.txt` as the build command. Before starting the web process, run `flask --app main:app db upgrade` as a controlled deployment/pre-deploy step; do not run destructive schema operations or downgrade production tables. Start with:

```text
gunicorn main:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
```

Configure `/api/health` as the Render health-check path. If the database is unavailable, the endpoint returns a generic 503 response without disclosing connection details.

## Database and existing records

Render PostgreSQL is authoritative after cutover. Migrations create tables only when they do not exist and do not drop or replace existing data. The first migration is an additive baseline for a new WaterCare database; the prior hosted database is not automatically copied. Export and verify existing organization, user, client, project, schedule, cleaning, testing, and document metadata before cutover. Do not delete or disable the previous database until counts, relationships, and application access have been checked against the new instance.

Schema changes must be reviewed and committed as Alembic revisions. Use `flask --app main:app db migrate -m "describe change"` to generate a revision, review its operations, and apply it with `db upgrade`.

Revision `202610260006` adds Engineer IDs (unique per organization), custom schedule dates, invoice numbers, approval status and rejection reason, project latitude/longitude, and the `approval_history` table. It only adds columns and tables. Existing projects keep their Monthly/Weekly schedule values; projects that are not yet completed start with approval status `Pending`, and projects completed before approvals existed keep a blank approval status. Any `manager` accounts become `service_coordinator` accounts. Run `flask --app main:app db upgrade` locally and as the Render pre-deploy step to apply it.

Revision `202610270007` adds the project priority date and rank used to persist manual work-order changes. It adds columns only; existing projects remain in date order until someone reorders them.

## Authentication and access control

Flask stores authenticated employee identity in a signed, HTTP-only session cookie. Mutating API requests also require the session CSRF token. The server reloads the account and active organization membership for each request and enforces role permissions and organization scoping on every API call; the interface only hides controls a role cannot use.

| Role | Access |
| --- | --- |
| Administrator | Full access, plus creating login accounts and changing organization settings |
| Service Coordinator | View and edit all records; approve or reject completions |
| Accountant | View and edit all records; approve or reject completions |
| Employee | View-only for work assigned to their engineer profile; may submit a completion (with invoice number and before/after photos) for an assigned project |
| Viewer | View-only for all organization records |

A completion submission sets the project's approval status to **Submitted for Approval**. A Service Coordinator, Accountant, or Administrator then approves it (the project becomes **Approved** and **Completed**) or rejects it with a reason (**Rejected**; the submitter can correct and resubmit). Every change is recorded in `approval_history` with the project reference, previous and new status, action, who acted, when, and any rejection reason; the Approvals page lists submissions awaiting a decision and the full history.

There is no public registration route. Create accounts only for authorized employees. For a password reset, verify the employee through the organization’s normal process and run the `set-password` CLI command on the deployed service or from a trusted operator environment.

## Project work order and filters

The Projects page and dashboard list projects by scheduled date, with a bold date heading for each group. Service Coordinators, Accountants, and Administrators can drag a project's handle to reorder work within or across dates; touch dragging and keyboard arrow keys are supported as well. The shared order is saved in the database. If a project is rescheduled, it returns to its new date group. Use **Reset to date order** to clear manual ordering and restore the scheduled-date order.

The dashboard starts with all projects. Choose a calendar day or use the date field to show work for one day; **All dates** returns to the full list. List pages provide search, client, project, and date-range filters. Search checks project and client names, sites, engineer names, and SO numbers. Report downloads and the dashboard map use the active filters too. The dashboard filter uses one date rather than a date range, and includes **Today** and **All dates** shortcuts.

## Documents

The application stores uploads under `STORAGE_PATH` and stores metadata and organization associations in PostgreSQL. Files are served only through an authenticated, organization-scoped route. Render's default filesystem is ephemeral; configure and mount a persistent disk before enabling production uploads, and keep its mount path synchronized with `STORAGE_PATH`. The existing bucket named `Water-managment` could not be identified from this source repository: its storage provider and credentials must be verified with the bucket owner before it can be reused. No external storage integration or credentials are assumed.

Back up the PostgreSQL database and persistent disk independently, and periodically test restoring both.

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
