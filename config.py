import os


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "")
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    MAX_CONTENT_LENGTH = 15 * 1024 * 1024
    STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "watercare-private")
    JSON_SORT_KEYS = False

