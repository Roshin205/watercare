import json
import logging
import os
import hmac
import re
from datetime import datetime, timezone
from uuid import uuid4

import click
from flask import Flask, jsonify, render_template, request, session
from werkzeug.exceptions import HTTPException

from config import Config
from backend import d1  # noqa: F401 - registers the "sqlite+d1://" database URL used by the Cloudflare Worker
from backend.database import Database, db
from backend.runtime import in_workers
from backend.routes.api import api
from backend.security.passwords import hash_password
from backend import models

try:
    from flask_migrate import Migrate
except ImportError:  # The Worker bundle leaves out Alembic; D1 is migrated with `wrangler d1 migrations apply`.
    Migrate = None
migrate = Migrate() if Migrate else None


def create_app(config_object=Config):
    app = Flask(__name__, template_folder="../templates", static_folder="../static")
    app.config.from_object(config_object)
    if not app.testing and not in_workers() and os.environ.get("FLASK_ENV") == "production":
        missing = [key for key in ("SECRET_KEY", "DATABASE_URL") if not os.environ.get(key)]
        if missing:
            raise RuntimeError("Missing required deployment configuration: " + ", ".join(missing))

    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    db.init_app(app)
    if migrate is not None:
        migrate.init_app(app, db, directory=os.path.abspath(os.path.join(app.root_path, "..", "migrations")))
    app.extensions["watercare_database"] = Database()
    if not in_workers():  # In the Worker, files live in R2 (backend/utils/storage.py).
        os.makedirs(app.config["STORAGE_PATH"], exist_ok=True)
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
            # Reachable but empty: the migrations have not run (`wrangler d1 migrations apply`, or `flask db upgrade` locally).
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
                password_hash=hash_password(password), is_active=True,
                access_key_hash=hash_password(access_key),
                created_at=now, updated_at=now,
            ))
            connection.execute(memberships.insert().values(
                id=str(uuid4()), organization_id=organization_id, user_id=user_id,
                role="administrator", status="active", created_at=now,
            ))
        click.echo("Administrator account created.")

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
                access_key_hash=hash_password(access_key), updated_at=datetime.now(timezone.utc).isoformat(),
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
            ).values(password_hash=hash_password(password), updated_at=datetime.now(timezone.utc).isoformat()))
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
