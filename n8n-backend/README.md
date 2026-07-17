# Backend (n8n) — App de Certificado de Matrícula

Esta es la **API propia de la app móvil**, construida enteramente en n8n
(sin servidor intermedio). Es independiente de la que use el equipo de la
web — ambas comparten la misma base de datos PostgreSQL una vez que exista.

**Empieza por `ARQUITECTURA.md`** — explica por qué n8n es la API completa
(no solo un consumidor), cómo están organizados los workflows por dominio, y
el roadmap de fases. Este README es solo el índice de archivos.

## Contenido

- **`ARQUITECTURA.md`** — diseño general: capas, principios, seguridad,
  patrón de sub-workflows, trámites automáticos vs. manuales, roadmap.
- **`ESQUEMA-BD.md`** — esquema temporal completo de PostgreSQL (todas las
  tablas y cómo se relacionan). Se adapta cuando llegue el esquema real
  compartido con la web; el contrato de endpoints no cambia.
- **`CONTRATO-API.md`** — especificación de los 6 webhooks (request/response
  exactos, ya usados por el mock de la app).
- **`workflows/`** — los 6 workflows de n8n importables que implementan el
  contrato:
  - `workflow-consultar-estudiante.json`
  - `workflow-enviar-ticket-verificacion.json`
  - `workflow-verificar-ticket.json`
  - `workflow-generar-certificado.json` — el único trámite 100% automatizado;
    genera el certificado+QR **y** su ticket de seguimiento en un solo flujo.
  - `workflow-consultar-tickets.json` — historial de trámites del estudiante
    (alimenta "Consultar estado de mis tickets" en la app).
  - `workflow-crear-ticket-solicitud.json` — **genérico**: sirve para
    cualquier trámite sin lógica automática propia (Récord Académico,
    Certificado de Vinculación, Anulación de Matrícula, y los que se agreguen
    a futuro). Agregar un trámite nuevo es una fila en `tipos_tramite`, no un
    workflow nuevo.

## Cómo importar en n8n

1. Crear primero las tablas de `ESQUEMA-BD.md` en tu instancia de PostgreSQL
   (aunque sea con datos de prueba — el esquema real llegará después).
2. Abrir n8n → `Workflows` → `Import from File` (o arrastrar cada `.json`).
3. En los nodos Postgres, configurar las credenciales reales.
4. En `workflow-enviar-ticket-verificacion.json`, configurar además las
   credenciales SMTP del correo que enviará los tickets.
5. Ajustar nombre de tabla/columnas si no coinciden con el esquema real
   cuando llegue (`estudiantes`, `tickets_verificacion`, `tipos_tramite`,
   `tickets_solicitud`, `certificados_matricula`).
6. Activar los 6 workflows y copiar la URL base de los webhooks.
7. Pasarme esa URL base — en la app solo hay que cambiar
   `environment.n8nBaseUrl` y `environment.usarMock = false` (en **ambos**
   `environment.ts` y `environment.prod.ts`).

## Notas

- El código único del certificado (`codigoUnico`) se genera con
  `Math.random()` por simplicidad. En producción se recomienda un UUID. El
  `id` de los tickets sí se genera atómicamente en Postgres con
  `nextval()`, seguro ante solicitudes concurrentes.
- La **idempotencia es un requisito confirmado**, no opcional: dos personas
  (o la misma persona desde dos canales distintos) haciendo el mismo trámite
  deben terminar viendo el mismo QR. Por eso `certificados_matricula` tiene
  `UNIQUE(cedula, periodo_actual)` y el workflow busca antes de crear.
- Estos workflows son una base editable, no un producto terminado: cámbialos
  con libertad según cómo termine modelada la base de datos real.
