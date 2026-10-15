import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Store } from '../db/store.js';
import { ALL_SCOPES } from '../db/types.js';
import type { PrincipalType, Scope, Token } from '../db/types.js';
import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import { forbidden, notFound, validationError } from '../shared/errors.js';
import { parseInput } from '../shared/http.js';
import type { Principal } from './principal.js';

export const TOKEN_TTL = Object.freeze({
  userDefaultMs: 30 * 86400000, userMaxMs: 90 * 86400000,
  agentDefaultMs: 3600000, agentMaxMs: 86400000,
});
export interface IssueOptions {
  readonly scopes: readonly Scope[];
  readonly ttlMs?: number;
  readonly label?: string;
  readonly repoIds?: readonly string[] | null;
}
export interface IssuedToken { readonly token: string; readonly record: Token }
export interface TokenService {
  issueUserToken(userId: string, opts: IssueOptions, issuedBy: Principal | null): IssuedToken;
  issueAgentToken(sponsorUserId: string, agentId: string, opts: IssueOptions, issuedBy: Principal): IssuedToken;
  authenticate(raw: string): Principal | null;
  revoke(tokenId: string, by: Principal): void;
}
const optionsSchema = z.object({
  scopes: z.array(z.enum(ALL_SCOPES)), ttlMs: z.number().int().positive().optional(),
  label: z.string().optional(), repoIds: z.array(z.string().min(1)).nullable().optional(),
});
const idSchema = z.string().min(1);
const digest = (raw: string): string => createHash('sha256').update(raw).digest('hex');

export function createTokenService(store: Store, clock: Clock = systemClock): TokenService {
  function issue(type: PrincipalType, id: string, input: IssueOptions, issuedBy: Principal | null): IssuedToken {
    const opts = parseInput(optionsSchema, input);
    const ttlMs = opts.ttlMs ?? (type === 'user' ? TOKEN_TTL.userDefaultMs : TOKEN_TTL.agentDefaultMs);
    const max = type === 'user' ? TOKEN_TTL.userMaxMs : TOKEN_TTL.agentMaxMs;
    if (ttlMs > max) throw validationError('Token lifetime exceeds maximum');
    if (type === 'agent' && opts.scopes.some((scope) => scope === 'agents:manage' || scope === 'tokens:manage')) {
      throw validationError('Agent tokens cannot manage identities or tokens');
    }
    const token = `bgh_${type === 'user' ? 'u' : 'a'}_${randomBytes(32).toString('base64url')}`;
    const record = store.tokens.create({ ...opts, tokenHash: digest(token), principalType: type,
      principalId: id, expiresAt: new Date(Math.min(clock().getTime() + ttlMs,
        issuedBy === null ? Infinity : Date.parse(issuedBy.expiresAt))).toISOString() });
    return Object.freeze({ token, record });
  }
  function assertIssuer(userId: string, input: IssueOptions, by: Principal, scope: Scope): void {
    const opts = parseInput(optionsSchema, input);
    if (by.type !== 'user' || by.id !== userId || !by.scopes.includes(scope)
      || opts.scopes.some((requested) => !by.scopes.includes(requested))) throw forbidden();
    const allowedRepos = by.repoIds;
    if (allowedRepos !== null && ((opts.repoIds === null || opts.repoIds === undefined)
      || opts.repoIds.some((id) => !allowedRepos.includes(id)))) throw forbidden();
    if (!Number.isFinite(Date.parse(by.expiresAt)) || Date.parse(by.expiresAt) <= clock().getTime()) throw forbidden();
  }
  return Object.freeze({
    issueUserToken(userId: string, opts: IssueOptions, issuedBy: Principal | null): IssuedToken {
      parseInput(idSchema, userId);
      if (issuedBy !== null) assertIssuer(userId, opts, issuedBy, 'tokens:manage');
      if (!store.users.findById(userId)) throw notFound('User');
      return issue('user', userId, opts, issuedBy);
    },
    issueAgentToken(sponsorUserId: string, agentId: string, opts: IssueOptions, issuedBy: Principal): IssuedToken {
      parseInput(idSchema, sponsorUserId);
      parseInput(idSchema, agentId);
      assertIssuer(sponsorUserId, opts, issuedBy, 'agents:manage');
      const agent = store.agents.findById(agentId);
      if (!agent || agent.revokedAt !== null || agent.sponsorUserId !== sponsorUserId
        || !store.users.findById(sponsorUserId)) throw forbidden();
      return issue('agent', agentId, opts, issuedBy);
    },
    authenticate(raw: string): Principal | null {
      if (!/^bgh_[ua]_[A-Za-z0-9_-]{43}$/.test(raw)) return null;
      const token = store.tokens.findByHash(digest(raw));
      if (!token || token.revokedAt !== null || Date.parse(token.expiresAt) <= clock().getTime()
        || !Number.isFinite(Date.parse(token.expiresAt))) return null;
      if (!raw.startsWith(token.principalType === 'user' ? 'bgh_u_' : 'bgh_a_')) return null;
      const agent = token.principalType === 'agent' ? store.agents.findById(token.principalId) : null;
      if (token.principalType === 'agent' && (!agent || agent.revokedAt !== null)) return null;
      const user = store.users.findById(agent ? agent.sponsorUserId : token.principalId);
      if (!user) return null;
      store.tokens.touch(token.id);
      return Object.freeze({ type: token.principalType, id: token.principalId,
        handle: agent ? agent.handle : user.handle, userId: user.id, tokenId: token.id, expiresAt: token.expiresAt,
        scopes: Object.freeze([...token.scopes]),
        repoIds: token.repoIds === null ? null : Object.freeze([...token.repoIds]) });
    },
    revoke(tokenId: string, by: Principal): void {
      parseInput(idSchema, tokenId);
      const token = store.tokens.findById(tokenId);
      if (!token) throw notFound('Token');
      const ownerId = token.principalType === 'user' ? token.principalId
        : store.agents.findById(token.principalId)?.sponsorUserId;
      if (by.tokenId !== tokenId
        && (by.type !== 'user' || by.id !== ownerId || !by.scopes.includes('tokens:manage'))) throw forbidden();
      store.tokens.revoke(tokenId);
    },
  });
}
