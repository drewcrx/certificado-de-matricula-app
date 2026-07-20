-- =============================================================
-- YAVIRAC — Esquema REAL de base de datos (ver ESQUEMA-BD.md)
-- Este archivo se ejecuta automáticamente en el primer arranque
-- del contenedor PostgreSQL (docker-entrypoint-initdb.d).
--
-- Reemplaza la versión anterior (esquema temporal/placeholder).
-- Este SÍ coincide con `yavibot_dump.sql` (el dump real compartido
-- por el usuario) y con lo que consultan los 6 workflows de n8n.
-- Solo incluye un subconjunto de datos de prueba (no los ~1400
-- estudiantes reales) — suficiente para probar la app localmente.
-- =============================================================

SET search_path TO public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── TABLAS ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS carreras (
  id      SERIAL PRIMARY KEY,
  codigo  VARCHAR(20)  NOT NULL UNIQUE,
  nombre  VARCHAR(150) NOT NULL
);

CREATE TABLE IF NOT EXISTS periodos_academicos (
  id            SERIAL PRIMARY KEY,
  codigo        VARCHAR(10) NOT NULL UNIQUE,
  nombre        VARCHAR(60) NOT NULL,
  fecha_inicio  DATE NOT NULL,
  fecha_fin     DATE NOT NULL,
  vigente       BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_periodo_vigente ON periodos_academicos (vigente) WHERE vigente;

CREATE TABLE IF NOT EXISTS estudiantes (
  id                  SERIAL PRIMARY KEY,
  cedula              VARCHAR(10)  NOT NULL UNIQUE CHECK (cedula ~ '^[0-9]{10}$'),
  nombres             VARCHAR(150) NOT NULL,
  carrera_id          BIGINT NOT NULL REFERENCES carreras(id),
  nivel               VARCHAR(30) NOT NULL,
  paralelo            VARCHAR(20) NOT NULL,
  estado_matricula    VARCHAR(20) NOT NULL
                      CHECK (estado_matricula IN ('MATRICULADO','RETIRADO','REPROBADO','APROBADO')),
  correo              VARCHAR(150) NOT NULL UNIQUE,
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  modalidad           VARCHAR(20) NOT NULL DEFAULT 'PRESENCIAL'
                      CHECK (modalidad IN ('PRESENCIAL','DUAL','EN LINEA','SEMIPRESENCIAL')),
  periodo_ingreso_id  BIGINT REFERENCES periodos_academicos(id),
  nivel_ingreso       VARCHAR(30) NOT NULL DEFAULT 'Primer nivel'
);
CREATE INDEX IF NOT EXISTS ix_estudiantes_estado ON estudiantes (estado_matricula);

CREATE TABLE IF NOT EXISTS otp_codigos (
  id          SERIAL PRIMARY KEY,
  cedula      VARCHAR(10) NOT NULL,
  correo      VARCHAR(150),
  codigo_hash VARCHAR(255) NOT NULL,
  canal       VARCHAR(20) NOT NULL CHECK (canal IN ('chatbot','panel_recovery')),
  expira_en   TIMESTAMPTZ NOT NULL,
  usado       BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_otp_cedula ON otp_codigos (cedula, canal);

CREATE TABLE IF NOT EXISTS qr_codigos (
  id              SERIAL PRIMARY KEY,
  identificador   UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  estudiante_id   BIGINT NOT NULL REFERENCES estudiantes(id),
  certificado_id  BIGINT,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  verificaciones  INT NOT NULL DEFAULT 0,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS certificados (
  id                      SERIAL PRIMARY KEY,
  estudiante_id           BIGINT NOT NULL REFERENCES estudiantes(id),
  tipo                    VARCHAR(40) NOT NULL DEFAULT 'CERT_MATRICULA',
  qr_id                   BIGINT NOT NULL UNIQUE REFERENCES qr_codigos(id),
  pdf_path                VARCHAR(300),
  fecha                   DATE NOT NULL DEFAULT CURRENT_DATE,
  hora                    TIME NOT NULL DEFAULT CURRENT_TIME,
  creado_en               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  periodo_lectivo_codigo  VARCHAR(10),
  periodo_lectivo_nombre  VARCHAR(60),
  modalidad               VARCHAR(20),
  periodo_ingreso_codigo  VARCHAR(10),
  periodo_ingreso_nombre  VARCHAR(60),
  nivel_ingreso           VARCHAR(30),
  firmante_nombre         VARCHAR(150),
  firmante_cargo          VARCHAR(100),
  CONSTRAINT ux_certificado_estudiante_periodo UNIQUE (estudiante_id, periodo_lectivo_codigo)
);
ALTER TABLE qr_codigos ADD CONSTRAINT fk_qr_certificado FOREIGN KEY (certificado_id) REFERENCES certificados(id);

CREATE TABLE IF NOT EXISTS tipos_solicitud (
  id             SERIAL PRIMARY KEY,
  codigo         VARCHAR(40) NOT NULL UNIQUE,
  nombre         VARCHAR(100) NOT NULL,
  genera_ticket  BOOLEAN NOT NULL,
  ambito         VARCHAR(20) NOT NULL CHECK (ambito IN ('carrera','vinculacion','laboratorio','ninguno'))
);

CREATE TABLE IF NOT EXISTS usuarios_panel (
  id              SERIAL PRIMARY KEY,
  cedula          VARCHAR(10) NOT NULL UNIQUE CHECK (cedula ~ '^[0-9]{10}$'),
  nombres         VARCHAR(150) NOT NULL,
  correo          VARCHAR(150) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  rol_id          BIGINT NOT NULL,
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets (
  id                  SERIAL PRIMARY KEY,
  codigo              VARCHAR(15) UNIQUE,
  tipo_solicitud_id   BIGINT NOT NULL REFERENCES tipos_solicitud(id),
  estudiante_id       BIGINT NOT NULL REFERENCES estudiantes(id),
  carrera_id          BIGINT NOT NULL REFERENCES carreras(id),
  nivel               VARCHAR(30) NOT NULL,
  paralelo            VARCHAR(20) NOT NULL,
  descripcion         TEXT,
  estado              VARCHAR(15) NOT NULL DEFAULT 'Pendiente'
                      CHECK (estado IN ('Pendiente','En Proceso','Resuelto')),
  responsable_id      BIGINT REFERENCES usuarios_panel(id),
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_tickets_estado ON tickets (estado);
CREATE INDEX IF NOT EXISTS ix_tickets_estudiante ON tickets (estudiante_id);
CREATE INDEX IF NOT EXISTS ix_tickets_responsable ON tickets (responsable_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_ticket_estudiante_tipo_activo ON tickets (estudiante_id, tipo_solicitud_id) WHERE estado IN ('Pendiente','En Proceso');

CREATE TABLE IF NOT EXISTS asignaciones_responsables (
  id                  SERIAL PRIMARY KEY,
  tipo_solicitud_id   BIGINT NOT NULL REFERENCES tipos_solicitud(id),
  carrera_id          BIGINT REFERENCES carreras(id),
  usuario_id          BIGINT NOT NULL REFERENCES usuarios_panel(id),
  vigente             BOOLEAN NOT NULL DEFAULT TRUE,
  semestre            VARCHAR(20),
  creado_en           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_asignacion_vigente ON asignaciones_responsables (tipo_solicitud_id, COALESCE(carrera_id, -1)) WHERE vigente;

CREATE TABLE IF NOT EXISTS eventos (
  id          SERIAL PRIMARY KEY,
  tipo        VARCHAR(50) NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  origen      VARCHAR(50),
  procesado   BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_eventos_pendientes ON eventos (procesado) WHERE NOT procesado;

CREATE TABLE IF NOT EXISTS configuracion_sistema (
  id               SERIAL PRIMARY KEY,
  clave            VARCHAR(60) NOT NULL UNIQUE,
  valor            VARCHAR(200) NOT NULL,
  descripcion      VARCHAR(200),
  actualizado_por  VARCHAR(50),
  actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id           SERIAL PRIMARY KEY,
  codigo       VARCHAR(40) NOT NULL UNIQUE,
  nombre       VARCHAR(80) NOT NULL,
  descripcion  VARCHAR(200)
);

-- Rol "Docente": segunda identidad que puede iniciar el mismo flujo del
-- chatbot (cédula + OTP), en tablas separadas de estudiantes (ver
-- ARQUITECTURA.md, sección "Rol Docente").
CREATE TABLE IF NOT EXISTS docentes (
  id              SERIAL PRIMARY KEY,
  cedula          VARCHAR(10) NOT NULL UNIQUE CHECK (cedula ~ '^[0-9]{10}$'),
  nombre_docente  VARCHAR(150) NOT NULL,
  correo          VARCHAR(150) NOT NULL UNIQUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS laboratorios (
  id                SERIAL PRIMARY KEY,
  codigo            VARCHAR(20) NOT NULL UNIQUE,
  nombre            VARCHAR(100) NOT NULL,
  cantidad_equipos  INT NOT NULL DEFAULT 0
);

-- Foto opcional adjunta al reportar una incidencia de laboratorio (rol
-- Docente). El archivo se guarda en disco (volumen /data/storage/uploads,
-- ver docker-compose.yml) y aquí solo se registra la ruta relativa
-- ("storage/uploads/<archivo>"), no el binario — mismo patrón que usaría
-- el sistema real (columna `ruta`, no un BLOB).
CREATE TABLE IF NOT EXISTS adjuntos (
  id            SERIAL PRIMARY KEY,
  tipo          VARCHAR(30) NOT NULL,
  ruta          VARCHAR(300) NOT NULL,
  mime          VARCHAR(60) NOT NULL CHECK (mime IN ('image/jpeg','image/png')),
  tamano_bytes  INT NOT NULL CHECK (tamano_bytes <= 5242880),
  hash          VARCHAR(64),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alertas (
  id              SERIAL PRIMARY KEY,
  codigo          VARCHAR(15) UNIQUE,
  laboratorio_id  BIGINT NOT NULL REFERENCES laboratorios(id),
  descripcion     TEXT NOT NULL,
  adjunto_id      BIGINT REFERENCES adjuntos(id),
  profesor_id     BIGINT NOT NULL REFERENCES usuarios_panel(id),
  estado          VARCHAR(15) NOT NULL DEFAULT 'Pendiente'
                  CHECK (estado IN ('Pendiente','En revisión','Resuelta')),
  responsable_id  BIGINT REFERENCES usuarios_panel(id),
  ticket_id       BIGINT REFERENCES tickets(id),
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_alertas_estado ON alertas (estado);
CREATE INDEX IF NOT EXISTS ix_alertas_profesor ON alertas (profesor_id);

CREATE TABLE IF NOT EXISTS alerta_historial (
  id               SERIAL PRIMARY KEY,
  alerta_id        BIGINT NOT NULL REFERENCES alertas(id) ON DELETE CASCADE,
  estado_anterior  VARCHAR(15),
  estado_nuevo     VARCHAR(15) NOT NULL,
  observacion      TEXT,
  usuario_id       BIGINT REFERENCES usuarios_panel(id),
  creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── DATOS DE PRUEBA ───────────────────────────────────────────

INSERT INTO carreras (id, codigo, nombre) OVERRIDING SYSTEM VALUE VALUES
  (1, 'ACE', 'Arte Culinario Ecuatoriano'),
  (2, 'DSW', 'Desarrollo de Software'),
  (3, 'DMO', 'Diseño de Modas'),
  (4, 'GNT', 'Guía Nacional de Turismo'),
  (5, 'MKD', 'Marketing Digital')
ON CONFLICT (codigo) DO NOTHING;
SELECT setval('carreras_id_seq', 5, true);

INSERT INTO periodos_academicos (id, codigo, nombre, fecha_inicio, fecha_fin, vigente) OVERRIDING SYSTEM VALUE VALUES
  (1, '2025-II', 'agosto 2025-febrero 2026', '2025-08-01', '2026-02-28', false),
  (2, '2026-I', 'mayo-septiembre 2026', '2026-05-01', '2026-09-30', true)
ON CONFLICT (codigo) DO NOTHING;
SELECT setval('periodos_academicos_id_seq', 2, true);

INSERT INTO tipos_solicitud (id, codigo, nombre, genera_ticket, ambito) OVERRIDING SYSTEM VALUE VALUES
  (1, 'CERT_MATRICULA', 'Certificado de Matrícula', false, 'ninguno'),
  (2, 'RECORD_ACADEMICO', 'Récord Académico', true, 'carrera'),
  (3, 'CERT_VINCULACION', 'Certificado de Vinculación', true, 'vinculacion'),
  (4, 'ANULACION_MATRICULA', 'Anulación de Matrícula', true, 'carrera'),
  (5, 'ALERTA_LAB', 'Alerta de Laboratorio', true, 'laboratorio')
ON CONFLICT (codigo) DO NOTHING;
SELECT setval('tipos_solicitud_id_seq', 5, true);

INSERT INTO configuracion_sistema (clave, valor, descripcion) VALUES
  ('institucion.nombre_oficial', 'Instituto Superior Tecnológico de Turismo y Patrimonio "YAVIRAC"', 'Razón social completa para documentos oficiales'),
  ('institucion.ciudad_emision', 'Quito', 'Ciudad que aparece en la frase de emisión del certificado'),
  ('firma.nombre', 'Mtr. Alexandra Gordon M.', 'Nombre de quien firma los certificados generados'),
  ('firma.cargo', 'Secretaria General (s)', 'Cargo de quien firma los certificados generados')
ON CONFLICT (clave) DO NOTHING;

INSERT INTO roles (id, codigo, nombre, descripcion) OVERRIDING SYSTEM VALUE VALUES
  (1, 'PROFESOR', 'Profesor', 'Reporta incidencias de laboratorio'),
  (2, 'COORDINADOR', 'Coordinador de Carrera', 'Atiende tickets académicos de sus carreras'),
  (3, 'RESP_VINCULACION', 'Responsable de Vinculación', 'Atiende certificados de vinculación'),
  (4, 'RESP_LABORATORIOS', 'Responsable de Laboratorios', 'Gestiona alertas de laboratorio')
ON CONFLICT (codigo) DO NOTHING;
SELECT setval('roles_id_seq', 4, true);

INSERT INTO usuarios_panel (id, cedula, nombres, correo, password_hash, rol_id) OVERRIDING SYSTEM VALUE VALUES
  (1, '1710000001', 'Juan Pérez', 'juan.perez@yavirac.edu.ec', '$2b$10$0QtCdZxm3aIiCJaDJjQmbeF1PofnoarFzwmhE8JMR4gBEiCvEwvW.', 2),
  (2, '1710000002', 'María López', 'maria.lopez@yavirac.edu.ec', '$2b$10$0QtCdZxm3aIiCJaDJjQmbeF1PofnoarFzwmhE8JMR4gBEiCvEwvW.', 3),
  (3, '1710000003', 'Carlos Ruiz', 'carlos.ruiz@yavirac.edu.ec', '$2b$10$0QtCdZxm3aIiCJaDJjQmbeF1PofnoarFzwmhE8JMR4gBEiCvEwvW.', 4)
ON CONFLICT (cedula) DO NOTHING;
SELECT setval('usuarios_panel_id_seq', 3, true);

INSERT INTO asignaciones_responsables (tipo_solicitud_id, carrera_id, usuario_id, vigente, semestre) VALUES
  (2, 1, 1, true, '2026-1'),
  (2, 2, 1, true, '2026-1'),
  (4, 1, 1, true, '2026-1'),
  (4, 2, 1, true, '2026-1'),
  (3, NULL, 2, true, '2026-1'),
  (5, NULL, 3, true, '2026-1');

-- Laboratorios reales (sin datos sensibles — nombres/códigos institucionales).
INSERT INTO laboratorios (id, codigo, nombre, cantidad_equipos) OVERRIDING SYSTEM VALUE VALUES
  (1, 'LAB-01', 'Laboratorio de Tolouse', 20),
  (2, 'LAB-02', 'Laboratorio de Xian', 25),
  (3, 'LAB-03', 'Laboratorio de Yasuni', 15),
  (4, 'LAB-04', 'Laboratorio de Ninive', 18),
  (5, 'LAB-05', 'Laboratorio de Sarasota', 20)
ON CONFLICT (codigo) DO NOTHING;
SELECT setval('laboratorios_id_seq', 5, true);

-- Docente de PRUEBA (inventado, no es una persona real) — necesario para
-- probar el flujo de "Reportar incidencia en laboratorio". Igual que en el
-- sistema real, cada docente tiene también una cuenta en usuarios_panel con
-- rol PROFESOR (así se resuelve alertas.profesor_id).
INSERT INTO docentes (cedula, nombre_docente, correo) VALUES
  ('1710000009', 'PEREZ SANCHEZ PEDRO (PRUEBA)', 'pedro.sanchez@yavirac.edu.ec')
ON CONFLICT (cedula) DO NOTHING;

INSERT INTO usuarios_panel (cedula, nombres, correo, password_hash, rol_id) VALUES
  ('1710000009', 'PEREZ SANCHEZ PEDRO (PRUEBA)', 'pedro.sanchez@yavirac.edu.ec', '$2b$10$0QtCdZxm3aIiCJaDJjQmbeF1PofnoarFzwmhE8JMR4gBEiCvEwvW.', 1)
ON CONFLICT (cedula) DO NOTHING;

-- Cédulas con dígito verificador módulo 10 ecuatoriano válido.
INSERT INTO estudiantes (id, cedula, nombres, carrera_id, nivel, paralelo, estado_matricula, correo, modalidad, periodo_ingreso_id) OVERRIDING SYSTEM VALUE VALUES
  (1, '1702030402', 'CARRERA ANDREW', 2, 'Octavo', 'A', 'MATRICULADO', 'abv.carrera@yavirac.edu.ec', 'DUAL', 2),
  (2, '1122334459', 'TORRES MISHELL', 2, 'Quinto', 'A', 'MATRICULADO', 'mishell.torres@yavirac.edu.ec', 'PRESENCIAL', 2),
  (3, '0908070600', 'ANDRADE KEVIN', 2, 'Segundo', 'A', 'RETIRADO', 'kevin.andrade@yavirac.edu.ec', 'PRESENCIAL', 2)
ON CONFLICT (cedula) DO NOTHING;
SELECT setval('estudiantes_id_seq', 3, true);
