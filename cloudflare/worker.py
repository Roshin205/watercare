"""Cloudflare Worker entry point: the WaterCare Flask app on Python Workers.

Bindings (wrangler.jsonc): DB = D1 database, FILES = private R2 bucket, PDF = LibreOffice converter service.
Secret: SECRET_KEY (signs the session cookie). Static files under /static are served by Workers Static Assets.
"""
from workers import wsgi

from backend import create_app
from config import WorkerConfig

app = create_app(WorkerConfig)
NOT_CONFIGURED = (
    b'{"error":{"code":"not_configured","message":"The site is not configured yet: '
    b'set the SECRET_KEY secret with wrangler secret put SECRET_KEY."}}'
)


def application(environ, start_response):
    # Secrets live on the Worker's env, not in os.environ, so the session key is read on the first request.
    if not app.secret_key:
        secret = str(getattr(environ["workers.env"], "SECRET_KEY", "") or "")
        if len(secret) < 32:
            start_response("503 Service Unavailable", [("Content-Type", "application/json")])
            return [NOT_CONFIGURED]
        app.secret_key = secret
    return app(environ, start_response)


Default = wsgi.entrypoint(application)
