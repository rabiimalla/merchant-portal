import { AbstractControl, ValidationErrors } from '@angular/forms';

const MESSAGES: Record<string, (e: unknown, label: string) => string> = {
  required: (_e, label) => `${label} is required.`,
  blank: (_e, label) => `${label} cannot be blank.`,
  email: () => 'Enter a valid e-mail address.',
  maxlength: (e) => `Use at most ${(e as { requiredLength: number }).requiredLength} characters.`,
  minlength: (e) => `Use at least ${(e as { requiredLength: number }).requiredLength} characters.`,
  min: (e) => `Must be at least ${(e as { min: number }).min}.`,
  max: (e) => `Must be at most ${(e as { max: number }).max}.`,
  taxId: () => 'Use the format 12-3456789.',
  routingNumber: () => 'Enter a valid 9-digit routing number.',
  accountNumber: () => 'Account numbers have 6 to 17 digits.',
  phone: () => 'Enter a valid phone number (at least 7 digits).',
  url: () => 'Enter a full web address starting with https://',
};

/** First error of a control as human text, or null. Pure so it can be tested without a DOM. */
export function firstErrorMessage(errors: ValidationErrors | null, label: string): string | null {
  if (!errors) return null;
  const key = Object.keys(errors)[0];
  const fn = MESSAGES[key];
  return fn ? fn(errors[key], label) : `${label} is invalid.`;
}

export const controlError = (control: AbstractControl | null | undefined, label: string): string | null =>
  control && control.invalid && (control.touched || control.dirty) ? firstErrorMessage(control.errors, label) : null;
