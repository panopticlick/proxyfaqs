import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { slugify } from './utils';
import { env } from './env';

export interface ProxyClusterPage {
  slug: string;
  keyword: string;
  seedKeyword: string;
  pageTitle: string;
  topic: string;
  pageType: string;
  tags: string[];
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  intent: string | null;
  serpFeatures: string[];
  trend: string | null;
  clickPotential: string | null;
  contentReferences: string[];
  competitors: string[];
}

const DATA_PATH = path.resolve(process.cwd(), '..', 'data', 'proxy_clusters_2026-01-05.csv');

let cache: ProxyClusterPage[] | null = null;

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const num = Number(value.replace(/,/g, ''));
  return Number.isFinite(num) ? num : null;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;\n]/)
    .map((item) => item.replace(/^\s*"+|"+\s*$/g, '').trim())
    .filter(Boolean);
}

function ensureUniqueSlug(base: string, counts: Map<string, number>): string {
  const existing = counts.get(base) || 0;
  if (existing === 0) {
    counts.set(base, 1);
    return base;
  }
  const next = existing + 1;
  counts.set(base, next);
  return `${base}-${next}`;
}

export function getProxyClusters(): ProxyClusterPage[] {
  if (cache) return cache;

  if (!fs.existsSync(DATA_PATH)) {
    cache = [];
    return cache;
  }

  const rawCsv = fs.readFileSync(DATA_PATH, 'utf-8').replace(/^\uFEFF/, '');
  const parsed = Papa.parse<Record<string, string>>(rawCsv, {
    header: true,
    skipEmptyLines: true,
  });

  const counts = new Map<string, number>();

  cache = (parsed.data || [])
    .map((row) => {
      const keyword = row['Keyword']?.trim();
      const pageTitle = row['Page']?.trim() || keyword || '';
      const seedKeyword = row['Seed keyword']?.trim() || '';
      const topic = row['Topic']?.trim() || 'General';
      const pageType = row['Page type']?.trim() || 'Use case';
      const tags = splitList(row['Tags']);
      const serpFeatures = splitList(row['SERP Features']);
      const contentReferences = splitList(row['Content references']);
      const competitors = splitList(row['Competitors']);

      const baseSlug = slugify(pageTitle || keyword || 'proxy-use-case');
      const slug = ensureUniqueSlug(baseSlug, counts);

      return {
        slug,
        keyword: keyword || pageTitle,
        seedKeyword,
        pageTitle,
        topic,
        pageType,
        tags,
        volume: parseNumber(row['Volume']),
        difficulty: parseNumber(row['Keyword Difficulty']),
        cpc: parseNumber(row['CPC (USD)'] || row['CPC']),
        intent: row['Intent']?.trim() || null,
        serpFeatures,
        trend: row['Trend']?.trim() || null,
        clickPotential: row['Click potential']?.trim() || null,
        contentReferences,
        competitors,
      } satisfies ProxyClusterPage;
    })
    .filter((row) => row.keyword && row.pageTitle);

  const limit = env.PSEO_LIMIT;
  if (limit > 0) {
    cache = cache.slice(0, limit);
  }

  return cache;
}

export function getProxyClusterBySlug(slug: string) {
  return getProxyClusters().find((page) => page.slug === slug);
}

export function getProxyClusterTopics() {
  const topics = new Map<string, number>();
  getProxyClusters().forEach((page) => {
    topics.set(page.topic, (topics.get(page.topic) || 0) + 1);
  });
  return Array.from(topics.entries()).map(([name, count]) => ({ name, count }));
}

export function getRelatedProxyClusters(page: ProxyClusterPage, limit = 6) {
  const pages = getProxyClusters().filter((item) => item.slug !== page.slug);
  const sameTopic = pages.filter((item) => item.topic === page.topic);
  if (sameTopic.length >= limit) return sameTopic.slice(0, limit);

  const withTags = pages.filter((item) => item.tags.some((tag) => page.tags.includes(tag)));

  return [...sameTopic, ...withTags]
    .filter((item, index, arr) => arr.findIndex((p) => p.slug === item.slug) === index)
    .slice(0, limit);
}

export function inferProxyType(page: ProxyClusterPage) {
  const text =
    `${page.keyword} ${page.topic} ${page.pageType} ${page.tags.join(' ')}`.toLowerCase();

  if (
    text.includes('mobile') ||
    text.includes('social') ||
    text.includes('instagram') ||
    text.includes('tiktok')
  ) {
    return 'mobile';
  }

  if (text.includes('datacenter') || text.includes('data center') || text.includes('cheap')) {
    return 'datacenter';
  }

  if (text.includes('isp')) {
    return 'isp';
  }

  if (text.includes('scraper api') || text.includes('scraping api')) {
    return 'scraping';
  }

  return 'residential';
}
