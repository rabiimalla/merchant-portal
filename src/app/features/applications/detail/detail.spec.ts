import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStore } from '../../../core/auth/auth.store';
import { ApplicationDetail, Permissions, Role } from '../../../core/models';
import { routerTestProviders } from '../../../../testing/providers';
import { ApplicationsApi } from '../applications.api';
import { Detail } from './detail';

const NO_PERMISSIONS: Permissions = { canEdit: false, canReveal: false, canDecide: false, canAssign: false };

const application = (permissions: Partial<Permissions> = {}): ApplicationDetail => ({
  id: 'app-1',
  status: 'IN_REVIEW',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  createdByName: 'Sam Sales',
  assignedReviewer: { id: 'r-1', name: 'Riley Reviewer' },
  sensitiveMasked: true,
  data: {
    business: {
      legalName: 'Example Trading Co',
      dba: '',
      taxId: '••••6789',
      industry: 'Retail',
      website: '',
      phone: '+1 555 0100',
      email: 'ops@example.com',
      line1: '1 Test Street',
      city: 'Testville',
      postalCode: '00000',
    },
    owners: [{ fullName: 'Olive Owner', title: 'CEO', ownershipPercent: 100, nationalId: '••••1234', email: 'olive@example.com' }],
    banking: { bankName: 'Example Bank', routingNumber: '000012344', accountNumber: '••••6789' },
  },
  riskHistory: [{ id: 'e-1', at: '2026-01-02T00:00:00Z', byName: 'Sam Sales', type: 'SUBMISSION' }],
  permissions: { ...NO_PERMISSIONS, ...permissions },
});

describe('Detail', () => {
  let get: ReturnType<typeof vi.fn>;

  function setup(role: Role): ComponentFixture<Detail> {
    TestBed.configureTestingModule({
      providers: [routerTestProviders(), { provide: ApplicationsApi, useValue: { get, reviewers: () => of([]) } }],
    });
    TestBed.inject(AuthStore).setSession({ id: 'u-1', name: 'Test', email: 't@example.com', role }, 'token');
    const fixture = TestBed.createComponent(Detail);
    fixture.componentRef.setInput('id', 'app-1');
    return fixture;
  }

  // Zoneless + resource: alternate detectChanges() and whenStable() until the view settles.
  async function render(fixture: ComponentFixture<Detail>): Promise<HTMLElement> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    get = vi.fn();
  });

  it('loads the application for the route id and shows its sections', async () => {
    get.mockReturnValue(of(application()));
    const el = await render(setup('SALES'));

    expect(get).toHaveBeenCalledWith('app-1');
    expect(el.querySelector('h1')?.textContent).toContain('Example Trading Co');
    expect(el.textContent).toContain('Submitted'); // risk history entry
  });

  it('hides the review and assignment controls from SALES', async () => {
    get.mockReturnValue(of(application({ canEdit: false })));
    const el = await render(setup('SALES'));

    expect(el.querySelector('app-review-panel')).toBeNull();
    expect(el.querySelector('app-assignment-panel')).toBeNull();
  });

  it('shows the decision form, but not assignment, when the server grants canDecide (REVIEWER)', async () => {
    get.mockReturnValue(of(application({ canDecide: true, canReveal: true })));
    const el = await render(setup('REVIEWER'));

    expect(el.querySelector('app-review-panel')).not.toBeNull();
    expect(el.querySelector('app-assignment-panel')).toBeNull();
  });

  it('shows assignment, but not the decision form, when the server grants canAssign (ADMIN)', async () => {
    get.mockReturnValue(of(application({ canAssign: true, canReveal: true })));
    const el = await render(setup('ADMIN'));

    expect(el.querySelector('app-assignment-panel')).not.toBeNull();
    expect(el.querySelector('app-review-panel')).toBeNull();
  });

  // The UI follows server-provided permissions; it does not re-derive them from the role.
  it('trusts the permissions from the server, not the role label', async () => {
    get.mockReturnValue(of(application({ canDecide: false })));
    const el = await render(setup('REVIEWER'));

    expect(el.querySelector('app-review-panel')).toBeNull();
  });

  it('offers Edit only when the server says the draft is editable', async () => {
    get.mockReturnValue(of(application({ canEdit: true })));
    const el = await render(setup('SALES'));

    expect(el.textContent).toContain('Edit draft');
  });

  it('shows an error with Retry, then recovers', async () => {
    get.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 }))).mockReturnValueOnce(of(application()));
    const fixture = setup('SALES');
    const el = await render(fixture);

    expect(el.querySelector('[role="alert"]')?.textContent).toContain('server had a problem');
    (Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Retry')) as HTMLButtonElement).click();
    await render(fixture);

    expect(get).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('Example Trading Co');
  });
});
