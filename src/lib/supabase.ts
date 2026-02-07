/**
 * Supabase Database Client
 *
 * This module provides typed database access for the ProxyFAQs application.
 * It connects to the PostgreSQL database on the 107.174.42.198 server
 * using the proxyfaqs schema.
 *
 * NOTE: This self-hosted Supabase uses API key authentication (not JWT).
 * We use direct REST API calls for SSG compatibility.
 */

import { env } from "./env";

type RuntimeEnv = Record<string, unknown>;

function getSupabaseConfig(runtimeEnv?: RuntimeEnv): {
  url: string;
  anonKey: string;
  timeoutMs: number;
} {
  const rawUrl =
    (typeof runtimeEnv?.PUBLIC_SUPABASE_URL === "string" &&
      runtimeEnv.PUBLIC_SUPABASE_URL) ||
    (typeof runtimeEnv?.SUPABASE_URL === "string" && runtimeEnv.SUPABASE_URL) ||
    env.PUBLIC_SUPABASE_URL;

  const rawAnonKey =
    (typeof runtimeEnv?.PUBLIC_SUPABASE_ANON_KEY === "string" &&
      runtimeEnv.PUBLIC_SUPABASE_ANON_KEY) ||
    (typeof runtimeEnv?.SUPABASE_ANON_KEY === "string" &&
      runtimeEnv.SUPABASE_ANON_KEY) ||
    env.PUBLIC_SUPABASE_ANON_KEY;

  const rawTimeoutMs =
    (typeof runtimeEnv?.SUPABASE_TIMEOUT_MS === "string" ||
    typeof runtimeEnv?.SUPABASE_TIMEOUT_MS === "number")
      ? Number(runtimeEnv.SUPABASE_TIMEOUT_MS)
      : env.SUPABASE_TIMEOUT_MS;

  const timeoutMs =
    Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0
      ? rawTimeoutMs
      : env.SUPABASE_TIMEOUT_MS;

  return {
    url: rawUrl,
    anonKey: rawAnonKey,
    timeoutMs,
  };
}

// Type definitions for database tables
export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  question_count: number;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  slug: string;
  question: string;
  answer: string;
  answer_html: string | null;
  category: string;
  category_slug: string | null;
  source_keyword: string | null;
  source_url: string | null;
  meta_title: string | null;
  meta_description: string | null;
  view_count: number;
  created_at: string;
  updated_at: string;
}

export interface Provider {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  features: Record<string, unknown>;
  pricing: Record<string, unknown>;
  pros: string[];
  cons: string[];
  affiliate_url: string | null;
  affiliate_code: string | null;
  rating: number | null;
  review_count?: number | null;
  rank: number | null;
  review_html: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSession {
  id: string;
  session_id: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  page_context: string | null;
  created_at: string;
  last_active: string;
}

export interface Keyword {
  id: string;
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cluster: string | null;
  page_slug: string | null;
  created_at: string;
}

// Direct REST API helper for self-hosted Supabase with API key auth
async function supabaseRest<T>(
  table: string,
  options: {
    select?: string;
    eq?: Record<string, string>;
    neq?: Record<string, string>;
    ilike?: Record<string, string>;
    order?: { column: string; ascending?: boolean };
    limit?: number;
    offset?: number;
    textSearch?: {
      column: string;
      query: string;
      type?: "plain" | "phrase" | "websearch" | "tsquery";
    };
    count?: boolean;
    head?: boolean;
  } = {},
  runtimeEnv?: RuntimeEnv,
): Promise<{
  data: T[] | null;
  error: { message: string; code?: string } | null;
  count?: number;
}> {
  try {
    const { url: supabaseUrl, anonKey: supabaseAnonKey, timeoutMs: supabaseTimeoutMs } =
      getSupabaseConfig(runtimeEnv);

    if (!supabaseUrl) {
      return {
        data: null,
        error: { message: "Supabase URL not configured" },
      };
    }

    if (!supabaseAnonKey) {
      return {
        data: null,
        error: { message: "Supabase anon key not configured" },
      };
    }

    const url = new URL(`${supabaseUrl}/rest/v1/${table}`);

    // Select columns
    if (options.select) {
      url.searchParams.set("select", options.select);
    }

    // Equality filters
    if (options.eq) {
      for (const [key, value] of Object.entries(options.eq)) {
        url.searchParams.set(key, `eq.${value}`);
      }
    }

    // Not equal filters
    if (options.neq) {
      for (const [key, value] of Object.entries(options.neq)) {
        url.searchParams.set(key, `neq.${value}`);
      }
    }

    // ILIKE filters
    if (options.ilike) {
      for (const [key, value] of Object.entries(options.ilike)) {
        url.searchParams.set(key, `ilike.${value}`);
      }
    }

    // Text search
    if (options.textSearch) {
      const searchType = options.textSearch.type || "plain";
      const operator =
        searchType === "websearch"
          ? "wfts"
          : searchType === "phrase"
            ? "phfts"
            : searchType === "tsquery"
              ? "fts"
              : "plfts";

      url.searchParams.set(
        options.textSearch.column,
        `${operator}.${options.textSearch.query}`,
      );
    }

    // Order
    if (options.order) {
      url.searchParams.set(
        "order",
        `${options.order.column}.${options.order.ascending ? "asc" : "desc"}.nullslast`,
      );
    }

    // Limit
    if (options.limit) {
      url.searchParams.set("limit", options.limit.toString());
    }

    // Offset
    if (options.offset) {
      url.searchParams.set("offset", options.offset.toString());
    }

    const headers: Record<string, string> = {
      apikey: supabaseAnonKey,
      "Content-Type": "application/json",
      "Accept-Profile": "proxyfaqs",
    };

    if (options.count) {
      headers["Prefer"] = "count=exact";
    }

    if (options.head) {
      headers["Prefer"] = "count=exact";
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), supabaseTimeoutMs);

    let response: Response;
    try {
      response = await fetch(url.toString(), {
        headers,
        method: options.head ? "HEAD" : "GET",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ message: "API Error" }));
      return {
        data: null,
        error: {
          message: errorData.message || "API Error",
          code: errorData.code,
        },
      };
    }

