# Contrato de Webhooks — App de Certificado de Matrícula

Este documento define lo que la app móvil (Ionic) necesita recibir del servidor
(n8n + base de datos). Mientras no exista el backend real, la app funciona con
datos simulados que ya respetan exactamente este contrato — el día que estos
webhooks estén activos, en la app solo se cambia `environment.usarMock = false`
y `environment.n8nBaseUrl`, sin tocar el resto del código.

Base URL sugerida: `https://TU-INSTANCIA-N8N.example.com/webhook`

---

## 1. Consultar estudiante por cédula

Se usa cuando el "robot" (Yavirac) recibe la cédula escrita por el estudiante y
necesita saber quién es y si existe en la base de datos.

**POST** `/consultar-estudiante`

### Request

```json
{
  "cedula": "0102030405"
}
```

### Response — 200 OK (estudiante encontrado)

```json
{
  "cedula": "0102030405",
  "nombres": "Andrew",
  "apellidos": "Carrera",
  "correoInstitucional": "andrew.carrera@yavirac.edu.ec",
  "carrera": "Ingeniería en Software",
  "nivel": "Octavo Nivel",
  "periodoActual": "Abril 2026 - Agosto 2026",
  "estadoMatricula": "MATRICULADO"
}
```

`correoInstitucional` es obligatorio: la app lo necesita para el paso de
verificación por correo con ticket (ver endpoints 2 y 3 más abajo).

`estadoMatricula` solo admite dos valores: `"MATRICULADO"` o `"NO_MATRICULADO"`.

### Response — 200 OK, body `null` (no encontrado)

```json
null
```

Importante: para este endpoint el backend **siempre debe responder 200**, incluso
cuando la cédula no existe — la diferencia la marca el body (`null`). La app
actual (`estudiante.service.ts`) solo distingue "no encontrado" cuando recibe
un 200 con `null`; si el webhook responde con un código de error (4xx/5xx) la
app lo interpretará como una falla técnica y mostrará un mensaje genérico, no
"cédula no encontrada". Si más adelante se prefiere usar 404 para "no
encontrado", avísame para ajustar el manejo de errores en la app.

---

## 2. Enviar ticket de verificación por correo

Se dispara automáticamente apenas la app identifica al estudiante por su
cédula (endpoint 1). Antes de mostrarle el menú de opciones, se le pide
verificar su identidad con un **ticket** de 6 dígitos enviado a su correo
institucional.

**POST** `/enviar-ticket-verificacion`

### Request

```json
{
  "cedula": "0102030405"
}
```

### Response — 200 OK

```json
{
  "correoEnmascarado": "an***@yavirac.edu.ec"
}
```

Reglas importantes para el backend:

- Generar un ticket numérico (recomendado 6 dígitos), guardarlo asociado a la
  cédula (idealmente con una expiración corta, ej. 5-10 minutos) y enviarlo al
  `correoInstitucional` del estudiante (obtenido en el endpoint 1).
- `correoEnmascarado` es solo para mostrarle al estudiante a qué correo se
  envió (ej. `an***@yavirac.edu.ec`), **nunca** devolver el ticket en la
  respuesta de este endpoint en producción.
- Si la cédula no existe, responder con error (4xx).

---

## 3. Verificar ticket

**POST** `/verificar-ticket`

### Request

```json
{
  "cedula": "0102030405",
  "ticket": "483920"
}
```

### Response — 200 OK

```json
{
  "valido": true
}
```

`valido: false` si el ticket no coincide o ya expiró. La app solo muestra el
menú de opciones cuando este endpoint responde `valido: true`.

---

## 4. Generar certificado de matrícula

Se dispara cuando el estudiante, ya identificado, presiona
**"Generar certificado de matrícula"**. Aquí es donde se crea el **código único
e irrepetible** que luego se convierte en QR.

**POST** `/generar-certificado-matricula`

### Request

```json
{
  "cedula": "0102030405"
}
```

### Response — 200 OK

```json
{
  "codigoUnico": "MAT-2026-9F3K7QZP",
  "cedula": "0102030405",
  "nombreCompleto": "Andrew Carrera",
  "carrera": "Ingeniería en Software",
  "nivel": "Octavo Nivel",
  "periodoActual": "Abril 2026 - Agosto 2026",
  "fechaEmision": "15 de julio de 2026",
  "urlVerificacion": "https://verificacion.tudominio.edu.ec/certificados/MAT-2026-9F3K7QZP"
}
```

