export type ProviderType = 'residential' | 'datacenter' | 'mobile' | 'isp' | 'scraping' | 'general';

export interface AffiliateProvider {
  name: string;
  href: string;
  type: ProviderType;
  tagline: string;
  evidenceNote?: string;
}

const providers: AffiliateProvider[] = [
  {
    name: 'Bright Data',
    href: 'https://get.brightdata.com/luminati-proxy',
    type: 'residential',
    tagline: 'Enterprise-grade residential coverage for scale, geo targeting, and compliance-sensitive scraping.',
    evidenceNote: 'Best when access reliability and auditability matter more than lowest unit price.',
  },
  {
    name: 'Soax',
    href: 'https://soax.com/?r=cUgaoF3u',
    type: 'residential',
    tagline: 'Reliable residential & mobile pools with flexible rotation control.',
    evidenceNote: 'Good fit for buyers comparing residential and mobile product pages side by side.',
  },
  {
    name: 'Decodo',
    href: 'https://smartproxy.pxf.io/deals',
    type: 'residential',
    tagline: 'SMB-friendly proxy network formerly known as Smartproxy, with broad proxy-type coverage.',
    evidenceNote: 'Use Decodo as the current brand while preserving Smartproxy search intent.',
  },
  {
    name: 'Proxy-Seller',
    href: 'https://proxy-seller.com/?partner=REVhIGcljl3h0',
    type: 'datacenter',
    tagline: 'Fast datacenter proxies with solid uptime and flexible plans.',
    evidenceNote: 'Value-oriented option where the exact product page supports the proxy type.',
  },
  {
    name: 'Webshare',
    href: 'https://proxy.webshare.io/register/?referral_code=xn5m7d467sbh',
    type: 'datacenter',
    tagline: 'Cost-effective datacenter proxies for high-volume workloads.',
    evidenceNote: 'Self-serve fit for budget datacenter tests and low-friction proxy setup.',
  },
  {
    name: 'Rayobyte',
    href: 'https://billing.rayobyte.com/hosting/aff.php?aff=455&to=http://rayobyte.com/',
    type: 'datacenter',
    tagline: 'Stable datacenter options with business-friendly support.',
    evidenceNote: 'Current brand for legacy Blazing Proxies references.',
  },
  {
    name: 'TheSocialProxy',
    href: 'https://thesocialproxy.com/?ref=privateproxyreviews@gmail.com',
    type: 'mobile',
    tagline: 'Mobile IPs optimized for social automation and app testing.',
    evidenceNote: 'Reserve mobile bandwidth for social, app, and carrier-reputation workflows.',
  },
  {
    name: 'Proxy-Cheap',
    href: 'https://app.proxy-cheap.com/r/mRP1Si',
    type: 'mobile',
    tagline: 'Affordable mobile and residential options for smaller teams.',
    evidenceNote: 'Budget-first option; verify whether claims use headline prices or visible plan-card prices.',
  },
  {
    name: 'Bright Data',
    href: 'https://get.brightdata.com/q7327d',
    type: 'scraping',
    tagline: 'Managed web-data infrastructure, scraper APIs, datasets, Browser API, and Scraper Studio.',
    evidenceNote: 'Best when the buyer wants managed access or data, not just raw proxy endpoints.',
  },
  {
    name: 'Apify',
    href: 'https://apify.com/',
    type: 'scraping',
    tagline: 'Actor marketplace and automation runtime for source-specific scraping workflows.',
    evidenceNote: 'Use as a scraping-tool recommendation, not a generic proxy-network recommendation.',
  },
];

export function getProvidersForType(type: ProviderType, limit = 3) {
  const list = providers.filter((provider) => provider.type === type);
  if (list.length > 0) return list.slice(0, limit);

  return providers.filter((provider) => provider.type === 'residential').slice(0, limit);
}

export function getGeneralProviders(limit = 3) {
  return providers.slice(0, limit);
}

export function inferProviderTypeFromKeyword(keyword: string): ProviderType {
  const text = keyword.toLowerCase();

  if (
    text.includes('mobile') ||
    text.includes('social') ||
    text.includes('tiktok') ||
    text.includes('instagram')
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

export function inferProviderTypeFromGuide(slug: string): ProviderType {
  if (slug.includes('mobile')) return 'mobile';
  if (slug.includes('datacenter')) return 'datacenter';
  if (slug.includes('residential')) return 'residential';
  if (slug.includes('bright-data') || slug.includes('apify')) return 'scraping';
  if (slug.includes('web-scraping')) return 'scraping';
  if (slug.includes('provider')) return 'general';
  return 'residential';
}
