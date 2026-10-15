import type { PrincipalType, Scope } from '../db/types.js';

export interface Principal {
  readonly type: PrincipalType;
  readonly id: string;
  readonly handle: string;
  readonly userId: string;
  readonly scopes: readonly Scope[];
  readonly repoIds: readonly string[] | null;
  readonly tokenId: string;
  readonly expiresAt: string;
}
