/**
 * Utility functions for ProxyFAQs
 */

/**
 * Generate a URL-friendly slug from text
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars
    .replace(/[\s_-]+/g, '-') // Replace spaces, underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Format a number with commas (e.g., 1,234,567)
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Format a date to a human-readable string
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d);
}

/**
 * Generate meta description from answer text
 */
export function generateMetaDescription(answer: string, maxLength = 160): string {
  // Remove HTML tags if present
  const cleanText = answer.replace(/<[^>]*>/g, '');
  // Take first sentence or truncate
  const firstSentence = cleanText.split(/[.!?]/)[0];
  return truncate(firstSentence || cleanText, maxLength);
}

/**
 * Generate FAQ schema markup for SEO
 */
export function generateFAQSchema(questions: Array<{ question: string; answer: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: questions.map((q) => ({
      '@type': 'Question',
      name: q.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: q.answer,
      },
    })),
  };
}

/**
 * Generate breadcrumb schema markup for SEO
 */
export function generateBreadcrumbSchema(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * Generate article schema for question pages
 */
export function generateArticleSchema(data: {
  title: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: data.title,
    description: data.description,
    url: data.url,
    datePublished: data.datePublished,
    dateModified: data.dateModified,
    author: {
      '@type': 'Organization',
      name: 'ProxyFAQs',
      url: 'https://proxyfaqs.com',
    },
    publisher: {
      '@type': 'Organization',
      name: 'ProxyFAQs',
      logo: {
        '@type': 'ImageObject',
        url: 'https://proxyfaqs.com/favicon.svg',
      },
    },
  };
}

/**
 * Generate HowTo schema markup
 */
export function generateHowToSchema(data: { name: string; description: string; steps: string[] }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: data.name,
    description: data.description,
    step: data.steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: step,
      text: step,
    })),
  };
}

/**
 * Extract keywords from text for internal linking
 */
export function extractKeywords(text: string): string[] {
  const proxyKeywords = [
    'residential proxy',
    'datacenter proxy',
    'mobile proxy',
    'rotating proxy',
    'static proxy',
    'web scraping',
    'proxy pool',
    'ip rotation',
    'captcha',
    'anti-detection',
    'fingerprint',
    'headless browser',
    'puppeteer',
    'playwright',
    'selenium',
    'http proxy',
    'socks5',
    'backconnect',
    'geo-targeting',
    'rate limiting',
  ];

  const lowerText = text.toLowerCase();
  return proxyKeywords.filter((keyword) => lowerText.includes(keyword));
}

/**
 * Deduplicate an array by a key
 */
export function dedupeBy<T>(array: T[], key: keyof T): T[] {
  const seen = new Set();
  return array.filter((item) => {
    const value = item[key];
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/**
 * Parse CSV row safely
 */
export function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < row.length; i++) {
    const char = row[i];
    const nextChar = row[i + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      i++; // Skip next quote
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Batch array into chunks
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Delay execution
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limit function calls
 */
export function rateLimit<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number,
  interval: number
): T {
  const queue: Array<() => void> = [];
  let running = 0;

  const processQueue = () => {
    if (queue.length === 0 || running >= limit) return;
    running++;
    const next = queue.shift();
    next?.();
    setTimeout(() => {
      running--;
      processQueue();
    }, interval);
  };

  return ((...args: unknown[]) => {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        Promise.resolve(fn(...args))
          .then(resolve)
          .catch(reject);
      });
      processQueue();
    });
  }) as T;
}
