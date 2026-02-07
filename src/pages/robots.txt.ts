/**
 * Dynamic robots.txt generator
 *
 * Generates SEO-optimized robots.txt with:
 * - Sitemap reference
 * - Crawl-delay for rate limiting
 * - Disallow rules for non-public paths
 */

import type { APIRoute } from "astro";
import { env } from "../lib/env";

export const prerender = true;

export const GET: APIRoute = () => {
  const siteUrl = env.SITE || "https://proxyfaqs.com";

  const robotsTxt = `# ProxyFAQs robots.txt
# https://proxyfaqs.com

User-agent: *
Allow: /

# Disallow API endpoints
Disallow: /api/

# Disallow search results (use canonical URLs)
Disallow: /search?

# Crawl delay to be respectful
Crawl-delay: 1

# Sitemaps
Sitemap: ${siteUrl}/sitemap-index.xml

# Google specific
User-agent: Googlebot
Allow: /
Crawl-delay: 0

# Bing specific
User-agent: Bingbot
Allow: /
Crawl-delay: 1

# Block AI training bots (optional - remove if you want to be indexed by AI)
User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Claude-Web
Disallow: /
`;

  return new Response(robotsTxt, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
};
