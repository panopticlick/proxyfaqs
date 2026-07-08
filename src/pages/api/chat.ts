/**
 * Chat API Endpoint
 *
 * Production-grade AI chat with:
 * - Multi-provider support (OpenRouter primary, VectorEngine fallback)
 * - API key rotation for high availability
 * - Rate limiting per IP
 * - Request validation and sanitization
 * - Automatic retry with exponential backoff
 */

import type { APIRoute } from "astro";
import { corsOptionsResponse } from "../../lib/security";

export const prerender = false;

// Configuration
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const VECTORENGINE_BASE_URL = "https://api.vectorengine.ai";
const MAX_MESSAGE_LENGTH = 1000;
const CHAT_TIMEOUT_MS = 20000;
const MAX_RETRIES = 2;
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

// Rate limiting
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

type RuntimeEnv = Record<string, unknown>;
let currentKeyIndex = 0;

function getRuntimeString(runtimeEnv: RuntimeEnv | undefined, key: string, fallback = ""): string {
  const value = runtimeEnv?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function getOpenRouterKeys(runtimeEnv: RuntimeEnv | undefined): string[] {
  const value = getRuntimeString(runtimeEnv, "OPENROUTER_API_KEY");
  return value ? value.split(",").map((k) => k.trim()).filter(Boolean) : [];
}

function getOpenRouterModels(runtimeEnv: RuntimeEnv | undefined): string[] {
  const primary = getRuntimeString(runtimeEnv, "OPENROUTER_MODEL", "google/gemini-2.5-flash-lite");
  const fallbacks = getRuntimeString(runtimeEnv, "OPENROUTER_FALLBACK_MODELS");
  return [primary, ...fallbacks.split(",").map((model) => model.trim())]
    .filter((model, index, all) => model && all.indexOf(model) === index);
}

function getNextOpenRouterKey(openRouterKeys: string[]): string | null {
  if (openRouterKeys.length === 0) return null;
  const key = openRouterKeys[currentKeyIndex % openRouterKeys.length];
  currentKeyIndex = (currentKeyIndex + 1) % openRouterKeys.length;
  return key;
}

const SYSTEM_PROMPT = `You are the ProxyFAQs research assistant. Answer like a senior proxy and web-data operator who writes from a vendor-neutral research desk, not like a salesperson.

Your expertise includes:
- Residential, datacenter, mobile, and rotating proxies
- Anti-detection techniques and fingerprinting
- Rate limiting and request throttling strategies
- Handling CAPTCHAs and JavaScript challenges
- Legal and ethical considerations of web scraping

When answering:
1. Be technical but accessible - explain complex concepts simply
2. Recommend specific proxy types based on the user's use case
3. When recommending providers, explain WHY based on their specific needs and mention at least one watchout or limitation
4. Distinguish raw proxy vendors from scraper APIs, browser APIs, and actor/workflow platforms
5. Treat Bright Data as both a proxy-network vendor and a managed data-access stack when relevant
6. Treat Apify as an actor/workflow or scraping-tool recommendation, not as a generic residential/mobile proxy recommendation
7. Do not invent current pricing, rankings, or “personally tested” claims. If pricing is mentioned, say it may drift and should be verified on the official page
8. CRITICAL: When including ANY affiliate link or provider recommendation, ALWAYS add this exact disclosure at the end: "**Affiliate Disclosure: Some links below are affiliate links. We may earn a commission at no cost to you.**"
9. Acknowledge limitations and edge cases
10. Provide code examples in Python when helpful

Current page context will be provided to help you give relevant answers.`;

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

function sanitizeMessage(message: string): string {
  return message
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/[<>]/g, "");
}

async function callAIProvider(
  messages: Array<{ role: string; content: string }>,
  provider: "openrouter" | "vectorengine",
  runtimeEnv: RuntimeEnv | undefined,
  retryCount = 0,
  modelOverride?: string,
): Promise<{ success: boolean; response?: string; error?: string; statusCode?: number }> {
  const openRouterKeys = getOpenRouterKeys(runtimeEnv);
  const apiKey = provider === "openrouter"
    ? getNextOpenRouterKey(openRouterKeys)
    : getRuntimeString(runtimeEnv, "VECTORENGINE_API_KEY");

  if (!apiKey) {
    return { success: false, error: "No API key available" };
  }

  const apiUrl = provider === "openrouter"
    ? `${OPENROUTER_BASE_URL}/chat/completions`
    : `${getRuntimeString(runtimeEnv, "VECTORENGINE_BASE_URL", VECTORENGINE_BASE_URL)}/v1/chat/completions`;

  const model = provider === "openrouter"
    ? (modelOverride || getRuntimeString(runtimeEnv, "OPENROUTER_MODEL", "google/gemini-2.5-flash-lite"))
    : "grok-4-fast-non-reasoning";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://proxyfaqs.com";
    headers["X-Title"] = "ProxyFAQs";
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 600,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`${provider} API error (${response.status}):`, errorText);

      // Retry with backoff for transient errors
      if (retryCount < MAX_RETRIES && (response.status >= 500 || response.status === 429)) {
        await new Promise((r) => setTimeout(r, Math.pow(2, retryCount) * 1000));
        return callAIProvider(messages, provider, runtimeEnv, retryCount + 1, modelOverride);
      }

      return { success: false, error: `API returned ${response.status}`, statusCode: response.status };
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return { success: false, error: "Empty response from API" };
    }

    return { success: true, response: content };
  } catch (error) {
    clearTimeout(timeoutId);
    const err = error as Error;

    if (err.name === "AbortError") {
      return { success: false, error: "Request timed out" };
    }

    console.error(`${provider} API error:`, err.message);

    // Retry for network errors
    if (retryCount < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, Math.pow(2, retryCount) * 1000));
      return callAIProvider(messages, provider, runtimeEnv, retryCount + 1, modelOverride);
    }

    return { success: false, error: err.message };
  }
}

