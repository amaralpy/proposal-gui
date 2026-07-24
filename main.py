from __future__ import annotations

import json
import logging
import os
from datetime import timedelta
from functools import wraps
from statistics import mean
from time import perf_counter
from urllib import error, parse, request as urllib_request

from flask import (
    Flask,
    flash,
    g,
    jsonify,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from ldap3 import Connection, Server

from logging_setup import configure_logging

configure_logging()

from db import (
    PERMISSION_DEFINITIONS,
    PricingConfigError,
    ROLE_DEFINITIONS,
    VALID_ROLES,
    ensure_user_table,
    get_internal_user,
    get_or_create_user,
    list_internal_users,
    list_permissions,
    list_role_permissions,
    list_roles,
    load_pricing_data,
    resolve_recurring_price,
    touch_user_login,
    update_role_permissions,
    update_user_role,
)

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "prospect-gui-dev-secret")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)

logger = logging.getLogger(__name__)

REST_API_BASE_URL = os.getenv("REST_API_BASE_URL", "http://localhost:3000")
QUOTATIONS_CALCULATE_URL = os.getenv(
    "QUOTATIONS_CALCULATE_URL",
    f"{REST_API_BASE_URL}/api/v1/quotations/calculate",
)


def _parse_audit_max_distance() -> float:
    value = os.getenv("AUDIT_MAX_DISTANCE", "0.7")
    try:
        return float(value)
    except ValueError:
        return 0.7


AUDIT_MAX_DISTANCE = _parse_audit_max_distance()

LDAP_ENABLED = os.getenv("LDAP_ENABLED", "true").lower() == "true"
LDAP_SERVER_URI = os.getenv("LDAP_SERVER_URI", "ldap://localhost:389")
LDAP_BASE_DN = os.getenv("LDAP_BASE_DN", "")
LDAP_USER_FILTER = os.getenv("LDAP_USER_FILTER", "(sAMAccountName={username})")
LDAP_BIND_DN = os.getenv("LDAP_BIND_DN", "")
LDAP_BIND_PASSWORD = os.getenv("LDAP_BIND_PASSWORD", "")
DEFAULT_ROLE = os.getenv("DEFAULT_ROLE", "viewer")

_USERS_TABLE_READY = False

PYG_PER_USD = 8000

logger.info(
    "Aplicacion iniciada. ldap_enabled=%s rest_api_base=%s quotations_url=%s",
    LDAP_ENABLED,
    REST_API_BASE_URL,
    QUOTATIONS_CALCULATE_URL,
)

PRIMARY_NAV_ITEMS = (
    {
        "section": "dashboard",
        "endpoint": "dashboard",
        "label": "Dashboard",
        "icon": "dashboard",
        "permission": "dashboard:view",
    },
    {
        "section": "honorarios",
        "endpoint": "honorarios",
        "label": "Honorarios",
        "icon": "calculate",
        "permission": "honorarios:view",
    },
    {
        "section": "tarifas_recurrentes",
        "endpoint": "tarifas_recurrentes",
        "label": "Tarifas recurrentes",
        "icon": "sync",
        "permission": "tarifas_recurrentes:view",
    },
    {
        "section": "tarifas_unicas",
        "endpoint": "tarifas_unicas",
        "label": "Tarifas unicas",
        "icon": "price_change",
        "permission": "tarifas_unicas:view",
    },
)

SECURITY_NAV_ITEMS = (
    {
        "section": "usuarios",
        "endpoint": "usuarios",
        "label": "Usuarios",
        "icon": "group",
        "permission": "usuarios:view",
    },
    {
        "section": "roles",
        "endpoint": "roles",
        "label": "Roles",
        "icon": "shield_person",
        "permission": "roles:view",
    },
    {
        "section": "permisos",
        "endpoint": "permisos",
        "label": "Permisos",
        "icon": "key",
        "permission": "permisos:view",
    },
)


def _safe_default_role() -> str:
    return DEFAULT_ROLE if DEFAULT_ROLE in VALID_ROLES else "viewer"


