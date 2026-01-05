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

const AFFILIATE_PROVIDERS = {
  residential: [
    {
      name: "BrightData",
      href: "https://get.brightdata.com/luminati-proxy",
      reason: "enterprise coverage and geo targeting",
    },
    {
      name: "Soax",
      href: "https://soax.com/?r=cUgaoF3u",
      reason: "flexible rotation and residential quality",
    },
    {
      name: "Smartproxy",
      href: "https://smartproxy.pxf.io/deals",
      reason: "balanced pricing and coverage",
    },
  ],
  datacenter: [
    {
      name: "Proxy-Seller",
      href: "https://proxy-seller.com/?partner=REVhIGcljl3h0",
      reason: "fast datacenter IPs with stable uptime",
    },
    {
      name: "Webshare",
      href: "https://proxy.webshare.io/register/?referral_code=xn5m7d467sbh",
      reason: "cost-effective datacenter pools",
    },
    {
      name: "Rayobyte",
      href: "https://billing.rayobyte.com/hosting/aff.php?aff=455&to=http://rayobyte.com/",
      reason: "reliable datacenter infrastructure",
    },
  ],
  mobile: [
    {
      name: "TheSocialProxy",
      href: "https://thesocialproxy.com/?ref=privateproxyreviews@gmail.com",
      reason: "mobile IPs for social automation",
    },
    {
      name: "Proxy-Cheap",
      href: "https://app.proxy-cheap.com/r/mRP1Si",
      reason: "budget-friendly mobile options",
    },
    {
      name: "Soax",
      href: "https://soax.com/?r=cUgaoF3u",
      reason: "flexible mobile rotation control",
    },
  ],
  scraping: [
    {
      name: "BrightData",
      href: "https://get.brightdata.com/luminati-proxy",
      reason: "strong anti-bot resilience",
    },
    {
      name: "Smartproxy",
      href: "https://smartproxy.pxf.io/deals",
      reason: "good coverage and straightforward setup",
    },
    {
      name: "Soax",
      href: "https://soax.com/?r=cUgaoF3u",
      reason: "stable pool and flexible session control",
    },
  ],
};

function inferProxyType(text) {
  const normalized = text.toLowerCase();
  if (
    normalized.includes("mobile") ||
    normalized.includes("instagram") ||
    normalized.includes("tiktok") ||
    normalized.includes("social")
  ) {
    return "mobile";
  }
  if (
    normalized.includes("datacenter") ||
    normalized.includes("data center") ||
    normalized.includes("cheap") ||
    normalized.includes("bulk")
  ) {
    return "datacenter";
  }
  if (
    normalized.includes("scraper api") ||
    normalized.includes("scraping api")
  ) {
    return "scraping";
  }
  return "residential";
}

function buildRecommendationContext(message, pageContext) {
  const contextText = `${message} ${pageContext || ""}`;
  const proxyType = inferProxyType(contextText);
  const providerList =
    AFFILIATE_PROVIDERS[proxyType] || AFFILIATE_PROVIDERS.residential;

  const providerLines = providerList
    .map(
      (provider) => `- ${provider.name}: ${provider.href} (${provider.reason})`,
    )
    .join("\n");

  return `Recommended proxy type: ${proxyType}. When suggesting providers, use these affiliate links and disclose affiliate status:\n${providerLines}`;
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const body = await request.json();
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const sessionId = body.sessionId || "";
    const pageContext = body.pageContext || "";

    if (!message) {
      return jsonResponse({ error: "Message is required" }, 400);
    }

    // OpenRouter (primary - free models)
    const openrouterKey = env.OPENROUTER_API_KEY || "";
    const openrouterModel =
      env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";

    // VectorEngine (fallback)
    const vectorengineKey = env.VECTORENGINE_API_KEY || "";
    const vectorengineUrl =
      env.VECTORENGINE_BASE_URL || "https://api.vectorengine.ai";

    const useOpenRouter = !!openrouterKey;
    const useVectorEngine = !useOpenRouter && !!vectorengineKey;

    if (!useOpenRouter && !useVectorEngine) {
      return jsonResponse({
        response:
          "I'm your proxy assistant! For the best experience, please ensure the API is configured. In the meantime, you can browse our FAQ pages or compare providers.",
        sessionId,
      });
    }

    const messages = [{ role: "system", content: SYSTEM_PROMPT }];

    if (pageContext) {
      messages.push({
        role: "system",
        content: `The user is currently viewing: ${pageContext}`,
      });
    }

    messages.push({
      role: "system",
      content: buildRecommendationContext(message, pageContext),
    });

    messages.push({ role: "user", content: message });

    // Build API request
    const apiUrl = useOpenRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : `${vectorengineUrl}/v1/chat/completions`;

    const apiKey = useOpenRouter ? openrouterKey : vectorengineKey;
    const model = useOpenRouter ? openrouterModel : "grok-4-fast-non-reasoning";

    const headers = {
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

      return jsonResponse({
        response:
          "I'm having trouble connecting right now. Please try again in a moment, or browse our FAQ pages for answers.",
        sessionId,
      });
    }

    const data = await response.json();
    const assistantMessage =
      data.choices?.[0]?.message?.content ||
      "I apologize, but I could not generate a response.";

    return jsonResponse({
      response: assistantMessage,
      sessionId,
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return jsonResponse(
      {
        error: "Failed to process chat request",
        response: "Sorry, something went wrong. Please try again.",
      },
      500,
    );
  }
}
