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
  | 'HORARIO_CLASES'
  | 'ESTADO_CUENTA'
  | 'KARDEX';

export interface OpcionChat {
  id: OpcionMenu;
  etiqueta: string;
  icono: string;
  disponible: boolean;
}
