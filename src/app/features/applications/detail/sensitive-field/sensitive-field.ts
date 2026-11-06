import { Component, DestroyRef, effect, inject, input, signal, untracked, computed } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, finalize, timer } from 'rxjs';
import { SensitiveFieldName } from '../../../../core/models';
import { httpErrorMessage } from '../../../../core/http-error';
import { maskValue } from '../../../../shared/pipes/mask-value';
import { ApplicationsApi } from '../../applications.api';

/** A revealed value is hidden again automatically after this long. */
export const REVEAL_VISIBLE_MS = 30_000;

/**
 * Shows a sensitive value masked by default.
 *
 * - `serverMasked = true`  (the normal case): `value` is already a masked placeholder from the
 *   API. "Reveal" calls the role-checked, audit-logged endpoint; the real value exists only in
 *   this component's memory, for 30 seconds, and is dropped when the data reloads or the
 *   component is destroyed. The Reveal button is rendered only if `canReveal`, but that is a UX
 *   hint: the API returns 403 to anyone not entitled to it.
 * - `serverMasked = false` (an owner looking at their own draft): `value` is what they typed.
 *   We still mask it for display and offer a local Show/Hide with no server call.
 *
 * Values are rendered with interpolation only (never innerHTML), so Angular escapes them.
 */
@Component({
  selector: 'app-sensitive-field',
    templateUrl: './sensitive-field.html',
})
export class SensitiveField {
  readonly applicationId = input.required<string>();
  readonly field = input.required<SensitiveFieldName>();
  readonly index = input(0);
  readonly label = input.required<string>();
  readonly value = input.required<string>();
  readonly serverMasked = input(true);
  readonly canReveal = input(false);

  readonly #api = inject(ApplicationsApi);
  readonly #destroyRef = inject(DestroyRef);

  protected readonly revealedValue = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  #hideTimer?: Subscription;

  protected readonly canToggle = computed(() => !this.serverMasked() || this.canReveal());
  protected readonly shown = computed(
    () => this.revealedValue() ?? (this.serverMasked() ? this.value() : maskValue(this.value())),
  );

  constructor() {
    // Fresh data from the server => forget anything that was revealed for the old data.
    effect(() => {
      this.value();
      untracked(() => this.hide());
    });
    this.#destroyRef.onDestroy(() => this.#hideTimer?.unsubscribe());
  }

  protected reveal(): void {
    this.error.set(null);
    if (!this.serverMasked()) {
      this.#show(this.value());
      return;
    }
    this.loading.set(true);
    this.#api
      .reveal(this.applicationId(), this.field(), this.index())
      .pipe(
        finalize(() => this.loading.set(false)),
        // Never let a late response put a plaintext value into a component that is already gone.
        takeUntilDestroyed(this.#destroyRef),
      )
      .subscribe({
        next: (res) => this.#show(res.value),
        error: (err: unknown) => this.error.set(httpErrorMessage(err, 'Could not reveal this value.')),
      });
  }

  protected hide(): void {
    this.#hideTimer?.unsubscribe();
    this.revealedValue.set(null);
  }

  #show(value: string): void {
    this.revealedValue.set(value);
    this.#hideTimer?.unsubscribe();
    this.#hideTimer = timer(REVEAL_VISIBLE_MS).subscribe(() => this.hide());
  }
}
