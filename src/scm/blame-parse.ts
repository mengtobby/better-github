import type { BlameRange } from './types.js';
export function parseBlame(text: string): readonly BlameRange[] {
  const result: BlameRange[] = [];
  let sha = '', startLine = 0, author = '', authorTime = '', summary = '';
  for (const line of text.split('\n')) {
    const header = /^([\da-f]{40,64}) \d+ (\d+)(?: \d+)?$/u.exec(line);
    if (header) { sha = header[1]!; startLine = Number(header[2]); }
    else if (line.startsWith('author ')) author = line.slice(7);
    else if (line.startsWith('author-time ')) authorTime = new Date(Number(line.slice(12)) * 1000).toISOString();
    else if (line.startsWith('summary ')) summary = line.slice(8);
    else if (line.startsWith('\t')) {
      const last = result.at(-1);
      if (last && last.sha === sha && last.startLine + last.lineCount === startLine) result[result.length - 1] = { ...last, lineCount: last.lineCount + 1 };
      else result.push({ sha, startLine, lineCount: 1, author, authorTime, summary });
    }
  }
  return result;
}
