# Propuesta: Reseteo automático de contraseña de correo institucional

**Estado: implementado (proveedor confirmado: Google Workspace).** Todo lo
descrito abajo ya existe en `workflow-resetear-contrasena-correo.json` y en
la app (`estudiante.service.ts`/`chat.page.ts`) — el único paso pendiente es
que TI del instituto genere la credencial real de Google (§5, Opción A) y se
configure en n8n; hasta entonces el nodo "Resetear en Google Workspace
(Admin SDK)" queda con credencial `REEMPLAZAR` y el flujo responde 502 al
llegar a ese paso (todo lo anterior — validación de sesión, cooldown,
auditoría — sí se puede probar de punta a punta ya).

Este documento responde a un
cambio de requerimiento funcional (indicado por la tutora): el reseteo de
contraseña del correo institucional debe ser **100% automático**, ejecutado
por n8n contra el proveedor real de identidad del instituto — **sin ticket,
sin aprobación humana, sin Soporte TI en el loop**.

Esto reemplaza el diseño anterior (`tipoTramite: "RESET_CORREO"` dentro de
`/crear-ticket-solicitud`), que sí creaba un ticket manual. Ese diseño queda
**obsoleto** para este trámite específico (Anulación de Matrícula sigue
usando ese mismo endpoint sin cambios).

---

## 0. El bloqueo real: hace falta saber qué proveedor usa el instituto

Antes de poder implementar el punto 5 (la llamada real que cambia la
contraseña), necesitamos saber **cuál de estas tres plataformas administra
las cuentas de correo institucional** de Yavirac:

- **Google Workspace** (correos `@yavirac.edu.ec` servidos por Gmail/Google).
- **Microsoft 365 / Entra ID** (correos servidos por Outlook/Exchange Online).
- **Active Directory local / LDAP** (servidor de correo propio del instituto,
  con AD como directorio de usuarios).

Los tres puntos 1-4 y 6-9 de esta propuesta son **independientes del
proveedor** — se pueden construir ya. El punto 5 (la llamada administrativa
real) es el único que cambia según la respuesta, y es información que solo
puede confirmar alguien de TI del instituto (revisando, por ejemplo, si el
correo institucional funciona con una cuenta de Google, un login de
Microsoft, o un portal propio).

---

## 1. Contrato de API modificado

- **`POST /crear-ticket-solicitud`**: se elimina `RESET_CORREO` como
  `tipoTramite` válido. Solo sigue aceptando `ANULACION_MATRICULA`. El
  ticket `TK-000005` ya creado durante las pruebas queda como dato
  histórico (no se borra, pero no se generan más de este tipo).
- **`POST /resetear-contrasena-correo`** (nuevo, ver §2): reemplaza por
  completo el flujo anterior para este trámite.

## 2. Nuevo endpoint

**POST** `/resetear-contrasena-correo` (mismo patrón de autenticación
`X-Api-Key` y CORS que el resto de webhooks).

### Request
```json
{ "cedula": "0102030405" }
```
No se manda nada más — la prueba de que el estudiante ya pasó por cédula +
correo + OTP se valida **del lado del servidor** (§8), nunca confiando en
lo que diga el cliente.

### Response — 200 OK
```json
{
  "estado": "RESETEADO",
  "correoNotificado": "an***@yavirac.edu.ec",
  "mensaje": "Tu contraseña fue reseteada. Revisa tu correo institucional para ver la nueva contraseña temporal."
}
```
**La nueva contraseña NUNCA viaja en la respuesta HTTP** — solo se envía por
correo (fuera de banda), igual que ya se hace con el OTP. Ponerla en el
body/response quedaría en logs de red, del navegador, de n8n, etc.

### Response — 403 (no hay sesión validada reciente)
```json
{ "error": "Debes verificar tu identidad nuevamente antes de continuar." }
```

### Response — 404 (cédula no encontrada)
```json
{ "error": "Estudiante no encontrado." }
```

