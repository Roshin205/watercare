from functools import wraps
from types import SimpleNamespace

from flask import current_app, g, jsonify, request, session
from sqlalchemy import select
from werkzeug.security import check_password_hash

from backend.database import db
from backend.models import memberships, users


def require_user(roles=None):
    def decorate(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if request.endpoint == "api.login" and request.method == "POST":
                return view(*args, **kwargs)
            user_id, organization_id = session.get("user_id"), session.get("organization_id")
            if not user_id or not organization_id:
                return jsonify({"error": {"code": "unauthorized", "message": "Sign in to continue."}}), 401
            statement = (
                select(users, memberships.c.organization_id, memberships.c.role)
                .join(memberships, memberships.c.user_id == users.c.id)
                .where(
                    users.c.id == user_id,
                    users.c.is_active.is_(True),
                    memberships.c.organization_id == organization_id,
                    memberships.c.status == "active",
                )
            )
            row = db.session.execute(statement).mappings().first()
            if not row:
                session.clear()
                return jsonify({"error": {"code": "unauthorized", "message": "Your session is no longer authorized."}}), 401
            role = row["role"]
            if roles and role not in roles:
                return jsonify({"error": {"code": "forbidden", "message": "Your account cannot perform this action."}}), 403
            g.user = SimpleNamespace(id=row["id"], email=row["email"], full_name=row["full_name"])
            g.organization_id = row["organization_id"]
            g.role = role
            return view(*args, **kwargs)

        return wrapped

    return decorate


def login(email, password):
    if len(password) > 512:
        return None
    row = db.session.execute(select(users).where(users.c.email == email.lower())).mappings().first()
    if not row or not row["is_active"] or not check_password_hash(row["password_hash"], password):
        return None
    organization_rows = db.session.execute(
        select(memberships.c.organization_id, memberships.c.role)
        .where(memberships.c.user_id == row["id"], memberships.c.status == "active")
    ).all()
    if len(organization_rows) != 1:
        current_app.logger.info("Account sign-in requires exactly one active organization membership.")
        return None
    return row, organization_rows[0]
