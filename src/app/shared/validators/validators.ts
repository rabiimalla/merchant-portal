import { AbstractControl, FormArray, FormGroup, ValidationErrors, ValidatorFn } from '@angular/forms';
import {
  isValidAccountNumber,
  isValidOptionalUrl,
  isValidPhone,
  isValidRoutingNumber,
  isValidTaxId,
  sumsTo100,
} from './validation-rules';

const fromRule =
  (key: string, rule: (v: string) => boolean): ValidatorFn =>
  (control: AbstractControl): ValidationErrors | null =>
    rule(String(control.value ?? '')) ? null : { [key]: true };

export const taxIdValidator = (): ValidatorFn => fromRule('taxId', isValidTaxId);
export const routingNumberValidator = (): ValidatorFn => fromRule('routingNumber', isValidRoutingNumber);
export const accountNumberValidator = (): ValidatorFn => fromRule('accountNumber', isValidAccountNumber);
export const phoneValidator = (): ValidatorFn => fromRule('phone', isValidPhone);
export const optionalUrlValidator = (): ValidatorFn => fromRule('url', isValidOptionalUrl);

/** Rejects whitespace-only text that `Validators.required` lets through ("   "). */
export const notBlankValidator = (): ValidatorFn => (control) =>
  typeof control.value === 'string' && control.value.length > 0 && control.value.trim() === '' ? { blank: true } : null;

/**
 * Cross-field (group level): both controls must hold the same value. Reports on the group,
 * so the template can show one message under the pair.
 */
export const fieldsMatchValidator =
  (a: string, b: string): ValidatorFn =>
  (group: AbstractControl): ValidationErrors | null => {
    if (!(group instanceof FormGroup)) return null;
    const first = group.get(a)?.value;
    const second = group.get(b)?.value;
    return !second || first === second ? null : { fieldsMismatch: true };
  };

/** Cross-field (array level): the `ownershipPercent` of every owner must add up to 100. */
export const ownershipTotalValidator =
  (): ValidatorFn =>
  (control: AbstractControl): ValidationErrors | null => {
    if (!(control instanceof FormArray)) return null;
    const values = control.controls.map((c) => Number(c.get('ownershipPercent')?.value ?? 0));
    return values.length === 0 || sumsTo100(values) ? null : { ownershipTotal: { actual: values.reduce((a, b) => a + b, 0) } };
  };