### Response — 429 (ya reseteó hace muy poco)
```json
{ "error": "Ya reseteaste tu contraseña recientemente. Intenta de nuevo en unos minutos." }
```

### Response — 502 (el proveedor de identidad falló)
```json
{ "error": "No se pudo completar el reseteo en este momento. Intenta más tarde." }
```
Importante: esta respuesta de error **no crea nada** (ni ticket ni fila
pendiente) — simplemente falla, y el estudiante puede volver a intentar
desde el chat. Es la única forma de mantener "cero intervención humana" sin
inventar una cola de reintentos manual.

## 3. Nuevo workflow de n8n

`workflow-resetear-contrasena-correo.json` — nodos en orden:

1. **Webhook** (POST, headerAuth) + **Webhook (OPTIONS)** — mismo patrón
   CORS que el resto.
2. **Buscar Estudiante (Postgres)** — `SELECT id, cedula, nombres, correo AS "correoInstitucional" FROM estudiantes WHERE cedula = $1`.
3. **IF ¿Existe el estudiante?** → si no, `Responder: 404`.
4. **Verificar Sesión Validada (Postgres)** — la consulta de §8.
5. **IF ¿Tiene sesión válida?** → si no, `Responder: 403`.
6. **Verificar Cooldown (Postgres)** — último `ResetCorreoEjecutado` en
   `eventos` para esta cédula, rechazar si fue hace menos de N minutos
   (ver §4).
7. **IF ¿Puede resetear ahora?** → si no, `Responder: 429`.
8. **Generar Contraseña Temporal (Code)** — random seguro, ver §5.
9. **[Nodo específico del proveedor] Resetear en <Google/Microsoft/AD>**
   (`HTTP Request` o nodo dedicado, con credencial de n8n tipo
   OAuth2/Service Account/LDAP según corresponda — ver §5).
10. **IF ¿Reseteo exitoso?** → si no, `Responder: 502`.
11. **Registrar Auditoría (Postgres)** — INSERT en `eventos` (§7), **nunca**
    con la contraseña en el payload.
12. **Enviar Nueva Contraseña (Correo)** — al `correoInstitucional`, con la
    contraseña temporal y la indicación de cambiarla al iniciar sesión.
13. **Responder: Reseteo exitoso** (200, sin la contraseña en el body).

## 4. Validaciones

- Cédula existe en `estudiantes` (no se exige `estado_matricula =
  'MATRICULADO'` — un problema de acceso al correo no debería depender del
  estado académico; si tu tutora prefiere restringirlo, es un solo IF
  extra).
- Sesión validada reciente (§8) — el corazón de esta propuesta.
- **Cooldown/rate limit**: máximo 1 reseteo exitoso cada, por ejemplo,
  15 minutos por cédula. Sin esto, un error del estudiante (o un script)
  podría machacar la cuenta con resets sucesivos, o disparar los límites de
  tasa del proveedor (Google/Microsoft bloquean cuentas de servicio que
  hacen demasiadas llamadas administrativas seguidas).
- El correo que se resetea es **siempre** el que devuelve la base de datos
  académica (`estudiantes.correo`), nunca uno que mande el cliente — evita
  que alguien intente resetear la cuenta de otra persona modificando el
  request.

## 5. APIs administrativas por proveedor

### Opción A — Google Workspace
- **API**: Admin SDK Directory API, `users.update` (`PATCH
  https://admin.googleapis.com/admin/directory/v1/users/{correo}`) con
  `{ "password": "<nueva>", "changePasswordAtNextLogin": true }`.
- **Credencial en n8n**: cuenta de servicio (Service Account) de Google
  Cloud con **domain-wide delegation** habilitada, autorizada en el Admin
  Console del instituto para el scope
  `https://www.googleapis.com/auth/admin.directory.user`.
