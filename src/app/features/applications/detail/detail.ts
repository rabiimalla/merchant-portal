import { DatePipe } from '@angular/common';
import { Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { httpErrorMessage } from '../../../core/http-error';
import { RiskEvent } from '../../../core/models';
import { StatusBadge } from '../../../shared/status-badge';
import { ApplicationsApi } from '../applications.api';
import { AssignmentPanel } from './assignment-panel/assignment-panel';
import { ReviewPanel } from './review-panel/review-panel';
import { SensitiveField } from './sensitive-field/sensitive-field';

const EVENT_LABELS: Record<RiskEvent['type'], string> = {
  SUBMISSION: 'Submitted',
  ASSIGNMENT: 'Assigned',
  DECISION: 'Decision',
};

@Component({
  selector: 'app-detail',
  imports: [RouterLink, DatePipe, StatusBadge, SensitiveField, ReviewPanel, AssignmentPanel],
  templateUrl: './detail.html',
  styleUrl: './detail.scss',
})
export class Detail {
  /** Route param, bound as an input by withComponentInputBinding(). */
  readonly id = input.required<string>();

  readonly #api = inject(ApplicationsApi);

  /**
   * One resource per page: navigating to another id cancels the previous request and starts a new
   * one; `reload()` re-fetches after a decision or an assignment so permissions and history refresh.
   */
  protected readonly application = rxResource({
    params: () => this.id(),
    stream: ({ params }) => this.#api.get(params),
  });

  protected readonly errorMessage = computed(() => {
    const err = this.application.error();
    return err ? httpErrorMessage(err) : null;
  });

  protected readonly eventLabel = (e: RiskEvent): string => EVENT_LABELS[e.type];

  protected reload(): void {
    this.application.reload();
  }
}
