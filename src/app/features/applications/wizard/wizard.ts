import { HttpErrorResponse } from '@angular/common/http';
import { Location } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  Observable,
  Subject,
  catchError,
  concatMap,
  debounceTime,
  filter,
  finalize,
  map,
  merge,
  of,
  retry,
  switchMap,
  tap,
  throwError,
  timer,
} from 'rxjs';
import { HasUnsavedChanges } from '../../../core/auth/auth.guards';
import { httpErrorMessage } from '../../../core/http-error';
import { ApplicationData, ApplicationDetail } from '../../../core/models';
import { firstErrorMessage } from '../../../shared/form-errors';
import { Mask } from '../../../shared/pipes/mask';
import { TextField } from '../../../shared/text-field/text-field';
import {
  accountNumberValidator,
  fieldsMatchValidator,
  notBlankValidator,
  optionalUrlValidator,
  ownershipTotalValidator,
  phoneValidator,
  routingNumberValidator,
  taxIdValidator,
} from '../../../shared/validators/validators';
import { ApplicationsApi } from '../applications.api';

/** How long the user must stop typing before we save. */
export const AUTOSAVE_DEBOUNCE_MS = 1200;
const MAX_OWNERS = 4;

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'error'; message: string };

/** Only network hiccups and 5xx are worth retrying; a 4xx will fail the same way again. */
const isTransient = (err: unknown): boolean =>
  err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 500);

@Component({
  selector: 'app-wizard',
  imports: [ReactiveFormsModule, RouterLink, TextField, Mask],
  templateUrl: './wizard.html',
})
export class Wizard implements OnInit, HasUnsavedChanges {
  /** Route param (/applications/:id/edit); undefined for /applications/new. */
  readonly id = input<string>();

  readonly #fb = inject(NonNullableFormBuilder);
  readonly #api = inject(ApplicationsApi);
  readonly #router = inject(Router);
  readonly #location = inject(Location);
  readonly #destroyRef = inject(DestroyRef);
  readonly #injector = inject(Injector);
  readonly #host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly industries = ['Retail', 'Food & Beverage', 'Services', 'Healthcare', 'Other'];
  protected readonly steps = ['Business', 'Owners', 'Banking', 'Review'] as const;
  protected readonly maxOwners = MAX_OWNERS;
  protected readonly stepHeading = viewChild<ElementRef<HTMLElement>>('stepHeading');