- **Riesgo a explicar a tu tutora**: ese scope permite cambiar la
  contraseña de **cualquier** usuario del dominio, incluidos
  administradores, si no se restringe más. Mitigación recomendada: crear un
  **rol de administrador personalizado** en Google Workspace con el
  privilegio mínimo "Reset user passwords" (no "Super Admin"), asignado a
  una cuenta dedicada solo para esta integración — nunca usar credenciales
  de un admin humano real.
- **Nodo en n8n**: `HTTP Request` con credencial `Google Service Account`
  (soportada nativamente) + el scope de arriba.

### Opción B — Microsoft 365 / Entra ID
- **API**: Microsoft Graph, `PATCH
  https://graph.microsoft.com/v1.0/users/{id}` con
  `{ "passwordProfile": { "password": "<nueva>", "forceChangePasswordNextSignIn": true } }`.
- **Credencial en n8n**: App Registration en Entra ID (client
  credentials/certificado), con permiso de aplicación `User.ReadWrite.All`
  **o**, más seguro, asignar al service principal el **rol administrativo
  con privilegios mínimos "Password Administrator"** (Entra ID tiene roles
  predefinidos de bajo privilegio para esto, a diferencia de Google) —
  recomendado sobre `User.ReadWrite.All`, que es más amplio de lo
  necesario.
- **Nodo en n8n**: `HTTP Request` con credencial `Microsoft OAuth2
  (Client Credentials)`.

### Opción C — Active Directory local / LDAP
- **API**: no es REST — se hace vía LDAP (protocolo `LDAPS`, puerto 636),
  operación "modify" sobre el atributo `unicodePwd` (AD) o `userPassword`
  (LDAP genérico).
- **Credencial**: cuenta de servicio de AD con el permiso delegado **"Reset
  password"** sobre la OU específica donde están las cuentas de
  estudiantes (delegación de OU, **no** Domain Admin — esto se configura
  con el asistente "Delegate Control" en AD Users and Computers).
- **Nodo en n8n**: n8n no trae un nodo nativo de AD — se usa el nodo
  genérico `LDAP` (existe como nodo comunitario) o un `Code` node con una
  librería tipo `ldapjs` corriendo dentro de un contenedor con acceso de
  red al controlador de dominio (esto último requiere que el servidor de
  n8n tenga conectividad de red directa al AD del instituto, lo cual casi
  siempre implica que n8n tendría que estar desplegado **dentro** de la
  red del instituto, no en un VPS externo).

**Recomendación concreta**: preguntar a TI del instituto cuál de las tres
usan (lo más probable en un dominio `.edu.ec` moderno es Google Workspace o
Microsoft 365, no AD local) y pedirles que ellos mismos generen la
credencial con el privilegio mínimo — nunca pedir la contraseña de una
cuenta de super-admin existente.

## 6. Cómo devolver la respuesta al chatbot

Ver §2 — un JSON de estado (`RESETEADO` / error), **sin la contraseña en el
body**. La app solo necesita mostrar "listo, revisa tu correo" o el mensaje
de error correspondiente; no necesita renderizar la contraseña en pantalla.

## 7. Auditoría

INSERT en la tabla `eventos` ya existente (mismo patrón que
`TicketCreado`/`TicketAsignado`):

```sql
INSERT INTO eventos (tipo, payload, origen)
VALUES ('ResetCorreoEjecutado', $1::jsonb, 'chatbot');
```

Payload sugerido: `{ "cedula": "...", "correoInstitucional": "...",
"resultado": "EXITO", "proveedor": "google_workspace", "timestamp": "..."
}`. **Nunca** incluir la contraseña generada, ni siquiera hasheada — no hay
motivo para guardarla en ningún lado.

Si tu tutora pide algo más formal/inmutable (por ejemplo para una auditoría
de seguridad institucional), el dump real ya trae una tabla `auditoria`
—hoy fuera de alcance de esta app— que se podría activar específicamente
para este trámite dado que es sensible.

