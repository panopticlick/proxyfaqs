export interface Guide {
  slug: string;
  title: string;
  description: string;
  category: string;
  readingTime: string;
  updatedAt: string;
  content: string;
}

export const guides: Guide[] = [
  {
    slug: "getting-started",
    title: "Getting Started with Proxies",
    description:
      "Learn what proxies are, why they matter for data collection, and how to pick the right starting setup.",
    category: "Beginners",
    readingTime: "6 min read",
    updatedAt: "2026-01-05",
    content: `## What a proxy actually does
A proxy sits between your scraper and the target site. It changes the IP address seen by the target, helps distribute traffic, and reduces blocks.

## When you need a proxy
- You make repeated requests to the same site
- You need to access geo-restricted content
- You collect data at scale

## Quick setup checklist
1. Pick a proxy type (residential for reliability, datacenter for speed)
2. Decide rotation strategy (per request vs sticky sessions)
3. Set a conservative request rate
4. Track success rate and block rate

## Common beginner mistakes
- Using one IP for everything
- Ignoring robots.txt and site terms
- Sending bursts of traffic without throttling

## Next steps
- Explore **Residential vs Datacenter**
- Read **Web Scraping Best Practices**
- Compare providers on the **Providers** page
`,
  },
  {
    slug: "choosing-proxy-type",
    title: "Choosing the Right Proxy Type",
    description:
      "Compare residential, datacenter, mobile, and ISP proxies so you can match the proxy to the target.",
    category: "Proxy Types",
    readingTime: "7 min read",
    updatedAt: "2026-01-05",
    content: `## Residential proxies
Best for high block resistance and geo accuracy. Slower and more expensive, but safest for sensitive targets.

## Datacenter proxies
Fast and affordable. Good for low-block targets and high-volume scraping, but more likely to be blocked.

## Mobile proxies
Ideal for social platforms and app automation. Highest trust, higher cost, lower speed.

## ISP proxies
Hybrid: fast like datacenter, trusted like residential. Great for login flows and account actions.

## Decision matrix
- High block risk: Residential or ISP
- Need speed: Datacenter or ISP
- Social platforms: Mobile
- Budget constraints: Datacenter
`,
  },
  {
    slug: "web-scraping-guide",
    title: "Web Scraping Best Practices",
    description:
      "Reduce blocks, avoid bans, and keep data quality high with a proven scraping playbook.",
    category: "Web Scraping",
    readingTime: "8 min read",
    updatedAt: "2026-01-05",
    content: `## Core principles
- Respect rate limits and avoid spikes
- Rotate IPs and user agents
- Cache responses when possible

## Anti-detection techniques
- Randomized delays
- Realistic headers
- Session persistence for logins
- CAPTCHA handling

## Data quality tips
- Validate HTML responses
- Detect block pages
- Retry with backoff
- Store raw HTML for debugging

## Legal and ethical note
Always comply with target site terms and regional regulations.
`,
  },
  {
    slug: "residential-proxies",
    title: "Residential Proxies Explained",
    description:
      "Understand how residential proxies work, when to use them, and how to keep costs under control.",
    category: "Residential Proxies",
    readingTime: "6 min read",
    updatedAt: "2026-01-05",
    content: `## Why residential works
Residential IPs look like real users, which lowers block rates on strict targets.

## Rotation strategies
- Per-request rotation for maximum freshness
- Sticky sessions for account workflows

## Cost control
- Use residential only where needed
- Deduplicate requests
- Cache expensive pages

## Common use cases
- E-commerce pricing
- Search engines
- Social media
`,
  },
  {
    slug: "datacenter-proxies",
    title: "Datacenter Proxies Guide",
    description:
      "High-speed proxies for bulk scraping and fast crawling, with tips to minimize bans.",
    category: "Datacenter Proxies",
    readingTime: "5 min read",
    updatedAt: "2026-01-05",
    content: `## When datacenter wins
- Large-scale crawling
- Targets with low protection
- Cost-sensitive workflows

## Reduce bans
- Use smaller request bursts
- Rotate subnets, not just IPs
- Monitor for block patterns

## Pairing with residential
Use datacenter for discovery, residential for sensitive pages.
`,
  },
  {
    slug: "mobile-proxies",
    title: "Mobile Proxies Tutorial",
    description:
      "Learn how mobile IPs help with social media automation and why they are the most trusted proxy type.",
    category: "Mobile Proxies",
    readingTime: "6 min read",
    updatedAt: "2026-01-05",
    content: `## Why mobile proxies
Mobile IPs are shared across many users and are trusted by platforms like Instagram and TikTok.

## Best use cases
- Social media automation
- App testing
- Geo-sensitive workflows

## Things to watch
- Slower response time
- Higher cost per GB
- Limited concurrency
`,
  },
  {
    slug: "provider-comparison",
    title: "Proxy Provider Comparison",
    description:
      "What to look for in a provider: coverage, rotation controls, pricing, support, and compliance.",
    category: "Providers",
    readingTime: "7 min read",
    updatedAt: "2026-01-05",
    content: `## Evaluation criteria
- IP quality and ASN diversity
- Rotation controls (sticky vs rotating)
- Geographic coverage
- Pricing transparency
- Support and SLAs

## Quick shortlist
Use the Providers page to compare features and pricing side by side.

## Tip
Match providers to your target: what works for search engines may fail on social platforms.
`,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting Proxy Issues",
    description:
      "Diagnose blocks, timeouts, and data gaps with a repeatable troubleshooting checklist.",
    category: "Troubleshooting",
    readingTime: "8 min read",
    updatedAt: "2026-01-05",
    content: `## Common issues
- HTTP 403/429 blocks
- Slow response times
- Empty or partial responses

## Step-by-step diagnosis
1. Verify target site is up
2. Test direct connection without proxy
3. Rotate IP and user agent
4. Reduce request rate
5. Validate response content

## When to switch proxy types
If your block rate stays high, move from datacenter to residential or ISP.
`,
  },
];

export function getGuideBySlug(slug: string): Guide | undefined {
  return guides.find((guide) => guide.slug === slug);
}
