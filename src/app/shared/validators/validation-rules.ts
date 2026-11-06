/**
 * Pure validation rules (no Angular imports) so they are trivially unit-testable and could be
 * shared with a backend. `validators.ts` wraps them as Angular ValidatorFns.
 * Every function treats an empty value as "valid": emptiness is `Validators.required`'s job.
 */

export const isEmpty = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === '';

/** US EIN style: 12-3456789 */
export const isValidTaxId = (v: string): boolean => isEmpty(v) || /^\d{2}-\d{7}$/.test(v.trim());

/** ABA routing number: 9 digits and the 3-7-1 weighted checksum must be a multiple of 10. */
export function isValidRoutingNumber(v: string): boolean {
  if (isEmpty(v)) return true;
  if (!/^\d{9}$/.test(v.trim())) return false;
  const d = v.trim().split('').map(Number);
  const sum = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

export const isValidAccountNumber = (v: string): boolean => isEmpty(v) || /^\d{6,17}$/.test(v.trim());

/** Loose international phone check: allowed characters only, and at least 7 digits. */
export function isValidPhone(v: string): boolean {
  if (isEmpty(v)) return true;
  if (!/^\+?[\d\s().-]+$/.test(v.trim())) return false;
  return (v.match(/\d/g) ?? []).length >= 7;
}

export const isValidOptionalUrl = (v: string): boolean => {
  if (isEmpty(v)) return true;
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

/** Floating point safe "adds up to 100". */
export const sumsTo100 = (values: number[]): boolean => Math.abs(values.reduce((a, b) => a + b, 0) - 100) < 0.001;
