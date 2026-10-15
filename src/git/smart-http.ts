import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import { AppError } from '../shared/errors.js';
import { parseInput } from '../shared/http.js';
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

export interface GitHttpOptions {
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

function environment(request: Request, opts: GitHttpOptions): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_PROJECT_ROOT: path.resolve(opts.projectRoot),
    PATH_INFO: `/${opts.relativePath}`,
    REQUEST_METHOD: request.method,
    QUERY_STRING: new URL(request.url).search.slice(1),
    CONTENT_TYPE: request.headers.get('content-type') ?? '',
    ...(request.headers.has('content-length') ? { CONTENT_LENGTH: request.headers.get('content-length')! } : {}),
    HTTP_CONTENT_ENCODING: request.headers.get('content-encoding') ?? '',
    GIT_PROTOCOL: request.headers.get('git-protocol') ?? '',
    REMOTE_USER: opts.remoteUser ?? '',
    REMOTE_ADDR: opts.remoteAddr ?? '',
    GIT_HTTP_EXPORT_ALL: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.receivepack',
    GIT_CONFIG_VALUE_0: 'true',
    ...opts.env,
  };
}

async function writeBody(request: Request, child: ChildProcessWithoutNullStreams, limit: number): Promise<void> {
  const reader = request.body?.getReader();
  let size = 0;
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
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

async function readResponse(child: ChildProcessWithoutNullStreams): Promise<Response> {
  const iterator = child.stdout[Symbol.asyncIterator]();
  let buffer = Buffer.alloc(0);
  while (true) {
    const item = await iterator.next();
    if (item.done) throw internal();
    buffer = Buffer.concat([buffer, item.value as Buffer]);
    const match = /\r?\n\r?\n/.exec(buffer.toString('latin1'));
    if (!match) {
      if (buffer.length > 65536) throw internal();
      continue;
    }
    const { status, headers } = parseHeaders(buffer.subarray(0, match.index).toString('latin1'));
    const initial = buffer.subarray(match.index + match[0].length);
    const body = new ReadableStream<Uint8Array>({
      start(controller) { if (initial.length) controller.enqueue(initial); },
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) controller.close();
          else controller.enqueue(next.value as Buffer);
        } catch { controller.error(internal()); }
      },
      cancel() { child.kill(); },
    });
    return new Response(status === 204 || status === 304 ? null : body, { status, headers });
  }
}

export async function serveGitHttp(request: Request, opts: GitHttpOptions): Promise<Response> {
  parseInput(relativeSchema, opts.relativePath);
  const limit = parseInput(z.number().int().nonnegative(), opts.maxBodyBytes ?? 512 * 1024 * 1024);
  const length = request.headers.get('content-length');
  if (length !== null) {
    parseInput(z.string().regex(/^\d+$/), length);
    if (Number(length) > limit) throw tooLarge();
  }
  const child = spawn(opts.gitBin ?? 'git', ['http-backend'], { env: environment(request, opts) });
  child.stderr.resume();
  // Consume stdin errors even when git closes the pipe before the upload ends.
  child.stdin.on('error', () => {});
  const failure = new Promise<never>((_resolve, reject) => {
    child.once('error', () => reject(internal()));
    child.once('exit', (code) => { if (code !== 0) reject(internal()); });
  });
  try {
    const [response] = await Promise.race([
      Promise.all([readResponse(child), writeBody(request, child, limit)]),
      failure,
    ]);
    return response;
  } catch (error) {
    child.kill();
    if (error instanceof AppError) throw error;
    throw internal();
  }
}
