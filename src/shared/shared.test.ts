import { Hono, type Context } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { fixedClock, systemClock } from './clock.js';
import { fail, ok } from './envelope.js';
import {
  AppError,
  conflict,
  errorMessage,
  forbidden,
  isAppError,
  notFound,
  unauthorized,
  validationError,
} from './errors.js';
import { createErrorHandler, parseInput, parseJsonBody } from './http.js';
import { newId } from './ids.js';

describe('errors', () => {
  it('maps codes to HTTP statuses', () => {
    expect(validationError('x').status).toBe(400);
    expect(unauthorized().status).toBe(401);
    expect(forbidden().status).toBe(403);
    expect(notFound('Repo').message).toBe('Repo not found');
    expect(conflict('dup', { field: 'name' }).details).toEqual({ field: 'name' });
    expect(new AppError('RATE_LIMITED', 'slow down').status).toBe(429);
  });

  it('narrows unknown values', () => {
    expect(isAppError(notFound('x'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('nope')).toBe('Unexpected error');
  });
});

describe('envelope', () => {
  it('builds success and failure shapes', () => {
    expect(ok({ a: 1 })).toEqual({ success: true, data: { a: 1 }, error: null });
    expect(ok([], { total: 0, page: 1, limit: 20 }).meta).toEqual({ total: 0, page: 1, limit: 20 });
    expect(fail('NOT_FOUND', 'gone')).toEqual({
      success: false,
      data: null,
      error: { code: 'NOT_FOUND', message: 'gone' },
    });
    expect(fail('VALIDATION', 'bad', [1]).error.details).toEqual([1]);
  });
});

describe('ids', () => {
  it('generates prefixed unique ids', () => {
    const a = newId('usr');
    expect(a).toMatch(/^usr_[0-9a-z]{20}$/);
    expect(newId('usr')).not.toBe(a);
  });

  it('rejects bad prefixes', () => {
    expect(() => newId('Bad-1')).toThrow(/invalid id prefix/);
  });
});

describe('clock', () => {
  it('fixed clock advances only when told', () => {
    const clock = fixedClock('2026-01-01T00:00:00Z');
    expect(clock().toISOString()).toBe('2026-01-01T00:00:00.000Z');
    clock.advance(1000);
    expect(clock().toISOString()).toBe('2026-01-01T00:00:01.000Z');
    expect(systemClock()).toBeInstanceOf(Date);
  });
});

describe('http', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('parseInput returns data or throws VALIDATION with issues', () => {
    expect(parseInput(schema, { name: 'x' })).toEqual({ name: 'x' });
    try {
      parseInput(schema, { name: '' });
      expect.unreachable();
    } catch (error) {
      expect(isAppError(error) && error.code).toBe('VALIDATION');
      expect((error as AppError).details).toEqual([{ path: 'name', message: expect.any(String) }]);
    }
  });

  function appWith(handler: (c: Context) => Promise<Response> | Response) {
    const logger = { error: vi.fn() };
    const app = new Hono();
    app.onError(createErrorHandler(logger));
    app.post('/t', handler);
    return { app, logger };
  }

  it('maps AppError to its status and envelope', async () => {
    const { app } = appWith(() => {
      throw notFound('Thing');
    });
    const res = await app.request('/t', { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(fail('NOT_FOUND', 'Thing not found'));
  });

  it('hides internals of unexpected errors and logs them', async () => {
    const { app, logger } = appWith(() => {
      throw new Error('db password is hunter2');
    });
    const res = await app.request('/t', { method: 'POST' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('parseJsonBody validates JSON bodies', async () => {
    const { app } = appWith(async (c) => c.json(ok(await parseJsonBody(c, schema))));
    const good = await app.request('/t', { method: 'POST', body: JSON.stringify({ name: 'a' }) });
    expect(await good.json()).toEqual(ok({ name: 'a' }));
    const notJson = await app.request('/t', { method: 'POST', body: '{nope' });
    expect(notJson.status).toBe(400);
    const invalid = await app.request('/t', { method: 'POST', body: JSON.stringify({ name: 1 }) });
    expect(invalid.status).toBe(400);
  });
});
