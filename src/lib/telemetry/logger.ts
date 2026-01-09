/**
 * Structured Logging Utility
 *
 * Provides consistent, structured logging with levels, context, and request ID tracking.
 * Designed for production observability and debugging.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  CRITICAL = 4,
}

export interface LogContext {
  requestId?: string;
  userId?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  duration?: number;
  userAgent?: string;
  ip?: string;
  [key: string]: unknown;
}

export interface LogEntry {
  level: LogLevel;
  levelName: string;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.CRITICAL]: 'CRITICAL',
};

// Minimum log level (configurable via env)
let minLogLevel = LogLevel.INFO;

// Request context storage (async-local storage alternative)
const requestContextStore = new Map<string, LogContext>();

export function setLogLevel(level: LogLevel | string): void {
  if (typeof level === 'string') {
    const upper = level.toUpperCase();
    const found = Object.entries(LOG_LEVEL_NAMES).find(([, name]) => name === upper);
    if (found) {
      minLogLevel = parseInt(found[0], 10) as LogLevel;
    }
  } else {
    minLogLevel = level;
  }
}

export function setRequestContext(requestId: string, context: LogContext): void {
  requestContextStore.set(requestId, context);
}

export function getRequestContext(requestId: string): LogContext | undefined {
  return requestContextStore.get(requestId);
}

export function clearRequestContext(requestId: string): void {
  requestContextStore.delete(requestId);
}

/**
 * Sanitize context data to prevent logging sensitive information
 */
function sanitizeContext(context: LogContext): LogContext {
  const sanitized = { ...context };
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'auth', 'cookie', 'session'];

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Format error for logging
 */
function formatError(error: unknown): LogEntry['error'] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: (error as { code?: string }).code,
    };
  }

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: error,
    };
  }

  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    return {
      name: (err.name as string) || 'Error',
      message: (err.message as string) || String(error),
    };
  }

  return {
    name: 'Unknown',
    message: String(error),
  };
}

/**
 * Core logging function
 */
function log(level: LogLevel, message: string, context?: LogContext, error?: unknown): void {
  if (level < minLogLevel) return;

  const entry: LogEntry = {
    level,
    levelName: LOG_LEVEL_NAMES[level],
    message,
    timestamp: new Date().toISOString(),
    context: context ? sanitizeContext(context) : undefined,
    error: error ? formatError(error) : undefined,
  };

  // In development, use console methods for pretty output
  if (import.meta.env.DEV) {
    const consoleMethod =
      level === LogLevel.CRITICAL || level === LogLevel.ERROR
        ? 'error'
        : level === LogLevel.WARN
          ? 'warn'
          : level === LogLevel.DEBUG
            ? 'debug'
            : 'log';

    const emoji =
      level === LogLevel.CRITICAL
        ? '🚨'
        : level === LogLevel.ERROR
          ? '❌'
          : level === LogLevel.WARN
            ? '⚠️'
            : level === LogLevel.DEBUG
              ? '🔍'
              : 'ℹ️';

    const contextStr = entry.context ? ' ' + JSON.stringify(entry.context) : '';
    const errorStr = entry.error ? ' ' + entry.error.name + ': ' + entry.error.message : '';

    // eslint-disable-next-line no-console
    console[consoleMethod](emoji + ' [' + entry.levelName + '] ' + message + contextStr + errorStr);
    return;
  }

  // In production, output JSON for log aggregation
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(entry));
}

/**
 * Logger class for fluent API
 */
export class Logger {
  private readonly baseContext: LogContext;

  constructor(baseContext: LogContext = {}) {
    this.baseContext = baseContext;
  }

  child(context: LogContext): Logger {
    return new Logger({ ...this.baseContext, ...context });
  }

  debug(message: string, context?: LogContext): void {
    log(LogLevel.DEBUG, message, { ...this.baseContext, ...context });
  }

  info(message: string, context?: LogContext): void {
    log(LogLevel.INFO, message, { ...this.baseContext, ...context });
  }

  warn(message: string, context?: LogContext): void {
    log(LogLevel.WARN, message, { ...this.baseContext, ...context });
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    log(LogLevel.ERROR, message, { ...this.baseContext, ...context }, error);
  }

  critical(message: string, error?: unknown, context?: LogContext): void {
    log(LogLevel.CRITICAL, message, { ...this.baseContext, ...context }, error);
  }
}

// Default logger instance
export const logger = new Logger();

// Convenience functions
export const debug = (message: string, context?: LogContext) => logger.debug(message, context);
export const info = (message: string, context?: LogContext) => logger.info(message, context);
export const warn = (message: string, context?: LogContext) => logger.warn(message, context);
export const error = (message: string, err?: unknown, context?: LogContext) =>
  logger.error(message, err, context);
export const critical = (message: string, err?: unknown, context?: LogContext) =>
  logger.critical(message, err, context);
