# Contrato de Webhooks — App de Certificado de Matrícula

Este documento define lo que la app móvil (Ionic) necesita recibir del servidor
(n8n + base de datos). Mientras no exista el backend real, la app funciona con
datos simulados que ya respetan exactamente este contrato — el día que estos
webhooks estén activos, en la app solo se cambia `environment.usarMock = false`
y `environment.n8nBaseUrl`, sin tocar el resto del código.

Ver `ARQUITECTURA.md` para el diseño general (por qué n8n es la API completa,
no solo un consumidor) y `ESQUEMA-BD.md` para el esquema **real** de
PostgreSQL (a partir de 2026-07-20 ya no es un esquema temporal — es el dump
real compartido por el usuario).

Base URL para pruebas locales: `http://localhost:5678/webhook` (ya
configurada en `environment.ts`). Los 7 workflows manejan además el
preflight CORS (`OPTIONS`) — sin eso, el navegador nunca llega a mandar el
POST real y la app se queda sin respuesta.

**Autenticación (header obligatorio):** todos los webhooks POST requieren el
header `X-Api-Key` con el valor configurado en `environment.apiKey` (la app
ya lo agrega automáticamente en cada petición vía `ApiKeyInterceptor`). Sin
este header, n8n responde `403` antes de ejecutar cualquier lógica del
workflow — esto evita que alguien que descubra la URL pública (una vez
desplegada en el VPS) pueda consultar datos de estudiantes o crear
certificados/tickets directamente, sin pasar por la app. El webhook `OPTIONS`
de cada workflow queda sin autenticación (el preflight del navegador no
puede incluir headers personalizados), pero eso solo responde un `204` vacío
sin tocar la base de datos.

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
  "tipoUsuario": "ESTUDIANTE",
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

**Rol Docente (mismo endpoint, misma cédula+OTP, sin login aparte):** si la
cédula no está en `estudiantes`, el workflow busca en `docentes` antes de
responder "no encontrado". Si la encuentra, responde con
`"tipoUsuario": "DOCENTE"` y los campos que no aplican (`carrera`, `nivel`,
`periodoActual`, `estadoMatricula`) van en `null`:

```json
{
  "tipoUsuario": "DOCENTE",
  "cedula": "1710000009",
  "nombres": "PEREZ SANCHEZ PEDRO",
  "apellidos": "",
  "correoInstitucional": "pedro.sanchez@yavirac.edu.ec",
  "carrera": null,
  "nivel": null,
  "periodoActual": null,
  "estadoMatricula": null
}
```

La app usa `tipoUsuario` para decidir qué menú mostrar después del OTP: el
estudiante ve los 3 trámites de siempre; el docente ve únicamente
**"Reportar incidencia en laboratorio"** (ver §8-9). El flujo de cédula +
ticket por correo (endpoints 2 y 3) es idéntico para ambos — por eso no hizo
falta una pantalla de login separada.

`correoInstitucional` es obligatorio: la app lo necesita para el paso de
verificación por correo con ticket (ver endpoints 2 y 3 más abajo).

`estadoMatricula` en la base real admite **4 valores**:
`MATRICULADO | RETIRADO | REPROBADO | APROBADO`. La app y los workflows solo
verifican `=== 'MATRICULADO'`, así que sigue funcionando igual — solo hay
más formas de estar "no matriculado" de las que se asumían antes.

`apellidos` siempre viene como `""` (string vacío): la tabla real
`estudiantes` no tiene una columna de apellidos separada, `nombres` ya trae
el nombre completo (ej. `"NARVAEZ LLAMUCO ANDERSON SEBASTIAN"`).

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

- Generar un ticket numérico de 6 dígitos, guardarlo **hasheado** (nunca en
  texto plano) asociado a la cédula, con expiración de 10 minutos, y enviarlo
  al `correoInstitucional` del estudiante.
- En la base real esto se guarda en `otp_codigos.codigo_hash`, calculado con
  `pgcrypto`: `encode(digest(ticket, 'sha256'), 'hex')`. La verificación
  (endpoint 3) hashea el valor recibido de la misma forma y compara.
