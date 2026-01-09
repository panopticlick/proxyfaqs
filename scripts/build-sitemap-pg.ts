/**
 * ProxyFAQs - Sitemap Generator with Sitemap Index
 * Generates sitemap.xml (index) + split sitemaps for 1M+ pages
 * Google limit: 50K URLs per sitemap, 50MB max file size
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import { env } from "../src/lib/env";

// Configuration - Direct PostgreSQL connection
const DB_CONFIG = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: "postgres",
  user: "postgres",
  password: env.DB_PASSWORD,
};

const SITE_URL = env.SITE_URL;
const PUBLIC_DIR = path.join(process.cwd(), "public");
const SITEMAPS_DIR = path.join(PUBLIC_DIR, "sitemaps");

const URLS_PER_SITEMAP = 45000; // Stay under 50K limit

interface SitemapUrl {
  loc: string;
  lastmod: string;
  changefreq?: string;
  priority?: string;
}

// Generate single sitemap XML
function generateSitemapXML(urls: SitemapUrl[]): string {
  const urlEntries = urls
    .map(
      (url) => `  <url>
    <loc>${url.loc}</loc>
    <lastmod>${url.lastmod}</lastmod>
    ${url.changefreq ? `<changefreq>${url.changefreq}</changefreq>` : ""}
    ${url.priority ? `<priority>${url.priority}</priority>` : ""}
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
}

// Generate sitemap index XML
function generateSitemapIndexXML(sitemaps: string[]): string {
  const sitemapEntries = sitemaps
    .map(
      (sitemap) => `  <sitemap>
    <loc>${sitemap}</loc>
    <lastmod>${new Date().toISOString().split("T")[0]}</lastmod>
  </sitemap>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries}
</sitemapindex>`;
}

// Write sitemap file
function writeSitemap(filename: string, content: string): void {
  const filepath = path.join(SITEMAPS_DIR, filename);
  fs.writeFileSync(filepath, content, "utf-8");
  console.log(`  Generated: ${filename} (${(content.length / 1024).toFixed(1)} KB)`);
}

// Generate static pages sitemap
function generateStaticSitemap(today: string): SitemapUrl[] {
  return [
    { loc: `${SITE_URL}/`, lastmod: today, changefreq: "daily", priority: "1.0" },
    { loc: `${SITE_URL}/search`, lastmod: today, changefreq: "daily", priority: "0.9" },
    { loc: `${SITE_URL}/providers`, lastmod: today, changefreq: "weekly", priority: "0.9" },
    { loc: `${SITE_URL}/category`, lastmod: today, changefreq: "weekly", priority: "0.8" },
    { loc: `${SITE_URL}/guides`, lastmod: today, changefreq: "weekly", priority: "0.7" },
    { loc: `${SITE_URL}/about`, lastmod: today, changefreq: "monthly", priority: "0.5" },
    { loc: `${SITE_URL}/privacy`, lastmod: today, changefreq: "yearly", priority: "0.3" },
    { loc: `${SITE_URL}/terms`, lastmod: today, changefreq: "yearly", priority: "0.3" },
  ];
}

// Batch query with cursor for large tables
async function queryBatch(
  client: Client,
  query: string,
  batchSize: number,
  offset: number,
): Promise<any[]> {
  const result = await client.query(`${query} LIMIT ${batchSize} OFFSET ${offset}`);
  return result.rows;
}

// Main function
async function buildSitemap() {
  console.log("Starting sitemap generation with sitemap index...\n");

  const client = new Client(DB_CONFIG);

  try {
    await client.connect();
    console.log("Connected to PostgreSQL\n");

    const today = new Date().toISOString().split("T")[0];
    const sitemapFiles: string[] = [];

    // Ensure sitemaps directory exists
    if (!fs.existsSync(SITEMAPS_DIR)) {
      fs.mkdirSync(SITEMAPS_DIR, { recursive: true });
    }

    // 1. Static pages sitemap
    console.log("Generating static pages sitemap...");
    const staticUrls = generateStaticSitemap(today);
    writeSitemap("static.xml", generateSitemapXML(staticUrls));
    sitemapFiles.push(`${SITE_URL}/sitemaps/static.xml`);

    // 2. Categories sitemap
    console.log("\nGenerating categories sitemap...");
    const categoriesResult = await client.query(
      "SELECT slug, updated_at FROM proxyfaqs.categories ORDER BY slug",
    );

    const categoryUrls: SitemapUrl[] = categoriesResult.rows.map((cat) => ({
      loc: `${SITE_URL}/category/${cat.slug}`,
      lastmod: cat.updated_at
        ? new Date(cat.updated_at).toISOString().split("T")[0]
        : today,
      changefreq: "weekly",
      priority: "0.8",
    }));
    writeSitemap("categories.xml", generateSitemapXML(categoryUrls));
    sitemapFiles.push(`${SITE_URL}/sitemaps/categories.xml`);
    console.log(`  Added ${categoryUrls.length} category pages`);

    // 3. Providers sitemap
    console.log("\nGenerating providers sitemap...");
    const providersResult = await client.query(
      "SELECT slug, updated_at FROM proxyfaqs.providers ORDER BY slug",
    );

    const providerUrls: SitemapUrl[] = providersResult.rows.map((provider) => ({
      loc: `${SITE_URL}/providers/${provider.slug}`,
      lastmod: provider.updated_at
        ? new Date(provider.updated_at).toISOString().split("T")[0]
        : today,
      changefreq: "monthly",
      priority: "0.7",
    }));
    writeSitemap("providers.xml", generateSitemapXML(providerUrls));
    sitemapFiles.push(`${SITE_URL}/sitemaps/providers.xml`);
    console.log(`  Added ${providerUrls.length} provider pages`);

    // 4. Questions sitemaps (split into multiple files for 1M+ pages)
    console.log("\nGenerating questions sitemaps (this may take a while)...");

    // Get total count
    const countResult = await client.query("SELECT COUNT(*) as total FROM proxyfaqs.questions");
    const totalQuestions = parseInt(countResult.rows[0].total, 10);
    console.log(`  Total questions: ${totalQuestions.toLocaleString()}`);

    const numSitemaps = Math.ceil(totalQuestions / URLS_PER_SITEMAP);
    console.log(`  Creating ${numSitemaps} sitemap files...\n`);

    let offset = 0;
    let sitemapIndex = 0;
    let totalProcessed = 0;

    while (offset < totalQuestions) {
      const questionsResult = await client.query(
        `SELECT slug, updated_at FROM proxyfaqs.questions
         ORDER BY view_count DESC NULLS LAST, slug
         LIMIT ${URLS_PER_SITEMAP} OFFSET ${offset}`,
      );

      if (questionsResult.rows.length === 0) break;

      const questionUrls: SitemapUrl[] = questionsResult.rows.map((q) => ({
        loc: `${SITE_URL}/q/${q.slug}`,
        lastmod: q.updated_at
          ? new Date(q.updated_at).toISOString().split("T")[0]
          : today,
        changefreq: "monthly",
        priority: "0.6",
      }));

      const filename = `questions-${sitemapIndex + 1}.xml`;
      writeSitemap(filename, generateSitemapXML(questionUrls));
      sitemapFiles.push(`${SITE_URL}/sitemaps/${filename}`);

      totalProcessed += questionsResult.rows.length;
      offset += URLS_PER_SITEMAP;
      sitemapIndex++;

      console.log(`  Processed ${totalProcessed.toLocaleString()} / ${totalQuestions.toLocaleString()} questions`);
    }

    // 5. Generate sitemap index
    console.log("\nGenerating sitemap index...");
    const indexXML = generateSitemapIndexXML(sitemapFiles);
    const indexPath = path.join(PUBLIC_DIR, "sitemap.xml");
    fs.writeFileSync(indexPath, indexXML, "utf-8");
    console.log(`\nSitemap index: ${indexPath}`);
    console.log(`Total sitemaps: ${sitemapFiles.length}`);
    console.log(`Total URLs: ${staticUrls.length + categoryUrls.length + providerUrls.length + totalProcessed.toLocaleString()}`);

    // 6. Generate robots.txt with sitemap reference
    const robotsTxt = `# ProxyFAQs - robots.txt

User-agent: *
Allow: /

# Sitemaps
Sitemap: ${SITE_URL}/sitemap.xml

# Disallow API endpoints
Disallow: /api/

# Disallow admin/internal pages
Disallow: /admin/
Disallow: /_/
`;
    fs.writeFileSync(path.join(PUBLIC_DIR, "robots.txt"), robotsTxt, "utf-8");
    console.log("\nrobots.txt updated with sitemap reference");
  } finally {
    await client.end();
  }
}

// Run sitemap generation
buildSitemap()
  .then(() => {
    console.log("\nAll done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
