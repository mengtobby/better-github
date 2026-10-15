import { isUtf8 } from 'node:buffer';
import { z } from 'zod';
import { parseInput } from '../shared/http.js';
import { AppError, notFound } from '../shared/errors.js';
import { createGitRunner } from './runner.js';
import type { GitRunner } from './runner.js';
import { assertRepo, assertSafePath, assertSafeRef } from './validate.js';
import { matchPatches, parseRaw } from './diff-parse.js';
import { parseBlame } from './blame-parse.js';
import { mergeRepo } from './merge.js';
import type { Ref, TreeEntry, Blob, Commit, Diff, BlameRange, MergeInput, MergeResult } from './types.js';
export interface Scm {
  listRefs(repo: string): Promise<readonly Ref[]>;
  resolveRef(repo: string, ref: string): Promise<string | null>;
  readTree(repo: string, ref: string, path?: string): Promise<readonly TreeEntry[]>;
  readBlob(repo: string, ref: string, path: string, opts?: { maxBytes?: number }): Promise<Blob>;
  log(repo: string, ref: string, opts?: { path?: string; limit?: number; skip?: number }): Promise<readonly Commit[]>;
  getCommit(repo: string, sha: string): Promise<Commit>;
  diff(repo: string, base: string, head: string, opts?: { maxFiles?: number; maxLines?: number; maxPatchBytes?: number; threeDot?: boolean }): Promise<Diff>;
  blame(repo: string, ref: string, path: string): Promise<readonly BlameRange[]>;
  mergeBase(repo: string, a: string, b: string): Promise<string | null>;
  merge(repo: string, input: MergeInput): Promise<MergeResult>;
}
const format = '%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%B%x00';
function commits(text: string): readonly Commit[] {
  const fields = text.split('\0');
  const result: Commit[] = [];
  for (let i = 0; i + 8 < fields.length; i += 9) result.push({ sha: fields[i]!.trim(), parents: fields[i + 1]!.split(' ').filter(Boolean), author: { name: fields[i + 2]!, email: fields[i + 3]!, date: fields[i + 4]! }, committer: { name: fields[i + 5]!, email: fields[i + 6]!, date: fields[i + 7]! }, message: fields[i + 8]!.replace(/\n$/u, '') });
  return result;
}
function count(value: number | undefined, fallback: number): number {
  return parseInput(z.number().int().nonnegative(), value ?? fallback);
}
function textPrefix(data: Buffer, partial: boolean): Buffer {
  if (!partial || isUtf8(data)) return data;
  let start = data.length - 1;
  while (start >= 0 && data.length - start <= 3 && (data[start]! & 0xc0) === 0x80) start--;
  const lead = data[start] ?? 0;
  const width = lead >= 0xc2 && lead <= 0xdf ? 2 : lead >= 0xe0 && lead <= 0xef ? 3 : lead >= 0xf0 && lead <= 0xf4 ? 4 : 0;
  return width > data.length - start ? data.subarray(0, start) : data;
}
export function createScm(runner: GitRunner = createGitRunner()): Scm {
  const run = (repo: string, args: readonly string[]) => { assertRepo(repo); return runner.run(args, { cwd: repo }); };
  async function resolveRef(repo: string, ref: string): Promise<string | null> {
    assertRepo(repo); assertSafeRef(ref);
    const result = await runner.run(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], { cwd: repo, allowExitCodes: [1] });
    return result.exitCode === 1 ? null : result.stdout.toString().trim();
  }
  async function required(repo: string, ref: string): Promise<string> {
    const sha = await resolveRef(repo, ref);
    if (!sha) throw notFound('Reference');
    return sha;
  }
  async function object(repo: string, ref: string, path: string): Promise<{ sha: string; path: string }> {
    const normalized = assertSafePath(path), sha = await required(repo, ref);
    const result = await runner.run(['rev-parse', '--verify', '--quiet', '--end-of-options', `${sha}:${normalized}`], { cwd: repo, allowExitCodes: [1] });
    if (result.exitCode !== 0) throw notFound('Path');
    return { sha: result.stdout.toString().trim(), path: normalized };
  }
  const scm: Scm = {
    resolveRef,
    async listRefs(repo) {
      const text = (await run(repo, ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads/', 'refs/tags/'])).stdout.toString();
      return text.trim().split('\n').filter(Boolean).map(line => { const [name = '', sha = ''] = line.split('\0'); return { name: name.replace(/^refs\/(heads|tags)\//u, ''), sha, type: name.startsWith('refs/heads/') ? 'branch' : 'tag' }; });
    },
    async readTree(repo, ref, path = '') {
      const obj = await object(repo, ref, path);
      if ((await run(repo, ['cat-file', '-t', obj.sha])).stdout.toString().trim() !== 'tree') throw notFound('Tree');
      return (await run(repo, ['ls-tree', '-l', '-z', obj.sha])).stdout.toString().split('\0').filter(Boolean).map(record => {
        const tab = record.indexOf('\t'), name = record.slice(tab + 1);
        const [mode = '', type = '', sha = '', size = '-'] = record.slice(0, tab).trim().split(/\s+/u);
        return { name, path: obj.path ? `${obj.path}/${name}` : name, mode, type: type as TreeEntry['type'], sha, size: size === '-' ? null : Number(size) };
      });
    },
    async readBlob(repo, ref, path, opts = {}) {
      const maxBytes = count(opts.maxBytes, 1024 * 1024), obj = await object(repo, ref, path);
      if ((await run(repo, ['cat-file', '-t', obj.sha])).stdout.toString().trim() !== 'blob') throw notFound('Blob');
      const size = Number((await run(repo, ['cat-file', '-s', obj.sha])).stdout.toString());
      if (!Number.isSafeInteger(size) || size < 0) throw new AppError('INTERNAL', 'Invalid blob size');
      const data = (await runner.run(['cat-file', 'blob', obj.sha], { cwd: repo, truncateAt: maxBytes + 1 })).stdout;
      const prefix = textPrefix(data, size > data.length);
      const encoding = isUtf8(prefix) && !data.includes(0) ? 'utf8' : 'base64';
      let content = data.subarray(0, maxBytes);
      if (encoding === 'utf8') while (content.length && !isUtf8(content)) content = content.subarray(0, content.length - 1);
      return { path: obj.path, sha: obj.sha, size, encoding, content: content.toString(encoding), truncated: size > maxBytes };
    },
    async log(repo, ref, opts = {}) {
      const path = opts.path === undefined ? undefined : assertSafePath(opts.path);
      const sha = await required(repo, ref);
      if (path) await object(repo, sha, path);
      const args = ['--literal-pathspecs', 'log', `--format=${format}`, `--max-count=${count(opts.limit, 30)}`, `--skip=${count(opts.skip, 0)}`, '--end-of-options', sha, '--'];
      if (path) args.push(path);
      return commits((await run(repo, args)).stdout.toString());
    },
    async getCommit(repo, sha) { return (await scm.log(repo, sha, { limit: 1 }))[0]!; },
    async mergeBase(repo, a, b) {
      assertSafeRef(a); assertSafeRef(b);
      const left = await required(repo, a), right = await required(repo, b);
      const result = await runner.run(['merge-base', left, right], { cwd: repo, allowExitCodes: [1] });
      return result.exitCode === 1 ? null : result.stdout.toString().trim();
    },
    async diff(repo, base, head, opts = {}) {
      assertSafeRef(base); assertSafeRef(head);
      const maxFiles = count(opts.maxFiles, 300), left = await required(repo, base), right = await required(repo, head);
      const mergeBase = await scm.mergeBase(repo, left, right);
      const range = `${left}${opts.threeDot ? '...' : '..'}${right}`;
      const common = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--find-renames'];
      const raw = parseRaw((await run(repo, [...common, '--raw', '-z', range, '--'])).stdout.toString());
      const selected = raw.slice(0, maxFiles);
      const paths = [...new Set(selected.flatMap(file => [file.oldPath, file.newPath].filter((path): path is string => path !== null)))];
      const maxLines = count(opts.maxLines, 20_000), maxPatchBytes = count(opts.maxPatchBytes, 8 * 1024 * 1024);
      const patch = paths.length ? await runner.run(['--literal-pathspecs', ...common, '--patch', range, '--', ...paths], { cwd: repo, truncateAt: maxPatchBytes }) : undefined;
      const parsed = matchPatches(selected, patch?.stdout.toString() ?? '', maxLines);
      return { base: left, head: right, mergeBase, truncated: raw.length > maxFiles || !!patch?.truncated || parsed.truncated, files: parsed.files };
    },
    async blame(repo, ref, path) {
      const obj = await object(repo, ref, path), sha = await required(repo, ref);
      if ((await run(repo, ['cat-file', '-t', obj.sha])).stdout.toString().trim() !== 'blob') throw notFound('Blob');
      return parseBlame((await run(repo, ['--literal-pathspecs', 'blame', '--line-porcelain', sha, '--', obj.path])).stdout.toString());
    },
    async merge(repo, input) { assertRepo(repo); return mergeRepo(runner, repo, input, ref => resolveRef(repo, ref)); },
  };
  return scm;
}