- `correoEnmascarado` es solo para mostrarle al estudiante a qué correo se
  envió (ej. `an***@yavirac.edu.ec`), **nunca** devolver el ticket en la
  respuesta de este endpoint en producción (en pruebas con Mailtrap, el
  correo real se ve directo en el buzón de Mailtrap, no hace falta debug).
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
  "codigoUnico": "744c7cb9-ab6f-46ce-9440-3d1da1c54798",
  "cedula": "0102030405",
  "nombreCompleto": "ANDREW CARRERA",
  "carrera": "Ingeniería en Software",
  "nivel": "Octavo Nivel",
  "periodoActual": "Abril 2026 - Agosto 2026",
  "modalidad": "DUAL",
  "fechaEmision": "15 de julio de 2026",
  "urlVerificacion": "https://verificacion.tudominio.edu.ec/certificados/744c7cb9-ab6f-46ce-9440-3d1da1c54798"
}
```

Reglas importantes para el backend:

- `codigoUnico` **es el UUID real de `qr_codigos.identificador`**
  (`gen_random_uuid()`), no un código corto inventado — así es como lo genera
  la base de datos real, y esa columna tiene **UNIQUE a nivel de base de
  datos** (`qr_codigos_identificador_key`), así que un QR repetido es
  literalmente imposible de insertar, sin importar qué cliente escriba.
- Cada vez que se genera un certificado, el backend guarda una fila en
  `qr_codigos` y otra en `certificados` (ver `ESQUEMA-BD.md`) para que el
  sistema web pueda validar el QR contra la base de datos cuando alguien lo
  escanee.
- Si la cédula no existe, o el estudiante no tiene `estadoMatricula = "MATRICULADO"`,
  el backend responde con error (ver abajo) — la app no debería poder
  generar un certificado para alguien no matriculado.
- `urlVerificacion` es la URL del sistema web (del equipo de la web) donde
  cualquiera puede escanear el QR y validar que el certificado es auténtico.
- **Idempotencia: ahora forzada también por la base de datos.** La tabla
  `certificados` tiene `UNIQUE(estudiante_id, periodo_lectivo_codigo)`
  (constraint `ux_certificado_estudiante_periodo`), agregada en esta
  instancia local (ver nota 7 en `ESQUEMA-BD.md` sobre el dump original con
  duplicados históricos). El workflow **sigue haciendo el chequeo "¿ya
  existe?"** antes de insertar — no por necesidad de la BD, sino para poder
  responder con el certificado existente en vez de un error 500 — pero ahora
  la base de datos también lo garantiza ante una condición de carrera (app y
  web escribiendo casi al mismo tiempo).
- Este trámite es el único **100% automatizado** del menú (ver
  `ARQUITECTURA.md`). A diferencia de los demás trámites, **no crea una fila
  en `tickets`** — en el esquema real, `tipos_solicitud.genera_ticket = false`
  para `CERT_MATRICULA`, así que el certificado de matrícula nunca aparece en
  "Consultar estado de mis tickets" (endpoint 5); se rastrea únicamente vía
  `certificados`/`qr_codigos`.
- **Este endpoint YA NO envía el correo al estudiante.** Solo crea el
  registro y devuelve los datos. El PDF real (con el membrete oficial) lo
  genera la app en el navegador con `certificado-pdf.service.ts`, y luego lo
  envía al endpoint `/enviar-certificado-pdf` (ver §4.1) para que n8n lo
  adjunte y lo mande por correo. Ver también §7.1.
- **Aviso informativo a los encargados de certificados**: cada vez que se
  crea un certificado **nuevo** (no en la re-consulta de uno existente por
  idempotencia), el workflow envía un correo informativo a quienes tengan el
  rol `RESP_CERTIFICADOS` en `usuarios_panel` (hoy dos contactos placeholder,
  pendientes de reemplazar por los reales). Es solo informativo — no bloquea
  ni depende de nada; si falla el envío, la respuesta al webhook no se ve
  afectada (`onError: continueRegularOutput`, mismo patrón que el resto de
  notificaciones del proyecto).

### Response — 400 (no matriculado / cédula inválida)

```json
{
  "error": "El estudiante no está matriculado en el periodo actual."
}
```

---

## 4.1 Enviar certificado en PDF por correo

Se dispara automáticamente desde la app justo después de recibir la
respuesta de `/generar-certificado-matricula`: la app genera el PDF real
(con el membrete oficial y el QR) en el navegador usando
`certificado-pdf.service.ts`, lo convierte a base64, y lo envía a este
endpoint para que n8n lo adjunte y lo mande por correo institucional.

**POST** `/enviar-certificado-pdf`

### Request

```json
{
  "cedula": "0102030405",
  "codigoUnico": "744c7cb9-ab6f-46ce-9440-3d1da1c54798",
  "pdfBase64": "JVBERi0xLjcKJ...   (base64 del PDF, SIN el prefijo data:application/pdf;base64,)"
}
```

### Response — 200 OK

```json
{ "enviado": true }
```

### Response — 404 (no coincide cédula + codigoUnico)

```json
{ "error": "No se encontró un certificado con esa cédula y código." }
```

Reglas importantes:

- El workflow (`workflow-enviar-certificado-pdf.json`) **verifica en la BD**
  que ese `codigoUnico` realmente pertenece a esa `cedula` (join
  `certificados` + `qr_codigos` + `estudiantes`) antes de enviar nada — así
  no se puede usar este endpoint para mandar un PDF arbitrario a cualquier
  correo.
- El PDF llega en base64 y se convierte a un adjunto binario real
  (`Attachments (File)` del nodo Send Email) — no es una imagen incrustada,
  es el archivo PDF completo generado por `certificado-pdf.service.ts`.
- Si este envío falla (SMTP caído, credencial mal puesta), la app avisa al
  estudiante en el chat pero **no revierte la generación del certificado**
  — el certificado y el QR ya quedaron guardados en la BD por
  `/generar-certificado-matricula`, que es una llamada aparte.

---

## 5. Consultar estado de mis tickets

Alimenta la pantalla "Consultar estado de mis tickets" del menú. Devuelve el
historial de trámites **manuales** del estudiante (hoy solo Anulación de
Matrícula) — el Certificado de Matrícula nunca aparece aquí, ver nota en el
endpoint 4.

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
    "id": "TK-000017",
    "tipo": "Anulación de Matrícula",
    "estado": "EN_PROCESO",
    "fechaSolicitud": "10 de julio de 2026"
  }
]
```

