export type Scope = 'repo:read' | 'repo:write' | 'repo:admin' | 'agents:manage' | 'tokens:manage';
export const ALL_SCOPES: readonly Scope[] = Object.freeze(['repo:read', 'repo:write', 'repo:admin', 'agents:manage', 'tokens:manage']);
export type PrincipalType = 'user' | 'agent';
export type Visibility = 'public' | 'private';
export interface User { readonly id: string; readonly handle: string; readonly email: string; readonly passwordHash: string; readonly createdAt: string }
export interface Agent { readonly id: string; readonly handle: string; readonly sponsorUserId: string; readonly displayName: string; readonly model: string | null; readonly createdAt: string; readonly revokedAt: string | null }
export interface Repository { readonly id: string; readonly ownerId: string; readonly name: string; readonly description: string; readonly visibility: Visibility; readonly defaultBranch: string; readonly createdAt: string }
export interface Token { readonly issuedByTokenId?: string | null; readonly id: string; readonly tokenHash: string; readonly principalType: PrincipalType; readonly principalId: string; readonly label: string; readonly scopes: readonly Scope[]; readonly repoIds: readonly string[] | null; readonly expiresAt: string; readonly createdAt: string; readonly revokedAt: string | null; readonly lastUsedAt: string | null }
export interface AuditEvent { readonly id: string; readonly at: string; readonly actorType: PrincipalType | 'system'; readonly actorId: string | null; readonly action: string; readonly target: string | null; readonly metadata: Readonly<Record<string, unknown>> }
export interface NewUser { readonly handle: string; readonly email: string; readonly passwordHash: string }
export interface NewAgent { readonly handle: string; readonly sponsorUserId: string; readonly displayName: string; readonly model?: string | null }
export interface NewRepository { readonly ownerId: string; readonly name: string; readonly description?: string; readonly visibility?: Visibility; readonly defaultBranch?: string }
export interface RepositoryPatch { readonly description?: string; readonly visibility?: Visibility; readonly defaultBranch?: string }
export interface NewToken { readonly issuedByTokenId?: string | null; readonly tokenHash: string; readonly principalType: PrincipalType; readonly principalId: string; readonly label?: string; readonly scopes: readonly Scope[]; readonly repoIds?: readonly string[] | null; readonly expiresAt: string }
export interface NewAuditEvent { readonly actorType: PrincipalType | 'system'; readonly actorId?: string | null; readonly action: string; readonly target?: string | null; readonly metadata?: Record<string, unknown> }
export interface Page<T> { readonly items: readonly T[]; readonly total: number }
export interface PageQuery { readonly limit: number; readonly offset: number }
