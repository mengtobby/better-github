import { z } from 'zod';
import { parseInput } from '../shared/http.js';
import { conflict, notFound } from '../shared/errors.js';
import { assertSafeRef, hasControl } from './validate.js';
import type { GitRunner } from './runner.js';
import type { MergeInput, MergeResult } from './types.js';
export async function mergeRepo(runner: GitRunner, repo: string, input: MergeInput, resolve: (ref: string) => Promise<string | null>): Promise<MergeResult> {
  parseInput(z.object({ target: z.string().min(1), source: z.string().min(1), message: z.string().min(1), author: z.object({ name: z.string().min(1).refine(value => !hasControl(value) && !/[<>]/u.test(value)), email: z.email() }), expectedTargetSha: z.string().regex(/^(?:[a-f\d]{40}|[a-f\d]{64})$/u).optional(), strategy: z.enum(['merge', 'squash', 'ff-only']).optional() }), input);
  assertSafeRef(input.target); assertSafeRef(input.source);
  const branch = `refs/heads/${input.target}`;
  const target = await resolve(branch), source = await resolve(input.source);
  if (!target || !source) throw notFound('Reference');
  if (input.expectedTargetSha && input.expectedTargetSha !== target) throw conflict('Target branch changed');
  const run = (args: readonly string[]) => runner.run(args, { cwd: repo, allowExitCodes: [1] });
  if ((await run(['merge-base', '--is-ancestor', source, target])).exitCode === 0) return { status: 'up-to-date', sha: target };
  const fastForward = (await run(['merge-base', '--is-ancestor', target, source])).exitCode === 0;
  let sha = source;
  if (input.strategy === 'ff-only' && !fastForward) throw conflict('Fast-forward merge is not possible');
  if (input.strategy !== 'ff-only') {
    const tree = await run(['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', target, source]);
    const parts = tree.stdout.toString().split('\0');
    if (tree.exitCode === 1) return { status: 'conflict', conflicts: parts.slice(1).filter(Boolean) };
    const args = ['commit-tree', parts[0]!.trim(), '-p', target];
    if (input.strategy !== 'squash') args.push('-p', source);
    const identity = { GIT_AUTHOR_NAME: input.author.name, GIT_AUTHOR_EMAIL: input.author.email, GIT_COMMITTER_NAME: input.author.name, GIT_COMMITTER_EMAIL: input.author.email };
    sha = (await runner.run(args, { cwd: repo, input: input.message, env: identity })).stdout.toString().trim();
  }
  if ((await runner.run(['update-ref', branch, sha, input.expectedTargetSha ?? target], { cwd: repo, allowExitCodes: [1, 128] })).exitCode !== 0) throw conflict('Target branch changed');
  return { status: 'merged', sha, fastForward: input.strategy === 'ff-only' };
}


