/**
 * Security Utilities
 *
 * Input sanitization, validation, and CORS configuration
 */

/**
 * Allowed origins for CORS
 */
export const ALLOWED_ORIGINS = [
  'https://proxyfaqs.com',
  'https://www.proxyfaqs.com',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
] as const;

/**
 * Check if origin is allowed
 */
export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true; // Allow same-origin requests
  return ALLOWED_ORIGINS.some((allowed) => origin === allowed);
}

/**
 * Get CORS headers for a given origin
 */
export function getCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = isAllowedOrigin(origin) ? origin || ALLOWED_ORIGINS[0] : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

/**
 * Handle OPTIONS request for CORS preflight
 */
export function corsOptionsResponse(origin: string | null): Response {
  return new Response(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}

/**
 * Sanitize user input to prevent XSS and injection attacks
 */
export function sanitizeInput(input: string): string {
  return (
    input
      // Remove null bytes
      .replace(/\0/g, '')
      // Remove control characters except newlines and tabs
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Trim whitespace
      .trim()
  );
}

/**
 * Validate and sanitize a query string
 */
export function sanitizeQuery(query: string): string {
  const sanitized = sanitizeInput(query);

  // Limit query length
  const MAX_LENGTH = 500;
  if (sanitized.length > MAX_LENGTH) {
    return sanitized.slice(0, MAX_LENGTH);
  }

  return sanitized;
}

/**
 * Validate a slug format
 */
export function isValidSlug(slug: string): boolean {
  // Allow alphanumeric, hyphens, and underscores
  // Must be 1-100 characters
  const SLUG_REGEX = /^[a-z0-9_-]{1,100}$/i;
  return SLUG_REGEX.test(slug);
}

/**
 * Validate a session ID format
 */
export function isValidSessionId(sessionId: string): boolean {
  // Allow alphanumeric, hyphens, and underscores
  // Must be 8-100 characters
  const SESSION_ID_REGEX = /^[a-zA-Z0-9_-]{8,100}$/;
  return SESSION_ID_REGEX.test(sessionId);
}

/**
 * Validate a limit parameter
 */
export function sanitizeLimit(limit: string | null, max: number, defaultLimit: number): number {
  if (!limit) return defaultLimit;

  const parsed = Number.parseInt(limit, 10);

  if (Number.isNaN(parsed)) return defaultLimit;
  if (parsed < 1) return 1;
  if (parsed > max) return max;

  return parsed;
}

/**
 * Validate a message string for chat
 */
export function sanitizeMessage(message: string): {
  valid: boolean;
  sanitized?: string;
  error?: string;
} {
  const sanitized = sanitizeInput(message);

  if (!sanitized) {
    return { valid: false, error: 'Message cannot be empty' };
  }

  const MAX_LENGTH = 2000;
  if (sanitized.length > MAX_LENGTH) {
    return {
      valid: false,
      error: `Message too long (max ${MAX_LENGTH} characters)`,
    };
  }

  // Check for potential injection patterns
  const dangerousPatterns = [
    /<script[^>]*>/i,
    /javascript:/i,
    /on\w+\s*=/i, // Event handlers like onclick=
    /<iframe/i,
    /<embed/i,
    /<object/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(sanitized)) {
      return { valid: false, error: 'Message contains invalid content' };
    }
  }

  return { valid: true, sanitized };
}

/**
 * Security headers for API responses
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
} as const;

/**
 * Add security headers to a response
 */
export function addSecurityHeaders(headers: Headers): void {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
}
