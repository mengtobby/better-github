import { afterEach, expect, it, vi } from 'vitest';
import { childEnv, createGitRunner } from './runner.js';
import { matchPatches } from './diff-parse.js';
import { mergeRepo } from './merge.js';
afterEach(() => { vi.unstubAllEnvs(); });
it('allows only selected parent variables and explicit overrides', () => {
  vi.stubEnv('SECRET_X', 'secret'); vi.stubEnv('GIT_DIR', 'wrong'); vi.stubEnv('GIT_EXEC_PATH', 'exec');
  expect(childEnv()).not.toHaveProperty('SECRET_X');
  expect(childEnv()).not.toHaveProperty('GIT_DIR');
  expect(childEnv({ GIT_AUTHOR_NAME: 'Agent' })).toMatchObject({ GIT_EXEC_PATH: 'exec', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Agent' });
});
it('returns bounded stdout normally when killing a producer', async () => {
  const result = await createGitRunner(process.execPath).run(['-e', 'process.stdout.write(Buffer.alloc(5000000)); setInterval(() => {}, 1000)'], { truncateAt: 1025 });
  expect(result.stdout.length).toBe(1025); expect(result.truncated).toBe(true);
});
it('decodes quoted UTF8 and C escapes in patch paths', () => {
  const result = matchPatches([{ oldPath: '\u00e9\t.txt', newPath: '\u00e9\t.txt', status: 'modified' }], 'diff --git "a/\\303\\251\\t.txt" "b/\\303\\251\\t.txt"\n@@ -1 +1 @@\n-old\n+new\n', 100);
  expect(result.files[0]).toMatchObject({ additions: 1, deletions: 1 });
});
it('normalizes 64-character expected object IDs', async () => {
  const sha = 'ab'.repeat(32);
  const result = await mergeRepo({ async run() { return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0, truncated: false }; } }, 'repo', { target: 'main', source: 'source', message: 'merge', expectedTargetSha: sha.toUpperCase(), author: { name: 'Agent', email: 'agent@example.com' } }, async () => sha);
  expect(result).toEqual({ status: 'up-to-date', sha });
});
