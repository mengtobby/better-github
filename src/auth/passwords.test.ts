import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

describe('passwords', () => {
  it('uses random salts and verifies passwords, including Unicode and empty passwords', async () => {
    for (const plain of ['', 'secret 🔑']) {
      const first = await hashPassword(plain);
      expect(first).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
      expect(await hashPassword(plain)).not.toBe(first);
      expect(await verifyPassword(plain, first)).toBe(true);
      expect(await verifyPassword(`${plain}wrong`, first)).toBe(false);
    }
  });
  it('rejects malformed encodings and parameters without throwing', async () => {
    const valid = await hashPassword('secret');
    for (const stored of ['', 'scrypt', valid + '$extra', valid.replace('16384', '32768'),
      valid.replace('$8$', '$0$'), valid.replace('scrypt', 'argon2'),
      'scrypt$16384$8$1$AA==$AA==', valid.replace('==', '!!')]) {
      expect(await verifyPassword('secret', stored)).toBe(false);
    }
  });
});