def _is_authenticated() -> bool:
    return bool(session.get("username"))


def _session_permissions() -> set[str]:
    return set(session.get("permissions") or [])


def _has_permission(permission: str) -> bool:
    return permission in _session_permissions()


def _has_any_permission(*permissions: str) -> bool:
    return any(_has_permission(permission) for permission in permissions)


def _authorized_nav_items(items: tuple[dict[str, str], ...]) -> list[dict[str, str]]:
    return [
        {
            **item,
            "url": url_for(item["endpoint"]),
        }
        for item in items
        if _has_permission(item["permission"])
    ]


def _first_accessible_endpoint() -> str:
    for item in PRIMARY_NAV_ITEMS + SECURITY_NAV_ITEMS:
        if _has_permission(item["permission"]):
            return item["endpoint"]
    return "login"


def _forbidden(api: bool = False):
    message = "No tienes permisos para acceder a esta seccion."
    logger.warning(
        "Acceso denegado. user=%s path=%s api=%s",
        session.get("username"),
        request.path,
        api,
    )
    if api:
        return jsonify({"error": message}), 403

    flash(message, "error")
    return redirect(url_for(_first_accessible_endpoint()))


def _ensure_permission(permission: str, api: bool = False):
    if not _has_permission(permission):
        return _forbidden(api=api)
    return None


def _ensure_any_permission(permissions: tuple[str, ...], api: bool = False):
    if not _has_any_permission(*permissions):
        return _forbidden(api=api)
    return None


def _refresh_session_access() -> None:
    username = session.get("username")
    if not username:
        return

    _ensure_user_store_once()
    user = get_internal_user(username)
    if not user or not user.get("is_active", True):
        logger.warning("Sesion invalidada para usuario=%s. usuario no encontrado o inactivo.", username)
        session.clear()
        return

    role = user["role"] if user["role"] in VALID_ROLES else _safe_default_role()
    effective_permissions = list_role_permissions(role)
    if not effective_permissions:
        effective_permissions = sorted(ROLE_DEFINITIONS.get(role, {}).get("permissions", []))

    session["role"] = role
    session["permissions"] = effective_permissions
    logger.debug(
        "Sesion actualizada para usuario=%s role=%s permisos=%s",
        username,
        role,
        len(effective_permissions),
    )


@app.before_request
def log_request_start() -> None:
    g.request_started_at = perf_counter()
    if request.path.startswith("/static/"):
        return

    logger.info(
        "REQUEST start method=%s path=%s ip=%s user=%s",
        request.method,
        request.path,
        request.remote_addr,
        session.get("username"),
    )


@app.after_request
def log_request_end(response):
    if request.path.startswith("/static/"):
        return response

    elapsed_ms = 0.0
    started_at = getattr(g, "request_started_at", None)
    if started_at is not None:
        elapsed_ms = (perf_counter() - started_at) * 1000

    logger.info(
        "REQUEST end method=%s path=%s status=%s elapsed_ms=%.2f user=%s",
        request.method,
        request.path,
        response.status_code,
        elapsed_ms,
        session.get("username"),
    )
    return response


@app.before_request
def sync_session_access() -> None:
    if _is_authenticated():
        _refresh_session_access()


@app.context_processor
def inject_user_context() -> dict:
    primary_nav = _authorized_nav_items(PRIMARY_NAV_ITEMS) if _is_authenticated() else []
    security_nav = _authorized_nav_items(SECURITY_NAV_ITEMS) if _is_authenticated() else []
    return {
        "current_user": {
            "username": session.get("username"),
            "full_name": session.get("full_name"),
            "role": session.get("role"),
            "permissions": sorted(_session_permissions()),
        },
        "navigation_items": primary_nav,
        "security_navigation_items": security_nav,
        "permission_catalog": PERMISSION_DEFINITIONS,
        "valid_roles": sorted(VALID_ROLES),
    }


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not _is_authenticated():
            logger.debug("Intento de acceso sin sesion. path=%s", request.path)
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def permission_required(permission: str, api: bool = False):
    def decorator(view):
        @login_required
        @wraps(view)
        def wrapped(*args, **kwargs):
            forbidden = _ensure_permission(permission, api=api)
            if forbidden:
                return forbidden
            return view(*args, **kwargs)

        return wrapped

    return decorator


