import { z } from 'zod';
import { isAbsolute } from 'node:path';
import { parseInput } from '../shared/http.js';
import { validationError } from '../shared/errors.js';
export function assertSafeRef(ref: string): void {
  parseInput(z.string().min(1), ref);
  if (ref.startsWith('-') || ref.includes('..') || ref.includes('@{') || (hasControl(ref) || /[ ~^:?*[\\]/u.test(ref)) || ref.endsWith('.lock') || ref.endsWith('/') || ref.startsWith('/')) throw validationError('Invalid Git reference');
}
export function assertSafePath(path: string): string {
  parseInput(z.string(), path);
  const normalized = path.replaceAll('\\', '/');
  if (normalized.startsWith('/') || normalized.startsWith('-') || /^[A-Za-z]:/u.test(normalized) || normalized.split('/').includes('..') || hasControl(normalized)) throw validationError('Invalid repository path');
  return normalized;
}
export function assertRepo(repo: string): void {
  parseInput(z.string().min(1), repo);
  if (!isAbsolute(repo) || hasControl(repo)) throw validationError('Repository path must be absolute');
}

export function hasControl(value: string): boolean { return [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127); }

