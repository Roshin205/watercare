import os


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY") or "local-development-only-change-before-deployment"
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "sqlite:///watercare.db").replace(
        "postgres://", "postgresql://", 1
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    # Re-read page templates on every request outside production, so an edited page never lags behind its scripts.
    TEMPLATES_AUTO_RELOAD = os.environ.get("FLASK_ENV") != "production"
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True, "pool_recycle": 300}
    if SQLALCHEMY_DATABASE_URI.startswith("postgresql"):
        # Keep each worker's connections few: Supabase's session pooler allows only a small number per project.
        SQLALCHEMY_ENGINE_OPTIONS.update(
            pool_size=int(os.environ.get("DB_POOL_SIZE", "3")), max_overflow=int(os.environ.get("DB_MAX_OVERFLOW", "2")),
        )
    MAX_CONTENT_LENGTH = 15 * 1024 * 1024
    STORAGE_PATH = os.environ.get("STORAGE_PATH", os.path.join("instance", "uploads"))
    # When all three are set, uploads are kept in this private Supabase Storage bucket instead of STORAGE_PATH.
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
    SUPABASE_SECRET_KEY = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    SUPABASE_BUCKET = os.environ.get("SUPABASE_BUCKET", "").strip()
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("FLASK_ENV") == "production"
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 8
    JSON_SORT_KEYS = False
