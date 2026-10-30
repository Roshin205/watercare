import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import pytest
from werkzeug.security import generate_password_hash

from backend import create_app
from backend.database import db
from backend.models import memberships, organizations, users
from backend.utils.hub_documents import safe_cell as safe_spreadsheet_value
from backend.utils.validators import validate_payload


ADMIN_KEY = "private-admin-key-1"


USE_D1 = os.environ.get("WATERCARE_TEST_D1") == "1"


class TestConfig:
    TESTING = True
    SECRET_KEY = "test-secret-key"
    # WATERCARE_TEST_D1=1 runs every test through the Cloudflare D1 driver, backed by an in-memory D1 stand-in.
    SQLALCHEMY_DATABASE_URI = "sqlite+d1://" if USE_D1 else "sqlite://"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    STORAGE_PATH = "test-uploads"


@pytest.fixture
def app():
    if USE_D1:
        from backend import d1
        d1.use_runner(d1.SQLiteRunner())
    application = create_app(TestConfig)
    with application.app_context():
        db.create_all()
        now = datetime.now(timezone.utc).isoformat()
        db.session.execute(organizations.insert().values(
            id="org-1", name="Test organization", created_at=now, updated_at=now,
        ))
        db.session.execute(users.insert().values(
            id="user-1", email="admin@example.test", full_name="Admin",
            password_hash=generate_password_hash("secure-test-password"),
            access_key_hash=generate_password_hash(ADMIN_KEY),
            is_active=True, created_at=now, updated_at=now,
        ))
        db.session.execute(memberships.insert().values(
            id=str(uuid4()), organization_id="org-1", user_id="user-1",
            role="administrator", status="active", created_at=now,
        ))
        db.session.commit()
        yield application
        db.drop_all()


@pytest.fixture
def client(app):
    test_client = app.test_client()
    response = test_client.post("/api/auth/login", json={
        "email": "admin@example.test", "password": "secure-test-password",
        "login_type": "admin", "access_key": ADMIN_KEY,
    })
    assert response.status_code == 200
    test_client.csrf_token = response.json["csrf_token"]
    return test_client


def csrf(client):
    return {"X-CSRF-Token": client.csrf_token}


def test_health_checks_database(app):
    assert app.test_client().get("/api/health").json == {"status": "ok"}


def test_production_requires_environment_configuration(monkeypatch):
    class MissingConfig:
        TESTING = False
        SECRET_KEY = ""
        SQLALCHEMY_DATABASE_URI = "sqlite://"
        STORAGE_PATH = "test-uploads"

    monkeypatch.setenv("FLASK_ENV", "production")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="SECRET_KEY, DATABASE_URL"):
        create_app(MissingConfig)
    monkeypatch.delenv("FLASK_ENV")


def test_login_logout_and_password_session(client):
    assert client.get("/api/auth/me").json["role"] == "administrator"
    response = client.post("/api/auth/logout", headers=csrf(client))
    assert response.status_code == 200
    assert client.get("/api/auth/me").status_code == 401


def test_wrong_password_is_rejected(app):
    response = app.test_client().post("/api/auth/login", json={
        "email": "admin@example.test", "password": "incorrect",
    })
    assert response.status_code == 401


def test_authenticated_user_can_create_and_read_client(client):
    response = client.post("/api/clients", headers=csrf(client), json={"name": "Acme"})
    assert response.status_code == 201
    item_id = response.json["data"]["id"]
    assert client.get(f"/api/clients/{item_id}").json["data"]["name"] == "Acme"


def test_csrf_and_authentication_are_required(app):
    anonymous = app.test_client()
    assert anonymous.get("/api/clients").status_code == 401
    assert anonymous.post("/api/clients", json={"name": "Acme"}).status_code == 401
    client = app.test_client()
    client.post("/api/auth/login", json={"email": "admin@example.test", "password": "secure-test-password", "login_type": "admin", "access_key": ADMIN_KEY})
    assert client.post("/api/clients", json={"name": "Acme"}).status_code == 403


