# Esquema real de PostgreSQL (a partir de 2026-07-20)

**Este ya NO es un esquema temporal** — es el dump real (`yavibot_dump.sql`)
compartido por el usuario, generado por el sistema completo que construyó el
equipo (chatbot + panel administrativo + alertas de laboratorio). Reemplaza
por completo al esquema temporal que se documentaba antes en este archivo.

Motor: PostgreSQL 16, con la extensión `pgcrypto` habilitada (se usa para
hashear los OTP — ver más abajo).

---

## Alcance: qué toca esta app y qué no

El dump tiene **~20 tablas** para un sistema mucho más grande que solo
certificados. Esta app (chatbot YaviBot) solo lee/escribe en un subconjunto:

| Tabla | La usa esta app | Para qué |
|---|---|---|
| `estudiantes` | ✅ | identificar al estudiante por cédula |
| `carreras` | ✅ | nombre de la carrera (JOIN) |
| `periodos_academicos` | ✅ | el periodo lectivo vigente (JOIN, `vigente=true`) |
| `otp_codigos` | ✅ | el "ticket" de verificación (OTP hasheado) |
| `qr_codigos` | ✅ | el código único/QR del certificado |
| `certificados` | ✅ | el certificado de matrícula emitido |
| `tickets` | ✅ | trámites manuales (Anulación de Matrícula) |
| `tipos_solicitud` | ✅ | catálogo de trámites |
| `asignaciones_responsables` | ✅ (opcional) | a qué `usuario_panel` se asigna un ticket nuevo |
| `eventos` | ✅ (opcional) | log de eventos para que el panel se entere de tickets nuevos |
| `configuracion_sistema` | referencia | datos institucionales (nombre, firma) — se citan como literales, no se leen dinámicamente por ahora |
| `docentes` | ✅ | identificar al docente por cédula (segunda identidad, mismo flujo cédula+OTP — rol Docente) |
| `laboratorios` | ✅ | catálogo para elegir laboratorio al reportar una incidencia |
| `alertas`, `alerta_historial` | ✅ | la incidencia de laboratorio reportada por el docente (rol Docente) |
| `adjuntos` | ✅ (opcional) | la foto opcional de la incidencia de laboratorio (rol Docente) — se guarda en disco, esta tabla solo registra la ruta/metadatos |
| `usuarios_panel`, `roles`, `permisos`, `roles_permisos` | ✅ (parcial) | solo se lee (nunca se escribe): resolver `alertas.profesor_id`/`responsable_id` cruzando `docentes.cedula = usuarios_panel.cedula`. El login del panel administrativo en sí sigue sin ser parte de esta app |
| `intentos_acceso`, `auditoria`, `importaciones` | ❌ | fuera del alcance de esta app |

---

## Diferencias clave frente a lo que se había asumido antes

Estas son las razones concretas por las que las pruebas fallaban:

1. **La columna es `correo`, no `correo_institucional`.**
2. **No existe `apellidos` como columna separada** — `estudiantes.nombres`
   contiene el nombre completo (ej. `"NARVAEZ LLAMUCO ANDERSON SEBASTIAN"`).
   Los workflows ahora devuelven ese valor completo en `nombres` y
   `apellidos: ''` para no romper el contrato que ya consume la app.
3. **`estado_matricula` admite 4 valores**, no 2:
   `MATRICULADO | RETIRADO | REPROBADO | APROBADO`. La validación de
   "¿puede generar certificado?" sigue siendo `=== 'MATRICULADO'` — sigue
   funcionando igual, solo hay más formas de estar "no matriculado".
4. **No hay columna `periodo_actual` en `estudiantes`.** El periodo lectivo
   vigente vive en `periodos_academicos` (columna `vigente boolean`, con un
   índice único que garantiza que solo uno puede ser `true` a la vez). Se
   obtiene con `LEFT JOIN periodos_academicos ON vigente = true`.
5. **`carrera` no es un texto en `estudiantes`** — es `carrera_id` (FK a
   `carreras`). Requiere JOIN para obtener el nombre.
6. **El OTP se guarda HASHEADO (`codigo_hash`), nunca en texto plano.** Se
   usa `pgcrypto`: `encode(digest(codigo, 'sha256'), 'hex')` tanto al
   guardarlo como al compararlo. Antes los workflows comparaban texto plano
   contra `tickets_verificacion.ticket` — eso ya no aplica.