## 8. Cómo evitar reseteos sin OTP válido (el punto crítico)

n8n no tiene "sesión" entre requests — cada llamada al webhook es
independiente. Hay que dejar una prueba explícita de que el estudiante pasó
por el OTP antes de aceptar un reseteo.

**Diseño recomendado (reutiliza lo que ya existe, sin tablas nuevas):**
cuando `/verificar-ticket` valida el OTP, ya marca `otp_codigos.usado =
true`. El nuevo endpoint valida:

```sql
SELECT 1 FROM otp_codigos
WHERE cedula = $1 AND usado = true
  AND creado_en > NOW() - INTERVAL '20 minutes'
ORDER BY creado_en DESC LIMIT 1
```

Si no hay fila, 403 — el estudiante debe volver a verificar su identidad
antes de poder resetear. La ventana de 20 minutos es ajustable; debe ser
lo bastante corta para que un OTP usado hace horas no sirva como llave
maestra, pero lo bastante larga para que el estudiante no tenga que
re-verificar si tarda unos minutos navegando el menú antes de llegar a esta
opción.

**Alternativa más robusta (para si el chatbot crece):** tabla
`sesiones_chatbot(cedula, token, creado_en, expira_en)`, con un token
opaco devuelto por `/verificar-ticket` y exigido en el header
`Authorization` de cada endpoint sensible. Es el patrón "correcto" de una
API con sesiones reales, pero es más trabajo y hoy ningún otro endpoint de
este proyecto usa tokens — lo dejo documentado como evolución futura, no
como parte de esta propuesta inmediata.

## 9. Cómo eliminar la lógica de tickets para este trámite

- **App (Angular)**: `estudiante.service.ts` pierde `'RESET_CORREO'` del
  tipo aceptado por `crearTicketSolicitud(...)` y gana un método nuevo
  `resetearContrasenaCorreo(cedula)` que llama a
  `/resetear-contrasena-correo`. En `chat.page.ts`, los métodos
  `iniciarReseteoCorreo/confirmarReseteoCorreo/cancelarReseteoCorreo` se
  reescriben para llamar a este servicio nuevo en vez de
  `crearTicketSolicitud` — el texto de confirmación cambia (ya no dice
  "Soporte Técnico procesará tu solicitud en unos días", dice "se
  reseteará al confirmar").
- **Base de datos**: no hace falta borrar el ticket ya creado
  (`TK-000005`, dato histórico) ni la fila `RESET_CORREO` de
  `tipos_solicitud` — simplemente deja de usarse desde la app. Si se
  quiere dejar explícito que ya no genera tickets, se puede actualizar
  `tipos_solicitud.genera_ticket = false` para esa fila (mismo patrón que
  `CERT_MATRICULA`), aunque en la práctica ya no se le llama desde
  `crear-ticket-solicitud` en absoluto.
- **n8n**: `workflow-crear-ticket-solicitud.json` no necesita ningún
  cambio (es genérico) — simplemente deja de recibir `tipoTramite:
  "RESET_CORREO"` porque la app ya no lo manda.

---

## Qué falta para poder implementar esto de verdad

1. **Confirmar el proveedor real** (§0) — sin esto, el nodo del §5 no se
   puede construir ni probar.
2. Que alguien de TI del instituto cree la credencial con privilegio
   mínimo (rol acotado, no un admin general) y la comparta para
   configurarla como credencial en n8n.
3. Decidir la ventana de "sesión validada" del §8 (recomendación: 20 min).
4. Decidir el cooldown del §4 (recomendación: 15 min entre resets
   exitosos).

En cuanto tengas el proveedor confirmado, puedo construir el workflow
completo (§3) dejando únicamente el nodo del §5 pendiente de la credencial
real — igual que se hizo con SMTP y Postgres en el resto del proyecto
(`REEMPLAZAR con credenciales reales`).
