import { afterEach, expect, it, vi } from 'vitest';
import { gitHttpEnvironment } from './http-environment.js';

afterEach(() => { vi.unstubAllEnvs(); });

it('only inherits allowed environment variables before adding explicit CGI settings and overrides', () => {
  vi.stubEnv('SECRET_X', 'secret');
  vi.stubEnv('GIT_TRACE', 'secret-path');
  vi.stubEnv('GIT_CONFIG_COUNT', '999');
  vi.stubEnv('GIT_EXEC_PATH', 'allowed');
  const env = gitHttpEnvironment(new Request('http://localhost/'), {
    projectRoot: '.', relativePath: 'a/b', env: { LANG: 'C' },
  });
  expect(env.SECRET_X).toBeUndefined();
  expect(env.GIT_TRACE).toBeUndefined();
  expect(env.GIT_CONFIG_COUNT).toBe('1');
  expect(env.GIT_EXEC_PATH).toBe('allowed');
  expect(env.LANG).toBe('C');
});