7. **La idempotencia del certificado ahora SÍ está forzada por la base de
   datos en esta instancia local/independiente** (`ALTER TABLE certificados
   ADD CONSTRAINT ux_certificado_estudiante_periodo UNIQUE (estudiante_id,
   periodo_lectivo_codigo)`, ya aplicado a `yavirac-db` y agregado a
   `init.sql`). El workflow sigue haciendo el chequeo "¿ya existe?" antes de
   insertar (por UX — para responder con el certificado existente en vez de
   un error), pero ahora la base de datos también lo garantiza ante una
   condición de carrera, sin importar qué cliente escriba (app o una futura
   web). **Ojo:** el dump ORIGINAL que compartió el equipo (con ~1400
   estudiantes) sí tenía duplicados reales para el mismo periodo (ej.
   estudiante id=1 con 3 certificados en `2026-I`) — este constraint se
   verificó contra los datos actualmente cargados en `yavirac-db` (sin
   duplicados) antes de aplicarse. Si en algún momento esta base se
   fusiona/sincroniza con la base de datos real del equipo, hay que limpiar
   esos duplicados históricos primero (o el `ALTER TABLE` fallará), y
   coordinarlo con el resto del equipo ya que es un esquema compartido.
8. **El código único del certificado es el UUID de `qr_codigos.identificador`**
   (`gen_random_uuid()`), no un string tipo `MAT-2026-XXXX` inventado. El
   contrato de la app (`codigoUnico`) ahora se llena con ese UUID.
9. **`tipos_solicitud.genera_ticket = false` para `CERT_MATRICULA`.** Es
   decir, el propio esquema real ya dice que el certificado de matrícula
   **no genera una fila en `tickets`** — se rastrea únicamente vía
   `certificados` + `qr_codigos`. Por eso "Consultar estado de mis tickets"
   en la app solo debe mostrar trámites manuales (Anulación de Matrícula),
   nunca certificados de matrícula.
10. **Los estados de `tickets` están en español y son distintos**:
    `Pendiente | En Proceso | Resuelto` (no existe un estado "rechazado").
    Los workflows traducen esto a `EN_PROCESO | COMPLETADO` para no romper
    el modelo/UI que ya tiene la app (`Pendiente`/`En Proceso` → `EN_PROCESO`,
    `Resuelto` → `COMPLETADO`).
11. **El `codigo` de un ticket (`TK-000001`) se genera después del insert**,
    a partir del `id` real (`'TK-' || LPAD(id::text, 6, '0')`) — no con una
    secuencia separada, para que siempre coincida con el `id` (así están
    los datos de ejemplo).

---

## Tablas relevantes (definición completa, tal como están en el dump real)

### `estudiantes`
```sql
cedula, nombres, carrera_id (FK carreras), nivel, paralelo,
estado_matricula (MATRICULADO|RETIRADO|REPROBADO|APROBADO),
correo, modalidad (PRESENCIAL|DUAL|EN LINEA|SEMIPRESENCIAL),
periodo_ingreso_id (FK periodos_academicos, nullable), nivel_ingreso
```

### `carreras`
```sql
id, codigo, nombre
```

### `periodos_academicos`
```sql
id, codigo (ej '2026-I'), nombre (ej 'mayo-septiembre 2026'),
fecha_inicio, fecha_fin, vigente boolean (único índice: solo uno true)
```

### `otp_codigos`
```sql
cedula, correo, codigo_hash (sha256 hex vía pgcrypto), canal ('chatbot'|'panel_recovery'),
expira_en, usado boolean
```

### `qr_codigos`
```sql
id, identificador uuid (gen_random_uuid(), ÚNICO), estudiante_id,
certificado_id (FK, nullable), payload jsonb, verificaciones int
```

### `certificados`
```sql
id, estudiante_id, tipo (default 'CERT_MATRICULA'), qr_id (FK único a qr_codigos),
pdf_path (nullable — esta app no genera PDF servidor, se deja NULL),
fecha, hora, periodo_lectivo_codigo, periodo_lectivo_nombre, modalidad,
periodo_ingreso_codigo, periodo_ingreso_nombre, nivel_ingreso,
firmante_nombre, firmante_cargo
```

### `tipos_solicitud`
```sql
id, codigo, nombre, genera_ticket boolean, ambito
-- datos reales: CERT_MATRICULA(f), RECORD_ACADEMICO(t), CERT_VINCULACION(t),
--               ANULACION_MATRICULA(t), ALERTA_LAB(t)
```

### `tickets`
```sql
id, codigo ('TK-000001'), tipo_solicitud_id (FK), estudiante_id, carrera_id,
nivel, paralelo, descripcion, estado ('Pendiente'|'En Proceso'|'Resuelto'),
responsable_id (FK usuarios_panel), creado_en, actualizado_en
```

