import os


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY") or "local-development-only-change-before-deployment"
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "sqlite:///watercare.db").replace(
        "postgres://", "postgresql://", 1
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SQLALCHEMY_ENGINE_OPTIONS = {"pool_pre_ping": True, "pool_recycle": 300}
    MAX_CONTENT_LENGTH = 15 * 1024 * 1024
    STORAGE_PATH = os.environ.get("STORAGE_PATH", os.path.join("instance", "uploads"))
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("FLASK_ENV") == "production"
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 8
    JSON_SORT_KEYS = False
