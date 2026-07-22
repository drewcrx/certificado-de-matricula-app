import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import { CertificadoMatricula } from '../models/estudiante.model';

/**
 * Genera el PDF del certificado de matrícula con la hoja membretada oficial
 * del Instituto Superior Tecnológico de Turismo y Patrimonio "YAVIRAC".
 *
 * Réplica fiel del documento Word original (HOJA_MEMBRETADA_ACTUALIZADA_ABR_2026):
 *  - Fuente: Times New Roman 12pt en TODO el documento (cuerpo y firma).
 *  - Párrafo principal: JUSTIFICADO, con negrita solo en el nombre de la
 *    institución y en la carrera.
 *  - Párrafo "Así mismo… / Se emite…": es UN SOLO párrafo, alineado a la
 *    IZQUIERDA (no justificado), a doble espacio, con un tabulador entre
 *    "Primer nivel" y el año, y en cursiva solo la parte "Se emite…".
 *  - Firma centrada, en una sola línea, SIN negrita.
 *  - QR centrado al final con leyenda "MV — Generado mediante App Móvil".
 *
 * Este servicio es invocado por el workflow de n8n (workflow-generar-certificado)
 * para adjuntar el PDF al correo institucional del estudiante. No se usa
 * para descarga directa desde la app.
 */
@Injectable({
  providedIn: 'root'
})
export class CertificadoPdfService {

  private readonly PAGE_W = 210;
  private readonly FS     = 12;   // única talla de fuente en todo el documento

  // Geometría del bloque de texto, calculada a partir de los márgenes de
  // página + sangrías del .docx original (no son simétricos: el bloque
  // "Así mismo…" es más angosto que el párrafo principal).
  private readonly P1_X          = 29.97;   // inicio X párrafo principal (justificado)
  private readonly P1_RIGHT_EDGE = 180.12;  // borde derecho párrafo principal
  private readonly P2_X          = 29.97;   // inicio X bloque "Así mismo…"
  private readonly P2_RIGHT_EDGE = 152.82;  // borde derecho bloque "Así mismo…" (más angosto)
  private readonly TAB_X         = 94.84;   // posición absoluta X del tabulador

  private readonly LH  = 5.3;   // interlineado sencillo @12pt
  private readonly LH2 = 10.6;  // interlineado doble @12pt (bloque "Así mismo…")