  readonly step = signal(0);
  readonly saveState = signal<SaveState>({ kind: 'idle' });
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);
  readonly showSensitive = signal(false);

  readonly form = this.#fb.group({
    business: this.#fb.group({
      legalName: ['', [Validators.required, notBlankValidator(), Validators.maxLength(120)]],
      dba: ['', [Validators.maxLength(120)]],
      taxId: ['', [Validators.required, taxIdValidator()]],
      industry: ['', [Validators.required]],
      website: ['', [optionalUrlValidator()]],
      phone: ['', [Validators.required, phoneValidator()]],
      email: ['', [Validators.required, Validators.email]],
      line1: ['', [Validators.required, notBlankValidator()]],
      city: ['', [Validators.required, notBlankValidator()]],
      postalCode: ['', [Validators.required, Validators.maxLength(12)]],
    }),
    owners: this.#fb.array([this.newOwner()], { validators: [ownershipTotalValidator()] }),
    banking: this.#fb.group(
      {
        bankName: ['', [Validators.required, notBlankValidator()]],
        routingNumber: ['', [Validators.required, routingNumberValidator()]],
        accountNumber: ['', [Validators.required, accountNumberValidator()]],
        confirmAccountNumber: ['', [Validators.required]],
      },
      { validators: [fieldsMatchValidator('accountNumber', 'confirmAccountNumber')] },
    ),
  });

  protected get owners() {
    return this.form.controls.owners;
  }

  // --- autosave plumbing ---
  #appId: string | null = null;
  #hydrating = false;
  #submitted = false;
  /** Incremented on every user edit, so a save knows whether newer edits arrived while it ran. */
  #changeSeq = 0;
  /** Explicit save requests (Retry button, pre-submit flush). They share the autosave queue. */
  readonly #saveRequests$ = new Subject<((ok: boolean) => void) | undefined>();

  constructor() {
    const edits$ = this.form.valueChanges.pipe(
      filter(() => !this.#hydrating),
      tap(() => {
        this.#changeSeq++;
        this.saveState.set({ kind: 'dirty' });
      }),
      debounceTime(AUTOSAVE_DEBOUNCE_MS),
      map((): ((ok: boolean) => void) | undefined => undefined),
    );

    // concatMap = saves run strictly one after another, in order, and none is dropped or
    // cancelled mid-flight. Each save reads the CURRENT form value when it starts, so it always
    // sends the newest data. (See README for why not switchMap/exhaustMap.)
    merge(edits$, this.#saveRequests$)
      .pipe(
        concatMap((done) => this.#persist().pipe(tap((ok) => done?.(ok)))),
        takeUntilDestroyed(),
      )
      .subscribe();
  }

  ngOnInit(): void {
    const id = this.id();
    if (!id) return;
    this.#appId = id;
    this.loading.set(true);
    this.#api
      .get(id)
      .pipe(
        finalize(() => this.loading.set(false)),
        takeUntilDestroyed(this.#destroyRef),
      )
      .subscribe({
        next: (detail) => {
          if (!detail.permissions.canEdit) {
            void this.#router.navigate(['/forbidden']);
            return;
          }
          this.#hydrate(detail);
        },
        error: (err: unknown) => this.loadError.set(httpErrorMessage(err)),
      });
  }

  /** Used by the canDeactivate guard. */
  hasUnsavedChanges(): boolean {
    if (this.#submitted) return false;
    return ['dirty', 'saving', 'error'].includes(this.saveState().kind);
  }

  // ---------- step navigation ----------
  protected stepControl(i: number): AbstractControl {
    const c = this.form.controls;
    return i === 0 ? c.business : i === 1 ? c.owners : i === 2 ? c.banking : this.form;
  }

  protected next(): void {
    const control = this.stepControl(this.step());
    if (control.invalid) {
      control.markAllAsTouched();
      afterNextRender(() => this.#host.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(), {
        injector: this.#injector,
      });
      return;
    }
    this.#goTo(this.step() + 1);
  }

  protected back(): void {
    this.#goTo(this.step() - 1);
  }

  protected jumpTo(i: number): void {
    if (i < this.step()) this.#goTo(i); // only backwards: later steps must be validated in order
  }

  #goTo(i: number): void {
    this.step.set(Math.max(0, Math.min(i, this.steps.length - 1)));
    // Move focus to the new step's heading so keyboard/screen-reader users land in context.
    afterNextRender(() => this.stepHeading()?.nativeElement.focus(), { injector: this.#injector });
  }

  // ---------- owners ----------
  protected newOwner() {
    return this.#fb.group({
      fullName: ['', [Validators.required, notBlankValidator(), Validators.maxLength(120)]],
      title: ['', [Validators.maxLength(80)]],
      ownershipPercent: ['', [Validators.required, Validators.min(1), Validators.max(100)]],
      nationalId: ['', [Validators.required, Validators.minLength(4), Validators.maxLength(20)]],
      email: ['', [Validators.required, Validators.email]],
    });
  }

  protected addOwner(): void {
    if (this.owners.length < MAX_OWNERS) this.owners.push(this.newOwner());
  }

  protected removeOwner(index: number): void {
    if (this.owners.length > 1) this.owners.removeAt(index);
  }

  // ---------- group-level error text (field-level errors render inside app-text-field) ----------
  protected readonly ownersError = (): string | null =>
    this.owners.touched && this.owners.errors?.['ownershipTotal']
      ? `Ownership must add up to 100% (currently ${(this.owners.errors['ownershipTotal'] as { actual: number }).actual}%).`
      : null;

  protected readonly accountMismatch = (): string | null => {
    const banking = this.form.controls.banking;
    return banking.errors?.['fieldsMismatch'] && banking.controls.confirmAccountNumber.touched
      ? 'Account numbers do not match.'
      : null;
  };

  protected industryError = (): string | null => {
    const c = this.form.controls.business.controls.industry;
    return c.invalid && c.touched ? firstErrorMessage(c.errors, 'Industry') : null;
  };

  // ---------- autosave ----------
  protected retrySave(): void {
    this.#saveRequests$.next(undefined);
  }

  #toPayload(): ApplicationData {
    const v = this.form.getRawValue();
    return {
      business: v.business,
      owners: v.owners.map((o) => ({ ...o, ownershipPercent: Number(o.ownershipPercent) || 0 })),
      // confirmAccountNumber is a UI-only field and is never sent.
      banking: { bankName: v.banking.bankName, routingNumber: v.banking.routingNumber, accountNumber: v.banking.accountNumber },
    };
  }

  /** Emits exactly once: true if saved, false if it failed. Never errors, so the queue survives. */
  #persist(): Observable<boolean> {
    const seq = this.#changeSeq;
    const payload = this.#toPayload();
    this.saveState.set({ kind: 'saving' });

    const request$: Observable<unknown> = this.#appId
      ? this.#api.saveDraft(this.#appId, payload)
      : this.#api.createDraft(payload).pipe(
          tap((created) => {
            this.#appId = created.id;
            // Make a reload land on the edit page, without re-creating the component.
            this.#location.replaceState(`/applications/${created.id}/edit`);
          }),
        );

    return request$.pipe(
      retry({ count: 2, delay: (err, attempt) => (isTransient(err) ? timer(500 * attempt) : throwError(() => err)) }),
      map(() => {
        // If the user typed while we were saving, we are NOT "saved": another save is already queued.
        this.saveState.set(seq === this.#changeSeq ? { kind: 'saved', at: new Date() } : { kind: 'dirty' });
        return true;
      }),
      // Failure never touches the form: values stay exactly as the user typed them.
      catchError((err: unknown) => {
        this.saveState.set({ kind: 'error', message: httpErrorMessage(err, 'Could not save your draft.') });
        return of(false);
      }),
    );
  }

  /** Flush through the same queue so a pending autosave and the submit cannot race (no double-create). */
  #flush(): Observable<boolean> {
    return new Observable<boolean>((subscriber) => {
      this.#saveRequests$.next((ok) => {
        subscriber.next(ok);
        subscriber.complete();
      });
    });
  }

  // ---------- submit ----------
  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.submitError.set('Some fields need attention. Go back and fix the highlighted fields.');
      return;
    }
    this.submitting.set(true);
    this.submitError.set(null);
    this.#flush()
      .pipe(
        // If the pre-submit save failed we must NOT submit a stale draft; tell the user why.
        tap((saved) => {
          if (!saved) this.submitError.set('We could not save your draft, so nothing was submitted. Use "Retry save", then submit again.');
        }),
        filter((saved) => saved),
        switchMap(() => this.#api.submit(this.#appId as string)),
        finalize(() => this.submitting.set(false)),
        takeUntilDestroyed(this.#destroyRef),
      )
      .subscribe({
        next: (detail) => {
          this.#submitted = true;
          void this.#router.navigate(['/applications', detail.id]);
        },
        error: (err: unknown) => this.submitError.set(httpErrorMessage(err)),
      });
  }

  // ---------- loading an existing draft ----------
  #hydrate(detail: ApplicationDetail): void {
    const { data } = detail;
    this.#hydrating = true; // patching must not trigger an autosave
    this.owners.clear({ emitEvent: false });
    const count = Math.max(1, data.owners.length);
    for (let i = 0; i < count; i++) this.owners.push(this.newOwner(), { emitEvent: false });
    this.form.patchValue({
      business: data.business,
      owners: data.owners.map((o) => ({ ...o, ownershipPercent: o.ownershipPercent ? String(o.ownershipPercent) : '' })),
      banking: { ...data.banking, confirmAccountNumber: data.banking.accountNumber },
    });
    this.#hydrating = false;
    this.form.markAsPristine();
    this.saveState.set({ kind: 'idle' });
  }
}
