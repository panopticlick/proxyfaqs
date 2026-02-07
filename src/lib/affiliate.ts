export type ProviderType = 'residential' | 'datacenter' | 'mobile' | 'isp' | 'scraping' | 'general';

export interface AffiliateProvider {
  name: string;
  href: string;
  type: ProviderType;
  tagline: string;
}

const providers: AffiliateProvider[] = [
  {
    name: 'BrightData',
    href: 'https://get.brightdata.com/luminati-proxy',
    type: 'residential',
    tagline: 'Enterprise-grade residential coverage with deep geo targeting.',
  },
  {
    name: 'Soax',
    href: 'https://soax.com/?r=cUgaoF3u',
    type: 'residential',
    tagline: 'Reliable residential & mobile pools with flexible rotation control.',
  },
  {
    name: 'Smartproxy',
    href: 'https://smartproxy.pxf.io/deals',
    type: 'residential',
    tagline: 'Balanced pricing and coverage for scraping and data collection.',
  },
  {
    name: 'Proxy-Seller',
    href: 'https://proxy-seller.com/?partner=REVhIGcljl3h0',
    type: 'datacenter',
    tagline: 'Fast datacenter proxies with solid uptime and flexible plans.',
  },
  {
    name: 'Webshare',
    href: 'https://proxy.webshare.io/register/?referral_code=xn5m7d467sbh',
    type: 'datacenter',
    tagline: 'Cost-effective datacenter proxies for high-volume workloads.',
  },
  {
    name: 'Rayobyte',
    href: 'https://billing.rayobyte.com/hosting/aff.php?aff=455&to=http://rayobyte.com/',
    type: 'datacenter',
    tagline: 'Stable datacenter options with business-friendly support.',
  },
  {
    name: 'TheSocialProxy',
    href: 'https://thesocialproxy.com/?ref=privateproxyreviews@gmail.com',
    type: 'mobile',
    tagline: 'Mobile IPs optimized for social automation and app testing.',
  },
  {
    name: 'Proxy-Cheap',
    href: 'https://app.proxy-cheap.com/r/mRP1Si',
    type: 'mobile',
    tagline: 'Affordable mobile and residential options for smaller teams.',
  },
  {
    name: 'BrightData',
    href: 'https://get.brightdata.com/luminati-proxy',
    type: 'scraping',
    tagline: 'Robust proxy infrastructure for demanding scraping workloads.',
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
  if (slug.includes('web-scraping')) return 'scraping';
  if (slug.includes('provider')) return 'general';
  return 'residential';
}
