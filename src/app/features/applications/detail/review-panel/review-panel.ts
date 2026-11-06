import { Component, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';
import { httpErrorMessage } from '../../../../core/http-error';
import { DecisionPayload, RiskLevel } from '../../../../core/models';
import { controlError } from '../../../../shared/form-errors';
import { ApplicationsApi } from '../../applications.api';

/**
 * Reviewer decision form. The parent only renders this when the API says `permissions.canDecide`
 * (so SALES and unassigned users never see it); the API rejects the call for anyone else anyway.
 */
@Component({
  selector: 'app-review-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './review-panel.html',
})
export class ReviewPanel {
  readonly applicationId = input.required<string>();
  readonly decided = output<void>();

  readonly #api = inject(ApplicationsApi);
  readonly #fb = inject(NonNullableFormBuilder);

  protected readonly levels: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.#fb.group({
    decision: ['' as '' | 'APPROVED' | 'REJECTED', [Validators.required]],
    riskLevel: ['' as '' | RiskLevel, [Validators.required]],
    note: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(1000)]],
  });

  protected err(name: 'decision' | 'riskLevel' | 'note', label: string): string | null {
    return controlError(this.form.controls[name], label);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { decision, riskLevel, note } = this.form.getRawValue();
    const payload: DecisionPayload = { decision: decision as 'APPROVED' | 'REJECTED', riskLevel: riskLevel as RiskLevel, note: note.trim() };
    this.submitting.set(true);
    this.error.set(null);
    this.#api
      .decide(this.applicationId(), payload)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: () => this.decided.emit(),
        error: (err: unknown) => this.error.set(httpErrorMessage(err)),
      });
  }
}
