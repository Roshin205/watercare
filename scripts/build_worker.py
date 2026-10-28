"""Assemble the Cloudflare Worker upload in .worker-build/ (run automatically by wrangler's build step).

Only what the Worker needs is copied: the entry point, config.py, backend/, templates/ and, as static assets,
static/. Nothing else from the repository (instance/, tests, local databases, .env files) can end up in the upload.
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".worker-build"
SKIP = shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store")


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    shutil.copy2(ROOT / "cloudflare" / "worker.py", OUT / "worker.py")
    shutil.copy2(ROOT / "config.py", OUT / "config.py")
    shutil.copytree(ROOT / "backend", OUT / "backend", ignore=SKIP)
    shutil.copytree(ROOT / "templates", OUT / "templates", ignore=SKIP)
    shutil.copytree(ROOT / "static", OUT / "assets" / "static", ignore=SKIP)
    print(f"Worker files assembled in {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    build()
