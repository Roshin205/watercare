from functools import wraps

from flask import current_app, g, jsonify, request
from supabase import create_client
from supabase.lib.client_options import SyncClientOptions


def require_user(roles=None):
    def decorator(handler):
        @wraps(handler)
        def wrapped(*args, **kwargs):
            client = current_app.extensions.get("supabase")
            if client is None:
                return jsonify({"error": {"code": "service_unavailable", "message": "Authentication service is not configured."}}), 503
            authorization = request.headers.get("Authorization", "")
            if not authorization.startswith("Bearer "):
                return jsonify({"error": {"code": "unauthorized", "message": "Sign in to continue."}}), 401
            token = authorization[7:].strip()
            if not token:
                return jsonify({"error": {"code": "unauthorized", "message": "Sign in to continue."}}), 401
            try:
                response = client.auth.get_user(token)
                user = response.user
            except Exception:
                current_app.logger.info("Supabase rejected an access token.")
                return jsonify({"error": {"code": "unauthorized", "message": "Your session is invalid or has expired."}}), 401
            if user is None:
                return jsonify({"error": {"code": "unauthorized", "message": "Your session is invalid or has expired."}}), 401
            g.user = user
            if current_app.testing and not current_app.config.get("SUPABASE_ANON_KEY"):
                g.supabase = client
            else:
                try:
                    g.supabase = create_client(
                        current_app.config["SUPABASE_URL"],
                        current_app.config["SUPABASE_ANON_KEY"],
                        SyncClientOptions(headers={"Authorization": f"Bearer {token}"}),
                    )
                except Exception:
                    current_app.logger.exception("Could not initialize the authenticated Supabase client.")
                    return jsonify({"error": {"code": "service_unavailable", "message": "Database access is temporarily unavailable."}}), 503
            try:
                memberships = (
                    g.supabase.table("organization_memberships")
                    .select("organization_id,role,status")
                    .eq("user_id", user.id)
                    .eq("status", "active")
                    .execute()
                    .data
                )
            except Exception:
                current_app.logger.exception("Membership lookup failed.")
                return jsonify({"error": {"code": "service_unavailable", "message": "Access could not be verified."}}), 503
            requested_org = request.headers.get("X-Organization-ID")
            membership = next(
                (m for m in memberships or [] if requested_org and m["organization_id"] == requested_org),
                None,
            )
            if not requested_org and memberships:
                membership = memberships[0]
            if membership is None:
                return jsonify({"error": {"code": "forbidden", "message": "You are not a member of this organization."}}), 403
            g.organization_id = membership["organization_id"]
            g.role = membership["role"]
            if roles and g.role not in roles:
                return jsonify({"error": {"code": "forbidden", "message": "Your role cannot perform this action."}}), 403
            return handler(*args, **kwargs)

        return wrapped

    return decorator
