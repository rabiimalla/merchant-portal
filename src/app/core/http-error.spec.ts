import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { httpErrorMessage } from './http-error';

describe('httpErrorMessage', () => {
  it('prefers a short message from the server', () => {
    expect(httpErrorMessage(new HttpErrorResponse({ status: 422, error: { message: 'Ownership must add up to 100%' } }))).toBe(
      'Ownership must add up to 100%',
    );
  });

  it('maps status codes to friendly text', () => {
    expect(httpErrorMessage(new HttpErrorResponse({ status: 0 }))).toContain('Cannot reach the server');
    expect(httpErrorMessage(new HttpErrorResponse({ status: 403 }))).toContain('permission');
    expect(httpErrorMessage(new HttpErrorResponse({ status: 404 }))).toContain('could not find');
    expect(httpErrorMessage(new HttpErrorResponse({ status: 503 }))).toContain('server had a problem');
  });

  it('does not echo long or non-string server messages (could leak internals)', () => {
    expect(httpErrorMessage(new HttpErrorResponse({ status: 500, error: { message: 'x'.repeat(500) } }))).toContain('server had a problem');
    expect(httpErrorMessage(new HttpErrorResponse({ status: 400, error: { message: { stack: 'trace' } } }))).toBe(
      'Something went wrong. Please try again.',
    );
  });

  it('unwraps an HttpErrorResponse carried as Error.cause (how a resource may surface it)', () => {
    const wrapped = new Error('Http failure', { cause: new HttpErrorResponse({ status: 503 }) });
    expect(httpErrorMessage(wrapped)).toContain('server had a problem');
  });

  it('falls back for anything else', () => {
    expect(httpErrorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
    expect(httpErrorMessage(undefined, 'custom')).toBe('custom');
  });
});
