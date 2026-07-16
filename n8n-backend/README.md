# Propuesta de backend (n8n) — App de Certificado de Matrícula

Esto es una **propuesta de punto de partida** para el equipo de backend/web,
generada desde el lado de la app móvil para que ambos equipos avancen sobre el
mismo contrato de datos. No reemplaza su diseño de base de datos: solo
describe qué necesita recibir la app y sugiere una forma de implementarlo.

## Contenido

- **`CONTRATO-API.md`** — la especificación de los 4 webhooks que la app
  necesita (request/response exactos, ya usados por el mock de la app).
- **`workflows/workflow-consultar-estudiante.json`** — recibe una cédula,
  consulta la base de datos y responde con los datos del estudiante (o `null`
  si no existe).
- **`workflows/workflow-enviar-ticket-verificacion.json`** — genera un ticket
  de 6 dígitos, lo guarda con expiración y lo envía por correo al
  `correoInstitucional` del estudiante (nodo SMTP, hay que configurar
  credenciales de correo reales).
- **`workflows/workflow-verificar-ticket.json`** — valida que el ticket
  ingresado exista, no haya expirado y no se haya usado antes; lo marca como
  usado si es válido.
- **`workflows/workflow-generar-certificado.json`** — valida que el
  estudiante esté matriculado, **revisa primero si ya existe un certificado
  para esa cédula+periodo** (idempotencia: mismo QR sin importar si se pidió
  desde la web o desde la app) y solo si no existe genera uno nuevo.

## Cómo importar en n8n

1. Abrir n8n → `Workflows` → `Import from File` (o arrastrar cada `.json`).
2. En los nodos Postgres (o el que corresponda a su motor de base de datos),
   configurar las credenciales reales.
3. En `workflow-enviar-ticket-verificacion.json`, configurar además las
   credenciales SMTP del correo que enviará los tickets.
4. Ajustar nombre de tabla/columnas si no coinciden con el esquema real
   (`estudiantes`, `tickets_verificacion`, `certificados_matricula`).
5. Activar los 4 workflows y copiar la URL base de los webhooks.
6. Pasarme esa URL base — en la app solo hay que cambiar
   `environment.n8nBaseUrl` y `environment.usarMock = false`.

## Notas

- El código único (`codigoUnico`) en el workflow de ejemplo se genera con
  `Math.random()` por simplicidad. En producción se recomienda un UUID.
- La **idempotencia es un requisito confirmado**, no opcional: dos personas
  (o la misma persona desde dos canales distintos) haciendo el mismo trámite
  deben terminar viendo el mismo QR. Por eso la tabla `certificados_matricula`
  sugiere `UNIQUE(cedula, periodo_actual)` y el workflow busca antes de crear.
- Las tablas sugeridas (`certificados_matricula`, `tickets_verificacion`) están
  en `CONTRATO-API.md` — el equipo de la web usará la primera para el endpoint
  público de verificación del QR.
- Estos workflows son una base editable, no un producto terminado: cámbienlos
  con libertad según cómo esté modelada la base de datos real.
