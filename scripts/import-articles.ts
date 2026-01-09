/**
 * ProxyFAQs - Import Generated Articles via Direct PostgreSQL
 * Imports all article JSON files from output/articles/
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { env } from '../src/lib/env';

// Configuration - Direct PostgreSQL connection via SSH tunnel
const DB_CONFIG = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: 'postgres',
  user: 'postgres',
  password: env.DB_PASSWORD,
};

const ARTICLES_DIR = path.join(process.cwd(), '../output/articles');
const BATCH_SIZE = 100;

interface ArticleJSON {
  title: string;
  meta_description: string;
  quick_answer: string;
  detailed_answer: string;
  tags: string[];
  word_count: number;
  slug: string;
  volume: number;
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

// Utility: Categorize question based on tags
function categorizeQuestion(tags: string[]): {
  category: string;
  slug: string;
} {
  const tagsLower = tags.map((t) => t.toLowerCase());

  if (tagsLower.some((t) => t.includes('residential'))) {
    return { category: 'Residential Proxies', slug: 'residential-proxies' };
  } else if (tagsLower.some((t) => t.includes('scraper') || t.includes('api'))) {
    return { category: 'Scraper API', slug: 'scraper-api' };
  } else if (tagsLower.some((t) => t.includes('scraping'))) {
    return { category: 'Web Scraping', slug: 'web-scraping' };
  } else if (tagsLower.some((t) => t.includes('datacenter'))) {
    return { category: 'Datacenter Proxies', slug: 'datacenter-proxies' };
  } else if (tagsLower.some((t) => t.includes('mobile'))) {
    return { category: 'Mobile Proxies', slug: 'mobile-proxies' };
  } else if (tagsLower.some((t) => t.includes('provider') || t.includes('service'))) {
    return { category: 'Proxy Providers', slug: 'proxy-providers' };
  } else if (
    tagsLower.some((t) => t.includes('troubleshoot') || t.includes('error') || t.includes('debug'))
  ) {
    return { category: 'Troubleshooting', slug: 'troubleshooting' };
  } else if (tagsLower.some((t) => t.includes('use case'))) {
    return { category: 'Use Cases', slug: 'use-cases' };
  } else if (tagsLower.some((t) => t.includes('type') || t.includes('comparison'))) {
    return { category: 'Proxy Types', slug: 'proxy-types' };
  } else {
    return { category: 'Proxy Basics', slug: 'proxy-basics' };
  }
}

// Utility: Convert markdown to basic HTML
function markdownToHtml(markdown: string): string {
  let html = markdown;

  // Convert headers
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Convert bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

  // Convert code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');

  // Convert inline code
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');

  // Convert links
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');

  // Convert lists
  html = html.replace(/^\* (.+)$/gim, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

  // Convert paragraphs
  const lines = html.split('\n');
  const paragraphs: string[] = [];
  let currentParagraph = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentParagraph) {
        paragraphs.push(`<p>${currentParagraph}</p>`);
        currentParagraph = '';
      }
    } else if (
      !trimmed.startsWith('<h') &&
      !trimmed.startsWith('<pre') &&
      !trimmed.startsWith('<ul') &&
      !trimmed.startsWith('<li')
    ) {
      currentParagraph += (currentParagraph ? ' ' : '') + trimmed;
    } else {
      if (currentParagraph) {
        paragraphs.push(`<p>${currentParagraph}</p>`);
        currentParagraph = '';
      }
      paragraphs.push(trimmed);
    }
  }

  if (currentParagraph) {
    paragraphs.push(`<p>${currentParagraph}</p>`);
  }

  return paragraphs.join('\n');
}

// Escape string for PostgreSQL
function escapeString(str: string): string {
  return str.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

// Utility: Convert article JSON to Question
function convertToQuestion(article: ArticleJSON): Question {
  const { category, slug: categorySlug } = categorizeQuestion(article.tags);

  // Generate question from title (remove common suffixes)
  const question = article.title
    .replace(/\s*\|\s*ProxyFAQs\s*$/, '')
    .replace(/\s+in\s+\d{4}$/, '')
    .trim();

  // Combine quick_answer and detailed_answer
  const answer = `${article.quick_answer}\n\n${article.detailed_answer}`;

  // Convert markdown to HTML
  const answerHtml = markdownToHtml(article.detailed_answer);

  return {
    slug: article.slug,
    question: question,
    answer: answer.substring(0, 10000), // Limit to 10k chars
    answer_html: answerHtml.substring(0, 50000), // Limit to 50k chars
    category,
    category_slug: categorySlug,
    source_keyword: article.tags[0] || 'proxy',
    source_url: '',
    meta_title: article.title,
    meta_description: article.meta_description,
  };
}

// Insert batch of questions
async function insertBatch(client: Client, questions: Question[]) {
  const values = questions
    .map(
      (q) =>
        `('${escapeString(q.slug)}', '${escapeString(q.question)}', '${escapeString(q.answer)}', '${escapeString(q.answer_html)}', '${escapeString(q.category)}', '${escapeString(q.category_slug)}', '${escapeString(q.source_keyword)}', '${escapeString(q.source_url)}', '${escapeString(q.meta_title)}', '${escapeString(q.meta_description)}')`
    )
    .join(',\n');

  const query = `
    INSERT INTO proxyfaqs.questions (slug, question, answer, answer_html, category, category_slug, source_keyword, source_url, meta_title, meta_description)
    VALUES ${values}
    ON CONFLICT (slug) DO UPDATE SET
      question = EXCLUDED.question,
      answer = EXCLUDED.answer,
      answer_html = EXCLUDED.answer_html,
      category = EXCLUDED.category,
      category_slug = EXCLUDED.category_slug,
      source_keyword = EXCLUDED.source_keyword,
      source_url = EXCLUDED.source_url,
      meta_title = EXCLUDED.meta_title,
      meta_description = EXCLUDED.meta_description,
      updated_at = NOW()
  `;

  await client.query(query);
}

// Main import function
async function importArticles(limit?: number) {
  console.log('🚀 Starting article import via PostgreSQL...\n');

  const client = new Client(DB_CONFIG);

  try {
    await client.connect();
    console.log('✅ Connected to PostgreSQL\n');

    // Find all JSON files
    const articleFiles = fs
      .readdirSync(ARTICLES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(ARTICLES_DIR, f));

    console.log(`📁 Found ${articleFiles.length} article JSON files\n`);

    // Apply limit if specified
    const filesToProcess = limit ? articleFiles.slice(0, limit) : articleFiles;

    console.log(`📊 Processing ${filesToProcess.length} articles...\n`);

    let totalProcessed = 0;
    let totalImported = 0;
    let totalSkipped = 0;
    const questions: Question[] = [];

    for (const filePath of filesToProcess) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const article: ArticleJSON = JSON.parse(content);

        totalProcessed++;

        // Validate required fields
        if (!article.slug || !article.title || !article.detailed_answer) {
          console.warn(`⚠️  Skipping ${path.basename(filePath)}: Missing required fields`);
          totalSkipped++;
          continue;
        }

        const question = convertToQuestion(article);
        questions.push(question);

        // Batch insert when we reach BATCH_SIZE
        if (questions.length >= BATCH_SIZE) {
          await insertBatch(client, questions);
          totalImported += questions.length;
          console.log(
            `   ✅ Imported batch of ${questions.length} articles (Total: ${totalImported})`
          );
          questions.length = 0; // Clear array
        }
      } catch (error) {
        console.error(
          `❌ Error processing ${path.basename(filePath)}:`,
          error instanceof Error ? error.message : error
        );
        totalSkipped++;
      }
    }

    // Insert remaining questions
    if (questions.length > 0) {
      await insertBatch(client, questions);
      totalImported += questions.length;
      console.log(`   ✅ Imported final batch of ${questions.length} articles`);
    }

    // Update category counts
    console.log('\n📊 Updating category question counts...');
    await client.query(`
      UPDATE proxyfaqs.categories c
      SET question_count = (
        SELECT COUNT(*) FROM proxyfaqs.questions q
        WHERE q.category_slug = c.slug
      )
    `);

    console.log('\n✅ Import complete!\n');
    console.log('📈 Summary:');
    console.log(`   Total files processed: ${totalProcessed}`);
    console.log(`   Articles imported: ${totalImported}`);
    console.log(`   Skipped (errors/invalid): ${totalSkipped}`);
    console.log('');
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Get limit from command line args
const limit = process.argv[2] ? parseInt(process.argv[2]) : undefined;

if (limit && limit > 0) {
  console.log(`📋 Import limited to first ${limit} articles\n`);
}

// Run import
importArticles(limit)
  .then(() => {
    console.log('✨ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
