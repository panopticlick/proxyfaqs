/**
 * Metrics Collection
 *
 * Collects performance metrics, API response times, and custom counters.
 * Designed for production monitoring and alerting.
 */

export interface MetricData {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface HistogramData {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface CounterData {
  name: string;
  delta: number;
  timestamp: number;
  tags?: Record<string, string>;
}

export interface GaugeData {
  name: string;
  value: number;
  timestamp: number;
  tags?: Record<string, string>;
}

// In-memory metrics storage
const histograms = new Map<string, number[]>();
const counters = new Map<string, CounterData>();
const gauges = new Map<string, number>();

/**
 * Record a histogram value (for distributions like response times)
 */
export function recordHistogram(name: string, value: number, tags?: Record<string, string>): void {
  if (!histograms.has(name)) {
    histograms.set(name, []);
  }
  histograms.get(name)!.push(value);

  // Keep only last 1000 values per histogram
  const values = histograms.get(name)!;
  if (values.length > 1000) {
    values.shift();
  }

  // Log for external aggregation
  if (import.meta.env.PROD) {
    const entry: HistogramData = {
      name,
      value,
      timestamp: Date.now(),
      tags,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ type: 'histogram', ...entry }));
  }
}

/**
 * Get histogram statistics
 */
export function getHistogramStats(name: string): {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
} | null {
  const values = histograms.get(name);
  if (!values || values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((a, b) => a + b, 0);

  return {
    count: values.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / values.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    p99: sorted[Math.floor(sorted.length * 0.99)],
  };
}

/**
 * Increment a counter
 */
export function incrementCounter(name: string, delta = 1, tags?: Record<string, string>): void {
  const key = JSON.stringify({ name, tags });
  const existing = Array.from(counters.entries()).find(([k]) => k === key);

  if (existing) {
    existing[1].delta += delta;
    existing[1].timestamp = Date.now();
  } else {
    counters.set(String(Date.now()) + Math.random().toString(), {
      name,
      delta,
      timestamp: Date.now(),
      tags,
    });
  }

  // Log for external aggregation
  if (import.meta.env.PROD) {
    const entry: CounterData = {
      name,
      delta,
      timestamp: Date.now(),
      tags,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ type: 'counter', ...entry }));
  }
}

/**
 * Set a gauge value
 */
export function setGauge(name: string, value: number, tags?: Record<string, string>): void {
  const key = JSON.stringify({ name, tags });
  gauges.set(key, value);

  // Log for external aggregation
  if (import.meta.env.PROD) {
    const entry: GaugeData = {
      name,
      value,
      timestamp: Date.now(),
      tags,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ type: 'gauge', ...entry }));
  }
}

/**
 * Get all metrics for monitoring endpoint
 */
export function getAllMetrics(): {
  histograms: Record<string, ReturnType<typeof getHistogramStats>>;
  counters: Record<string, number>;
  gauges: Record<string, number>;
} {
  const histogramStats: Record<string, ReturnType<typeof getHistogramStats>> = {};
  for (const [name] of histograms) {
    const stats = getHistogramStats(name);
    if (stats) {
      histogramStats[name] = stats;
    }
  }

  const counterValues: Record<string, number> = {};
  for (const [, data] of counters) {
    const key = data.tags ? data.name + ':' + JSON.stringify(data.tags) : data.name;
    counterValues[key] = (counterValues[key] || 0) + data.delta;
  }

  return {
    histograms: histogramStats,
    counters: counterValues,
    gauges: Object.fromEntries(gauges),
  };
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  histograms.clear();
  counters.clear();
  gauges.clear();
}

/**
 * Pre-defined metric names
 */
export const Metrics = {
  // API metrics
  API_REQUEST_DURATION: 'api.request.duration',
  API_REQUEST_COUNT: 'api.request.count',
  API_ERROR_COUNT: 'api.error.count',

  // Database metrics
  DB_QUERY_DURATION: 'db.query.duration',
  DB_QUERY_COUNT: 'db.query.count',
  DB_ERROR_COUNT: 'db.error.count',

  // Search metrics
  SEARCH_QUERY_DURATION: 'search.query.duration',
  SEARCH_RESULT_COUNT: 'search.result.count',
  SEARCH_FALLBACK_COUNT: 'search.fallback.count',

  // Chat metrics
  CHAT_REQUEST_DURATION: 'chat.request.duration',
  CHAT_REQUEST_COUNT: 'chat.request.count',
  CHAT_ERROR_COUNT: 'chat.error.count',
  CHAT_TOKEN_COUNT: 'chat.token.count',

  // Page view metrics
  PAGE_VIEW_COUNT: 'page.view.count',
  PAGE_LOAD_DURATION: 'page.load.duration',

  // System metrics
  MEMORY_USAGE: 'system.memory.usage',
  CPU_USAGE: 'system.cpu.usage',
} as const;

/**
 * Helper to time a function and record duration
 */
export async function time<T>(
  metricName: string,
  fn: () => Promise<T>,
  tags?: Record<string, string>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    recordHistogram(metricName, duration, { status: 'success', ...tags });
    return result;
  } catch (err) {
    const duration = performance.now() - start;
    recordHistogram(metricName, duration, { status: 'error', ...tags });
    incrementCounter(Metrics.API_ERROR_COUNT, 1, {
      error: String(err),
      ...tags,
    });
    throw err;
  }
}

/**
 * Helper to time a synchronous function and record duration
 */
export function timeSync<T>(metricName: string, fn: () => T, tags?: Record<string, string>): T {
  const start = performance.now();
  try {
    const result = fn();
    const duration = performance.now() - start;
    recordHistogram(metricName, duration, { status: 'success', ...tags });
    return result;
  } catch (err) {
    const duration = performance.now() - start;
    recordHistogram(metricName, duration, { status: 'error', ...tags });
    incrementCounter(Metrics.API_ERROR_COUNT, 1, {
      error: String(err),
      ...tags,
    });
    throw err;
  }
}
