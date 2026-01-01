/**
 * Chat API Endpoint
 *
 * Proxies chat requests to VectorEngine API to hide the API key.
 * Uses grok-4-fast-non-reasoning model for quick responses.
 *
 * IMPORTANT: In production, this should be deployed as a Cloudflare Worker
 * to protect the API key. For local development, we use this endpoint.
 */

import type { APIRoute } from "astro";

const VECTORENGINE_API_KEY = import.meta.env.VECTORENGINE_API_KEY || "";
const VECTORENGINE_BASE_URL =
  import.meta.env.VECTORENGINE_BASE_URL || "https://api.vectorengine.ai";

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

    if (!VECTORENGINE_API_KEY) {
      // Return a helpful fallback response when API key is not configured
      return new Response(
        JSON.stringify({
          response:
            "I'm your proxy assistant! For the best experience, please ensure the VectorEngine API is configured. In the meantime, you can browse our FAQ pages or compare providers.",
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

    // Call VectorEngine API (OpenAI-compatible endpoint)
    const response = await fetch(
      `${VECTORENGINE_BASE_URL}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VECTORENGINE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-4-fast-non-reasoning",
          messages,
          max_tokens: 500,
          temperature: 0.7,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("VectorEngine API error:", errorText);

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
