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
    const utf = await f.blob('�hello');
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

it('bounds large blobs and patch output and matches type-change sections by path', async () => {
  const f = await fixture();
  const large = await f.blob(Buffer.alloc(5 * 1024 * 1024, 120));
  const base = await f.commit({ 'b.txt': await f.blob('original\n'), 'z.txt': await f.blob('before\n'), large }, [f.root]);
  const reads: number[] = [];
  const bounded = createScm({ async run(args, opts) {
    const result = await runner.run(args, opts);
    if (args[0] === 'cat-file' && args[1] === 'blob') reads.push(result.stdout.length);
    return result;
  } });
  expect(await bounded.readBlob(f.repo, base, 'large')).toMatchObject({ truncated: true, encoding: 'utf8' });
  expect(reads).toEqual([1024 * 1024 + 1]);
  const link = await f.blob('destination');
  const tree = await f.git(['mktree'], `120000 blob ${link}\tb.txt\n100644 blob ${large}\tlarge\n100644 blob ${await f.blob('after\n')}\tz.txt\n`);
  const head = await f.git(['commit-tree', tree, '-p', base], 'type change');
  const diff = await scm.diff(f.repo, base, head);
  expect(diff.files[0]).toMatchObject({ newPath: 'b.txt', status: 'type-changed', additions: 1, deletions: 1 });
  expect(diff.files[1]).toMatchObject({ newPath: 'z.txt', additions: 1, deletions: 1 });
  expect(diff.files[1]?.hunks[0]?.lines.map(line => line.content)).toEqual(['before', 'after']);
  for (const opts of [{ maxFiles: 0 }, { maxLines: 1 }, { maxPatchBytes: 10 }]) expect((await scm.diff(f.repo, base, head, opts)).truncated).toBe(true);
});

it('maps non-race update failures to INTERNAL and accepts uppercase expected SHAs', async () => {
  const f = await fixture();
  const source = await f.commit({ 'a.txt': f.a, b: await f.blob('b') }, [f.root]);
  const failing = createScm({ async run(args, opts) {
    if (args[0] === 'update-ref') return { stdout: Buffer.alloc(0), stderr: 'failure', exitCode: 128, truncated: false };
    return runner.run(args, opts);
  } });
  const input = { target: 'main', source, message: 'merge', strategy: 'ff-only' as const, expectedTargetSha: f.root.toUpperCase(), author: { name: 'Agent', email: 'agent@example.com' } };
  await expect(failing.merge(f.repo, input)).rejects.toMatchObject({ code: 'INTERNAL' });
  expect(await scm.merge(f.repo, input)).toMatchObject({ status: 'merged' });
});

it('rejects unsafe blob sizes before reading content', async () => {
  const f = await fixture();
  const invalid = createScm({ async run(args, opts) {
    if (args[0] === 'cat-file' && args[1] === '-s') return { stdout: Buffer.from('9007199254740992'), stderr: '', exitCode: 0, truncated: false };
    return runner.run(args, opts);
  } });
  await expect(invalid.readBlob(f.repo, f.root, 'a.txt')).rejects.toMatchObject({ code: 'INTERNAL' });
});

it('requests raw and patches together without pathspec arguments', async () => {
  const f = await fixture();
  const head = await f.commit({ 'a.txt': await f.blob('changed\n'), 'z.txt': await f.blob('extra\n') }, [f.root]);
  const patchCalls: (readonly string[])[] = [];
  const limited = createScm({ async run(args, opts) {
    if (args.includes('--patch-with-raw')) patchCalls.push(args);
    return runner.run(args, opts);
  } });
  const diff = await limited.diff(f.repo, f.root, head, { maxFiles: 1 });
  expect(diff).toMatchObject({ truncated: true, files: [expect.objectContaining({ newPath: 'a.txt' })] });
  expect(patchCalls).toHaveLength(1);
  expect(patchCalls[0]?.[0]).toBe('diff');
  expect(patchCalls[0]?.slice(patchCalls[0].indexOf('--') + 1)).toEqual([]);
});


it('compares 300 long UTF8 space-heavy paths without a pathspec argv list', async () => {
  const f = await fixture();
  const before = await f.blob('before\n'), after = await f.blob('after\n');
  const names = Array.from({ length: 300 }, (_, i) => '\u00e9 ' + 'many spaces '.repeat(11) + i);
  const base = await f.commit(Object.fromEntries(names.map(name => [name, before])), [f.root]);
  const head = await f.commit(Object.fromEntries(names.map(name => [name, after])), [base]);
  const start = performance.now();
  const diff = await scm.diff(f.repo, base, head);
  expect(performance.now() - start).toBeLessThan(2000);
  expect(diff.files).toHaveLength(300);
  expect(diff.files.every(file => file.hunks.length === 1)).toBe(true);
  expect(diff.truncated).toBe(false);
});

it('keeps every patch paired when rename detection exceeds its limit', async () => {
  const f = await fixture();
  const blobs = await Promise.all(Array.from({ length: 6 }, (_, i) => f.blob(('unique ' + i + '\n').repeat(20))));
  const changed = await Promise.all(Array.from({ length: 6 }, (_, i) => f.blob(('unique ' + i + '\n').repeat(19) + 'changed\n')));
  const base = await f.commit(Object.fromEntries(blobs.map((blob, i) => [i + '-old', blob])), [f.root]);
  const head = await f.commit(Object.fromEntries(changed.map((blob, i) => [i + '-new', blob])), [base]);
  const limited = createScm({ async run(args, opts) { return runner.run(['-c', 'diff.renameLimit=1', ...args], opts); } });
  const diff = await limited.diff(f.repo, base, head);
  expect(diff.files.length).toBeGreaterThan(0);
  expect(diff.files.every(file => file.hunks.length > 0)).toBe(true);
  const selected = await limited.diff(f.repo, base, head, { maxFiles: 2 });
  expect(selected.files).toHaveLength(2);
  expect(selected.truncated).toBe(true);
  expect(selected.files.every(file => file.hunks.length > 0)).toBe(true);
});
