import { describe, expect, it } from 'vitest';
import { accessCodeFor, normaliseAccessCode } from './accessCode';

const SECRET = 'a-secret-long-enough-for-the-demo';

describe('access codes', () => {
  it('gives every account its own code, the same every time', () => {
    const harsh = accessCodeFor(SECRET, 'drv-harsh');
    expect(accessCodeFor(SECRET, 'drv-harsh')).toBe(harsh);
    expect(accessCodeFor(SECRET, 'ops-network')).not.toBe(harsh);
  });

  it('changes every code when the secret changes', () => {
    expect(accessCodeFor('another-secret-entirely-000', 'drv-harsh')).not.toBe(accessCodeFor(SECRET, 'drv-harsh'));
  });

  it('reads as three groups of four, without letters that look like digits', () => {
    const code = accessCodeFor(SECRET, 'drv-harsh');
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('accepts a code however it was typed', () => {
    const code = accessCodeFor(SECRET, 'drv-harsh');
    const typed = ` ${code.toLowerCase().replace(/-/g, ' ')} `;
    expect(normaliseAccessCode(typed)).toBe(normaliseAccessCode(code));
    // O for zero and I or L for one are the usual misreadings.
    expect(normaliseAccessCode('OIL0-1')).toBe('01101');
  });
});