def test_employee_cannot_create_client(app):
    with app.app_context():
        now = datetime.now(timezone.utc).isoformat()
        db.session.execute(users.insert().values(
            id="employee-1", email="employee@example.test", full_name="Employee",
            password_hash=generate_password_hash("secure-test-password"),
            is_active=True, created_at=now, updated_at=now,
        ))
        db.session.execute(memberships.insert().values(
            id=str(uuid4()), organization_id="org-1", user_id="employee-1",
            role="employee", status="active", created_at=now,
        ))
        db.session.commit()
    client = app.test_client()
    response = client.post("/api/auth/login", json={
        "email": "employee@example.test", "password": "secure-test-password",
    })
    assert response.status_code == 200
    assert client.post("/api/clients", headers={"X-CSRF-Token": response.json["csrf_token"]}, json={"name": "Blocked"}).status_code == 403


def test_user_cannot_access_records_from_another_organization(client):
    with client.session_transaction() as browser_session:
        browser_session["organization_id"] = "another-org"
    assert client.get("/api/clients").status_code == 401


def run_browser_test(filename):
    node = shutil.which("node")
    if not node:
        pytest.skip("Node.js is required for the browser form tests.")
    result = subprocess.run(
        [node, "--test", str(Path(__file__).parent / "js" / filename)],
        stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_map_location_search_suggestions_and_typed_coordinates():
    run_browser_test("place_search.test.js")


def test_wrong_http_method_returns_json_405(client):
    response = client.put("/api/auth/login", json={})
    assert response.status_code == 405
    assert response.json["error"]["code"] == "method_not_allowed"
    assert "POST" in response.headers["Allow"]


def test_settings_are_validated_and_record_each_update(client):
    for invalid in (
        {"user": {"appearance": "dark"}},  # removed: there is no dark theme
        {"user": {"date_format": "x" * 500}},
        {"user": {"date_format": "DD.MM.YY"}},
        {"user": {"time_format": "25h"}},
        {"user": {"time_zone": {"zone": "UTC"}}},
        {"user": {"notification_preferences": "email"}},
        {"organization": {"name": 7}},
        {"organization": {"time_zone": ""}},
        {"organization": {"support_email": "not-an-email"}},
        {"organization": {"support_phone": "call the office"}},
    ):
        response = client.patch("/api/settings", headers=csrf(client), json=invalid)
        assert response.status_code == 400, invalid

    assert client.patch("/api/settings", headers=csrf(client), json={"user": {"date_format": "DD/MM/YYYY"}}).status_code == 200
    first = client.get("/api/settings").json["user"]["updated_at"]
    time.sleep(0.01)
    assert client.patch("/api/settings", headers=csrf(client), json={"user": {"date_format": "MM/DD/YYYY"}}).status_code == 200
    second = client.get("/api/settings").json["user"]
    assert second["date_format"] == "MM/DD/YYYY"
    assert second["updated_at"] > first


def test_settings_are_saved_with_organization_and_user_scope(client):
    response = client.patch("/api/settings", headers=csrf(client), json={
        "organization": {"name": "Updated organization", "support_phone": "+971 4 555 0100", "support_email": "help@example.test"},
        "user": {"date_format": "DD/MM/YYYY", "time_format": "12h", "time_zone": ""},
    })
    assert response.status_code == 200
    saved = client.get("/api/settings").json
    assert saved["organization"]["name"] == "Updated organization"
    assert saved["organization"]["support_phone"] == "+971 4 555 0100"
    assert saved["organization"]["support_email"] == "help@example.test"
    assert saved["user"]["date_format"] == "DD/MM/YYYY"
    assert saved["user"]["time_zone"] == ""  # blank: follow the device's time zone


def test_login_shell_shows_the_wolgan_brand_and_developer_credit_and_has_no_provider_globals(app):
    response = app.test_client().get("/")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-cache"
    assert b"<title>Wolgan |" in response.data and b"Welcome to Wolgan" in response.data
    assert b"Website created by <b>Roshin VP</b>" in response.data
    assert b"to=devroshinvp@gmail.com" in response.data
    assert b"window.WATERCARE_" not in response.data


def test_payload_validation_and_spreadsheet_safety():
    assert "name" in validate_payload("clients", {})
    assert validate_payload("clients", {"name": "WaterCare"}) is None
    assert "Unsupported field" in validate_payload("clients", {"name": "Client", "organization_id": "attacker"})
    assert safe_spreadsheet_value("=1+1") == "'=1+1"
    assert safe_spreadsheet_value("-2") == "'-2"
    assert safe_spreadsheet_value(2) == 2


# --- Accounts and roles ---

ROLE_PASSWORD = "role-test-password-1"


ROLE_KEY = "role-private-key-1"


def sign_in(app, email, password=ROLE_PASSWORD, key=None):
    test_client = app.test_client()
    body = {"email": email, "password": password}
    if key:
        body.update(login_type="admin", access_key=key)
    response = test_client.post("/api/auth/login", json=body)
    assert response.status_code == 200, response.json
    test_client.csrf_token = response.json["csrf_token"]
    return test_client


def add_account(app, admin, role, name):
    """A staff profile with a login, the way an administrator makes one on the Staff Profiles page."""
    email = f"{role.replace('_', '-')}-{uuid4().hex[:6]}@example.test"
    key = ROLE_KEY if role in {"service_coordinator", "accountant"} else None
    person = admin.post("/api/hub/staff", headers=csrf(admin), json={"name": name, "email": email}).json["data"]
    created = admin.post(f"/api/hub/staff/{person['id']}/login", headers=csrf(admin), json={
        "password": ROLE_PASSWORD, "role": role, **({"access_key": key} if key else {}),
    })
    assert created.status_code == 201, created.json
    return sign_in(app, email, key=key)


def login_attempt(app, **body):
    return app.test_client().post("/api/auth/login", json=body)


def test_admin_login_needs_the_private_key_and_staff_login_needs_only_email_and_password(app, client):
    admin = {"email": "admin@example.test", "password": "secure-test-password"}
    assert login_attempt(app, **admin, login_type="admin", access_key=ADMIN_KEY).status_code == 200
    assert login_attempt(app, **admin, login_type="admin").status_code == 400
    assert login_attempt(app, **admin, login_type="admin", access_key="wrong-private-key").status_code == 401
    assert login_attempt(app, email="admin@example.test", password="wrong", login_type="admin", access_key=ADMIN_KEY).status_code == 401
    refused = login_attempt(app, **admin)
    assert refused.status_code == 403 and "Admin login" in refused.json["error"]["message"]
    assert login_attempt(app, **admin, login_type="other").status_code == 400

    coordinator = add_account(app, client, "service_coordinator", "Key Coordinator")
    email = coordinator.get("/api/auth/me").json["user"]["email"]
    assert login_attempt(app, email=email, password=ROLE_PASSWORD).status_code == 403
    assert login_attempt(app, email=email, password=ROLE_PASSWORD, login_type="admin", access_key=ADMIN_KEY).status_code == 401
    assert login_attempt(app, email=email, password=ROLE_PASSWORD, login_type="admin", access_key=ROLE_KEY).status_code == 200

    employee_email = add_account(app, client, "employee", "Plain Employee").get("/api/auth/me").json["user"]["email"]
    employee = login_attempt(app, email=employee_email, password=ROLE_PASSWORD)
    assert employee.status_code == 200 and employee.json["role"] == "employee"
    refused = login_attempt(app, email=employee_email, password=ROLE_PASSWORD, login_type="admin", access_key=ROLE_KEY)
    assert refused.status_code == 403 and "Staff login" in refused.json["error"]["message"]
    assert login_attempt(app, email=employee_email, password=ROLE_PASSWORD, login_type="client").status_code == 400

    with app.app_context():
        stored = db.session.execute(db.select(users.c.access_key_hash).where(users.c.email == "admin@example.test")).scalar()
    assert stored and ADMIN_KEY not in stored


def test_services_page_defaults_create_rename_and_in_use_rules(client):
    headers = csrf(client)
    assert [row["name"] for row in client.get("/api/services").json["data"]] == ["Tank cleaning", "Water testing"]

    created = client.post("/api/services", headers=headers, json={"name": "Legionella audit", "certificate_text": "Cooling Tower System", "validity_months": 3})
    assert created.status_code == 201, created.json
    service = created.json["data"]
    assert service["is_active"] is True
    assert client.post("/api/services", headers=headers, json={"name": "legionella AUDIT"}).status_code == 409
    assert client.post("/api/services", headers=headers, json={"name": "Bad", "validity_months": 0}).status_code == 400

    contract = client.post("/api/hub/contracts", headers=headers, json={"site": "Tower", "service": "Legionella audit"}).json["data"]
    renamed = client.patch(f"/api/services/{service['id']}", headers=headers, json={"name": "Legionella inspection"})
    assert renamed.status_code == 200
    assert client.get("/api/hub/contracts").json["data"][0]["service"] == "Legionella inspection"
    assert client.delete(f"/api/services/{service['id']}", headers=headers).status_code == 409
    assert contract["id"]

    unused = client.post("/api/services", headers=headers, json={"name": "Spare"}).json["data"]
    assert client.delete(f"/api/services/{unused['id']}", headers=headers).status_code == 200


def test_services_are_administrator_only_to_change(app, client):
    coordinator = add_account(app, client, "service_coordinator", "Sara Coordinator")
    viewer = add_account(app, client, "viewer", "Vic Viewer")
    assert viewer.get("/api/services").status_code == 200
    assert coordinator.post("/api/services", headers=csrf(coordinator), json={"name": "Nope"}).status_code == 403
    assert viewer.post("/api/services", headers=csrf(viewer), json={"name": "Nope"}).status_code == 403


class FakeR2:
    """Stands in for the R2 binding (env.FILES): keeps objects in memory, like the Workers SDK wrapper returns them."""

    def __init__(self):
        self.objects = {}

    def put(self, key, data, options=None):
        self.objects[key] = bytes(data)

    def get(self, key):
        if key not in self.objects:
            return None
        body = self.objects[key]

        class Stored:
            def arrayBuffer(self):
                return memoryview(body)

        return Stored()

    def delete(self, key):
        self.objects.pop(key, None)


def pretend_worker(monkeypatch, env):
    """Run the Worker-only code paths in CPython: fake the small part of Pyodide (`js`, `pyodide.ffi`) they use."""
    import sys
    import types
    js = types.ModuleType("js")
    js.Object = types.SimpleNamespace(fromEntries=dict)
    js.JSON = types.SimpleNamespace(parse=lambda text: None)
    ffi = types.ModuleType("pyodide.ffi")
    ffi.run_sync = lambda value: value
    ffi.to_js = lambda value, **kwargs: value
    pyodide = types.ModuleType("pyodide")
    pyodide.ffi = ffi
    monkeypatch.setitem(sys.modules, "js", js)
    monkeypatch.setitem(sys.modules, "pyodide", pyodide)
    monkeypatch.setitem(sys.modules, "pyodide.ffi", ffi)
    monkeypatch.setattr("backend.utils.storage.in_workers", lambda: True)
    monkeypatch.setattr("backend.utils.storage.worker_env", lambda: env)


def test_r2_keys_reject_path_tricks(app, monkeypatch):
    from types import SimpleNamespace
    from backend.utils import storage
    pretend_worker(monkeypatch, SimpleNamespace(FILES=FakeR2()))
    with app.app_context():
        for bad in ("../x", "a//b", "/abs", "a/./b", ""):
            with pytest.raises(storage.StorageError):
                storage.save(bad, b"x", "text/plain")


def test_worker_passwords_use_web_crypto_pbkdf2_in_werkzeug_format(monkeypatch):
    import hashlib
    from werkzeug.security import check_password_hash, generate_password_hash
    from backend.security import passwords
    monkeypatch.setattr(passwords, "in_workers", lambda: True)

    def web_crypto(password, salt, iterations, hash_name="SHA-256", length=32):
        if iterations > 100_000:  # what Cloudflare's Web Crypto answers
            raise RuntimeError(f"NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not supported (requested {iterations}).")
        return hashlib.pbkdf2_hmac(hash_name.replace("-", "").lower(), password.encode(), salt.encode(), iterations, length).hex()

    monkeypatch.setattr(passwords, "_webcrypto_pbkdf2", web_crypto)
    stored = passwords.hash_password("worker-password-1")
    assert stored.startswith("pbkdf2:sha256:100000$")
    assert passwords.verify_password(stored, "worker-password-1")
    assert not passwords.verify_password(stored, "wrong-password-1")
    assert check_password_hash(stored, "worker-password-1")  # the same hash still works on a normal server
    assert passwords.verify_password(generate_password_hash("local-made", method="pbkdf2:sha256:1000"), "local-made")
    assert not passwords.verify_password(generate_password_hash("old-scrypt", method="scrypt"), "old-scrypt")
    too_many = generate_password_hash("old-pbkdf2", method="pbkdf2:sha256:600000")
    assert not passwords.verify_password(too_many, "old-pbkdf2")  # refused as a wrong login, not a server error
    assert not passwords.worker_can_check(too_many)
    assert passwords.worker_can_check(stored)
    assert not passwords.worker_can_check(generate_password_hash("old-scrypt", method="scrypt"))


def test_worker_config_uses_the_d1_driver():
    from config import WorkerConfig
    assert WorkerConfig.SQLALCHEMY_DATABASE_URI == "sqlite+d1://"
    assert WorkerConfig.SESSION_COOKIE_SECURE is True and WorkerConfig.SECRET_KEY is None


def test_d1_driver_reports_changes_and_returns_rows():
    from sqlalchemy import create_engine, text
    from backend import d1
    d1.use_runner(d1.SQLiteRunner())
    try:
        engine = create_engine("sqlite+d1://")
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)"))
            assert connection.execute(text("INSERT INTO t VALUES ('a', 1), ('b', 2)")).rowcount == 2
            assert connection.execute(text("UPDATE t SET n = n + 1 WHERE id = :id"), {"id": "a"}).rowcount == 1
            assert connection.execute(text("SELECT id, n FROM t ORDER BY id")).mappings().all() == [{"id": "a", "n": 2}, {"id": "b", "n": 2}]
            assert connection.execute(text("DELETE FROM t WHERE id = 'b' RETURNING id")).scalar() == "b"
            assert connection.execute(text("SELECT id FROM t WHERE id = 'zzz'")).first() is None
            with pytest.raises(Exception):
                connection.execute(text("INSERT INTO t VALUES ('a', 9)"))
    finally:
        d1.use_runner(None)


def test_empty_database_reports_not_set_up_instead_of_a_server_error():
    if USE_D1:
        from backend import d1
        d1.use_runner(d1.SQLiteRunner())
    application = create_app(TestConfig)
    with application.app_context():
        test_client = application.test_client()
        assert test_client.get("/api/health").json == {"status": "database_not_set_up"}
        response = test_client.post("/api/auth/login", json={
            "email": "owner@example.test", "password": "secure-test-password", "login_type": "admin", "access_key": ADMIN_KEY,
        })
        assert response.status_code == 503
        assert "not set up" in response.json["error"]["message"]


def test_d1_migration_creates_every_table_and_column_the_app_uses():
    import sqlite3
    connection = sqlite3.connect(":memory:")
    for migration in sorted((Path(__file__).parent.parent / "d1-migrations").glob("*.sql")):
        connection.executescript(migration.read_text(encoding="utf-8"))
    for table in db.metadata.sorted_tables:
        columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table.name})")}
        # Old columns kept by earlier migrations (projects.start_time, end_time) may remain; every current one must exist.
        assert {column.name for column in table.columns} <= columns, table.name
