/**
 * ProxyFAQs - Sitemap Generator (Split + Index)
 * Generates sitemap-index.xml and sitemap-*.xml files
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

interface SitemapIndexEntry {
  loc: string;
  lastmod: string;
}

function generateSitemapXML(urls: SitemapUrl[]): string {
  const urlEntries = urls
    .map(
      (url) => `
  <url>
    <loc>${url.loc}</loc>
    <lastmod>${url.lastmod}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`;
}

function generateSitemapIndexXML(entries: SitemapIndexEntry[]): string {
  const indexEntries = entries
    .map(
      (entry) => `
  <sitemap>
    <loc>${entry.loc}</loc>
    <lastmod>${entry.lastmod}</lastmod>
  </sitemap>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${indexEntries}
</sitemapindex>`;
}

function writeSitemapFiles(urls: SitemapUrl[], today: string) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const chunks: SitemapUrl[][] = [];
  for (let i = 0; i < urls.length; i += SITEMAP_CHUNK_SIZE) {
    chunks.push(urls.slice(i, i + SITEMAP_CHUNK_SIZE));
  }

  const indexEntries: SitemapIndexEntry[] = [];

  chunks.forEach((chunk, index) => {
    const filename = `sitemap-${index}.xml`;
    const outputPath = path.join(OUTPUT_DIR, filename);
    fs.writeFileSync(outputPath, generateSitemapXML(chunk), 'utf-8');
    indexEntries.push({
      loc: `${SITE_URL}/${filename}`,
      lastmod: today,
    });
  });

  const indexXml = generateSitemapIndexXML(indexEntries);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap-index.xml'), indexXml, 'utf-8');
  fs.writeFileSync(path.join(OUTPUT_DIR, 'sitemap.xml'), indexXml, 'utf-8');

  console.log(`\n✅ Sitemap index generated with ${chunks.length} files`);
}

async function buildSitemap() {
  console.log('🚀 Starting sitemap generation...\n');

  const urls: SitemapUrl[] = [];
  const today = new Date().toISOString().split('T')[0];

  const staticPages = [
    { path: '', priority: '1.0', changefreq: 'daily' },
    { path: 'providers', priority: '0.9', changefreq: 'weekly' },
    { path: 'category', priority: '0.8', changefreq: 'weekly' },
    { path: 'use-cases', priority: '0.8', changefreq: 'weekly' },
    { path: 'guides', priority: '0.7', changefreq: 'weekly' },
    { path: 'about', priority: '0.5', changefreq: 'monthly' },
    { path: 'privacy', priority: '0.3', changefreq: 'yearly' },
    { path: 'terms', priority: '0.3', changefreq: 'yearly' },
    { path: 'contact', priority: '0.3', changefreq: 'yearly' },
  ];

  staticPages.forEach((page) => {
    urls.push({
      loc: `${SITE_URL}/${page.path}`,
      lastmod: today,
      changefreq: page.changefreq,
      priority: page.priority,
    });
  });

  guides.forEach((guide) => {
    urls.push({
      loc: `${SITE_URL}/guides/${guide.slug}`,
      lastmod: guide.updatedAt,
      changefreq: 'monthly',
      priority: '0.6',
    });
  });

  const useCases = getProxyClusters();
  useCases.forEach((useCase) => {
    urls.push({
      loc: `${SITE_URL}/use-cases/${useCase.slug}`,
      lastmod: today,
      changefreq: 'monthly',
      priority: '0.6',
    });
  });

  console.log(`✅ Added ${staticPages.length} static pages`);
  console.log(`✅ Added ${guides.length} guide pages`);
  console.log(`✅ Added ${useCases.length} use case pages`);

  const { data: categories } = await supabase.from('categories').select('slug, updated_at');

  if (categories) {
    categories.forEach((cat) => {
      urls.push({
        loc: `${SITE_URL}/category/${cat.slug}`,
        lastmod: cat.updated_at ? cat.updated_at.split('T')[0] : today,
        changefreq: 'weekly',
        priority: '0.8',
      });
    });

    console.log(`✅ Added ${categories.length} category pages`);
  }

  const { data: providers } = await supabase.from('providers').select('slug, updated_at');

  if (providers) {
    providers.forEach((provider) => {
      urls.push({
        loc: `${SITE_URL}/providers/${provider.slug}`,
        lastmod: provider.updated_at ? provider.updated_at.split('T')[0] : today,
        changefreq: 'monthly',
        priority: '0.7',
      });
    });

    console.log(`✅ Added ${providers.length} provider pages`);
  }

  if (QUESTION_LIMIT > 0) {
    let fetched = 0;
    while (fetched < QUESTION_LIMIT) {
      const from = fetched;
      const to = Math.min(fetched + QUESTION_PAGE_SIZE - 1, QUESTION_LIMIT - 1);

      const { data: questions } = await supabase
        .from('questions')
        .select('slug, updated_at')
        .order('view_count', { ascending: false })
        .range(from, to);

      if (!questions || questions.length === 0) break;

      questions.forEach((question) => {
        urls.push({
          loc: `${SITE_URL}/q/${question.slug}`,
          lastmod: question.updated_at ? question.updated_at.split('T')[0] : today,
          changefreq: 'monthly',
          priority: '0.6',
        });
      });

      fetched += questions.length;
      if (questions.length < QUESTION_PAGE_SIZE) break;
    }

    console.log(`✅ Added ${Math.min(fetched, QUESTION_LIMIT)} question pages`);
  }

  writeSitemapFiles(urls, today);

  console.log(`📊 Total URLs: ${urls.length}`);
  console.log('');
}

buildSitemap()
  .then(() => {
    console.log('✨ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