Reglas importantes para el backend:

- `codigoUnico` debe ser **irrepetible** (UUID, o un código corto + verificación
  de que no exista ya en la tabla de certificados antes de insertarlo).
- Cada vez que se genera un certificado, el backend debe **guardar el registro**
  en una tabla (ver propuesta abajo) para que el sistema web pueda validar el QR
  contra la base de datos cuando alguien lo escanee.
- Si la cédula no existe, o el estudiante tiene `estadoMatricula = "NO_MATRICULADO"`,
  el backend debe responder con un error (ver abajo) — la app no debería poder
  generar un certificado para alguien no matriculado.
- `urlVerificacion` es la URL del sistema web (del equipo de la web) donde
  cualquiera puede escanear el QR y validar que el certificado es auténtico.
- **Idempotencia (requisito confirmado por la coordinación académica):** antes
  de generar un `codigoUnico` nuevo, el backend debe consultar si ya existe un
  certificado para esa `cedula` + `periodoActual` en la tabla
  `certificados_matricula`. Si ya existe, **debe devolver ese mismo registro**
  (mismo `codigoUnico`, mismo QR) en vez de crear uno nuevo. Esto evita que un
  mismo estudiante termine con dos QR distintos si genera el certificado una
  vez desde la web y otra vez desde la app — sin importar el canal, el
  resultado debe ser siempre el mismo código verificable. (La app ya simula
  este comportamiento en modo mock: generar el certificado dos veces para el
  mismo estudiante devuelve el mismo QR).

### Response — 400 (no matriculado / cédula inválida)

```json
{
  "error": "El estudiante no está matriculado en el periodo actual."
}
```

---

## Tabla sugerida para persistir certificados emitidos

```sql
CREATE TABLE certificados_matricula (
  id               SERIAL PRIMARY KEY,
  codigo_unico     VARCHAR(40) NOT NULL UNIQUE,
  cedula           VARCHAR(10) NOT NULL,
  nombre_completo  VARCHAR(150) NOT NULL,
  carrera          VARCHAR(150) NOT NULL,
  nivel            VARCHAR(50) NOT NULL,
  periodo_actual   VARCHAR(50) NOT NULL,
  fecha_emision    TIMESTAMP NOT NULL DEFAULT NOW(),
  url_verificacion TEXT NOT NULL,
  UNIQUE (cedula, periodo_actual)
);
```

El `UNIQUE (cedula, periodo_actual)` es justamente lo que garantiza la regla
de idempotencia de arriba a nivel de base de datos: es imposible que existan
dos certificados distintos para el mismo estudiante en el mismo periodo, sin
importar cuántas veces lo pida ni desde qué canal (web o app).

El equipo de la web usará esta misma tabla (`codigo_unico`) para el endpoint
de verificación pública del QR.

---

## Tabla sugerida para los tickets de verificación por correo

```sql
CREATE TABLE tickets_verificacion (
  id          SERIAL PRIMARY KEY,
  cedula      VARCHAR(10) NOT NULL,
  ticket      VARCHAR(6) NOT NULL,
  creado_en   TIMESTAMP NOT NULL DEFAULT NOW(),
  expira_en   TIMESTAMP NOT NULL,
  usado       BOOLEAN NOT NULL DEFAULT FALSE
);
```

Recomendación: al generar un ticket nuevo para una cédula, invalidar
(`usado = TRUE` o eliminar) los tickets anteriores de esa misma cédula, para
que solo el último enviado sea válido.

---

## Carpeta `workflows/`

Contiene workflows de n8n listos para **importar** (`Import from File` en
n8n) como punto de partida:

- `workflow-consultar-estudiante.json`
- `workflow-enviar-ticket-verificacion.json`
- `workflow-verificar-ticket.json`
- `workflow-generar-certificado.json`

Todos usan un nodo Postgres como ejemplo — si la base de datos es MySQL, SQL
Server u otra, solo hay que reemplazar ese nodo por el equivalente y ajustar
las credenciales y el nombre real de las tablas/columnas. El de enviar ticket
usa un nodo de envío de correo genérico (`Send Email` / SMTP) que también hay
que configurar con las credenciales reales del correo institucional.
