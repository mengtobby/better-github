import { ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type * as ChildProcessModule from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { serveGitHttp } from './smart-http.js';
import type { GitHttpOutcome } from './smart-http.js';
import { trackRequest } from './http-lifecycle.js';

const backend = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof ChildProcessModule>(), spawn: backend.spawn,
}));

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it.each(['idle', 'total'] as const)('errors an unread response after exit on the %s timeout', async (mode) => {
  vi.useFakeTimers();
  const stdout = new PassThrough();
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(), stdout, stderr: new PassThrough(),
    kill: vi.fn(() => true),
  }) as ChildProcessWithoutNullStreams;
  backend.spawn.mockReturnValue(child);
  const outcomes: GitHttpOutcome[] = [];
  const abort = new AbortController();
  const request = new Request('http://localhost/', { signal: abort.signal });
  const removeAbort = vi.spyOn(request.signal, 'removeEventListener');
  child.stdout.once('close', () => child.emit('close', 0, null));
  const responsePending = serveGitHttp(request, {
    projectRoot: '.', relativePath: 'a/b.git/info/refs',
    timeoutMs: mode === 'total' ? 100 : 1000,
    idleTimeoutMs: mode === 'idle' ? 100 : 1000,
    onComplete: (outcome) => { outcomes.push(outcome); },
  });
  stdout.write('Content-Type: application/octet-stream\r\n\r\nbody');
  const response = await responsePending;
  child.emit('exit', 0, null);
  expect(vi.getTimerCount()).toBe(2);
  await vi.advanceTimersByTimeAsync(100);
  await expect(response.text()).rejects.toMatchObject({
    code: 'UNPROCESSABLE', message: 'Git request timed out',
  });
  expect(child.stdout.destroyed).toBe(true);
  expect(outcomes).toEqual([{ exitCode: 0, aborted: false, timedOut: true, bytesOut: 4 }]);
  expect(vi.getTimerCount()).toBe(0);
  expect(child.listenerCount('error')).toBe(0);
  expect(child.listenerCount('exit')).toBe(0);
  expect(child.listenerCount('close')).toBe(0);
  expect(removeAbort).toHaveBeenCalledWith('abort', expect.any(Function));
  await vi.advanceTimersByTimeAsync(1000);
  expect(outcomes).toHaveLength(1);
});

it('resets idle timeout on output after exit and clears timers when the body finishes', async () => {
  vi.useFakeTimers();
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
  }) as ChildProcessWithoutNullStreams;
  const outcomes: GitHttpOutcome[] = [];
  const tracker = trackRequest(child, new Request('http://localhost/'), {
    projectRoot: '.', relativePath: 'a/b', onComplete: (outcome) => { outcomes.push(outcome); },
  }, 1000, 100);
  child.emit('exit', 0, null);
  await vi.advanceTimersByTimeAsync(75);
  tracker.output(4);
  await vi.advanceTimersByTimeAsync(75);
  expect(tracker.signal.aborted).toBe(false);
  expect(vi.getTimerCount()).toBe(2);
  tracker.finish();
  tracker.progress();
  expect(vi.getTimerCount()).toBe(0);
  expect(child.stdout.listenerCount('close')).toBe(0);
  child.emit('close', 0, null);
  tracker.finish();
  expect(outcomes).toEqual([{ exitCode: 0, aborted: false, timedOut: false, bytesOut: 4 }]);
});
