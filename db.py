from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import logging
import os
from typing import Any

from dotenv import load_dotenv
import psycopg
from psycopg import sql

load_dotenv()

logger = logging.getLogger(__name__)


class PricingConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class PricingData:
    recurring_price_ranges: dict[str, list[tuple[int, int, float]]]
    occasional_prices_usd: dict[str, float]
    service_types: dict[str, str]
    service_names: dict[str, str]


PERMISSION_DEFINITIONS: tuple[dict[str, str], ...] = (
    {
        "code": "dashboard:view",
        "label": "Ver dashboard",
        "description": "Accede al panel principal e indicadores generales.",
        "module": "dashboard",
    },
    {
        "code": "honorarios:view",
        "label": "Ver honorarios",
        "description": "Accede a la pantalla del cotizador de honorarios.",
        "module": "honorarios",
    },
    {
        "code": "honorarios:calculate",
        "label": "Calcular honorarios",
        "description": "Ejecuta calculos y consultas del cotizador.",
        "module": "honorarios",
    },
    {
        "code": "tarifas_recurrentes:view",
        "label": "Ver tarifas recurrentes",
        "description": "Consulta el listado de tarifas recurrentes.",
        "module": "tarifas",
    },
    {
        "code": "tarifas_recurrentes:manage",
        "label": "Administrar tarifas recurrentes",
        "description": "Crea, edita y elimina tarifas recurrentes.",
        "module": "tarifas",
    },
    {
        "code": "tarifas_unicas:view",
        "label": "Ver tarifas unicas",
        "description": "Consulta el listado de tarifas unicas.",
        "module": "tarifas",
    },
    {
        "code": "tarifas_unicas:manage",
        "label": "Administrar tarifas unicas",
        "description": "Crea, edita y elimina tarifas unicas.",
        "module": "tarifas",
    },
    {
        "code": "usuarios:view",
        "label": "Ver usuarios",
        "description": "Accede al listado de usuarios internos.",
        "module": "seguridad",
    },
    {
        "code": "usuarios:manage",
        "label": "Administrar usuarios",
        "description": "Actualiza roles y estado de usuarios.",
        "module": "seguridad",
    },
    {
        "code": "roles:view",
        "label": "Ver roles",
        "description": "Accede a la configuracion de roles.",
        "module": "seguridad",
    },
    {
        "code": "roles:manage",
        "label": "Administrar roles",
        "description": "Asigna permisos a los roles disponibles.",
        "module": "seguridad",
    },
    {
        "code": "permisos:view",
        "label": "Ver permisos",
        "description": "Consulta la matriz de permisos por rol.",
        "module": "seguridad",
    },
)

ROLE_DEFINITIONS: dict[str, dict[str, Any]] = {
    "admin": {
        "label": "Administrador",
        "description": "Control total del sistema y de la configuracion RBAC.",
        "permissions": {definition["code"] for definition in PERMISSION_DEFINITIONS},
    },
    "manager": {
        "label": "Manager",
        "description": "Gestion operativa de cotizaciones y tarifas.",
        "permissions": {
            "dashboard:view",
            "honorarios:view",
            "honorarios:calculate",
            "tarifas_recurrentes:view",
            "tarifas_recurrentes:manage",
            "tarifas_unicas:view",
            "tarifas_unicas:manage",
        },
    },
    "analyst": {
        "label": "Analista",
        "description": "Consulta y calculo sin permisos de administracion.",
        "permissions": {
            "dashboard:view",
            "honorarios:view",
            "honorarios:calculate",
            "tarifas_recurrentes:view",
            "tarifas_unicas:view",
        },
    },
    "viewer": {
        "label": "Viewer",
        "description": "Acceso de solo lectura a pantallas habilitadas.",
        "permissions": {
            "dashboard:view",
            "honorarios:view",
            "tarifas_recurrentes:view",
            "tarifas_unicas:view",
        },
    },
}

VALID_ROLES = set(ROLE_DEFINITIONS)
VALID_PERMISSIONS = {definition["code"] for definition in PERMISSION_DEFINITIONS}


