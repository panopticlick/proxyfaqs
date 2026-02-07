/**
 * Search API Endpoint
 *
 * Production-grade search with:
 * - PostgreSQL full-text search with trigram fallback
 * - LRU cache with TTL and size limits
 * - Rate limiting per IP
 * - Request validation and sanitization
 */

import type { APIRoute } from "astro";
import { searchQuestionsWithFallback } from "../../lib/supabase";

export const prerender = false;

// Cache configuration
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 1000;
const cache = new Map<string, { timestamp: number; body: string; hits: number }>();

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// Input validation
const MAX_QUERY_LENGTH = 200;
const MIN_QUERY_LENGTH = 2;

function getClientIP(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetIn: RATE_LIMIT_WINDOW_MS };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - entry.count, resetIn: entry.resetAt - now };
}

function sanitizeQuery(query: string): string {
  return query
    .trim()
    .slice(0, MAX_QUERY_LENGTH)
    .replace(/[<>\"'&]/g, "")
    .replace(/\s+/g, " ");
}

function pruneCache(): void {
  if (cache.size <= CACHE_MAX_SIZE) return;

  // Remove oldest entries (LRU eviction)
  const entries = Array.from(cache.entries())
    .sort((a, b) => a[1].timestamp - b[1].timestamp);

  const toRemove = entries.slice(0, Math.floor(CACHE_MAX_SIZE * 0.2));
  for (const [key] of toRemove) {
    cache.delete(key);
  }
}

function cleanupRateLimits(): void {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}

// Periodic cleanup
setInterval(cleanupRateLimits, 60_000);

export const GET: APIRoute = async ({ request, url }) => {
  const clientIP = getClientIP(request);

  // Rate limiting
  const rateLimit = checkRateLimit(clientIP);
  const rateLimitHeaders = {
    "X-RateLimit-Limit": RATE_LIMIT_MAX_REQUESTS.toString(),
    "X-RateLimit-Remaining": rateLimit.remaining.toString(),
    "X-RateLimit-Reset": Math.ceil(rateLimit.resetIn / 1000).toString(),
  };

  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limit exceeded", retryAfter: Math.ceil(rateLimit.resetIn / 1000) }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": Math.ceil(rateLimit.resetIn / 1000).toString(),
          ...rateLimitHeaders,
        },
      },
    );
  }

  // Parse and validate query
  const rawQuery = url.searchParams.get("q") || "";
  const query = sanitizeQuery(rawQuery);
  const rawLimit = parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;
  const category = url.searchParams.get("category") || undefined;

  // Empty or too short query
  if (!query || query.length < MIN_QUERY_LENGTH) {
    return new Response(
      JSON.stringify({ results: [], query: "", total: 0 }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...rateLimitHeaders,
        },
      },
    );
  }

  try {
    // Check cache
    const cacheKey = `${query.toLowerCase()}|${limit}|${category || ""}`;
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      cached.hits++;
      return new Response(cached.body, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
          "X-Cache": "HIT",
          "X-Cache-Hits": cached.hits.toString(),
          ...rateLimitHeaders,
        },
      });
    }

    // Execute search
    const startTime = Date.now();
    const { results, fallback } = await searchQuestionsWithFallback(query, limit);
    const searchTime = Date.now() - startTime;

    const body = JSON.stringify({
      results,
      query,
      total: results.length,
      fallback,
      searchTime,
    });

    // Update cache
    cache.set(cacheKey, { timestamp: Date.now(), body, hits: 0 });
    pruneCache();

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
        "X-Cache": "MISS",
        "X-Search-Time": `${searchTime}ms`,
        ...rateLimitHeaders,
      },
    });
  } catch (error) {
    console.error("Search API error:", error);
    return new Response(
      JSON.stringify({ error: "Search temporarily unavailable", results: [], query }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "5",
          ...rateLimitHeaders,
        },
      },
    );
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  return corsOptionsResponse(request.headers.get('origin'));
};
