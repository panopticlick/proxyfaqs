/**
 * ProxyFAQs - Sitemap Generator via Direct PostgreSQL
 * Generates sitemap.xml for all pages
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

// Configuration - Direct PostgreSQL connection via SSH tunnel
const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5433"),
  database: "postgres",
  user: "postgres",
  password: process.env.DB_PASSWORD || "",
};

const SITE_URL = process.env.SITE_URL || "https://proxyfaqs.com";
const OUTPUT_PATH = path.join(process.cwd(), "public/sitemap.xml");

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
  console.log("Starting sitemap generation via PostgreSQL...\n");

  const client = new Client(DB_CONFIG);

  try {
    await client.connect();
    console.log("Connected to PostgreSQL\n");

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

    console.log(`Added ${staticPages.length} static pages`);

    // Category pages
    const categoriesResult = await client.query(
      "SELECT slug, updated_at FROM proxyfaqs.categories",
    );

    categoriesResult.rows.forEach((cat) => {
      urls.push({
        loc: `${SITE_URL}/category/${cat.slug}`,
        lastmod: cat.updated_at
          ? new Date(cat.updated_at).toISOString().split("T")[0]
          : today,
        changefreq: "weekly",
        priority: "0.8",
      });
    });

    console.log(`Added ${categoriesResult.rows.length} category pages`);

    // Provider pages
    const providersResult = await client.query(
      "SELECT slug, updated_at FROM proxyfaqs.providers",
    );

    providersResult.rows.forEach((provider) => {
      urls.push({
        loc: `${SITE_URL}/providers/${provider.slug}`,
        lastmod: provider.updated_at
          ? new Date(provider.updated_at).toISOString().split("T")[0]
          : today,
        changefreq: "monthly",
        priority: "0.7",
      });
    });

    console.log(`Added ${providersResult.rows.length} provider pages`);

    // Question pages (limit to prevent huge sitemap)
    const QUESTION_LIMIT = 50000; // Google sitemap limit is 50K URLs

    const questionsResult = await client.query(
      `SELECT slug, updated_at FROM proxyfaqs.questions
       ORDER BY view_count DESC NULLS LAST
       LIMIT ${QUESTION_LIMIT}`,
    );

    questionsResult.rows.forEach((question) => {
      urls.push({
        loc: `${SITE_URL}/q/${question.slug}`,
        lastmod: question.updated_at
          ? new Date(question.updated_at).toISOString().split("T")[0]
          : today,
        changefreq: "monthly",
        priority: "0.6",
      });
    });

    console.log(`Added ${questionsResult.rows.length} question pages`);

    // Generate XML
    const xml = generateSitemapXML(urls);

    // Ensure public directory exists
    const publicDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    // Write to file
    fs.writeFileSync(OUTPUT_PATH, xml, "utf-8");

    console.log(`\nSitemap generated: ${OUTPUT_PATH}`);
    console.log(`Total URLs: ${urls.length}`);
    console.log("");
  } finally {
    await client.end();
  }
}

// Run sitemap generation
buildSitemap()
  .then(() => {
    console.log("All done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