def _seed_rbac_catalog(connection: psycopg.Connection[object]) -> None:
    with connection.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO app_roles (code, label, description)
            VALUES (%s, %s, %s)
            ON CONFLICT (code) DO UPDATE
               SET label = EXCLUDED.label,
                   description = EXCLUDED.description,
                   updated_at = NOW()
            """,
            [
                (code, metadata["label"], metadata["description"])
                for code, metadata in ROLE_DEFINITIONS.items()
            ],
        )
        cursor.executemany(
            """
            INSERT INTO app_permissions (code, label, description, module)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (code) DO UPDATE
               SET label = EXCLUDED.label,
                   description = EXCLUDED.description,
                   module = EXCLUDED.module
            """,
            [
                (
                    permission["code"],
                    permission["label"],
                    permission["description"],
                    permission["module"],
                )
                for permission in PERMISSION_DEFINITIONS
            ],
        )
        cursor.executemany(
            """
            INSERT INTO app_role_permissions (role_code, permission_code)
            VALUES (%s, %s)
            ON CONFLICT DO NOTHING
            """,
            [
                (role_code, permission_code)
                for role_code, metadata in ROLE_DEFINITIONS.items()
                for permission_code in sorted(metadata["permissions"])
            ],
        )


def _load_service_types(connection: psycopg.Connection[object]) -> dict[str, str]:
    query = sql.SQL('SELECT id, service_type FROM {}').format(sql.Identifier("services"))
    with connection.cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall()

    service_types: dict[str, str] = {}
    for service_id, service_type in rows:
        service_types[str(service_id)] = str(service_type)

    return service_types


def _load_service_names(connection: psycopg.Connection[object]) -> dict[str, str]:
    query = sql.SQL('SELECT id, name FROM {}').format(sql.Identifier("services"))
    with connection.cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall()

    service_names: dict[str, str] = {}
    for service_id, name in rows:
        service_names[str(service_id)] = str(name)

    return service_names


def _load_recurring_price_ranges(connection: psycopg.Connection[object]) -> dict[str, list[tuple[int, int, float]]]:
    query = sql.SQL(
        "SELECT service_id, range_from, range_to, price_usd FROM {} ORDER BY service_id, range_from, range_to"
    ).format(sql.Identifier("recurring_price_ranges"))
    with connection.cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall()

    price_ranges: dict[str, list[tuple[int, int, float]]] = {}
    for service_id, range_from, range_to, price_usd in rows:
        price_ranges.setdefault(str(service_id), []).append(
            (int(range_from), int(range_to), float(price_usd))
        )

    return price_ranges


def _load_occasional_prices(connection: psycopg.Connection[object]) -> dict[str, float]:
    query = sql.SQL("SELECT service_id, price_usd FROM {} ORDER BY service_id").format(
        sql.Identifier("occasional_prices")
    )
    with connection.cursor() as cursor:
        cursor.execute(query)
        rows = cursor.fetchall()

    price_map: dict[str, float] = {}
    for service_id, price_usd in rows:
        price_map[str(service_id)] = float(price_usd)

    return price_map


def resolve_recurring_price(
    price_ranges: dict[str, list[tuple[int, int, float]]],
    service_id: str,
    volume: int,
) -> float:
    ranges = price_ranges.get(service_id, [])
    if not ranges:
        return 0.0

    for range_from, range_to, price_usd in ranges:
        if range_from <= volume <= range_to:
            return price_usd

    if volume < ranges[0][0]:
        return ranges[0][2]

    return ranges[-1][2]


def _get_connection() -> psycopg.Connection[object]:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        logger.error("DATABASE_URL no configurada para conexion a PostgreSQL.")
        raise PricingConfigError(
            "DATABASE_URL no esta configurada. Define la conexion PostgreSQL en .env."
        )
    try:
        return psycopg.connect(database_url)
    except Exception:
        logger.exception("No se pudo establecer conexion a PostgreSQL.")
        raise


def ensure_user_table() -> None:
    logger.info("Creando/verificando tablas internas app_users y RBAC.")
    ddl = """
    CREATE TABLE IF NOT EXISTS app_users (
        username TEXT PRIMARY KEY,
        full_name TEXT,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'viewer',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
    )
    """
    roles_ddl = """
    CREATE TABLE IF NOT EXISTS app_roles (
        code TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """
    permissions_ddl = """
    CREATE TABLE IF NOT EXISTS app_permissions (
        code TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        description TEXT NOT NULL,
        module TEXT NOT NULL
    )
    """
    role_permissions_ddl = """
    CREATE TABLE IF NOT EXISTS app_role_permissions (
        role_code TEXT NOT NULL REFERENCES app_roles(code) ON DELETE CASCADE,
        permission_code TEXT NOT NULL REFERENCES app_permissions(code) ON DELETE CASCADE,
        PRIMARY KEY (role_code, permission_code)
    )
    """

    with _get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(ddl)
            cursor.execute("ALTER TABLE app_users ADD COLUMN IF NOT EXISTS full_name TEXT")
            cursor.execute("ALTER TABLE app_users ADD COLUMN IF NOT EXISTS email TEXT")
            cursor.execute("UPDATE app_users SET full_name = username WHERE full_name IS NULL OR BTRIM(full_name) = ''")
            cursor.execute("ALTER TABLE app_users ALTER COLUMN full_name SET NOT NULL")
            cursor.execute(roles_ddl)
            cursor.execute(permissions_ddl)
            cursor.execute(role_permissions_ddl)
        _seed_rbac_catalog(connection)
        connection.commit()
    logger.info("Tablas internas y catalogo RBAC listos.")


def list_role_permissions(role: str) -> list[str]:
    query = """
    SELECT permission_code
      FROM app_role_permissions
     WHERE role_code = %s
     ORDER BY permission_code ASC
    """

    with _get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (role,))
            rows = cursor.fetchall()

    logger.debug("Permisos consultados para role=%s cantidad=%s", role, len(rows))

    return [row[0] for row in rows]


def list_roles() -> list[dict[str, Any]]:
    query = """
    SELECT r.code,
           r.label,
           r.description,
           COALESCE(
               ARRAY_AGG(rp.permission_code ORDER BY rp.permission_code)
               FILTER (WHERE rp.permission_code IS NOT NULL),
               ARRAY[]::TEXT[]
           ) AS permissions
      FROM app_roles r
      LEFT JOIN app_role_permissions rp ON rp.role_code = r.code
     GROUP BY r.code, r.label, r.description
     ORDER BY r.code ASC
    """

    with _get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            rows = cursor.fetchall()

    return [
        {
            "code": row[0],
            "label": row[1],
            "description": row[2],
            "permissions": list(row[3] or []),
        }
        for row in rows
    ]


def list_permissions() -> list[dict[str, str]]:
    query = """
    SELECT code, label, description, module
      FROM app_permissions
     ORDER BY module ASC, code ASC
    """

    with _get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            rows = cursor.fetchall()

    return [
        {
            "code": row[0],
            "label": row[1],
            "description": row[2],
            "module": row[3],
        }
        for row in rows
    ]


def update_role_permissions(role: str, permissions: list[str]) -> bool:
    if role not in VALID_ROLES:
        logger.warning("Intento de actualizar permisos con rol invalido: %s", role)
        raise ValueError("Rol no permitido.")

    normalized_permissions = sorted({permission for permission in permissions if permission in VALID_PERMISSIONS})
    logger.info(
        "Actualizando permisos de rol role=%s solicitados=%s aplicados=%s",
        role,
        len(permissions),
        len(normalized_permissions),
    )

    with _get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM app_roles WHERE code = %s", (role,))
            if not cursor.fetchone():
                logger.warning("Rol no encontrado en BD al actualizar permisos: %s", role)
                return False

            cursor.execute("DELETE FROM app_role_permissions WHERE role_code = %s", (role,))
            if normalized_permissions:
                cursor.executemany(
                    """
                    INSERT INTO app_role_permissions (role_code, permission_code)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    [(role, permission) for permission in normalized_permissions],
                )
        connection.commit()

    logger.info("Permisos de rol actualizados correctamente role=%s", role)
    return True


