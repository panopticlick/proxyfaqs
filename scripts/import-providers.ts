/**
 * ProxyFAQs - Import Provider Data
 * Imports proxy provider information from merchant CSV files
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
const DATA_DIR = path.join(process.cwd(), "../data/proxy merchant");
const BATCH_SIZE = 100;

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface Provider {
  slug: string;
  name: string;
  description: string;
  logo_url: string;
  website_url: string;
  features: any;
  pricing: any;
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
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 100);
}

// Parse Product CSV
function parseProductCSV(filePath: string): Map<string, any> {
  const providers = new Map<string, any>();

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return providers;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 3) continue;

    const name = parts[0];
    const domain = parts[1];
    const propertyName = parts[2];
    const propertyValue = parts[3] || "";

    if (!name || !domain) continue;

    const slug = generateSlug(name);

    if (!providers.has(slug)) {
      providers.set(slug, {
        slug,
        name,
        domain,
        features: {},
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

// Parse Price CSV
function parsePriceCSV(filePath: string): Map<string, any[]> {
  const pricing = new Map<string, any[]>();

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return pricing;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;

    const name = parts[0];
    const priceInfo = parts[1];

    if (!name) continue;

    const slug = generateSlug(name);

    if (!pricing.has(slug)) {
      pricing.set(slug, []);
    }

    pricing.get(slug)!.push({
      info: priceInfo,
    });
  }

  return pricing;
}

// Parse Domain CSV
function parseDomainCSV(filePath: string): Map<string, any> {
  const domains = new Map<string, any>();

  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  File not found: ${filePath}`);
    return domains;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;

    const name = parts[0];
    const domain = parts[1];

    if (!name || !domain) continue;

    const slug = generateSlug(name);
    domains.set(slug, {
      name,
      domain,
      website_url: domain.startsWith("http") ? domain : `https://${domain}`,
    });
  }

  return domains;
}

// Load affiliate links
function loadAffiliateLinks(): Map<string, string> {
  const affiliateLinks = new Map<string, string>();
  const affiliateFilePath = path.join(
    process.cwd(),
    "../docs/proxy-provider-affiliate-links.csv",
  );

  if (!fs.existsSync(affiliateFilePath)) {
    console.warn("⚠️  No affiliate links file found");
    return affiliateLinks;
  }

  const content = fs.readFileSync(affiliateFilePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const parts = line.split(",").map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;

    const name = parts[0];
    const affiliateUrl = parts[1];

    if (name && affiliateUrl) {
      const slug = generateSlug(name);
      affiliateLinks.set(slug, affiliateUrl);
    }
  }

  return affiliateLinks;
}

// Main import function
async function importProviders() {
  console.log("🚀 Starting provider data import...\n");

  // Parse all data sources
  console.log("📂 Parsing Product.csv...");
  const products = parseProductCSV(path.join(DATA_DIR, "Product.csv"));
  console.log(`   Found ${products.size} providers\n`);

  console.log("📂 Parsing Price.csv...");
  const pricing = parsePriceCSV(path.join(DATA_DIR, "Price.csv"));
  console.log(`   Found pricing for ${pricing.size} providers\n`);

  console.log("📂 Parsing Domain.csv...");
  const domains = parseDomainCSV(path.join(DATA_DIR, "Domain.csv"));
  console.log(`   Found ${domains.size} domains\n`);

  console.log("📂 Loading affiliate links...");
  const affiliateLinks = loadAffiliateLinks();
  console.log(`   Found ${affiliateLinks.size} affiliate links\n`);

  // Merge data and create provider records
  const providers: Provider[] = [];
  let rank = 1;

  for (const [slug, product] of products) {
    const domain = domains.get(slug);
    const prices = pricing.get(slug) || [];
    const affiliateUrl = affiliateLinks.get(slug) || "";

    // Build features object
    const features: any = {};
    const pros: string[] = [];
    const cons: string[] = [];

    for (const prop of product.properties) {
      features[prop.name] = prop.value;

      // Extract pros/cons from properties
      if (
        prop.name.toLowerCase().includes("advantage") ||
        prop.name.toLowerCase().includes("pro")
      ) {
        if (prop.value) pros.push(prop.value);
      }
      if (
        prop.name.toLowerCase().includes("disadvantage") ||
        prop.name.toLowerCase().includes("con")
      ) {
        if (prop.value) cons.push(prop.value);
      }
    }

    // Build pricing object
    const pricingObj: any = {};
    prices.forEach((price, index) => {
      pricingObj[`tier_${index + 1}`] = price.info;
    });

    // Create provider record
    providers.push({
      slug,
      name: product.name,
      description: `${product.name} is a professional proxy service provider offering high-quality proxies for web scraping, data collection, and online privacy.`,
      logo_url: `https://logo.clearbit.com/${product.domain}`,
      website_url: domain?.website_url || `https://${product.domain}`,
      features,
      pricing: pricingObj,
      pros:
        pros.length > 0 ? pros : ["High-quality proxies", "Reliable service"],
      cons: cons.length > 0 ? cons : ["Pricing varies by plan"],
      affiliate_url: affiliateUrl,
      affiliate_code: "",
      rating: 4.0 + Math.random(), // Random rating between 4.0-5.0
      rank: rank++,
      review_html: "",
    });
  }

  console.log(`\n📊 Prepared ${providers.length} providers for import\n`);

  // Insert providers in batches
  let imported = 0;
  for (let i = 0; i < providers.length; i += BATCH_SIZE) {
    const batch = providers.slice(i, i + BATCH_SIZE);

    const { error } = await supabase
      .from("providers")
      .upsert(batch, { onConflict: "slug", ignoreDuplicates: false });

    if (error) {
      console.error(`❌ Error inserting batch: ${error.message}`);
    } else {
      imported += batch.length;
      console.log(
        `✅ Imported batch of ${batch.length} providers (Total: ${imported})`,
      );
    }
  }

  console.log("\n✅ Import complete!\n");
  console.log("📈 Summary:");
  console.log(`   Total providers imported: ${imported}`);
  console.log("");
}

// Run import
importProviders()
  .then(() => {
    console.log("✨ All done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
