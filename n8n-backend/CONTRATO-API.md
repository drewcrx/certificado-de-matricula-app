# Contrato de Webhooks — App de Certificado de Matrícula

Este documento define lo que la app móvil (Ionic) necesita recibir del servidor
(n8n + base de datos). Mientras no exista el backend real, la app funciona con
datos simulados que ya respetan exactamente este contrato — el día que estos
webhooks estén activos, en la app solo se cambia `environment.usarMock = false`
y `environment.n8nBaseUrl`, sin tocar el resto del código.

Ver `ARQUITECTURA.md` para el diseño general (por qué n8n es la API completa,
no solo un consumidor) y `ESQUEMA-BD.md` para todas las tablas.

Base URL sugerida: `https://TU-INSTANCIA-N8N.example.com/webhook`

---

## 1. Consultar estudiante por cédula

Se usa cuando el "robot" (YaviBot) recibe la cédula escrita por el estudiante y
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
- Este trámite es el único **100% automatizado** del menú (ver
  `ARQUITECTURA.md`). Al generarse, además de la fila en
  `certificados_matricula`, el workflow crea un `ticket_solicitud` asociado
  con `estado = 'COMPLETADO'`, para que aparezca en "Consultar estado de mis
  tickets" (endpoint 5) igual que cualquier otro trámite.

### Response — 400 (no matriculado / cédula inválida)

```json
{
  "error": "El estudiante no está matriculado en el periodo actual."
}
```

---

## 5. Consultar estado de mis tickets

Alimenta la pantalla "Consultar estado de mis tickets" del menú. Devuelve el
historial completo de trámites del estudiante (matrícula, récord académico,
vinculación, anulación — todos los tipos), más reciente primero.

**POST** `/consultar-tickets`

### Request

```json
{
  "cedula": "0102030405"
}
```

### Response — 200 OK

```json
[
  {
    "id": "TCK-2026-000123",
    "tipo": "Récord Académico",
    "estado": "EN_PROCESO",
    "fechaSolicitud": "10 de julio de 2026"
  },
  {
    "id": "MAT-2026-9F3K7QZP",
    "tipo": "Certificado de Matrícula",
    "estado": "COMPLETADO",
    "fechaSolicitud": "15 de julio de 2026"
  }
]
```

`estado` solo admite `"EN_PROCESO"`, `"COMPLETADO"` o `"RECHAZADO"`. Si el
estudiante no tiene tickets, responder `200` con `[]` (no `null`, no error).

---

## 6. Crear ticket de solicitud (trámites sin automatizar)

Endpoint **genérico** para los trámites que todavía no tienen lógica
automática propia (Récord Académico, Certificado de Vinculación, Anulación de
Matrícula). Solo registra el ticket en estado `EN_PROCESO`; lo resuelve
manualmente el personal administrativo (fuera del alcance de esta app). Ver
`ARQUITECTURA.md` → "Trámites: automáticos vs. manuales".

> Nota: la app todavía no llama este endpoint — esas 3 opciones del menú
> siguen marcadas `disponible: false` ("en construcción"). El backend ya
> queda listo para cuando se conecten (Fase 2 del roadmap); ese cambio en la
> app es pequeño y se hace por separado.

**POST** `/crear-ticket-solicitud`

### Request

```json
{
  "cedula": "0102030405",
  "tipoTramite": "RECORD_ACADEMICO"
}
```

`tipoTramite` debe ser uno de los `codigo` definidos en la tabla
`tipos_tramite` (`ESQUEMA-BD.md`): `RECORD_ACADEMICO`,
`CERTIFICADO_VINCULACION`, `ANULACION_MATRICULA` (o cualquier trámite nuevo
que se agregue ahí a futuro — este endpoint no necesita cambiar).

### Response — 200 OK

```json
{
  "id": "TCK-2026-000124",
  "tipo": "Récord Académico",
  "estado": "EN_PROCESO",
  "fechaSolicitud": "16 de julio de 2026"
}
```

### Response — 400 (cédula o tipoTramite inválido)

```json
{
  "error": "Tipo de trámite no reconocido."
}
```

---

## Base de datos

Ver `ESQUEMA-BD.md` para las tablas completas (`estudiantes`,
`tickets_verificacion`, `tipos_tramite`, `tickets_solicitud`,
`certificados_matricula`) y cómo se relacionan.

---

## Carpeta `workflows/`

Contiene workflows de n8n listos para **importar** (`Import from File` en
n8n) como punto de partida:

- `workflow-consultar-estudiante.json`
- `workflow-enviar-ticket-verificacion.json`
- `workflow-verificar-ticket.json`
- `workflow-generar-certificado.json`
- `workflow-consultar-tickets.json`
- `workflow-crear-ticket-solicitud.json`

Todos usan un nodo Postgres como ejemplo — si la base de datos es MySQL, SQL
Server u otra, solo hay que reemplazar ese nodo por el equivalente y ajustar
las credenciales y el nombre real de las tablas/columnas. El de enviar ticket
usa un nodo de envío de correo genérico (`Send Email` / SMTP) que también hay
que configurar con las credenciales reales del correo institucional.