def any_permission_required(permissions: tuple[str, ...], api: bool = False):
    def decorator(view):
        @login_required
        @wraps(view)
        def wrapped(*args, **kwargs):
            forbidden = _ensure_any_permission(permissions, api=api)
            if forbidden:
                return forbidden
            return view(*args, **kwargs)

        return wrapped

    return decorator


def _ldap_authenticate(username: str, password: str) -> tuple[bool, str | None, dict | None]:
    app.logger.debug("[LDAP] Inicio de autenticacion para usuario: %r", username)

    if not username or not password:
        app.logger.debug("[LDAP] Usuario o contrasena vacios, rechazando.")
        return False, "Usuario y contrasena son requeridos.", None

    if not LDAP_ENABLED:
        app.logger.debug("[LDAP] LDAP deshabilitado, autenticacion omitida.")
        return True, None, {"full_name": username, "email": None}

    if not LDAP_BASE_DN:
        app.logger.debug("[LDAP] LDAP_BASE_DN no configurado.")
        return False, "LDAP_BASE_DN no esta configurado.", None

    app.logger.debug("[LDAP] Servidor: %s | Base DN: %s", LDAP_SERVER_URI, LDAP_BASE_DN)

    try:
        server = Server(LDAP_SERVER_URI, get_info=None)
        app.logger.debug("[LDAP] Objeto Server creado: %r", server)
        search_conn = None

        if LDAP_BIND_DN and LDAP_BIND_PASSWORD:
            app.logger.debug("[LDAP] Usando bind DN para busqueda: %s", LDAP_BIND_DN)
            search_conn = Connection(
                server,
                user=LDAP_BIND_DN,
                password=LDAP_BIND_PASSWORD,
                auto_bind=True,
            )
        else:
            app.logger.debug("[LDAP] Sin bind DN configurado, usando conexion anonima.")
            search_conn = Connection(server, auto_bind=True)

        app.logger.debug("[LDAP] Conexion de busqueda establecida: %r", search_conn)

        search_filter = LDAP_USER_FILTER.format(username=username)
        app.logger.debug(
            "[LDAP] Buscando en base=%r con filtro=%r", LDAP_BASE_DN, search_filter
        )

        search_conn.search(
            search_base=LDAP_BASE_DN,
            search_filter=search_filter,
            attributes=["distinguishedName", "cn", "sAMAccountName", "mail"],
        )

        app.logger.debug(
            "[LDAP] Resultado de busqueda: %d entradas encontradas. result=%r",
            len(search_conn.entries),
            search_conn.result,
        )
        for i, entry in enumerate(search_conn.entries):
            app.logger.debug("[LDAP]   Entrada[%d]: dn=%r attrs=%r", i, entry.entry_dn, entry.entry_attributes_as_dict)

        if not search_conn.entries:
            search_conn.unbind()
            return False, "Usuario o contraseña incorrecta.", None

        user_entry = search_conn.entries[0]
        attrs = user_entry.entry_attributes_as_dict
        cn_value = attrs.get("cn")
        mail_value = attrs.get("mail")

        if isinstance(cn_value, list):
            full_name = str(cn_value[0]).strip() if cn_value else username
        else:
            full_name = str(cn_value).strip() if cn_value else username

        if isinstance(mail_value, list):
            email = str(mail_value[0]).strip() if mail_value else None
        else:
            email = str(mail_value).strip() if mail_value else None

        ldap_profile = {
            "full_name": full_name or username,
            "email": email or None,
        }

        user_dn = str(user_entry.entry_dn)
        app.logger.debug("[LDAP] DN del usuario encontrado: %r", user_dn)
        search_conn.unbind()

        app.logger.debug("[LDAP] Intentando bind con credenciales del usuario...")
        try:
            user_conn = Connection(server, user=user_dn, password=password, auto_bind=True)
            user_conn.unbind()
            app.logger.debug("[LDAP] Bind exitoso para %r", user_dn)
            return True, None, ldap_profile
        except Exception as bind_exc:
            app.logger.debug("[LDAP] Bind fallido para %r: %r", user_dn, bind_exc)
            return False, "Usuario o contraseña incorrecta.", None
    except Exception as exc:
        app.logger.exception("[LDAP] Error inesperado durante autenticacion: %r", exc)
        return False, "No se pudo validar contra LDAP.", None


