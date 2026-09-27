import { Component, inject, provideAppInitializer, isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  provideRouter,
  RouterOutlet,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app/app.routes';
import { Auth, authInterceptor } from './app/core/auth';
import { Toast } from './app/core/api';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  template: `<a class="skip-link" href="#main">Skip to content</a><router-outlet />
    @if (toast.message()) {
      <div class="toast" role="status">✓ {{ toast.message() }}</div>
    }`,
})
class App {
  toast = inject(Toast);
}
bootstrapApplication(App, {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    provideAppInitializer(() => inject(Auth).restore()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
}).catch(console.error);
