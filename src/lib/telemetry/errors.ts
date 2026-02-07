/**
 * Error Tracking
 *
 * Captures and reports errors for monitoring and debugging.
 * Integrates with external error tracking services.
 */

import type { LogContext } from './logger';

export interface ErrorEvent {
  id: string;
  timestamp: string;
  error: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
  context: LogContext;
  fingerprint?: string;
  handled: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface ErrorTrackingConfig {
  enabled: boolean;
  environment: string;
  release?: string;
  userId?: string;
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
}

// In-memory error storage (limited size)
const errorBuffer: ErrorEvent[] = [];
const MAX_ERROR_BUFFER = 100;

let config: ErrorTrackingConfig = {
  enabled: true,
  environment: import.meta.env.PUBLIC_ENVIRONMENT || 'production',
};

/**
 * Configure error tracking
 */
export function configureErrorTracking(newConfig: Partial<ErrorTrackingConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Generate error fingerprint for grouping
 */
function generateFingerprint(error: Error, context?: LogContext): string {
  const parts = [
    error.name,
    error.message.split(':')[0], // First part of message
    context?.path || '',
    context?.method || '',
  ];
  return parts
    .join('|')
    .replace(/[^a-zA-Z0-9|:-]/g, '')
    .toLowerCase();
}

/**
 * Capture an error event
 */
export function captureError(error: unknown, context: LogContext = {}, handled = true): string {
  if (!config.enabled) return '';

  // Normalize error
  let errorData: ErrorEvent['error'];

  if (error instanceof Error) {
    errorData = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as { code?: string }).code,
    };
  } else if (typeof error === 'string') {
    errorData = {
      name: 'Error',
      message: error,
    };
  } else if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    errorData = {
      name: (err.name as string) || 'Error',
      message: (err.message as string) || String(error),
      code: err.code as string,
    };
  } else {
    errorData = {
      name: 'Unknown',
      message: String(error),
    };
  }

  // Determine severity
  const severity =
    errorData.name === 'CriticalError' || errorData.code === 'CRITICAL'
      ? 'critical'
      : errorData.name === 'ValidationError'
        ? 'low'
        : errorData.name === 'AuthenticationError' || errorData.name === 'RateLimitError'
          ? 'medium'
          : 'high';

  const event: ErrorEvent = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    error: errorData,
    context: {
      ...context,
      environment: config.environment,
      release: config.release,
    },
    fingerprint: generateFingerprint(new Error(errorData.message), context),
    handled,
    severity,
  };

  // Allow modification before sending
  let finalEvent = event;
  if (config.beforeSend) {
    const modified = config.beforeSend(event);
    if (!modified) return '';
    finalEvent = modified;
  }

  // Add to buffer
  errorBuffer.push(finalEvent);
  if (errorBuffer.length > MAX_ERROR_BUFFER) {
    errorBuffer.shift();
  }

  // Log error
  if (import.meta.env.PROD) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ type: 'error', ...finalEvent }));
  }

  return finalEvent.id;
}

/**
 * Get recent errors
 */
export function getRecentErrors(limit = 50): ErrorEvent[] {
  return errorBuffer.slice(-limit);
}

/**
 * Clear error buffer
 */
export function clearErrors(): void {
  errorBuffer.length = 0;
}

/**
 * Get error statistics
 */
export function getErrorStats(): {
  total: number;
  bySeverity: Record<string, number>;
  byType: Record<string, number>;
  recent: ErrorEvent[];
} {
  const bySeverity: Record<string, number> = {};
  const byType: Record<string, number> = {};

  for (const event of errorBuffer) {
    bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
    byType[event.error.name] = (byType[event.error.name] || 0) + 1;
  }

  return {
    total: errorBuffer.length,
    bySeverity,
    byType,
    recent: errorBuffer.slice(-10),
  };
}

/**
 * Custom error classes for better categorization
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    public query?: string,
    public code?: string
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class UpstreamError extends Error {
  constructor(
    message: string,
    public service: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

/**
 * Global error handler for unhandled errors
 */
export function setupGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') {
    // Server-side
    process.on('uncaughtException', (error) => {
      captureError(error, { source: 'uncaughtException' }, false);
    });

    process.on('unhandledRejection', (reason) => {
      captureError(
        reason instanceof Error ? reason : new Error(String(reason)),
        { source: 'unhandledRejection' },
        false
      );
    });
  } else {
    // Client-side
    window.addEventListener('error', (event) => {
      captureError(event.error, {
        source: 'window.error',
        url: event.filename,
        line: event.lineno,
        col: event.colno,
      });
    });

    window.addEventListener('unhandledrejection', (event) => {
      captureError(event.reason instanceof Error ? event.reason : new Error(String(event.reason)), {
        source: 'window.unhandledrejection',
      });
    });
  }
}

/**
 * Wrap an async function with error tracking
 */
export function withErrorTracking<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  context?: LogContext
): T {
  return (async (...args: unknown[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      captureError(error, context);
      throw error;
    }
  }) as T;
}

/**
 * Wrap a sync function with error tracking
 */
export function withErrorTrackingSync<T extends (...args: unknown[]) => unknown>(
  fn: T,
  context?: LogContext
): T {
  return ((...args: unknown[]) => {
    try {
      return fn(...args);
    } catch (error) {
      captureError(error, context);
      throw error;
    }
  }) as T;
}
