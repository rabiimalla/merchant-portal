import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';
import { User } from '../models';
import { AuthStore } from './auth.store';

interface SessionResponse {
  accessToken: string;
  user: User;
}

/**
 * Sent on the cookie-authenticated endpoints. Browsers will not add a custom header to a
 * cross-site form/img request, so its presence is a cheap CSRF defence on top of SameSite=Strict.
 */
const CSRF_HEADERS = new HttpHeaders({ 'X-Requested-With': 'merchant-portal' });

@Injectable({ providedIn: 'root' })
export class Auth {
  readonly #http = inject(HttpClient);
  readonly #store = inject(AuthStore);
  readonly #router = inject(Router);

  /**
   * THE single-flight refresh: while a refresh request is running, every caller gets the same
   * observable instead of firing its own. That is what makes "10 requests got a 401 together"
   * result in exactly one POST /api/auth/refresh (important because refresh tokens rotate:
   * a second concurrent refresh would present an already-used token and look like theft).
   */
  #refreshInFlight$: Observable<string> | null = null;

  login(email: string, password: string): Observable<User> {
    return this.#http.post<SessionResponse>('/api/auth/login', { email, password }).pipe(
      tap((s) => this.#store.setSession(s.user, s.accessToken)),
      map((s) => s.user),
    );
  }

  /** Called once at startup: the HttpOnly cookie may still hold a valid session after a reload. */
  restoreSession(): Observable<boolean> {
    return this.#requestRefresh().pipe(
      map(() => true),
      catchError(() => of(false)),
    );
  }

  /**
   * Used by the interceptor after a 401. `failedToken` is the token that request was sent with.
   * If somebody already refreshed since (the store holds a different token), just reuse the
   * new one rather than refreshing again.
   */
  refreshAfterUnauthorized(failedToken: string | null): Observable<string> {
    if (this.#refreshInFlight$) return this.#refreshInFlight$;
    const current = this.#store.accessToken();
    if (current && current !== failedToken) return of(current);
    return this.#requestRefresh().pipe(
      catchError((err: unknown) => {
        this.expireSession();
        return throwError(() => err);
      }),
    );
  }

  logout(): void {
    this.#http
      .post('/api/auth/logout', {}, { headers: CSRF_HEADERS })
      .pipe(catchError(() => of(null)))
      .subscribe(() => this.#endSession());
  }

  /** Session is unrecoverable (refresh failed / retry still 401): clear it and go to login. */
  expireSession(): void {
    if (!this.#store.isAuthenticated()) return;
    const returnUrl = this.#router.url;
    this.#store.clear();
    void this.#router.navigate(['/login'], { queryParams: returnUrl && returnUrl !== '/login' ? { returnUrl } : {} });
  }

  #endSession(): void {
    this.#store.clear();
    void this.#router.navigate(['/login']);
  }

  #requestRefresh(): Observable<string> {
    if (!this.#refreshInFlight$) {
      this.#refreshInFlight$ = this.#http
        .post<SessionResponse>('/api/auth/refresh', {}, { headers: CSRF_HEADERS })
        .pipe(
          tap((s) => this.#store.setSession(s.user, s.accessToken)),
          map((s) => s.accessToken),
          // Clear the slot however the request ends (success, error or unsubscribe).
          finalize(() => (this.#refreshInFlight$ = null)),
          // Everyone who joined while it was in flight receives the same result.
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this.#refreshInFlight$;
  }
}
