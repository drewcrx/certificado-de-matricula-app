# Propuesta: cierre automático de tickets vía respuesta de Gmail

**Estado: propuesta, no implementada todavía.** Objetivo: que un ticket
(hoy solo Anulación de Matrícula) pase de `Pendiente` a `Resuelto`
automáticamente cuando Secretaría **responda el correo de aviso original**
desde Gmail — sin panel administrativo, sin que nadie actualice nada a
mano, sin cron que cierre tickets por tiempo transcurrido.

---

## 0. El problema que hay que resolver primero (antes que nada de Gmail)

El correo de aviso a Secretaría hoy sale desde `no-reply@yavirac.edu.ec`
(`workflow-crear-ticket-solicitud.json`, nodo "Enviar Aviso a Responsable").
**Si esa dirección es literalmente "no-reply"** (buzón sin monitorear, o que
ni siquiera acepta correo entrante), cuando Secretaría le dé "Responder", el
correo:
- rebota, o
- llega a un buzón que nadie lee ni n8n puede consultar.

Ninguna versión de esta propuesta funciona si eso pasa. **Antes de construir
nada**, hace falta una casilla real de Google Workspace que:
1. Reciba correo de verdad (no sea un alias "no-reply" bloqueado).
2. n8n pueda leer vía Gmail API (con permiso OAuth/Service Account sobre
   esa casilla específica — no hace falta acceso a todo el dominio, solo a
   ese buzón).

Recomendación: usar una casilla dedicada tipo `tramites@yavirac.edu.ec` (o
la que ya use Secretaría para gestionar solicitudes) como remitente de los
avisos, en vez de `no-reply@...`. Esto es un cambio de una línea en el
workflow existente, pero es la base de la que depende todo lo demás.

---

## 1. Arquitectura propuesta

```
┌──────────────┐     correo [TK-XXXXXX]      ┌───────────────┐
│ crear-ticket-│ ───────────────────────────▶ │  Secretaría    │
│ solicitud    │                              │  (Gmail)       │
└──────────────┘                              └───────┬───────┘
                                                        │ Responde el
                                                        │ mismo correo
                                                        ▼
┌──────────────────────────────────────────────────────────────┐
│  NUEVO workflow: detectar-respuesta-ticket                    │
│  Gmail Trigger (polling) sobre tramites@yavirac.edu.ec        │
│  → extrae [TK-XXXXXX] del asunto                              │
│  → valida que el remitente es responsable autorizado          │
│  → UPDATE tickets SET estado='Resuelto' WHERE codigo=...      │
│  → INSERT eventos ('TicketResuelto', ...)                     │
└──────────────────────────────────────────────────────────────┘
                                                        │
                                                        ▼
                                        La app ya lee esto solo:
                                        GET /consultar-tickets
                                        (sin cambios — ya traduce
                                        'Resuelto' → 'COMPLETADO')
```

Lo importante: **el endpoint `/consultar-tickets` no cambia nada** — ya
traduce `estado = 'Resuelto'` a `COMPLETADO` en la respuesta (ver
`workflow-consultar-tickets.json`). En cuanto la fila cambia en la base de
datos, la próxima vez que la app pregunte, el check verde aparece solo. No
hace falta tocar la app.

---

## 2. Workflow nuevo: `workflow-detectar-respuesta-ticket.json`

Nodos, en orden:

1. **Gmail Trigger** — dispara cuando llega un correo nuevo al buzón
   monitoreado. Filtro de Gmail: `is:unread` (o una etiqueta dedicada, ver
   §9) para no reprocesar correos viejos.
2. **IF ¿El asunto tiene código de ticket?** — regex `\[TK-\d{6}\]` sobre el
   asunto. Si no matchea, **se ignora silenciosamente** (puede ser
   cualquier otro correo que le llegue a esa casilla).
