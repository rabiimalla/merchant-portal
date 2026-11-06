/**
 * Display masking. This is a presentation safeguard (shoulder-surfing, screenshots, screen
 * sharing). It is NOT the security boundary: the API already sends masked values for anyone who
 * has not been through the audited reveal call.
 *
 * The mask has a fixed width so the output does not leak how long the real value is.
 */
export function maskValue(value: string | null | undefined, visibleTail = 4): string {
  const s = (value ?? '').toString();
  if (s.length === 0) return '';
  if (s.length <= visibleTail) return '••••';
  return `••••${s.slice(-visibleTail)}`;
}
