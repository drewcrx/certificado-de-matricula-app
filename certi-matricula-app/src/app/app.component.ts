import { AfterViewInit, Component } from '@angular/core';
import { SplashScreen } from '@capacitor/splash-screen';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements AfterViewInit {
  constructor() {}

  ngAfterViewInit(): void {
    // Se espera al siguiente frame para asegurar que la pantalla del chat
    // ya esté pintada antes de retirar el splash nativo (evita el flash blanco).
    requestAnimationFrame(() => {
      SplashScreen.hide();
    });
  }
}
