export const environment = {
  production: true,
  usarMock: false,
  n8nBaseUrl: 'http://localhost:5678/webhook',
  apiKey: '3B787n4olMCjx37oCKFzHapwWQd88yfL',
  // reCAPTCHA v2 real ("YaviBot Chat") — antes de desplegar, agregar el
  // dominio real del instituto a esta misma clave en google.com/recaptcha/admin
  // (ver environment.ts para el detalle).
  recaptchaSiteKey: '6Ld3V2AtAAAAAH8HpuOj-WLA-fuYJh2pPYBb9r0v'
};
