import { spawn } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { trackRequest } from './http-lifecycle.js';
import type { GitHttpOutcome } from './smart-http.js';

const children: ReturnType<typeof spawn>[] = [];
afterEach(() => { for (const child of children.splice(0)) child.kill('SIGKILL'); });

it.each(['idle', 'total', 'abort'] as const)('kills a child on %s and reports completion once', async (mode) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  children.push(child);
  const abort = new AbortController();
  const outcomes: GitHttpOutcome[] = [];
  const tracker = trackRequest(child, new Request('http://localhost/', { signal: abort.signal }),
    { projectRoot: '.', relativePath: 'a/b', onComplete: (outcome) => { outcomes.push(outcome); } },
    mode === 'total' ? 30 : 5000, mode === 'idle' ? 30 : 5000);
  child.stdout.on('error', () => {});
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
  if (mode === 'abort') abort.abort();
  await expect(tracker.failure).rejects.toMatchObject({ code: 'UNPROCESSABLE',
    message: mode === 'abort' ? 'Git request aborted' : 'Git request timed out' });
  await closed;
  expect(outcomes).toEqual([expect.objectContaining({ aborted: mode === 'abort',
    timedOut: mode !== 'abort', bytesOut: 0 })]);
  tracker.finish();
  expect(outcomes).toHaveLength(1);
});

it('waits for both response consumption and successful child exit, ignoring observer errors', async () => {
  const child = spawn(process.execPath, ['-e', 'process.stdout.write("ok")']);
  children.push(child);
  const outcomes: GitHttpOutcome[] = [];
  const tracker = trackRequest(child, new Request('http://localhost/'),
    { projectRoot: '.', relativePath: 'a/b', onComplete: (outcome) => {
      outcomes.push(outcome);
      throw new Error('observer');
    } }, 5000, 5000);
  child.stdout.on('data', (data: Buffer) => tracker.output(data.length));
  await new Promise<void>((resolve) => child.once('close', () => resolve()));
  expect(outcomes).toHaveLength(0);
  tracker.finish();
  tracker.finish();
  expect(outcomes).toEqual([{ exitCode: 0, aborted: false, timedOut: false, bytesOut: 2 }]);
});
