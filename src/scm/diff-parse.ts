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

