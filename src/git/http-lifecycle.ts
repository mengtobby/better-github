import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { AppError } from '../shared/errors.js';
import type { GitHttpOptions } from './smart-http.js';

export interface GitRequestTracker {
  readonly failure: Promise<never>;
  readonly signal: AbortSignal;
  readonly progress: () => void;
  readonly finish: () => void;
  readonly stop: (error: AppError) => void;
  readonly output: (size: number) => void;
}

export function trackRequest(child: ChildProcessWithoutNullStreams, request: Request,
  opts: GitHttpOptions, timeoutMs: number, idleTimeoutMs: number): GitRequestTracker {
  let exitCode: number | null = null;
  let exited = false;
  let finished = false;
  let completed = false;
  let aborted = false;
  let timedOut = false;
  let bytesOut = 0;
  let stopped = false;
  const cancellation = new AbortController();
  let rejectFailure: (error: AppError) => void = () => {};
  const failure = new Promise<never>((_resolve, reject) => { rejectFailure = reject; });
  void failure.catch(() => {});
  const complete = (): void => {
    if (!exited || !finished || completed) return;
    completed = true;
    try { opts.onComplete?.({ exitCode, aborted, timedOut, bytesOut }); } catch { /* Observer only. */ }
  };
  const finish = (): void => { finished = true; cleanup(); complete(); };
  const stop = (error: AppError): void => {
    if (stopped) return;
    stopped = true;
    rejectFailure(error);
    cancellation.abort(error);
    child.kill('SIGKILL');
    child.stdout.destroy(error);
    finish();
  };
  const abort = (): void => { aborted = true; stop(new AppError('UNPROCESSABLE', 'Git request aborted')); };
  const timeout = (): void => { timedOut = true; stop(new AppError('UNPROCESSABLE', 'Git request timed out')); };
  const totalTimer = setTimeout(timeout, timeoutMs);
  let idleTimer = setTimeout(timeout, idleTimeoutMs);
  const progress = (): void => {
    if (finished || stopped || child.stdout.closed) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(timeout, idleTimeoutMs);
  };
  const cleanup = (): void => {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
    request.signal.removeEventListener('abort', abort);
    child.stdout.removeListener('close', cleanup);
  };
  const childError = (): void => { stop(new AppError('INTERNAL', 'Git transport failed')); };
  child.once('error', childError);
  child.stdout.once('close', cleanup);
  child.once('close', (code) => {
    exitCode = code;
    exited = true;
    cleanup();
    child.removeListener('error', childError);
    if (code !== 0 && !cancellation.signal.aborted) stop(new AppError('INTERNAL', 'Git transport failed'));
    cancellation.abort();
    complete();
  });
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  return { failure, signal: cancellation.signal, progress, finish, stop,
    output: (size: number): void => { bytesOut += size; progress(); } };
}