`estado` que envía la app solo admite `"EN_PROCESO"` o `"COMPLETADO"` (no
existe `"RECHAZADO"` en el esquema real). El workflow traduce los estados
reales de la tabla `tickets` (`Pendiente`/`En Proceso` → `EN_PROCESO`,
`Resuelto` → `COMPLETADO`). Si el estudiante no tiene tickets, responder
`200` con `[]` (no `null`, no error). `id` es el `codigo` real del ticket
(`TK-XXXXXX`), no un formato inventado.

**Cómo llega un ticket a `COMPLETADO`**: automáticamente, sin panel
administrativo ni intervención manual — ver "Workflows internos" más abajo
(`detectar-respuesta-ticket`). Este endpoint no cambió en nada para
soportarlo: simplemente lee `tickets.estado` en el momento de la consulta,
así que refleja el cambio apenas ocurre, sin ningún ajuste de código.

---

## Workflows internos (sin endpoint HTTP)

No todos los workflows de n8n exponen un webhook — algunos se disparan por
otro tipo de evento y no forman parte del "contrato" que llama la app
directamente, pero sí modifican datos que la app luego lee.

### `detectar-respuesta-ticket`

Disparado por **Gmail Trigger** (no por la app) sobre la casilla
`tramites@yavirac.edu.ec`: cuando Secretaría responde el correo de aviso de
un ticket (identificado por `[TK-XXXXXX]` en el asunto, ver §6), y el
remitente es un responsable autorizado para ese trámite, marca
`tickets.estado = 'Resuelto'` y registra el evento `TicketResuelto`. Ver
`PROPUESTA-CIERRE-AUTOMATICO-TICKETS.md` para el diseño completo. No
requiere ningún cambio en la app — el efecto se ve la próxima vez que se
llama a `/consultar-tickets` (endpoint 5).

---

## 6. Crear ticket de solicitud (Anulación de Matrícula)

Endpoint para registrar la solicitud de anulación de matrícula. Solo registra
el ticket en estado `EN_PROCESO`; lo resuelve manualmente el personal
administrativo (fuera del alcance de esta app).

> Este es el **único trámite manual (basado en ticket)** implementado en la
> app. Récord Académico y Certificado de Vinculación están fuera del
> alcance del proyecto y no se exponen en el menú. El Reseteo de Contraseña
> de Correo Institucional **ya no usa este endpoint** — es 100% automático,
> ver §6.1. El catálogo `tipos_solicitud` renombró el código viejo a
> `RESET_CORREO_LEGACY_DEPRECADO` específicamente para que este endpoint
> **no pueda volver a crear un ticket de reseteo** aunque alguien lo llame
> directo con `tipoTramite: "RESET_CORREO"` (responde 400, verificado con
> curl) — el ticket histórico `TK-000005` de antes del cambio queda intacto,
> solo se bloquearon los nuevos.

