export interface Estudiante {
  tipoUsuario: 'ESTUDIANTE';
  cedula: string;
  nombres: string;
  apellidos: string;
  correoInstitucional: string;
  carrera: string;
  nivel: string;
  periodoActual: string;
  estadoMatricula: 'MATRICULADO' | 'NO_MATRICULADO';
}

/**
 * Segunda identidad que puede iniciar el mismo flujo del chatbot (cédula +
 * OTP por correo) — no tiene una pantalla de login separada, se identifica
 * automáticamente por no encontrarse en `estudiantes` pero sí en `docentes`.
 */
export interface Docente {
  tipoUsuario: 'DOCENTE';
  cedula: string;
  nombres: string;
  correoInstitucional: string;
}

export type Usuario = Estudiante | Docente;

export interface Laboratorio {
  codigo: string;
  nombre: string;
}

export interface IncidenciaLaboratorio {
  codigo: string;
  laboratorio: string;
  descripcion: string;
  estado: string;
  fechaReporte: string;
  tieneFoto: boolean;
}

export interface EnvioTicketVerificacion {
  correoEnmascarado: string;
  /** Solo viene presente en modo mock, para poder probar el flujo sin correo real. */
  ticketDebugSoloMock?: string;
}

export interface CertificadoMatricula {
  codigoUnico: string;
  cedula: string;
  nombreCompleto: string;
  carrera: string;
  nivel: string;
  periodoActual: string;
  modalidad: string;
  fechaEmision: string;
  urlVerificacion: string;
}

export type OpcionMenu =
  | 'CERTIFICADO_MATRICULA'
  | 'ANULACION_MATRICULA'
  | 'RESET_CORREO'
  | 'ESTADO_TICKETS'
  | 'REPORTAR_INCIDENCIA_LAB'
  | 'FINALIZAR_CONVERSACION';

export interface OpcionChat {
  id: OpcionMenu;
  etiqueta: string;
  icono: string;
  disponible: boolean;
}

export type EstadoTicket = 'EN_PROCESO' | 'COMPLETADO' | 'RECHAZADO';

export interface TicketSolicitud {
  id: string;
  tipo: string;
  estado: EstadoTicket;
  fechaSolicitud: string;
}

export interface ResultadoReseteoCorreo {
  estado: 'RESETEADO';
  correoNotificado: string;
  mensaje: string;
}

/**
 * Respuesta pública del webhook verificar-certificado (el QR del certificado
 * funciona como firma de Secretaría — esta es la validación detrás de esa
 * firma). No requiere sesión ni OTP: cualquiera que escanee el QR llega aquí.
 */
export interface VerificacionCertificado {
  autentico: boolean;
  error?: string;
  codigoUnico?: string;
  nombreCompleto?: string;
  cedula?: string;
  carrera?: string;
  nivel?: string;
  periodoActual?: string;
  modalidad?: string;
  fechaEmision?: string;
  firmanteNombre?: string;
  firmanteCargo?: string;
}
