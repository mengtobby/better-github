import path from 'node:path';
import { z } from 'zod';

export interface Config {
  readonly host: string; readonly port: number; readonly dataDir: string;
  readonly dbPath: string; readonly reposDir: string; readonly gitBin: string;
  readonly publicUrl: string; readonly rateLimitPerMinute: number; readonly authRateLimitPerMinute: number;
}
const positive = z.coerce.number().int().positive().safe();
const schema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'), PORT: positive.max(65535).default(3000),
  DATA_DIR: z.string().min(1).default('./data'), GIT_BIN: z.string().min(1).default('git'),
  PUBLIC_URL: z.string().refine(value => {
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }).optional(),
  RATE_LIMIT_PER_MINUTE: positive.default(600), AUTH_RATE_LIMIT_PER_MINUTE: positive.default(20),
});
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const result = schema.safeParse(env);
  if (!result.success) throw new Error(`Invalid configuration: ${[...new Set(result.error.issues.map(issue => issue.path[0]))].join(', ')}`);
  const v = result.data, dataDir = path.resolve(v.DATA_DIR);
  const host = v.HOST.includes(':') ? `[${v.HOST}]` : v.HOST;
  return Object.freeze({ host: v.HOST, port: v.PORT, dataDir, dbPath: path.join(dataDir, 'forge.db'),
    reposDir: path.join(dataDir, 'repos'), gitBin: v.GIT_BIN,
    publicUrl: (v.PUBLIC_URL ?? `http://${host}:${v.PORT}`).replace(/\/$/u, ''),
    rateLimitPerMinute: v.RATE_LIMIT_PER_MINUTE, authRateLimitPerMinute: v.AUTH_RATE_LIMIT_PER_MINUTE });
}
