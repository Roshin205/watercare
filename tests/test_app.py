from types import SimpleNamespace

import pytest

from backend import create_app
from backend.routes.api import safe_spreadsheet_value
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions
from backend.utils.validators import validate_payload


class FakeQuery:
    def __init__(self, table, role):
        self.table_name = table
        self.role = role

    def select(self, *_args):
        return self

    def eq(self, *_args):
        return self

    def limit(self, *_args):
        return self

    def execute(self):
        data = [{
            "organization_id": "org-1", "role": self.role, "status": "active",
        }] if self.table_name == "organization_memberships" else []
        return SimpleNamespace(data=data)


class FakeClient:
    def __init__(self, role="administrator"):
        self.role = role
        self.auth = SimpleNamespace(get_user=lambda _token: SimpleNamespace(
            user=SimpleNamespace(id="user-1", email="employee@example.test")
        ))

    def table(self, table):
        return FakeQuery(table, self.role)


class TestConfig:
    TESTING = True
    SECRET_KEY = "test-only"
    SUPABASE_URL = ""
    SUPABASE_ANON_KEY = ""
    SUPABASE_SERVICE_ROLE_KEY = ""


def make_client():
    return create_app(TestConfig, FakeClient()).test_client()


def test_health_reports_missing_supabase_configuration():
    response = create_app(TestConfig).test_client().get("/api/health")
    assert response.status_code == 503
    assert response.json["status"] == "setup_required"


def test_health_checks_database_when_configured():
    response = make_client().get("/api/health")
    assert response.status_code == 200
    assert response.json["status"] == "ok"


def test_missing_production_credentials_fail_startup_with_variable_names():
    class MissingConfig:
        SECRET_KEY = ""
        SUPABASE_URL = ""
        SUPABASE_ANON_KEY = ""
        SUPABASE_SERVICE_ROLE_KEY = ""

    with pytest.raises(RuntimeError, match="SUPABASE_URL") as error:
        create_app(MissingConfig)
    assert "SUPABASE_SERVICE_ROLE_KEY" in str(error.value)
    assert "secret-value" not in str(error.value)


def test_api_requires_bearer_token():
    response = make_client().get("/api/auth/me")
    assert response.status_code == 401
    assert response.json["error"]["code"] == "unauthorized"


def test_authenticated_identity_includes_org_membership():
    response = make_client().get("/api/auth/me", headers={"Authorization": "Bearer valid"})
    assert response.status_code == 200
    assert response.json["organization_id"] == "org-1"
    assert response.json["role"] == "administrator"


def test_authenticated_database_client_receives_user_token(monkeypatch):
    import backend.security.authentication as auth_module

    class AuthenticatedConfig(TestConfig):
        SUPABASE_URL = "https://supabase.example"
        SUPABASE_ANON_KEY = "public-anon-key"
        SUPABASE_SERVICE_ROLE_KEY = "server-secret"

    fake = FakeClient()
    calls = []

    def create_authenticated_client(url, key, options):
        calls.append((url, key, options.headers))
        return fake

    monkeypatch.setattr(auth_module, "create_client", create_authenticated_client)
    response = create_app(AuthenticatedConfig, FakeClient()).test_client().get(
        "/api/auth/me", headers={"Authorization": "Bearer user-access-token"}
    )
    assert response.status_code == 200
    assert calls == [(
        "https://supabase.example",
        "public-anon-key",
        {"Authorization": "Bearer user-access-token"},
    )]


def test_supabase_sdk_builds_request_with_user_bearer_header():
    client = create_client(
        "https://example.supabase.co",
        "public-anon-key",
        SyncClientOptions(headers={"Authorization": "Bearer employee-token"}),
    )
    try:
        assert client.postgrest.session.headers["Authorization"] == "Bearer employee-token"
    finally:
        client.postgrest.session.close()
        client.storage.session.close()
        client.auth.close()


def test_non_member_cannot_select_another_organization():
    response = make_client().get("/api/auth/me", headers={
        "Authorization": "Bearer valid", "X-Organization-ID": "org-2",
    })
    assert response.status_code == 403


def test_employee_cannot_create_client():
    client = create_app(TestConfig, FakeClient(role="employee")).test_client()
    response = client.post("/api/clients", headers={"Authorization": "Bearer valid"}, json={"name": "Blocked"})
    assert response.status_code == 403


def test_invalid_payloads_are_rejected_server_side():
    assert "name" in validate_payload("clients", {})
    assert "status" in validate_payload("projects", {
        "name": "Test", "client_id": "ed02a8d3-b4bd-4d24-9152-bba33b14702b", "status": "Unknown",
    })
    assert validate_payload("clients", {"name": "WaterCare"}) is None


def test_unknown_fields_are_rejected():
    assert "Unsupported field" in validate_payload("clients", {
        "name": "Client", "organization_id": "attacker-controlled",
    })


def test_calendar_rejects_malformed_dates():
    response = make_client().get(
        "/api/dashboard/tasks?from=20261023&to=2026-10-24",
        headers={"Authorization": "Bearer valid"},
    )
    assert response.status_code == 400


def test_login_shell_is_served_without_secret_values():
    response = create_app(TestConfig).test_client().get("/")
    assert response.status_code == 200
    assert b"WaterCare" in response.data
    assert b"service_role" not in response.data


def test_exports_neutralize_spreadsheet_formulas():
    assert safe_spreadsheet_value("=1+1") == "'=1+1"
    assert safe_spreadsheet_value("-2") == "'-2"
    assert safe_spreadsheet_value(2) == 2
