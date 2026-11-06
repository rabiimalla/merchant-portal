import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in',
    loadComponent: () => import('./features/auth/login/login').then((m) => m.Login),
  },
  {
    path: 'applications',
    canActivate: [authGuard],
    // Lazy feature: the whole applications area is its own chunk, behind the auth guard.
    loadChildren: () => import('./features/applications/applications.routes').then((m) => m.APPLICATION_ROUTES),
  },
  {
    path: 'forbidden',
    canActivate: [authGuard],
    title: 'Not allowed',
    loadComponent: () => import('./features/errors/pages/forbidden').then((m) => m.Forbidden),
  },
  {
    path: '**',
    title: 'Not found',
    loadComponent: () => import('./features/errors/pages/not-found').then((m) => m.NotFound),
  },
];
