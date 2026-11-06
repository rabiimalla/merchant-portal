import { inject } from '@angular/core';
import { CanActivateFn, CanDeactivateFn, CanMatchFn, Router } from '@angular/router';
import { AuthStore } from './auth.store';
import { Role } from '../models';

/** Keeps signed-in users away from the login page. */
export const guestGuard: CanActivateFn = () => {
  return inject(AuthStore).isAuthenticated() ? inject(Router).createUrlTree(['/applications']) : true;
};

/** Blocks anonymous users and remembers where they wanted to go. */
export const authGuard: CanActivateFn = (_route, state) => {
  const store = inject(AuthStore);
  if (store.isAuthenticated()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/**
 * Role gate as `canMatch` (not `canActivate`): when it fails the lazy chunk is never downloaded,
 * and the route is not even considered a match. Returning a UrlTree (instead of `false`) matters:
 * `false` would let the router fall through to the next route, e.g. `/applications/new` would
 * then match `:id` with id="new".
 *
 * This is UX + bundle hygiene. The real enforcement is the API (see mock-api/server.js).
 */
export const roleMatch =
  (...roles: Role[]): CanMatchFn =>
  () => (inject(AuthStore).hasRole(...roles) ? true : inject(Router).createUrlTree(['/forbidden']));

export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) =>
  !component.hasUnsavedChanges() || confirm('You have changes that are not saved yet. Leave anyway?');