    let count: number | undefined;
    if (options.count || options.head) {
      const contentRange = response.headers.get("content-range");
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)/);
        if (match) {
          count = parseInt(match[1], 10);
        }
      }
    }

    if (options.head) {
      return { data: [], error: null, count };
    }

    const data = await response.json();
    return { data, error: null, count };
  } catch (error) {
    const err = error as Error;
    const message =
      err.name === "AbortError"
        ? "Supabase request timed out"
        : err.message;
    return { data: null, error: { message } };
  }
}

function normalizeSearchQuery(input: string): string {
  const MAX_TERMS = 8;
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

// Query helpers - using direct REST API calls
export async function getCategories(): Promise<Category[]> {
  const result = await supabaseRest<Category>(
    "categories",
    {
    select: "*",
    order: { column: "question_count", ascending: false },
    },
  );

  if (result.error) throw result.error;
  return result.data || [];
}

export async function getCategory(slug: string): Promise<Category | null> {
  const result = await supabaseRest<Category>(
    "categories",
    {
    select: "*",
    eq: { slug },
    limit: 1,
    },
  );

  if (result.error && result.error.code !== "PGRST116") throw result.error;
  return result.data?.[0] || null;
}

export async function getQuestionsByCategory(
  categorySlug: string,
  limit = 50,
  offset = 0,
): Promise<Question[]> {
  const result = await supabaseRest<Question>(
    "questions",
    {
    select: "*",
    eq: { category_slug: categorySlug },
    order: { column: "view_count", ascending: false },
    limit,
    offset,
    },
  );

  if (result.error) throw result.error;
  return result.data || [];
}

export async function getQuestion(
  slug: string,
  runtimeEnv?: RuntimeEnv,
): Promise<Question | null> {
  const result = await supabaseRest<Question>(
    "questions",
    {
    select: "*",
    eq: { slug },
    limit: 1,
    },
    runtimeEnv,
  );

  if (result.error && result.error.code !== "PGRST116") throw result.error;
  return result.data?.[0] || null;
}

/**
 * Get related questions using keyword-based similarity search.
 * Strategy:
 * 1. Extract keywords from the question title
 * 2. Use full-text search to find semantically similar questions
 * 3. Fallback to same-category popular questions if needed
 */
export async function getRelatedQuestions(
  question: Question,
  limit = 5,
  runtimeEnv?: RuntimeEnv,
): Promise<Question[]> {
  // Extract meaningful keywords from the question (remove stop words)
  const stopWords = new Set([
    "what", "how", "why", "when", "where", "which", "who", "is", "are", "do",
    "does", "can", "could", "should", "would", "the", "a", "an", "in", "on",
    "at", "to", "for", "of", "with", "and", "or", "but", "not", "be", "have",
    "has", "was", "were", "been", "being", "will", "your", "you", "i", "my",
    "it", "its", "this", "that", "these", "those", "there", "here", "from",
    "about", "into", "through", "during", "before", "after", "above", "below",
  ]);

  const keywords = question.question
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stopWords.has(word))
    .slice(0, 6); // Take top 6 keywords

  if (keywords.length > 0) {
    // Use OR-based full-text search for better recall
    const searchQuery = keywords.join(" | ");

    const result = await supabaseRest<Question>("questions", {
      select: "*",
      neq: { id: question.id },
      textSearch: { column: "search_vector", query: searchQuery, type: "plain" },
      limit: limit + 5, // Get extra to filter
    }, runtimeEnv);

    if (!result.error && result.data && result.data.length > 0) {
      // Prefer questions from same category, then by view count
      const sorted = result.data.sort((a, b) => {
        const aSameCategory = a.category === question.category ? 1 : 0;
        const bSameCategory = b.category === question.category ? 1 : 0;
        if (aSameCategory !== bSameCategory) return bSameCategory - aSameCategory;
        return (b.view_count || 0) - (a.view_count || 0);
      });
      return sorted.slice(0, limit);
    }
  }

  // Fallback: same category popular questions
  const fallback = await supabaseRest<Question>("questions", {
    select: "*",
    eq: { category: question.category },
    neq: { id: question.id },
    order: { column: "view_count", ascending: false },
    limit,
  }, runtimeEnv);

  if (fallback.error) throw fallback.error;
  return fallback.data || [];
}

