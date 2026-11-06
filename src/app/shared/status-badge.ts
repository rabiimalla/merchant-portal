import { Component, computed, input } from '@angular/core';
import { ApplicationStatus } from '../core/models';

const LABELS: Record<ApplicationStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  IN_REVIEW: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const STYLES: Record<ApplicationStatus, string> = {
  DRAFT: 'text-bg-secondary',
  SUBMITTED: 'text-bg-info',
  IN_REVIEW: 'text-bg-warning',
  APPROVED: 'text-bg-success',
  REJECTED: 'text-bg-danger',
};

export const statusLabel = (s: ApplicationStatus): string => LABELS[s];

/** Colour is never the only signal: the status is always spelled out as text. */
@Component({
  selector: 'app-status-badge',
  template: `<span class="badge" [class]="style()">{{ label() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<ApplicationStatus>();
  protected readonly label = computed(() => LABELS[this.status()]);
  protected readonly style = computed(() => STYLES[this.status()]);
}
