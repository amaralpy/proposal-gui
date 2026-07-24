# Prospect GUI - Flask

Aplicacion web con autenticacion LDAP, control local de roles y panel administrativo con:

- Login LDAP.
- Dashboard (placeholder).
- Menu con paginas de:
	- Honorarios (cotizador).
	- Tarifas recurrentes (listar/editar/eliminar/alta).
	- Tarifas unicas (listar/editar/eliminar/alta).

## Configuracion

Crear `.env` desde `.env.example` y definir:

- `FLASK_SECRET_KEY`: clave de sesion Flask.
- `DATABASE_URL`: cadena de conexion PostgreSQL.
- `REST_API_BASE_URL`: base del backend REST (ej: `http://localhost:3000`).
- `QUOTATIONS_CALCULATE_URL`: opcional, por defecto `REST_API_BASE_URL/api/v1/quotations/calculate`.

### LDAP

- `LDAP_ENABLED`: `true` o `false`.
- `LDAP_SERVER_URI`: ej. `ldap://ldap.midominio.local:389`.
- `LDAP_BASE_DN`: base de busqueda, ej. `ou=users,dc=midominio,dc=local`.
- `LDAP_USER_FILTER`: filtro, por defecto `(uid={username})`.
- `LDAP_BIND_DN`: opcional, usuario tecnico para busqueda LDAP.
- `LDAP_BIND_PASSWORD`: opcional, contrasena del usuario tecnico.
- `DEFAULT_ROLE`: rol inicial local para usuarios nuevos (`admin|manager|analyst|viewer`).

### Logging con rotacion

La aplicacion genera logs rotativos en archivos para monitoreo de flujo normal y errores:

- `logs/app.log`: eventos generales (info, warning, error).
- `logs/error.log`: solo errores (error, exception).

Variables opcionales:

- `LOG_DIR`: directorio de logs (default `logs`).
- `LOG_LEVEL`: nivel base (`DEBUG`, `INFO`, `WARNING`, etc; default `INFO`).
- `LOG_MAX_BYTES`: tamano maximo por archivo antes de rotar (default `5242880`, 5 MB).
- `LOG_BACKUP_COUNT`: cantidad de archivos historicos por rotacion (default `10`).

## PostgreSQL

Tablas usadas por la app:

- `public.services` (`id`, `name`, `service_type`).
- `public.recurring_price_ranges` (`service_id`, `range_from`, `range_to`, `price_usd`).
- `public.occasional_prices` (`service_id`, `price_usd`).
- `app_users` (auto-creada por la aplicacion para usuarios/roles internos).

## Endpoints internos (UI -> Flask)

- `GET /api/outsourcing/options`
- `POST /api/calculate`
- `POST /api/honorarios/calcular`
- `GET /api/tarifas/recurrentes`
- `POST /api/tarifas/recurrentes`
- `PUT /api/tarifas/recurrentes/{id}`
- `DELETE /api/tarifas/recurrentes/{id}`
- `GET /api/tarifas/unicas`
- `POST /api/tarifas/unicas`
- `PUT /api/tarifas/unicas/{id}`
- `DELETE /api/tarifas/unicas/{id}`

### Roles internos

- `GET /api/roles/users` (solo admin)
- `PATCH /api/roles/users/{username}` (solo admin)

Body para cambio de rol:

```json
{
	"role": "manager"
}
```

## Firma sugerida para backend REST

### Tarifas recurrentes

- `GET /api/v1/recurring-fees`
- `POST /api/v1/recurring-fees`
- `PUT /api/v1/recurring-fees/{id}`
- `DELETE /api/v1/recurring-fees/{id}`

Payload sugerido:

```json
{
	"name": "Contabilidad mensual",
	"service_code": "CONTAB_MENSUAL",
	"amount": 150.0,
	"currency": "USD",
	"billing_period": "monthly",
	"valid_from": "2026-01-01",
	"valid_to": null,
	"active": true,
	"metadata": {
		"notes": "opcional"
	}
}
```

### Tarifas unicas

- `GET /api/v1/one-time-fees`
- `POST /api/v1/one-time-fees`
- `PUT /api/v1/one-time-fees/{id}`
- `DELETE /api/v1/one-time-fees/{id}`

Payload sugerido:

```json
{
	"name": "Constitucion de sociedad",
	"service_code": "CONST_SOC",
	"amount": 280.0,
	"currency": "USD",
	"billing_period": "one_time",
	"valid_from": "2026-01-01",
	"valid_to": null,
	"active": true,
	"metadata": {
		"notes": "opcional"
	}
}
```

## Ejecutar

1. Instalar dependencias:

```bash
pip install -e .
```

2. Configurar `.env`.

3. Iniciar:

```bash
python main.py
```

4. Abrir en navegador:

```text
http://127.0.0.1:5000
```
