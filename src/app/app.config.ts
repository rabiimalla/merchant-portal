import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './core/auth/auth.interceptor';
import { firstValueFrom } from 'rxjs';
import { Auth } from './core/auth/auth';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // withComponentInputBinding: route params AND query params arrive as component inputs
    // (the dashboard uses it so the URL is the single source of truth for its filters).
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Block first render until we know whether the HttpOnly refresh cookie still holds a session,
    // so guards never flash the login page at someone who is actually signed in.
    provideAppInitializer(() => firstValueFrom(inject(Auth).restoreSession())),
  ]
};