def get_or_create_user(
    username: str,
    default_role: str = "viewer",
    full_name: str | None = None,
    email: str | None = None,
) -> dict[str, Any]:
    normalized_role = default_role if default_role in VALID_ROLES else "viewer"
    normalized_full_name = (full_name or "").strip() or username
    normalized_email = (email or "").strip() or None

    query = """
    INSERT INTO app_users (username, full_name, email, role)
    VALUES (%s, %s, %s, %s)
    ON CONFLICT (username) DO UPDATE
       SET full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), app_users.full_name),
           email = COALESCE(EXCLUDED.email, app_users.email),
           updated_at = NOW()
    """
    fetch_query = "SELECT username, full_name, email, role, is_active, created_at, updated_at, last_login_at FROM app_users WHERE username = %s"

    with _get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (username, normalized_full_name, normalized_email, normalized_role))
            cursor.execute(fetch_query, (username,))
            row = cursor.fetchone()
        connection.commit()

    if not row:
        logger.error("No se pudo crear u obtener usuario interno username=%s", username)
        raise PricingConfigError("No se pudo crear u obtener el usuario interno.")

    logger.info("Usuario interno cargado/creado username=%s role=%s", row[0], row[3])

    return {
        "username": row[0],
        "full_name": row[1],
        "email": row[2],
        "role": row[3],
        "is_active": row[4],
        "created_at": row[5],
        "updated_at": row[6],
        "last_login_at": row[7],
    }


