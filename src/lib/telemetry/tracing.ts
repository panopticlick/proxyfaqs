/**
 * Distributed Tracing
 *
 * Request ID generation and trace context propagation for debugging.
 */

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  sampled: boolean;
}

export interface Span {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  tags?: Record<string, string | number | boolean>;
  status?: 'ok' | 'error';
  error?: Error;
  sampled?: boolean;
}

// Active spans storage
const activeSpans = new Map<string, Span>();
const MAX_SPANS = 1000;

/**
 * Generate a random span ID
 */
function generateSpanId(): string {
  return crypto.randomUUID().split('-')[0];
}

/**
 * Generate a random trace ID
 */
export function generateTraceId(): string {
  return crypto.randomUUID();
}

/**
 * Extract or create trace context from headers
 */
export function getTraceContext(headers: Headers): TraceContext {
  // Check for existing trace headers
  const traceParent = headers.get('traceparent');
  if (traceParent) {
    // W3C Trace Context format: version-traceId-parentId-flags
    const parts = traceParent.split('-');
    if (parts.length >= 4) {
      return {
        traceId: parts[1],
        spanId: parts[2],
        sampled: parts[3].endsWith('1'),
      };
    }
  }

  // Check for Cloudflare request ID
  const cfRay = headers.get('cf-ray');
  if (cfRay) {
    return {
      traceId: cfRay,
      spanId: generateSpanId(),
      sampled: true,
    };
  }

  // Create new trace context
  return {
    traceId: generateTraceId(),
    spanId: generateSpanId(),
    sampled: Math.random() < 0.1, // Sample 10% of requests
  };
}

/**
 * Create trace headers for outgoing requests
 */
export function createTraceHeaders(context: TraceContext): Record<string, string> {
  const flags = context.sampled ? '01' : '00';
  return {
    traceparent: `00-${context.traceId}-${context.spanId}-${flags}`,
    'x-trace-id': context.traceId,
  };
}

/**
 * Start a new span
 */
export function startSpan(
  name: string,
  parentContext?: TraceContext,
  tags?: Record<string, string | number | boolean>
): Span {
  const spanId = generateSpanId();
  const traceId = parentContext?.traceId || generateTraceId();

  const span: Span = {
    traceId,
    spanId,
    parentSpanId: parentContext?.spanId,
    name,
    startTime: performance.now(),
    tags,
  };

  // Store active span (limit size)
  if (activeSpans.size >= MAX_SPANS) {
    const oldestKey = activeSpans.keys().next().value as string;
    activeSpans.delete(oldestKey);
  }
  activeSpans.set(spanId, span);

  return span;
}

/**
 * Finish a span
 */
export function finishSpan(span: Span, status: 'ok' | 'error' = 'ok', error?: Error): void {
  span.endTime = performance.now();
  span.status = status;
  if (error) {
    span.error = error;
  }

  // Log span in production
  if (import.meta.env.PROD && span.sampled !== false) {
    const duration = (span.endTime || span.startTime) - span.startTime;
    const spanData = {
      type: 'span',
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      name: span.name,
      duration,
      status,
      tags: span.tags,
      timestamp: Date.now(),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(spanData));
  }
}

/**
 * Run a function within a span
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  parentContext?: TraceContext,
  tags?: Record<string, string | number | boolean>
): Promise<T> {
  const span = startSpan(name, parentContext, tags);

  try {
    const result = await fn(span);
    finishSpan(span, 'ok');
    return result;
  } catch (error) {
    finishSpan(span, 'error', error as Error);
    throw error;
  }
}

/**
 * Run a sync function within a span
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  parentContext?: TraceContext,
  tags?: Record<string, string | number | boolean>
): T {
  const span = startSpan(name, parentContext, tags);

  try {
    const result = fn(span);
    finishSpan(span, 'ok');
    return result;
  } catch (error) {
    finishSpan(span, 'error', error as Error);
    throw error;
  }
}

/**
 * Get active span by ID
 */
export function getSpan(spanId: string): Span | undefined {
  return activeSpans.get(spanId);
}

/**
 * Get all active spans for a trace
 */
export function getTraceSpans(traceId: string): Span[] {
  return Array.from(activeSpans.values()).filter((s) => s.traceId === traceId);
}

/**
 * Middleware helper to extract trace context from request
 */
export function middlewareTracing(request: Request): {
  traceContext: TraceContext;
  requestId: string;
} {
  const traceContext = getTraceContext(request.headers);
  const requestId = traceContext.traceId;

  return {
    traceContext,
    requestId,
  };
}

/**
 * Add tags to an active span
 */
export function addSpanTags(spanId: string, tags: Record<string, string | number | boolean>): void {
  const span = activeSpans.get(spanId);
  if (span) {
    span.tags = { ...span.tags, ...tags };
  }
}
