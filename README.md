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

## Documents

The application stores uploads under `STORAGE_PATH` and stores metadata and organization associations in PostgreSQL. Files are served only through an authenticated, organization-scoped route. Render's default filesystem is ephemeral; configure and mount a persistent disk before enabling production uploads, and keep its mount path synchronized with `STORAGE_PATH`. The existing bucket named `Water-managment` could not be identified from this source repository: its storage provider and credentials must be verified with the bucket owner before it can be reused. No external storage integration or credentials are assumed.

Back up the PostgreSQL database and persistent disk independently, and periodically test restoring both.

## Project map

Project locations are chosen on an interactive map in the project form and stored as latitude/longitude in the database; the dashboard shows a marker for every project that has a saved location. The map uses free services that need **no API key**:

- [Leaflet](https://leafletjs.com) 1.9.4, loaded from unpkg with a Subresource Integrity hash.
- [OpenStreetMap](https://www.openstreetmap.org) map tiles, used under the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/) (attribution shown on the map, light traffic only).
- [Nominatim](https://nominatim.org) place search, called from the browser only when someone presses Search, under its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) (at most one request per second, no autocomplete). Search text is sent to OpenStreetMap's servers.

If usage grows beyond those policies, switch the tile URL in `static/js/app.js` to a commercial provider (for example MapTiler or Stadia Maps). Those services issue browser keys that are public by design; restrict such a key to your site's domain in the provider's dashboard and never place a secret or server key in frontend code. Without internet access the map shows a message and the rest of the project form still saves.

## GitHub safety

Never commit `.env`, database URLs, passwords, or session keys. The `.gitignore` excludes local secret/configuration files, SQLite databases, uploads, and Python build artifacts. Previously disclosed credentials must be revoked and replaced before deployment. If any credential-bearing revision is already in Git history, do not push that history; publish only a clean, sanitized source history after rotating the exposed credentials.
