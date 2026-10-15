/**
 * Consistent response envelope for every JSON API response.
 */
import type { ErrorCode } from './errors.js';

export interface PageMeta {
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

export interface ApiErrorBody {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: unknown;
}

export type ApiSuccess<T> = {
  readonly success: true;
  readonly data: T;
  readonly error: null;
  readonly meta?: PageMeta;
};

export type ApiFailure = {
  readonly success: false;
  readonly data: null;
  readonly error: ApiErrorBody;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T, meta?: PageMeta): ApiSuccess<T> {
  return meta === undefined
    ? { success: true, data, error: null }
    : { success: true, data, error: null, meta };
}

export function fail(code: ErrorCode, message: string, details?: unknown): ApiFailure {
  const error: ApiErrorBody = details === undefined ? { code, message } : { code, message, details };
  return { success: false, data: null, error };
}
