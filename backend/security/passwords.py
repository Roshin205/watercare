"""Password and private-key hashing that works both on a normal server and inside a Cloudflare Worker.

New hashes use werkzeug's "pbkdf2:sha256:<iterations>$salt$hex" format. The Workers runtime has no hashlib PBKDF2
or scrypt, so there the digest comes from the built-in Web Crypto API, which produces the same bytes. Cloudflare's
Web Crypto refuses PBKDF2 above 100,000 iterations, so that is the count used everywhere. Older "scrypt:" hashes and
PBKDF2 hashes with more iterations still verify outside a Worker; inside one they cannot, and the account needs a new
password (worker_can_check tells which).
"""
import hmac
import logging
import secrets
import string

from werkzeug.security import check_password_hash, generate_password_hash

from backend.runtime import in_workers

ITERATIONS = 100_000  # the most Cloudflare's Web Crypto accepts for PBKDF2
METHOD = f"pbkdf2:sha256:{ITERATIONS}"
SALT_CHARS = string.ascii_letters + string.digits
logger = logging.getLogger(__name__)


def _webcrypto_pbkdf2(password, salt, iterations, hash_name="SHA-256", length=32):
    from js import Object, Uint8Array, crypto
    from pyodide.ffi import run_sync, to_js

    key = run_sync(crypto.subtle.importKey("raw", to_js(password.encode()), "PBKDF2", False, to_js(["deriveBits"])))
    params = to_js(
        {"name": "PBKDF2", "hash": hash_name, "salt": to_js(salt.encode()), "iterations": iterations},
        dict_converter=Object.fromEntries,
    )
    bits = run_sync(crypto.subtle.deriveBits(params, key, length * 8))
    return Uint8Array.new(bits).to_bytes().hex()


def hash_password(password):
    if not in_workers():
        return generate_password_hash(password, method=METHOD)
    salt = "".join(secrets.choice(SALT_CHARS) for _ in range(16))
    return f"{METHOD}${salt}${_webcrypto_pbkdf2(password, salt, ITERATIONS)}"


def _worker_parts(stored):
    """(hash_name, iterations, salt, digest) when the Worker can check this hash, otherwise None."""
    try:
        method, salt, digest = stored.split("$", 2)
        kind, hash_name, iterations = method.split(":")
        iterations = int(iterations)
    except ValueError:
        return None
    if kind != "pbkdf2" or hash_name not in {"sha256", "sha512"} or not 1 <= iterations <= ITERATIONS:
        return None
    return hash_name, iterations, salt, digest


def worker_can_check(stored):
    return bool(stored) and _worker_parts(stored) is not None


def verify_password(stored, password):
    if not stored:
        return False
    if not in_workers():
        return check_password_hash(stored, password)
    parts = _worker_parts(stored)
    if parts is None:
        logger.warning("A stored password hash (%s) cannot be checked in the Worker; reset that password.", stored.split("$")[0])
        return False
    hash_name, iterations, salt, digest = parts
    actual = _webcrypto_pbkdf2(password, salt, iterations, "SHA-512" if hash_name == "sha512" else "SHA-256",
                               64 if hash_name == "sha512" else 32)
    return hmac.compare_digest(actual, digest)
