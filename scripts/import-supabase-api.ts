#!/usr/bin/env bun
/**
 * ProxyFAQs - Supabase API Import
 * Imports all data via Supabase REST API
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Supabase connection
const supabase = createClient(
  'https://api.expertbeacon.com',
  '8f07be6cfd82b25145971e8936f5c37cd6ada3dffcd52d5212ae9b95c05ccad0', // ANON_KEY
  {
    db: { schema: 'proxyfaqs' },
    auth: { persistSession: false },
  }
);

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
    const batch: any[] = [];

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

      batch.push({
        slug,
        question,
        answer,
        answer_html: `<p>${answer}</p>`,
        category: category.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        category_slug: categorySlug,
        source_keyword: parent || '',
        source_url: sourceUrl || '',
        meta_title: question,
        meta_description: answer.substring(0, 160),
      });

      seenSlugs.add(slug);

      // Insert in batches of 100
      if (batch.length >= 100) {
        const { error } = await supabase.from('questions').upsert(batch, {
          onConflict: 'slug',
          ignoreDuplicates: true,
        });

        if (error && !error.message.includes('duplicate')) {
          console.error(`\nError importing batch: ${error.message}`);
        } else {
          imported += batch.length;
          process.stdout.write(`\r   ✓ Imported: ${imported}, Skipped: ${skipped}`);
        }

        batch.length = 0;
      }
    }

    // Insert remaining batch
    if (batch.length > 0) {
      const { error } = await supabase.from('questions').upsert(batch, {
        onConflict: 'slug',
        ignoreDuplicates: true,
      });

      if (error && !error.message.includes('duplicate')) {
        console.error(`\nError importing final batch: ${error.message}`);
      } else {
        imported += batch.length;
      }
    }

    console.log(`\n   ✓ Completed: ${imported} imported, ${skipped} skipped\n`);
    totalImported += imported;
  }

  console.log(`\n✅ PAA Import complete! Total: ${totalImported} questions\n`);
}

async function importProviders() {
  console.log('🏢 Starting provider data import...\n');

  const productFile = path.join(DATA_DIR, 'proxy merchant/Product.csv');

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

  const batch: any[] = [];
  let imported = 0;

  for (const [domain, provider] of providers) {
    const slug = generateSlug(provider.name);

    batch.push({
      slug,
      name: provider.name,
      description: `${provider.name} proxy service`,
      website_url: `https://${domain}`,
      features: provider.features,
      pros: ['High quality IPs', 'Good customer support'],
      cons: ['Premium pricing'],
      rank: imported + 1,
    });
  }

  if (batch.length > 0) {
    const { error } = await supabase.from('providers').upsert(batch, {
      onConflict: 'slug',
      ignoreDuplicates: true,
    });

    if (error) {
      console.error(`Error importing providers: ${error.message}`);
    } else {
      imported = batch.length;
    }
  }

  console.log(`✅ Provider Import complete! Total: ${imported} providers\n`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('ProxyFAQs Data Import via Supabase API');
  console.log('='.repeat(60) + '\n');

  try {
    // Test connection
    const { data, error } = await supabase.from('categories').select('count');
    if (error) throw error;
    console.log('✓ Database connection successful\n');

    await importPAAData();
    await importProviders();

    // Get final stats
    const { data: stats } = await supabase.rpc('get_stats');

    console.log('='.repeat(60));
    console.log('📊 Final Statistics:');
    console.log('='.repeat(60));

    // Get counts directly
    const { count: questionCount } = await supabase
      .from('questions')
      .select('*', { count: 'exact', head: true });
    const { count: providerCount } = await supabase
      .from('providers')
      .select('*', { count: 'exact', head: true });
    const { count: categoryCount } = await supabase
      .from('categories')
      .select('*', { count: 'exact', head: true });

    console.log(`Questions:  ${questionCount?.toLocaleString() || 0}`);
    console.log(`Providers:  ${providerCount?.toLocaleString() || 0}`);
    console.log(`Categories: ${categoryCount?.toLocaleString() || 0}`);
    console.log('='.repeat(60) + '\n');
    console.log('🎉 Import completed successfully!\n');
  } catch (error: any) {
    console.error('❌ Import failed:', error.message);
    process.exit(1);
  }
}

main();
