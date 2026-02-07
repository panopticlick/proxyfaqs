#!/usr/bin/env bun
/**
 * ProxyFAQs - Direct PostgreSQL Import (Optimized for Server)
 * Imports all data directly to PostgreSQL using COPY command
 */

import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { env } from "../src/lib/env";

// PostgreSQL connection
const pool = new Pool({
  host: 'supabase-db',
  port: 5432,
  database: "postgres",
  user: "postgres",
  password: env.DB_PASSWORD,
});

const DATA_DIR = path.join(process.cwd(), '../data');

// Utility functions
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

function mapCategoryKeyword(keyword: string): string {
  const lowerKeyword = keyword.toLowerCase();
  if (lowerKeyword.includes('residential')) return 'residential-proxies';
  if (lowerKeyword.includes('datacenter')) return 'datacenter-proxies';
  if (lowerKeyword.includes('mobile')) return 'mobile-proxies';
  if (lowerKeyword.includes('scraping') || lowerKeyword.includes('scraper')) return 'web-scraping';
  if (lowerKeyword.includes('api')) return 'scraper-api';
  if (lowerKeyword.includes('provider')) return 'proxy-providers';
  return 'proxy-basics';
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function importPAAData() {
  console.log('🚀 Starting PAA data import...\n');

  const files = [
    'google-paa-proxy-level8-25-12-2025.csv',
    'google-paa-proxies-level8-26-12-2025.csv',
    'google-paa-residential-proxy-level8-25-12-2025.csv',
    'google-paa-web-scraping-level8-25-12-2025.csv',
    'google-paa-scraper-api-level8-26-12-2025.csv',
  ];

  let totalImported = 0;
  const seenSlugs = new Set<string>();

  for (const filename of files) {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  File not found: ${filename}`);
      continue;
    }

    console.log(`📄 Processing ${filename}...`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter((line) => line.trim());
    const header = parseCSVLine(lines[0]);

    // Find column indexes
    const questionIdx = header.findIndex((h) => h.toLowerCase().includes('paa title'));
    const parentIdx = header.findIndex((h) => h.toLowerCase().includes('parent'));
    const textIdx = header.findIndex((h) => h.toLowerCase().includes('text'));
    const urlIdx = header.findIndex((h) => h.toLowerCase().includes('url'));

    let imported = 0;
    let skipped = 0;

    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVLine(lines[i]);
      if (row.length < 4) continue;

      const question = row[questionIdx]?.trim();
      const parent = row[parentIdx]?.trim();
      const answer = row[textIdx]?.trim();
      const sourceUrl = row[urlIdx]?.trim();

      if (!question || question.length < 10) continue;
      if (!answer || answer.length < 20) continue;

      const slug = generateSlug(question);
      if (seenSlugs.has(slug)) {
        skipped++;
        continue;
      }

      const category = mapCategoryKeyword(parent || filename);
      const categorySlug = category;

      try {
        await pool.query(
          `INSERT INTO proxyfaqs.questions
           (slug, question, answer, answer_html, category, category_slug, source_keyword, source_url, meta_title, meta_description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (slug) DO NOTHING`,
          [
            slug,
            question,
            answer,
            `<p>${answer}</p>`,
            category.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
            categorySlug,
            parent || '',
            sourceUrl || '',
            question,
            answer.substring(0, 160),
          ]
        );

        seenSlugs.add(slug);
        imported++;

        if (imported % 100 === 0) {
          process.stdout.write(`\r   ✓ Imported: ${imported}, Skipped: ${skipped}`);
        }
      } catch (error: any) {
        if (!error.message.includes('duplicate')) {
          console.error(`\nError importing question: ${error.message}`);
        }
      }
    }

    console.log(`\n   ✓ Completed: ${imported} imported, ${skipped} skipped\n`);
    totalImported += imported;
  }

  // Update category counts
  console.log('📊 Updating category counts...');
  await pool.query(`
    UPDATE proxyfaqs.categories c
    SET question_count = (
      SELECT COUNT(*) FROM proxyfaqs.questions q
      WHERE q.category_slug = c.slug
    )
  `);

  console.log(`\n✅ PAA Import complete! Total: ${totalImported} questions\n`);
}

async function importProviders() {
  console.log('🏢 Starting provider data import...\n');

  const productFile = path.join(DATA_DIR, 'proxy merchant/Product.csv');
  const domainFile = path.join(DATA_DIR, 'proxy merchant/Domain.csv');

  if (!fs.existsSync(productFile)) {
    console.log('⚠️  Product.csv not found, skipping providers\n');
    return;
  }

  const productContent = fs.readFileSync(productFile, 'utf-8');
  const productLines = productContent.split('\n').filter((line) => line.trim());

  const providers = new Map<string, any>();

  // Parse products
  for (let i = 1; i < Math.min(productLines.length, 100); i++) {
    const row = parseCSVLine(productLines[i]);
    if (row.length < 3) continue;

    const name = row[0]?.trim();
    const domain = row[1]?.trim();
    const property = row[2]?.trim();
    const value = row[3]?.trim();

    if (!name || !domain) continue;

    if (!providers.has(domain)) {
      providers.set(domain, {
        name,
        domain,
        features: {},
        pros: [],
        cons: [],
      });
    }

    if (property && value) {
      providers.get(domain).features[property] = value;
    }
  }

  let imported = 0;
  for (const [domain, provider] of providers) {
    const slug = generateSlug(provider.name);

    try {
      await pool.query(
        `INSERT INTO proxyfaqs.providers
         (slug, name, description, website_url, features, pros, cons, rank)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (slug) DO NOTHING`,
        [
          slug,
          provider.name,
          `${provider.name} proxy service`,
          `https://${domain}`,
          JSON.stringify(provider.features),
          ['High quality IPs', 'Good customer support'],
          ['Premium pricing'],
          imported + 1,
        ]
      );
      imported++;
    } catch (error: any) {
      if (!error.message.includes('duplicate')) {
        console.error(`Error importing provider: ${error.message}`);
      }
    }
  }

  console.log(`✅ Provider Import complete! Total: ${imported} providers\n`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('ProxyFAQs Data Import');
  console.log('='.repeat(60) + '\n');

  try {
    await pool.query('SELECT 1'); // Test connection
    console.log('✓ Database connection successful\n');

    await importPAAData();
    await importProviders();

    // Get final stats
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM proxyfaqs.questions) as questions,
        (SELECT COUNT(*) FROM proxyfaqs.providers) as providers,
        (SELECT COUNT(*) FROM proxyfaqs.categories) as categories
    `);

    console.log('='.repeat(60));
    console.log('📊 Final Statistics:');
    console.log('='.repeat(60));
    console.log(`Questions:  ${stats.rows[0].questions.toLocaleString()}`);
    console.log(`Providers:  ${stats.rows[0].providers.toLocaleString()}`);
    console.log(`Categories: ${stats.rows[0].categories.toLocaleString()}`);
    console.log('='.repeat(60) + '\n');
    console.log('🎉 Import completed successfully!\n');
  } catch (error: any) {
    console.error('❌ Import failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
