import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.js';
import { parseInput } from '../shared/http.js';
import { gitHttpEnvironment } from './http-environment.js';
import { trackRequest, type GitRequestTracker } from './http-lifecycle.js';
import { isValidName } from './names.js';

export type GitService = 'git-upload-pack' | 'git-receive-pack';
export interface GitRoute {
  readonly owner: string;
  readonly name: string;
  readonly service: GitService;
  readonly kind: 'advertise' | 'rpc';
}

export function parseGitPath(pathname: string, method: string, query: URLSearchParams): GitRoute | null {
  const match = /^\/([^/]+)\/([^/]+)\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/.exec(pathname);
  if (!match) return null;
  const [, owner = '', name = '', endpoint] = match;
  if (!isValidName(owner) || !isValidName(name)) return null;
  const service = endpoint === 'info/refs' ? query.get('service') : endpoint;
  if (service !== 'git-upload-pack' && service !== 'git-receive-pack') return null;
  const kind = endpoint === 'info/refs' ? 'advertise' : 'rpc';
  if (method !== (kind === 'advertise' ? 'GET' : 'POST')) return null;
  return { owner, name, service, kind };
}

export interface GitHttpOutcome {
  readonly exitCode: number | null;
  readonly aborted: boolean;
  readonly timedOut: boolean;
  readonly bytesOut: number;
}

export interface GitHttpOptions {
  readonly timeoutMs?: number;
  readonly idleTimeoutMs?: number;
  readonly onComplete?: (outcome: GitHttpOutcome) => void;
  readonly projectRoot: string;
  readonly relativePath: string;
  readonly remoteUser?: string;
  readonly remoteAddr?: string;
  readonly gitBin?: string;
  readonly maxBodyBytes?: number;
  readonly env?: Readonly<Record<string, string>>;
}

const relativeSchema = z.string().min(1).refine((value) =>
  !value.startsWith('-') && !path.isAbsolute(value) && !value.includes('\\')
  && [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
  && value.split('/').every((segment) => segment !== '..' && segment !== '.' && segment !== ''));
const internal = (): AppError => new AppError('INTERNAL', 'Git transport failed');
const tooLarge = (): AppError => new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large');


async function writeBody(request: Request, child: ChildProcessWithoutNullStreams, limit: number, tracker: GitRequestTracker): Promise<void> {
  const reader = request.body?.getReader();
  const cancel = (): void => { void reader?.cancel().catch(() => {}); };
  tracker.signal.addEventListener('abort', cancel, { once: true });
  if (tracker.signal.aborted) cancel();
  let size = 0;
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        tracker.progress();
        size += value.byteLength;
        if (size > limit) throw tooLarge();
        await new Promise<void>((resolve, reject) => {
          child.stdin.write(value, (error) => error ? reject(internal()) : resolve());
        });
      }
    }
    child.stdin.end();
  } catch (error) {
    await reader?.cancel().catch(() => {});
    throw error;
  } finally {
    tracker.signal.removeEventListener('abort', cancel);
    reader?.releaseLock();
  }
}

function parseHeaders(block: string): { status: number; headers: Headers } {
  const headers = new Headers();
  let status = 200;
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 1) throw internal();
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).trim();
    if (name.toLowerCase() === 'status') {
      status = Number(value.split(' ')[0]);
      if (!Number.isInteger(status) || status < 200 || status > 599) throw internal();
    } else headers.append(name, value);
  }
  return { status, headers };
}

async function readResponse(child: ChildProcessWithoutNullStreams, tracker: GitRequestTracker): Promise<Response> {
  const iterator = child.stdout[Symbol.asyncIterator]();
  let buffer = Buffer.alloc(0);
  while (true) {
    const item = await iterator.next();
    if (item.done) throw internal();
    tracker.progress();
    buffer = Buffer.concat([buffer, item.value as Buffer]);
    const match = /\r?\n\r?\n/.exec(buffer.toString('latin1'));
    if (!match) {
      if (buffer.length > 65536) throw internal();
      continue;
    }
    const { status, headers } = parseHeaders(buffer.subarray(0, match.index).toString('latin1'));
    const initial = buffer.subarray(match.index + match[0].length);
    let responseAbort: () => void = () => {};
    const detach = (): void => tracker.signal.removeEventListener('abort', responseAbort);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        responseAbort = (): void => {
          detach();
          if (tracker.signal.reason instanceof AppError) controller.error(tracker.signal.reason);
        };
        tracker.signal.addEventListener('abort', responseAbort, { once: true });
        if (tracker.signal.aborted) responseAbort();
        else if (initial.length) { tracker.output(initial.length); controller.enqueue(initial); }
      },
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) { detach(); tracker.finish(); controller.close(); }
          else { tracker.output((next.value as Buffer).length); controller.enqueue(next.value as Buffer); }
        } catch (error) { detach(); tracker.finish(); controller.error(error instanceof AppError ? error : internal()); }
      },
      cancel() { detach(); tracker.stop(new AppError('UNPROCESSABLE', 'Git request aborted')); },
    });
    if (status === 204 || status === 304) void body.cancel();
    return new Response(status === 204 || status === 304 ? null : body, { status, headers });
  }
}

export async function serveGitHttp(request: Request, opts: GitHttpOptions): Promise<Response> {
  parseInput(relativeSchema, opts.relativePath);
  const limit = parseInput(z.number().int().nonnegative(), opts.maxBodyBytes ?? 512 * 1024 * 1024);
  const timeoutMs = parseInput(z.number().int().positive().max(2147483647), opts.timeoutMs ?? 600000);
  const idleTimeoutMs = parseInput(z.number().int().positive().max(2147483647), opts.idleTimeoutMs ?? 60000);
  const length = request.headers.get('content-length');
  if (length !== null) {
    parseInput(z.string().regex(/^\d+$/), length);
    if (Number(length) > limit) throw tooLarge();
  }
  const child = spawn(opts.gitBin ?? 'git', ['http-backend'], { env: gitHttpEnvironment(request, opts) });
  child.stderr.resume();
  // Consume stdin errors even when git closes the pipe before the upload ends.
  child.stdin.on('error', () => {});
  const tracker = trackRequest(child, request, opts, timeoutMs, idleTimeoutMs);
  try {
    const [response] = await Promise.race([
      Promise.all([readResponse(child, tracker), writeBody(request, child, limit, tracker)]),
      tracker.failure,
    ]);
    return response;
  } catch (error) {
    tracker.stop(error instanceof AppError ? error : internal());
    if (error instanceof AppError) throw error;
    throw internal();
  }
}