def _proxy_to_rest(
    method: str,
    path: str,
    payload: dict | None = None,
    query_params: dict[str, str] | None = None,
) -> tuple:
    query = f"?{parse.urlencode(query_params)}" if query_params else ""
    url = f"{REST_API_BASE_URL}{path}{query}"

    logger.debug(
        "Proxy REST request method=%s path=%s query=%s payload_keys=%s",
        method,
        path,
        bool(query_params),
        sorted(payload.keys()) if isinstance(payload, dict) else [],
    )

    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib_request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method=method,
    )

    try:
        with urllib_request.urlopen(req, timeout=20) as upstream_response:
            raw = upstream_response.read().decode("utf-8")
            data = json.loads(raw) if raw else {}
            logger.info(
                "Proxy REST ok method=%s path=%s status=%s",
                method,
                path,
                upstream_response.status,
            )
            return jsonify(data), upstream_response.status
    except error.HTTPError as http_error:
        logger.warning(
            "Proxy REST HTTPError method=%s path=%s status=%s",
            method,
            path,
            http_error.code,
        )
        raw_body = http_error.read().decode("utf-8") if http_error.fp else ""
        try:
            parsed_error = json.loads(raw_body) if raw_body else {}
        except json.JSONDecodeError:
            parsed_error = {"error": raw_body or "Error en servicio REST."}
        return jsonify(parsed_error), http_error.code
    except (error.URLError, TimeoutError):
        logger.exception("Proxy REST fallo de conexion method=%s path=%s url=%s", method, path, url)
        return jsonify({"error": "No se pudo conectar con el servicio REST."}), 503


def _ensure_user_store_once() -> None:
    global _USERS_TABLE_READY
    if _USERS_TABLE_READY:
        return

    logger.info("Inicializando tablas internas de usuarios/RBAC.")
    try:
        ensure_user_table()
        _USERS_TABLE_READY = True
        logger.info("Tablas internas listas.")
    except Exception:
        logger.exception("No se pudo inicializar el almacenamiento de usuarios.")
        raise