**POST** `/crear-ticket-solicitud`

### Request

```json
{
  "cedula": "0102030405",
  "tipoTramite": "ANULACION_MATRICULA"
}
```

`tipoTramite` debe ser `ANULACION_MATRICULA` — cualquier otro valor responde
400. El workflow también asigna automáticamente un `responsable_id` (vía
`asignaciones_responsables`) y registra los eventos
`TicketCreado`/`TicketAsignado` en la tabla `eventos`, igual que hace el
resto del sistema real, para que el panel administrativo se entere.

**Idempotencia:** si el estudiante ya tiene un ticket **activo** (`estado`
`Pendiente` o `En Proceso`) del mismo tipo de trámite, el workflow **no crea
uno nuevo** — devuelve el ticket existente (mismo `id`/`codigo`) y no repite
el correo ni los eventos. Esto evita que la misma solicitud de anulación se
registre dos veces y sature con notificaciones duplicadas al responsable
asignado. También está forzado por la base de datos:
`UNIQUE(estudiante_id, tipo_solicitud_id) WHERE estado IN ('Pendiente',
'En Proceso')` (constraint `ux_ticket_estudiante_tipo_activo`). Si el ticket
anterior ya fue `Resuelto`, sí se permite crear uno nuevo (por ejemplo, para
un periodo distinto).

**Notificación al responsable:** además de guardar `responsable_id` (vía
`asignaciones_responsables`), el workflow busca su correo real en
`usuarios_panel.correo` y le envía un aviso por correo con los datos del
ticket (estudiante, cédula, carrera, código de ticket). Así la secretaría
encargada se entera de la solicitud sin depender de revisar el panel
administrativo manualmente. Esta notificación corre en una rama aparte —
si no hay responsable asignado, o si el envío falla, no afecta la creación
del ticket ni la respuesta al webhook. **Pendiente:** `usuarios_panel` hoy
tiene un correo de prueba ("Juan Pérez") — hay que reemplazarlo por el
correo institucional real de quien procesa Anulación de Matrícula en cuanto
se confirme con la coordinación académica.

### Response — 200 OK

