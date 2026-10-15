import { mkdir } from 'node:fs/promises';
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createStore } from './db/store.js';
import { createRepoStorage } from './git/storage.js';
import { createGitRunner } from './scm/runner.js';
import { createScm } from './scm/scm.js';
import { createTokenService } from './auth/tokens.js';
import { createApp } from './api/app.js';

const config = loadConfig(process.env);
await mkdir(config.dataDir, { recursive: true });
const db = openDatabase(config.dbPath), store = createStore(db);
const app = createApp({ config, store, storage: createRepoStorage(config.reposDir, { gitBin: config.gitBin }),
  scm: createScm(createGitRunner(config.gitBin)), tokens: createTokenService(store) });
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, () => console.warn(`Listening on ${config.publicUrl}`));
let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  server.close(() => { db.close(); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
