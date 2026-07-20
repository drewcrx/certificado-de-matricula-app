# Arquitectura del backend — App de Certificado de Matrícula

## Principio rector

**n8n no es un consumidor de la API. n8n ES la API.**

No hay un servidor Express/Node/NestJS intermedio. Cada workflow de n8n con un
nodo **Webhook** como disparador es, en sí mismo, un endpoint HTTP. La lógica
de negocio (validaciones, generación de códigos, reglas de idempotencia,
decisiones) vive **dentro de los workflows** (nodos Code, IF, Postgres), no en
una capa de código aparte. Esto es exactamente lo que pide la coordinación
académica: que la mayor parte del trabajo esté implementado en n8n.

Esta app (Ionic) tiene **su propia API/instancia de n8n**, independiente de la
que use el equipo de la web. Ambas comparten la misma base de datos
PostgreSQL — desde el 2026-07-20 esta app ya trabaja contra el **esquema
real** (`yavibot_dump.sql`, ver `ESQUEMA-BD.md`), no contra un esquema
temporal inventado.

```
┌─────────────────┐      HTTPS/JSON       ┌──────────────────────────┐      SQL      ┌──────────────┐
│   App Ionic      │ ────────────────────▶ │   n8n (API + lógica)     │ ─────────────▶ │  PostgreSQL   │
│  (certi-matricula-app) │ ◀──────────────  │  workflows = endpoints   │ ◀───────────── │  (compartida  │
└─────────────────┘                        └──────────────────────────┘                │  con la web)  │
                                                                                         └──────────────┘
```

La app móvil **no sabe nada** de SQL ni de reglas de negocio — solo llama
webhooks y pinta lo que le devuelven. Toda la inteligencia vive en n8n.

---

## Capas

1. **Presentación** — la app Ionic (`certi-matricula-app/`). Ya terminada;
   consume los webhooks documentados en `CONTRATO-API.md`.
2. **API + lógica de negocio** — workflows de n8n (`workflows/*.json`). Aquí
   viven las validaciones, la idempotencia, la generación de códigos únicos,
   las reglas de qué trámite es automático y cuál requiere revisión manual.
3. **Datos** — PostgreSQL, esquema real compartido con el resto del sistema
   institucional (chatbot + panel administrativo), documentado en
   `ESQUEMA-BD.md`. Esta app solo lee/escribe el subconjunto de tablas que
   necesita (ver tabla de alcance en ese documento).

Esta separación es la que permite que, si el esquema cambia (nuevas columnas,
tablas), **solo se toquen los nodos Postgres de los workflows** — la app y el
contrato de endpoints no cambian.

---

## Organización de los workflows (por dominio)

```
workflows/
  workflow-consultar-estudiante.json           # dominio: identidad (estudiante o docente)
  workflow-enviar-ticket-verificacion.json     # dominio: verificación (OTP)
  workflow-verificar-ticket.json               # dominio: verificación (OTP)
  workflow-consultar-tickets.json              # dominio: trámites/tickets (estudiante)
  workflow-crear-ticket-solicitud.json         # dominio: trámites/tickets (genérico, estudiante)
  workflow-generar-certificado.json            # dominio: trámites/tickets (especializado, estudiante)
  workflow-enviar-certificado-pdf.json         # dominio: trámites/tickets (adjunto PDF por correo)
  workflow-consultar-laboratorios.json         # dominio: rol Docente (catálogo)
  workflow-reportar-incidencia-laboratorio.json # dominio: rol Docente (incidencia + foto opcional)
```

Cada dominio se agrupa por prefijo de nombre. Cuando el proyecto crezca (más
trámites, más integraciones), los workflows nuevos se agregan siguiendo el
mismo patrón: un archivo = un endpoint = una responsabilidad.

`workflow-consultar-estudiante.json` y `workflow-enviar-ticket-verificacion.json`
son compartidos entre los dos roles: primero buscan en `estudiantes` y, si no
hay match, en `docentes` (ver sección "Rol Docente" más abajo) —
`workflow-verificar-ticket.json` no necesitó cambios porque solo valida el
OTP contra `otp_codigos` por cédula, sin importar qué tabla de identidad
hizo match.

