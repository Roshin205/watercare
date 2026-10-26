# WaterCare

WaterCare is a Flask application for employee-managed client, project, engineer, water-testing, tank-cleaning, schedule, and report records. The existing Arabic-inspired interface and its calendar, client filtering, project carousel, and report exports remain served by Flask.

## Local setup

1. Install Python 3.11 or newer and create a virtual environment.
2. Install packages with `pip install -r requirements.txt`.
3. Copy `.env.example` to `.env`. Set a private random `SECRET_KEY`; use a local PostgreSQL URL or leave `DATABASE_URL` unset for the local SQLite database.
4. Apply the additive schema migration with `flask --app main:app db upgrade`.
5. Create the first organization administrator using `flask --app main:app create-admin`.
6. Start development with `python main.py`.

Administrators can create manager and employee login accounts through `POST /api/auth/users`; passwords must be at least 12 characters. Employees change their own passwords through `POST /api/auth/change-password`. The command `flask --app main:app set-password` lets an operator reset an account after verifying the request. Passwords are stored as Werkzeug hashes and are never returned by the API.

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

## Authentication and access control

Flask stores authenticated employee identity in a signed, HTTP-only session cookie. Mutating API requests also require the session CSRF token. The server reloads the account and active organization membership for each request and enforces manager/administrator permissions and organization scoping.

There is no public registration route. Create accounts only for authorized employees. For a password reset, verify the employee through the organization’s normal process and run the `set-password` CLI command on the deployed service or from a trusted operator environment.

## Documents

The application stores uploads under `STORAGE_PATH` and stores metadata and organization associations in PostgreSQL. Files are served only through an authenticated, organization-scoped route. Render's default filesystem is ephemeral; configure and mount a persistent disk before enabling production uploads, and keep its mount path synchronized with `STORAGE_PATH`. The existing bucket named `Water-managment` could not be identified from this source repository: its storage provider and credentials must be verified with the bucket owner before it can be reused. No external storage integration or credentials are assumed.

Back up the PostgreSQL database and persistent disk independently, and periodically test restoring both.

## GitHub safety

Never commit `.env`, database URLs, passwords, or session keys. The `.gitignore` excludes local secret/configuration files, SQLite databases, uploads, and Python build artifacts. Previously disclosed credentials must be revoked and replaced before deployment. If any credential-bearing revision is already in Git history, do not push that history; publish only a clean, sanitized source history after rotating the exposed credentials.
