import type { DiffFile, DiffHunk, DiffLine } from './types.js';
export function parsePatch(patch: string): Pick<DiffFile, 'hunks' | 'binary' | 'additions' | 'deletions'> {
  const hunks: DiffHunk[] = [];
  let lines: DiffLine[] = [];
  let oldLine = 0, newLine = 0, additions = 0, deletions = 0;
  for (const line of patch.split('\n')) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line);
    if (match) {
      oldLine = Number(match[1]); newLine = Number(match[3]); lines = [];
      hunks.push({ header: line, oldStart: oldLine, oldLines: Number(match[2] ?? 1), newStart: newLine, newLines: Number(match[4] ?? 1), lines });
    } else if (hunks.length && /^[ +-]/u.test(line)) {
      const kind = line[0];
      lines.push({ type: kind === '+' ? 'add' : kind === '-' ? 'del' : 'context', content: line.slice(1), oldLine: kind === '+' ? null : oldLine++, newLine: kind === '-' ? null : newLine++ });
      if (kind === '+') additions++;
      if (kind === '-') deletions++;
    }
  }
  return { hunks, binary: /^(Binary files .* differ|GIT binary patch)$/mu.test(patch), additions, deletions };
}
export function parseRaw(raw: string): readonly Pick<DiffFile, 'oldPath' | 'newPath' | 'status'>[] {
  const parts = raw.split('\0');
  const result: Pick<DiffFile, 'oldPath' | 'newPath' | 'status'>[] = [];
  for (let i = 0; i < parts.length - 1;) {
    const header = parts[i++] ?? '';
    const status = header.split(' ').at(-1)?.[0];
    const first = parts[i++] ?? '';
    const second = status === 'R' || status === 'C' ? parts[i++] ?? '' : first;
    const names = { A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type-changed', M: 'modified' } as const;
    result.push({ oldPath: status === 'A' ? null : first, newPath: status === 'D' ? null : second, status: names[status as keyof typeof names] ?? 'modified' });
  }
  return result;
}


function decodePath(value: string): string {
  if (!value.startsWith('"')) return value;
  const bytes: number[] = [];
  const escapes: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };
  for (let i = 1; i < value.length - 1; i++) {
    if (value[i] !== '\\') bytes.push(...Buffer.from(value[i]!));
    else {
      const octal = /^[0-7]{1,3}/u.exec(value.slice(i + 1));
      if (octal) { bytes.push(parseInt(octal[0], 8)); i += octal[0].length; }
      else { bytes.push(escapes[value[++i]!] ?? 63); }
    }
  }
  return Buffer.from(bytes).toString();
}
function matchesHeader(header: string, file: Pick<DiffFile, 'oldPath' | 'newPath'>): boolean {
  for (let i = 0; i < header.length; i++) {
    if (header[i] !== ' ') continue;
    const oldPath = decodePath(header.slice(0, i)), newPath = decodePath(header.slice(i + 1));
    if (oldPath === `a/${file.oldPath ?? file.newPath}` && newPath === `b/${file.newPath ?? file.oldPath}`) return true;
  }
  return false;
}
export function matchPatches(raw: readonly Pick<DiffFile, 'oldPath' | 'newPath' | 'status'>[], patch: string, maxLines: number): { readonly files: readonly DiffFile[]; readonly truncated: boolean } {
  const allLines = patch.split('\n');
  if (allLines.at(-1) === '') allLines.pop();
  const truncated = allLines.length > maxLines;
  const sections = allLines.slice(0, maxLines).join('\n').split(/^diff --git /mu).slice(1);
  const files = raw.map(file => {
    const patches = sections.filter(section => matchesHeader(section.split('\n')[0]!, file)).map(parsePatch);
    return { ...file, hunks: patches.flatMap(part => part.hunks), binary: patches.some(part => part.binary), additions: patches.reduce((sum, part) => sum + part.additions, 0), deletions: patches.reduce((sum, part) => sum + part.deletions, 0) };
  });
  return { files, truncated };
}
