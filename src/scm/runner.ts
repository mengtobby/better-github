import { spawn } from 'node:child_process';
import { AppError } from '../shared/errors.js';
export interface RunOptions { readonly cwd?: string; readonly input?: string | Buffer; readonly env?: Readonly<Record<string, string>>; readonly maxBytes?: number; readonly truncateAt?: number; readonly timeoutMs?: number; readonly allowExitCodes?: readonly number[] }
export interface RunResult { readonly stdout: Buffer; readonly stderr: string; readonly exitCode: number; readonly truncated: boolean }
export interface GitRunner { run(args: readonly string[], opts?: RunOptions): Promise<RunResult> }
export function childEnv(extra?: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'GIT_EXEC_PATH']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, GIT_TERMINAL_PROMPT: '0', ...extra };
}
export function createGitRunner(gitBin = 'git'): GitRunner {
  return { run(args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(gitBin, [...args], { cwd: opts.cwd, env: childEnv(opts.env), windowsHide: true });
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      let stderr = '';
      let failure: AppError | undefined;
      const timer = setTimeout(() => { failure = new AppError('INTERNAL', 'Git operation timed out'); child.kill(); }, opts.timeoutMs ?? 30_000);
      child.stdout.on('data', (chunk: Buffer) => {
        if (truncated || failure) return;
        if (opts.truncateAt !== undefined && size + chunk.length >= opts.truncateAt) {
          chunks.push(Buffer.from(chunk.subarray(0, Math.max(0, opts.truncateAt - size))));
          size = opts.truncateAt; truncated = true; child.kill(); return;
        }
        size += chunk.length;
        if (size > (opts.maxBytes ?? opts.truncateAt ?? 32 * 1024 * 1024)) { failure = new AppError('PAYLOAD_TOO_LARGE', 'Git output exceeds limit'); child.kill(); }
        else chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-65536); });
      child.on('error', () => { clearTimeout(timer); reject(new AppError('INTERNAL', 'Git operation failed')); });
      child.stdin.on('error', () => { /* Closing stdin early is handled by the process exit code. */ });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failure) reject(failure);
        else if (!truncated && code !== 0 && !opts.allowExitCodes?.includes(code ?? -1)) reject(new AppError('INTERNAL', 'Git operation failed'));
        else resolve({ stdout: Buffer.concat(chunks), stderr, exitCode: code ?? -1, truncated });
      });
      child.stdin.end(opts.input);
    });
  } };
}

