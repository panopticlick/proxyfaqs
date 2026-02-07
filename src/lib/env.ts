/**
 * Environment Configuration
 *
 * Centralized environment variable validation using Zod.
 * Supports both Node.js (process.env) and Vite (import.meta.env).
 */

import { z } from "zod";

function getRawEnv(): Record<string, unknown> {
  const raw: Record<string, unknown> = {};

  // Node.js environment
  if (typeof process !== "undefined" && process.env) {
    Object.assign(raw, process.env);
  }

  // Vite/Astro environment
  const importMetaEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env;
  if (importMetaEnv && typeof importMetaEnv === "object") {
    Object.assign(raw, importMetaEnv);
  }

  return raw;
}

const envSchema = z
  .object({
    // Site configuration
    SITE: z.string().url().default("https://proxyfaqs.com"),
    SITE_URL: z.string().url().default("https://proxyfaqs.com"),

    // Supabase configuration
    PUBLIC_SUPABASE_URL: z.string().url().default("http://supabase-kong:8000"),
    PUBLIC_SUPABASE_ANON_KEY: z.string().default(""),
    SUPABASE_URL: z.string().default(""),
    SUPABASE_SERVICE_KEY: z.string().default(""),
    SUPABASE_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),

    // VectorEngine AI (fallback)
    VECTORENGINE_API_KEY: z.string().default(""),
    VECTORENGINE_BASE_URL: z.string().url().default("https://api.vectorengine.ai"),

    // OpenRouter AI (primary)
    OPENROUTER_API_KEY: z.string().default(""),
    OPENROUTER_MODEL: z.string().default("google/gemini-2.0-flash-exp:free"),
    OPENROUTER_FALLBACK_MODELS: z.string().default(""),

    // Database configuration
    DB_HOST: z.string().default("supabase-db"),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_USER: z.string().default("postgres"),
    DB_PASSWORD: z.string().default(""),
    DB_NAME: z.string().default("postgres"),
    DB_SCHEMA: z.string().default("proxyfaqs"),
    DATABASE_URL: z.string().default(""),

    // Rate limiting
    RATE_LIMIT_ENABLED: z.string().default("true").transform((v) => v === "true"),
    RATE_LIMIT_CHAT_REQUESTS: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_CHAT_WINDOW: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_SEARCH_REQUESTS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_SEARCH_WINDOW: z.coerce.number().int().positive().default(60),

    // Build configuration
    PSEO_LIMIT: z.coerce.number().int().nonnegative().default(0),
    SITEMAP_QUESTION_LIMIT: z.coerce.number().int().positive().default(50000),
    BUILD_CHUNK_SIZE: z.coerce.number().int().positive().default(5000),
    BUILD_PARALLEL: z.string().default("true").transform((v) => v === "true"),

    // CORS
    ALLOWED_ORIGINS: z.string().default("https://proxyfaqs.com,https://www.proxyfaqs.com"),

    // Environment
    NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  })
  .passthrough();

export const env = envSchema.parse(getRawEnv());

// Build DATABASE_URL from parts if not provided directly
function buildDbUrl(): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (!env.DB_PASSWORD) return "";
  const cred = [env.DB_USER, env.DB_PASSWORD].join(":");
  const host = [env.DB_HOST, env.DB_PORT].join(":");
  return `postgresql://${cred}@${host}/${env.DB_NAME}?schema=${env.DB_SCHEMA}`;
}
export const databaseUrl = buildDbUrl();

// Helper to check if we're in production
export const isProduction = env.NODE_ENV === "production";

// Helper to get allowed origins as array
export const allowedOrigins = env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
