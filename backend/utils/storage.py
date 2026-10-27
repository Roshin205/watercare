"""Where uploaded files live: a private Supabase Storage bucket when it is configured, otherwise a folder on disk.

Configure the bucket with SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_BUCKET. Paths look like
"<organization>/<kind>/<record>/<file>" in both places, so the database rows are the same either way.
"""
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from flask import current_app

TIMEOUT_SECONDS = 60


class StorageError(Exception):
    """The file could not be saved, read or removed."""


def _bucket():
    config = current_app.config
    url, key, bucket = config.get("SUPABASE_URL"), config.get("SUPABASE_SECRET_KEY"), config.get("SUPABASE_BUCKET")
    return (url.rstrip("/"), key, bucket) if url and key and bucket else None


def uses_cloud():
    return _bucket() is not None


def _local_path(storage_path):
    root = Path(current_app.config["STORAGE_PATH"]).resolve()
    path = (root / storage_path).resolve()
    if not path.is_relative_to(root):
        raise StorageError("Invalid storage path.")
    return path


def _cloud(method, storage_path, data=None, headers=None):
    url, key, bucket = _bucket()
    if ".." in storage_path.split("/"):
        raise StorageError("Invalid storage path.")
    address = f"{url}/storage/v1/object/{urllib.parse.quote(bucket)}/{urllib.parse.quote(storage_path)}"
    # New secret keys (sb_secret_...) go only in the apikey header; older service_role JWTs also need Authorization.
    sent = {"apikey": key, **(headers or {})}
    if key.startswith("eyJ"):
        sent["Authorization"] = f"Bearer {key}"
    request = urllib.request.Request(address, data=data, method=method, headers=sent)
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        return response.read()


def save(storage_path, data, content_type):
    if uses_cloud():
        try:
            _cloud("POST", storage_path, data, {"Content-Type": content_type, "x-upsert": "true"})
        except (urllib.error.URLError, OSError) as error:
            raise StorageError(f"Cloud upload failed: {error}") from error
        return
    path = _local_path(storage_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def read(storage_path):
    """The file's bytes, or None when it is not there."""
    if uses_cloud():
        try:
            return _cloud("GET", storage_path)
        except urllib.error.HTTPError as error:
            if error.code in (400, 404):
                return None
            raise StorageError(f"Cloud download failed: {error}") from error
        except (urllib.error.URLError, OSError) as error:
            raise StorageError(f"Cloud download failed: {error}") from error
    path = _local_path(storage_path)
    return path.read_bytes() if path.is_file() else None


def delete(storage_path):
    """Remove the file; a file that is already gone is not an error."""
    if uses_cloud():
        try:
            _cloud("DELETE", storage_path)
        except urllib.error.HTTPError as error:
            if error.code not in (400, 404):
                raise StorageError(f"Cloud delete failed: {error}") from error
        except (urllib.error.URLError, OSError) as error:
            raise StorageError(f"Cloud delete failed: {error}") from error
        return
    _local_path(storage_path).unlink(missing_ok=True)


def delete_quietly(storage_path):
    try:
        delete(storage_path)
    except Exception:
        current_app.logger.exception("Could not remove stored file %s.", storage_path)
