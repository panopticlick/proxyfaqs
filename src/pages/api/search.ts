/**
 * Search API Endpoint
 *
 * Provides search functionality using PostgreSQL full-text search and trigram matching.
 * Returns JSON response with matching questions.
 *
 * Caching strategy:
 * - Public cache for 5 minutes (short TTL for fresh results)
 * - Stale-while-revalidate for 1 hour (serve stale, refresh in background)
 * - Vary by query parameter for proper cache keys
 */

import type { APIRoute } from 'astro';
import { searchQuestionsWithFallback } from '../../lib/supabase';
import {
  getClientIp,
  checkRateLimit,
  RATE_LIMITS,
  rateLimitResponse,
  addRateLimitHeaders,
} from '../../lib/rate-limit';
import {
  getCorsHeaders,
  corsOptionsResponse,
  sanitizeQuery,
  sanitizeLimit,
  addSecurityHeaders,
} from '../../lib/security';
import {
  logger,
  recordHistogram,
  incrementCounter,
  Metrics,
  captureError,
  middlewareTracing,
} from '../../lib/telemetry';

// Cache duration constants (in seconds)
const CACHE_MAX_AGE = 300; // 5 minutes
const STALE_WHILE_REVALIDATE = 3600; // 1 hour
const STALE_IF_ERROR = 86400; // 24 hours
const MAX_SEARCH_LIMIT = 100;

export const GET: APIRoute = async ({ url, request }) => {
  // Handle CORS preflight
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    return corsOptionsResponse(origin);
  }

  // Setup tracing
  const { traceContext, requestId } = middlewareTracing(request);
  const start = performance.now();

  // Apply rate limiting
  const clientIp = getClientIp(request);
  const rateLimitKey = `search:${clientIp}`;
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.search);

  if (!rateLimitResult.allowed) {
    recordHistogram(Metrics.API_REQUEST_DURATION, performance.now() - start, {
      endpoint: 'search',
      status: 'rate_limited',
    });
    return rateLimitResponse(rateLimitResult.resetAt);
  }

  const rawQuery = url.searchParams.get('q') || '';
  const sanitizedQuery = sanitizeQuery(rawQuery);

  if (!sanitizedQuery || sanitizedQuery.length < 2) {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
      ...getCorsHeaders(origin),
      'X-Request-ID': requestId,
    });
    addSecurityHeaders(headers);
    addRateLimitHeaders(
      headers,
      rateLimitResult.remaining,
      rateLimitResult.resetAt,
      RATE_LIMITS.search.maxRequests
    );

    logger.debug('Empty search query', { requestId, query: rawQuery });

    return new Response(JSON.stringify({ results: [], query: '' }), {
      status: 200,
      headers,
    });
  }

  const limit = sanitizeLimit(url.searchParams.get('limit'), MAX_SEARCH_LIMIT, 20);

  try {
    const { results, fallback } = await searchQuestionsWithFallback(sanitizedQuery, limit);

    const duration = performance.now() - start;
    recordHistogram(Metrics.SEARCH_QUERY_DURATION, duration, {
      fallback: String(fallback),
      resultCount: String(results.length),
    });
    recordHistogram(Metrics.API_REQUEST_DURATION, duration, {
      endpoint: 'search',
      status: 'success',
    });
    incrementCounter(Metrics.API_REQUEST_COUNT, 1, { endpoint: 'search' });
    incrementCounter(Metrics.SEARCH_RESULT_COUNT, results.length);

    if (fallback) {
      incrementCounter(Metrics.SEARCH_FALLBACK_COUNT, 1);
      logger.warn('Search used fallback', {
        requestId,
        query: sanitizedQuery,
      });
    }

    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}, stale-if-error=${STALE_IF_ERROR}`,
      Vary: 'Accept, Accept-Encoding',
      'CDN-Cache-Control': `public, max-age=${CACHE_MAX_AGE}, s-maxage=${CACHE_MAX_AGE}, stale-while-revalidate=${STALE_WHILE_REVALIDATE}`,
      ...getCorsHeaders(origin),
      'X-Request-ID': requestId,
    });
    addSecurityHeaders(headers);
    addRateLimitHeaders(
      headers,
      rateLimitResult.remaining,
      rateLimitResult.resetAt,
      RATE_LIMITS.search.maxRequests
    );

    logger.info('Search completed', {
      requestId,
      query: sanitizedQuery,
      resultCount: results.length,
      duration,
    });

    return new Response(
      JSON.stringify({
        results,
        query: sanitizedQuery,
        fallback,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers }
    );
  } catch (error) {
    const duration = performance.now() - start;
    recordHistogram(Metrics.API_REQUEST_DURATION, duration, {
      endpoint: 'search',
      status: 'error',
    });
    incrementCounter(Metrics.API_ERROR_COUNT, 1, {
      endpoint: 'search',
      error: error instanceof Error ? error.name : 'unknown',
    });

    captureError(error, {
      requestId,
      endpoint: 'search',
      query: sanitizedQuery,
    });

    logger.error('Search API error', error, {
      requestId,
      query: sanitizedQuery,
      duration,
    });

    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30, s-maxage=30, stale-if-error=${STALE_IF_ERROR}',
      ...getCorsHeaders(origin),
      'X-Request-ID': requestId,
    });
    addSecurityHeaders(headers);

    return new Response(JSON.stringify({ error: 'Search failed', results: [] }), {
      status: 500,
      headers,
    });
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  return corsOptionsResponse(request.headers.get('origin'));
};
