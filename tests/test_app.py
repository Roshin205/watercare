from datetime import datetime, timezone
from io import BytesIO
from uuid import uuid4

import pytest
from werkzeug.security import generate_password_hash

from backend import create_app
from backend.database import db
from backend.models import memberships, organizations, users
from backend.routes.api import safe_spreadsheet_value
from backend.utils.validators import validate_payload


class TestConfig:
    TESTING = True
    SECRET_KEY = "test-secret-key"
    SQLALCHEMY_DATABASE_URI = "sqlite://"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    STORAGE_PATH = "test-uploads"


@pytest.fixture
def app():
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


def test_administrator_can_create_an_employee_account(client):
    response = client.post("/api/auth/users", headers=csrf(client), json={
        "email": "new@example.test", "full_name": "New Employee",
        "password": "a-long-test-password", "role": "employee",
    })
    assert response.status_code == 201
    employee = client.application.test_client()
    login_response = employee.post("/api/auth/login", json={
        "email": "new@example.test", "password": "a-long-test-password",
    })
    assert login_response.status_code == 200
    assert login_response.json["role"] == "employee"
    engineers_response = client.get("/api/engineers")
    assert any(engineer["user_id"] == response.json["data"]["id"] for engineer in engineers_response.json["data"])


def test_csrf_and_authentication_are_required(app):
    anonymous = app.test_client()
    assert anonymous.get("/api/clients").status_code == 401
    assert anonymous.post("/api/clients", json={"name": "Acme"}).status_code == 401
    client = app.test_client()
    client.post("/api/auth/login", json={"email": "admin@example.test", "password": "secure-test-password"})
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


def test_private_document_upload_download_and_delete(client):
    created = client.post("/api/clients", headers=csrf(client), json={"name": "Document client"})
    client_id = created.json["data"]["id"]
    upload = client.post(
        "/api/uploads",
        headers=csrf(client),
        data={
            "related_type": "client",
            "related_id": client_id,
            "file": (BytesIO(b"%PDF-1.4\nWaterCare test\n%%EOF"), "result.pdf", "application/pdf"),
        },
        content_type="multipart/form-data",
    )
    assert upload.status_code == 201
    file_id = upload.json["data"]["id"]
    download = client.get(f"/api/uploads/{file_id}")
    assert download.status_code == 200
    assert download.data.startswith(b"%PDF-")
    download.close()
    assert client.delete(f"/api/uploads/{file_id}", headers=csrf(client)).status_code == 200
    assert client.get(f"/api/uploads/{file_id}").status_code == 404


def test_calendar_rejects_malformed_dates(client):
    response = client.get("/api/dashboard/tasks?from=20261023&to=2026-10-24")
    assert response.status_code == 400


def test_settings_are_saved_with_organization_and_user_scope(client):
    response = client.patch("/api/settings", headers=csrf(client), json={
        "organization": {"name": "Updated organization"},
        "user": {"appearance": "dark", "time_zone": "UTC"},
    })
    assert response.status_code == 200
    saved = client.get("/api/settings").json
    assert saved["organization"]["name"] == "Updated organization"
    assert saved["user"]["appearance"] == "dark"


def test_login_shell_preserves_watercare_brand_and_has_no_provider_globals(app):
    response = app.test_client().get("/")
    assert response.status_code == 200
    assert b"WaterCare" in response.data
    assert b"window.WATERCARE_" not in response.data


def test_payload_validation_and_spreadsheet_safety():
    assert "name" in validate_payload("clients", {})
    assert validate_payload("clients", {"name": "WaterCare"}) is None
    assert "Unsupported field" in validate_payload("clients", {"name": "Client", "organization_id": "attacker"})
    assert safe_spreadsheet_value("=1+1") == "'=1+1"
    assert safe_spreadsheet_value("-2") == "'-2"
    assert safe_spreadsheet_value(2) == 2
