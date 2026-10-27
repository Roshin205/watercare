import json
import logging
import os
import hmac
import re
import tempfile
from datetime import datetime, timezone
from uuid import uuid4

import click
from flask import Flask, jsonify, render_template, request, session
from flask_migrate import Migrate
from werkzeug.exceptions import HTTPException
from werkzeug.security import generate_password_hash

from config import Config
from backend.database import Database, db
from backend.routes.api import api
from backend import models

migrate = Migrate()


def create_app(config_object=Config):
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(config_object)
    if not app.testing and os.environ.get("FLASK_ENV") == "production":
        missing = [key for key in ("SECRET_KEY", "DATABASE_URL") if not os.environ.get(key)]
        if missing:
            raise RuntimeError("Missing required deployment configuration: " + ", ".join(missing))
        cloud_files = all(app.config.get(key) for key in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_BUCKET"))
        if not cloud_files and not os.path.isabs(app.config["STORAGE_PATH"]):
            raise RuntimeError(
                "Set SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_BUCKET for cloud files, "
                "or STORAGE_PATH to an absolute path on a persistent disk."
            )

    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    db.init_app(app)
    migrate.init_app(app, db, directory=os.path.abspath(os.path.join(app.root_path, "..", "migrations")))
    app.extensions["watercare_database"] = Database()
    try:
        os.makedirs(app.config["STORAGE_PATH"], exist_ok=True)
    except OSError:
        # With cloud files the local folder is never used; without them, fall back to a writable temporary folder.
        fallback = os.path.join(tempfile.gettempdir(), "watercare-uploads")
        os.makedirs(fallback, exist_ok=True)
        if not all(app.config.get(key) for key in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_BUCKET")):
            logging.getLogger(__name__).warning(
                "STORAGE_PATH %s is not writable; using %s, which is lost on restart.", app.config["STORAGE_PATH"], fallback,
            )
        app.config["STORAGE_PATH"] = fallback
    app.register_blueprint(api, url_prefix="/api")

    @app.before_request
    def validate_csrf():
        expected = session.get("csrf_token")
        supplied = request.headers.get("X-CSRF-Token", "")
        if (
            request.path.startswith("/api/")
            and request.method not in {"GET", "HEAD", "OPTIONS"}
            and request.path != "/api/auth/login"
            and session.get("user_id")
            and (not expected or not hmac.compare_digest(expected, supplied))
        ):
            return jsonify({"error": {"code": "csrf_failed", "message": "Request verification failed. Reload and try again."}}), 403

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/api/health")
    def health():
        try:
            with db.engine.connect() as connection:
                connection.exec_driver_sql("SELECT 1")
        except Exception:
            app.logger.warning("Database health check failed.", exc_info=True)
            return jsonify({"status": "database_unavailable"}), 503
        try:
            with db.engine.connect() as connection:
                connection.exec_driver_sql("SELECT 1 FROM users LIMIT 1")
        except Exception:
            # Reachable but empty: `flask --app main:app db upgrade` (run by start.sh) has not created the tables.
            app.logger.warning("Database has no WaterCare tables yet.", exc_info=True)
            return jsonify({"status": "database_not_set_up"}), 503
        return jsonify({"status": "ok"}), 200

    @app.cli.command("create-admin")
    @click.option("--email", prompt=True)
    @click.option("--name", prompt="Administrator name")
    @click.option("--organization", prompt="Organization name")
    @click.password_option()
    @click.option("--access-key", prompt="Private admin key", hide_input=True, confirmation_prompt=True)
    def create_admin(email, name, organization, password, access_key):
        """Create the first organization and administrator account."""
        from backend.database import db
        from backend.models import memberships, organizations, users

        email = email.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or not 12 <= len(password) <= 512:
            raise click.ClickException("Use a valid email and a password between 12 and 512 characters.")
        if not 12 <= len(access_key) <= 512:
            raise click.ClickException("The private key must be between 12 and 512 characters.")
        now, organization_id, user_id = datetime.now(timezone.utc).isoformat(), str(uuid4()), str(uuid4())
        with db.engine.begin() as connection:
            if connection.execute(db.select(users.c.id).where(users.c.email == email.lower())).first():
                raise click.ClickException("An account with that email already exists.")
            connection.execute(organizations.insert().values(
                id=organization_id, name=organization, created_at=now, updated_at=now
            ))
            connection.execute(users.insert().values(
                id=user_id, email=email.lower(), full_name=name,
                password_hash=generate_password_hash(password), is_active=True,
                access_key_hash=generate_password_hash(access_key),
                created_at=now, updated_at=now,
            ))
            connection.execute(memberships.insert().values(
                id=str(uuid4()), organization_id=organization_id, user_id=user_id,
                role="administrator", status="active", created_at=now,
            ))
        click.echo("Administrator account created.")

    @app.cli.command("ensure-admin")
    def ensure_admin():
        """Create or update the administrator named by ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_ACCESS_KEY.

        Runs on every start of the deployed app, so the admin login always matches the host's settings.
        Missing or invalid settings only print a warning; the app still starts.
        """
        from backend.database import db
        from backend.models import memberships, organizations, users

        email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
        password = os.environ.get("ADMIN_PASSWORD", "")
        access_key = os.environ.get("ADMIN_ACCESS_KEY", "")
        if not (email or password or access_key):
            click.echo("ensure-admin: ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_ACCESS_KEY are not set; skipped.")
            return
        problems = []
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            problems.append("ADMIN_EMAIL is not a valid email")
        if not 12 <= len(password) <= 512:
            problems.append("ADMIN_PASSWORD must be 12 to 512 characters")
        if not 12 <= len(access_key) <= 512:
            problems.append("ADMIN_ACCESS_KEY must be 12 to 512 characters")
        if problems:
            click.echo("ensure-admin: skipped, " + "; ".join(problems) + ".")
            return
        now = datetime.now(timezone.utc).isoformat()
        hashes = {"password_hash": generate_password_hash(password), "access_key_hash": generate_password_hash(access_key)}
        with db.engine.begin() as connection:
            existing = connection.execute(db.select(users.c.id).where(users.c.email == email)).first()
            if existing:
                role = connection.execute(db.select(memberships.c.role).where(memberships.c.user_id == existing.id)).scalar()
                if role != "administrator":
                    click.echo("ensure-admin: that email belongs to a non-administrator account; nothing changed.")
                    return
                connection.execute(users.update().where(users.c.id == existing.id).values(
                    **hashes, is_active=True, updated_at=now,
                ))
                click.echo("ensure-admin: administrator login updated.")
                return
            organization_id = connection.execute(
                db.select(organizations.c.id).order_by(organizations.c.created_at).limit(1)
            ).scalar()
            if not organization_id:
                organization_id = str(uuid4())
                connection.execute(organizations.insert().values(
                    id=organization_id, name=os.environ.get("ORGANIZATION_NAME", "").strip() or "WaterCare",
                    created_at=now, updated_at=now,
                ))
            user_id = str(uuid4())
            connection.execute(users.insert().values(
                id=user_id, email=email, full_name=os.environ.get("ADMIN_NAME", "").strip() or "Administrator",
                is_active=True, created_at=now, updated_at=now, **hashes,
            ))
            connection.execute(memberships.insert().values(
                id=str(uuid4()), organization_id=organization_id, user_id=user_id,
                role="administrator", status="active", created_at=now,
            ))
        click.echo("ensure-admin: administrator login created.")

    @app.cli.command("set-admin-key")
    @click.option("--email", prompt=True)
    @click.option("--access-key", prompt="New private admin key", hide_input=True, confirmation_prompt=True)
    def set_admin_key(email, access_key):
        """Set the private key an administrator, service coordinator or accountant uses on the Admin login."""
        from backend.database import db
        from backend.models import memberships, users

        if not 12 <= len(access_key) <= 512:
            raise click.ClickException("The private key must be between 12 and 512 characters.")
        email = email.strip().lower()
        with db.engine.begin() as connection:
            row = connection.execute(db.select(users.c.id, memberships.c.role).join(
                memberships, memberships.c.user_id == users.c.id
            ).where(users.c.email == email)).first()
            if not row or row.role not in {"administrator", "service_coordinator", "accountant"}:
                raise click.ClickException("No admin-level account matched that email.")
            connection.execute(users.update().where(users.c.id == row.id).values(
                access_key_hash=generate_password_hash(access_key), updated_at=datetime.now(timezone.utc).isoformat(),
            ))
        click.echo("Private key saved.")

    @app.cli.command("set-password")
    @click.option("--email", prompt=True)
    @click.password_option()
    def set_password(email, password):
        """Set a password for an existing employee account."""
        from backend.database import db
        from backend.models import users

        if not 12 <= len(password) <= 512:
            raise click.ClickException("Password must be between 12 and 512 characters.")
        email = email.strip().lower()
        with db.engine.begin() as connection:
            result = connection.execute(users.update().where(
                users.c.email == email.lower()
            ).values(password_hash=generate_password_hash(password), updated_at=datetime.now(timezone.utc).isoformat()))
            if result.rowcount != 1:
                raise click.ClickException("No unique account matched that email.")
        click.echo("Password updated.")

    @app.errorhandler(404)
    def not_found(_error):
        return jsonify({"error": {"code": "not_found", "message": "Not found."}}), 404

    @app.errorhandler(413)
    def too_large(_error):
        return jsonify({"error": {"code": "file_too_large", "message": "Upload exceeds 15 MB."}}), 413

    @app.errorhandler(HTTPException)
    def http_error(error):
        # Keep Werkzeug's status and headers (such as Allow on 405) but return the API's JSON error shape.
        response = error.get_response()
        response.data = json.dumps({"error": {
            "code": error.name.lower().replace(" ", "_"), "message": error.description,
        }})
        response.content_type = "application/json"
        return response

    @app.errorhandler(Exception)
    def unexpected_error(error):
        app.logger.exception("Unhandled request error: %s", type(error).__name__)
        return jsonify({"error": {"code": "internal_error", "message": "The request could not be completed."}}), 500

    return app
