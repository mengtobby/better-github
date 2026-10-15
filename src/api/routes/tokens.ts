import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../auth/middleware.js';
import { requirePrincipal } from '../../auth/middleware.js';
import { verifyPassword } from '../../auth/passwords.js';
import type { TokenService } from '../../auth/tokens.js';
import type { Store } from '../../db/store.js';
import { ALL_SCOPES } from '../../db/types.js';
import { forbidden, unauthorized } from '../../shared/errors.js';
import { ok } from '../../shared/envelope.js';
import { parseInput, parseJsonBody } from '../../shared/http.js';

const dummyHash = `scrypt$16384$8$1$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(32).toString('base64')}`;
export function createTokenRoutes(deps: { readonly store: Store; readonly tokens: TokenService }): Hono<AppEnv> {
  const app = new Hono<AppEnv>(), { store, tokens } = deps;
  app.post('/tokens', async c => {
    const input = await parseJsonBody(c, z.object({ handle: z.string().optional(), password: z.string().max(200).optional(),
      scopes: z.array(z.enum(ALL_SCOPES)).optional(), ttlSeconds: z.number().int().positive().max(90 * 86400).optional(), label: z.string().max(200).optional() }));
    const p = c.get('principal');
    let userId: string;
    if (p) {
      if (p.type !== 'user' || !p.scopes.includes('tokens:manage')) throw forbidden();
      userId = p.userId;
    } else {
      const credentials = parseInput(z.object({ handle: z.string().min(1), password: z.string().min(1) }), input);
      const user = store.users.findByHandle(credentials.handle);
      const valid = await verifyPassword(credentials.password, user?.passwordHash ?? dummyHash);
      if (!valid || !user) throw unauthorized('Invalid credentials');
      userId = user.id;
    }
    const issued = store.transaction(() => {
      const issued = tokens.issueUserToken(userId, { scopes: input.scopes ?? ALL_SCOPES, ttlMs: input.ttlSeconds === undefined ? undefined : input.ttlSeconds * 1000, label: input.label });
      store.audit.append({ actorType: 'user', actorId: userId, action: 'token.create', target: issued.record.id });
      return issued;
    });
    return c.json(ok({ token: issued.token, id: issued.record.id, scopes: issued.record.scopes, expiresAt: issued.record.expiresAt }), 201);
  });
  app.delete('/tokens/:id', c => {
    const p = requirePrincipal(c); if (p.type !== 'user' || !p.scopes.includes('tokens:manage')) throw forbidden();
    const id = parseInput(z.string().min(1).max(200), c.req.param('id'));
    store.transaction(() => { tokens.revoke(id, p); store.audit.append({ actorType: p.type, actorId: p.id, action: 'token.revoke', target: id }); });
    return c.json(ok({ revoked: true }));
  });
  return app;
}
