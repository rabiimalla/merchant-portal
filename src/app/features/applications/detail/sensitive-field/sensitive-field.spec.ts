import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationsApi } from '../../applications.api';
import { REVEAL_VISIBLE_MS, SensitiveField } from './sensitive-field';

const RAW = '12-3456789'; // synthetic
const MASKED = '••••6789';

describe('SensitiveField', () => {
  const api = { reveal: vi.fn() };
  let fixture: ComponentFixture<SensitiveField>;

  const mount = (inputs: Record<string, unknown>) => {
    fixture = TestBed.createComponent(SensitiveField);
    const base = { applicationId: 'app-1', field: 'taxId', label: 'Tax ID', value: MASKED, serverMasked: true, canReveal: true };
    for (const [k, v] of Object.entries({ ...base, ...inputs })) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const button = (el: HTMLElement) => el.querySelector('button') as HTMLButtonElement | null;

  beforeEach(() => {
    vi.useFakeTimers();
    api.reveal.mockReset();
    TestBed.configureTestingModule({ providers: [{ provide: ApplicationsApi, useValue: api }] });
  });
  afterEach(() => vi.useRealTimers());

  it('is masked by default and the raw value is nowhere in the DOM', () => {
    const el = mount({});
    expect(el.textContent).toContain(MASKED);
    expect(el.textContent).not.toContain(RAW);
    expect(api.reveal).not.toHaveBeenCalled();
  });

  it('reveals through the API and hides again automatically', async () => {
    api.reveal.mockReturnValue(of({ value: RAW }));
    const el = mount({});

    button(el)?.click();
    fixture.detectChanges();
    expect(api.reveal).toHaveBeenCalledWith('app-1', 'taxId', 0);
    expect(el.textContent).toContain(RAW);

    await vi.advanceTimersByTimeAsync(REVEAL_VISIBLE_MS);
    fixture.detectChanges();
    expect(el.textContent).not.toContain(RAW);
    expect(el.textContent).toContain(MASKED);
  });

  it('can be hidden manually', () => {
    api.reveal.mockReturnValue(of({ value: RAW }));
    const el = mount({});
    button(el)?.click();
    fixture.detectChanges();
    button(el)?.click(); // now the Hide button
    fixture.detectChanges();
    expect(el.textContent).not.toContain(RAW);
  });

  it('offers no Reveal control to users who are not entitled to it', () => {
    const el = mount({ canReveal: false });
    expect(button(el)).toBeNull();
  });

  it('stays masked and explains when the API refuses (e.g. 403)', () => {
    api.reveal.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403 })));
    const el = mount({});
    button(el)?.click();
    fixture.detectChanges();
    expect(el.textContent).not.toContain(RAW);
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('permission');
  });

  it('forgets a revealed value when fresh data arrives', () => {
    api.reveal.mockReturnValue(of({ value: RAW }));
    const el = mount({});
    button(el)?.click();
    fixture.detectChanges();
    expect(el.textContent).toContain(RAW);

    fixture.componentRef.setInput('value', '••••0000');
    fixture.detectChanges();
    expect(el.textContent).not.toContain(RAW);
    expect(el.textContent).toContain('••••0000');
  });

  it('owner viewing their own draft: value is masked locally, Show/Hide makes no API call', () => {
    const el = mount({ value: RAW, serverMasked: false, canReveal: false });
    expect(el.textContent).toContain(MASKED);
    expect(el.textContent).not.toContain(RAW);

    button(el)?.click();
    fixture.detectChanges();
    expect(el.textContent).toContain(RAW);
    expect(api.reveal).not.toHaveBeenCalled();
  });
});