```json
{
  "id": "TK-000017",
  "tipo": "Anulación de Matrícula",
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

## 6.1 Resetear contraseña de correo institucional (automático)

**A diferencia de todos los demás trámites manuales, este es 100%
automático** — no crea ticket, no requiere aprobación humana. Ver
`PROPUESTA-RESET-CORREO-AUTOMATICO.md` para el diseño completo y las
razones del cambio (requerimiento específico de la tutora).

**POST** `/resetear-contrasena-correo`

### Request

```json
{ "cedula": "0102030405" }
```

### Response — 200 OK

```json
{
  "estado": "RESETEADO",
  "correoNotificado": "andrew.carrera@yavirac.edu.ec",
  "mensaje": "Tu contraseña fue reseteada. Revisa tu correo institucional para ver la nueva contraseña temporal."
}
```

La nueva contraseña **nunca** viaja en esta respuesta — solo se envía por
correo institucional (ver workflow).

### Response — 403 (no verificó su identidad recientemente)

```json
{ "error": "Debes verificar tu identidad nuevamente antes de continuar." }
```

El backend exige que el estudiante haya validado su OTP (`/verificar-ticket`)
en los últimos 20 minutos — reutiliza `otp_codigos.usado` en vez de crear un
mecanismo de sesión nuevo. Sin esta prueba, cualquiera que conociera la
cédula de un estudiante podría resetear su correo sin haber pasado por el
OTP; con esto, no.

### Response — 404 (cédula no encontrada)

```json
{ "error": "Estudiante no encontrado." }
```

### Response — 429 (ya reseteó hace poco)

```json
{ "error": "Ya reseteaste tu contraseña recientemente. Intenta de nuevo en unos minutos." }
```

Cooldown de 15 minutos entre reseteos exitosos por cédula, para no saturar
la cuenta de servicio de Google ni permitir abuso.

### Response — 502 (falló el proveedor de identidad)

```json
{ "error": "No se pudo completar el reseteo en este momento. Intenta más tarde." }
```

Esta respuesta **no crea nada** en la base de datos — el estudiante
simplemente reintenta desde el chat. Es el estado esperado mientras la
credencial real de Google Workspace no esté configurada en n8n (ver
`PROPUESTA-RESET-CORREO-AUTOMATICO.md` §5).

---

## Base de datos

Ver `ESQUEMA-BD.md` para el esquema real completo (`estudiantes`, `carreras`,
`periodos_academicos`, `otp_codigos`, `tickets`, `tipos_solicitud`,
`certificados`, `qr_codigos`, `asignaciones_responsables`, `eventos`) y cómo
se relacionan.

---

## Carpeta `workflows/`

Contiene workflows de n8n listos para **importar** (`Import from File` en
n8n) como punto de partida:

- `workflow-consultar-estudiante.json`
- `workflow-enviar-ticket-verificacion.json`
- `workflow-verificar-ticket.json`
- `workflow-generar-certificado.json`
- `workflow-enviar-certificado-pdf.json`
- `workflow-consultar-tickets.json`
- `workflow-crear-ticket-solicitud.json`
- `workflow-consultar-laboratorios.json`
- `workflow-reportar-incidencia-laboratorio.json`

Todos usan un nodo Postgres como ejemplo — si la base de datos es MySQL, SQL
Server u otra, solo hay que reemplazar ese nodo por el equivalente y ajustar
las credenciales y el nombre real de las tablas/columnas. El de enviar ticket
usa un nodo de envío de correo genérico (`Send Email` / SMTP) que también hay
que configurar con las credenciales reales del correo institucional.

---

## 7. Correos institucionales automáticos

**Certificado de matrícula (§7.1):** ya NO lo envía
`workflow-generar-certificado.json` directamente. Lo envía
`workflow-enviar-certificado-pdf.json`, que la app llama justo después,
una vez que generó el PDF real en el navegador. Si ese segundo envío falla,
la respuesta de `/generar-certificado-matricula` ya se recibió y el
certificado ya quedó guardado — solo falla el correo, no la generación.

**Confirmación de ticket (§7.2):** corre en paralelo a `Responder: ...` desde
el mismo nodo `Formatear Respuesta` de `workflow-crear-ticket-solicitud.json`,
y además tiene `onError: continueRegularOutput` en el nodo de correo — así,
si el SMTP falla (se detectó esto en pruebas: Mailtrap sandbox devuelve
`550 Too many emails per second` al superar su límite de plan gratuito), la
respuesta al webhook **no se rompe**: el ticket ya se guardó en la BD antes
de intentar el correo, así que el estudiante igual recibe su ticket creado
aunque el correo de confirmación falle.

### 7.1 Correo del certificado de matrícula (con PDF real adjunto)

**Quién lo envía:** `workflow-enviar-certificado-pdf.json` — nodo
`"Enviar PDF por Correo (SMTP)"`. Ver endpoint §4.1 para el detalle completo
del flujo (la app genera el PDF, lo manda en base64, n8n solo verifica y
adjunta).

**Destinatario:** `correo` del estudiante (columna real de `estudiantes`).

**Asunto:** `Tu Certificado de Matrícula YAVIRAC — <periodoActual>`

**Contenido:** correo HTML breve + el **PDF real adjunto** (archivo binario,
no una imagen incrustada), generado por `certificado-pdf.service.ts` con el
membrete oficial, formato justificado y todos los datos reales del
estudiante (incluida la `modalidad` real, ya no un texto fijo "modalidad
dual").

### 7.2 Correo de confirmación de ticket (Anulación de Matrícula)

**Quién lo envía:** `workflow-crear-ticket-solicitud.json` — nodo
`"Enviar Confirmación por Correo"`.

**Destinatario:** `correo` del estudiante.

**Asunto:** `Confirmación de Solicitud — <tipoTramite> | <idTicket>`

**Contenido:** HTML institucional con el número de ticket, tipo de trámite,
estado (`En proceso`), fecha de solicitud y aviso de plazo (3-5 días hábiles).

### 7.3 Cómo activar los correos para pruebas con Mailtrap

1. Crear una bandeja de pruebas en Mailtrap (sandbox) y copiar su host,
   puerto, usuario y contraseña SMTP.
2. En n8n: Settings → Credentials → New → SMTP, pegar esos datos.
3. En cada workflow, abrir el nodo `emailSend` (`Enviar Correo (SMTP)`,
   `Enviar PDF por Correo (SMTP)`, `Enviar Confirmación por Correo`) y
   seleccionar esa credencial (reemplazar el placeholder `"id": "REEMPLAZAR"`).
4. Ajustar `fromEmail` si quieres un remitente distinto (Mailtrap no valida
   el remitente en modo sandbox).
5. Los correos van a llegar a la bandeja de Mailtrap, no al correo real del
   estudiante — es justo lo que se necesita para probar sin mandar correos
   de verdad a estudiantes reales.

---

## 8. Consultar laboratorios

Alimenta el paso "elige un laboratorio" del flujo de Reportar Incidencia
(rol Docente). Catálogo fijo, no depende de la cédula.

**POST** `/consultar-laboratorios`

### Request

```json
{}
```

### Response — 200 OK

```json
[
  { "codigo": "LAB-01", "nombre": "Laboratorio de Tolouse" },
  { "codigo": "LAB-02", "nombre": "Laboratorio de Xian" }
]
```

---

## 9. Reportar incidencia de laboratorio

Solo para el rol Docente — la app la habilita únicamente cuando
`/consultar-estudiante` respondió `tipoUsuario: "DOCENTE"`. El backend
**vuelve a validar** que la cédula sea de un docente real antes de guardar
nada (no confía en que el cliente ya lo verificó).

**POST** `/reportar-incidencia-laboratorio`

### Request

```json
{
  "cedula": "1710000009",
  "laboratorioCodigo": "LAB-02",
  "descripcion": "El monitor del puesto 5 no enciende."
}
```

`fotoBase64`/`fotoMime` son **opcionales** — se incluyen solo si el docente
adjuntó una foto en la app:

```json
{
  "cedula": "1710000009",
  "laboratorioCodigo": "LAB-02",
  "descripcion": "El monitor del puesto 5 no enciende.",
  "fotoBase64": "/9j/4AAQSkZJRgABAQAAAQABAAD...",
  "fotoMime": "image/jpeg"
}
```

- `fotoBase64` — el archivo codificado en base64, **sin** el prefijo
  `data:image/...;base64,` (la app ya lo recorta antes de enviarlo).
- `fotoMime` — `"image/jpeg"` o `"image/png"` únicamente (mismo CHECK que
  `adjuntos.mime` en la base de datos). Cualquier otro valor se trata como
  `image/jpeg` por defecto en el workflow.
- Tamaño máximo validado del lado de la app antes de enviar: **5MB**
  (coincide con el CHECK `tamano_bytes <= 5242880` de `adjuntos`); el
  workflow no vuelve a validar el tamaño del lado del servidor.

### Response — 200 OK

```json
{
  "codigo": "AL-000001",
  "laboratorio": "LAB-02",
  "descripcion": "El monitor del puesto 5 no enciende.",
  "estado": "Pendiente",
  "fechaReporte": "20 de julio de 2026",
  "tieneFoto": true
}
```

`tieneFoto` refleja si el reporte quedó con una foto adjunta (`true`) o no
(`false`) — la app la usa solo para mostrar un indicador, no trae la URL de
la imagen (el panel administrativo es quien la consulta).

### Response — 404 (cédula no es de un docente válido)

```json
{ "error": "No se encontró un docente con esa cédula." }
```

### Response — 400 (código de laboratorio inválido)

```json
{ "error": "Laboratorio no válido." }
```

Reglas importantes:

- `alertas.profesor_id` (quién reportó) es un id de `usuarios_panel`, **no**
  de `docentes` — así funciona el sistema real: cada docente importado tiene
  también una cuenta de `usuarios_panel` con rol `PROFESOR`, y el workflow
  cruza por cédula para resolverlo (`Buscar Docente Válido`). Si un docente
  existe solo en `docentes` sin esa cuenta, el endpoint responde 404 — es
  una limitación real del esquema, no un bug.
- El responsable se resuelve vía `asignaciones_responsables` (tipo
  `ALERTA_LAB`, sin filtro de carrera — las incidencias no son por carrera)
  y recibe un correo de aviso (mismo patrón que §7.2: `onError:
  continueRegularOutput`, un fallo de correo no rompe el reporte ya
  guardado).
- Adjuntar foto es opcional. Si no se envía `fotoBase64`, `adjuntos` no se
  toca y `alertas.adjunto_id` queda `NULL`. Si se envía, el workflow la
  escribe en disco (volumen `uploads_data`, ver `ARQUITECTURA.md` §"Fotos de
  incidencias") y solo entonces inserta la fila en `adjuntos` y enlaza
  `adjunto_id` — nunca se guarda el binario en Postgres.
- No hay límite de incidencias simultáneas por docente (a diferencia de
  Anulación de Matrícula) — cada incidencia es un evento distinto, un
  docente puede reportar varias sin que una bloquee a la otra.

