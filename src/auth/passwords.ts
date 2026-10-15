import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

function derive(plain: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(plain, salt, 32, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(plain, salt);
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts.slice(0, 4).join('$') !== 'scrypt$16384$8$1') return false;
    const salt = Buffer.from(parts[4]!, 'base64');
    const key = Buffer.from(parts[5]!, 'base64');
    if (salt.length !== 16 || key.length !== 32 || salt.toString('base64') !== parts[4]
      || key.toString('base64') !== parts[5]) return false;
    return timingSafeEqual(await derive(plain, salt), key);
  } catch {
    return false;
  }
}
