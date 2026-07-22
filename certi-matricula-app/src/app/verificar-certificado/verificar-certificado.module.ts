import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';

import { IonicModule } from '@ionic/angular';

import { VerificarCertificadoPageRoutingModule } from './verificar-certificado-routing.module';

import { VerificarCertificadoPage } from './verificar-certificado.page';

@NgModule({
  imports: [
    CommonModule,
    IonicModule,
    VerificarCertificadoPageRoutingModule
  ],
  declarations: [VerificarCertificadoPage]
})
export class VerificarCertificadoPageModule {}
