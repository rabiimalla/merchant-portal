import { Injectable, computed, signal } from '@angular/core';
import { Role, User } from '../models';


/**
 * Holds the current session in memory.
 *
 * - `user` is a signal because templates and guards react to it (nav links, role checks).
 * - The access token is a plain private field, NOT a signal: nothing renders it, so making it
 *   reactive would only add change-tracking noise. It also never touches localStorage or
 *   sessionStorage, so an XSS payload cannot lift it from storage (the refresh token lives in an
 *   HttpOnly cookie that scripts cannot read at all).
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  #accessToken: string | null = null;
  readonly #user = signal<User | null>(null);

  readonly user = this.#user.asReadonly();
  readonly isAuthenticated = computed(() => this.#user() !== null);
  readonly role = computed<Role | null>(() => this.#user()?.role ?? null);

  accessToken(): string | null {
    return this.#accessToken;
  }

  setSession(user: User, accessToken: string): void {
    this.#accessToken = accessToken;
    this.#user.set(user);
  }

  setAccessToken(accessToken: string): void {
    this.#accessToken = accessToken;
  }

  clear(): void {
    this.#accessToken = null;
    this.#user.set(null);
  }

  hasRole(...roles: Role[]): boolean {
    const role = this.role();
    return role !== null && roles.includes(role);
  }
}
