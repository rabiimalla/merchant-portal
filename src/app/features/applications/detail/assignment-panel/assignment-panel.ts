import { Component, DestroyRef, inject, input, linkedSignal, output, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { catchError, finalize, of } from 'rxjs';
import { httpErrorMessage } from '../../../../core/http-error';
import { ApplicationsApi } from '../../applications.api';

/** ADMIN-only. Loads the reviewer list itself, so non-admins never even make that request. */
@Component({
  selector: 'app-assignment-panel',
  templateUrl: './assignment-panel.html',
})
export class AssignmentPanel {
  readonly applicationId = input.required<string>();
  readonly currentReviewerId = input<string | null>(null);
  readonly assigned = output<void>();

  readonly #api = inject(ApplicationsApi);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * linkedSignal = a writable signal that resets itself whenever its source changes: the user's
   * pick is kept while they choose, but follows the server value after the page reloads.
   */
  protected readonly selectedId = linkedSignal<string>(() => this.currentReviewerId() ?? '');

  protected readonly reviewers = toSignal(
    this.#api.reviewers().pipe(
      catchError((err: unknown) => {
        this.error.set(httpErrorMessage(err));
        return of([]);
      }),
    ),
    { initialValue: [] },
  );

  readonly #destroyRef = inject(DestroyRef);

  protected assign(reviewerId: string): void {
    if (!reviewerId) return;
    this.saving.set(true);
    this.error.set(null);
    this.#api
      .assign(this.applicationId(), reviewerId)
      .pipe(finalize(() => this.saving.set(false)), takeUntilDestroyed(this.#destroyRef))
      .subscribe({
        next: () => this.assigned.emit(),
        error: (err: unknown) => this.error.set(httpErrorMessage(err)),
      });
  }
}
