import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { EstudianteService } from '../services/estudiante.service';
import { VerificacionCertificado } from '../models/estudiante.model';

/**
 * Página pública (sin login, sin OTP) a la que apunta el QR impreso en el
 * certificado de matrícula. El QR funciona como firma de Secretaría: esta
 * página es la validación real detrás de esa firma — cualquiera que
 * escanee el código llega aquí directamente.
 */
@Component({
  selector: 'app-verificar-certificado',
  templateUrl: './verificar-certificado.page.html',
  styleUrls: ['./verificar-certificado.page.scss'],
  standalone: false,
})
export class VerificarCertificadoPage implements OnInit {
  cargando = true;
  resultado: VerificacionCertificado | null = null;

  constructor(
    private route: ActivatedRoute,
    private estudianteService: EstudianteService
  ) {}

  ngOnInit(): void {
    const codigo = this.route.snapshot.paramMap.get('codigo') ?? '';

    if (!codigo) {
      this.cargando = false;
      this.resultado = { autentico: false, error: 'El enlace de verificación no incluye un código válido.' };
      return;
    }

    this.estudianteService.verificarCertificado(codigo).subscribe(resultado => {
      this.resultado = resultado;
      this.cargando = false;
    });
  }
}
