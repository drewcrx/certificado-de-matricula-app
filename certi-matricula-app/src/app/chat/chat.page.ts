import { Component, OnInit, ViewChild } from '@angular/core';
import { IonContent } from '@ionic/angular';
import * as QRCode from 'qrcode';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Network } from '@capacitor/network';
import { Share } from '@capacitor/share';
import { EstudianteService } from '../services/estudiante.service';
import { validarCedulaEcuatoriana } from '../utils/validar-cedula';
import {
  CertificadoMatricula,
  Estudiante,
  OpcionChat
} from '../models/estudiante.model';

const LONGITUD_TICKET_VERIFICACION = 6;

type TipoMensaje =
  | 'bot-texto'
  | 'bot-escribiendo'
  | 'usuario-texto'
  | 'bot-opciones'
  | 'bot-preview-certificado'
  | 'bot-resultado-certificado';

interface ChatMensaje {
  tipo: TipoMensaje;
  texto?: string;
  estudiante?: Estudiante;
  certificado?: CertificadoMatricula;
  qrDataUrl?: string;
}

type EstadoConversacion =
  | 'esperando_cedula'
  | 'consultando'
  | 'enviando_ticket'
  | 'esperando_ticket'
  | 'validando_ticket'
  | 'menu'
  | 'preview_certificado'
  | 'generando_certificado'
  | 'resultado';

const OPCIONES_MENU: OpcionChat[] = [
  { id: 'CERTIFICADO_MATRICULA', etiqueta: 'Certificado de matrícula', icono: 'document-text-outline', disponible: true },
  { id: 'HORARIO_CLASES', etiqueta: 'Horario de clases', icono: 'calendar-outline', disponible: false },
  { id: 'ESTADO_CUENTA', etiqueta: 'Estado de cuenta', icono: 'cash-outline', disponible: false },
  { id: 'KARDEX', etiqueta: 'Kardex académico', icono: 'school-outline', disponible: false }
];

@Component({
  selector: 'app-chat',
  templateUrl: './chat.page.html',
  styleUrls: ['./chat.page.scss'],
  standalone: false,
})
export class ChatPage implements OnInit {
  @ViewChild(IonContent) contenido!: IonContent;

  mensajes: ChatMensaje[] = [];
  opcionesMenu = OPCIONES_MENU;

  estado: EstadoConversacion = 'esperando_cedula';
  cedulaIngresada = '';
  errorCedula = '';

  ticketIngresado = '';
  errorTicket = '';

  estudianteActual: Estudiante | null = null;

  constructor(private estudianteService: EstudianteService) {}

  ngOnInit(): void {
    this.iniciarConversacion();
  }

  private async iniciarConversacion(): Promise<void> {
    this.mensajes = [];
    this.estudianteActual = null;
    this.cedulaIngresada = '';
    this.errorCedula = '';
    this.ticketIngresado = '';
    this.errorTicket = '';

    await this.hablar('¡Hola! 👋 Soy Yavirac, tu asistente virtual académico.');
    await this.hablar('Para ayudarte, primero necesito verificar tu identidad. Por favor ingresa tu número de cédula.');
    this.estado = 'esperando_cedula';
  }

  get puedeEnviarCedula(): boolean {
    return validarCedulaEcuatoriana(this.cedulaIngresada) && this.estado === 'esperando_cedula';
  }

  async enviarCedula(): Promise<void> {
    if (!this.puedeEnviarCedula) {
      this.errorCedula = /^\d{10}$/.test(this.cedulaIngresada)
        ? 'Ese número de cédula no es válido. Verifica que esté bien escrito.'
        : 'Ingresa un número de cédula de 10 dígitos.';
      return;
    }
    this.errorCedula = '';

    const cedula = this.cedulaIngresada;
    this.agregarMensaje({ tipo: 'usuario-texto', texto: cedula });
    this.cedulaIngresada = '';
    this.estado = 'consultando';

    if (!(await this.requiereConexion())) {
      this.estado = 'esperando_cedula';
      return;
    }

    this.mostrarEscribiendo();
    this.estudianteService.consultarPorCedula(cedula).subscribe({
      next: async estudiante => {
        this.quitarEscribiendo();
        if (!estudiante) {
          await this.hablar('No encontré ningún estudiante con esa cédula. ¿Puedes verificar el número e intentarlo de nuevo?');
          this.estado = 'esperando_cedula';
          return;
        }

        this.estudianteActual = estudiante;
        await this.enviarTicketDeVerificacion(estudiante);
      },
      error: async () => {
        this.quitarEscribiendo();
        await this.hablar('Tuve un problema consultando tus datos. Intenta nuevamente en unos segundos.');
        this.estado = 'esperando_cedula';
      }
    });
  }

