import { afterEach, expect, it, vi } from 'vitest';
import { childEnv, createGitRunner } from './runner.js';
import { matchPatches, splitDiffOutput } from './diff-parse.js';
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
it('matches verbatim UTF8 and space-heavy patch paths in linear time', () => {
  const raw = Array.from({ length: 300 }, (_, i) => ({ oldPath: '\u00e9 ' + 'many spaces '.repeat(30) + i, newPath: '\u00e9 ' + 'many spaces '.repeat(30) + i, status: 'modified' as const }));
  const patch = raw.map(file => 'diff --git a/' + file.oldPath + ' b/' + file.newPath + '\n@@ -1 +1 @@\n-old\n+new\n').join('');
  const start = performance.now();
  expect(matchPatches(raw, patch, 20000).files.every(file => file.additions === 1 && file.deletions === 1)).toBe(true);
  expect(performance.now() - start).toBeLessThan(1500);
});
it('does not truncate exactly the byte budget', async () => {
  expect(await createGitRunner(process.execPath).run(['-e', 'process.stdout.write("12345")'], { truncateAt: 5 })).toMatchObject({ truncated: false, stdout: Buffer.from('12345') });
});
it('wraps synchronous spawn failures', async () => {
  await expect(createGitRunner('git\0invalid').run([])).rejects.toMatchObject({ code: 'INTERNAL', message: 'Git operation failed' });
});
it.each(['cannot lock ref', 'refs/heads/main.lock'])('maps update-ref lock failures to conflicts: %s', async stderr => {
  let calls = 0;
  const target = 'a'.repeat(40), source = 'b'.repeat(40);
  await expect(mergeRepo({ async run(args) { return { stdout: Buffer.alloc(0), stderr, exitCode: args[0] === 'update-ref' ? 128 : calls++ === 0 ? 1 : 0, truncated: false }; } }, 'repo', { target: 'main', source: 'source', strategy: 'ff-only', message: 'merge', author: { name: 'Agent', email: 'agent@example.com' } }, async ref => ref === 'source' ? source : target)).rejects.toMatchObject({ code: 'CONFLICT' });
});
it('normalizes 64-character expected object IDs', async () => {
  const sha = 'ab'.repeat(32);
  const result = await mergeRepo({ async run() { return { stdout: Buffer.alloc(0), stderr: '', exitCode: 0, truncated: false }; } }, 'repo', { target: 'main', source: 'source', message: 'merge', expectedTargetSha: sha.toUpperCase(), author: { name: 'Agent', email: 'agent@example.com' } }, async () => sha);
  expect(result).toEqual({ status: 'up-to-date', sha });
});

it('keeps only complete raw records when the byte budget ends inside raw output', () => {
  const first = ':100644 100644 a b M\0first\0';
  expect(splitDiffOutput(first + ':100644 100644 a b R100\0old\0partial', 300)).toMatchObject({ truncated: true, patch: '', raw: [{ oldPath: 'first', newPath: 'first', status: 'modified' }] });
  expect(splitDiffOutput(':100644 100644 partial', 300)).toMatchObject({ truncated: true, raw: [] });
});
it('matches Git C-quoted non-ASCII patch headers', () => {
  const path = '\u00e9\t.txt';
  const patch = 'diff --git "a/\\303\\251\\t.txt" "b/\\303\\251\\t.txt"\n@@ -1 +1 @@\n-old\n+new\n';
  expect(matchPatches([{ oldPath: path, newPath: path, status: 'modified' }], patch, 100).files[0]).toMatchObject({ additions: 1, deletions: 1 });
});
