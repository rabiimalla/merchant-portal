import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { defer, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { routerTestProviders } from '../../../../testing/providers';
import { ApplicationDetail } from '../../../core/models';
import { ApplicationsApi } from '../applications.api';
import { AUTOSAVE_DEBOUNCE_MS, Wizard } from './wizard';

const validValues = {
  business: {
    legalName: 'Sample Co LLC', dba: '', taxId: '00-1234567', industry: 'Retail', website: '', phone: '+1 555 0100',
    email: 'contact@example.com', line1: '1 Test Street', city: 'Testville', postalCode: '12345',
  },
  owners: [{ fullName: 'Test Owner', title: '', ownershipPercent: '100', nationalId: '000-00-1234', email: 'owner@example.com' }],
  banking: { bankName: 'Test Bank', routingNumber: '000012344', accountNumber: '000123456789', confirmAccountNumber: '000123456789' },
};

describe('Wizard', () => {
  const api = { createDraft: vi.fn(), saveDraft: vi.fn(), submit: vi.fn(), get: vi.fn() };
  let fixture: ComponentFixture<Wizard>;
  let wizard: Wizard;
  // Protected members are reachable through this view of the component, which keeps the
  // production API surface small while still letting the tests drive the UI actions.
  const internals = () => wizard as unknown as { retrySave(): void; submit(): void; next(): void; step(): number };

  const create = (inputs: Record<string, unknown> = {}) => {
    fixture = TestBed.createComponent(Wizard);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    wizard = fixture.componentInstance;
  };
  const legalName = () => wizard.form.controls.business.controls.legalName;
  const created = (id: string) => of({ id } as ApplicationDetail);

  beforeEach(() => {
    vi.useFakeTimers();
    Object.values(api).forEach((fn) => fn.mockReset());
    TestBed.configureTestingModule({
      providers: [routerTestProviders(), { provide: ApplicationsApi, useValue: api }],
    });
  });

  afterEach(() => vi.useRealTimers());

  describe('autosave', () => {
    it('debounces a burst of edits into a single save with the latest values', async () => {
      api.createDraft.mockReturnValue(created('app-1'));
      create();

      legalName().setValue('A');
      legalName().setValue('Ac');
      legalName().setValue('Acme');
      expect(wizard.saveState().kind).toBe('dirty');

      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS - 1);
      expect(api.createDraft).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(api.createDraft).toHaveBeenCalledTimes(1);
      expect(api.createDraft.mock.calls[0][0].business.legalName).toBe('Acme');
      expect(wizard.saveState().kind).toBe('saved');
    });

    it('creates the draft once, then updates it (PUT) on later edits', async () => {
      api.createDraft.mockReturnValue(created('app-1'));
      api.saveDraft.mockReturnValue(of({ id: 'app-1', updatedAt: 'now' }));
      create();

      legalName().setValue('First');
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      legalName().setValue('Second');
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

      expect(api.createDraft).toHaveBeenCalledTimes(1);
      expect(api.saveDraft).toHaveBeenCalledTimes(1);
      expect(api.saveDraft.mock.calls[0][0]).toBe('app-1');
      expect(api.saveDraft.mock.calls[0][1].business.legalName).toBe('Second');
    });

    it('keeps the form intact when saving fails, and recovers on retry', async () => {
      api.createDraft.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 422, error: { message: 'Rejected' } })));
      create();

      legalName().setValue('Acme');
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

      const state = wizard.saveState();
      expect(state.kind).toBe('error');
      expect(state.kind === 'error' && state.message).toBe('Rejected');
      expect(legalName().value).toBe('Acme'); // nothing lost
      expect(wizard.hasUnsavedChanges()).toBe(true);

      api.createDraft.mockReturnValueOnce(created('app-7'));
      internals().retrySave();
      await vi.advanceTimersByTimeAsync(0);

      expect(wizard.saveState().kind).toBe('saved');
      expect(wizard.hasUnsavedChanges()).toBe(false);
    });

    it('retries transient failures (5xx / network) with backoff, but not client errors', async () => {
      let attempts = 0;
      api.createDraft.mockReturnValue(
        defer(() => {
          attempts++;
          return attempts < 3 ? throwError(() => new HttpErrorResponse({ status: 503 })) : created('app-1');
        }),
      );
      create();

      legalName().setValue('Acme');
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(500); // 1st backoff
      expect(attempts).toBe(2);
      await vi.advanceTimersByTimeAsync(1000); // 2nd backoff
      expect(attempts).toBe(3);
      expect(wizard.saveState().kind).toBe('saved');
    });

    it('does not claim "saved" if the user kept typing while a save was running', async () => {
      let finish: (() => void) | undefined;
      api.createDraft.mockReturnValue(
        defer(
          () =>
            new Promise<ApplicationDetail>((resolve) => {
              finish = () => resolve({ id: 'app-1' } as ApplicationDetail);
            }),
        ),
      );
      api.saveDraft.mockReturnValue(of({ id: 'app-1', updatedAt: 'now' }));
      create();

      legalName().setValue('One');
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(wizard.saveState().kind).toBe('saving');

      legalName().setValue('Two'); // typed during the in-flight save
      finish?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(wizard.saveState().kind).toBe('dirty');

      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(api.saveDraft).toHaveBeenCalledTimes(1); // the queued follow-up save
      expect(wizard.saveState().kind).toBe('saved');
    });
  });

  describe('editing an existing draft', () => {
    const detail = {
      id: 'app-5',
      status: 'DRAFT',
      permissions: { canEdit: true, canReveal: false, canDecide: false, canAssign: false },
      data: {
        business: { ...validValues.business },
        owners: [
          { fullName: 'A', title: '', ownershipPercent: 60, nationalId: '000-00-1111', email: 'a@example.com' },
          { fullName: 'B', title: '', ownershipPercent: 40, nationalId: '000-00-2222', email: 'b@example.com' },
        ],
        banking: { bankName: 'Test Bank', routingNumber: '000012344', accountNumber: '000123456789' },
      },
    } as unknown as ApplicationDetail;

    it('loads values into the form WITHOUT triggering an autosave', async () => {
      api.get.mockReturnValue(of(detail));
      create({ id: 'app-5' });

      expect(wizard.form.controls.business.controls.legalName.value).toBe('Sample Co LLC');
      expect(wizard.form.controls.owners.length).toBe(2);
      expect(wizard.form.controls.banking.controls.confirmAccountNumber.value).toBe('000123456789');

      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
      expect(api.saveDraft).not.toHaveBeenCalled();
      expect(api.createDraft).not.toHaveBeenCalled();
      expect(wizard.hasUnsavedChanges()).toBe(false);
    });

    it('saves to the existing id', async () => {
      api.get.mockReturnValue(of(detail));
      api.saveDraft.mockReturnValue(of({ id: 'app-5', updatedAt: 'now' }));
      create({ id: 'app-5' });

      legalName().setValue('Renamed Co');
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(api.saveDraft).toHaveBeenCalledWith('app-5', expect.objectContaining({ business: expect.objectContaining({ legalName: 'Renamed Co' }) }));
    });

    it('redirects to /forbidden if the server says the user cannot edit it', () => {
      api.get.mockReturnValue(of({ ...detail, permissions: { ...detail.permissions, canEdit: false } }));
      TestBed.inject(Router); // ensure the router exists before spying
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      create({ id: 'app-5' });
      expect(navigate).toHaveBeenCalledWith(['/forbidden']);
    });
  });

  describe('validation and navigation', () => {
    it('blocks "Next" on an invalid step and marks the fields as touched', () => {
      create();
      internals().next();
      expect(internals().step()).toBe(0);
      expect(legalName().touched).toBe(true);
      expect(legalName().hasError('required')).toBe(true);
    });

    it('advances once the step is valid', () => {
      create();
      wizard.form.controls.business.setValue(validValues.business);
      internals().next();
      expect(internals().step()).toBe(1);
    });

    it('requires ownership to add up to 100%', () => {
      create();
      wizard.form.controls.owners.at(0).patchValue({ ...validValues.owners[0], ownershipPercent: '60' });
      expect(wizard.form.controls.owners.hasError('ownershipTotal')).toBe(true);
      wizard.form.controls.owners.at(0).patchValue({ ownershipPercent: '100' });
      expect(wizard.form.controls.owners.valid).toBe(true);
    });

    it('requires the account number confirmation to match', () => {
      create();
      wizard.form.controls.banking.setValue({ ...validValues.banking, confirmAccountNumber: '999999999' });
      expect(wizard.form.controls.banking.hasError('fieldsMismatch')).toBe(true);
    });

    it('never sends the UI-only confirmation field to the API', async () => {
      api.createDraft.mockReturnValue(created('app-1'));
      create();
      wizard.form.patchValue(validValues);
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);
      expect(JSON.stringify(api.createDraft.mock.calls[0][0])).not.toContain('confirmAccountNumber');
    });
  });

  describe('submit', () => {
    it('refuses to submit an invalid form', () => {
      create();
      internals().submit();
      expect(api.submit).not.toHaveBeenCalled();
    });

    it('saves the latest draft first (through the same queue) and then submits', async () => {
      api.createDraft.mockReturnValue(created('app-1'));
      api.submit.mockReturnValue(of({ id: 'app-1' } as ApplicationDetail));
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      create();
      wizard.form.patchValue(validValues);

      internals().submit();
      await vi.advanceTimersByTimeAsync(0);

      expect(api.createDraft).toHaveBeenCalledTimes(1);
      expect(api.submit).toHaveBeenCalledWith('app-1');
      expect(api.createDraft.mock.invocationCallOrder[0]).toBeLessThan(api.submit.mock.invocationCallOrder[0]);
      expect(navigate).toHaveBeenCalledWith(['/applications', 'app-1']);
      expect(wizard.hasUnsavedChanges()).toBe(false);
    });

    it('does not submit if the pre-submit save fails, and shows the save error', async () => {
      api.createDraft.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: { message: 'Nope' } })));
      create();
      wizard.form.patchValue(validValues);

      internals().submit();
      await vi.advanceTimersByTimeAsync(0);

      expect(api.submit).not.toHaveBeenCalled();
      expect(wizard.saveState().kind).toBe('error');
      // The user is told why nothing happened, and the submit button is usable again.
      expect(wizard.submitError()).toContain('nothing was submitted');
      expect(wizard.submitting()).toBe(false);
    });
  });
});