### Convención de nombres de endpoint

`POST /webhook/v1/<verbo>-<recurso>` — kebab-case, versionado desde ya con
`v1/` para poder introducir cambios incompatibles en el futuro (`v2/`) sin
romper la app que ya esté publicada. (Los workflows ya construidos usan rutas
sin `v1/` porque se hicieron antes de definir esta convención — al importarlos
en la instancia real de n8n, actualizar el campo `path` del nodo Webhook a
`v1/...`.)

### Formato de respuesta

Se mantiene el formato **plano** ya usado y ya consumido por la app (sin
envelope `{success, data}`) por consistencia con lo ya construido:
- Éxito → 200 con el objeto/array directamente.
- Error de negocio (ej. no matriculado) → 4xx con `{ "error": "mensaje" }`.
- Ver `CONTRATO-API.md` para el detalle exacto de cada endpoint.

---

## Seguridad

- **Autenticación del webhook — ✅ implementado.** Los 9 workflows con
  Webhook usan Header Auth (`X-Api-Key`) como credencial del propio nodo
  Webhook — sin el header correcto, n8n responde 403 antes de ejecutar
  cualquier lógica. La app la agrega automáticamente vía
  `ApiKeyInterceptor` (`certi-matricula-app/src/app/interceptors/`), que
  lee la clave de `environment.apiKey`. La clave en sí vive solo en
  `environment.ts`/`environment.prod.ts` (no versionar valores reales de
  producción sin más cuidado — hoy es una clave de desarrollo local).
- **Credenciales de Postgres**: nunca hardcodear usuario/contraseña en los
  nodos — usar el sistema de credenciales de n8n ("Yavirac DB").
- **Variables de entorno** (`$env` en n8n) para todo lo que cambie entre
  desarrollo/producción: URL de verificación pública, dominio del correo
  institucional, credenciales SMTP, `N8N_RESTRICT_FILE_ACCESS_TO` (ver
  "Fotos de incidencias" más abajo).
- **Pendiente**: rotar la `X-Api-Key` de desarrollo antes de ir a
  producción, y moverla a un secreto real (no un valor plano en
  `environment.prod.ts`) cuando exista un pipeline de build que lo permita.

---

## Despliegue en producción (VPS + base de datos real del instituto)

Todo lo descrito en `ARRANQUE-LOCAL.md` y probado en esta fase (Docker local,
`init.sql`, datos de prueba) es el entorno de **desarrollo**. Para que la app
funcione dentro del instituto, el cambio necesario **no es migrar ni cargar
datos** — es apuntar n8n a la base de datos real que ya administra el
instituto (la misma que usa o usará el sistema del equipo web/panel
administrativo), en vez de al Postgres local de Docker:

1. Cuando se tengan las credenciales del VPS y el dominio, se levanta n8n ahí
   (mismo `docker-compose.yml` como base, ajustando `WEBHOOK_URL`/`N8N_HOST`
   al dominio real).
2. En n8n, se reemplaza la credencial Postgres ("Yavirac DB") por una que
   apunte al **host/puerto/base de datos reales** del instituto — el resto
   de cada workflow (queries, lógica, nodos) no cambia, porque ya está
   escrito contra el esquema real (`ESQUEMA-BD.md`), no contra el de pruebas.
3. Los ~1400+ estudiantes reales, matrículas, periodos, etc. **ya existen**
   en esa base de datos real (los administra el instituto/el equipo web) —
   n8n simplemente los lee en el momento de cada consulta. No hace falta un
   dump ni una carga masiva desde este proyecto: replicar esos datos en un
   entorno de pruebas local, además de innecesario, expondría información
   real de estudiantes sin necesidad.
4. Aplicar los mismos constraints agregados durante las pruebas
   (`ux_certificado_estudiante_periodo`, `ux_ticket_estudiante_tipo_activo`,
   `tickets.codigo` nullable) a la base real **antes** de conectar n8n en
   producción — coordinado con quien administre esa base, ya que es un
   esquema compartido con el otro sistema.
