# Esquema temporal de PostgreSQL

**Importante:** este esquema es un punto de partida razonable para poder
desarrollar los workflows ya mismo, mientras no exista el esquema definitivo
(compartido con el equipo de la web). Cuando llegue el esquema real, lo que
cambia son las **queries dentro de los nodos Postgres** de cada workflow — el
contrato de endpoints (`CONTRATO-API.md`) y la app **no cambian**, porque la
app nunca habla con la base de datos directamente.

Motor asumido: PostgreSQL. Si el esquema real termina siendo MySQL/SQL Server,
la estructura conceptual (tablas, relaciones) se mantiene igual; solo cambia
la sintaxis de creación y el tipo de nodo en n8n.

---

## Diagrama de relaciones

```
estudiantes ──┬──< tickets_verificacion
              │
              └──< tickets_solicitud >── tipos_tramite
                        │
                        └──1:1── certificados_matricula
```

---

## `estudiantes`

Placeholder — cuando llegue el esquema real de la institución, esta tabla
probablemente ya exista con otro nombre/estructura (ej. viene del sistema
académico). Aquí se asume lo mínimo que la app necesita.

```sql
CREATE TABLE estudiantes (
  id                    SERIAL PRIMARY KEY,
  cedula                VARCHAR(10)  NOT NULL UNIQUE,
  nombres               VARCHAR(100) NOT NULL,
  apellidos             VARCHAR(100) NOT NULL,
  correo_institucional  VARCHAR(150) NOT NULL,
  carrera               VARCHAR(150) NOT NULL,
  nivel                 VARCHAR(50)  NOT NULL,
  periodo_actual        VARCHAR(50)  NOT NULL,
  estado_matricula      VARCHAR(20)  NOT NULL
                         CHECK (estado_matricula IN ('MATRICULADO', 'NO_MATRICULADO')),
  creado_en             TIMESTAMP    NOT NULL DEFAULT NOW()
);
```

## `tickets_verificacion`

El OTP de 6 dígitos que autentica al estudiante por correo antes de mostrarle
el menú (ver endpoints 2 y 3 de `CONTRATO-API.md`).

```sql
CREATE TABLE tickets_verificacion (
  id          SERIAL PRIMARY KEY,
  cedula      VARCHAR(10) NOT NULL REFERENCES estudiantes(cedula),
  ticket      VARCHAR(6)  NOT NULL,
  creado_en   TIMESTAMP   NOT NULL DEFAULT NOW(),
  expira_en   TIMESTAMP   NOT NULL,
  usado       BOOLEAN     NOT NULL DEFAULT FALSE
);
```

## `tipos_tramite`

Catálogo de trámites disponibles. **Agregar un trámite nuevo es una fila en
esta tabla**, no un despliegue de código — esto es lo que hace escalable al
sistema de tickets.

```sql
CREATE TABLE tipos_tramite (
  codigo            VARCHAR(40)  PRIMARY KEY,
  nombre            VARCHAR(150) NOT NULL,
  genera_documento  BOOLEAN      NOT NULL DEFAULT FALSE,
  -- automatizado = TRUE: un workflow lo resuelve solo (como matrícula).
  -- automatizado = FALSE: el workflow solo crea el ticket EN_PROCESO;
  -- lo resuelve manualmente el personal administrativo.
  automatizado      BOOLEAN      NOT NULL DEFAULT FALSE
);

INSERT INTO tipos_tramite (codigo, nombre, genera_documento, automatizado) VALUES
  ('CERTIFICADO_MATRICULA',   'Certificado de Matrícula',    TRUE,  TRUE),
  ('RECORD_ACADEMICO',        'Récord Académico',            TRUE,  FALSE),
  ('CERTIFICADO_VINCULACION', 'Certificado de Vinculación',  TRUE,  FALSE),
  ('ANULACION_MATRICULA',     'Anulación de Matrícula',      FALSE, FALSE);
```

`codigo` usa los mismos valores que `OpcionMenu` en la app
(`estudiante.model.ts`), para que no haga falta mapear nombres entre capas.

## `tickets_solicitud`

El núcleo del sistema de trámites. Cada vez que un estudiante pide algo desde
el menú, se crea un registro aquí — es lo que alimenta la pantalla
**"Consultar estado de mis tickets"** de la app.

```sql
CREATE SEQUENCE tickets_solicitud_seq START 1;

CREATE TABLE tickets_solicitud (
  id                VARCHAR(20) PRIMARY KEY,  -- ej. TCK-2026-000123
  cedula            VARCHAR(10) NOT NULL REFERENCES estudiantes(cedula),
  tipo_tramite      VARCHAR(40) NOT NULL REFERENCES tipos_tramite(codigo),
  estado            VARCHAR(20) NOT NULL DEFAULT 'EN_PROCESO'
                     CHECK (estado IN ('EN_PROCESO', 'COMPLETADO', 'RECHAZADO')),
  fecha_solicitud   TIMESTAMP   NOT NULL DEFAULT NOW(),
  fecha_resolucion  TIMESTAMP,
  observaciones     TEXT
);
```

El `id` se genera en el workflow con:

```sql
'TCK-' || EXTRACT(YEAR FROM NOW()) || '-' || LPAD(nextval('tickets_solicitud_seq')::text, 6, '0')
```

## `certificados_matricula`

Detalle específico **solo** del trámite que genera documento+QR de forma
100% automática. Se relaciona 1:1 con su `ticket_solicitud` (todo certificado
tiene un ticket; no todo ticket tiene un certificado, porque los otros
trámites no generan este tipo de documento).

```sql
CREATE TABLE certificados_matricula (
  id                SERIAL PRIMARY KEY,
  ticket_id         VARCHAR(20)  NOT NULL REFERENCES tickets_solicitud(id),
  codigo_unico      VARCHAR(40)  NOT NULL UNIQUE,
  cedula            VARCHAR(10)  NOT NULL,
  nombre_completo   VARCHAR(150) NOT NULL,
  carrera           VARCHAR(150) NOT NULL,
  nivel             VARCHAR(50)  NOT NULL,
  periodo_actual    VARCHAR(50)  NOT NULL,
  fecha_emision     TIMESTAMP    NOT NULL DEFAULT NOW(),
  url_verificacion  TEXT         NOT NULL,
  UNIQUE (cedula, periodo_actual)
);
```

El `UNIQUE (cedula, periodo_actual)` es la garantía de idempotencia a nivel de
base de datos: es imposible que existan dos certificados distintos para el
mismo estudiante en el mismo periodo, sin importar cuántas veces lo pida ni
desde qué canal (web o app) — requisito confirmado por la coordinación
académica.

El equipo de la web usará esta misma tabla (`codigo_unico`) para el endpoint
público de verificación del QR.
