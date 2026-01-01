/**
 * ProxyFAQs - Import Google PAA Data
 * Imports all Google People Also Ask questions from CSV files
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Configuration
const SUPABASE_URL =
  process.env.SUPABASE_URL ||
  "postgresql://postgres:your_password@supabase-db:5432/postgres";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const DATA_DIR = path.join(process.cwd(), "../data");
const BATCH_SIZE = 1000;

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface PAARow {
  "PAA Title": string;
  Parent: string;
  Text: string;
  URL: string;
  "URL Title": string;
}

interface Question {
  slug: string;
  question: string;
  answer: string;
  answer_html: string;
  category: string;
  category_slug: string;
  source_keyword: string;
  source_url: string;
  meta_title: string;
  meta_description: string;
}

// Utility: Generate URL-safe slug
function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 200);
}

// Utility: Categorize question based on keyword
function categorizeQuestion(keyword: string): {
  category: string;
  slug: string;
} {
  const keywordLower = keyword.toLowerCase();

  if (keywordLower.includes("residential")) {
    return { category: "Residential Proxies", slug: "residential-proxies" };
  } else if (keywordLower.includes("scraper") || keywordLower.includes("api")) {
    return { category: "Scraper API", slug: "scraper-api" };
  } else if (keywordLower.includes("scraping")) {
    return { category: "Web Scraping", slug: "web-scraping" };
  } else if (keywordLower.includes("datacenter")) {
    return { category: "Datacenter Proxies", slug: "datacenter-proxies" };
  } else if (keywordLower.includes("mobile")) {
    return { category: "Mobile Proxies", slug: "mobile-proxies" };
  } else if (
    keywordLower.includes("provider") ||
    keywordLower.includes("service")
  ) {
    return { category: "Proxy Providers", slug: "proxy-providers" };
  } else {
    return { category: "Proxy Basics", slug: "proxy-basics" };
  }
}

// Utility: Parse CSV manually (handles quoted fields)
function parseCSV(content: string): PAARow[] {
  const lines = content.split("\n");
  const headers = lines[0]
    .replace(/^\uFEFF/, "")
    .split(",")
    .map((h) => h.trim());
  const rows: PAARow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parser - handles basic quoted fields
    const values: string[] = [];
    let currentValue = "";
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(currentValue.trim());
        currentValue = "";
      } else {
        currentValue += char;
      }
    }
    values.push(currentValue.trim());

    if (values.length >= 5) {
      rows.push({
        "PAA Title": values[0]?.replace(/^"|"$/g, "") || "",
        Parent: values[1]?.replace(/^"|"$/g, "") || "",
        Text: values[2]?.replace(/^"|"$/g, "") || "",
        URL: values[3]?.replace(/^"|"$/g, "") || "",
        "URL Title": values[4]?.replace(/^"|"$/g, "") || "",
      });
    }
  }

  return rows;
}

// Utility: Convert PAA row to Question
function convertToQuestion(row: PAARow): Question | null {
  if (!row["PAA Title"] || !row["Text"]) {
    return null;
  }

  const question = row["PAA Title"].trim();
  const answer = row["Text"].trim();
  const slug = generateSlug(question);
  const { category, slug: categorySlug } = categorizeQuestion(
    row["Parent"] || "",
  );

  // Generate HTML answer with source link
  const answerHtml = `
    <p>${answer}</p>
    ${
      row["URL"]
        ? `<p class="text-sm text-gray-600 mt-4">
      Source: <a href="${row["URL"]}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">
        ${row["URL Title"] || "Learn more"}
      </a>
    </p>`
        : ""
    }
  `.trim();

  return {
    slug,
    question,
    answer,
    answer_html: answerHtml,
    category,
    category_slug: categorySlug,
    source_keyword: row["Parent"] || "",
    source_url: row["URL"] || "",
    meta_title: `${question} | ProxyFAQs`,
    meta_description:
      answer.substring(0, 155) + (answer.length > 155 ? "..." : ""),
  };
}

// Main import function
async function importPAAData() {
  console.log("🚀 Starting PAA data import...\n");

  // Find all PAA CSV files
  const paaFiles = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith("google-paa-") && f.endsWith(".csv"))
    .map((f) => path.join(DATA_DIR, f));

  console.log(`📁 Found ${paaFiles.length} PAA CSV files:\n`);
  paaFiles.forEach((f) => console.log(`   - ${path.basename(f)}`));
  console.log("");

  let totalProcessed = 0;
  let totalImported = 0;
  let totalSkipped = 0;
  const seenSlugs = new Set<string>();

  for (const filePath of paaFiles) {
    console.log(`\n📂 Processing: ${path.basename(filePath)}`);

    const content = fs.readFileSync(filePath, "utf-8");
    const rows = parseCSV(content);

    console.log(`   Found ${rows.length} rows`);

    const questions: Question[] = [];

    for (const row of rows) {
      totalProcessed++;
      const question = convertToQuestion(row);

      if (!question) {
        totalSkipped++;
        continue;
      }

      // Skip duplicates
      if (seenSlugs.has(question.slug)) {
        totalSkipped++;
        continue;
      }

      seenSlugs.add(question.slug);
      questions.push(question);

      // Batch insert when we reach BATCH_SIZE
      if (questions.length >= BATCH_SIZE) {
        const { error } = await supabase
          .from("questions")
          .upsert(questions, { onConflict: "slug", ignoreDuplicates: true });

        if (error) {
          console.error(`   ❌ Error inserting batch: ${error.message}`);
        } else {
          totalImported += questions.length;
          console.log(
            `   ✅ Imported batch of ${questions.length} questions (Total: ${totalImported})`,
          );
        }

        questions.length = 0; // Clear array
      }
    }

    // Insert remaining questions
    if (questions.length > 0) {
      const { error } = await supabase
        .from("questions")
        .upsert(questions, { onConflict: "slug", ignoreDuplicates: true });

      if (error) {
        console.error(`   ❌ Error inserting final batch: ${error.message}`);
      } else {
        totalImported += questions.length;
        console.log(
          `   ✅ Imported final batch of ${questions.length} questions`,
        );
      }
    }

    console.log(`   ✓ Completed: ${path.basename(filePath)}`);
  }

  // Update category counts
  console.log("\n📊 Updating category question counts...");
  const { data: categories } = await supabase.from("categories").select("slug");

  if (categories) {
    for (const cat of categories) {
      const { count } = await supabase
        .from("questions")
        .select("*", { count: "exact", head: true })
        .eq("category_slug", cat.slug);

      await supabase
        .from("categories")
        .update({ question_count: count || 0 })
        .eq("slug", cat.slug);
    }
  }

  console.log("\n✅ Import complete!\n");
  console.log("📈 Summary:");
  console.log(`   Total rows processed: ${totalProcessed}`);
  console.log(`   Questions imported: ${totalImported}`);
  console.log(`   Skipped (duplicates/invalid): ${totalSkipped}`);
  console.log("");
}

// Run import
importPAAData()
  .then(() => {
    console.log("✨ All done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
  });
