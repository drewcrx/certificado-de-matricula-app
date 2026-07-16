export const environment = {
  production: true,
  // TODO: cuando el equipo de backend entregue los webhooks reales de n8n,
  // cambiar esto a false y poner la URL real en n8nBaseUrl. Hasta entonces
  // debe quedar en true, porque los builds de la app (incluido el APK) se
  // compilan con esta configuración de producción.
  usarMock: true,
  n8nBaseUrl: 'https://TU-INSTANCIA-N8N.example.com/webhook'
};
