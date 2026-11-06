import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, input, numberAttribute } from '@angular/core';
import { rxResource, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { AuthStore } from '../../../core/auth/auth.store';
import { httpErrorMessage } from '../../../core/http-error';
import { APPLICATION_STATUSES, ApplicationStatus, ApplicationSummary } from '../../../core/models';
import { StatusBadge, statusLabel } from '../../../shared/status-badge';
import { ApplicationsApi } from '../applications.api';

const PAGE_SIZES = [10, 25, 50] as const;
const toStatus = (v: unknown): ApplicationStatus | '' =>
  APPLICATION_STATUSES.includes(v as ApplicationStatus) ? (v as ApplicationStatus) : '';

// OnPush is the Angular 22 default, so there is no `changeDetection` line here.
@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, ReactiveFormsModule, DatePipe, StatusBadge],
  templateUrl: './dashboard.html',
})
export class Dashboard {
  // The URL is the single source of truth for filters/paging: withComponentInputBinding()
  // feeds ?page=&status=&q=&pageSize= into these inputs, so reload, back button and shared links
  // all just work, and there is no second copy of the state to keep in sync.
  readonly page = input<number, unknown>(1, { transform: (v) => Math.max(1, numberAttribute(v, 1)) });
  readonly pageSize = input<number, unknown>(10, {
    transform: (v) => (PAGE_SIZES.includes(Number(v) as 10) ? Number(v) : 10),
  });
  readonly status = input<ApplicationStatus | '', unknown>('', { transform: toStatus });
  readonly q = input<string, unknown>('', { transform: (v) => (typeof v === 'string' ? v : '') });

  readonly #api = inject(ApplicationsApi);
  readonly #router = inject(Router);
  readonly #store = inject(AuthStore);

  protected readonly statuses = APPLICATION_STATUSES;
  protected readonly pageSizes = PAGE_SIZES;
  protected readonly statusLabel = statusLabel;
  protected readonly search = new FormControl('', { nonNullable: true });

  /**
   * Server data as a resource (stable in Angular 22). `params` is a reactive function: when any
   * input signal changes, the previous request is cancelled and a new one starts, so a slow
   * earlier page can never overwrite a newer one. The resource also provides loading / error
   * state and `reload()` (the Retry button), replacing hand-written state plumbing.
   *
   * Why rxResource (not httpResource): the call goes through ApplicationsApi, the single typed
   * place that knows URLs, and it is trivial to mock in tests.
   */
  protected readonly list = rxResource({
    params: () => ({ page: this.page(), pageSize: this.pageSize(), status: this.status(), q: this.q() }),
    stream: ({ params }) => this.#api.list(params),
  });

  protected readonly canCreate = computed(() => this.#store.hasRole('SALES'));
  protected readonly title = computed(() => {
    const role = this.#store.role();
    return role === 'REVIEWER' ? 'My review queue' : role === 'ADMIN' ? 'All applications' : 'My applications';
  });
  protected readonly hasFilters = computed(() => !!this.status() || !!this.q());

  /** The loaded page, or undefined while loading / after an error. (value() throws in error state.) */
  protected readonly data = computed(() => (this.list.hasValue() ? this.list.value() : undefined));
  protected readonly errorMessage = computed(() => {
    const err = this.list.error();
    return err ? httpErrorMessage(err) : null;
  });

  protected readonly totalPages = computed(() => {
    const d = this.data();
    return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  });

  /** Sliding window of at most 5 page buttons around the current page. */
  protected readonly pageNumbers = computed(() => {
    const total = this.totalPages();
    const start = Math.max(1, Math.min(this.page() - 2, total - 4));
    const end = Math.min(total, start + 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  });

  /** Spoken by screen readers via an aria-live region whenever the result changes. */
  protected readonly announcement = computed(() => {
    const message = this.errorMessage();
    if (message) return `Could not load applications. ${message}`;
    const d = this.data();
    if (!d) return 'Loading applications';
    return `${d.total} applications found. Page ${d.page} of ${this.totalPages()}.`;
  });

  protected readonly rangeText = computed(() => {
    const d = this.data();
    if (!d || d.total === 0) return '';
    const from = (d.page - 1) * d.pageSize + 1;
    return `Showing ${from}–${from + d.items.length - 1} of ${d.total}`;
  });

  constructor() {
    // Debounce typing: one request per pause, not per keystroke. Time-based, so RxJS.
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => this.#navigate({ q: value.trim() || null, page: null }));

    // Keep the box in sync when the URL changes from outside (back button, shared link).
    effect(() => {
      const q = this.q();
      if (this.search.value !== q) this.search.setValue(q, { emitEvent: false });
    });
  }

  protected onStatusChange(event: Event): void {
    this.#navigate({ status: (event.target as HTMLSelectElement).value || null, page: null });
  }

  protected onPageSizeChange(event: Event): void {
    const size = Number((event.target as HTMLSelectElement).value);
    this.#navigate({ pageSize: size === 10 ? null : size, page: null });
  }

  protected goToPage(n: number): void {
    if (n < 1 || n > this.totalPages() || n === this.page()) return;
    this.#navigate({ page: n === 1 ? null : n });
  }

  protected clearFilters(): void {
    this.search.setValue('', { emitEvent: false });
    this.#navigate({ status: null, q: null, page: null });
  }

  protected retry(): void {
    this.list.reload();
  }

  /** Draft owners get an "Edit" shortcut. UX only: the API re-checks ownership on every call. */
  protected canEdit(app: ApplicationSummary): boolean {
    return this.#store.hasRole('SALES') && app.status === 'DRAFT';
  }

  #navigate(queryParams: Record<string, string | number | null>): void {
    void this.#router.navigate([], { queryParams, queryParamsHandling: 'merge' });
  }
}