def get_internal_user(username: str) -> dict[str, Any] | None:
    query = """
    SELECT username, full_name, email, role, is_active, created_at, updated_at, last_login_at
      FROM app_users
     WHERE username = %s
    """

    with _get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (username,))
            row = cursor.fetchone()

    if not row:
        logger.debug("Usuario interno no encontrado username=%s", username)
        return None

    return {
        "username": row[0],
        "full_name": row[1],
        "email": row[2],
        "role": row[3],
        "is_active": row[4],
        "created_at": row[5],
        "updated_at": row[6],
        "last_login_at": row[7],
    }


def touch_user_login(username: str) -> None:
    query = """
    UPDATE app_users
       SET last_login_at = NOW(),
           updated_at = NOW()
     WHERE username = %s
    """

    with _get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, (username,))
        connection.commit()
    logger.debug("Actualizado ultimo login de usuario=%s", username)


def list_internal_users() -> list[dict[str, Any]]:
    query = """
    SELECT username, full_name, email, role, is_active, created_at, updated_at, last_login_at
      FROM app_users
     ORDER BY username ASC
    """

    with _get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            rows = cursor.fetchall()

    return [
        {
            "username": row[0],
            "full_name": row[1],
            "email": row[2],
            "role": row[3],
            "is_active": row[4],
            "created_at": row[5],
            "updated_at": row[6],
            "last_login_at": row[7],
        }
        for row in rows
    ]


def update_user_role(username: str, role: str, is_active: bool | None = None) -> bool:
    if role not in VALID_ROLES:
        logger.warning("Intento de actualizar usuario con rol invalido role=%s username=%s", role, username)
        raise ValueError("Rol no permitido.")

    if is_active is None:
        query = """
        UPDATE app_users
           SET role = %s,
               updated_at = NOW()
         WHERE username = %s
        """
        params: tuple[Any, ...] = (role, username)
    else:
        query = """
        UPDATE app_users
           SET role = %s,
               is_active = %s,
               updated_at = NOW()
         WHERE username = %s
        """
        params = (role, is_active, username)

    with _get_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute(query, params)
            affected = cursor.rowcount
        connection.commit()

    logger.info(
        "Actualizacion de usuario completada username=%s role=%s is_active=%s affected=%s",
        username,
        role,
        is_active,
        affected,
    )

    return bool(affected)


@lru_cache(maxsize=1)
def load_pricing_data() -> PricingData:
    with _get_connection() as connection:
        service_types = _load_service_types(connection)
        service_names = _load_service_names(connection)
        recurring_price_ranges = _load_recurring_price_ranges(connection)
        occasional_prices = _load_occasional_prices(connection)

    if not service_types:
        logger.warning("No se encontraron servicios en tabla public.services.")
        raise PricingConfigError(
            "No se encontraron servicios en PostgreSQL. Revisa la tabla public.services."
        )

    logger.info(
        "Pricing data cargada servicios=%s recurrentes=%s ocasionales=%s",
        len(service_types),
        len(recurring_price_ranges),
        len(occasional_prices),
    )

    return PricingData(
        recurring_price_ranges=recurring_price_ranges,
        occasional_prices_usd=occasional_prices,
        service_types=service_types,
        service_names=service_names,
    )