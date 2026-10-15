import type { Context, MiddlewareHandler } from 'hono';
import { z } from 'zod';
import { unauthorized } from '../shared/errors.js';
import type { Principal } from './principal.js';
import type { TokenService } from './tokens.js';

export type AppEnv = { Variables: { principal: Principal | null } };

function credential(header: string): string {
  const parsed = z.string().regex(/^(Bearer|Basic) [^\s]+$/i).safeParse(header);
  if (!parsed.success) throw unauthorized();
  const separator = header.indexOf(' ');
  const value = header.slice(separator + 1);
  if (header.slice(0, separator).toLowerCase() === 'bearer') return value;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw unauthorized();
  }
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) throw unauthorized();
  return decoded.slice(colon + 1);
}

export function authMiddleware(tokens: TokenService): MiddlewareHandler<AppEnv> {
  return async (c, next): Promise<void> => {
    const header = c.req.header('Authorization');
    const principal = header === undefined ? null : tokens.authenticate(credential(header));
    if (header !== undefined && principal === null) throw unauthorized();
    c.set('principal', principal);
    await next();
  };
}

export function requirePrincipal(c: Context<AppEnv>): Principal {
  const principal = c.get('principal');
  if (!principal) throw unauthorized();
  return principal;
}
