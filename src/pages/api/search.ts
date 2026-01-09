/**
 * Search API Endpoint
 *
 * Provides search functionality using PostgreSQL full-text search and trigram matching.
 * Returns JSON response with matching questions.
 */

import type { APIRoute } from "astro";
import { searchQuestionsWithFallback } from "../../lib/supabase";

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100);

  if (!query.trim() || query.length < 2) {
    return new Response(JSON.stringify({ results: [], query: "" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { results, fallback } = await searchQuestionsWithFallback(query, limit);

    return new Response(
      JSON.stringify({
        results,
        query,
        fallback,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Search API error:", error);
    return new Response(
      JSON.stringify({ error: "Search failed", results: [] }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
