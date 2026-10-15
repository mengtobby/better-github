import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../../auth/middleware.js';
import { requirePrincipal } from '../../auth/middleware.js';
import type { Store } from '../../db/store.js';
import { ALL_SCOPES } from '../../db/types.js';
import type { TokenService } from '../../auth/tokens.js';
import { assertValidName } from '../../git/names.js';
import { forbidden, notFound } from '../../shared/errors.js';
import { ok } from '../../shared/envelope.js';
import { parseJsonBody } from '../../shared/http.js';

export function createAgentRoutes(deps: { readonly store: Store; readonly tokens: TokenService }): Hono<AppEnv> {
  const app = new Hono<AppEnv>(), { store, tokens } = deps;
  app.use('/agents', async (c, next) => {
    const p = requirePrincipal(c);
    if (p.type !== 'user' || !p.scopes.includes('agents:manage')) throw forbidden();
    await next();
  });
  app.use('/agents/*', async (c, next) => {
    const p = requirePrincipal(c);
    if (p.type !== 'user' || !p.scopes.includes('agents:manage')) throw forbidden();
    await next();
  });
  app.post('/agents', async c => {
    const p = requirePrincipal(c), input = await parseJsonBody(c, z.object({ handle: z.string(), displayName: z.string().min(1).max(200), model: z.string().max(200).optional() }));
    assertValidName(input.handle, 'owner');
    const agent = store.transaction(() => {
      const agent = store.agents.create({ ...input, sponsorUserId: p.userId });
      store.audit.append({ actorType: p.type, actorId: p.id, action: 'agent.create', target: agent.id }); return agent;
    });
    return c.json(ok(agent), 201);
  });
  app.get('/agents', c => c.json(ok(store.agents.listBySponsor(requirePrincipal(c).userId))));
  app.delete('/agents/:handle', c => {
    const p = requirePrincipal(c), handle = c.req.param('handle'); assertValidName(handle, 'owner');
    const agent = store.agents.findByHandle(handle);
    if (!agent || agent.sponsorUserId !== p.userId || agent.revokedAt) throw notFound('Agent');
    store.transaction(() => {
      store.agents.revoke(agent.id); store.tokens.revokeAllForPrincipal('agent', agent.id);
      store.audit.append({ actorType: p.type, actorId: p.id, action: 'agent.revoke', target: agent.id });
    });
    return c.json(ok({ revoked: true }));
  });
  app.post('/agents/:handle/tokens', async c => {
    const p = requirePrincipal(c), handle = c.req.param('handle'); assertValidName(handle, 'owner');
    const agent = store.agents.findByHandle(handle);
    if (!agent || agent.sponsorUserId !== p.userId || agent.revokedAt) throw notFound('Agent');
    const input = await parseJsonBody(c, z.object({ scopes: z.array(z.enum(ALL_SCOPES)), ttlSeconds: z.number().int().positive().max(86400).optional(), repoIds: z.array(z.string().min(1)).optional(), label: z.string().max(200).optional() }));
    if (input.repoIds?.some(id => store.repositories.findById(id)?.ownerId !== p.userId)) throw forbidden();
    const issued = store.transaction(() => {
      const issued = tokens.issueAgentToken(p.userId, agent.id, { ...input, ttlMs: input.ttlSeconds === undefined ? undefined : input.ttlSeconds * 1000 }, p);
      store.audit.append({ actorType: p.type, actorId: p.id, action: 'token.create', target: issued.record.id }); return issued;
    });
    return c.json(ok({ token: issued.token, id: issued.record.id, scopes: issued.record.scopes, expiresAt: issued.record.expiresAt }), 201);
  });
  return app;
}
