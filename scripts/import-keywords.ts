/**
 * ProxyFAQs - Import Keywords Data
 * Imports keyword clusters for SEO targeting
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import { env } from "../src/lib/env";

// Configuration
const SUPABASE_URL =
  env.SUPABASE_URL ||
  "";
const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY || "";
const DATA_DIR = path.join(process.cwd(), "../data");
const BATCH_SIZE = 500;

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface Keyword {
  keyword: string;
  volume: number;
  difficulty: number;
  cluster: string;
  page_slug: string;
}

// Utility: Generate URL-safe slug
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 200);
}

// Parse keyword cluster CSV
function parseKeywordCSV(filePath: string): Keyword[] {
  const keywords: Keyword[] = [];

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return keywords;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Try to detect headers
  const headerLine = lines[0].toLowerCase();
  const hasHeaders = headerLine.includes('keyword') || headerLine.includes('cluster');

  const startIndex = hasHeaders ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV line (handles quoted fields)
    const parts: string[] = [];
    let currentPart = '';
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        parts.push(currentPart.trim().replace(/^"|"$/g, ''));
        currentPart = '';
      } else {
        currentPart += char;
      }
    }
    parts.push(currentPart.trim().replace(/^"|"$/g, ''));

    if (parts.length < 1) continue;

    const keyword = parts[0];
    if (!keyword) continue;

    // Extract volume and difficulty if present
    const volume = parts[1] ? parseInt(parts[1]) || 0 : 0;
    const difficulty = parts[2] ? parseInt(parts[2]) || 0 : 0;
    const cluster = parts[3] || determineCluster(keyword);

    keywords.push({
      keyword,
      volume,
      difficulty,
      cluster,
      page_slug: generateSlug(keyword),
    });
  }

  return keywords;
}

// Determine cluster from keyword
function determineCluster(keyword: string): string {
  const kw = keyword.toLowerCase();

  if (kw.includes('residential')) return 'residential-proxies';
  if (kw.includes('mobile')) return 'mobile-proxies';
  if (kw.includes('datacenter')) return 'datacenter-proxies';
  if (kw.includes('scraping') || kw.includes('scraper')) return 'web-scraping';
  if (kw.includes('api')) return 'scraper-api';
  if (kw.includes('provider') || kw.includes('service')) return 'proxy-providers';
  if (kw.includes('socks')) return 'socks-proxies';
  if (kw.includes('http')) return 'http-proxies';

  return 'proxy-basics';
}

// Main import function
async function importKeywords() {
  console.log('🚀 Starting keyword data import...\n');

  // Find all keyword CSV files
  const keywordFiles = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.toLowerCase().includes('cluster') || f.toLowerCase().includes('keyword'))
    .filter((f) => f.endsWith('.csv'))
    .map((f) => path.join(DATA_DIR, f));

  // Also check for specific files
  const specificFiles = [
    'proxy_clusters_2026-01-05.csv',
    'google_proxy_question.csv',
    'proxy_faqs_all.csv',
  ];

  for (const file of specificFiles) {
    const filePath = path.join(DATA_DIR, file);
    if (fs.existsSync(filePath) && !keywordFiles.includes(filePath)) {
      keywordFiles.push(filePath);
    }
  }

  console.log(`📁 Found ${keywordFiles.length} keyword CSV files:\n`);
  keywordFiles.forEach((f) => console.log(`   - ${path.basename(f)}`));
  console.log('');

  let totalProcessed = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  const seenKeywords = new Set<string>();

  for (const filePath of keywordFiles) {
    console.log(`\n📂 Processing: ${path.basename(filePath)}`);

    const keywords = parseKeywordCSV(filePath);
    console.log(`   Found ${keywords.length} keywords`);

    const uniqueKeywords: Keyword[] = [];

    for (const keyword of keywords) {
      totalProcessed++;

      // Skip duplicates
      if (seenKeywords.has(keyword.keyword.toLowerCase())) {
        totalSkipped++;
        continue;
      }

      seenKeywords.add(keyword.keyword.toLowerCase());
      uniqueKeywords.push(keyword);

      // Batch insert
      if (uniqueKeywords.length >= BATCH_SIZE) {
        const { error } = await supabase.from('keywords').upsert(uniqueKeywords, {
          onConflict: 'keyword',
          ignoreDuplicates: true,
        });

        if (error) {
          console.error(`   ❌ Error inserting batch: ${error.message}`);
        } else {
          totalImported += uniqueKeywords.length;
          console.log(
            `   ✅ Imported batch of ${uniqueKeywords.length} keywords (Total: ${totalImported})`
          );
        }

        uniqueKeywords.length = 0;
      }
    }

    // Insert remaining keywords
    if (uniqueKeywords.length > 0) {
      const { error } = await supabase.from('keywords').upsert(uniqueKeywords, {
        onConflict: 'keyword',
        ignoreDuplicates: true,
      });

      if (error) {
        console.error(`   ❌ Error inserting final batch: ${error.message}`);
      } else {
        totalImported += uniqueKeywords.length;
        console.log(`   ✅ Imported final batch of ${uniqueKeywords.length} keywords`);
      }
    }

    console.log(`   ✓ Completed: ${path.basename(filePath)}`);
  }

  console.log('\n✅ Import complete!\n');
  console.log('📈 Summary:');
  console.log(`   Total keywords processed: ${totalProcessed}`);
  console.log(`   Keywords imported: ${totalImported}`);
  console.log(`   Skipped (duplicates): ${totalSkipped}`);
  console.log('');
}

// Run import
importKeywords()
  .then(() => {
    console.log('✨ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
