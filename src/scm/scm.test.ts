import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createScm } from './scm.js';
import { createGitRunner } from './runner.js';
import { assertSafePath, assertSafeRef } from './validate.js';
const dirs: string[] = [];
const runner = createGitRunner();
const scm = createScm(runner);
const identity = { GIT_AUTHOR_NAME: 'Agent', GIT_AUTHOR_EMAIL: 'agent@example.com', GIT_COMMITTER_NAME: 'Agent', GIT_COMMITTER_EMAIL: 'agent@example.com' };
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'scm-')); dirs.push(dir);
  const repo = join(dir, 'repo.git');
  await runner.run(['init', '--bare', repo]);
  const git = async (args: readonly string[], input?: string | Buffer) => (await runner.run(args, { cwd: repo, input, env: identity })).stdout.toString().trim();
  const blob = (text: string | Buffer) => git(['hash-object', '-w', '--stdin'], text);
  const tree = async (files: Record<string, string>) => git(['mktree'], Object.entries(files).map(([name, sha]) => `100644 blob ${sha}\t${name}\n`).join(''));
  const commit = async (files: Record<string, string>, parents: readonly string[] = [], message = 'commit') => git(['commit-tree', await tree(files), ...parents.flatMap(p => ['-p', p])], message);
  const a = await blob('one\ntwo\nthree\n');
  const root = await commit({ 'a.txt': a });
  await git(['update-ref', 'refs/heads/main', root]);
  return { repo, git, blob, commit, root, a };
}
describe('SCM reads', () => {
  it('reads refs, trees, blobs, history, commits and blame', async () => {
    const f = await fixture();
    await f.git(['update-ref', 'refs/tags/v1', f.root]);
    expect(await scm.listRefs(f.repo)).toHaveLength(2);
    expect(await scm.resolveRef(f.repo, 'main')).toBe(f.root);
    expect(await scm.resolveRef(f.repo, 'missing')).toBeNull();
    expect(await scm.readTree(f.repo, 'main')).toEqual([expect.objectContaining({ name: 'a.txt', size: 14, type: 'blob' })]);
    expect(await scm.readBlob(f.repo, 'main', 'a.txt')).toMatchObject({ content: 'one\ntwo\nthree\n', encoding: 'utf8', truncated: false });
    expect(await scm.readBlob(f.repo, 'main', 'a.txt', { maxBytes: 3 })).toMatchObject({ content: 'one', truncated: true });
    expect(await scm.getCommit(f.repo, f.root)).toMatchObject({ sha: f.root, parents: [], message: 'commit', author: { name: 'Agent' } });
    expect(await scm.log(f.repo, 'main', { path: 'a.txt' })).toHaveLength(1);
    expect(await scm.log(f.repo, 'main', { skip: 1 })).toHaveLength(0);
    expect(await scm.blame(f.repo, 'main', 'a.txt')).toEqual([expect.objectContaining({ startLine: 1, lineCount: 3, sha: f.root })]);
    for (const action of [() => scm.readBlob(f.repo, 'missing', 'a.txt'), () => scm.readBlob(f.repo, 'main', 'missing'), () => scm.readTree(f.repo, 'main', 'a.txt'), () => scm.readBlob(f.repo, 'main', ''), () => scm.blame(f.repo, 'main', '')]) await expect(action()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('handles binary and invalid UTF8 plus nested trees', async () => {
    const f = await fixture();
    const binary = await f.blob(Buffer.from([0, 255, 1]));
    const utf = await f.blob('éhello');
    const sub = await f.git(['mktree'], `100644 blob ${binary}\tb.bin\n`);
    const tree = await f.git(['mktree'], `040000 tree ${sub}\tsub\n100644 blob ${utf}\tu.txt\n`);
    const sha = await f.git(['commit-tree', tree], 'nested');
    expect(await scm.readTree(f.repo, sha, 'sub')).toEqual([expect.objectContaining({ path: 'sub/b.bin' })]);
    expect(await scm.readBlob(f.repo, sha, 'sub\\b.bin')).toMatchObject({ encoding: 'base64', content: 'AP8B' });
    expect(await scm.readBlob(f.repo, sha, 'u.txt', { maxBytes: 1 })).toMatchObject({ content: '', truncated: true });
    expect(await scm.mergeBase(f.repo, sha, f.root)).toBeNull();
  });
  it('parses diffs, renames, binary, deletions and limits', async () => {
    const f = await fixture();
    const base = await f.commit({ 'a.txt': f.a, 'gone.txt': await f.blob('gone'), 'old.txt': await f.blob('rename\n') }, [f.root]);
    const head = await f.commit({ 'a.txt': await f.blob('one\nchanged\nthree\n'), 'new.txt': await f.blob('rename\n'), 'binary': await f.blob(Buffer.from([0, 1])), 'added.txt': await f.blob('added\n') }, [base]);
    const diff = await scm.diff(f.repo, base, head, { threeDot: true });
    expect(diff.files).toHaveLength(5);
    expect(diff.files.find(file => file.status === 'renamed')).toMatchObject({ oldPath: 'old.txt', newPath: 'new.txt' });
    expect(diff.files.find(file => file.newPath === 'binary')?.binary).toBe(true);
    expect(diff.files.find(file => file.newPath === 'a.txt')).toMatchObject({ additions: 1, deletions: 1, hunks: [expect.objectContaining({ oldStart: 1, newStart: 1, lines: expect.arrayContaining([expect.objectContaining({ type: 'add', newLine: 2, oldLine: null })]) })] });
    expect((await scm.diff(f.repo, base, head, { maxFiles: 1 })).truncated).toBe(true);
  });
});
describe('merge', () => {
  it('creates merge and squash commits and detects stale refs', async () => {
    const f = await fixture();
    const source = await f.commit({ 'a.txt': f.a, 'b.txt': await f.blob('b') }, [f.root]);
    const input = { target: 'main', source, message: 'merge', author: { name: 'Agent', email: 'agent@example.com' } };
    await expect(scm.merge(f.repo, { ...input, expectedTargetSha: 'a'.repeat(40) })).rejects.toMatchObject({ code: 'CONFLICT' });
    const merged = await scm.merge(f.repo, input);
    expect(merged.status).toBe('merged');
    if (merged.status !== 'merged') throw new Error('Expected merge');
    expect((await scm.getCommit(f.repo, merged.sha)).parents).toEqual([f.root, source]);
    expect(await scm.merge(f.repo, input)).toMatchObject({ status: 'up-to-date' });
    await f.git(['update-ref', 'refs/heads/squash', f.root]);
    const squash = await scm.merge(f.repo, { ...input, target: 'squash', strategy: 'squash' });
    if (squash.status !== 'merged') throw new Error('Expected squash');
    expect((await scm.getCommit(f.repo, squash.sha)).parents).toEqual([f.root]);
    await f.git(['update-ref', 'refs/heads/ff', f.root]);
    expect(await scm.merge(f.repo, { ...input, target: 'ff', strategy: 'ff-only' })).toMatchObject({ status: 'merged', sha: source, fastForward: true });
    await expect(scm.merge(f.repo, { ...input, target: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('returns conflicts without moving the target and rejects non-fast-forward', async () => {
    const f = await fixture();
    const left = await f.commit({ 'a.txt': await f.blob('left\n') }, [f.root]);
    const right = await f.commit({ 'a.txt': await f.blob('right\n') }, [f.root]);
    await f.git(['update-ref', 'refs/heads/main', left]);
    const input = { target: 'main', source: right, message: 'merge', author: { name: 'Agent', email: 'agent@example.com' } };
    expect(await scm.merge(f.repo, input)).toEqual({ status: 'conflict', conflicts: ['a.txt'] });
    expect(await scm.resolveRef(f.repo, 'main')).toBe(left);
    await expect(scm.merge(f.repo, { ...input, strategy: 'ff-only' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
describe('validation and runner', () => {
  it('rejects unsafe input', async () => {
    for (const ref of ['', '--upload-pack=x', 'a..b', 'a@{b', 'a b', 'a.lock', 'a/', 'a\\b', 'a\0b']) expect(() => assertSafeRef(ref)).toThrow();
    for (const path of ['../x', '/x', 'C:\\x', '-x', 'a\0b']) expect(() => assertSafePath(path)).toThrow();
    expect(assertSafePath('a\\b')).toBe('a/b');
    assertSafeRef('refs/heads/main'); assertSafeRef('a'.repeat(64));
    await expect(scm.resolveRef('relative', 'main')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(scm.resolveRef(join(tmpdir(), 'repo'), 'a..b')).rejects.toMatchObject({ code: 'VALIDATION' });
  });
  it('handles process failure, limits, input, allowed errors and timeout', async () => {
    await expect(runner.run(['--version'], { maxBytes: 1 })).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(runner.run(['not-a-git-command'])).rejects.toMatchObject({ code: 'INTERNAL', message: 'Git operation failed' });
    expect((await runner.run(['not-a-git-command'], { allowExitCodes: [1] })).exitCode).toBe(1);
    await expect(createGitRunner('definitely-missing-executable').run([])).rejects.toMatchObject({ code: 'INTERNAL' });
    const node = createGitRunner(process.execPath);
    await expect(node.run(['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 10 })).rejects.toMatchObject({ code: 'INTERNAL' });
  });
});

it('merges divergent clean histories and detects a concurrent ref update', async () => {
  const f = await fixture();
  const left = await f.commit({ 'a.txt': f.a, left: await f.blob('left') }, [f.root]);
  const right = await f.commit({ 'a.txt': f.a, right: await f.blob('right') }, [f.root]);
  await f.git(['update-ref', 'refs/heads/main', left]);
  const input = { target: 'main', source: right, message: 'clean merge', author: { name: 'Agent', email: 'agent@example.com' } };
  const racing = createScm({ async run(args, opts) {
    if (args[0] === 'update-ref') await f.git(['update-ref', 'refs/heads/main', f.root]);
    return runner.run(args, opts);
  } });
  await expect(racing.merge(f.repo, input)).rejects.toMatchObject({ code: 'CONFLICT' });
  await f.git(['update-ref', 'refs/heads/main', left]);
  const result = await scm.merge(f.repo, input);
  if (result.status !== 'merged') throw new Error('Expected merge');
  expect((await scm.getCommit(f.repo, result.sha)).parents).toEqual([left, right]);
  expect((await scm.readTree(f.repo, result.sha)).map(entry => entry.name)).toEqual(['a.txt', 'left', 'right']);
});
