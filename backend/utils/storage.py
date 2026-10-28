"""Where uploaded files live: the private R2 bucket bound to the Worker as FILES, or a folder on disk elsewhere.

Keys look like "<organization>/<kind>/<record>/<file>" in both places, so the database rows are the same either way.
The bucket is never public: files are only served through the app's signed-in routes.
"""
from pathlib import Path

from flask import current_app

from backend.runtime import in_workers, worker_env


class StorageError(Exception):
    """The file could not be saved, read or removed."""


def _bucket():
    env = worker_env()
    if env is None:
        raise StorageError("The R2 bucket is only reachable while handling a Worker request.")
    return env.FILES


def _checked_key(storage_path):
    parts = storage_path.split("/")
    if not storage_path or storage_path.startswith("/") or any(part in ("", ".", "..") for part in parts):
        raise StorageError("Invalid storage path.")
    return storage_path


def _local_path(storage_path):
    root = Path(current_app.config["STORAGE_PATH"]).resolve()
    path = (root / _checked_key(storage_path)).resolve()
    if not path.is_relative_to(root):
        raise StorageError("Invalid storage path.")
    return path


def save(storage_path, data, content_type):
    if in_workers():
        from js import Object
        from pyodide.ffi import run_sync, to_js

        try:
            options = to_js({"httpMetadata": {"contentType": content_type}}, dict_converter=Object.fromEntries)
            run_sync(_bucket().put(_checked_key(storage_path), to_js(bytes(data)), options))
        except StorageError:
            raise
        except Exception as error:
            raise StorageError(f"R2 upload failed: {error}") from error
        return
    path = _local_path(storage_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def read(storage_path):
    """The file's bytes, or None when it is not there."""
    if in_workers():
        from pyodide.ffi import run_sync

        try:
            stored = run_sync(_bucket().get(_checked_key(storage_path)))
            if stored is None:
                return None
            return bytes(run_sync(stored.arrayBuffer()))
        except StorageError:
            raise
        except Exception as error:
            raise StorageError(f"R2 download failed: {error}") from error
    path = _local_path(storage_path)
    return path.read_bytes() if path.is_file() else None


def delete(storage_path):
    """Remove the file; a file that is already gone is not an error."""
    if in_workers():
        from pyodide.ffi import run_sync

        try:
            run_sync(_bucket().delete(_checked_key(storage_path)))
        except StorageError:
            raise
        except Exception as error:
            raise StorageError(f"R2 delete failed: {error}") from error
        return
    _local_path(storage_path).unlink(missing_ok=True)


def delete_quietly(storage_path):
    try:
        delete(storage_path)
    except Exception:
        current_app.logger.exception("Could not remove stored file %s.", storage_path)
