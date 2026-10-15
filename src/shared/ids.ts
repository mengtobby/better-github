import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'; // Crockford base32, lowercase

/** Random, URL-safe identifier: `<prefix>_<20 base32 chars>` (100 bits of entropy). */
export function newId(prefix: string): string {
  if (!/^[a-z]{1,8}$/.test(prefix)) {
    throw new Error(`invalid id prefix "${prefix}"`);
  }
  const bytes = randomBytes(20);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte & 31];
  return `${prefix}_${out}`;
}
