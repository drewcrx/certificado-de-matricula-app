import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { VerificarCertificadoPage } from './verificar-certificado.page';

const routes: Routes = [
  {
    path: '',
    component: VerificarCertificadoPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class VerificarCertificadoPageRoutingModule {}
