import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');

const env = z
  .object({
    PORT: z.coerce.number().int().positive().default(3000),
    PUBLIC_SUPABASE_URL: z.string().url().optional(),
    PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional().default(''),
    OPENROUTER_MODEL: z.string().optional().default('google/gemini-2.0-flash-exp:free'),
    VECTORENGINE_API_KEY: z.string().optional().default(''),
    VECTORENGINE_BASE_URL: z.string().url().default('https://api.vectorengine.ai'),
  })
  .passthrough()
  .parse(process.env);

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function withSecurityHeaders(headers) {
  return { ...SECURITY_HEADERS, ...headers };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(
    status,
    withSecurityHeaders({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    })
  );
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function normalizeSearchQuery(input) {
  const MAX_TERMS = 8;
  return String(input || '')
    .toLowerCase()
    .replace(/[^\w\s-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, MAX_TERMS)
    .join(' ');
}

function normalizeSearchLimit(value, fallback = 20) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 100);
}

const IMMUTABLE_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.mjs',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.ico',
  '.woff',
  '.woff2',
]);

function cacheControlForPath(pathname, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (pathname.startsWith('/assets/') || IMMUTABLE_EXTENSIONS.has(ext)) {
    return 'public, max-age=31536000, immutable';
  }
  if (ext === '.html') {
    return 'no-cache';
  }
  return 'public, max-age=3600';
}

