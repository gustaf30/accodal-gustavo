import { Request, Response, NextFunction } from 'express';
import { getSupabaseClient } from '../config/database';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: Record<string, unknown>;
}

export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    code: err.code,
    path: req.path,
    method: req.method,
  });

  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_ERROR';

  // Log error to database
  logErrorToDatabase(err, req).catch(console.error);

  // Don't expose internal errors in production
  const message =
    process.env.NODE_ENV === 'production' && statusCode === 500
      ? 'An internal error occurred'
      : err.message;

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message,
      details: err.details,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] || undefined,
    },
  });
}

async function logErrorToDatabase(err: AppError, req: Request): Promise<void> {
  try {
    const supabase = getSupabaseClient();

    await supabase.from('error_notifications').insert({
      resource_type: 'api',
      severity: err.statusCode && err.statusCode < 500 ? 'WARN' : 'ERROR',
      message: err.message,
      details: {
        code: err.code,
        stack: err.stack,
        path: req.path,
        method: req.method,
        headers: sanitizeHeaders(req.headers),
        query: req.query,
        body: sanitizeBody(req.body),
      },
      notification_channels: ['database'],
    });
  } catch (logError) {
    console.error('Failed to log error to database:', logError);
  }
}

function sanitizeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...headers };
  // Remove sensitive headers
  delete sanitized.authorization;
  delete sanitized['x-api-key'];
  delete sanitized.cookie;
  return sanitized;
}

function sanitizeBody(body: Record<string, unknown>): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};

  const sanitized = { ...body };
  // Remove potentially sensitive fields
  const sensitiveFields = ['password', 'token', 'secret', 'api_key', 'ssn', 'tax_id'];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  // Truncate large fields
  for (const [key, value] of Object.entries(sanitized)) {
    if (typeof value === 'string' && value.length > 1000) {
      sanitized[key] = value.substring(0, 1000) + '...[truncated]';
    }
  }

  return sanitized;
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      timestamp: new Date().toISOString(),
    },
  });
}

export function createError(
  message: string,
  statusCode: number = 500,
  code?: string,
  details?: Record<string, unknown>
): AppError {
  const error = new Error(message) as AppError;
  error.statusCode = statusCode;
  error.code = code;
  error.details = details;
  return error;
}

// Common error creators
export const errors = {
  badRequest: (message: string, details?: Record<string, unknown>) =>
    createError(message, 400, 'BAD_REQUEST', details),

  unauthorized: (message: string = 'Unauthorized') =>
    createError(message, 401, 'UNAUTHORIZED'),

  forbidden: (message: string = 'Forbidden') =>
    createError(message, 403, 'FORBIDDEN'),

  notFound: (resource: string = 'Resource') =>
    createError(`${resource} not found`, 404, 'NOT_FOUND'),

  conflict: (message: string) =>
    createError(message, 409, 'CONFLICT'),

  tooManyRequests: (retryAfter?: number) =>
    createError('Too many requests', 429, 'RATE_LIMIT_EXCEEDED', { retryAfter }),

  internal: (message: string = 'Internal server error') =>
    createError(message, 500, 'INTERNAL_ERROR'),

  serviceUnavailable: (message: string = 'Service temporarily unavailable') =>
    createError(message, 503, 'SERVICE_UNAVAILABLE'),
};
