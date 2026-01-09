import { z } from "zod";

function getRawEnv(): Record<string, unknown> {
  const raw: Record<string, unknown> = {
    ...(typeof process !== "undefined" ? process.env : {}),
  };

  const importMetaEnv = (import.meta as unknown as { env?: Record<string, unknown> })
    .env;
  if (importMetaEnv && typeof importMetaEnv === "object") {
    Object.assign(raw, importMetaEnv);
  }

  return raw;
}

const envSchema = z
  .object({
    SITE: z.string().url().default("https://proxyfaqs.com"),
    SITE_URL: z.string().url().default("https://proxyfaqs.com"),

    PUBLIC_SUPABASE_URL: z.string().url().default("http://supabase-kong:8000"),
    PUBLIC_SUPABASE_ANON_KEY: z.string().default(""),

    SUPABASE_URL: z.string().default(""),
    SUPABASE_SERVICE_KEY: z.string().default(""),

    VECTORENGINE_API_KEY: z.string().default(""),
    VECTORENGINE_BASE_URL: z
      .string()
      .url()
      .default("https://api.vectorengine.ai"),

    OPENROUTER_API_KEY: z.string().default(""),
    OPENROUTER_MODEL: z.string().default("google/gemini-2.0-flash-exp:free"),

    DB_HOST: z.string().default("supabase-db"),
    DB_PORT: z.coerce.number().int().positive().default(5432),
    DB_PASSWORD: z.string().default(""),

    PSEO_LIMIT: z.coerce.number().int().nonnegative().default(0),
    SITEMAP_QUESTION_LIMIT: z.coerce.number().int().positive().default(50000),
  })
  .passthrough();

export const env = envSchema.parse(getRawEnv());

