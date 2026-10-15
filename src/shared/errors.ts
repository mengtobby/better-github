/**
 * Application error model. Every layer throws AppError (never bare Error) for
 * expected failures; the HTTP layer maps `code` to a status and an envelope.
 */

export type ErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNPROCESSABLE'
  | 'INTERNAL';

export const ERROR_STATUS: Readonly<Record<ErrorCode, number>> = Object.freeze({
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
});

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export const validationError = (message: string, details?: unknown): AppError =>
  new AppError('VALIDATION', message, details);
export const unauthorized = (message = 'Authentication required'): AppError =>
  new AppError('UNAUTHORIZED', message);
export const forbidden = (message = 'Not allowed'): AppError => new AppError('FORBIDDEN', message);
export const notFound = (what: string): AppError => new AppError('NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: unknown): AppError =>
  new AppError('CONFLICT', message, details);

/** Safe message extraction for unknown thrown values. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}
