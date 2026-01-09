import type { APIRoute } from 'astro';
import { corsOptionsResponse, getCorsHeaders, addSecurityHeaders } from '../../lib/security';
import { env } from '../../lib/env';
import { getAllMetrics, getErrorStats } from '../../lib/telemetry';
import { recordHistogram, incrementCounter, Metrics } from '../../lib/telemetry';

// Database check helper
async function checkDatabaseConnection(): Promise<{
  ok: boolean;
  error?: string;
  duration: number;
}> {
  const start = performance.now();

  try {
    const response = await fetch(
      `${env.PUBLIC_SUPABASE_URL}/rest/v1/categories?select=id&limit=1`,
      {
        headers: {
          apikey: env.PUBLIC_SUPABASE_ANON_KEY,
          'Accept-Profile': 'proxyfaqs',
        },
        signal: AbortSignal.timeout(5000),
      }
    );

    const duration = performance.now() - start;

    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, duration };
    }

    return { ok: true, duration };
  } catch (error) {
    const duration = performance.now() - start;
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error', duration };
  }
}

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'degraded';
  duration?: number;
  message?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  version?: string;
  environment: string;
  checks: {
    database: HealthCheck;
    cache?: HealthCheck;
    externalApis?: HealthCheck;
  };
  metrics?: {
    requests: {
      total: number;
      errors: number;
      errorRate: number;
    };
    performance: {
      avgResponseTime: number;
      p95ResponseTime: number;
    };
  };
  errors?: {
    total: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  };
}

const startTime = Date.now();

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<HealthCheck> {
  const result = await checkDatabaseConnection();

  recordHistogram('health.check.duration', result.duration, { check: 'database' });

  if (!result.ok) {
    incrementCounter(Metrics.DB_ERROR_COUNT, 1, { check: 'health' });
    return {
      name: 'database',
      status: 'fail',
      duration: result.duration,
      message: result.error,
    };
  }

  return {
    name: 'database',
    status: 'pass',
    duration: result.duration,
  };
}

/**
 * Check external API availability
 */
async function checkExternalApis(): Promise<HealthCheck> {
  const start = performance.now();
  const checks: Promise<{ name: string; ok: boolean; duration: number }>[] = [];

  // Check OpenRouter availability (if configured)
  if (env.OPENROUTER_API_KEY) {
    checks.push(
      fetch('https://openrouter.ai/api/v1/models', {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      })
        .then((res) => ({
          name: 'openrouter',
          ok: res.ok,
          duration: performance.now() - start,
        }))
        .catch(() => ({
          name: 'openrouter',
          ok: false,
          duration: performance.now() - start,
        }))
    );
  }

  // Check VectorEngine availability (if configured)
  if (env.VECTORENGINE_API_KEY) {
    checks.push(
      fetch(`${env.VECTORENGINE_BASE_URL}/v1/models`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
      })
        .then((res) => ({
          name: 'vectorengine',
          ok: res.ok,
          duration: performance.now() - start,
        }))
        .catch(() => ({
          name: 'vectorengine',
          ok: false,
          duration: performance.now() - start,
        }))
    );
  }

  if (checks.length === 0) {
    return {
      name: 'externalApis',
      status: 'pass',
      message: 'No external APIs configured',
    };
  }

  const results = await Promise.allSettled(checks);
  const allPassed = results.every((r) => r.status === 'fulfilled' && r.value.ok);
  const anyPassed = results.some((r) => r.status === 'fulfilled' && r.value.ok);

  const duration = performance.now() - start;
  recordHistogram('health.check.duration', duration, {
    check: 'external_apis',
  });

  if (allPassed) {
    return { name: 'externalApis', status: 'pass', duration };
  }
  if (anyPassed) {
    return { name: 'externalApis', status: 'degraded', duration };
  }
  return {
    name: 'externalApis',
    status: 'fail',
    duration,
    message: 'All external APIs unavailable',
  };
}

export const GET: APIRoute = async ({ request }) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const origin = request.headers.get('origin');

  // Run health checks in parallel
  const [dbCheck, apiCheck] = await Promise.allSettled([checkDatabase(), checkExternalApis()]);

  const database =
    dbCheck.status === 'fulfilled'
      ? dbCheck.value
      : { name: 'database', status: 'fail' as const, message: 'Check failed' };
  const externalApis = apiCheck.status === 'fulfilled' ? apiCheck.value : undefined;

  // Determine overall status
  let status: 'ok' | 'degraded' | 'down' = 'ok';
  if (database.status === 'fail') {
    status = 'down';
  } else if (externalApis?.status === 'degraded') {
    status = 'degraded';
  } else if (externalApis?.status === 'fail') {
    status = 'degraded';
  }

  // Get metrics
  const allMetrics = getAllMetrics();
  const errorStats = getErrorStats();

  // Calculate metrics summary
  const requestStats = allMetrics.histograms[Metrics.API_REQUEST_DURATION];
  const errorCount = allMetrics.counters[Metrics.API_ERROR_COUNT] || 0;
  const totalRequests = allMetrics.counters[Metrics.API_REQUEST_COUNT] || errorCount + 100;

  const response: HealthResponse = {
    status,
    timestamp: new Date().toISOString(),
    uptime,
    version: import.meta.env.PUBLIC_VERSION || undefined,
    environment: import.meta.env.PUBLIC_ENVIRONMENT || 'production',
    checks: {
      database,
      cache: {
        name: 'cache',
        status: 'pass',
        message: 'Cloudflare Pages CDN',
      },
      externalApis,
    },
    metrics: {
      requests: {
        total: totalRequests,
        errors: errorCount,
        errorRate: errorCount / totalRequests,
      },
      performance: {
        avgResponseTime: requestStats?.mean || 0,
        p95ResponseTime: requestStats?.p95 || 0,
      },
    },
    errors: {
      total: errorStats.total,
      bySeverity: errorStats.bySeverity,
      byType: errorStats.byType,
    },
  };

  const statusCode = status === 'down' ? 503 : status === 'degraded' ? 200 : 200;

  const headers = new Headers({
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    ...getCorsHeaders(origin),
  });
  addSecurityHeaders(headers);

  return new Response(JSON.stringify(response), {
    status: statusCode,
    headers,
  });
};

export const OPTIONS: APIRoute = async ({ request }) => {
  return corsOptionsResponse(request.headers.get('origin'));
};
