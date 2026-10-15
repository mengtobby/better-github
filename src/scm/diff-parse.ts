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

export function splitDiffOutput(output: string, maxFiles: number): { readonly raw: ReturnType<typeof parseRaw>; readonly patch: string; readonly truncated: boolean } {
  let cursor = 0, count = 0;
  const records: string[] = [];
  while (output[cursor] === ':') {
    const start = cursor, headerEnd = output.indexOf('\0', cursor);
    if (headerEnd < 0) return { raw: parseRaw(records.join('')), patch: '', truncated: true };
    const renamed = / [RC]\d*$/u.test(output.slice(cursor, headerEnd));
    cursor = headerEnd + 1;
    for (let paths = renamed ? 2 : 1; paths > 0; paths--) {
      const end = output.indexOf('\0', cursor);
      if (end < 0) return { raw: parseRaw(records.join('')), patch: '', truncated: true };
      cursor = end + 1;
    }
    if (count++ < maxFiles) records.push(output.slice(start, cursor));
  }
  return { raw: parseRaw(records.join('')), patch: output.slice(output[cursor] === '\0' ? cursor + 1 : cursor), truncated: count > maxFiles };
}

// Git still C-quotes patch headers with -z; encode each retained path once.
function patchPath(path: string): string {
  const escapes: Readonly<Record<number, string>> = { 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r', 34: '\\"', 92: '\\\\' };
  const bytes = Buffer.from(path);
  if (!bytes.some(byte => byte < 32 || byte >= 127 || byte === 34 || byte === 92)) return path;
  return '"' + Array.from(bytes, byte => escapes[byte] ?? (byte < 32 || byte >= 127 ? '\\' + byte.toString(8).padStart(3, '0') : String.fromCharCode(byte))).join('') + '"';
}

export function matchPatches(raw: readonly Pick<DiffFile, 'oldPath' | 'newPath' | 'status'>[], patch: string, maxLines: number): { readonly files: readonly DiffFile[]; readonly truncated: boolean } {
  const sections = new Map<string, string[]>();
  const header = (file: Pick<DiffFile, 'oldPath' | 'newPath'>): string => 'diff --git a/' + (file.oldPath ?? file.newPath) + ' b/' + (file.newPath ?? file.oldPath);
  for (const file of raw) {
    const bodies: string[] = [];
    sections.set(header(file), bodies);
    sections.set('diff --git ' + patchPath('a/' + (file.oldPath ?? file.newPath)) + ' ' + patchPath('b/' + (file.newPath ?? file.oldPath)), bodies);
  }
  let current: string[] | undefined;
  let body: string[] = [];
  const flush = (): void => { if (current) current.push(body.join('\n')); body = []; };
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const truncated = lines.length > maxLines;
  for (const line of lines.slice(0, maxLines)) {
    if (line.startsWith('diff --git ')) { flush(); current = sections.get(line); }
    else if (current) body.push(line);
  }
  flush();
  const files = raw.map(file => {
    const patches = sections.get(header(file))!.map(parsePatch);
    return { ...file, hunks: patches.flatMap(part => part.hunks), binary: patches.some(part => part.binary), additions: patches.reduce((sum, part) => sum + part.additions, 0), deletions: patches.reduce((sum, part) => sum + part.deletions, 0) };
  });
  return { files, truncated };
}
