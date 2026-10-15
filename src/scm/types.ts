export interface Ref { readonly name: string; readonly sha: string; readonly type: 'branch' | 'tag' }
export interface TreeEntry { readonly name: string; readonly path: string; readonly type: 'blob' | 'tree' | 'commit'; readonly mode: string; readonly sha: string; readonly size: number | null }
export interface Blob { readonly path: string; readonly sha: string; readonly size: number; readonly encoding: 'utf8' | 'base64'; readonly content: string; readonly truncated: boolean }
export interface Signature { readonly name: string; readonly email: string; readonly date: string }
export interface Commit { readonly sha: string; readonly parents: readonly string[]; readonly author: Signature; readonly committer: Signature; readonly message: string }
export interface DiffLine { readonly type: 'context' | 'add' | 'del'; readonly content: string; readonly oldLine: number | null; readonly newLine: number | null }
export interface DiffHunk { readonly header: string; readonly oldStart: number; readonly oldLines: number; readonly newStart: number; readonly newLines: number; readonly lines: readonly DiffLine[] }
export interface DiffFile { readonly oldPath: string | null; readonly newPath: string | null; readonly status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'type-changed'; readonly binary: boolean; readonly additions: number; readonly deletions: number; readonly hunks: readonly DiffHunk[] }
export interface Diff { readonly base: string; readonly head: string; readonly mergeBase: string | null; readonly files: readonly DiffFile[]; readonly truncated: boolean }
export interface BlameRange { readonly startLine: number; readonly lineCount: number; readonly sha: string; readonly author: string; readonly authorTime: string; readonly summary: string }
export type MergeStrategy = 'merge' | 'squash' | 'ff-only';
export interface MergeInput { readonly target: string; readonly source: string; readonly message: string; readonly author: { readonly name: string; readonly email: string }; readonly expectedTargetSha?: string; readonly strategy?: MergeStrategy }
export type MergeResult = { readonly status: 'merged'; readonly sha: string; readonly fastForward: boolean } | { readonly status: 'up-to-date'; readonly sha: string } | { readonly status: 'conflict'; readonly conflicts: readonly string[] };
