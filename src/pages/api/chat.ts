/**
 * Chat API Endpoint
 *
 * Proxies chat requests to OpenRouter API (free models) or VectorEngine fallback.
 * Uses google/gemini-2.0-flash-exp:free model for quick responses.
 *
 * IMPORTANT: In production, this should be deployed as a Cloudflare Worker
 * to protect the API key. For local development, we use this endpoint.
 */

import type { APIRoute } from "astro";

import { env } from "../../lib/env";

export const prerender = false;

// OpenRouter (primary - free models)
const OPENROUTER_API_KEY = env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = env.OPENROUTER_MODEL;
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// VectorEngine (fallback)
const VECTORENGINE_API_KEY = env.VECTORENGINE_API_KEY;
const VECTORENGINE_BASE_URL = env.VECTORENGINE_BASE_URL;

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
4. Include affiliate links naturally when relevant (always disclosed)
5. Acknowledge limitations and edge cases
6. Provide code examples in Python when helpful

Current page context will be provided to help you give relevant answers.`;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { message, sessionId, pageContext } = await request.json();

    if (!message || !message.trim()) {
      return new Response(JSON.stringify({ error: "Message is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Check for available API key
    const useOpenRouter = !!OPENROUTER_API_KEY;
    const useVectorEngine = !useOpenRouter && !!VECTORENGINE_API_KEY;

    if (!useOpenRouter && !useVectorEngine) {
      // Return a helpful fallback response when no API key is configured
      return new Response(
        JSON.stringify({
          response:
            "I'm your proxy assistant! For the best experience, please ensure the API is configured. In the meantime, you can browse our FAQ pages or compare providers.",
          sessionId,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Build messages array
    const messages = [{ role: "system", content: SYSTEM_PROMPT }];

    // Add page context if available
    if (pageContext) {
      messages.push({
        role: "system",
        content: `The user is currently viewing: ${pageContext}`,
      });
    }

    messages.push({ role: "user", content: message });

    // Call API (OpenRouter primary, VectorEngine fallback)
    const apiUrl = useOpenRouter
      ? `${OPENROUTER_BASE_URL}/chat/completions`
      : `${VECTORENGINE_BASE_URL}/v1/chat/completions`;

    const apiKey = useOpenRouter ? OPENROUTER_API_KEY : VECTORENGINE_API_KEY;
    const model = useOpenRouter ? OPENROUTER_MODEL : "grok-4-fast-non-reasoning";

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    // OpenRouter requires these headers
    if (useOpenRouter) {
      headers["HTTP-Referer"] = "https://proxyfaqs.com";
      headers["X-Title"] = "ProxyFAQs";
    }

    const response = await fetch(apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error:", errorText);

      return new Response(
        JSON.stringify({
          response:
            "I'm having trouble connecting right now. Please try again in a moment, or browse our FAQ pages for answers.",
          sessionId,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const data = await response.json();
    const assistantMessage =
      data.choices?.[0]?.message?.content ||
      "I apologize, but I could not generate a response.";

    return new Response(
      JSON.stringify({
        response: assistantMessage,
        sessionId,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Chat API error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process chat request",
        response: "Sorry, something went wrong. Please try again.",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
