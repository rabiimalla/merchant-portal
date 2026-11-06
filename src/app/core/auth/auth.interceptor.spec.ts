import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routerTestProviders } from '../../../testing/providers';
import { User } from '../models';
import { authInterceptor } from './auth.interceptor';
import { AuthStore } from './auth.store';

const user: User = { id: 'u-1', name: 'Test User', email: 'test@example.com', role: 'SALES' };
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('authInterceptor', () => {
  let http: HttpClient;
  let ctrl: HttpTestingController;
  let store: AuthStore;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [routerTestProviders(), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    ctrl = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    store.setSession(user, 'old-token');
  });

  afterEach(() => ctrl.verify()); // fails the test if any request was left unhandled

  it('attaches the bearer token to API requests', () => {
    http.get('/api/applications').subscribe();
    const req = ctrl.expectOne('/api/applications');
    expect(req.request.headers.get('Authorization')).toBe('Bearer old-token');
    req.flush({});
  });

  it('never sends the token to other origins', () => {
    http.get('https://third-party.example/data').subscribe();
    const req = ctrl.expectOne('https://third-party.example/data');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('does not attach the token to the auth endpoints', () => {
    http.post('/api/auth/login', {}).subscribe();
    const req = ctrl.expectOne('/api/auth/login');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('refreshes exactly once when several concurrent requests get 401, then replays all of them', () => {
    const results: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      http.get<{ name: string }>(`/api/${name}`).subscribe((r) => results.push(r.name));
    }
    for (const name of ['a', 'b', 'c']) {
      ctrl.expectOne(`/api/${name}`).flush({ message: 'expired' }, unauthorized);
    }

    // expectOne throws if there is more than one refresh call: that is the assertion.
    const refresh = ctrl.expectOne('/api/auth/refresh');
    expect(refresh.request.method).toBe('POST');
    refresh.flush({ accessToken: 'new-token', user });

    for (const name of ['a', 'b', 'c']) {
      const retried = ctrl.expectOne(`/api/${name}`);
      expect(retried.request.headers.get('Authorization')).toBe('Bearer new-token');
      retried.flush({ name });
    }

    expect(results.sort()).toEqual(['a', 'b', 'c']);
    expect(store.accessToken()).toBe('new-token');
  });

  it('does not refresh again for a late 401 that was sent with the already-replaced token', () => {
    const results: string[] = [];
    http.get<{ name: string }>('/api/a').subscribe((r) => results.push(r.name));
    http.get<{ name: string }>('/api/b').subscribe((r) => results.push(r.name));

    // A fails first and triggers the refresh, which completes before B's 401 arrives.
    ctrl.expectOne('/api/a').flush({}, unauthorized);
    ctrl.expectOne('/api/auth/refresh').flush({ accessToken: 'new-token', user });
    ctrl.expectOne('/api/a').flush({ name: 'a' }); // A's replay

    // B was sent with 'old-token'; its 401 must reuse 'new-token' without another refresh.
    ctrl.expectOne('/api/b').flush({}, unauthorized);
    const retriedB = ctrl.expectOne('/api/b');
    expect(retriedB.request.headers.get('Authorization')).toBe('Bearer new-token');
    retriedB.flush({ name: 'b' });
    ctrl.expectNone('/api/auth/refresh');

    expect(results.sort()).toEqual(['a', 'b']);
  });

  it('ends the session once, and fails every waiting request, when the refresh itself fails', () => {
    const statuses: number[] = [];
    for (const name of ['a', 'b']) {
      http.get(`/api/${name}`).subscribe({ error: (e: HttpErrorResponse) => statuses.push(e.status) });
    }
    ctrl.expectOne('/api/a').flush({}, unauthorized);
    ctrl.expectOne('/api/b').flush({}, unauthorized);
    ctrl.expectOne('/api/auth/refresh').flush({ message: 'Invalid refresh token' }, unauthorized);

    expect(statuses).toEqual([401, 401]);
    expect(store.isAuthenticated()).toBe(false);
    expect(store.accessToken()).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('never loops: if the replayed request is still 401 the session ends without a second refresh', () => {
    let status = 0;
    http.get('/api/a').subscribe({ error: (e: HttpErrorResponse) => (status = e.status) });
    ctrl.expectOne('/api/a').flush({}, unauthorized);
    ctrl.expectOne('/api/auth/refresh').flush({ accessToken: 'new-token', user });
    ctrl.expectOne('/api/a').flush({}, unauthorized); // replay is rejected too

    ctrl.expectNone('/api/auth/refresh');
    expect(status).toBe(401);
    expect(store.isAuthenticated()).toBe(false);
  });

  it('passes other errors through untouched and does not refresh', () => {
    let status = 0;
    http.get('/api/a').subscribe({ error: (e: HttpErrorResponse) => (status = e.status) });
    ctrl.expectOne('/api/a').flush({}, { status: 500, statusText: 'Server Error' });
    ctrl.expectNone('/api/auth/refresh');
    expect(status).toBe(500);
    expect(store.isAuthenticated()).toBe(true);
  });
});
