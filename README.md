# YaviBot — Certificado de Matrícula

Aplicación móvil (Ionic/Angular) con backend construido enteramente en n8n para
el **Instituto Superior Tecnológico de Turismo y Patrimonio "YAVIRAC"**. Resuelve,
de principio a fin y sin panel administrativo dedicado, los trámites de
Certificado de Matrícula (con verificación pública por código QR), Anulación
de Matrícula, Reseteo de Contraseña de correo institucional, y Reporte de
Incidencias de Laboratorio para el rol Docente.

La identidad del usuario se resuelve con un único flujo — cédula seguida de un
código de verificación (OTP) enviado al correo institucional — sin pantalla de
login. El mismo flujo distingue automáticamente si quien lo usa es estudiante
o docente y adapta el menú.

## Estructura del proyecto

```
certi-matricula-app/   App móvil híbrida (Ionic + Angular + Capacitor)
n8n-backend/            Backend — los workflows de n8n SON la API
```

**Principio de arquitectura**: no hay un servidor Express/NestJS intermedio.
Cada trámite es un workflow de n8n con un nodo Webhook como punto de entrada;
toda la lógica de negocio (validaciones, generación de códigos únicos,
idempotencia) vive dentro de esos workflows, sobre una base de datos
PostgreSQL compartida con el resto del sistema institucional.

## Documentación

- **`n8n-backend/README.md`** — índice del backend: los 10 workflows, cómo
  importarlos en n8n, credenciales necesarias.
- **`n8n-backend/ARQUITECTURA.md`** — diseño general, capas, seguridad
  implementada, trámites automáticos vs. manuales.
- **`n8n-backend/CONTRATO-API.md`** — especificación completa de cada
  endpoint (request/response, reglas de negocio).
- **`n8n-backend/ESQUEMA-BD.md`** — esquema real de PostgreSQL.
- **`n8n-backend/ARRANQUE-LOCAL.md`** — cómo levantar el backend local
  (Docker: n8n + PostgreSQL).
- **`Manual-Tecnico-YaviBot.pdf`** — manual técnico consolidado del sistema
  (arquitectura, API, seguridad, instalación, trazabilidad de requerimientos).

## Cómo ejecutar en local

**Backend:**
```
cd n8n-backend
docker compose up -d
```
Abrir n8n en `http://localhost:5678`, importar los workflows de `workflows/`
y configurar sus credenciales (ver `ARRANQUE-LOCAL.md`).

**App:**
```
cd certi-matricula-app
npm install
npx ng serve
```
Disponible en `http://localhost:4200`.

## Stack

Ionic 8 · Angular 20 · Capacitor 8 · TypeScript · n8n · PostgreSQL 16 ·
Google Workspace Admin SDK · reCAPTCHA v2.
