/**
 * ProxyFAQs - Sitemap Generator
 * Generates sitemap.xml for all pages
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { env } from "../src/lib/env";

// Configuration
const SUPABASE_URL = env.SUPABASE_URL || "";
const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY || "";
const SITE_URL = env.SITE_URL || "https://proxyfaqs.com";
const OUTPUT_PATH = path.join(process.cwd(), "public/sitemap.xml");

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface SitemapUrl {
  loc: string;
  lastmod: string;
  changefreq: string;
  priority: string;
}

// Generate sitemap XML
function generateSitemapXML(urls: SitemapUrl[]): string {
  const urlEntries = urls
    .map(
      (url) => `
  <url>
    <loc>${url.loc}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
}

// Main function
async function buildSitemap() {
  console.log("🚀 Starting sitemap generation...\n");

  const urls: SitemapUrl[] = [];
  const today = new Date().toISOString().split("T")[0];

  // Static pages
  const staticPages = [
    { path: "", priority: "1.0", changefreq: "daily" },
    { path: "search", priority: "0.9", changefreq: "daily" },
    { path: "providers", priority: "0.9", changefreq: "weekly" },
    { path: "categories", priority: "0.8", changefreq: "weekly" },
    { path: "guides", priority: "0.7", changefreq: "weekly" },
    { path: "about", priority: "0.5", changefreq: "monthly" },
    { path: "privacy", priority: "0.3", changefreq: "yearly" },
    { path: "terms", priority: "0.3", changefreq: "yearly" },
  ];

  staticPages.forEach((page) => {
    urls.push({
      loc: `${SITE_URL}/${page.path}`,
      lastmod: today,
      changefreq: page.changefreq,
      priority: page.priority,
    });
  });

  console.log(`✅ Added ${staticPages.length} static pages`);

  // Category pages
  const { data: categories } = await supabase
    .from("categories")
    .select("slug, updated_at");

  if (categories) {
    categories.forEach((cat) => {
      urls.push({
        loc: `${SITE_URL}/category/${cat.slug}`,
        lastmod: cat.updated_at ? cat.updated_at.split("T")[0] : today,
        changefreq: "weekly",
        priority: "0.8",
      });
    });

    console.log(`✅ Added ${categories.length} category pages`);
  }

  // Provider pages
  const { data: providers } = await supabase
    .from("providers")
    .select("slug, updated_at");

  if (providers) {
    providers.forEach((provider) => {
      urls.push({
        loc: `${SITE_URL}/providers/${provider.slug}`,
        lastmod: provider.updated_at
          ? provider.updated_at.split("T")[0]
          : today,
        changefreq: "monthly",
        priority: "0.7",
      });
    });

    console.log(`✅ Added ${providers.length} provider pages`);
  }

  // Question pages (limit to prevent huge sitemap)
  const QUESTION_LIMIT = 50000; // Google sitemap limit is 50K URLs

  const { data: questions } = await supabase
    .from("questions")
    .select("slug, updated_at")
    .order("view_count", { ascending: false })
    .limit(QUESTION_LIMIT);

  if (questions) {
    questions.forEach((question) => {
      urls.push({
        loc: `${SITE_URL}/q/${question.slug}`,
        lastmod: question.updated_at
          ? question.updated_at.split("T")[0]
          : today,
        changefreq: "monthly",
        priority: "0.6",
      });
    });

    console.log(`✅ Added ${questions.length} question pages`);
  }

  // Generate XML
  const xml = generateSitemapXML(urls);

  // Write to file
  fs.writeFileSync(OUTPUT_PATH, xml, "utf-8");

  console.log(`\n✅ Sitemap generated: ${OUTPUT_PATH}`);
  console.log(`📊 Total URLs: ${urls.length}`);
  console.log("");
}

// Run sitemap generation
buildSitemap()
  .then(() => {
    console.log("✨ All done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
