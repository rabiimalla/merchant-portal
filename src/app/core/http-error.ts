import { HttpErrorResponse } from '@angular/common/http';

/**
 * Turns any thrown value into a message that is safe and useful to show to a user.
 *
 * It also unwraps `resource()` errors: HttpErrorResponse is not an `Error` subclass, so a
 * resource may surface it as `Error.cause`. Handling both shapes keeps callers simple.
 */
export function httpErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const source = err instanceof Error && err.cause instanceof HttpErrorResponse ? err.cause : err;
  if (source instanceof HttpErrorResponse) {
    if (source.status === 0) return 'Cannot reach the server. Check your connection and try again.';
    const serverMessage = (source.error as { message?: unknown } | null)?.message;
    if (typeof serverMessage === 'string' && serverMessage.length < 200) return serverMessage;
    if (source.status === 403) return 'You do not have permission to do that.';
    if (source.status === 404) return 'We could not find what you were looking for.';
    if (source.status >= 500) return 'The server had a problem. Please retry in a moment.';
  }
  return fallback;
}
