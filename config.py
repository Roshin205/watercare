import os


class Config:
    """Local development and tests: a SQLite file and a folder for uploads."""
    SECRET_KEY = os.environ.get("SECRET_KEY") or "local-development-only-change-before-deployment"
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "sqlite:///watercare.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Re-read page templates on every request outside production, so an edited page never lags behind its scripts.
    TEMPLATES_AUTO_RELOAD = os.environ.get("FLASK_ENV") != "production"
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True, "pool_recycle": 300}
    MAX_CONTENT_LENGTH = 21 * 1024 * 1024
    STORAGE_PATH = os.environ.get("STORAGE_PATH", os.path.join("instance", "uploads"))
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("FLASK_ENV") == "production"
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 8
    JSON_SORT_KEYS = False


class WorkerConfig(Config):
    """The Cloudflare Worker: D1 through the "sqlite+d1://" driver, files in R2, secrets from the Worker's env.

    SECRET_KEY is filled in from the SECRET_KEY secret before the first request is handled (see worker.py).
    """
    SECRET_KEY = None
    SQLALCHEMY_DATABASE_URI = "sqlite+d1://"
    # Each D1 statement is an HTTP-free binding call; a "SELECT 1" ping before every request would only add work.
    SQLALCHEMY_ENGINE_OPTIONS = {}
    TEMPLATES_AUTO_RELOAD = False
    STORAGE_PATH = "/tmp/uploads"  # never used: files go to R2
    SESSION_COOKIE_SECURE = True
