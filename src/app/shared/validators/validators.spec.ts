import { FormArray, FormControl, FormGroup } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { firstErrorMessage } from '../form-errors';
import { isValidAccountNumber, isValidOptionalUrl, isValidPhone, isValidRoutingNumber, isValidTaxId } from './validation-rules';
import { fieldsMatchValidator, notBlankValidator, ownershipTotalValidator, taxIdValidator } from './validators';

describe('validation rules', () => {
  it('tax id: accepts 12-3456789 only', () => {
    expect(isValidTaxId('12-3456789')).toBe(true);
    expect(isValidTaxId('123456789')).toBe(false);
    expect(isValidTaxId('12-345678')).toBe(false);
    expect(isValidTaxId('')).toBe(true); // emptiness is Validators.required's job
  });

  it('routing number: enforces the ABA checksum', () => {
    expect(isValidRoutingNumber('000012344')).toBe(true); // synthetic, passes the checksum
    expect(isValidRoutingNumber('000012345')).toBe(false); // one digit off
    expect(isValidRoutingNumber('12345')).toBe(false);
    expect(isValidRoutingNumber('00001234a')).toBe(false);
  });

  it('account number: 6 to 17 digits', () => {
    expect(isValidAccountNumber('123456')).toBe(true);
    expect(isValidAccountNumber('12345')).toBe(false);
    expect(isValidAccountNumber('1'.repeat(18))).toBe(false);
    expect(isValidAccountNumber('12345a')).toBe(false);
  });

  it('phone: allowed characters and at least 7 digits', () => {
    expect(isValidPhone('+1 (555) 010-0199')).toBe(true);
    expect(isValidPhone('12345')).toBe(false);
    expect(isValidPhone('555-CALL-NOW')).toBe(false);
  });

  it('url: only http(s)', () => {
    expect(isValidOptionalUrl('https://example.com')).toBe(true);
    expect(isValidOptionalUrl('javascript:alert(1)')).toBe(false);
    expect(isValidOptionalUrl('not a url')).toBe(false);
  });
});

describe('angular validators', () => {
  it('taxIdValidator reports a keyed error', () => {
    expect(taxIdValidator()(new FormControl('nope'))).toEqual({ taxId: true });
    expect(taxIdValidator()(new FormControl('12-3456789'))).toBeNull();
  });

  it('notBlankValidator rejects whitespace-only input', () => {
    expect(notBlankValidator()(new FormControl('   '))).toEqual({ blank: true });
    expect(notBlankValidator()(new FormControl(' a '))).toBeNull();
    expect(notBlankValidator()(new FormControl(''))).toBeNull(); // left to required
  });

  describe('fieldsMatchValidator (cross-field)', () => {
    const group = (a: string, b: string) => new FormGroup({ a: new FormControl(a), b: new FormControl(b) });

    it('flags different values', () => {
      expect(fieldsMatchValidator('a', 'b')(group('123456', '654321'))).toEqual({ fieldsMismatch: true });
    });
    it('accepts equal values and an untouched confirm field', () => {
      expect(fieldsMatchValidator('a', 'b')(group('123456', '123456'))).toBeNull();
      expect(fieldsMatchValidator('a', 'b')(group('123456', ''))).toBeNull();
    });
  });

  describe('ownershipTotalValidator (array level)', () => {
    const owners = (...percents: string[]) =>
      new FormArray(percents.map((p) => new FormGroup({ ownershipPercent: new FormControl(p) })));

    it('accepts owners adding up to 100', () => {
      expect(ownershipTotalValidator()(owners('60', '40'))).toBeNull();
      expect(ownershipTotalValidator()(owners('33.3', '33.3', '33.4'))).toBeNull();
    });
    it('reports the actual total otherwise', () => {
      expect(ownershipTotalValidator()(owners('60', '30'))).toEqual({ ownershipTotal: { actual: 90 } });
    });
    it('re-validates when a child changes', () => {
      const array = owners('50', '50');
      array.addValidators(ownershipTotalValidator());
      array.updateValueAndValidity();
      expect(array.valid).toBe(true);
      array.at(0).get('ownershipPercent')?.setValue('10');
      expect(array.valid).toBe(false);
    });
  });
});

describe('firstErrorMessage', () => {
  it('maps known errors to readable text', () => {
    expect(firstErrorMessage({ required: true }, 'Legal name')).toBe('Legal name is required.');
    expect(firstErrorMessage({ taxId: true }, 'Tax ID')).toBe('Use the format 12-3456789.');
  });
  it('falls back gracefully for unknown errors and returns null when valid', () => {
    expect(firstErrorMessage({ weird: true }, 'Field')).toBe('Field is invalid.');
    expect(firstErrorMessage(null, 'Field')).toBeNull();
  });
});
