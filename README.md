# WaterCare

WaterCare is a Flask-hosted business application with Supabase Auth, PostgreSQL, and private Supabase Storage. The supplied directory originally contained only a PyCharm sample script; there were no existing WaterCare pages, records, or application settings to migrate. The interface in this repository is a new WaterCare starting shell rather than an unchanged prior deployment.

## Project structure

- `main.py`, `config.py`: Flask entry point and environment configuration.
- `backend/routes/api.py`: API blueprint, authentication checks, organization scoping, CRUD, uploads, dashboard, settings, and exports.
- `backend/security/`: Supabase access-token verification and membership/role checks.
- `backend/utils/validators.py`: server-side payload validation.
- `supabase/migrations/`: version-controlled PostgreSQL schema, indexes, audit trigger, RLS, and private bucket policies.
- `templates/`, `static/`: responsive WaterCare web interface.
- `tests/`: API/authentication and validation tests.

## Migration plan

1. The inspected starting point was only `main.py` with a PyCharm sample function; no WaterCare UI, dependency file, Render manifest, Supabase configuration, or business data was present to migrate. No external deployment or production data has been changed.
2. Configure a separate/test Supabase project first and apply the additive initial migration. Create one pilot organization and test accounts, then exercise RLS, CRUD, exports, and private-file access using non-production data.
3. Add the environment values to the existing Render service only after confirming its identity and current settings. Deploy the Flask service, verify health and employee workflows, then onboard the remaining employees.
4. Preserve the migration and source history. For a code rollback, redeploy the prior Render build; do not reverse the schema migration or delete records. Restore data only through the verified database-and-storage recovery process below.

## Local setup

1. Use Python 3.11 or later. Create and activate a virtual environment.
2. Install dependencies: `pip install -r requirements.txt`. For development/tests, use `pip install -r requirements-dev.txt`.
3. Copy `.env.example` to `.env`, then set `SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY`.
4. Create a Supabase project. Apply `supabase/migrations/202610230001_initial_schema.sql` once using the Supabase SQL editor or `supabase db push` after linking the project with the Supabase CLI. Keep migration history in source control and review future migrations before applying them.
5. In Supabase Auth, enable the employee login methods and set password recovery redirect URLs to the deployed WaterCare origin.
6. Create an organization, create authorized employee accounts in Supabase Auth, and add their `organization_memberships` records with role `administrator`, `manager`, or `employee`. Create linked engineer rows (`user_id`) for employee/engineer accounts to scope their task lists.
7. Run `python main.py`, then open `http://localhost:5000`. With development requirements installed, run tests using `pytest`.

The server-only service-role client is retained for access-token verification and the minimal health query. Business reads, writes, and storage operations use a request-scoped Supabase client configured with the user's verified access token and the public anon key, so Supabase RLS is enforced as well as Flask organization and role checks. Browser code receives only the public anon key and the employee's own short-lived access/refresh tokens. Never put the service-role key in the template, browser bundle, or logs.

`main.py` already loads `.env` with `python-dotenv`; do not replace it with a standalone `psycopg2.connect()` call. This application uses Supabase Auth, PostgREST, and Storage through the Supabase Python client. A direct PostgreSQL connection using `DATABASE_URL` would create a separate database access path (and a `postgres` connection can bypass RLS); it is not required for this app and no database password is stored here. Configure the existing Supabase URL and API keys in `.env` locally or in Render's Environment settings. If a future feature genuinely requires direct PostgreSQL, use a dedicated least-privilege database role, a protected connection string supplied through the deployment environment, and an explicitly reviewed implementation.

## Render deployment

Connect this repository to the existing Render service if applicable; do not create a replacement without checking the deployed service and its existing database first. The included `render.yaml` uses `pip install -r requirements.txt`, Gunicorn (`main:app`), `PORT`, and `/api/health`. Configure the four required secrets in the existing Render service's Environment page. Apply schema migrations to Supabase separately before deploying the code. Confirm the health endpoint, a test login, organization scoping, and create/read/update/archive operations against a non-production organization before directing employees to the service.

The Flask app fails at startup with the names (not values) of any missing required settings: `SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. `/api/health` performs a minimal query and reports only `ok` or `database_unavailable`; it does not expose configuration or credentials.

## Data safety, backups, recovery

- Check the Supabase plan's backup/PITR availability, retention window, and restore procedure in the project dashboard; features and retention depend on plan. Do not assume a plan has a backup feature until verified.
- Set an independent scheduled `pg_dump` process in a trusted operations environment (not the Render ephemeral filesystem) using a dedicated restricted database credential. Encrypt backups at rest, restrict access, set a retention schedule, and periodically test restoring into a separate Supabase project.
- Database dumps do **not** include Supabase Storage object contents. Back up the private `watercare-private` bucket separately using an authorized Supabase Storage/API export to encrypted durable storage, and test restoring objects plus metadata together.
- Keep backup credentials outside this repository and Render application logs. Record backup timestamps and restore test results in the organization's operations records.
- Recovery sequence: provision/restore a Supabase project, apply any migrations missing from the restored snapshot, restore database data and the private bucket, verify Auth users and membership links, configure Render environment variables, then smoke-test health, login, scoped access, document downloads, and exports before switching traffic.
- Audit triggers capture insert/update/delete changes to core business tables. Audit logs are organization-readable and should be retained according to contractual and legal requirements. Soft archive is used in the API instead of destructive record deletion.

## Current scope and manual follow-up

The application includes authenticated organization-scoped APIs, core business tables, project/client/engineer/cleaning/water-testing CRUD, calendar/dashboard queries, CSV/XLSX/PDF exports, private document upload/signed download, settings endpoints, and a responsive dashboard interface. No production Supabase project is configured here, so authentication, database connectivity, RLS behavior, storage, and Render deployment must be configured and verified by the organization before operational use.

The initial UI does not yet expose every API capability (for example, user administration, file-management screens, and detailed water-testing/result workflows). Employee task scope depends on linking an engineer row to the Supabase user and assigning that engineer through project assignments or work-record engineer IDs. Supabase service role operations remain server-trusted; retain organization/role filtering in every new API endpoint.