### `asignaciones_responsables`
```sql
id, tipo_solicitud_id (FK), carrera_id (nullable = aplica a todas),
usuario_id (FK usuarios_panel), vigente boolean
```

### `eventos`
```sql
id, tipo (ej 'TicketCreado', 'TicketAsignado'), payload jsonb,
origen (ej 'chatbot'), procesado boolean
```

### `docentes` (rol Docente)
```sql
id, cedula (único, CHECK 10 dígitos), nombre_docente, correo (único),
creado_en, actualizado_en
```
Segunda identidad, paralela a `estudiantes` — se busca por cédula con el
mismo flujo cédula+OTP. Cada docente real tiene también una fila en
`usuarios_panel` con la misma cédula/correo (rol `PROFESOR`), necesaria para
resolver `alertas.profesor_id` (ver más abajo).

### `laboratorios` (rol Docente)
```sql
id, codigo (único, ej 'LAB-01'), nombre, cantidad_equipos
```
Catálogo fijo que consume `/consultar-laboratorios` para poblar el paso
"elige un laboratorio" del flujo de Reportar Incidencia.

### `adjuntos` (rol Docente — foto de incidencia, opcional)
```sql
id, tipo (ej 'foto_alerta'), ruta (ej 'storage/uploads/<archivo>'),
mime (CHECK: 'image/jpeg'|'image/png'), tamano_bytes (CHECK: <= 5242880 = 5MB),
hash (nullable), creado_en
```
No guarda el binario — `ruta` apunta a un archivo físico. El workflow
`reportar-incidencia-laboratorio` recibe la foto como base64
(`fotoBase64`/`fotoMime` en el request), la escribe en disco con el nodo
`readWriteFile` de n8n dentro del volumen Docker `uploads_data` (montado en
`/data/storage`, ver `docker-compose.yml`) y solo entonces inserta esta
fila. Requiere la variable de entorno `N8N_RESTRICT_FILE_ACCESS_TO`
apuntando a `/data/storage` — por defecto n8n solo permite escribir dentro
de `~/.n8n-files`, y rechaza (`"... is not writable."`) cualquier otra ruta.
Adjuntar foto es opcional: si el docente no adjunta nada, `alertas.adjunto_id`
queda `NULL` y no se toca esta tabla.

### `alertas` (rol Docente — la incidencia en sí)
```sql
id, codigo (único, ej 'AL-000001', se genera post-insert igual que tickets),
laboratorio_id (FK laboratorios), descripcion, adjunto_id (FK adjuntos, nullable),
profesor_id (FK usuarios_panel — quién reportó), estado
('Pendiente'|'En revisión'|'Resuelta'), responsable_id (FK usuarios_panel, nullable),
ticket_id (FK tickets, nullable — no se usa desde esta app), creado_en, actualizado_en
```
`profesor_id` y `responsable_id` son FKs a `usuarios_panel`, **no** a
`docentes` — el workflow resuelve `profesor_id` cruzando
`docentes.cedula = usuarios_panel.cedula` y `responsable_id` vía
`asignaciones_responsables` (tipo `ALERTA_LAB`, sin filtro de carrera). A
diferencia de Anulación de Matrícula, no hay límite de incidencias
simultáneas por docente.

### `alerta_historial`
```sql
id, alerta_id (FK alertas, ON DELETE CASCADE), estado_anterior, estado_nuevo,
observacion, usuario_id (FK usuarios_panel, nullable), creado_en
```
Bitácora de cambios de estado de una alerta. El workflow de reporte inserta
la primera fila (`NULL → 'Pendiente'`) al crear la incidencia; cambios
posteriores de estado los haría el panel administrativo (fuera de esta app).

### `usuarios_panel` / `roles` (solo lectura)
```sql
-- usuarios_panel: id, cedula, correo, nombre, rol_id (FK roles), contrasena_hash, activo
-- roles: id, codigo (ej 'PROFESOR', 'RESP_LABORATORIOS'), nombre, descripcion
```
Esta app nunca escribe en estas tablas ni implementa el login del panel —
solo las lee para resolver `alertas.profesor_id`/`responsable_id`.

---

## Configuración institucional citada como literal (no leída dinámicamente)

Tomado de `configuracion_sistema` en el dump — si cambian, hay que actualizar
los workflows a mano (o, a futuro, hacer un SELECT a esta tabla):

- `institucion.nombre_oficial` = Instituto Superior Tecnológico de Turismo y Patrimonio "YAVIRAC"
- `institucion.ciudad_emision` = Quito
- `firma.nombre` = Mtr. Alexandra Gordon M.
- `firma.cargo` = Secretaria General (s)
