import { spawn } from 'node:child_process';
import { AppError } from '../shared/errors.js';
export interface RunOptions { readonly cwd?: string; readonly input?: string | Buffer; readonly env?: Readonly<Record<string, string>>; readonly maxBytes?: number; readonly timeoutMs?: number; readonly allowExitCodes?: readonly number[] }
export interface RunResult { readonly stdout: Buffer; readonly stderr: string; readonly exitCode: number }
export interface GitRunner { run(args: readonly string[], opts?: RunOptions): Promise<RunResult> }
export function createGitRunner(gitBin = 'git'): GitRunner {
  return { run(args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(gitBin, [...args], { cwd: opts.cwd, env: { ...process.env, ...opts.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true });
      const chunks: Buffer[] = [];
      let size = 0;
      let stderr = '';
      let failure: AppError | undefined;
      const timer = setTimeout(() => { failure = new AppError('INTERNAL', 'Git operation timed out'); child.kill(); }, opts.timeoutMs ?? 30_000);
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > (opts.maxBytes ?? 32 * 1024 * 1024)) { failure = new AppError('PAYLOAD_TOO_LARGE', 'Git output exceeds limit'); child.kill(); }
        else chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-65536); });
      child.on('error', () => { clearTimeout(timer); reject(new AppError('INTERNAL', 'Git operation failed')); });
      child.stdin.on('error', () => { /* Closing stdin early is handled by the process exit code. */ });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (code !== 0 && !opts.allowExitCodes?.includes(code ?? -1)) reject(new AppError('INTERNAL', 'Git operation failed'));
        else resolve({ stdout: Buffer.concat(chunks), stderr, exitCode: code ?? -1 });
      });
      child.stdin.end(opts.input);
    });
  } };
}