3. **Code: Extraer código** — `subject.match(/TK-\d{6}/)[0]`.
4. **Buscar Ticket (Postgres)** — `SELECT id, estado, tipo_solicitud_id FROM tickets WHERE codigo = $1`.
5. **IF ¿Ticket existe y sigue activo?** — `estado IN ('Pendiente','En Proceso')`. Si ya estaba `Resuelto` (ej. Secretaría respondió dos veces, o "Responder a todos" generó un segundo correo), se ignora — no reprocesa ni duplica auditoría.
6. **Buscar Responsables Autorizados (Postgres)** — todos los correos con el rol correspondiente al `tipo_solicitud_id` del ticket (reutiliza el mismo patrón de `RESP_ANULACION` ya implementado).
7. **IF ¿El remitente es un responsable autorizado?** — compara el `From` del correo contra esa lista. Si no coincide, se ignora (ver §6).
8. **UPDATE tickets SET estado = 'Resuelto'** — `WHERE codigo = $1 AND estado IN ('Pendiente','En Proceso')` (doble chequeo de idempotencia, a nivel de UPDATE, no solo del IF previo).
9. **INSERT eventos ('TicketResuelto', ...)** — auditoría (§8).
10. **(Opcional) Marcar el correo como leído / aplicar etiqueta "Procesado"** — vía Gmail node, para trazabilidad visual en la propia bandeja de Secretaría, y para que quede claro qué correos ya gatillaron un cierre.

No hay nodo de respuesta HTTP porque este workflow **no es un webhook** —
no lo llama la app, lo dispara Gmail.

---

## 3. Trigger de Gmail a utilizar

El nodo nativo de n8n **Gmail Trigger** (`n8n-nodes-base.gmailTrigger`).
Detalle técnico importante que hay que ser honesto: este nodo funciona por
**polling** (por defecto revisa cada 1 minuto, configurable), **no** es un
push real de Gmail (Google sí ofrece push verdadero vía Cloud Pub/Sub —
`users.watch` — pero el nodo nativo de n8n no lo usa, y montarlo a mano
implicaría infraestructura de Google Cloud adicional, fuera de lo que este
proyecto necesita).

Esto **no viola tu restricción de "nada de cron que cambie estados por
tiempo"**: la diferencia clave es que un cron de "cerrar tickets después de
3 días" cambia el estado **basado en tiempo transcurrido, sin evidencia de
que algo pasó**. El Gmail Trigger, aunque revisa cada minuto, **solo actúa
si encontró un correo real** — el disparador sigue siendo el evento (la
respuesta de Secretaría), el polling es solo el mecanismo de detección, no
la causa del cambio de estado. Es la misma distinción que ya aplicamos en
`otp_codigos`/`eventos`: nada se mueve por reloj, todo se mueve porque algo
concreto ocurrió.

---

## 4. Cómo identificar correctamente el correo de respuesta

Dos enfoques posibles — recomiendo el primero por ser el que menos cambia
del sistema actual:

### Opción A (recomendada): código en el asunto, sin depender de threading
El asunto del aviso original ya se ajusta a `[TK-XXXXXX] Nueva solicitud de
...`. Cuando Secretaría responde, Gmail antepone `Re: ` pero **no toca el
resto del asunto** — el código sigue ahí, intacto. Extraerlo con una regex
simple es 100% confiable y no depende de que el correo original se haya
enviado por Gmail ni de que los headers de threading (`Message-ID`,
`In-Reply-To`) se hayan generado bien desde el SMTP genérico que usa hoy
`workflow-crear-ticket-solicitud.json`.

### Opción B (más robusta, requiere cambiar cómo se envía el aviso original)
Si en vez de mandar el aviso por SMTP genérico se manda con el **nodo
nativo Gmail de n8n** (`n8n-nodes-base.gmail`, operación "Send"), la
respuesta de n8n al enviar devuelve `threadId` — se podría guardar ese
`threadId` en una columna nueva (`tickets.gmail_thread_id`) y luego hacer
matching exacto por hilo en vez de por regex de asunto. Es más preciso
(inmune a que alguien edite el asunto a mano), pero:
- Requiere cambiar el nodo de envío existente (de SMTP genérico a Gmail
  nativo) — un cambio más grande.
- Requiere una migración de esquema (columna nueva).
- Requiere que la credencial de Gmail usada para *enviar* también pueda
  enviar **como** `tramites@yavirac.edu.ec` (mismo permiso que ya se
  necesita para leer, ver §5 más abajo — en la práctica no es mucho más
  esfuerzo si de todos modos se va a configurar esa casilla).