  private async enviarTicketDeVerificacion(estudiante: Estudiante): Promise<void> {
    this.estado = 'enviando_ticket';

    if (!(await this.requiereConexion())) {
      this.estado = 'esperando_cedula';
      return;
    }

    this.mostrarEscribiendo();
    this.estudianteService.enviarTicketVerificacion(estudiante.cedula).subscribe({
      next: async resultado => {
        this.quitarEscribiendo();
        await this.hablar(
          `Se ha generado un ticket de verificación y fue enviado a su correo institucional (${resultado.correoEnmascarado}). ` +
          'Por favor, verifíquelo e ingréselo a continuación.'
        );
        if (resultado.ticketDebugSoloMock) {
          await this.hablar(`🔧 Modo prueba: tu ticket es ${resultado.ticketDebugSoloMock} (esto desaparecerá cuando el backend real envíe el correo).`);
        }
        this.estado = 'esperando_ticket';
      },
      error: async () => {
        this.quitarEscribiendo();
        await this.hablar('No pude generar el ticket de verificación. Intenta nuevamente en unos segundos.');
        this.estado = 'esperando_cedula';
      }
    });
  }

  get puedeVerificarTicket(): boolean {
    return /^\d{6}$/.test(this.ticketIngresado) && this.estado === 'esperando_ticket';
  }

  async verificarTicketIngresado(): Promise<void> {
    if (!this.puedeVerificarTicket || !this.estudianteActual) {
      this.errorTicket = `Ingresa el ticket de ${LONGITUD_TICKET_VERIFICACION} dígitos que enviamos a tu correo.`;
      return;
    }
    this.errorTicket = '';

    const ticket = this.ticketIngresado;
    const estudiante = this.estudianteActual;
    this.agregarMensaje({ tipo: 'usuario-texto', texto: ticket });
    this.ticketIngresado = '';
    this.estado = 'validando_ticket';

    if (!(await this.requiereConexion())) {
      this.estado = 'esperando_ticket';
      return;
    }

    this.mostrarEscribiendo();
    this.estudianteService.verificarTicket(estudiante.cedula, ticket).subscribe({
      next: async valido => {
        this.quitarEscribiendo();
        if (!valido) {
          await this.hablar('Ese ticket no es correcto. Verifica tu correo e inténtalo de nuevo.');
          this.estado = 'esperando_ticket';
          return;
        }

        await this.hablar(`¡Identidad verificada! ✅ Hola ${estudiante.nombres} ${estudiante.apellidos}, ¿qué deseas consultar hoy?`);
        this.agregarMensaje({ tipo: 'bot-opciones' });
        this.estado = 'menu';
      },
      error: async () => {
        this.quitarEscribiendo();
        await this.hablar('Tuve un problema verificando el ticket. Intenta nuevamente en unos segundos.');
        this.estado = 'esperando_ticket';
      }
    });
  }

  async seleccionarOpcion(opcion: OpcionChat): Promise<void> {
    if (this.estado !== 'menu' || !this.estudianteActual) {
      return;
    }

    this.agregarMensaje({ tipo: 'usuario-texto', texto: opcion.etiqueta });

    if (!opcion.disponible) {
      await this.hablar('Esa opción todavía está en construcción 🚧, muy pronto estará disponible.');
      this.agregarMensaje({ tipo: 'bot-opciones' });
      return;
    }

    if (opcion.id === 'CERTIFICADO_MATRICULA') {
      await this.hablar('Estos son tus datos. Verifícalos antes de generar tu certificado:');
      this.agregarMensaje({ tipo: 'bot-preview-certificado', estudiante: this.estudianteActual });
      this.estado = 'preview_certificado';
    }
  }

