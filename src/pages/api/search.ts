/**
 * Search API Endpoint
 *
 * Provides search functionality using PostgreSQL full-text search and trigram matching.
 * Returns JSON response with matching questions.
 */

import type { APIRoute } from "astro";
import { supabase } from "@/lib/supabase";

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
    // Use full-text search with trigram fallback
    const { data: results, error } = await supabase
      .from("questions")
      .select("id, slug, question, answer, category, view_count")
      .textSearch("search_vector", query.split(" ").join(" & "))
      .limit(limit);

    if (error) {
      console.error("Search error:", error);

      // Fallback to ILIKE search
      const { data: fallbackResults, error: fallbackError } = await supabase
        .from("questions")
        .select("id, slug, question, answer, category, view_count")
        .ilike("question", `%${query}%`)
        .limit(limit);

      if (fallbackError) throw fallbackError;

      return new Response(
        JSON.stringify({
          results: fallbackResults || [],
          query,
          fallback: true,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        results: results || [],
        query,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
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
