/**
 * HTTP glue shared by every route module: error → envelope mapping and
 * zod-based input parsing that throws AppError('VALIDATION').
 */
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { z } from 'zod';
import { fail } from './envelope.js';
import { AppError, isAppError, validationError } from './errors.js';

export interface ErrorLogger {
  error(message: string, context: Record<string, unknown>): void;
}

export const defaultLogger: ErrorLogger = {
  error: (message, context) => console.error(message, context),
};

/** Hono `app.onError` handler. Never leaks internals for non-AppError failures. */
export function createErrorHandler(logger: ErrorLogger = defaultLogger) {
  return (err: Error, c: Context): Response => {
    if (isAppError(err)) {
      for (const [name, value] of Object.entries(err.headers)) c.header(name, value);
      return c.json(fail(err.code, err.message, err.details), err.status as ContentfulStatusCode);
    }
    logger.error('unhandled error', {
      method: c.req.method,
      path: c.req.path,
      error: err.message,
      stack: err.stack,
    });
    return c.json(fail('INTERNAL', 'Internal server error'), 500);
  };
}

/** Parse untrusted input with a zod schema; throws AppError('VALIDATION') with issue details. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw validationError('Invalid input', issues);
  }
  return result.data;
}

/** Read and validate a JSON request body. */
export async function parseJsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError('VALIDATION', 'Request body must be valid JSON');
  }
  return parseInput(schema, body);
}
