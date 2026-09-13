import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Whether a presented secret is the expected one. Both sides are hashed to the same length before
 * the constant-time comparison, so neither the answer nor its timing says how long the real one is.
 */
export function sameSecret(given: string | undefined, expected: string | undefined): boolean {
  if (!expected || !given) return false;
  const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}
