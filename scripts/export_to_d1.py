"""Copy existing WaterCare records into D1, and list the files to copy into R2.

1. Write every row of the old database as SQL (nothing is changed in the source):
       python scripts/export_to_d1.py --source instance/watercare.db --out d1-import.sql
2. Load it into D1 (after `wrangler d1 migrations apply watercare --remote`):
       npx wrangler d1 execute watercare --remote --file d1-import.sql
3. Upload the saved files under their same keys:
       python scripts/export_to_d1.py --source instance/watercare.db --upload-files --remote

Accounts whose password or private key is stored as "scrypt", or as PBKDF2 with more than 100,000 iterations, cannot
be checked inside the Worker; the script lists them so they can be set again (scripts/d1_admin.py for the
administrator, Reset Login on Staff Profiles for staff).
"""
import argparse
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "d1-migrations"
sys.path.insert(0, str(ROOT))

from backend.security.passwords import worker_can_check  # noqa: E402


def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    return "'" + str(value).replace("'", "''") + "'"


def d1_tables():
    """Tables and columns of the D1 schema after every migration, in the order they are created (parents before children)."""
    schema = sqlite3.connect(":memory:")
    for migration in sorted(MIGRATIONS.glob("*.sql")):
        schema.executescript(migration.read_text(encoding="utf-8"))
    names = [row[0] for row in schema.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid")]
    return {name: [row[1] for row in schema.execute(f"PRAGMA table_info({name})")] for name in names}


def export_sql(source):
    tables = d1_tables()
    present = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    lines, counts = ["PRAGMA defer_foreign_keys = true;"], {}
    for table, d1_columns in tables.items():
        if table not in present:
            continue
        source_columns = [row[1] for row in source.execute(f"PRAGMA table_info({table})")]
        columns = [column for column in source_columns if column in d1_columns]
        dropped = sorted(set(source_columns) - set(d1_columns))
        if dropped:
            sys.exit(f"Table {table} has columns D1 does not: {', '.join(dropped)}. Nothing was written.")
        rows = source.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
        counts[table] = len(rows)
        for row in rows:
            lines.append(f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({', '.join(literal(value) for value in row)});")
    return "\n".join(lines) + "\n", counts


def stored_files(source):
    files = []
    for table, type_column in (("uploaded_documents", "mime_type"), ("certificate_templates", "file_type")):
        try:
            files += source.execute(f"SELECT storage_path, {type_column} FROM {table} WHERE deleted_at IS NULL").fetchall()
        except sqlite3.OperationalError:
            pass
    content_types = {"pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                     "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
    return [(path, content_types.get(kind, kind)) for path, kind in files]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", default=str(ROOT / "instance" / "watercare.db"), help="old SQLite database file")
    parser.add_argument("--out", help="write the INSERT statements to this .sql file")
    parser.add_argument("--upload-files", action="store_true", help="copy the saved files into the R2 bucket")
    parser.add_argument("--uploads", default=str(ROOT / "instance" / "uploads"), help="folder holding the saved files")
    parser.add_argument("--bucket", default="watercare-files")
    where = parser.add_mutually_exclusive_group()
    where.add_argument("--remote", action="store_true")
    where.add_argument("--local", action="store_true")
    parser.add_argument("--persist-to", help="local state folder, if pywrangler dev used --persist-to")
    args = parser.parse_args()

    source = sqlite3.connect(f"file:{Path(args.source).as_posix()}?mode=ro", uri=True)
    if args.out:
        sql, counts = export_sql(source)
        Path(args.out).write_text(sql, encoding="utf-8")
        print(f"Wrote {sum(counts.values())} rows to {args.out}:")
        for table, count in counts.items():
            print(f"  {table}: {count}")
        old = [email for email, password_hash, access_key_hash
               in source.execute("SELECT email, password_hash, access_key_hash FROM users")
               if not worker_can_check(password_hash) or (access_key_hash and not worker_can_check(access_key_hash))]
        if old:
            print("These accounts need a new password (and private key) after the move; the Worker cannot check how"
                  " they are stored now:")
            for email in old:
                print(f"  {email}")

    if args.upload_files:
        if not (args.remote or args.local):
            sys.exit("Choose --remote or --local for the file upload.")
        npx = shutil.which("npx") or shutil.which("npx.cmd")
        if not npx:
            sys.exit("npx (Node.js) is required to reach R2 through wrangler.")
        missing = uploaded = 0
        for key, content_type in stored_files(source):
            path = Path(args.uploads, key)
            if not path.is_file():
                missing += 1
                print(f"  missing on disk, skipped: {key}")
                continue
            command = [npx, "--yes", "wrangler", "r2", "object", "put", f"{args.bucket}/{key}", "--file", str(path),
                       "--content-type", content_type or "application/octet-stream", "--remote" if args.remote else "--local"]
            if args.persist_to:
                command += ["--persist-to", args.persist_to]
            if subprocess.run(command, cwd=ROOT, stdin=subprocess.DEVNULL, capture_output=True).returncode:
                sys.exit(f"Upload failed for {key}; files uploaded so far are kept. Re-run to continue.")
            uploaded += 1
        print(f"Uploaded {uploaded} file(s) to {args.bucket}; {missing} listed file(s) were not on disk.")


if __name__ == "__main__":
    main()