export async function searchQuestions(
  query: string,
  limit = 20,
  runtimeEnv?: RuntimeEnv,
): Promise<Question[]> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return [];

  const result = await supabaseRest<Question>(
    "questions",
    {
    select: "*",
    textSearch: { column: "search_vector", query: normalized, type: "plain" },
    limit,
    },
    runtimeEnv,
  );

  if (result.error) throw result.error;
  return result.data || [];
}

export async function searchQuestionsWithFallback(
  query: string,
  limit = 20,
  runtimeEnv?: RuntimeEnv,
): Promise<{ results: Question[]; fallback: boolean }> {
  const normalized = normalizeSearchQuery(query);
  if (!normalized) return { results: [], fallback: false };

  const primary = await supabaseRest<Question>(
    "questions",
    {
    select: "id, slug, question, answer, category, view_count",
    textSearch: { column: "search_vector", query: normalized, type: "plain" },
    limit,
    },
    runtimeEnv,
  );

  if (!primary.error) {
    return { results: primary.data || [], fallback: false };
  }

  const fallback = await supabaseRest<Question>(
    "questions",
    {
    select: "id, slug, question, answer, category, view_count",
    ilike: { question: `%${normalized}%` },
    limit,
    },
    runtimeEnv,
  );

  if (fallback.error) throw fallback.error;
  return { results: fallback.data || [], fallback: true };
}

export async function getProviders(): Promise<Provider[]> {
  const result = await supabaseRest<Provider>(
    "providers",
    {
    select: "*",
    order: { column: "rank", ascending: true },
    },
  );

  if (result.error) throw result.error;
  return result.data || [];
}

export async function getProvider(slug: string): Promise<Provider | null> {
  const result = await supabaseRest<Provider>(
    "providers",
    {
    select: "*",
    eq: { slug },
    limit: 1,
    },
  );

  if (result.error && result.error.code !== "PGRST116") throw result.error;
  return result.data?.[0] || null;
}

export async function getPopularQuestions(limit = 10): Promise<Question[]> {
  const result = await supabaseRest<Question>(
    "questions",
    {
    select: "*",
    order: { column: "view_count", ascending: false },
    limit,
    },
  );

  if (result.error) throw result.error;
  return result.data || [];
}

export async function incrementViewCount(_questionId: string): Promise<void> {
  // RPC not implemented for API key auth - silently skip
  console.warn("incrementViewCount: RPC not implemented for API key auth");
}

// For static site generation - get all slugs
export async function getAllQuestionSlugs(): Promise<string[]> {
  const result = await supabaseRest<{ slug: string }>(
    "questions",
    {
    select: "slug",
    },
  );

  if (result.error) throw result.error;
  return (result.data || []).map((q) => q.slug);
}

export async function getAllCategorySlugs(): Promise<string[]> {
  const result = await supabaseRest<{ slug: string }>(
    "categories",
    {
    select: "slug",
    },
  );

  if (result.error) throw result.error;
  return (result.data || []).map((c) => c.slug);
}

export async function getAllProviderSlugs(): Promise<string[]> {
  const result = await supabaseRest<{ slug: string }>(
    "providers",
    {
    select: "slug",
    },
  );

  if (result.error) throw result.error;
  return (result.data || [])
    .map((p) => p.slug)
    .filter((slug) => slug && slug.trim() !== "");
}

// Stats for homepage
export async function getStats(): Promise<{
  totalQuestions: number;
  totalCategories: number;
  totalProviders: number;
}> {
  const [questions, categories, providers] = await Promise.all([
    supabaseRest("questions", { select: "id", count: true, head: true }),
    supabaseRest("categories", { select: "id", count: true, head: true }),
    supabaseRest("providers", { select: "id", count: true, head: true }),
  ]);

  return {
    totalQuestions: questions.count || 0,
    totalCategories: categories.count || 0,
    totalProviders: providers.count || 0,
  };
}

// Legacy export for compatibility (minimal implementation)
export const supabase = {
  from: (table: string) => ({
    select: (columns = "*") => ({
      eq: (column: string, value: string) =>
        supabaseRest(table, { select: columns, eq: { [column]: value } }),
      single: async () => {
        const result = await supabaseRest<Record<string, unknown>>(table, {
          select: columns,
          limit: 1,
        });
        return { data: result.data?.[0] || null, error: result.error };
      },
    }),
  }),
  rpc: async (_fn: string, _params: Record<string, unknown>) => {
    console.warn("RPC not implemented for API key auth");
    return { data: null, error: null };
  },
};
