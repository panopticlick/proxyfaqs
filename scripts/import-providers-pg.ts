/**
 * ProxyFAQs - Import Provider Data via Direct PostgreSQL
 * Imports proxy provider information from merchant CSV files
 */

import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";
import { env } from "../src/lib/env";

// Configuration - Direct PostgreSQL connection via SSH tunnel
const DB_CONFIG = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: "postgres",
  user: "postgres",
  password: env.DB_PASSWORD,
};

const DATA_DIR = path.join(process.cwd(), '../data/proxy merchant');

interface Provider {
  slug: string;
  name: string;
  description: string;
  logo_url: string;
  website_url: string;
  features: Record<string, unknown>;
  pricing: Record<string, unknown>;
  pros: string[];
  cons: string[];
  affiliate_url: string;
  affiliate_code: string;
  rating: number;
  rank: number;
  review_html: string;
}

// Utility: Generate URL-safe slug
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

// Escape string for PostgreSQL
function escapeString(str: string): string {
  if (!str) return '';
  return str.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

// Parse Product CSV using papaparse for proper multi-line field handling
function parseProductCSV(filePath: string): Map<
  string,
  {
    name: string;
    domain: string;
    properties: { name: string; value: string }[];
  }
> {
  const providers = new Map();

  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return providers;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
  });

  for (const row of result.data as Record<string, string>[]) {
    const name = row['Name']?.trim();
    const domain = row['Domain']?.trim();
    const propertyName = row['Property Name']?.trim();
    const propertyValue = row['Property Value']?.trim() || '';

    if (!name || !domain) continue;

    // Skip rows where name looks like a feature description (ends with period or contains multiple words with periods)
    if (
      name.endsWith('.') ||
      name.includes(';') ||
      name.length > 100 ||
      /^\d+[MK]?\+?\s/.test(name) // starts with number like "55M+"
    ) {
      continue;
    }

    const slug = generateSlug(name);

    if (!providers.has(slug)) {
      providers.set(slug, {
        name,
        domain,
        properties: [],
      });
    }

    const provider = providers.get(slug);
    if (propertyName) {
      provider.properties.push({
        name: propertyName,
        value: propertyValue,
      });
    }
  }

  return providers;
}

// Parse Domain CSV using papaparse
function parseDomainCSV(
  filePath: string
): Map<string, { name: string; domain: string; website_url: string }> {
  const domains = new Map();

  if (!fs.existsSync(filePath)) {
    console.warn(`File not found: ${filePath}`);
    return domains;
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
  });

  for (const row of result.data as Record<string, string>[]) {
    const name = row['Name']?.trim();
    const domain = row['Domain']?.trim();

    if (!name || !domain) continue;

    const slug = generateSlug(name);
    domains.set(slug, {
      name,
      domain,
      website_url: domain.startsWith('http') ? domain : `https://${domain}`,
    });
  }

  return domains;
}

// Load affiliate links using papaparse
function loadAffiliateLinks(): Map<string, string> {
  const affiliateLinks = new Map<string, string>();
  const affiliateFilePath = path.join(process.cwd(), '../docs/proxy-provider-affiliate-links.csv');

  if (!fs.existsSync(affiliateFilePath)) {
    console.warn('No affiliate links file found');
    return affiliateLinks;
  }

  const content = fs.readFileSync(affiliateFilePath, 'utf-8');
  const result = Papa.parse(content, {
    header: true,
    skipEmptyLines: true,
  });

  for (const row of result.data as Record<string, string>[]) {
    // Try common column name variations
    const name = row['Name'] || row['name'] || row['Provider'] || Object.values(row)[0];
    const affiliateUrl =
      row['Affiliate URL'] || row['affiliate_url'] || row['URL'] || Object.values(row)[1];

    if (name && affiliateUrl) {
      const slug = generateSlug(name.trim());
      affiliateLinks.set(slug, affiliateUrl.trim());
    }
  }

  return affiliateLinks;
}