5. Cambiar `usuarios_panel.correo` del responsable de prueba ("Juan Pérez")
   por el correo institucional real de quien procese Anulación de Matrícula.
   **No aplica** para incidencias de laboratorio: la asignación en
   `asignaciones_responsables` (tipo `ALERTA_LAB`, "Carlos Ruiz",
   `carlos.ruiz@yavirac.edu.ec`) ya es la real, tomada del dump de
   producción — no es un placeholder de pruebas.
6. Llevar también el volumen `uploads_data` (fotos de incidencias) al VPS y
   declarar `N8N_RESTRICT_FILE_ACCESS_TO` en su `docker-compose.yml` — sin
   esa variable, `reportar-incidencia-laboratorio` falla al intentar
   guardar la foto (ver "Fotos de incidencias" arriba).

---

## Patrón recomendado para escalar: sub-workflows reutilizables

Varios workflows repiten la misma lógica ("buscar estudiante y validar que
exista"). A medida que se agreguen más trámites, conviene extraer esa lógica
a un **sub-workflow** (`Execute Workflow` node) en vez de copiar los mismos 3
nodos en cada archivo nuevo:

- `sub-validar-estudiante` — recibe `cedula`, devuelve los datos del
  estudiante o dispara la respuesta de error, reutilizable desde cualquier
  workflow que necesite identificar a un estudiante.

Los workflows actuales todavía no usan este patrón (se construyeron antes de
formalizar la arquitectura), pero **los workflows nuevos que agregues para
los próximos trámites deberían usarlo** — es la forma de que "escalable"
signifique algo concreto: agregar un trámite nuevo no debería requerir
reescribir la validación del estudiante otra vez.

---

## Trámites: automáticos vs. manuales

Con el menú ya definido en la app, hay tres trámites/flujos implementados:

| Trámite | Rol | Automatizado | Genera documento |
|---|---|---|---|
| Certificado de Matrícula | Estudiante | ✅ Sí (workflow especializado) | ✅ Sí (QR + correo, PDF opcional) |
| Anulación de Matrícula | Estudiante | ❌ No (requiere revisión) | ❌ No |
| Reportar incidencia de laboratorio | Docente | ❌ No (requiere revisión) | ❌ No (foto opcional adjunta) |

Récord Académico y Certificado de Vinculación quedaron **fuera del alcance**
del proyecto; el modelo de datos (`tipos_solicitud`) los incluye por ser
parte del catálogo institucional, pero la app no los expone ni los llama.

---

## Rol Docente

Segunda identidad de usuario, agregada sin tocar el flujo de identificación
existente. La idea central: **no hay una pantalla de login separada** — el
docente pasa por el mismo flujo de cédula + OTP por correo que un
estudiante, y recién después de identificarse se le muestra un menú
distinto.

1. `POST /consultar-estudiante` primero busca en `estudiantes`; si no hay
   match, busca en `docentes` (segunda identidad, mismo formato de cédula).
   La respuesta incluye un discriminador `tipoUsuario: "ESTUDIANTE" |
   "DOCENTE"`.
2. `POST /enviar-ticket-verificacion` hace la misma búsqueda dual para saber
   a qué correo enviar el OTP.
3. `POST /verificar-ticket` no cambió — valida el OTP contra `otp_codigos`
   por cédula, sin necesidad de saber qué rol es.
4. La app (`chat.page.ts`) guarda el `Usuario` identificado (unión
   discriminada `Estudiante | Docente`) y elige el menú según
   `tipoUsuario`: `OPCIONES_MENU_ESTUDIANTE` (4 trámites) u
   `OPCIONES_MENU_DOCENTE` (por ahora: Reportar incidencia en laboratorio +
   Finalizar conversación) — completamente independientes, pensado para
   crecer sin mezclar la lógica de un rol con la del otro.

El único trámite de este rol hoy es **Reportar incidencia en laboratorio**:
`GET /consultar-laboratorios` (catálogo) → el docente elige laboratorio,
escribe una descripción y opcionalmente adjunta una foto → `POST
/reportar-incidencia-laboratorio`, que **vuelve a validar** del lado del
servidor que la cédula sea de un docente real (no confía en el
`tipoUsuario` que ya decidió la app), valida el laboratorio, resuelve el
responsable vía `asignaciones_responsables` (tipo `ALERTA_LAB`) y le envía
un correo de aviso. Ver `CONTRATO-API.md` §8-9 para el contrato exacto y
`ESQUEMA-BD.md` para las tablas (`docentes`, `laboratorios`, `alertas`,
`alerta_historial`, `adjuntos`).

### Fotos de incidencias

Requisito específico pedido para este trámite: poder adjuntar una foto del
incidente. Diseño:

- **Cliente**: `<input type="file" accept="image/jpeg,image/png"
  capture="environment">` en vez de un plugin nativo de cámara (Capacitor
  Camera) — funciona igual en navegador y en WebView nativo sin build
  adicional. Se valida tipo/tamaño (máx. 5MB) antes de convertir a base64 y
  enviarla.
- **Servidor**: el workflow recibe `fotoBase64`/`fotoMime`, escribe el
  archivo en disco con el nodo `readWriteFile` de n8n (no se guarda el
  binario en Postgres) dentro del volumen Docker `uploads_data`, montado en
  `/data/storage` (ver `docker-compose.yml`), y solo entonces inserta la
  fila en `adjuntos` con la ruta relativa (mismo patrón que usaría el
  sistema real — `adjuntos.ruta` es un string, no un BLOB).
- **Restricción de n8n a tener en cuenta si se reconstruye el entorno**:
  por defecto n8n solo permite leer/escribir dentro de `~/.n8n-files`
  (`SecurityConfig.restrictFileAccessTo`), incluso sin configurar nada. Hay
  que declarar explícitamente `N8N_RESTRICT_FILE_ACCESS_TO=/data/storage`
  en el `environment:` del servicio `n8n` — sin esa variable, cualquier
  escritura fuera de `~/.n8n-files` falla con `"... is not writable."`
  aunque el volumen ya tenga los permisos de archivo correctos.
- Adjuntar foto es **opcional** en todo el flujo — si el docente no adjunta
  nada, `adjuntos` no se toca y `alertas.adjunto_id` queda `NULL`.

---

## Roadmap de fases

1. **Fase 1 (hecha)**: consultar-estudiante, enviar/verificar-ticket,
   generar-certificado-matricula, consultar-tickets, crear-ticket-solicitud
   para Anulación de Matrícula. Esquema temporal de base de datos (ya
   reemplazado, ver fase 3).
2. **Fase 2 (hecha)**: backend real corriendo en Docker local (n8n +
   PostgreSQL, `docker-compose.yml`/`init.sql`/`ARRANQUE-LOCAL.md`). En la
   app solo se cambia `environment.usarMock = false` y
   `environment.n8nBaseUrl` — ningún otro cambio de código.
3. **Fase 3 (hecha)**: remapeo completo al esquema real compartido
   (`yavibot_dump.sql`, ver `ESQUEMA-BD.md`) — se migraron todas las
   queries de los nodos Postgres sin tocar el contrato ni la app.
4. **Fase 4 (hecha)**: autenticación de webhooks (`X-Api-Key` vía Header
   Auth en los 7 workflows + `ApiKeyInterceptor` en la app), certificado
   en PDF por correo, idempotencia a nivel de base de datos (constraints
   `UNIQUE`), notificación por correo al responsable de Anulación de
   Matrícula.
5. **Fase 5 (hecha)**: rol Docente — identificación compartida,
   `consultar-laboratorios`, `reportar-incidencia-laboratorio` con foto
   opcional (ver secciones "Rol Docente" y "Fotos de incidencias" arriba).
6. **Pendiente**: sub-workflows reutilizables (`sub-validar-estudiante`),
   error workflow global en n8n, rotar la `X-Api-Key` de desarrollo antes
   de producción, desplegar en el VPS institucional apuntando a la base de
   datos real (ver sección "Despliegue en producción" arriba).

---

## Archivos de este directorio

- `ARQUITECTURA.md` — este documento.
- `ESQUEMA-BD.md` — esquema real de PostgreSQL (todas las tablas que usa esta app).
- `CONTRATO-API.md` — especificación endpoint por endpoint (request/response).
- `ARRANQUE-LOCAL.md` — cómo levantar el backend local (Docker: n8n + Postgres).
- `workflows/` — los workflows de n8n, importables, que implementan el
  contrato.
