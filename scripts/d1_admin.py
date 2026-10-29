"""Create the administrator login in D1, or reset its password and private key.

Runs on your computer: the password and key are hashed here (PBKDF2, the format the Worker checks) and only the
hashes are sent to D1 through `wrangler d1 execute`. Nothing secret is written to the repository.

    python scripts/d1_admin.py --email owner@example.com --remote
    python scripts/d1_admin.py --email owner@example.com --local      # the database used by `pywrangler dev`
"""
import argparse
import getpass
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.security.passwords import hash_password  # noqa: E402


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def admin_sql(email, name, organization, password_hash, key_hash):
    now = literal(datetime.now(timezone.utc).isoformat())
    email_sql = literal(email)
    user_id = f"(SELECT id FROM users WHERE email = {email_sql})"
    return "\n".join([
        # The first company is created only when D1 has none.
        f"INSERT INTO organizations (id, name, created_at, updated_at) SELECT {literal(uuid4())}, {literal(organization)}, {now}, {now}"
        " WHERE NOT EXISTS (SELECT 1 FROM organizations);",
        f"INSERT INTO users (id, email, full_name, password_hash, access_key_hash, is_active, created_at, updated_at)"
        f" VALUES ({literal(uuid4())}, {email_sql}, {literal(name)}, {literal(password_hash)}, {literal(key_hash)}, 1, {now}, {now})"
        " ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash,"
        " access_key_hash = excluded.access_key_hash, is_active = 1, updated_at = excluded.updated_at;",
        f"INSERT INTO organization_memberships (id, organization_id, user_id, role, status, created_at)"
        f" SELECT {literal(uuid4())}, (SELECT id FROM organizations ORDER BY created_at LIMIT 1), {user_id}, 'administrator', 'active', {now}"
        f" WHERE NOT EXISTS (SELECT 1 FROM organization_memberships WHERE user_id = {user_id});",
        f"SELECT u.email, m.role FROM users u JOIN organization_memberships m ON m.user_id = u.id WHERE u.email = {email_sql};",
        "",
    ])


def ask(label):
    first = getpass.getpass(f"{label}: ")
    if getpass.getpass(f"{label} again: ") != first:
        sys.exit(f"The two {label.lower()} entries did not match.")
    if not 12 <= len(first) <= 512:
        sys.exit(f"The {label.lower()} must be 12 to 512 characters.")
    return first


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="", help="blank: the menu shows the email until they add a name in Settings")
    parser.add_argument("--organization", default="Wolgan", help="used only when D1 has no company yet")
    parser.add_argument("--database", default="watercare")
    where = parser.add_mutually_exclusive_group(required=True)
    where.add_argument("--remote", action="store_true", help="the deployed D1 database")
    where.add_argument("--local", action="store_true", help="the local D1 used by pywrangler dev")
    parser.add_argument("--persist-to", help="local D1 state folder, if pywrangler dev used --persist-to")
    args = parser.parse_args()

    email = args.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        sys.exit("Use a valid email address.")
    password = os.environ.get("WATERCARE_ADMIN_PASSWORD") or ask("Password")
    access_key = os.environ.get("WATERCARE_ADMIN_KEY") or ask("Private key")
    sql = admin_sql(email, args.name, args.organization, hash_password(password), hash_password(access_key))

    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        sys.exit("npx (Node.js) is required to reach D1 through wrangler.")
    handle, path = tempfile.mkstemp(suffix=".sql")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            file.write(sql)
        command = [npx, "--yes", "wrangler", "d1", "execute", args.database, "--file", path,
                   "--remote" if args.remote else "--local", "--yes"]
        if args.persist_to:
            command += ["--persist-to", args.persist_to]
        result = subprocess.run(command, cwd=ROOT, stdin=subprocess.DEVNULL)
    finally:
        os.remove(path)
    if result.returncode:
        sys.exit("wrangler could not run the statements; see its output above.")
    print(f"Administrator login for {email} is ready. Sign in with the Admin login tab.")


if __name__ == "__main__":
    main()
