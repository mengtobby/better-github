import path from 'node:path';
import type { GitHttpOptions } from './smart-http.js';

export function gitHttpEnvironment(request: Request, opts: GitHttpOptions): NodeJS.ProcessEnv {
  const inherited: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT',
    'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'GIT_EXEC_PATH']) {
    if (process.env[key] !== undefined) inherited[key] = process.env[key];
  }
  return {
    ...inherited,
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

