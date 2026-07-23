# Backend (n8n) — App de Certificado de Matrícula

Esta es la **API propia de la app móvil** (YaviBot), construida enteramente
en n8n — sin servidor intermedio (Express/NestJS/etc.). Cada workflow con un
nodo Webhook es un endpoint HTTP; la lógica de negocio vive en los nodos
(Code, IF, Postgres), no en una capa de código aparte. Es independiente de
la que use el equipo de la web — ambas comparten la misma base de datos
PostgreSQL.

**Empieza por `ARQUITECTURA.md`** — explica por qué n8n es la API completa,
cómo están organizados los workflows por dominio, la seguridad implementada
y el checklist de despliegue. Este README es solo el índice de archivos.

## Contenido

- **`ARQUITECTURA.md`** — diseño general: capas, principios, seguridad
  (CAPTCHA, sesión OTP, límites de intentos), patrón de sub-workflows,
  trámites automáticos vs. manuales, checklist de despliegue en producción.
- **`ESQUEMA-BD.md`** — esquema **real** de PostgreSQL (dump compartido por
  el instituto, no uno temporal/inventado).
- **`CONTRATO-API.md`** — especificación completa de los 11 endpoints HTTP
  (request/response exactos, reglas de negocio, respuestas de error).
- **`workflows/`** — los 12 workflows de n8n importables:

  | Workflow | Endpoint | Rol |
  |---|---|---|
  | `workflow-consultar-estudiante.json` | 1 | Identidad por cédula + reCAPTCHA v2 |
  | `workflow-enviar-ticket-verificacion.json` | 2 | Envío de OTP por correo + cooldown de 60s |
  | `workflow-verificar-ticket.json` | 3 | Verificación de OTP + límite de 5 intentos/10min |
  | `workflow-generar-certificado.json` | 4 | Único trámite 100% automático (certificado + QR) |
  | `workflow-enviar-certificado-pdf.json` | 4.1 | Adjunta y envía el PDF real (generado en la app) |
  | `workflow-verificar-certificado.json` | 4.2 | **Público**, sin login — el QR como firma de Secretaría |
  | `workflow-consultar-tickets.json` | 5 | Historial de trámites manuales del estudiante |
  | `workflow-crear-ticket-solicitud.json` | 6 | Genérico — hoy solo Anulación de Matrícula |
  | `workflow-resetear-contrasena-correo.json` | 6.1 | Reseteo automático (Google Workspace) |
  | `workflow-consultar-laboratorios.json` | 8 | Catálogo para el rol Docente |
  | `workflow-reportar-incidencia-laboratorio.json` | 9 | Reporte de incidencia (rol Docente, foto opcional) |
  | `workflow-detectar-respuesta-ticket.json` | — | Sin webhook: Gmail Trigger, cierra tickets solos |

  Los endpoints que actúan en nombre de un estudiante/docente específico (4,
  4.1, 5, 6, 9) exigen una sesión OTP verificada en los últimos 20 min —
  ver "Autenticación" en `CONTRATO-API.md`.

## Cómo importar en n8n

1. Tener las tablas de `ESQUEMA-BD.md` creadas en tu instancia de PostgreSQL
   (local con Docker para desarrollo, o la base real del instituto).
2. Abrir n8n → `Workflows` → `Import from File` (o arrastrar cada `.json`)
   para los 12 archivos de `workflows/`.
3. En cada nodo Postgres, configurar la credencial real ("Yavirac DB" o
   como se llame en tu instancia) — todos los nodos vienen con el
   placeholder `REEMPLAZAR`.
4. En los nodos `emailSend` (envío de OTP, avisos, confirmaciones),
   configurar las credenciales SMTP reales (Mailtrap sirve para pruebas).
5. En cada nodo Webhook, configurar la credencial Header Auth (`X-Api-Key`)
   — debe ser el mismo valor que `environment.apiKey` en la app.
6. En `workflow-consultar-estudiante.json`, poner la Secret Key real de
   reCAPTCHA v2 en el nodo "Verificar CAPTCHA (Google)" (la Site Key
   pareja va en `environment.recaptchaSiteKey` de la app).
7. En `workflow-resetear-contrasena-correo.json`, configurar la credencial
   de Service Account de Google Workspace (Domain-Wide Delegation) cuando
   esté disponible.
8. En `workflow-detectar-respuesta-ticket.json`, configurar la credencial
   Gmail OAuth2 de la casilla `tramites@yavirac.edu.ec` cuando esté
   disponible.
9. Activar los 12 workflows y confirmar que la URL base coincide con
   `environment.n8nBaseUrl` de la app (`http://localhost:5678/webhook` en
   desarrollo).

## Notas

- El código único del certificado (`codigoUnico`) es un UUID real
  (`gen_random_uuid()`), generado por la base de datos, con `UNIQUE` a
  nivel de esquema — no un valor armado en la aplicación.
- La **idempotencia está forzada en dos niveles**: el workflow busca antes
  de crear (para responder con el certificado existente en vez de un
  error), y además hay un constraint `UNIQUE(estudiante_id,
  periodo_lectivo_codigo)` en `certificados` — imposible duplicar aunque
  dos solicitudes lleguen casi al mismo tiempo.
- **Seguridad**: reCAPTCHA v2 en el único punto sin OTP previo, sesión OTP
  server-side en los endpoints que actúan por un usuario específico,
  cooldown de envío de OTP, límite de intentos al verificarlo, y cédula
  enmascarada en la verificación pública. Detalle completo en la sección
  "Seguridad" de `ARQUITECTURA.md`.
- Estos workflows están escritos contra el **esquema real** compartido por
  el instituto (`ESQUEMA-BD.md`) — si la base de datos definitiva termina
  siendo distinta, hay que ajustar las queries de cada nodo Postgres, pero
  el contrato de request/response hacia la app no cambia.
