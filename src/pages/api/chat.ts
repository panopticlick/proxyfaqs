/**
 * Chat API Endpoint
 *
 * Proxies chat requests to OpenRouter API (free models) or VectorEngine fallback.
 * Uses google/gemini-2.0-flash-exp:free for quick responses.
 *
 * IMPORTANT: In production, this should be deployed as a Cloudflare Worker
 * to protect the API key. For local development, we use this endpoint.
 */

import type { APIRoute } from 'astro';

import { env } from '../../lib/env';
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
  sanitizeMessage,
  isValidSessionId,
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

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

// Helper to get env vars at runtime (for Cloudflare Pages)
function getEnvVar(locals: App.Locals, name: string, fallback: string = ''): string {
  // Try Cloudflare runtime env first
  const runtime = (locals as { runtime?: { env?: Record<string, string> } }).runtime;
  if (runtime?.env?.[name]) {
    return runtime.env[name];
  }
  // Fall back to build-time env
  return (env as Record<string, string>)[name] || fallback;
}

const SYSTEM_PROMPT = `You are a proxy expert with 10+ years of experience in web scraping and data extraction. You have personally tested BrightData, Soax, Smartproxy, Proxy-Cheap, and Proxy-Seller.

Your expertise includes:
- Residential, datacenter, mobile, and rotating proxies
- Anti-detection techniques and fingerprinting
- Rate limiting and request throttling strategies
- Handling CAPTCHAs and JavaScript challenges
- Legal and ethical considerations of web scraping

When answering:
1. Be technical but accessible - explain complex concepts simply
2. Recommend specific proxy types based on the user's use case
3. When recommending providers, explain WHY based on their specific needs
4. CRITICAL: When including ANY affiliate link or provider recommendation, ALWAYS add this exact disclosure at the end: "**Affiliate Disclosure: Some links below are affiliate links. We may earn a commission at no cost to you.**"
5. Acknowledge limitations and edge cases
6. Provide code examples in Python when helpful

Current page context will be provided to help you give relevant answers.`;

const AFFILIATE_PROVIDERS = {
  residential: [
    {
      name: 'BrightData',
      href: 'https://get.brightdata.com/luminati-proxy',
      reason: 'enterprise coverage and geo targeting',
    },
    {
      name: 'Soax',
      href: 'https://soax.com/?r=cUgaoF3u',
      reason: 'flexible rotation and residential quality',
    },
    {
      name: 'Smartproxy',
      href: 'https://smartproxy.pxf.io/deals',
      reason: 'balanced pricing and coverage',
    },
  ],
  datacenter: [
    {
      name: 'Proxy-Seller',
      href: 'https://proxy-seller.com/?partner=REVhIGcljl3h0',
      reason: 'fast datacenter IPs with stable uptime',
    },
    {
      name: 'Webshare',
      href: 'https://proxy.webshare.io/register/?referral_code=xn5m7d467sbh',
      reason: 'cost-effective datacenter pools',
    },
    {
      name: 'Rayobyte',
      href: 'https://billing.rayobyte.com/hosting/aff.php?aff=455&to=http://rayobyte.com/',
      reason: 'reliable datacenter infrastructure',
    },
  ],
  mobile: [
    {
      name: 'TheSocialProxy',
      href: 'https://thesocialproxy.com/?ref=privateproxyreviews@gmail.com',
      reason: 'mobile IPs for social automation',
    },
    {
      name: 'Proxy-Cheap',
      href: 'https://app.proxy-cheap.com/r/mRP1Si',
      reason: 'budget-friendly mobile options',
    },
    {
      name: 'Soax',
      href: 'https://soax.com/?r=cUgaoF3u',
      reason: 'flexible mobile rotation control',
    },
  ],
  scraping: [
    {
      name: 'BrightData',
      href: 'https://get.brightdata.com/luminati-proxy',
      reason: 'strong anti-bot resilience',
    },
    {
      name: 'Smartproxy',
      href: 'https://smartproxy.pxf.io/deals',
      reason: 'good coverage and straightforward setup',
    },
    {
      name: 'Soax',
      href: 'https://soax.com/?r=cUgaoF3u',
      reason: 'stable pool and flexible session control',
    },
  ],
};

function inferProxyType(text: string) {
  const normalized = text.toLowerCase();
  if (
    normalized.includes('mobile') ||
    normalized.includes('instagram') ||
    normalized.includes('tiktok') ||
    normalized.includes('social')
  ) {
    return 'mobile';
  }
  if (
    normalized.includes('datacenter') ||
    normalized.includes('data center') ||
    normalized.includes('cheap') ||
    normalized.includes('bulk')
  ) {
    return 'datacenter';
  }
  if (normalized.includes('scraper api') || normalized.includes('scraping api')) {
    return 'scraping';
  }
  return 'residential';
}

