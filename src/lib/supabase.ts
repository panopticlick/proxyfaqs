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

// Database configuration
const supabaseUrl =
  import.meta.env.PUBLIC_SUPABASE_URL || "http://localhost:54321";
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || "";

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
    order?: { column: string; ascending?: boolean };
    limit?: number;
    offset?: number;
    textSearch?: { column: string; query: string };
    count?: boolean;
    head?: boolean;
  } = {},
): Promise<{
  data: T[] | null;
  error: { message: string; code?: string } | null;
  count?: number;
}> {
  try {
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

    // Text search
    if (options.textSearch) {
      url.searchParams.set(
        options.textSearch.column,
        `fts.${options.textSearch.query}`,
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

    const response = await fetch(url.toString(), {
      headers,
      method: options.head ? "HEAD" : "GET",
    });

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
    return { data: null, error: { message: err.message } };
  }
}

// Query helpers - using direct REST API calls
export async function getCategories(): Promise<Category[]> {
  const result = await supabaseRest<Category>("categories", {
    select: "*",
    order: { column: "question_count", ascending: false },
  });

  if (result.error) throw result.error;
  return result.data || [];
}

export async function getCategory(slug: string): Promise<Category | null> {
  const result = await supabaseRest<Category>("categories", {
    select: "*",
    eq: { slug },
    limit: 1,
  });

  if (result.error && result.error.code !== "PGRST116") throw result.error;
  return result.data?.[0] || null;
}

export async function getQuestionsByCategory(
  categorySlug: string,
  limit = 50,
  offset = 0,
): Promise<Question[]> {
  const result = await supabaseRest<Question>("questions", {
    select: "*",
    eq: { category_slug: categorySlug },
    order: { column: "view_count", ascending: false },
    limit,
    offset,
  });

  if (result.error) throw result.error;
  return result.data || [];
}

export async function getQuestion(slug: string): Promise<Question | null> {
  const result = await supabaseRest<Question>("questions", {
    select: "*",
    eq: { slug },
    limit: 1,
  });

  if (result.error && result.error.code !== "PGRST116") throw result.error;
  return result.data?.[0] || null;
}

export async function getRelatedQuestions(
  question: Question,
  limit = 5,
): Promise<Question[]> {
  const result = await supabaseRest<Question>("questions", {
    select: "*",
    eq: { category: question.category },
    neq: { id: question.id },
    order: { column: "view_count", ascending: false },
    limit,
  });

  if (result.error) throw result.error;
  return result.data || [];
}

export async function searchQuestions(
  query: string,
  limit = 20,
): Promise<Question[]> {
  const result = await supabaseRest<Question>("questions", {
    select: "*",
    textSearch: { column: "search_vector", query },
    limit,
  });

  if (result.error) throw result.error;
  return result.data || [];
}

export async function getProviders(): Promise<Provider[]> {
  const result = await supabaseRest<Provider>("providers", {
    select: "*",
    order: { column: "rank", ascending: true },
  });

  if (result.error) throw result.error;
  return result.data || [];
}

export async function getProvider(slug: string): Promise<Provider | null> {
  const result = await supabaseRest<Provider>("providers", {
    select: "*",
    eq: { slug },
    limit: 1,
  });

  if (result.error && result.error.code !== "PGRST116") throw result.error;
  return result.data?.[0] || null;
}

export async function getPopularQuestions(limit = 10): Promise<Question[]> {
  const result = await supabaseRest<Question>("questions", {
    select: "*",
    order: { column: "view_count", ascending: false },
    limit,
  });

  if (result.error) throw result.error;
  return result.data || [];
}

export async function incrementViewCount(_questionId: string): Promise<void> {
  // RPC not implemented for API key auth - silently skip
  console.warn("incrementViewCount: RPC not implemented for API key auth");
}

// For static site generation - get all slugs
export async function getAllQuestionSlugs(): Promise<string[]> {
  const result = await supabaseRest<{ slug: string }>("questions", {
    select: "slug",
  });

  if (result.error) throw result.error;
  return (result.data || []).map((q) => q.slug);
}

export async function getAllCategorySlugs(): Promise<string[]> {
  const result = await supabaseRest<{ slug: string }>("categories", {
    select: "slug",
  });

  if (result.error) throw result.error;
  return (result.data || []).map((c) => c.slug);
}

export async function getAllProviderSlugs(): Promise<string[]> {
  const result = await supabaseRest<{ slug: string }>("providers", {
    select: "slug",
  });

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
