import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ControlValueAccessor, NgControl, Validators } from '@angular/forms';
import { controlError } from '../form-errors';

let nextId = 0;

/**
 * Accessible text input wired to Reactive Forms (ControlValueAccessor):
 * label <-> input association, aria-invalid, aria-describedby pointing at hint/error, error text
 * announced via role="alert", and a Show/Hide toggle for sensitive values (type=password +
 * autocomplete="new-password" so browsers/password managers do not store or autofill them).
 *
 * Deliberately opts OUT of OnPush (`Eager` = the classic check-always strategy): it renders
 * mutable control state (touched/invalid) that lives outside signals, so when a parent calls
 * markAllAsTouched() the field must be re-checked to show its error. Since Angular 22 OnPush is
 * the default for components that set nothing, so this must be explicit or the errors would
 * silently stop appearing. (Alternative: mirror the control's status into a signal.)
 */
@Component({
  selector: 'app-text-field',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './text-field.scss',
  templateUrl: './text-field.html',
})
export class TextField implements ControlValueAccessor {
  readonly label = input.required<string>();
  readonly type = input<'text' | 'email' | 'tel' | 'number' | 'url'>('text');
  readonly hint = input<string>();
  readonly autocomplete = input<string>('off');
  readonly inputmode = input<string>();
  readonly maxlength = input<number>();
  /** Masked by default with a Show/Hide toggle (tax id, national id, account numbers). */
  readonly sensitive = input(false);

  protected readonly uid = `field-${nextId++}`;
  protected readonly value = signal('');
  protected readonly disabled = signal(false);
  protected readonly visible = signal(false);
  protected readonly inputType = computed(() => (this.sensitive() && !this.visible() ? 'password' : this.type()));

  readonly #ngControl = inject(NgControl, { self: true, optional: true });

  constructor() {
    // Register as the accessor ourselves (instead of providing NG_VALUE_ACCESSOR) so we can
    // read the NgControl's validation state without a circular dependency.
    if (this.#ngControl) this.#ngControl.valueAccessor = this;
  }

  protected isRequired(): boolean {
    return this.#ngControl?.control?.hasValidator(Validators.required) ?? false;
  }

  protected error(): string | null {
    return controlError(this.#ngControl?.control, this.label());
  }

  protected describedBy(): string | null {
    const ids = [this.hint() ? `${this.uid}-hint` : null, this.error() ? `${this.uid}-err` : null].filter(Boolean);
    return ids.length ? ids.join(' ') : null;
  }

  // ---- ControlValueAccessor ----
  protected onChange: (v: string) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  writeValue(v: string | number | null): void {
    this.value.set(v === null || v === undefined ? '' : String(v));
  }
  registerOnChange(fn: (v: string) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  protected onInput(event: Event): void {
    const v = (event.target as HTMLInputElement).value;
    this.value.set(v);
    this.onChange(v);
  }
}