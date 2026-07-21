import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.uni.certimatricula',
  appName: 'Mesa de Ayuda',
  webDir: 'www',
  plugins: {
    SplashScreen: {
      // No lo ocultamos automáticamente: lo cierra AppComponent una vez que
      // Angular ya pintó la primera pantalla, para evitar el parpadeo blanco.
      launchAutoHide: false,
      backgroundColor: '#1f4fd6',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP'
    }
  }
};

export default config;
