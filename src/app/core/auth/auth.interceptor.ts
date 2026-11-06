import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { Auth } from './auth';
import { AuthStore } from './auth.store';

/** Auth endpoints manage their own credentials; they must never get a bearer token or a 401 retry. */
const AUTH_ENDPOINT = /^\/api\/auth\/(login|refresh|logout)$/;

const withToken = <T>(req: HttpRequest<T>, token: string | null): HttpRequest<T> =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

/**
 * 1. Attach the bearer token to API calls (and only API calls: never leak it to other origins).
 * 2. On 401, refresh ONCE (shared across concurrent requests, see Auth) and replay.
 *
 * "Once" is guaranteed structurally: the replayed request is not wrapped in this catchError,
 * so a second 401 cannot trigger another refresh or a retry loop. It ends the session instead.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const path = req.url.split('?')[0];
  if (!path.startsWith('/api/') || AUTH_ENDPOINT.test(path)) return next(req);

  const auth = inject(Auth);
  const store = inject(AuthStore);
  const sentToken = store.accessToken();

  return next(withToken(req, sentToken)).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);

      return auth.refreshAfterUnauthorized(sentToken).pipe(
        switchMap((freshToken) =>
          next(withToken(req, freshToken)).pipe(
            catchError((retryErr: unknown) => {
              // Fresh token and still unauthorised: the session is genuinely over.
              if (retryErr instanceof HttpErrorResponse && retryErr.status === 401) auth.expireSession();
              return throwError(() => retryErr);
            }),
          ),
        ),
      );
    }),
  );
};
