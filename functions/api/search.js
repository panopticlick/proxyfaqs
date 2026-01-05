const MAX_TERMS = 8;

function normalizeSearchQuery(input) {
  return input
    .toLowerCase()
    .replace(/[^\w\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .join(" ");
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

async function supabaseSearch({ baseUrl, anonKey, query, limit }) {
  const url = new URL(`${baseUrl}/rest/v1/questions`);
  url.searchParams.set("select", "id,slug,question,answer,category,view_count");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("search_vector", `plfts.${query}`);

  const response = await fetch(url.toString(), {
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
      "Accept-Profile": "proxyfaqs",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Search request failed");
  }

  return response.json();
}

async function supabaseFallback({ baseUrl, anonKey, query, limit }) {
  const url = new URL(`${baseUrl}/rest/v1/questions`);
  url.searchParams.set("select", "id,slug,question,answer,category,view_count");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("question", `ilike.%${query}%`);

  const response = await fetch(url.toString(), {
    headers: {
      apikey: anonKey,
      "Content-Type": "application/json",
      "Accept-Profile": "proxyfaqs",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Fallback search request failed");
  }

  return response.json();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "20", 10),
    100,
  );

  if (!query.trim() || query.length < 2) {
    return jsonResponse({ results: [], query: "" });
  }

  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return jsonResponse({ results: [], query: "" });
  }

  const baseUrl = env.PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const anonKey = env.PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY;

  if (!baseUrl || !anonKey) {
    return jsonResponse(
      { results: [], query, error: "Search unavailable" },
      200,
    );
  }

  try {
    const results = await supabaseSearch({
      baseUrl,
      anonKey,
      query: normalized,
      limit,
    });
    return jsonResponse({ results: results || [], query, fallback: false });
  } catch (error) {
    try {
      const results = await supabaseFallback({
        baseUrl,
        anonKey,
        query: normalized,
        limit,
      });
      return jsonResponse({ results: results || [], query, fallback: true });
    } catch (fallbackError) {
      return jsonResponse({ results: [], query, error: "Search failed" }, 500);
    }
  }
}
