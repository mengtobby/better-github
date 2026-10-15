import { execFile } from 'node:child_process';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { AppError, conflict } from '../shared/errors.js';
import { parseInput } from '../shared/http.js';
import { assertValidName } from './names.js';

const execute = promisify(execFile);
const branchSchema = z.string().min(1).refine((value) =>
  !value.startsWith('-') && !value.includes('..') && !/[~^:?*[\\]/.test(value)
  && [...value].every((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
  && !value.endsWith('.') && !value.endsWith('/') && !value.includes('//')
  && !value.includes('@{') && value !== '@'
  && value.split('/').every((part) => !part.startsWith('.') && !part.endsWith('.lock')));

export interface RepoStorage {
  readonly root: string;
  pathFor(owner: string, name: string): string;
  create(owner: string, name: string, opts?: { defaultBranch?: string }): Promise<string>;
  exists(owner: string, name: string): Promise<boolean>;
  remove(owner: string, name: string): Promise<void>;
}

export function createRepoStorage(root: string, opts?: { gitBin?: string }): RepoStorage {
  const resolvedRoot = path.resolve(root);
  const pathFor = (owner: string, name: string): string => {
    assertValidName(owner, 'owner');
    assertValidName(name, 'repository');
    const target = path.resolve(resolvedRoot, owner.toLowerCase(), `${name.toLowerCase()}.git`);
    const relative = path.relative(resolvedRoot, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppError('VALIDATION', 'Invalid repository path');
    }
    return target;
  };
  return {
    root: resolvedRoot,
    pathFor,
    async create(owner, name, options) {
      const target = pathFor(owner, name);
      const branch = parseInput(branchSchema, options?.defaultBranch ?? 'main');
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await mkdir(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw conflict('Repository already exists');
        throw new AppError('INTERNAL', 'Unable to create repository');
      }
      try {
        await execute(opts?.gitBin ?? 'git', ['init', '--bare', `--initial-branch=${branch}`, target]);
      } catch {
        await rm(target, { recursive: true, force: true });
        throw new AppError('INTERNAL', 'Unable to initialize repository');
      }
      return target;
    },
    async exists(owner, name) {
      try {
        return (await stat(pathFor(owner, name))).isDirectory();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    },
    async remove(owner, name) {
      await rm(pathFor(owner, name), { recursive: true, force: true });
    },
  };
}