async function handleSearch(req, res, url) {
  const query = url.searchParams.get('q') || '';
  const limit = normalizeSearchLimit(url.searchParams.get('limit'));

  if (!query.trim() || query.length < 2) {
    return json(res, 200, { results: [], query: '' });
  }

  const normalized = normalizeSearchQuery(query);
  if (!normalized) {
    return json(res, 200, { results: [], query: '' });
  }

  const baseUrl = env.PUBLIC_SUPABASE_URL;
  const anonKey = env.PUBLIC_SUPABASE_ANON_KEY;

  if (!baseUrl || !anonKey) {
    return json(res, 200, { results: [], query, error: 'Search unavailable' });
  }

  async function supabaseSearch(mode) {
    const endpoint = new URL(`${baseUrl}/rest/v1/questions`);
    endpoint.searchParams.set('select', 'id,slug,question,answer,category,view_count');
    endpoint.searchParams.set('limit', String(limit));

    if (mode === 'fts') {
      endpoint.searchParams.set('search_vector', `plfts.${normalized}`);
    } else {
      endpoint.searchParams.set('question', `ilike.%${normalized}%`);
    }

    const response = await fetch(endpoint.toString(), {
      headers: {
        apikey: anonKey,
        'Content-Type': 'application/json',
        'Accept-Profile': 'proxyfaqs',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(errorText || 'Search request failed');
    }

    return response.json();
  }

  try {
    const results = await supabaseSearch('fts');
    return json(res, 200, { results: results || [], query, fallback: false });
  } catch (error) {
    try {
      const results = await supabaseSearch('ilike');
      return json(res, 200, { results: results || [], query, fallback: true });
    } catch {
      return json(res, 500, { results: [], query, error: 'Search failed' });
    }
  }
}

const SYSTEM_PROMPT = `You are a proxy expert with 10+ years of experience in web scraping and data extraction. You have personally tested BrightData, Soax, Smartproxy, Proxy-Cheap, and Proxy-Seller.

Your expertise includes:
- Residential, datacenter, mobile, and rotating proxies
- Anti-detection techniques and fingerprinting
- Rate limiting and request throttling strategies
- Handling CAPTCHAs and JavaScript challenges
- Legal and ethical considerations of web scraping

When answering:
1. Be technical but accessible - explain complex concepts simply
2. Recommend specific proxy types based on the user's use case
3. When recommending providers, explain WHY based on their specific needs
4. Include affiliate links naturally when relevant (always disclosed)
5. Acknowledge limitations and edge cases
6. Provide code examples in Python when helpful

Current page context will be provided to help you give relevant answers.`;

const AFFILIATE_PROVIDERS = {
  residential: [
    {
      name: 'BrightData',
      href: 'https://get.brightdata.com/luminati-proxy',
      reason: 'enterprise coverage and geo targeting',
    },
    {
      name: 'Soax',
      href: 'https://soax.com/?r=cUgaoF3u',
      reason: 'flexible rotation and residential quality',
    },
    {
      name: 'Smartproxy',
      href: 'https://smartproxy.pxf.io/deals',
      reason: 'balanced pricing and coverage',
    },
  ],
  datacenter: [
    {
      name: 'Proxy-Seller',
      href: 'https://proxy-seller.com/?partner=REVhIGcljl3h0',
      reason: 'fast datacenter IPs with stable uptime',
    },
    {
      name: 'Webshare',
      href: 'https://proxy.webshare.io/register/?referral_code=xn5m7d467sbh',
      reason: 'cost-effective datacenter pools',
    },
    {
      name: 'Rayobyte',
      href: 'https://billing.rayobyte.com/hosting/aff.php?aff=455&to=http://rayobyte.com/',
      reason: 'reliable datacenter infrastructure',
    },
  ],
  mobile: [
    {
      name: 'TheSocialProxy',
      href: 'https://thesocialproxy.com/?ref=privateproxyreviews@gmail.com',
      reason: 'mobile IPs for social automation',
    },
    {
      name: 'Proxy-Cheap',
      href: 'https://app.proxy-cheap.com/r/mRP1Si',
      reason: 'budget-friendly mobile options',
    },
    {
      name: 'Soax',
      href: 'https://soax.com/?r=cUgaoF3u',
      reason: 'flexible mobile rotation control',
    },
  ],
  scraping: [
    {
      name: 'BrightData',
      href: 'https://get.brightdata.com/luminati-proxy',
      reason: 'strong anti-bot resilience',
    },
    {
      name: 'Smartproxy',
      href: 'https://smartproxy.pxf.io/deals',
      reason: 'good coverage and straightforward setup',
    },
    {
      name: 'Soax',
      href: 'https://soax.com/?r=cUgaoF3u',
      reason: 'stable pool and flexible session control',
    },
  ],
};

function inferProxyType(text) {
  const normalized = text.toLowerCase();
  if (
    normalized.includes('mobile') ||
    normalized.includes('instagram') ||
    normalized.includes('tiktok') ||
    normalized.includes('social')
  ) {
    return 'mobile';
  }
  if (
    normalized.includes('datacenter') ||
    normalized.includes('data center') ||
    normalized.includes('cheap') ||
    normalized.includes('bulk')
  ) {
    return 'datacenter';
  }
  if (normalized.includes('scraper api') || normalized.includes('scraping api')) {
    return 'scraping';
  }
  return 'residential';
}

function buildRecommendationContext(message, pageContext) {
  const contextText = `${message} ${pageContext || ''}`;
  const proxyType = inferProxyType(contextText);
  const providerList = AFFILIATE_PROVIDERS[proxyType] || AFFILIATE_PROVIDERS.residential;

  const providerLines = providerList
    .map((provider) => `- ${provider.name}: ${provider.href} (${provider.reason})`)
    .join('\n');

  return `Recommended proxy type: ${proxyType}. When suggesting providers, use these affiliate links and disclose affiliate status:\n${providerLines}`;
}

async function handleChat(req, res) {
  const payload = await readJsonBody(req);
  const message = typeof payload.message === 'string' ? payload.message : '';
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : undefined;
  const pageContext = typeof payload.pageContext === 'string' ? payload.pageContext : undefined;

  if (!message || !message.trim()) {
    return json(res, 400, { error: 'Message is required' });
  }

  const useOpenRouter = Boolean(env.OPENROUTER_API_KEY);
  const useVectorEngine = !useOpenRouter && Boolean(env.VECTORENGINE_API_KEY);

  if (!useOpenRouter && !useVectorEngine) {
    return json(res, 200, {
      response:
        "I'm your proxy assistant! For the best experience, please ensure the API is configured. In the meantime, you can browse our FAQ pages or compare providers.",
      sessionId,
    });
  }

  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (pageContext) {
    messages.push({
      role: 'system',
      content: `The user is currently viewing: ${pageContext}`,
    });
  }
  messages.push({
    role: 'system',
    content: buildRecommendationContext(message, pageContext),
  });
  messages.push({ role: 'user', content: message });

  const apiUrl = useOpenRouter
    ? `${OPENROUTER_BASE_URL}/chat/completions`
    : `${env.VECTORENGINE_BASE_URL}/v1/chat/completions`;

  const apiKey = useOpenRouter ? env.OPENROUTER_API_KEY : env.VECTORENGINE_API_KEY;
  const model = useOpenRouter ? env.OPENROUTER_MODEL : 'grok-4-fast-non-reasoning';

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (useOpenRouter) {
    headers['HTTP-Referer'] = 'https://proxyfaqs.com';
    headers['X-Title'] = 'ProxyFAQs';
  }

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    return json(res, 200, {
      response:
        "I'm having trouble connecting right now. Please try again in a moment, or browse our FAQ pages for answers.",
      sessionId,
    });
  }

  const data = await response.json();
  const assistantMessage =
    data.choices?.[0]?.message?.content || 'I apologize, but I could not generate a response.';

  return json(res, 200, { response: assistantMessage, sessionId });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.webmanifest':
      return 'application/manifest+json';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

function toSafePathname(urlPathname) {
  const decoded = decodeURIComponent(urlPathname);
  const normalized = path.posix.normalize(decoded);
  if (!normalized.startsWith('/')) return '/';
  if (normalized.includes('..')) return '/';
  return normalized;
}

async function tryServeFile(res, filePath, options = {}) {
  const { status = 200, cacheControl = 'public, max-age=3600' } = options;
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;

    res.writeHead(
      status,
      withSecurityHeaders({
        'Content-Type': contentTypeFor(filePath),
        'Content-Length': fileStat.size,
        'Cache-Control': cacheControl,
      })
    );
    createReadStream(filePath).pipe(res);
    return true;
  } catch {
    return false;
  }
}

async function serveStatic(req, res, urlPathname) {
  const pathname = toSafePathname(urlPathname);

  if (pathname === '/') {
    const indexPath = path.join(distDir, 'index.html');
    if (
      await tryServeFile(res, indexPath, {
        cacheControl: cacheControlForPath(pathname, indexPath),
      })
    )
      return;
    return json(res, 500, { error: 'Missing dist/index.html' });
  }

  const hasExtension = path.posix.basename(pathname).includes('.');
  if (hasExtension) {
    const filePath = path.join(distDir, pathname);
    if (
      await tryServeFile(res, filePath, {
        cacheControl: cacheControlForPath(pathname, filePath),
      })
    )
      return;
  }

  const indexPath = path.join(distDir, pathname, 'index.html');
  if (
    await tryServeFile(res, indexPath, {
      cacheControl: cacheControlForPath(pathname, indexPath),
    })
  )
    return;

  const notFoundPage = path.join(distDir, '404', 'index.html');
  if (existsSync(notFoundPage)) {
    if (
      await tryServeFile(res, notFoundPage, {
        status: 404,
        cacheControl: cacheControlForPath('/404', notFoundPage),
      })
    )
      return;
  }

  res.writeHead(
    404,
    withSecurityHeaders({
      'Content-Type': 'text/plain; charset=utf-8',
    })
  );
  res.end('Not Found');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/health') {
      return json(res, 200, { status: 'ok' });
    }

    if (url.pathname === '/api/search' && req.method === 'GET') {
      return await handleSearch(req, res, url);
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      return await handleChat(req, res);
    }

    return await serveStatic(req, res, url.pathname);
  } catch (error) {
    return json(res, 500, { error: 'Internal Server Error' });
  }
});

server.listen(env.PORT, '0.0.0.0', () => {
  console.log(`ProxyFAQs listening on :${env.PORT}`);
});