// Main import function
async function importProviders() {
  console.log('Starting provider data import via PostgreSQL...\n');

  const client = new Client(DB_CONFIG);

  try {
    await client.connect();
    console.log('Connected to PostgreSQL\n');

    // Parse all data sources
    console.log('Parsing Product.csv...');
    const products = parseProductCSV(path.join(DATA_DIR, 'Product.csv'));
    console.log(`   Found ${products.size} providers\n`);

    console.log('Parsing Domain.csv...');
    const domains = parseDomainCSV(path.join(DATA_DIR, 'Domain.csv'));
    console.log(`   Found ${domains.size} domains\n`);

    console.log('Loading affiliate links...');
    const affiliateLinks = loadAffiliateLinks();
    console.log(`   Found ${affiliateLinks.size} affiliate links\n`);

    // Merge data and create provider records
    const providers: Provider[] = [];
    let rank = 1;

    for (const [slug, product] of products) {
      const domain = domains.get(slug);
      const affiliateUrl = affiliateLinks.get(slug) || '';

      // Build features object
      const features: Record<string, unknown> = {};
      const pros: string[] = [];
      const cons: string[] = [];

      for (const prop of product.properties) {
        features[prop.name] = prop.value;

        // Extract pros/cons from properties
        if (
          prop.name.toLowerCase().includes('advantage') ||
          prop.name.toLowerCase().includes('pro')
        ) {
          if (prop.value) pros.push(prop.value);
        }
        if (
          prop.name.toLowerCase().includes('disadvantage') ||
          prop.name.toLowerCase().includes('con')
        ) {
          if (prop.value) cons.push(prop.value);
        }
      }

      // Create provider record
      providers.push({
        slug,
        name: product.name,
        description: `${product.name} is a professional proxy service provider offering high-quality proxies for web scraping, data collection, and online privacy.`,
        logo_url: `https://logo.clearbit.com/${product.domain}`,
        website_url: domain?.website_url || `https://${product.domain}`,
        features,
        pricing: {},
        pros: pros.length > 0 ? pros : ['High-quality proxies', 'Reliable service'],
        cons: cons.length > 0 ? cons : ['Pricing varies by plan'],
        affiliate_url: affiliateUrl,
        affiliate_code: '',
        rating: 4.0 + Math.random(), // Random rating between 4.0-5.0
        rank: rank++,
        review_html: '',
      });
    }

    console.log(`\nPrepared ${providers.length} providers for import\n`);

    // Insert providers
    let imported = 0;
    for (const p of providers) {
      const query = `
        INSERT INTO proxyfaqs.providers (slug, name, description, logo_url, website_url, features, pricing, pros, cons, affiliate_url, affiliate_code, rating, rank, review_html)
        VALUES (
          '${escapeString(p.slug)}',
          '${escapeString(p.name)}',
          '${escapeString(p.description)}',
          '${escapeString(p.logo_url)}',
          '${escapeString(p.website_url)}',
          '${escapeString(JSON.stringify(p.features))}',
          '${escapeString(JSON.stringify(p.pricing))}',
          ARRAY[${p.pros.map((pro) => `'${escapeString(pro)}'`).join(',')}],
          ARRAY[${p.cons.map((con) => `'${escapeString(con)}'`).join(',')}],
          '${escapeString(p.affiliate_url)}',
          '${escapeString(p.affiliate_code)}',
          ${p.rating.toFixed(1)},
          ${p.rank},
          '${escapeString(p.review_html)}'
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          logo_url = EXCLUDED.logo_url,
          website_url = EXCLUDED.website_url,
          features = EXCLUDED.features,
          pricing = EXCLUDED.pricing,
          pros = EXCLUDED.pros,
          cons = EXCLUDED.cons,
          affiliate_url = EXCLUDED.affiliate_url,
          rating = EXCLUDED.rating,
          rank = EXCLUDED.rank,
          updated_at = NOW()
      `;

      try {
        await client.query(query);
        imported++;
      } catch (err: unknown) {
        const error = err as Error;
        console.error(`Error importing ${p.name}: ${error.message}`);
      }
    }

    console.log(`Imported ${imported} providers\n`);
    console.log('Import complete!');
  } finally {
    await client.end();
  }
}

// Run import
importProviders()
  .then(() => {
    console.log('\nAll done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
