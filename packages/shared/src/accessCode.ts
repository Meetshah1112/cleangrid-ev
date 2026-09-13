import { createHmac } from 'node:crypto';

/**
 * Per-account access codes for the public demo.
 *
 * Each seeded account's code is derived from one server secret, so there is nothing to store and
 * nothing to hand out but the codes themselves: the code alone says who is signing in. Changing the
 * secret changes every code at once. Server-side only; the browser and the phone never see the secret.
 */

/** Crockford's base32: no I, L, O or U, so a code read aloud or off a slide is not misread. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_CHARS = 12;

export function accessCodeFor(secret: string, accountId: string): string {
  const digest = createHmac('sha256', secret).update(`cleangrid-access:${accountId}`).digest();
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < CODE_CHARS) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length === CODE_CHARS) break;
  }
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}

/** The comparable form of a typed code: case, spaces and dashes dropped, look-alike letters read as digits. */
export function normaliseAccessCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}