async function callOpenRouterFallback(
  messages: Array<{ role: string; content: string }>,
  runtimeEnv: RuntimeEnv | undefined,
): Promise<{ success: boolean; response?: string; error?: string; statusCode?: number }> {
  const openRouterModels = getOpenRouterModels(runtimeEnv);
  let lastResult: { success: boolean; response?: string; error?: string; statusCode?: number } = {
    success: false,
    error: "No OpenRouter model configured",
  };

  for (const model of openRouterModels) {
    const result = await callAIProvider(messages, "openrouter", runtimeEnv, 0, model);
    if (result.success) {
      return result;
    }

    lastResult = result;

    // 429s and 5xxs are the most common transient provider/model failures.
    // Try the next configured model before falling back to another provider.
    if (result.statusCode && result.statusCode !== 429 && result.statusCode < 500) {
      break;
    }
  }

  return lastResult;
}

// Cloudflare Workers forbid timers in the global scope, so clean up expired
// rate-limit entries opportunistically (throttled) inside the request handler.
let lastCleanup = 0;
function cleanupRateLimits(now: number): void {
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  const runtimeEnv = (locals as { runtime?: { env?: RuntimeEnv } })?.runtime?.env;
  const clientIP = getClientIP(request);

  const nowTs = Date.now();
  if (nowTs - lastCleanup > RATE_LIMIT_WINDOW_MS) {
    cleanupRateLimits(nowTs);
    lastCleanup = nowTs;
  }

  // Rate limiting
  const rateLimit = checkRateLimit(clientIP);
  const rateLimitHeaders = {
    "X-RateLimit-Limit": RATE_LIMIT_MAX_REQUESTS.toString(),
    "X-RateLimit-Remaining": rateLimit.remaining.toString(),
    "X-RateLimit-Reset": Math.ceil(rateLimit.resetIn / 1000).toString(),
  };

  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        response: "You've sent too many messages. Please wait a moment before trying again.",
        retryAfter: Math.ceil(rateLimit.resetIn / 1000),
      }),
      {
        status: 429,
        headers: { ...JSON_HEADERS, "Retry-After": Math.ceil(rateLimit.resetIn / 1000).toString(), ...rateLimitHeaders },
      },
    );
  }

  try {
    const body = await request.json();
    const { message, sessionId, pageContext } = body;

    const trimmedMessage = sanitizeMessage(typeof message === "string" ? message : "");

    if (!trimmedMessage) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...JSON_HEADERS, ...rateLimitHeaders } },
      );
    }

    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return new Response(
        JSON.stringify({
          error: "Message too long",
          response: `Please keep your message under ${MAX_MESSAGE_LENGTH} characters.`,
        }),
        { status: 400, headers: { ...JSON_HEADERS, ...rateLimitHeaders } },
      );
    }

    // Check for available providers
    const hasOpenRouter = getOpenRouterKeys(runtimeEnv).length > 0;
    const hasVectorEngine = !!getRuntimeString(runtimeEnv, "VECTORENGINE_API_KEY");

    if (!hasOpenRouter && !hasVectorEngine) {
      return new Response(
        JSON.stringify({
          response: "I'm your proxy assistant! For the best experience, please ensure the API is configured. In the meantime, you can browse our FAQ pages or compare providers.",
          sessionId,
        }),
        { status: 200, headers: { ...JSON_HEADERS, ...rateLimitHeaders } },
      );
    }

    // Build messages
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    if (pageContext && typeof pageContext === "string") {
      const sanitizedContext = pageContext.trim().slice(0, 200).replace(/[<>]/g, "");
      if (sanitizedContext) {
        messages.push({
          role: "system",
          content: `The user is currently viewing: ${sanitizedContext}`,
        });
      }
    }

    messages.push({ role: "user", content: trimmedMessage });

    // Try OpenRouter first, then VectorEngine
    let result = hasOpenRouter
      ? await callOpenRouterFallback(messages, runtimeEnv)
      : { success: false, error: "No OpenRouter key" };

    if (!result.success && hasVectorEngine) {
      console.log("Falling back to VectorEngine");
      result = await callAIProvider(messages, "vectorengine", runtimeEnv);
    }

    if (result.success && result.response) {
      return new Response(
        JSON.stringify({ response: result.response, sessionId }),
        { status: 200, headers: { ...JSON_HEADERS, ...rateLimitHeaders } },
      );
    }

    // All providers failed
    return new Response(
      JSON.stringify({
        response: "I'm having trouble connecting right now. Please try again in a moment, or browse our FAQ pages for answers.",
        sessionId,
      }),
      { status: 200, headers: { ...JSON_HEADERS, ...rateLimitHeaders } },
    );
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process request",
        response: "Sorry, something went wrong. Please try again.",
      }),
      { status: 500, headers: { ...JSON_HEADERS, ...rateLimitHeaders } },
    );
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  return corsOptionsResponse(request.headers.get('origin'));
};
