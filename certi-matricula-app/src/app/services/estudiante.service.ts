import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { CertificadoMatricula, EnvioTicketVerificacion, Estudiante } from '../models/estudiante.model';

/**
 * Datos de prueba usados SOLO mientras environment.usarMock === true.
 * Sirven para hacer la demo de la maqueta sin depender todavía del
 * servidor real (n8n + base de datos) que está construyendo el resto del equipo.
 */
const ESTUDIANTES_MOCK: Estudiante[] = [
  {
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

  constructor(private http: HttpClient) {}

  /**
   * Equivale al webhook de n8n que recibirá la cédula y devolverá los datos
   * del estudiante consultados desde la base de datos del servidor.
   * Webhook real esperado: POST {n8nBaseUrl}/consultar-estudiante  body: { cedula }
   */
  consultarPorCedula(cedula: string): Observable<Estudiante | null> {
    if (environment.usarMock) {
      const encontrado = ESTUDIANTES_MOCK.find(e => e.cedula === cedula) ?? null;
      return of(encontrado).pipe(delay(900));
    }

    return this.http
      .post<Estudiante>(`${environment.n8nBaseUrl}/consultar-estudiante`, { cedula })
      .pipe(map(estudiante => estudiante ?? null));
  }

  /**
   * Equivale al webhook de n8n que genera un ticket de verificación de 6
   * dígitos y lo envía al correo institucional del estudiante.
   * Webhook real esperado: POST {n8nBaseUrl}/enviar-ticket-verificacion  body: { cedula }
   */
  enviarTicketVerificacion(cedula: string): Observable<EnvioTicketVerificacion> {
    if (environment.usarMock) {
      const estudiante = ESTUDIANTES_MOCK.find(e => e.cedula === cedula);
      if (!estudiante) {
        return throwError(() => new Error('Estudiante no encontrado'));
      }

      const ticket = Math.floor(100000 + Math.random() * 900000).toString();
      this.ticketsVerificacionMock.set(cedula, ticket);

      return of({
        correoEnmascarado: this.enmascararCorreo(estudiante.correoInstitucional),
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
        fechaEmision: new Date().toLocaleDateString('es-EC', {
          year: 'numeric',
          month: 'long',
          day: '2-digit'
        }),
        // En producción esta URL la arma el backend y apunta al sistema web
        // de verificación de certificados que construyen tus compañeros.
        urlVerificacion: ''
      };
      certificado.urlVerificacion = `https://verificacion.tudominio.edu.ec/certificados/${certificado.codigoUnico}`;
      this.certificadosEmitidosMock.set(claveCertificado, certificado);

      return of(certificado).pipe(delay(1300));
    }

    return this.http.post<CertificadoMatricula>(
      `${environment.n8nBaseUrl}/generar-certificado-matricula`,
      { cedula }
    );
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
