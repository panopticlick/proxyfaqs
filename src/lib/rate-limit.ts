/**
 * Rate Limiting Middleware
 *
 * In-memory rate limiting for API endpoints.
 * For production deployment on Cloudflare Pages, consider using
 * Cloudflare Workers KV or Durable Objects for distributed rate limiting.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
const ENTRY_TTL = 10 * 60 * 1000; // Keep entries for 10 minutes after expiry

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt + ENTRY_TTL < now) {
      store.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Extract client IP from request headers
 * Handles Cloudflare, standard proxy headers, and direct connections
 */
export function getClientIp(request: Request): string {
  // Check Cloudflare headers first
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;

  // Check standard proxy headers
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Take the first IP (original client)
    const ips = forwardedFor.split(',').map((ip) => ip.trim());
    if (ips[0]) return ips[0];
  }

  // Check other common headers
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;

  // Fallback to a hash of the request (for local development)
  return 'local-dev';
}

/**
 * Rate limit checker
 * Returns true if request should be allowed, false if limit exceeded
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(identifier);

  // Clean up expired entries and create new window
  if (!entry || entry.resetAt < now) {
    const resetAt = now + config.windowMs;
    store.set(identifier, { count: 1, resetAt });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt };
  }

  // Increment counter within current window
  entry.count++;

  if (entry.count > config.maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
    };
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

/**
 * Rate limiting configuration for different endpoints
 */
export const RATE_LIMITS = {
  // Chat: 20 requests per minute
  chat: { maxRequests: 20, windowMs: 60 * 1000 } as RateLimitConfig,

  // Search: 60 requests per minute
  search: { maxRequests: 60, windowMs: 60 * 1000 } as RateLimitConfig,

  // Default: 30 requests per minute
  default: { maxRequests: 30, windowMs: 60 * 1000 } as RateLimitConfig,
} as const;

/**
 * Create a rate limit response
 */
export function rateLimitResponse(resetAt: number): Response {
  const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);

  return new Response(
    JSON.stringify({
      error: 'Rate limit exceeded',
      message: 'Too many requests. Please try again later.',
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': retryAfter.toString(),
        'X-RateLimit-Limit': RATE_LIMITS.chat.maxRequests.toString(),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': new Date(resetAt).toISOString(),
      },
    }
  );
}

/**
 * Add rate limit headers to a successful response
 */
export function addRateLimitHeaders(
  headers: Headers,
  remaining: number,
  resetAt: number,
  limit: number
): void {
  headers.set('X-RateLimit-Limit', limit.toString());
  headers.set('X-RateLimit-Remaining', remaining.toString());
  headers.set('X-RateLimit-Reset', new Date(resetAt).toISOString());
}