function buildRecommendationContext(message: string, pageContext?: string) {
  const contextText = `${message} ${pageContext || ''}`;
  const proxyType = inferProxyType(contextText);
  const providerList = AFFILIATE_PROVIDERS[proxyType] || AFFILIATE_PROVIDERS.residential;

  const providerLines = providerList
    .map((provider) => `- ${provider.name}: ${provider.href} (${provider.reason})`)
    .join('\n');

  return `Recommended proxy type: ${proxyType}. When suggesting providers, use these affiliate links and disclose affiliate status:\n${providerLines}`;
}

export const POST: APIRoute = async ({ request, locals }) => {
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
  const rateLimitKey = `chat:${clientIp}`;
  const rateLimitResult = checkRateLimit(rateLimitKey, RATE_LIMITS.chat);

  if (!rateLimitResult.allowed) {
    recordHistogram(Metrics.API_REQUEST_DURATION, performance.now() - start, {
      endpoint: 'chat',
      status: 'rate_limited',
    });
    return rateLimitResponse(rateLimitResult.resetAt);
  }

  try {
    const { message, sessionId, pageContext } = await request.json();

    // Validate and sanitize message
    const messageValidation = sanitizeMessage(message || '');
    if (!messageValidation.valid) {
      recordHistogram(Metrics.API_REQUEST_DURATION, performance.now() - start, {
        endpoint: 'chat',
        status: 'validation_error',
      });

      const headers = new Headers({
        'Content-Type': 'application/json',
        ...getCorsHeaders(origin),
        'X-Request-ID': requestId,
      });
      addSecurityHeaders(headers);
      addRateLimitHeaders(
        headers,
        rateLimitResult.remaining,
        rateLimitResult.resetAt,
        RATE_LIMITS.chat.maxRequests
      );

      return new Response(
        JSON.stringify({
          error: messageValidation.error || 'Invalid message',
        }),
        {
          status: 400,
          headers,
        }
      );
    }

    const sanitizedMessage = messageValidation.sanitized!;

    // Validate session ID if provided
    if (sessionId && !isValidSessionId(sessionId)) {
      recordHistogram(Metrics.API_REQUEST_DURATION, performance.now() - start, {
        endpoint: 'chat',
        status: 'validation_error',
      });

      const headers = new Headers({
        'Content-Type': 'application/json',
        ...getCorsHeaders(origin),
        'X-Request-ID': requestId,
      });
      addSecurityHeaders(headers);
      addRateLimitHeaders(
        headers,
        rateLimitResult.remaining,
        rateLimitResult.resetAt,
        RATE_LIMITS.chat.maxRequests
      );

      return new Response(JSON.stringify({ error: 'Invalid session ID format' }), {
        status: 400,
        headers,
      });
    }

    // Sanitize page context
    const sanitizedPageContext = pageContext
      ? pageContext.slice(0, 200).replace(/[\x00-\x1F\x7F]/g, '')
      : undefined;

    logger.info('Chat request received', {
      requestId,
      sessionId,
      hasPageContext: !!sanitizedPageContext,
      messageLength: sanitizedMessage.length,
    });

    // Get env vars at runtime (works on Cloudflare Pages)
    const OPENROUTER_API_KEY = getEnvVar(locals, 'OPENROUTER_API_KEY');
    const OPENROUTER_MODEL = getEnvVar(
      locals,
      'OPENROUTER_MODEL',
      'google/gemini-2.0-flash-exp:free'
    );
    const VECTORENGINE_API_KEY = getEnvVar(locals, 'VECTORENGINE_API_KEY');
    const VECTORENGINE_BASE_URL = getEnvVar(
      locals,
      'VECTORENGINE_BASE_URL',
      'https://api.vectorengine.ai'
    );

    // Check for available API key (OpenRouter first, VectorEngine fallback)
    const useOpenRouter = !!OPENROUTER_API_KEY;
    const useVectorEngine = !useOpenRouter && !!VECTORENGINE_API_KEY;

    if (!useOpenRouter && !useVectorEngine) {
      recordHistogram(Metrics.CHAT_REQUEST_DURATION, performance.now() - start, {
        provider: 'none',
        status: 'no_api_key',
      });

      // Return a helpful fallback response when no API key is configured
      const headers = new Headers({
        'Content-Type': 'application/json',
        ...getCorsHeaders(origin),
        'X-Request-ID': requestId,
      });
      addSecurityHeaders(headers);
      addRateLimitHeaders(
        headers,
        rateLimitResult.remaining,
        rateLimitResult.resetAt,
        RATE_LIMITS.chat.maxRequests
      );

      return new Response(
        JSON.stringify({
          response:
            "I'm your proxy assistant! For the best experience, please ensure the API is configured. In the meantime, you can browse our FAQ pages or compare providers.",
          sessionId,
        }),
        { status: 200, headers }
      );
    }

    // Build messages array
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

    // Add page context if available
    if (sanitizedPageContext) {
      messages.push({
        role: 'system',
        content: `The user is currently viewing: ${sanitizedPageContext}`,
      });
    }

    messages.push({
      role: 'system',
      content: buildRecommendationContext(sanitizedMessage, sanitizedPageContext),
    });

    messages.push({ role: 'user', content: sanitizedMessage });

    // Call API (OpenRouter primary, VectorEngine fallback)
    const apiUrl = useOpenRouter
      ? `${OPENROUTER_BASE_URL}/chat/completions`
      : `${VECTORENGINE_BASE_URL}/v1/chat/completions`;

    const apiKey = useOpenRouter ? OPENROUTER_API_KEY : VECTORENGINE_API_KEY;
    const model = useOpenRouter ? OPENROUTER_MODEL : 'grok-4-fast-non-reasoning';

    const fetchHeaders: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // OpenRouter requires these headers
    if (useOpenRouter) {
      fetchHeaders['HTTP-Referer'] = 'https://proxyfaqs.com';
      fetchHeaders['X-Title'] = 'ProxyFAQs';
    }

    const apiStart = performance.now();
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    const apiDuration = performance.now() - apiStart;
    recordHistogram('chat.upstream.duration', apiDuration, {
      provider: useOpenRouter ? 'openrouter' : 'vectorengine',
    });

    if (!response.ok) {
      const error = new Error(`Upstream API error: ${response.status}`);
      logger.error('Chat upstream API error', error, {
        requestId,
        status: response.status,
        provider: useOpenRouter ? 'openrouter' : 'vectorengine',
      });

      captureError(error, {
        requestId,
        provider: useOpenRouter ? 'openrouter' : 'vectorengine',
        statusCode: response.status,
      });

      incrementCounter(Metrics.CHAT_ERROR_COUNT, 1, {
        provider: useOpenRouter ? 'openrouter' : 'vectorengine',
        statusCode: String(response.status),
      });

      const responseHeaders = new Headers({
        'Content-Type': 'application/json',
        ...getCorsHeaders(origin),
        'X-Request-ID': requestId,
      });
      addSecurityHeaders(responseHeaders);
      addRateLimitHeaders(
        responseHeaders,
        rateLimitResult.remaining,
        rateLimitResult.resetAt,
        RATE_LIMITS.chat.maxRequests
      );

      return new Response(
        JSON.stringify({
          response:
            "I'm having trouble connecting right now. Please try again in a moment, or browse our FAQ pages for answers.",
          sessionId,
        }),
        { status: 200, headers: responseHeaders }
      );
    }

    const data = await response.json();
    const assistantMessage =
      data.choices?.[0]?.message?.content || 'I apologize, but I could not generate a response.';

    const duration = performance.now() - start;
    recordHistogram(Metrics.CHAT_REQUEST_DURATION, duration, {
      provider: useOpenRouter ? 'openrouter' : 'vectorengine',
      status: 'success',
    });
    recordHistogram(Metrics.API_REQUEST_DURATION, duration, {
      endpoint: 'chat',
      status: 'success',
    });
    incrementCounter(Metrics.CHAT_REQUEST_COUNT, 1, {
      provider: useOpenRouter ? 'openrouter' : 'vectorengine',
    });
    incrementCounter(Metrics.API_REQUEST_COUNT, 1, { endpoint: 'chat' });

    // Track token usage if available
    if (data.usage) {
      incrementCounter(Metrics.CHAT_TOKEN_COUNT, data.usage.total_tokens || 0, {
        provider: useOpenRouter ? 'openrouter' : 'vectorengine',
      });
    }

    logger.info('Chat response sent', {
      requestId,
      sessionId,
      provider: useOpenRouter ? 'openrouter' : 'vectorengine',
      duration,
      responseLength: assistantMessage.length,
    });

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      ...getCorsHeaders(origin),
      'X-Request-ID': requestId,
    });
    addSecurityHeaders(responseHeaders);
    addRateLimitHeaders(
      responseHeaders,
      rateLimitResult.remaining,
      rateLimitResult.resetAt,
      RATE_LIMITS.chat.maxRequests
    );

    return new Response(
      JSON.stringify({
        response: assistantMessage,
        sessionId,
      }),
      { status: 200, headers: responseHeaders }
    );
  } catch (error) {
    const duration = performance.now() - start;
    recordHistogram(Metrics.API_REQUEST_DURATION, duration, {
      endpoint: 'chat',
      status: 'error',
    });
    incrementCounter(Metrics.CHAT_ERROR_COUNT, 1, {
      error: error instanceof Error ? error.name : 'unknown',
    });

    captureError(error, {
      requestId,
      endpoint: 'chat',
    });

    logger.error('Chat API error', error, {
      requestId,
      duration,
    });

    const responseHeaders = new Headers({
      'Content-Type': 'application/json',
      ...getCorsHeaders(origin),
      'X-Request-ID': requestId,
    });
    addSecurityHeaders(responseHeaders);

    return new Response(
      JSON.stringify({
        error: 'Failed to process chat request',
        response: 'Sorry, something went wrong. Please try again.',
      }),
      { status: 500, headers: responseHeaders }
    );
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  return corsOptionsResponse(request.headers.get('origin'));
};
