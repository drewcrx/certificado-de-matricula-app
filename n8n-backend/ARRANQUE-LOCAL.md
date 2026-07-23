# Arranque local — n8n + PostgreSQL

Guía para levantar el backend completo en tu PC y conectarlo a la app.
Tiempo estimado: 15-20 minutos la primera vez.

---

## Requisitos

- Docker Desktop instalado y corriendo
- La app Ionic (`certi-matricula-app/`) con sus dependencias instaladas

---

## 1. Levantar los contenedores

Desde esta carpeta (`n8n-backend/`):

```bash
docker compose up -d
```

Espera unos 30 segundos. Verifica que ambos contenedores estén en verde:

```bash
docker compose ps
```

- `yavirac-db` → PostgreSQL con las tablas ya creadas y los 3 estudiantes de prueba cargados
- `yavirac-n8n` → n8n disponible en http://localhost:5678

---

## 2. Configurar n8n

Abre http://localhost:5678 en el navegador y crea una cuenta local (solo la primera vez).

### 2a. Crear credencial PostgreSQL

Settings → Credentials → New → Postgres

| Campo | Valor |
|---|---|
| Host | `postgres` |
| Port | `5432` |
| Database | `yavirac` |
| User | `yavirac` |
| Password | `yavirac2026` |
| Schema | `public` |

Guarda con el nombre **"Yavirac DB"**.

### 2b. Crear credencial SMTP (Mailtrap para pruebas)

> Mailtrap es una bandeja de entrada de pruebas — los correos se "envían" pero
> no llegan a nadie real. Ideal para probar sin credenciales institucionales.
> Crea cuenta gratis en https://mailtrap.io → Email Testing → SMTP Settings.

Settings → Credentials → New → SMTP

| Campo | Valor (lo ves en Mailtrap) |
|---|---|
| Host | `sandbox.smtp.mailtrap.io` |
| Port | `2525` |
| User | (el que da Mailtrap) |
| Password | (el que da Mailtrap) |

Guarda con el nombre **"SMTP Pruebas"**.

### 2c. Crear credencial Header Auth (protege los webhooks)

Todos los webhooks POST requieren un header `X-Api-Key` — sin esto, n8n
rechaza la petición con 403 antes de ejecutar el workflow (ver
`CONTRATO-API.md`, sección de autenticación).

Settings → Credentials → New → Header Auth

| Campo | Valor |
|---|---|
| Name | `X-Api-Key` |
| Value | el mismo valor que tengas en `environment.apiKey` de la app |

Guarda con el nombre **"API Key App Certificado"**.

### 2d. Importar los 12 workflows

> **Si ya tenías estos workflows importados de antes (versión vieja):**
> bórralos primero (Workflows → abrir cada uno → menú ⋯ → Delete). Las
> versiones nuevas apuntan al esquema REAL (`estudiantes.correo`, `carreras`,
> `tickets`, `otp_codigos`, etc.) — las viejas apuntaban a tablas que ya no
> existen (`tickets_verificacion`, `tipos_tramite`...) y van a fallar.

Workflows → Import from File → seleccionar uno a uno desde `workflows/`:

1. `workflow-consultar-estudiante.json`
2. `workflow-enviar-ticket-verificacion.json`
3. `workflow-verificar-ticket.json`
4. `workflow-generar-certificado.json`
5. `workflow-enviar-certificado-pdf.json`
6. `workflow-verificar-certificado.json` (público — la verificación por QR)
7. `workflow-consultar-tickets.json`
8. `workflow-crear-ticket-solicitud.json`
9. `workflow-resetear-contrasena-correo.json`
10. `workflow-consultar-laboratorios.json` (rol Docente)
11. `workflow-reportar-incidencia-laboratorio.json` (rol Docente)
12. `workflow-detectar-respuesta-ticket.json` (sin Webhook — ver nota abajo)

En cada workflow:
- Abrir el nodo **Webhook** (el POST, no el OPTIONS) → sección Credentials →
  seleccionar **"API Key App Certificado"**
- Abrir **cada nodo Postgres** → seleccionar credencial **"Yavirac DB"**
  (hay varios nodos Postgres por workflow, no solo el primero)
- En los workflows de envío de correo, abrir el nodo **Send Email** → seleccionar **"SMTP Pruebas"**
- En `workflow-consultar-estudiante.json`, el nodo "Verificar CAPTCHA (Google)"
  ya trae la Secret Key real embebida — no necesita credencial de n8n.
- Activar el workflow con el toggle superior derecho, y darle **Publicar**

**`workflow-detectar-respuesta-ticket.json` es distinto**: no tiene nodo
Webhook (lo dispara un **Gmail Trigger**, sondeando la casilla
`tramites@yavirac.edu.ec`), así que no lleva la credencial de API Key ni
Postgres en un nodo Webhook — en su lugar necesita una credencial Gmail
OAuth2 en el nodo del trigger. Si todavía no tienes esa credencial, puedes
dejarlo sin activar; el resto de la app funciona igual, solo que el cierre
automático de tickets por respuesta de correo no corre hasta que la
configures.

---

## Troubleshooting

**"No puedo ingresar a n8n" / la página no carga:** casi siempre es que
Docker Desktop todavía no terminó de arrancar su motor (el ícono de la
bandeja sigue "iniciando"). Espera 30-60 segundos después de abrir Docker
Desktop y vuelve a intentar. Para confirmar que ya está listo:
```bash
docker compose ps
```
Ambos contenedores (`yavirac-db`, `yavirac-n8n`) deben decir `Up` (el de
Postgres además `healthy`).

**Al enviar la cédula la app se queda sin respuesta / error genérico:**
revisa la ejecución en n8n (Executions, en el menú lateral) — casi siempre
es un nodo Postgres marcado en rojo por una columna/tabla que no coincide.
Compara contra `ESQUEMA-BD.md`.

---

## 3. Conectar la app

Edita `certi-matricula-app/src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  usarMock: false,
  n8nBaseUrl: 'http://localhost:5678/webhook',
  apiKey: '<el mismo valor que pusiste en la credencial Header Auth>'
};
```

Haz lo mismo en `environment.prod.ts`.

---

## 4. Correr la app

```bash
cd ../certi-matricula-app
npx ng serve
```

Abre http://localhost:4200 y prueba con la cédula `1702030402`.

---

## Credenciales de prueba

| Cédula | Nombre | Estado |
|---|---|---|
| `1702030402` | Andrew Carrera | MATRICULADO |
| `1122334459` | Mishell Torres | MATRICULADO |
| `0908070600` | Kevin Andrade | NO_MATRICULADO |

---

## Comandos útiles

```bash
# Ver logs de n8n en tiempo real
docker compose logs -f n8n

# Ver logs de PostgreSQL
docker compose logs -f postgres

# Detener todo
docker compose down

# Detener y borrar datos (reset completo)
docker compose down -v
```

---

## Cuando lleguen las credenciales reales

1. Reemplazar las credenciales de Postgres en n8n por las del servidor institucional
2. Reemplazar las credenciales SMTP por las del correo institucional YAVIRAC
3. Generar un `X-Api-Key` nuevo (no reusar el de pruebas) y actualizarlo en la
   credencial Header Auth de n8n **y** en `environment.apiKey` de la app
4. Cambiar `n8nBaseUrl` en los environments al dominio real de n8n
5. Compilar el APK: `npx ionic build --prod`
