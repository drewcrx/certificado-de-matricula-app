import { NgModule } from '@angular/core';
import { PreloadAllModules, RouterModule, Routes } from '@angular/router';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'chat',
    pathMatch: 'full'
  },
  {
    path: 'chat',
    loadChildren: () => import('./chat/chat.module').then( m => m.ChatPageModule)
  },
  {
    // Pública (sin login/OTP) — a esta ruta apunta el QR impreso en el
    // certificado de matrícula (el QR funciona como firma de Secretaría).
    path: 'verificar-certificado/:codigo',
    loadChildren: () => import('./verificar-certificado/verificar-certificado.module').then(m => m.VerificarCertificadoPageModule)
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, { preloadingStrategy: PreloadAllModules })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule { }
