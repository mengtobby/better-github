import type { Clock } from '../shared/clock.js';
import { systemClock } from '../shared/clock.js';
import type { Db } from './database.js';
import type { User, Agent, Repository, Token, AuditEvent, NewUser, NewAgent, NewRepository, RepositoryPatch, NewToken, NewAuditEvent, Page, PageQuery, PrincipalType } from './types.js';
import { createUserRepo } from './users.repo.js';
import { createAgentRepo } from './agents.repo.js';
import { createRepositoryRepo } from './repositories.repo.js';
import { createTokenRepo } from './tokens.repo.js';
import { createAuditRepo } from './audit.repo.js';

export interface UserRepo { create(input: NewUser): User; findById(id: string): User | null; findByHandle(handle: string): User | null; findByEmail(email: string): User | null }
export interface AgentRepo { create(input: NewAgent): Agent; findById(id: string): Agent | null; findByHandle(handle: string): Agent | null; listBySponsor(userId: string): readonly Agent[]; revoke(id: string): Agent | null }
export interface RepositoryRepo { create(input: NewRepository): Repository; findById(id: string): Repository | null; findByOwnerAndName(ownerId: string, name: string): Repository | null; listByOwner(ownerId: string, q: PageQuery & { includePrivate: boolean }): Page<Repository>; update(id: string, patch: RepositoryPatch): Repository | null; delete(id: string): boolean }
export interface TokenRepo { create(input: NewToken): Token; findById(id: string): Token | null; findByHash(hash: string): Token | null; listByPrincipal(type: PrincipalType, id: string): readonly Token[]; revoke(id: string): boolean; revokeDescendants(id: string): number; revokeAllForPrincipal(type: PrincipalType, id: string): number; touch(id: string): void }
export interface AuditRepo { append(input: NewAuditEvent): AuditEvent; list(q: { target?: string; actorId?: string; limit: number }): readonly AuditEvent[] }
export interface Store { readonly users: UserRepo; readonly agents: AgentRepo; readonly repositories: RepositoryRepo; readonly tokens: TokenRepo; readonly audit: AuditRepo; transaction<T>(fn: () => T): T }

export function createStore(db: Db, clock: Clock = systemClock): Store {
  return Object.freeze({
    users: createUserRepo(db, clock), agents: createAgentRepo(db, clock),
    repositories: createRepositoryRepo(db, clock), tokens: createTokenRepo(db, clock),
    audit: createAuditRepo(db, clock),
    transaction<T>(fn: () => T): T { return db.transaction(fn)(); },
  });
}