  async generarCertificado(): Promise<void> {
    if (this.estado !== 'preview_certificado' || !this.estudianteActual) {
      return;
    }

    this.agregarMensaje({ tipo: 'usuario-texto', texto: 'Generar certificado de matrícula' });
    this.estado = 'generando_certificado';

    if (!(await this.requiereConexion())) {
      this.estado = 'preview_certificado';
      return;
    }

    this.mostrarEscribiendo();

    this.estudianteService.generarCertificadoMatricula(this.estudianteActual.cedula).subscribe({
      next: async certificado => {
        this.quitarEscribiendo();
        const qrDataUrl = await QRCode.toDataURL(certificado.urlVerificacion, {
          margin: 1,
          width: 260
        });

        await this.hablar('¡Listo! Aquí tienes tu certificado de matrícula con su código QR único:');
        this.agregarMensaje({ tipo: 'bot-resultado-certificado', certificado, qrDataUrl });
        await this.hablar('Este QR es único e irrepetible: podrá verificarse en el sistema web con este mismo código. ¿Deseas algo más?');
        this.estado = 'resultado';
      },
      error: async () => {
        this.quitarEscribiendo();
        await this.hablar('No pude generar el certificado en este momento. Intenta nuevamente en unos segundos.');
        this.estado = 'preview_certificado';
      }
    });
  }

  async compartirCertificado(mensaje: ChatMensaje): Promise<void> {
    if (!mensaje.certificado || !mensaje.qrDataUrl) {
      return;
    }
    const { certificado, qrDataUrl } = mensaje;
    const nombreArchivo = `certificado-${certificado.codigoUnico}.png`;
    const textoCompartir =
      `Certificado de matrícula\n${certificado.nombreCompleto}\n` +
      `Código: ${certificado.codigoUnico}\nVerifícalo en: ${certificado.urlVerificacion}`;

    if (!Capacitor.isNativePlatform()) {
      this.descargarEnNavegador(qrDataUrl, nombreArchivo);
      return;
    }

    try {
      const base64 = qrDataUrl.split(',')[1];
      const archivo = await Filesystem.writeFile({
        path: nombreArchivo,
        data: base64,
        directory: Directory.Cache
      });

      await Share.share({
        title: 'Certificado de matrícula',
        text: textoCompartir,
        files: [archivo.uri],
        dialogTitle: 'Compartir certificado de matrícula'
      });
    } catch (error) {
      // El usuario pudo simplemente cancelar el cuadro de compartir.
      console.warn('No se compartió el certificado', error);
    }
  }

  private descargarEnNavegador(qrDataUrl: string, nombreArchivo: string): void {
    const enlace = document.createElement('a');
    enlace.href = qrDataUrl;
    enlace.download = nombreArchivo;
    enlace.click();
  }

  nuevaConsulta(): void {
    this.iniciarConversacion();
  }

  volverAlMenu(): void {
    if (!this.estudianteActual) {
      return;
    }
    this.agregarMensaje({ tipo: 'bot-opciones' });
    this.estado = 'menu';
  }

  /**
   * Verifica conexión antes de una llamada de red. Si no hay conexión,
   * avisa en el chat y devuelve false para que el llamador cancele la acción.
   */
  private async requiereConexion(): Promise<boolean> {
    const estadoRed = await Network.getStatus();
    if (estadoRed.connected) {
      return true;
    }
    await this.hablar('📡 No tienes conexión a internet en este momento. Verifica tu conexión e inténtalo de nuevo.');
    return false;
  }

  private mostrarEscribiendo(): void {
    this.agregarMensaje({ tipo: 'bot-escribiendo' });
  }

  private quitarEscribiendo(): void {
    this.mensajes = this.mensajes.filter(m => m.tipo !== 'bot-escribiendo');
  }

  private async hablar(texto: string, tiempoEscribiendo = 700): Promise<void> {
    this.mostrarEscribiendo();
    await this.esperar(tiempoEscribiendo);
    this.quitarEscribiendo();
    this.agregarMensaje({ tipo: 'bot-texto', texto });
  }

  private agregarMensaje(mensaje: ChatMensaje): void {
    this.mensajes = [...this.mensajes, mensaje];
    this.scrollAlFinal();
  }

  private esperar(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private scrollAlFinal(): void {
    setTimeout(() => {
      this.contenido?.scrollToBottom(200);
    }, 50);
  }
}