**Recomendación**: arrancar con la Opción A (ya funciona con lo que existe
hoy, cero cambios de esquema). Si en el futuro se vuelve un problema que
alguien edite el asunto o reenvíe el correo a otra persona que también
responda, se migra a la Opción B — el resto del diseño (validación de
remitente, UPDATE, auditoría) es idéntico en ambas.

---

## 5. Cómo extraer el código del ticket

```js
// Code node, después del Gmail Trigger
const asunto = $json.headers?.subject || $json.subject || '';
const match = asunto.match(/TK-\d{6}/);
if (!match) {
  return []; // no es un correo de respuesta a un ticket — se ignora, no error
}
return [{ json: { ticketCodigo: match[0], remitente: $json.from } }];
```

Si el `Code` node devuelve un array vacío, esa rama de la ejecución
simplemente no continúa (no hace falta un IF adicional para el caso "no
matchea" — devolver `[]` ya corta el flujo ahí).

---

## 6. Cómo validar que el remitente pertenece al personal autorizado

```sql
SELECT correo FROM usuarios_panel
WHERE rol_id = (
  SELECT rol_id FROM usuarios_panel WHERE id = (
    SELECT responsable_id FROM tickets WHERE codigo = $1
  )
)
```
(mismo patrón de "todos los que comparten el rol del responsable asignado"
ya usado para notificar a los dos encargados de Anulación). Si el `From`
del correo entrante no está en esa lista, se ignora — no actualiza nada.

**Nota honesta sobre spoofing de `From`**: el header `From` de un correo se
puede falsificar en el protocolo SMTP en general. Lo que da confianza real
acá es que el correo **llega de verdad a un buzón de Gmail real** que
nosotros controlamos, y Google Workspace aplica SPF/DKIM/DMARC
automáticamente a nivel de dominio — un correo externo que intente
hacerse pasar por `juan.perez@yavirac.edu.ec` sin ser realmente esa cuenta
normalmente **no pasa** la verificación de Gmail y se marca como spam o se
rechaza antes de llegar. Para un nivel extra de rigor (opcional, no
necesario para el alcance de un examen complexivo), se puede revisar el
header `Authentication-Results` que expone la Gmail API y exigir
`dkim=pass` — lo dejo documentado como hardening futuro, no como parte
obligatoria de esta primera versión.

---

## 7. Cómo actualizar la base de datos

```sql
UPDATE tickets
SET estado = 'Resuelto', actualizado_en = NOW()
WHERE codigo = $1 AND estado IN ('Pendiente', 'En Proceso')
RETURNING id, estudiante_id, tipo_solicitud_id;
```
El `WHERE estado IN (...)` es la misma idempotencia que ya se usa en todo
el proyecto (evita duplicar auditoría si Secretaría responde dos veces, o
si dos personas del mismo rol responden por separado al mismo hilo).

---

## 8. Auditoría

```sql
INSERT INTO eventos (tipo, payload, origen)
VALUES ('TicketResuelto', $1::jsonb, 'gmail_reply');
```
Payload sugerido: `{ "ticket_id": "...", "codigo": "TK-XXXXXX",
"resuelto_por": "juan.perez@yavirac.edu.ec" }`. Mismo patrón que
`TicketCreado`/`TicketAsignado`/`ResetCorreoEjecutado` — nada nuevo que
inventar en el modelo de auditoría.

---

## 9. Cómo evitar falsas detecciones

- **Filtro de Gmail Trigger**: `is:unread` (o mover los correos procesados
  a una etiqueta `YaviBot/Procesados` al final del workflow) — evita
  reprocesar el mismo correo en cada poll.
- **Regex estricta** (`TK-\d{6}` exacto) — cualquier otro correo que le
  llegue a esa casilla (spam, un estudiante que escribió ahí por error) se
  ignora sin error.
- **Verificación de estado activo** antes de actualizar — un ticket ya
  `Resuelto` no se vuelve a tocar.
- **Verificación de remitente autorizado** (§6) — un correo con el código
  correcto pero de alguien que no es responsable de ese trámite se ignora.
- **No procesar correos salientes propios**: excluir explícitamente al
  remitente `tramites@yavirac.edu.ec` (el propio sistema) de la lista de
  "remitentes válidos", para que el workflow nunca se dispare a sí mismo
  por accidente (ej. si alguien reenvía el aviso original de vuelta a la
  misma casilla).

---

## 10. Cambios en `CONTRATO-API.md`

- **No se agrega ningún endpoint HTTP nuevo** — este mecanismo es interno
  a n8n (Gmail Trigger, no webhook), no lo llama la app.
- Se agrega una nota en la sección de `/consultar-tickets` explicando que
  `estado: "COMPLETADO"` ahora puede llegar automáticamente por esta vía
  (antes, en la práctica, ningún ticket llegaba nunca a `COMPLETADO` desde
  que se creó ese endpoint, porque no existía ningún mecanismo real que lo
  disparara).
- Se agrega una sección nueva "Workflows internos (sin endpoint HTTP)"
  documentando `detectar-respuesta-ticket` para que quede claro que existe
  aunque no aparezca como parte del contrato público de la app.

---

## 11. Cambios en workflows existentes

- **`workflow-crear-ticket-solicitud.json`**: cambiar `fromEmail` de
  `no-reply@yavirac.edu.ec` a la casilla real monitoreada (ej.
  `tramites@yavirac.edu.ec`) en el nodo "Enviar Aviso a Responsable
  (Correo)". El asunto ya tiene el formato `... — {{codigo}}`; conviene
  moverlo al frente: `[{{codigo}}] {{tipo}}`, para que la regex de
  extracción sea trivial y a prueba de balas.
- **Workflow nuevo**: `workflow-detectar-respuesta-ticket.json` (§2).
- No se toca `workflow-consultar-tickets.json`, `workflow-generar-certificado.json`,
  ni ningún workflow del rol Docente — quedan exactamente igual.

---

## 12. Cambios en la base de datos

**Ninguno obligatorio** con la Opción A (§4) — reutiliza `tickets.estado` y
`eventos` tal como ya existen.

Si en el futuro se migra a la Opción B (thread-ID en vez de regex de
asunto), ahí sí haría falta:
```sql
ALTER TABLE tickets ADD COLUMN gmail_thread_id VARCHAR(50);
```
No se necesita ahora.

---

## 13. Compatibilidad con el resto del proyecto

- La app (`consultar-tickets`) **no requiere ningún cambio** — ya lee
  `tickets.estado` en tiempo real y ya traduce `Resuelto → COMPLETADO`.
  Este es, de hecho, el punto más fuerte de esta propuesta: el "contrato"
  entre la app y el backend nunca prometió *cómo* un ticket llega a
  `COMPLETADO`, solo que la app lo reflejaría cuando pasara — y ya lo hace.
- No afecta Anulación de Matrícula para el estudiante (sigue viendo lo
  mismo, solo que ahora el estado sí puede avanzar).
- No afecta Reseteo de Contraseña, Certificados, ni el rol Docente — son
  flujos completamente independientes.

---

## Qué falta para implementar esto

1. **Confirmar la casilla real monitoreada** (§0) — sin esto, nada de lo
   demás sirve. ¿Ya existe una casilla tipo `tramites@yavirac.edu.ec` que
   Secretaría revise, o hay que pedirle una a TI?
2. Credencial de Gmail en n8n para **leer** esa casilla (OAuth2 o Service
   Account con scope `gmail.readonly` o `gmail.modify` si se quiere marcar
   como leído/etiquetar) — permiso mucho más acotado que el de Admin SDK
   usado para el reseteo de contraseña, pero es **otra** credencial de
   Google Workspace que hay que pedirle a TI.
3. Decidir Opción A vs. Opción B (§4) — recomiendo A para esta primera
   versión.

En cuanto confirmes la casilla real (aunque sea con un placeholder tipo
`tramites@yavirac.edu.ec` mientras TI la crea — mismo patrón de "pavimentar
la base" que se usó en el resto del proyecto), puedo construir el workflow
completo dejando solo la credencial de Gmail como `REEMPLAZAR`.
