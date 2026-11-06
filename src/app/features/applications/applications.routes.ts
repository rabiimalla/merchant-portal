import { Routes } from '@angular/router';
import { roleMatch, unsavedChangesGuard } from '../../core/auth/auth.guards';

/**
 * Order matters: the static `new` must be declared before the `:id` wildcard.
 * `canMatch` role gates keep the wizard chunk from even downloading for non-sales users.
 */
export const APPLICATION_ROUTES: Routes = [
  {
    path: '',
    title: 'Applications',
    loadComponent: () => import('./dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'new',
    title: 'New application',
    canMatch: [roleMatch('SALES')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./wizard/wizard').then((m) => m.Wizard),
  },
  {
    path: ':id/edit',
    title: 'Edit application',
    canMatch: [roleMatch('SALES')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./wizard/wizard').then((m) => m.Wizard),
  },
  {
    path: ':id',
    title: 'Application',
    loadComponent: () => import('./detail/detail').then((m) => m.Detail),
  },
];
