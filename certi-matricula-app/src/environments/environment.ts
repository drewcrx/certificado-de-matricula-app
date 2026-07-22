// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  usarMock: false,
  n8nBaseUrl: 'http://localhost:5678/webhook',
  apiKey: '3B787n4olMCjx37oCKFzHapwWQd88yfL',
  // reCAPTCHA v2 real ("YaviBot Chat" en google.com/recaptcha/admin), con
  // dominios autorizados localhost + 192.168.1.11 (IP de red local para
  // pruebas desde celular). Antes de desplegar al VPS, agregar el dominio
  // real del instituto a la lista de dominios de ESTA misma clave (no hace
  // falta generar una nueva) — la Secret Key pareja vive en el nodo
  // "Verificar CAPTCHA (Google)" de workflow-consultar-estudiante.json.
  recaptchaSiteKey: '6Ld3V2AtAAAAAH8HpuOj-WLA-fuYJh2pPYBb9r0v'
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
