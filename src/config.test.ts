import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { loadConfig } from './config.js';
describe('configuration', () => {
  it('loads defaults and derives paths', () => {
    const c = loadConfig({}); expect(c.port).toBe(3000); expect(c.publicUrl).toBe('http://127.0.0.1:3000');
    expect(c.dbPath).toBe(path.join(c.dataDir, 'forge.db'));
  });
  it('reports invalid keys together', () => {
    expect(() => loadConfig({ PORT: 'bad', RATE_LIMIT_PER_MINUTE: '0' })).toThrow(/PORT.*RATE_LIMIT_PER_MINUTE/u);
    expect(() => loadConfig({ PORT: 'bad', PUBLIC_URL: 'not a URL' })).toThrow(/PORT.*PUBLIC_URL/u);
    expect(() => loadConfig({ PUBLIC_URL: 'file:///secret' })).toThrow('PUBLIC_URL');
  });
  it('supports explicit values and IPv6', () => {
    expect(loadConfig({ HOST: '::1', PORT: '42' }).publicUrl).toBe('http://[::1]:42');
    expect(loadConfig({ PUBLIC_URL: 'https://forge.example/' }).publicUrl).toBe('https://forge.example');
  });
});
