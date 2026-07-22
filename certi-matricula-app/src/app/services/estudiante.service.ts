import { Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, delay, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import {
  CertificadoMatricula,
  Docente,
  EnvioTicketVerificacion,
  Estudiante,
  IncidenciaLaboratorio,
  Laboratorio,
  ResultadoReseteoCorreo,
  TicketSolicitud,
  Usuario,
  VerificacionCertificado
} from '../models/estudiante.model';

/**
 * Datos de prueba usados SOLO mientras environment.usarMock === true.
 * Sirven para hacer la demo de la maqueta sin depender todavía del
 * servidor real (n8n + base de datos) que está construyendo el resto del equipo.
 */
const ESTUDIANTES_MOCK: Estudiante[] = [
  {
    tipoUsuario: 'ESTUDIANTE',
    cedula: '1702030402',
    nombres: 'Andrew',
    apellidos: 'Carrera',
    correoInstitucional: 'abv.carrera@yavirac.edu.ec',
    carrera: 'Ingeniería en Software',
    nivel: 'Octavo Nivel',
    periodoActual: 'Abril 2026 - Agosto 2026',
    estadoMatricula: 'MATRICULADO'
  },
  {
    tipoUsuario: 'ESTUDIANTE',
    cedula: '1122334459',
    nombres: 'Mishell',
    apellidos: 'Torres',
    correoInstitucional: 'mishell.torres@yavirac.edu.ec',
    carrera: 'Administración de Empresas',
    nivel: 'Quinto Nivel',
    periodoActual: 'Abril 2026 - Agosto 2026',
    estadoMatricula: 'MATRICULADO'
  },
  {
    tipoUsuario: 'ESTUDIANTE',
    cedula: '0908070600',
    nombres: 'Kevin',
    apellidos: 'Andrade',
    correoInstitucional: 'kevin.andrade@yavirac.edu.ec',
    carrera: 'Contabilidad y Auditoría',
    nivel: 'Segundo Nivel',
    periodoActual: 'Abril 2026 - Agosto 2026',
    estadoMatricula: 'NO_MATRICULADO'
  }
];

/** Docente de prueba, solo para el modo mock. */
const DOCENTES_MOCK: Docente[] = [
  {
    tipoUsuario: 'DOCENTE',
    cedula: '1710000009',
    nombres: 'Pedro Sánchez (prueba)',
    correoInstitucional: 'pedro.sanchez@yavirac.edu.ec'
  }
];

const LABORATORIOS_MOCK: Laboratorio[] = [
  { codigo: 'LAB-01', nombre: 'Laboratorio de Tolouse' },
  { codigo: 'LAB-02', nombre: 'Laboratorio de Xian' },
  { codigo: 'LAB-03', nombre: 'Laboratorio de Yasuni' },
  { codigo: 'LAB-04', nombre: 'Laboratorio de Ninive' },
  { codigo: 'LAB-05', nombre: 'Laboratorio de Sarasota' }
];

@Injectable({
  providedIn: 'root'
})
export class EstudianteService {

  /** Solo usado en modo mock: guarda el último ticket enviado por cédula. */
  private ticketsVerificacionMock = new Map<string, string>();

  /**
   * Solo usado en modo mock: simula la tabla `certificados_matricula`.
   * Guarda el certificado ya emitido por cédula+periodo para no generar un
   * código nuevo cada vez que se pide (evita duplicados si el mismo
   * estudiante genera el certificado desde la web y desde la app).
   */
  private certificadosEmitidosMock = new Map<string, CertificadoMatricula>();

  /**
   * Solo usado en modo mock: simula la tabla de tickets de solicitud
   * (trámites) por cédula. Se siembra con un par de tickets de ejemplo para
   * que la pantalla de seguimiento no se vea vacía en la demo, y se le suman
   * tickets nuevos cada vez que el estudiante genera un certificado.
   */
  private ticketsSolicitudMock = new Map<string, TicketSolicitud[]>();

  constructor(private http: HttpClient) {}

  /**
   * Equivale al webhook de n8n que recibirá la cédula y devolverá los datos
   * del usuario consultados desde la base de datos del servidor. Primero
   * busca en estudiantes; si no hay match, busca en docentes — mismo flujo
   * de identificación para ambos roles, sin pantalla de login separada.
   * Webhook real esperado: POST {n8nBaseUrl}/consultar-estudiante
   * body: { cedula, captchaToken } — n8n verifica captchaToken contra la API
   * de Google (siteverify) antes de consultar la BD; responde 403 si falla.
   */
  consultarPorCedula(cedula: string, captchaToken: string): Observable<Usuario | null> {
    if (environment.usarMock) {
      const encontrado = this.buscarUsuarioMock(cedula) ?? null;
      return of(encontrado).pipe(delay(900));
    }

    return this.http
      .post<Usuario>(`${environment.n8nBaseUrl}/consultar-estudiante`, { cedula, captchaToken })
      .pipe(map(usuario => usuario ?? null));
  }

  /**
   * Equivale al webhook de n8n que genera un ticket de verificación de 6
   * dígitos y lo envía al correo institucional del usuario (estudiante o
   * docente).
   * Webhook real esperado: POST {n8nBaseUrl}/enviar-ticket-verificacion  body: { cedula }
   */
  enviarTicketVerificacion(cedula: string): Observable<EnvioTicketVerificacion> {
    if (environment.usarMock) {
      const usuario = this.buscarUsuarioMock(cedula);
      if (!usuario) {
        return throwError(() => new Error('Usuario no encontrado'));
      }

      const ticket = Math.floor(100000 + Math.random() * 900000).toString();
      this.ticketsVerificacionMock.set(cedula, ticket);

      return of({
        correoEnmascarado: this.enmascararCorreo(usuario.correoInstitucional),
        ticketDebugSoloMock: ticket
      }).pipe(delay(900));
    }

    return this.http.post<EnvioTicketVerificacion>(
      `${environment.n8nBaseUrl}/enviar-ticket-verificacion`,
      { cedula }
    );
  }

  /**
   * Equivale al webhook de n8n que valida el ticket de verificación
   * ingresado por el estudiante contra el que se envió por correo.
   * Webhook real esperado: POST {n8nBaseUrl}/verificar-ticket  body: { cedula, ticket }
   */
  verificarTicket(cedula: string, ticket: string): Observable<boolean> {
    if (environment.usarMock) {
      const valido = this.ticketsVerificacionMock.get(cedula) === ticket;
      return of(valido).pipe(delay(700));
    }

    return this.http
      .post<{ valido: boolean }>(`${environment.n8nBaseUrl}/verificar-ticket`, { cedula, ticket })
      .pipe(map(respuesta => respuesta.valido));
  }

  /**
   * Equivale al webhook de n8n que devuelve el historial de tickets
   * (trámites) del estudiante, para la pantalla de "Consultar estado de mis
   * tickets".
   * Webhook real esperado: POST {n8nBaseUrl}/consultar-tickets  body: { cedula }
   */
  consultarTicketsSolicitud(cedula: string): Observable<TicketSolicitud[]> {
    if (environment.usarMock) {
      const tickets = this.obtenerOSembrarTickets(cedula);
      // Más reciente primero.
      const ordenados = [...tickets].sort((a, b) => (a.id < b.id ? 1 : -1));
      return of(ordenados).pipe(delay(800));
    }

    return this.http.post<TicketSolicitud[]>(
      `${environment.n8nBaseUrl}/consultar-tickets`,
      { cedula }
    );
  }

  /**
   * Equivale al webhook de n8n que genera el certificado de matrícula y
   * devuelve el código único (para el QR) que el sistema web validará
   * contra la base de datos.
   * Webhook real esperado: POST {n8nBaseUrl}/generar-certificado-matricula  body: { cedula }
   */
  generarCertificadoMatricula(cedula: string): Observable<CertificadoMatricula> {
    if (environment.usarMock) {
      const estudiante = ESTUDIANTES_MOCK.find(e => e.cedula === cedula);
      if (!estudiante) {
        return throwError(() => new Error('Estudiante no encontrado'));
      }

      // Idempotencia: si el estudiante ya tiene un certificado vigente para
      // este periodo (sin importar si lo pidió desde la web o la app), se
      // devuelve exactamente el mismo, no uno nuevo.
      const claveCertificado = `${estudiante.cedula}-${estudiante.periodoActual}`;
      const certificadoExistente = this.certificadosEmitidosMock.get(claveCertificado);
      if (certificadoExistente) {
        return of(certificadoExistente).pipe(delay(700));
      }

      const certificado: CertificadoMatricula = {
        codigoUnico: this.generarCodigoUnicoMock(),
        cedula: estudiante.cedula,
        nombreCompleto: `${estudiante.nombres} ${estudiante.apellidos}`,
        carrera: estudiante.carrera,
        nivel: estudiante.nivel,
        periodoActual: estudiante.periodoActual,
        modalidad: 'DUAL',
        nivelIngreso: 'Primer nivel',
        periodoIngresoCodigo: '2025-II',
        periodoIngresoNombre: 'agosto 2025-febrero 2026',
        fechaEmision: new Date().toLocaleDateString('es-EC', {
          year: 'numeric',
          month: 'long',
          day: '2-digit'
        }),
        // En producción esta URL la arma el backend (workflow-generar-certificado)
        // y apunta a la página pública /verificar-certificado de esta misma app.
        urlVerificacion: ''
      };
      certificado.urlVerificacion = `${window.location.origin}/verificar-certificado/${certificado.codigoUnico}`;
      this.certificadosEmitidosMock.set(claveCertificado, certificado);
      this.registrarTicket(cedula, {
        id: certificado.codigoUnico,
        tipo: 'Certificado de Matrícula',
        estado: 'COMPLETADO',
        fechaSolicitud: certificado.fechaEmision
      });

      return of(certificado).pipe(delay(1300));
    }

    return this.http.post<CertificadoMatricula>(
      `${environment.n8nBaseUrl}/generar-certificado-matricula`,
      { cedula }
    );
  }

  /**
   * Envía el PDF real del certificado (generado en el navegador con
   * certificado-pdf.service.ts) al backend, para que n8n lo adjunte y lo
   * envíe por correo al estudiante.
   * Webhook real esperado: POST {n8nBaseUrl}/enviar-certificado-pdf
   * body: { cedula, codigoUnico, pdfBase64 }
   */
  enviarCertificadoPdf(cedula: string, codigoUnico: string, pdfBase64: string): Observable<void> {
    if (environment.usarMock) {
      return of(undefined).pipe(delay(600));
    }

    return this.http
      .post<{ enviado: boolean }>(`${environment.n8nBaseUrl}/enviar-certificado-pdf`, {
        cedula,
        codigoUnico,
        pdfBase64
      })
      .pipe(map(() => undefined));
  }

  /**
   * Equivale al webhook público de n8n que valida el QR impreso en el
   * certificado (el QR funciona como firma de Secretaría — esta es la
   * verificación detrás de esa firma). No requiere sesión ni OTP: la llama
   * la página pública /verificar-certificado, a la que apunta el QR.
   * Webhook real esperado: POST {n8nBaseUrl}/verificar-certificado  body: { codigo }
   */
  verificarCertificado(codigo: string): Observable<VerificacionCertificado> {
    if (environment.usarMock) {
      return of({ autentico: false, error: 'Verificación no disponible en modo mock.' }).pipe(delay(700));
    }

    return this.http
      .post<VerificacionCertificado>(`${environment.n8nBaseUrl}/verificar-certificado`, { codigo })
      .pipe(
        catchError((err: HttpErrorResponse) => {
          if (err.error && typeof err.error === 'object' && 'autentico' in err.error) {
            return of(err.error as VerificacionCertificado);
          }
          return of({ autentico: false, error: 'No se pudo verificar el certificado en este momento.' });
        })
      );
  }

  /**
   * Equivale al webhook de n8n que registra un ticket de solicitud genérico
   * (Anulación de Matrícula y cualquier trámite sin automatización propia).
   * Webhook real esperado: POST {n8nBaseUrl}/crear-ticket-solicitud
   * body: { cedula, tipoTramite }
   */
  crearTicketSolicitud(
    cedula: string,
    tipoTramite: 'ANULACION_MATRICULA'
  ): Observable<TicketSolicitud> {
    if (environment.usarMock) {
      const estudiante = ESTUDIANTES_MOCK.find(e => e.cedula === cedula);
      if (!estudiante) {
        return throwError(() => new Error('Estudiante no encontrado'));
      }

      const anio = new Date().getFullYear();
      const seq  = String(Math.floor(Math.random() * 900000) + 100000);
      const ticket: TicketSolicitud = {
        id: `TCK-${anio}-${seq}`,
        tipo: 'Anulación de Matrícula',
        estado: 'EN_PROCESO',
        fechaSolicitud: new Date().toLocaleDateString('es-EC', {
          year: 'numeric', month: 'long', day: '2-digit'
        })
      };

      this.registrarTicket(cedula, ticket);
      return of(ticket).pipe(delay(1000));
    }

    return this.http.post<TicketSolicitud>(
      `${environment.n8nBaseUrl}/crear-ticket-solicitud`,
      { cedula, tipoTramite }
    );
  }

  /**
   * Reseteo AUTOMÁTICO de la contraseña del correo institucional — sin
   * ticket, sin aprobación humana. El backend valida del lado del servidor
   * que el estudiante haya pasado por el OTP recientemente antes de
   * ejecutar el reseteo real contra Google Workspace.
   * Webhook real esperado: POST {n8nBaseUrl}/resetear-contrasena-correo
   */
  resetearContrasenaCorreo(cedula: string): Observable<ResultadoReseteoCorreo> {
    if (environment.usarMock) {
      const estudiante = ESTUDIANTES_MOCK.find(e => e.cedula === cedula);
      if (!estudiante) {
        return throwError(() => new Error('Estudiante no encontrado'));
      }
      const resultado: ResultadoReseteoCorreo = {
        estado: 'RESETEADO',
        correoNotificado: estudiante.correoInstitucional,
        mensaje: 'Tu contraseña fue reseteada. Revisa tu correo institucional para ver la nueva contraseña temporal.'
      };
      return of(resultado).pipe(delay(1000));
    }

    return this.http.post<ResultadoReseteoCorreo>(
      `${environment.n8nBaseUrl}/resetear-contrasena-correo`,
      { cedula }
    );
  }

  /**
   * Equivale al webhook de n8n que devuelve el catálogo de laboratorios,
   * para que el docente elija cuál reportar.
   * Webhook real esperado: POST {n8nBaseUrl}/consultar-laboratorios
   */
  consultarLaboratorios(): Observable<Laboratorio[]> {
    if (environment.usarMock) {
      return of(LABORATORIOS_MOCK).pipe(delay(500));
    }

    return this.http.post<Laboratorio[]>(`${environment.n8nBaseUrl}/consultar-laboratorios`, {});
  }

  /**
   * Equivale al webhook de n8n que registra una incidencia de laboratorio
   * reportada por un docente. La foto es opcional (base64 sin el prefijo
   * data:, igual que el PDF del certificado) — n8n la guarda en disco y la
   * vincula en `alertas.adjunto_id`.
   * Webhook real esperado: POST {n8nBaseUrl}/reportar-incidencia-laboratorio
   * body: { cedula, laboratorioCodigo, descripcion, fotoBase64?, fotoMime? }
   */
  reportarIncidenciaLaboratorio(
    cedula: string,
    laboratorioCodigo: string,
    descripcion: string,
    foto?: { base64: string; mime: string }
  ): Observable<IncidenciaLaboratorio> {
    if (environment.usarMock) {
      const laboratorio = LABORATORIOS_MOCK.find(l => l.codigo === laboratorioCodigo);
      const anio = new Date().getFullYear();
      const seq = String(Math.floor(Math.random() * 900000) + 100000);
      const incidencia: IncidenciaLaboratorio = {
        codigo: `AL-${anio}-${seq}`,
        laboratorio: laboratorio?.nombre ?? laboratorioCodigo,
        descripcion,
        estado: 'Pendiente',
        fechaReporte: new Date().toLocaleDateString('es-EC', {
          year: 'numeric', month: 'long', day: '2-digit'
        }),
        tieneFoto: !!foto
      };
      return of(incidencia).pipe(delay(1000));
    }

    return this.http.post<IncidenciaLaboratorio>(
      `${environment.n8nBaseUrl}/reportar-incidencia-laboratorio`,
      {
        cedula,
        laboratorioCodigo,
        descripcion,
        ...(foto ? { fotoBase64: foto.base64, fotoMime: foto.mime } : {})
      }
    );
  }

  private buscarUsuarioMock(cedula: string): Usuario | undefined {
    return ESTUDIANTES_MOCK.find(e => e.cedula === cedula) ??
      DOCENTES_MOCK.find(d => d.cedula === cedula);
  }

  private obtenerOSembrarTickets(cedula: string): TicketSolicitud[] {
    if (!this.ticketsSolicitudMock.has(cedula)) {
      this.ticketsSolicitudMock.set(cedula, []);
    }
    return this.ticketsSolicitudMock.get(cedula)!;
  }

  private registrarTicket(cedula: string, ticket: TicketSolicitud): void {
    const tickets = this.obtenerOSembrarTickets(cedula);
    tickets.push(ticket);
  }

  private generarCodigoUnicoMock(): string {
    const anio = new Date().getFullYear();
    const aleatorio = Math.random().toString(36).slice(2, 10).toUpperCase();
    return `MAT-${anio}-${aleatorio}`;
  }

  private enmascararCorreo(correo: string): string {
    const [usuario, dominio] = correo.split('@');
    if (!dominio || usuario.length <= 2) {
      return correo;
    }
    const visible = usuario.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(usuario.length - 2, 3))}@${dominio}`;
  }
}