def _to_float(value: object, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _calculate_outsourcing(
    payload: dict,
    pricing_data,
) -> tuple[list[tuple[str, float]], float]:
    items: list[tuple[str, float]] = []
    total = 0.0

    services = payload.get("servicios_recurrentes", []) or []
    procedures = payload.get("tramites", []) or []
    monthly_docs = int(_to_float(payload.get("comprobantes_mensuales"), 0))

    for code in services:
        service_type = pricing_data.service_types.get(code)
        if service_type and service_type != "recurring":
            continue

        price = 0.0
        if service_type == "recurring":
            price = resolve_recurring_price(
                pricing_data.recurring_price_ranges,
                code,
                monthly_docs,
            )

        if price > 0:
            items.append((f"Servicio {code}", price))
            total += price

    for code in procedures:
        service_type = pricing_data.service_types.get(code)
        if service_type and service_type != "occasional":
            continue

        price = pricing_data.occasional_prices_usd.get(code, 0.0)
        if price > 0:
            items.append((f"Tramite {code}", price))
            total += price

    docs_cost = monthly_docs * 1.3
    if docs_cost > 0:
        items.append(("Gestion de comprobantes", docs_cost))
        total += docs_cost

    if payload.get("incluye_erp") in ("si", True):
        items.append(("Integracion ERP", 350))
        total += 350

    return items, total


def _calculate_auditoria(payload: dict) -> tuple[list[tuple[str, float]], float]:
    items: list[tuple[str, float]] = []

    income = _to_float(payload.get("facturacion_anual_usd"))
    assets = _to_float(payload.get("activos_totales_usd"))
    employees = _to_float(payload.get("cantidad_empleados"))
    benchmark = _to_float(payload.get("benchmark_usd"))

    historical_fees = payload.get("historical_fees", []) or []
    historical_hours = payload.get("historical_hours", []) or []
    fee_values = [_to_float(row.get("honorarios_usd")) for row in historical_fees][:3]
    hour_values = [_to_float(row.get("horas")) for row in historical_hours][:3]
    fee_values = [v for v in fee_values if v > 0]
    hour_values = [v for v in hour_values if v > 0]

    avg_fee = mean(fee_values) if fee_values else 0.0
    avg_hours = mean(hour_values) if hour_values else 0.0

    base_risk_component = (income * 0.0025) + (assets * 0.0007) + (employees * 6)
    market_component = benchmark * 0.22
    history_component = avg_fee * 0.55 + avg_hours * 18

    ipc = _to_float(payload.get("ipc_historico"))
    projection = _to_float(payload.get("proyeccion"))
    inflation_factor = 1 + (ipc + projection) / 100

    subtotal = base_risk_component + market_component + history_component
    total = subtotal * inflation_factor

    items.append(("Componente por riesgo y tamano de negocio", base_risk_component))
    items.append(("Componente de mercado (benchmark)", market_component))
    items.append(("Componente historico", history_component))
    items.append(("Ajuste por IPC y proyeccion", total - subtotal))

    return items, total


def _currency_value(usd_value: float, currency: str) -> tuple[float, str]:
    if currency == "PYG":
        return usd_value * PYG_PER_USD, "PYG"
    return usd_value, "USD"


def _build_outsourcing_options(pricing_data) -> dict[str, list[dict[str, str]]]:
    recurring_services = []
    occasional_services = []

    for service_id, service_type in pricing_data.service_types.items():
        service_name = pricing_data.service_names.get(service_id, service_id)
        option = {
            "value": service_id,
            "label": service_name,
        }

        if service_type == "recurring":
            recurring_services.append(option)
        elif service_type == "occasional":
            occasional_services.append(option)

    recurring_services.sort(key=lambda item: item["value"])
    occasional_services.sort(key=lambda item: item["value"])

    return {
        "servicios_recurrentes": recurring_services,
        "tramites": occasional_services,
    }


@app.route("/")
def index() -> str:
    if _is_authenticated():
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/login", methods=["GET", "POST"])
def login() -> str:
    _ensure_user_store_once()

    if request.method == "GET":
        if _is_authenticated():
            logger.info("Usuario ya autenticado redirigido a dashboard. user=%s", session.get("username"))
            return redirect(url_for("dashboard"))
        remembered_username = request.cookies.get("remembered_username", "")
        return render_template(
            "login.html",
            remembered_username=remembered_username,
            remember_me=bool(remembered_username),
        )

    username = (request.form.get("username") or "").strip()
    password = request.form.get("password") or ""
    remember_me = (request.form.get("remember") or "").lower() in {
        "on",
        "true",
        "1",
        "yes",
    }

    is_valid, message, ldap_profile = _ldap_authenticate(username, password)
    if not is_valid:
        logger.warning("Login fallido para usuario=%s", username)
        flash(message or "Credenciales invalidas.", "error")
        return (
            render_template(
                "login.html",
                remembered_username=username,
                remember_me=remember_me,
            ),
            401,
        )

    try:
        user = get_or_create_user(
            username=username,
            default_role=_safe_default_role(),
            full_name=(ldap_profile or {}).get("full_name") or username,
            email=(ldap_profile or {}).get("email"),
        )
        if not user.get("is_active", True):
            flash("Tu usuario se encuentra inactivo.", "error")
            return render_template("login.html"), 403

        touch_user_login(username)
    except PricingConfigError as db_error:
        logger.exception("Error de base de datos durante login para usuario=%s", username)
        flash(str(db_error), "error")
        return (
            render_template(
                "login.html",
                remembered_username=username,
                remember_me=remember_me,
            ),
            503,
        )

    logger.info("Login exitoso para usuario=%s role=%s", user["username"], user["role"])

    session.permanent = remember_me
    session["username"] = user["username"]
    session["full_name"] = user["full_name"]
    session["role"] = user["role"]
    session["permissions"] = list_role_permissions(user["role"])
    response = redirect(url_for("dashboard"))

    if remember_me and username:
        response.set_cookie(
            "remembered_username",
            username,
            max_age=30 * 24 * 60 * 60,
            httponly=False,
            samesite="Lax",
        )
    else:
        response.delete_cookie("remembered_username")

    return response


@app.post("/logout")
def logout() -> str:
    logger.info("Logout usuario=%s", session.get("username"))
    session.clear()
    return redirect(url_for("login"))


@app.get("/dashboard")
@permission_required("dashboard:view")
def dashboard() -> str:
    return render_template("dashboard.html", section="dashboard")


@app.get("/honorarios")
@permission_required("honorarios:view")
def honorarios() -> str:
    return render_template(
        "honorarios.html",
        section="honorarios",
        audit_max_distance=AUDIT_MAX_DISTANCE,
    )


@app.get("/tarifas/recurrentes")
@permission_required("tarifas_recurrentes:view")
def tarifas_recurrentes() -> str:
    return render_template("tarifas_recurrentes.html", section="tarifas_recurrentes")


@app.get("/tarifas/unicas")
@permission_required("tarifas_unicas:view")
def tarifas_unicas() -> str:
    return render_template("tarifas_unicas.html", section="tarifas_unicas")


@app.get("/usuarios")
@permission_required("usuarios:view")
def usuarios() -> str:
    return render_template("usuarios.html", section="usuarios")


@app.get("/roles")
@permission_required("roles:view")
def roles() -> str:
    return render_template("roles.html", section="roles")


@app.get("/permisos")
@permission_required("permisos:view")
def permisos() -> str:
    return render_template("permisos.html", section="permisos")


@app.route("/api/outsourcing/options", methods=["GET"])
@permission_required("honorarios:view", api=True)
def outsourcing_options() -> tuple:
    try:
        pricing_data = load_pricing_data()
    except PricingConfigError as error:
        logger.warning("No se pudo cargar pricing data: %s", error)
        return jsonify({"error": str(error)}), 503

    logger.debug("Opciones de outsourcing retornadas para usuario=%s", session.get("username"))
    return jsonify(_build_outsourcing_options(pricing_data)), 200


@app.route("/api/calculate", methods=["POST"])
@permission_required("honorarios:calculate", api=True)
def calculate() -> tuple:
    payload = request.get_json(silent=True) or {}
    logger.info(
        "Solicitud de calculo recibida user=%s type=%s",
        session.get("username"),
        payload.get("type") if isinstance(payload, dict) else None,
    )

    if isinstance(payload, dict) and payload.get("type") == "AUDIT-A":
        payload["distancia_maxima"] = AUDIT_MAX_DISTANCE

    try:
        req = urllib_request.Request(
            QUOTATIONS_CALCULATE_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib_request.urlopen(req, timeout=12) as upstream_response:
            body = upstream_response.read().decode("utf-8")
            data = json.loads(body) if body else {}
            logger.info("Calculo externo exitoso status=%s", upstream_response.status)
            return jsonify(data), upstream_response.status
    except error.HTTPError as http_error:
        logger.warning("Servicio de calculo devolvio HTTP %s", http_error.code)
        raw_body = http_error.read().decode("utf-8") if http_error.fp else ""
        try:
            upstream_error = json.loads(raw_body) if raw_body else {}
        except json.JSONDecodeError:
            upstream_error = {}

        return (
            jsonify(
                {
                    "error": upstream_error.get("error")
                    or upstream_error.get("detail")
                    or "No se pudo calcular en el servicio externo.",
                }
            ),
            http_error.code,
        )
    except (error.URLError, TimeoutError, json.JSONDecodeError):
        logger.exception("No se pudo conectar al servicio de calculo externo.")
        return jsonify({"error": "No se pudo conectar al servicio de calculo."}), 503


@app.route("/api/honorarios/calcular", methods=["POST"])
@permission_required("honorarios:calculate", api=True)
def calculate_honorarios_alias() -> tuple:
    return calculate()


@app.get("/api/rbac/users")
@permission_required("usuarios:view", api=True)
def get_rbac_users() -> tuple:
    _ensure_user_store_once()
    users = list_internal_users()
    return jsonify({"users": users, "roles": list_roles()}), 200


@app.patch("/api/rbac/users/<username>")
@permission_required("usuarios:manage", api=True)
def patch_user_role(username: str) -> tuple:
    _ensure_user_store_once()

    if session.get("username") == username:
        return jsonify({"error": "No puedes modificar tu propio acceso desde esta pantalla."}), 400

    payload = request.get_json(silent=True) or {}
    role = (payload.get("role") or "").strip()
    is_active = payload.get("is_active")

    if role not in VALID_ROLES:
        return jsonify({"error": "Rol invalido."}), 400

    if not isinstance(is_active, bool):
        return jsonify({"error": "El estado activo es invalido."}), 400

    changed = update_user_role(username=username, role=role, is_active=is_active)
    if not changed:
        logger.warning("No se encontro usuario para actualizar rol. target=%s", username)
        return jsonify({"error": "Usuario no encontrado."}), 404

    logger.info(
        "Rol de usuario actualizado por user=%s target=%s role=%s is_active=%s",
        session.get("username"),
        username,
        role,
        is_active,
    )

    return jsonify({"ok": True, "username": username, "role": role, "is_active": is_active}), 200


@app.get("/api/rbac/roles")
@permission_required("roles:view", api=True)
def get_rbac_roles() -> tuple:
    _ensure_user_store_once()
    return jsonify({"roles": list_roles(), "permissions": list_permissions()}), 200


@app.put("/api/rbac/roles/<role>/permissions")
@permission_required("roles:manage", api=True)
def put_role_permissions(role: str) -> tuple:
    _ensure_user_store_once()

    payload = request.get_json(silent=True) or {}
    permissions = payload.get("permissions")
    if not isinstance(permissions, list) or any(not isinstance(item, str) for item in permissions):
        return jsonify({"error": "La lista de permisos es invalida."}), 400

    if not update_role_permissions(role, permissions):
        logger.warning("Rol no encontrado para actualizar permisos. role=%s", role)
        return jsonify({"error": "Rol no encontrado."}), 404

    if session.get("role") == role:
        session["permissions"] = list_role_permissions(role)

    logger.info(
        "Permisos de rol actualizados por user=%s role=%s cantidad=%s",
        session.get("username"),
        role,
        len(permissions),
    )

    return jsonify({"ok": True, "role": role, "permissions": list_role_permissions(role)}), 200


@app.get("/api/rbac/permissions")
@any_permission_required(("permisos:view", "roles:view"), api=True)
def get_rbac_permissions() -> tuple:
    _ensure_user_store_once()
    return jsonify({"permissions": list_permissions(), "roles": list_roles()}), 200

@app.route("/api/tarifas/recurrentes", methods=["GET", "POST"])
@login_required
def recurring_services_collection() -> tuple:
    forbidden = _ensure_permission(
        "tarifas_recurrentes:view" if request.method == "GET" else "tarifas_recurrentes:manage",
        api=True,
    )
    if forbidden:
        return forbidden

    if request.method == "GET":
        query_params = {
            "pagina": request.args.get("pagina", "1"),
            "tamano_pagina": request.args.get("tamano_pagina", "10"),
            "tipo": "recurring",
        }
        return _proxy_to_rest("GET", "/api/v1/services", query_params=query_params)

    payload = request.get_json(silent=True) or {}
    payload["tipo"] = "recurring"
    return _proxy_to_rest("POST", "/api/v1/services", payload=payload)


@app.route("/api/tarifas/recurrentes/<service_id>", methods=["PUT", "DELETE"])
@login_required
def recurring_services_item(service_id: str) -> tuple:
    forbidden = _ensure_permission("tarifas_recurrentes:manage", api=True)
    if forbidden:
        return forbidden

    if request.method == "DELETE":
        return _proxy_to_rest("DELETE", f"/api/v1/services/{service_id}")

    payload = request.get_json(silent=True) or {}
    return _proxy_to_rest("PUT", f"/api/v1/services/{service_id}", payload=payload)


@app.route("/api/tarifas/recurrentes/<service_id>/rangos", methods=["POST"])
@login_required
def recurring_service_add_price_range(service_id: str) -> tuple:
    forbidden = _ensure_permission("tarifas_recurrentes:manage", api=True)
    if forbidden:
        return forbidden

    payload = request.get_json(silent=True) or {}
    return _proxy_to_rest("POST", f"/api/v1/services/{service_id}/prices/recurring", payload=payload)


@app.route("/api/tarifas/recurrentes/<service_id>/rangos/<price_id>", methods=["PUT", "DELETE"])
@login_required
def recurring_service_price_range_item(service_id: str, price_id: str) -> tuple:
    forbidden = _ensure_permission("tarifas_recurrentes:manage", api=True)
    if forbidden:
        return forbidden

    if request.method == "DELETE":
        return _proxy_to_rest("DELETE", f"/api/v1/services/{service_id}/prices/recurring/{price_id}")

    payload = request.get_json(silent=True) or {}
    return _proxy_to_rest("PUT", f"/api/v1/services/{service_id}/prices/recurring/{price_id}", payload=payload)


@app.route("/api/tarifas/unicas", methods=["GET", "POST"])
@login_required
def occasional_services_collection() -> tuple:
    forbidden = _ensure_permission(
        "tarifas_unicas:view" if request.method == "GET" else "tarifas_unicas:manage",
        api=True,
    )
    if forbidden:
        return forbidden

    if request.method == "GET":
        query_params = {
            "pagina": request.args.get("pagina", "1"),
            "tamano_pagina": request.args.get("tamano_pagina", "10"),
            "tipo": "occasional",
        }
        return _proxy_to_rest("GET", "/api/v1/services", query_params=query_params)

    payload = request.get_json(silent=True) or {}
    payload["tipo"] = "occasional"
    return _proxy_to_rest("POST", "/api/v1/services", payload=payload)


@app.route("/api/tarifas/unicas/<service_id>", methods=["PUT", "DELETE"])
@login_required
def occasional_services_item(service_id: str) -> tuple:
    forbidden = _ensure_permission("tarifas_unicas:manage", api=True)
    if forbidden:
        return forbidden

    if request.method == "DELETE":
        return _proxy_to_rest("DELETE", f"/api/v1/services/{service_id}")

    payload = request.get_json(silent=True) or {}
    return _proxy_to_rest("PUT", f"/api/v1/services/{service_id}", payload=payload)


@app.route("/api/tarifas/unicas/<service_id>/precio", methods=["POST", "PUT", "DELETE"])
@login_required
def occasional_service_price(service_id: str) -> tuple:
    forbidden = _ensure_permission("tarifas_unicas:manage", api=True)
    if forbidden:
        return forbidden

    if request.method == "DELETE":
        return _proxy_to_rest("DELETE", f"/api/v1/services/{service_id}/prices/occasional")

    payload = request.get_json(silent=True) or {}
    method = "POST" if request.method == "POST" else "PUT"
    return _proxy_to_rest(method, f"/api/v1/services/{service_id}/prices/occasional", payload=payload)


if __name__ == "__main__":
    logger.info("Inicio de aplicacion en modo local.")
    ensure_user_table()
    app.run(debug=True)
