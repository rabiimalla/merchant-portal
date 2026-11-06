import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApplicationsApi } from '../../applications.api';
import { AssignmentPanel } from './assignment-panel';

const reviewers = [
  { id: 'r-1', name: 'Rita Reviewer' },
  { id: 'r-2', name: 'Rob Reviewer' },
];

describe('AssignmentPanel', () => {
  let assign: ReturnType<typeof vi.fn>;

  async function setup(currentReviewerId: string | null = null): Promise<ComponentFixture<AssignmentPanel>> {
    assign = vi.fn().mockReturnValue(of({}));
    TestBed.configureTestingModule({
      providers: [{ provide: ApplicationsApi, useValue: { reviewers: () => of(reviewers), assign } }],
    });
    const fixture = TestBed.createComponent(AssignmentPanel);
    fixture.componentRef.setInput('applicationId', 'app-1');
    fixture.componentRef.setInput('currentReviewerId', currentReviewerId);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const parts = (fixture: ComponentFixture<AssignmentPanel>) => {
    const el = fixture.nativeElement as HTMLElement;
    return {
      select: el.querySelector('select') as HTMLSelectElement,
      button: el.querySelector('button') as HTMLButtonElement,
    };
  };

  const choose = (fixture: ComponentFixture<AssignmentPanel>, id: string) => {
    const { select } = parts(fixture);
    select.value = id;
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };

  beforeEach(() => TestBed.resetTestingModule());

  it('lists the reviewers and keeps Assign disabled until one is chosen', async () => {
    const f = await setup();
    expect(parts(f).select.options.length).toBe(3); // placeholder + 2 reviewers
    expect(parts(f).button.disabled).toBe(true);
  });

  // Regression: reading select.value from the DOM in an OnPush template left the button disabled.
  it('enables the button once a reviewer is picked', async () => {
    const f = await setup();
    choose(f, 'r-2');
    expect(parts(f).button.disabled).toBe(false);
  });

  it('assigns the chosen reviewer and tells the parent to reload', async () => {
    const f = await setup();
    const assigned = vi.fn();
    f.componentInstance.assigned.subscribe(assigned);

    choose(f, 'r-2');
    parts(f).button.click();

    expect(assign).toHaveBeenCalledWith('app-1', 'r-2');
    expect(assigned).toHaveBeenCalledTimes(1);
  });

  it('offers Reassign, disabled until a different reviewer is picked', async () => {
    const f = await setup('r-1');
    expect(parts(f).button.textContent).toContain('Reassign');
    expect(parts(f).button.disabled).toBe(true);
    choose(f, 'r-2');
    expect(parts(f).button.disabled).toBe(false);
  });
});