  async generarPdf(certificado: CertificadoMatricula, qrDataUrl: string): Promise<Blob> {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    // ── 1. MEMBRETE como fondo completo ──────────────────────────────────────
    const membrete = await this.imgBase64('assets/membrete-yavirac.jpeg');
    doc.addImage(membrete, 'JPEG', 0, 0, this.PAGE_W, 297);

    doc.setTextColor(0, 0, 0);
    let Y = 50;

    // ── 2. PÁRRAFO PRINCIPAL, justificado, con negritas ───────────────────────
    const seg1: Segmento[] = [
      { texto: 'En calidad de Secretaria General (s) del ' },
      { texto: 'Instituto Superior Tecnológico de Turismo y Patrimonio \u201CYAVIRAC\u201D, ', bold: true },
      {
        texto: `certifico que el/la estudiante ${certificado.nombreCompleto.toUpperCase()}, ` +
               `con c\u00E9dula de ciudadan\u00EDa N\u00BA. ${certificado.cedula}, se matricul\u00F3 en ` +
               `${certificado.nivel} periodo acad\u00E9mico en la carrera `
      },
      { texto: certificado.carrera.toUpperCase(), bold: true },
      {
        texto: `, periodo lectivo ${certificado.periodoActual}, modalidad ${(certificado.modalidad ?? 'presencial').toLowerCase()}, ` +
               `asistiendo regularmente a clases de lunes a viernes.`
      },
    ];
    Y = this.renderParrafo(doc, seg1, this.P1_X, this.P1_RIGHT_EDGE, Y, this.LH, /* justificar */ true);

    // ── 3. Párrafo "Así mismo… / Se emite…" — UN SOLO párrafo, sin justificar,
    //        a doble espacio, con tabulador y cursiva parcial ─────────────────
    Y += this.LH * 0.6;

    const seg2: Segmento[] = [
      { texto: `As\u00ED mismo debo informar, que inici\u00F3 sus estudios acad\u00E9micos en: ${certificado.nivelIngreso}` },
      { tab: true },
      { texto: `${certificado.periodoIngresoCodigo} (${certificado.periodoIngresoNombre}) ` },
      { texto: `Se emite este certificado en Quito, a los ${certificado.fechaEmision}.`, italic: true },
    ];
    Y = this.renderParrafo(doc, seg2, this.P2_X, this.P2_RIGHT_EDGE, Y, this.LH2, /* justificar */ false);

    // ── 4. FIRMA centrada ─────────────────────────────────────────────────────
    Y += 14;
    const CX = this.PAGE_W / 2;

    doc.setFont('times', 'normal');
    doc.setFontSize(this.FS);
    doc.text('Atentamente,', CX, Y, { align: 'center' });
    Y += this.LH * 1.2;

    // ── 5. QR como firma (entre "Atentamente," y el nombre) ──────────────────
    const QS = 36;
    const QX = (this.PAGE_W - QS) / 2;
    doc.addImage(qrDataUrl, 'PNG', QX, Y, QS, QS);
    Y += QS + 2;

    doc.setFont('times', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    doc.text(certificado.codigoUnico, CX, Y, { align: 'center' });
    Y += 4;

    doc.setFontSize(7.5);
    doc.setTextColor(110, 110, 110);
    doc.text('MV \u2014 Generado mediante App M\u00F3vil', CX, Y, { align: 'center' });
    Y += this.LH * 1.2;

    // ── 6. Nombre y cargo de la secretaria ───────────────────────────────────
    doc.setTextColor(0, 0, 0);
    doc.setFont('times', 'normal');
    doc.setFontSize(this.FS);
    doc.text('Mtr. Alexandra Gordon M. Secretaria General (s)', CX, Y, { align: 'center' });
    Y += this.LH;

    doc.setFont('times', 'normal');
    doc.setFontSize(this.FS);
    const instLineas = doc.splitTextToSize(
      'Instituto Superior Tecnol\u00F3gico de Turismo y Patrimonio \u201CYAVIRAC\u201D',
      this.P1_RIGHT_EDGE - this.P1_X
    );
    instLineas.forEach((l: string) => {
      doc.text(l, CX, Y, { align: 'center' });
      Y += this.LH;
    });

    return doc.output('blob');
  }

  /**
   * Renderiza un párrafo compuesto por segmentos de texto (normal/negrita/
   * cursiva) y, opcionalmente, un tabulador, con ajuste de línea automático.
   *
   * - justificar = true  → distribuye el espacio sobrante entre palabras en
   *   todas las líneas salvo la última (estándar tipográfico).
   * - justificar = false → alinea a la izquierda, sin expandir espacios.
   *
   * El tabulador ({ tab: true }) hace que el cursor salte a la posición
   * absoluta this.TAB_X dentro de la línea.
   */
  private renderParrafo(
    doc: jsPDF,
    segmentos: Segmento[],
    x: number,
    rightEdge: number,
    y: number,
    lineHeight: number,
    justificar: boolean
  ): number {
    const width = rightEdge - x;
    const tokens = this.tokenizar(doc, segmentos);
    const spaceW = this.anchoTexto(doc, ' ', false, false);
    const lineas = this.armarLineas(doc, tokens, width, spaceW);

    lineas.forEach((linea, li) => {
      const esUltima = li === lineas.length - 1;
      const palabras = linea.filter(t => t.tipo === 'palabra');

      let anchoContenido = 0;
      linea.forEach(t => { anchoContenido += t.tipo === 'tab' ? t.gap! : t.ancho!; });
      anchoContenido += spaceW * (linea.length - 1);

      let espacioExtra = 0;
      if (justificar && !esUltima && palabras.length > 1) {
        espacioExtra = (width - anchoContenido) / (palabras.length - 1);
      }

      let cx = x;
      linea.forEach((tok, i) => {
        if (tok.tipo === 'tab') { cx += tok.gap!; return; }
        doc.setFont('times', tok.bold ? 'bold' : (tok.italic ? 'italic' : 'normal'));
        doc.setFontSize(this.FS);
        doc.text(tok.texto!, cx, y);
        cx += tok.ancho!;
        if (i < linea.length - 1) cx += spaceW + espacioExtra;
      });

      y += lineHeight;
    });

    return y;
  }

  private tokenizar(doc: jsPDF, segmentos: Segmento[]): Token[] {
    const tokens: Token[] = [];
    for (const seg of segmentos) {
      if (seg.tab) { tokens.push({ tipo: 'tab' }); continue; }
      for (const palabra of (seg.texto ?? '').split(' ')) {
        if (palabra.length > 0) {
          tokens.push({ tipo: 'palabra', texto: palabra, bold: !!seg.bold, italic: !!seg.italic });
        }
      }
    }
    return tokens;
  }

  private armarLineas(doc: jsPDF, tokens: Token[], width: number, spaceW: number): Token[][] {
    const lineas: Token[][] = [];
    let actual: Token[] = [];
    let anchoActual = 0;

    for (const tok of tokens) {
      if (tok.tipo === 'tab') {
        const gap = Math.max(spaceW, this.TAB_X - this.P2_X - anchoActual);
        actual.push({ ...tok, gap });
        anchoActual += gap;
        continue;
      }

      const ancho = this.anchoTexto(doc, tok.texto!, !!tok.bold, !!tok.italic);
      const extra = actual.length > 0 ? spaceW : 0;

      if (anchoActual + extra + ancho > width && actual.length > 0) {
        lineas.push(actual);
        actual = [];
        anchoActual = 0;
      }

      const extra2 = actual.length > 0 ? spaceW : 0;
      actual.push({ ...tok, ancho });
      anchoActual += extra2 + ancho;
    }

    if (actual.length) lineas.push(actual);
    return lineas;
  }

  private anchoTexto(doc: jsPDF, texto: string, bold: boolean, italic: boolean): number {
    doc.setFont('times', bold ? 'bold' : (italic ? 'italic' : 'normal'));
    doc.setFontSize(this.FS);
    return doc.getTextWidth(texto);
  }

  private imgBase64(src: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width  = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) { reject(new Error('canvas context')); return; }
        ctx.drawImage(img, 0, 0);
        resolve(c.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => reject(new Error(`No se pudo cargar: ${src}`));
      img.src = src;
    });
  }
}

interface Segmento {
  texto?: string;
  bold?: boolean;
  italic?: boolean;
  tab?: boolean;
}

interface Token {
  tipo: 'palabra' | 'tab';
  texto?: string;
  bold?: boolean;
  italic?: boolean;
  ancho?: number;
  gap?: number;
}
