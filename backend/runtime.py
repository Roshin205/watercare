"""Tell the Cloudflare Workers runtime apart from a normal Python process, and reach the Worker's bindings."""
import sys


def in_workers():
    """True inside a Cloudflare Python Worker (Pyodide), where bindings replace sockets and the filesystem."""
    return sys.platform == "emscripten"


def worker_env():
    """The Worker's `env` (D1, R2, secrets) for the current request, or None outside a Worker request."""
    if not in_workers():
        return None
    from flask import has_request_context, request

    if has_request_context():
        return request.environ.get("workers.env")
    return None
