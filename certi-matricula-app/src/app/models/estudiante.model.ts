export interface Estudiante {
  cedula: string;
  nombres: string;
  apellidos: string;
  correoInstitucional: string;
  carrera: string;
  nivel: string;
  periodoActual: string;
  estadoMatricula: 'MATRICULADO' | 'NO_MATRICULADO';
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
  fechaEmision: string;
  urlVerificacion: string;
}

export type OpcionMenu =
  | 'CERTIFICADO_MATRICULA'
  | 'RECORD_ACADEMICO'
  | 'CERTIFICADO_VINCULACION'
  | 'ANULACION_MATRICULA'
  | 'ESTADO_TICKETS'
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
