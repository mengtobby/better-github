import { validationError } from '../shared/errors.js';

export const NAME_PATTERN: RegExp = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name) && !name.includes('..') && !name.toLowerCase().endsWith('.git');
}

export function assertValidName(name: string, what: 'owner' | 'repository'): void {
  if (!isValidName(name)) throw validationError(`Invalid ${what} name`);
}
