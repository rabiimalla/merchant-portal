import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, PartialMatchRouteSnapshot, Route, Router, RouterStateSnapshot, UrlSegment, UrlTree } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { routerTestProviders } from '../../../testing/providers';
import { authGuard, guestGuard, roleMatch, unsavedChangesGuard } from './auth.guards';
import { AuthStore } from './auth.store';
import { Role } from '../models';

describe('route guards', () => {
  let store: AuthStore;
  let router: Router;
  const signIn = (role: Role) => store.setSession({ id: 'u', name: 'T', email: 't@example.com', role }, 'token');
  const url = (result: unknown) => router.serializeUrl(result as UrlTree);

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [routerTestProviders()] });
    store = TestBed.inject(AuthStore);
    router = TestBed.inject(Router);
  });

  describe('authGuard', () => {
    const run = (target: string) =>
      TestBed.runInInjectionContext(() => authGuard({} as ActivatedRouteSnapshot, { url: target } as RouterStateSnapshot));

    it('sends anonymous users to login and remembers the target', () => {
      expect(url(run('/applications/app-1'))).toBe('/login?returnUrl=%2Fapplications%2Fapp-1');
    });

    it('lets signed-in users through', () => {
      signIn('SALES');
      expect(run('/applications')).toBe(true);
    });
  });

  describe('guestGuard', () => {
    it('keeps signed-in users out of the login page', () => {
      signIn('ADMIN');
      expect(url(TestBed.runInInjectionContext(() => guestGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)))).toBe('/applications');
    });
  });

  describe('roleMatch', () => {
    const run = (...roles: Role[]) =>
    TestBed.runInInjectionContext(() =>
      roleMatch(...roles)(
        {} as Route,
        [] as UrlSegment[],
        {} as PartialMatchRouteSnapshot
      )
    );

    it('allows a permitted role', () => {
      signIn('SALES');
      expect(run('SALES')).toBe(true);
    });

    it.each<Role>(['REVIEWER', 'ADMIN'])('redirects %s away from SALES-only routes to /forbidden', (role) => {
      signIn(role);
      expect(url(run('SALES'))).toBe('/forbidden');
    });

    it('denies anonymous users', () => {
      expect(url(run('SALES', 'ADMIN'))).toBe('/forbidden');
    });

    it('accepts any of several roles', () => {
      signIn('ADMIN');
      expect(run('REVIEWER', 'ADMIN')).toBe(true);
    });
  });

  describe('unsavedChangesGuard', () => {
    it('allows leaving when there is nothing unsaved', () => {
      const ok = TestBed.runInInjectionContext(() =>
        unsavedChangesGuard({ hasUnsavedChanges: () => false }, {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot, {} as RouterStateSnapshot),
      );
      expect(ok).toBe(true);
    });
  });
});
