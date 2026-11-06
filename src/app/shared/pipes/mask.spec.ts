import { describe, expect, it } from 'vitest';
import { maskValue } from './mask-value';
import { Mask } from './mask';

describe('maskValue', () => {
  it('keeps only the last four characters', () => {
    expect(maskValue('000-00-1234')).toBe('••••1234');
    expect(maskValue('000123456789')).toBe('••••6789');
  });

  it('does not leak the length of the value', () => {
    expect(maskValue('1234567890').length).toBe(maskValue('12345678901234567890').length);
  });

  it('fully hides values that are too short to show a tail safely', () => {
    expect(maskValue('1234')).toBe('••••');
    expect(maskValue('12')).toBe('••••');
  });

  it('returns an empty string for empty input', () => {
    expect(maskValue('')).toBe('');
    expect(maskValue(null)).toBe('');
    expect(maskValue(undefined)).toBe('');
  });

  it('pipe delegates to maskValue', () => {
    expect(new Mask().transform('000-00-1234')).toBe('••••1234');
  });
});
