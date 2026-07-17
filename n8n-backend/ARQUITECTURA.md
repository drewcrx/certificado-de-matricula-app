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
PostgreSQL una vez que esté disponible — hoy se trabaja con un esquema
temporal (ver `ESQUEMA-BD.md`) que se adaptará cuando llegue el definitivo.

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
3. **Datos** — PostgreSQL. Por ahora un esquema temporal propio; a futuro, el
   esquema compartido con el equipo de la web (cuando esté definido, se migra
   sin tocar la capa de presentación, solo ajustando las queries dentro de
   los workflows).

Esta separación es la que permite que, cuando llegue el esquema real de base
de datos, **solo se toquen los nodos Postgres de los workflows** — la app y el
contrato de endpoints no cambian.

---

## Organización de los workflows (por dominio)

```
workflows/
  workflow-consultar-estudiante.json        # dominio: estudiantes
  workflow-enviar-ticket-verificacion.json  # dominio: verificación (OTP)
  workflow-verificar-ticket.json            # dominio: verificación (OTP)
  workflow-consultar-tickets.json           # dominio: trámites/tickets
  workflow-crear-ticket-solicitud.json      # dominio: trámites/tickets (genérico)
  workflow-generar-certificado.json         # dominio: trámites/tickets (especializado)
```

Cada dominio se agrupa por prefijo de nombre. Cuando el proyecto crezca (más
trámites, más integraciones), los workflows nuevos se agregan siguiendo el
mismo patrón: un archivo = un endpoint = una responsabilidad.

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

## Seguridad (a aplicar cuando se despliegue la instancia real de n8n)

- **Autenticación del webhook**: agregar un nodo IF justo después del
  Webhook que valide un header `X-Api-Key` contra una credencial/variable de
  entorno de n8n. Sin esto, cualquiera que descubra la URL puede llamar los
  endpoints.
- **Credenciales de Postgres**: nunca hardcodear usuario/contraseña en los
  nodos — usar el sistema de credenciales de n8n (ya se dejó el placeholder
  `REEMPLAZAR` en todos los nodos Postgres).
- **Variables de entorno** (`$env` en n8n) para todo lo que cambie entre
  desarrollo/producción: URL de verificación pública, dominio del correo
  institucional, credenciales SMTP.

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

Con el menú ya definido en la app, hay dos tipos de trámite:

| Trámite | Automatizado | Genera documento |
|---|---|---|
| Certificado de Matrícula | ✅ Sí (workflow especializado) | ✅ Sí (QR) |
| Récord Académico | ❌ No (requiere revisión) | Pendiente |
| Certificado de Vinculación | ❌ No (requiere revisión) | Pendiente |
| Anulación de Matrícula | ❌ No (requiere revisión) | ❌ No |

Esto se modela con la tabla `tipos_tramite` (ver `ESQUEMA-BD.md`): agregar un
trámite nuevo es **una fila en una tabla**, no un despliegue de código. Los
trámites no automatizados usan el workflow genérico
`workflow-crear-ticket-solicitud.json`, que simplemente registra el ticket en
estado `EN_PROCESO` para que el personal administrativo lo resuelva
manualmente (fuera del alcance de esta app). El Certificado de Matrícula, al
ser el único 100% automático, conserva su propio workflow especializado.

---

## Roadmap de fases

1. **Fase actual (hecha)**: consultar-estudiante, enviar/verificar-ticket,
   generar-certificado-matricula, consultar-tickets, crear-ticket-solicitud
   genérico. Esquema temporal de base de datos.
2. **Fase 2**: conectar los otros 3 trámites del menú (hoy "en construcción"
   en la app) al endpoint genérico `crear-ticket-solicitud` — es un cambio
   pequeño en la app (quitar `disponible:false`), el backend ya queda listo
   desde esta fase.
3. **Fase 3**: cuando exista el esquema real compartido con la web, migrar
   las queries de los nodos Postgres (sin tocar contrato ni app).
4. **Fase 4**: autenticación de webhooks, sub-workflows reutilizables,
   variables de entorno formales, error workflow global en n8n.

---

## Archivos de este directorio

- `ARQUITECTURA.md` — este documento.
- `ESQUEMA-BD.md` — esquema temporal de PostgreSQL (todas las tablas).
- `CONTRATO-API.md` — especificación endpoint por endpoint (request/response).
- `workflows/` — los workflows de n8n, importables, que implementan el
  contrato.
