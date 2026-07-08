import type { ProviderType } from './affiliate';
import type { ProxyClusterPage } from './pseo';
import type { Provider } from './supabase';
import { slugify } from './utils';

export interface ProviderEvidence {
  slug: string;
  aliases: string[];
  displayName: string;
  lastReviewed: string;
  sourceLabel: string;
  sourceNote: string;
  bestFor: string[];
  watchouts: string[];
  proofPoints: string[];
  productFit: Partial<Record<ProviderType, string>>;
  pricingNote?: string;
  ctaNote?: string;
}

export interface UseCaseInsight {
  title: string;
  summary: string;
  checklist: string[];
  recommendedProviderType: ProviderType;
  providerRationale: string;
  scraperAlternative?: {
    title: string;
    summary: string;
    bullets: string[];
    ctaHref: string;
    ctaLabel: string;
  };
}

export interface GuideUpgrade {
  slug: string;
  evaluationLens: string[];
  practicalMistakes: string[];
  recommendedNext: string[];
}

export const methodologyHighlights = [
  'Separate proxy-network claims from scraping API and actor-marketplace claims.',
  'Prefer dated official product pages, canonical merchant bundles, and first-hand account proof over generic review copy.',
  'Treat provider ratings and rankings as editorial summaries only when they are backed by review text, not importer defaults.',
  'Re-check money claims quarterly because proxy pricing, plan cards, and promotional entry prices move often.',
];

export const providerEvidence: ProviderEvidence[] = [
  {
    slug: 'apify',
    aliases: ['apify'],
    displayName: 'Apify',
    lastReviewed: '2026-07-01',
    sourceLabel: 'Bright Data / Apify proof pack',
    sourceNote:
      'Treat Apify as a scraping-tool and actor-platform page, not as a generic residential or mobile proxy provider.',
    bestFor: [
      'Developers or no-code users who want to run a source-specific scraping workflow quickly',
      'Teams comparing actor marketplaces, automation runtimes, or scraping-tool stacks',
      'Operator workflows where speed to the first result matters more than owning the proxy network layer',
    ],
    watchouts: [
      'Do not describe Apify as a broad proxy-network pick on residential, datacenter, mobile, or ISP pages.',
      'Actor quality varies by source and maintainer, so the evaluation lens is workflow fit rather than proxy inventory.',
      'Money claims should separate platform pricing from actor-specific per-event or per-result charges.',
    ],
    proofPoints: [
      'Bright Data / Apify content pack positions Apify as the “give me the tool” option versus Bright Data as the “give me the data” option.',
      'Apify evidence belongs in actor, no-code, workflow, and scraping-tool comparisons.',
      'Keep actor IDs and store-scale proof on page-local comparison content rather than proxy merchant bundles.',
    ],
    productFit: {
      scraping:
        'Best fit when the user wants a runnable actor, a fast prototype, or an automation workflow rather than a raw proxy pool.',
      general:
        'Useful comparison point in scraping-tool guides, but not a universal proxy-network recommendation.',
    },
    pricingNote:
      'Keep platform, compute, and actor-event pricing separate and dated because those levers are easy to blur in generic review copy.',
  },
  {
    slug: 'bright-data',
    aliases: ['brightdata', 'bright-data', 'luminati'],
    displayName: 'Bright Data',
    lastReviewed: '2026-06-29',
    sourceLabel: 'Canonical merchant bundle + Bright Data / Apify proof pack',
    sourceNote:
      'Use Bright Data proxy facts for provider pages and keep scraper-library dataset IDs in page-local proof sections only.',
    bestFor: [
      'Enterprise and compliance-sensitive scraping programs',
      'Teams that need residential, ISP, mobile, datacenter, unlocker, browser, and scraper API surfaces from one vendor',
      'Large recurring data pipelines where reliability and auditability matter more than the lowest entry price',
    ],
    watchouts: [
      'Product surface is broad, so first setup can feel heavier than self-serve SMB proxy tools.',
      'Do not collapse proxy-network pricing, Web Scraper API pricing, and Browser API pricing into one blended number.',
      'Apify-style actor workflows are a different buying motion; compare them separately when the user wants a runnable tool.',
    ],
    proofPoints: [
      'Proxy coverage includes residential, ISP, datacenter, and mobile network products.',
      'Public bundle tracks Web Unlocker, Web Scraper API, Scraper Studio, and Browser API as adjacent data-access products.',
      'Bright Data Web Scraper API evidence includes dated per-record pricing examples and real-account proof assets.',
    ],
    productFit: {
      residential:
        'Strong fit when block resistance, geo breadth, compliance posture, and scale matter more than absolute lowest GB price.',
      isp: 'Strong fit for login-sensitive or session-stable work that needs residential-like trust with cleaner routing control.',
      mobile:
        'Strong fit for social, mobile-app, and carrier-reputation workflows, but cost and concurrency need explicit control.',
      datacenter:
        'Useful for high-volume lower-risk crawling, especially when paired with unlocker or residential fallbacks.',
      scraping:
        'Best positioned as an access-and-data platform: Web Scraper API, Scraper Studio, Unlocker, SERP API, and Browser API.',
      general:
        'Best overall enterprise pick when the buyer needs one durable vendor across proxy networks and web-data products.',
    },
    pricingNote:
      'Tracked public proxy-network evidence includes dated entry prices for residential, ISP, datacenter, mobile, and scraper products; verify live pricing before publishing new money claims.',
    ctaNote:
      'For Scraper Studio-specific CTAs, use the validated no-trailing-slash Bright Data route from the project affiliate layer.',
  },
  {
    slug: 'soax',
    aliases: ['soax'],
    displayName: 'SOAX',
    lastReviewed: '2026-05-25',
    sourceLabel: 'Canonical proxy merchant bundle',
    sourceNote:
      'Use direct SOAX product pages for residential, mobile, datacenter, and Web Data API claims.',
    bestFor: [
      'Teams that want separated product pages for residential, mobile, datacenter, and Web Data API products',
      'Proxy buyers who value rotation controls and geographic targeting without enterprise-only positioning',
      'Use cases where residential and mobile coverage need to be compared side by side',
    ],
    watchouts: [
      'The broad pricing hub can be less precise than product pages for product-specific comparisons.',
      'ISP coverage should not be inferred unless the current SOAX page explicitly supports it.',
    ],
    proofPoints: [
      'Canonical bundle tracks direct official pages for residential, mobile, datacenter, and Web Data API surfaces.',
      'Pricing evidence is product-page based where available.',
      'Screenshot evidence exists for pricing review workflows.',
    ],
    productFit: {
      residential: 'Good fit for mainstream residential rotation and geo-targeted scraping workflows.',
      mobile: 'Good fit for social and app workflows where mobile-network reputation matters.',
      datacenter: 'Useful where cost and speed matter but some provider-side targeting controls are still needed.',
      scraping: 'Relevant when the buyer wants a Web Data API alongside proxy inventory.',
      general: 'Good mid-market proxy option when the decision is about flexible network coverage.',
    },
    pricingNote:
      'Use SOAX product pages over a generic pricing hub when quoting product-specific price or coverage claims.',
  },
  {
    slug: 'decodo',
    aliases: ['decodo', 'smartproxy'],
    displayName: 'Decodo',
    lastReviewed: '2026-05-25',
    sourceLabel: 'Canonical proxy merchant bundle',
    sourceNote:
      'Preserve Smartproxy legacy alias continuity, but use Decodo as the current brand.',
    bestFor: [
      'SMB and mid-market teams comparing residential, ISP, datacenter, mobile, and scraping services',
      'Buyers who remember Smartproxy and need a current-brand mapping',
      'Budget-sensitive proxy comparisons where usability still matters',
    ],
    watchouts: [
      'Pricing pages drift independently by product family, so cite the exact Decodo SKU page in use.',
      'Use “Decodo, formerly Smartproxy” where search intent still uses the legacy brand.',
    ],
    proofPoints: [
      'Canonical bundle maps Smartproxy as a legacy alias of Decodo.',
      'Tracked product families include residential, ISP, datacenter, mobile, and scraping services.',
      'Dated pricing evidence exists for multiple proxy categories.',
    ],
    productFit: {
      residential: 'Strong SMB-friendly residential option when ease of purchase and value are important.',
      isp: 'Useful for account and session workflows when Decodo ISP pricing is the matched source page.',
      datacenter: 'Good fit for lower-cost scraping paths where speed matters more than consumer-IP reputation.',
      mobile: 'Relevant for mobile or social workflows with explicit GB-cost checks.',
      scraping: 'Useful as a proxy-plus-scraping-services comparison point against pure proxy networks.',
      general: 'Good broad comparison pick for users cross-shopping legacy Smartproxy references.',
    },
    pricingNote:
      'Quote Decodo pricing only from the exact product pricing page because residential, ISP, datacenter, and mobile SKUs change independently.',
  },
  {
    slug: 'proxy-seller',
    aliases: ['proxy-seller', 'proxy seller'],
    displayName: 'Proxy-Seller',
    lastReviewed: '2026-04-13',
    sourceLabel: 'Canonical proxy merchant bundle',
    sourceNote:
      'Keep sponsor or affiliate preference out of global facts; use this only for product-fit copy.',
    bestFor: [
      'Value-oriented residential and ISP proxy buyers',
      'Users comparing private datacenter or country-specific datacenter inventory',
      'Teams that want a simpler proxy-network purchase path without a broad scraping platform',
    ],
    watchouts: [
      'Datacenter evidence may be country-specific rather than one universal datacenter hub.',
      'Do not turn sponsor preference into an objective ranking claim.',
    ],
    proofPoints: [
      'Canonical bundle tracks residential, datacenter, mobile, and ISP product pages.',
      'Residential and ISP pages include public entry-price cues.',
      'Country-specific datacenter evidence is tracked separately from general network claims.',
    ],
    productFit: {
      residential: 'Good value-oriented residential option when price sensitivity is high.',
      isp: 'Good fit for stable-session needs where per-IP pricing is easier to forecast.',
      datacenter: 'Useful for country-specific datacenter proxy comparisons.',
      mobile: 'Relevant where the buyer wants a proxy-network-only mobile option.',
      general: 'Good comparison candidate for users who prefer focused proxy products over broad data platforms.',
    },
    pricingNote:
      'Use dated product-page evidence for residential and ISP pricing; keep datacenter claims scoped to the matched country page.',
  },
  {
    slug: 'webshare',
    aliases: ['webshare'],
    displayName: 'Webshare',
    lastReviewed: '2026-05-25',
    sourceLabel: 'Canonical proxy merchant bundle',
    sourceNote:
      'Use current product pages because Webshare retires or changes route variants over time.',
    bestFor: [
      'Self-serve datacenter proxy buyers',
      'Users who want a low-friction proxy dashboard and separated product offers',
      'Budget-conscious scraping teams that can tolerate more tuning work',
    ],
    watchouts: [
      'Product route names change; avoid stale feature-page aliases.',
      'Residential and static residential offers should not be described as mobile or ISP coverage.',
    ],
    proofPoints: [
      'Canonical bundle tracks dedicated datacenter, residential, and static residential product pages.',
      'Residential entry-price evidence is dated and product-page based.',
      'Pricing screenshot evidence exists for review workflows.',
    ],
    productFit: {
      datacenter: 'Strong self-serve fit for budget datacenter scraping and high-volume tests.',
      residential: 'Useful when the buyer wants self-serve residential bandwidth without enterprise onboarding.',
      general: 'Good low-friction provider for users who can test and tune proxy quality themselves.',
    },
    pricingNote:
      'Use the current product page for each Webshare offer instead of old feature aliases.',
  },
  {
    slug: 'iproyal',
    aliases: ['iproyal'],
    displayName: 'IPRoyal',
    lastReviewed: '2026-05-25',
    sourceLabel: 'Canonical proxy merchant bundle',
    sourceNote:
      'Use exact product pages instead of the broad pricing hub for category-specific comparisons.',
    bestFor: [
      'Self-serve buyers who want several proxy product families in one account',
      'Budget-sensitive residential and datacenter comparisons',
      'Teams that need direct product pages for residential, datacenter, ISP, and mobile',
    ],
    watchouts: [
      'Plan detail can vary by country targeting and product page.',
      'Do not treat the pricing hub as enough evidence for every product family.',
    ],
    proofPoints: [
      'Canonical bundle tracks residential, datacenter, ISP, and mobile product lines.',
      'Dated residential and datacenter pricing evidence exists.',
      'Pricing screenshots are retained for review workflows.',
    ],
    productFit: {
      residential: 'Useful for budget residential comparisons where self-serve purchase flow matters.',
      datacenter: 'Relevant for low-cost datacenter proxy tests and small-to-mid scraping workloads.',
      isp: 'Potential fit for session-stable workflows, but quote exact product-page evidence.',
      mobile: 'Relevant for mobile network tests when the buyer can validate coverage needs directly.',
      general: 'Good broad self-serve comparison candidate.',
    },
    pricingNote:
      'Use product-specific IPRoyal pricing URLs when quoting residential, datacenter, ISP, or mobile claims.',
  },
  {
    slug: 'proxy-cheap',
    aliases: ['proxy-cheap', 'proxy cheap'],
    displayName: 'Proxy-Cheap',
    lastReviewed: '2026-05-25',
    sourceLabel: 'Canonical proxy merchant bundle',
    sourceNote:
      'Distinguish headline starting prices from visible pricing-card rates.',
    bestFor: [
      'Budget-first IPv4 datacenter buyers',
      'Users testing inexpensive residential, mobile, or static residential entry points',
      'Small teams that can validate quality before scaling spend',
    ],
    watchouts: [
      'Headline prices and visible plan-card prices can differ.',
      'Downstream copy should state whether a number is a monthly IP price, GB price, trial price, or headline starting price.',
    ],
    proofPoints: [
      'Canonical bundle tracks datacenter, residential, mobile, static residential, and ISP surfaces.',
      'Dated notes capture differences between page-title pricing and visible plan cards.',
      'Fresh screenshots were captured for multiple pricing/product surfaces.',
    ],
    productFit: {
      datacenter: 'Strong budget-oriented IPv4 option when low monthly entry price is the main requirement.',
      residential: 'Relevant for budget bandwidth tests when plan-card pricing is made explicit.',
      mobile: 'Relevant for low-cost mobile tests, but scale and quality should be validated before relying on it.',
      isp: 'Use only with exact product evidence because ISP data can be easy to overstate.',
      general: 'Good budget pick when the user accepts extra diligence around plan terms.',
    },
    pricingNote:
      'Keep headline start-from prices separate from visible tier prices to avoid misleading comparisons.',
  },
  {
    slug: 'rayobyte',
    aliases: ['rayobyte', 'blazing proxies', 'blazing seo llc', 'blazingseollc'],
    displayName: 'Rayobyte',
    lastReviewed: '2026-04-11',
    sourceLabel: 'Canonical proxy merchant bundle',
    sourceNote:
      'Preserve Blazing legacy aliases but keep current product claims tied to Rayobyte pages.',
    bestFor: [
      'Teams comparing larger public-data infrastructure vendors',
      'Users who need residential, datacenter, mobile, and ISP pages under one current brand',
      'Legacy Blazing Proxies users looking for the current Rayobyte identity',
    ],
    watchouts: [
      'Promotional language can be stronger than structured pricing evidence.',
      'Avoid quoting plan costs unless the exact current product page supports them.',
    ],
    proofPoints: [
      'Canonical bundle maps Blazing SEO LLC and Blazing Proxies as legacy aliases.',
      'Tracked product families include residential, datacenter, mobile, and ISP.',
      'Screenshot evidence exists for the residential page.',
    ],
    productFit: {
      residential: 'Relevant for larger public-data workflows that need a more established provider profile.',
      datacenter: 'Useful for data-center-heavy crawling where plan terms are validated separately.',
      isp: 'Potential fit for stable-session workloads when current product-page evidence is checked.',
      mobile: 'Relevant for mobile testing, but price normalization should remain conservative.',
      general: 'Good comparison candidate when identity continuity from Blazing to Rayobyte matters.',
    },
    pricingNote:
      'Keep pricing language conservative unless a current Rayobyte product page is directly cited.',
  },
];

export const brightDataApifyInsight = {
  updatedAt: '2026-07-01',
  headline: 'Bright Data gives you managed access to data; Apify gives you runnable scraping tools.',
  bullets: [
    'Use Bright Data when the buyer needs proxy networks, unlocker/browser infrastructure, ready scraper APIs, datasets, or compliance-reviewed scale.',
    'Use Apify when the buyer wants a fast no-code or developer workflow around a specific source, actor, or one-off extraction job.',
    'Keep Apify out of generic residential/datacenter/mobile proxy recommendations unless the page is explicitly about scraping tools or actor workflows.',
  ],
  proofPoints: [
    'Bright Data proof assets include real account captures, ready scraper-library evidence, and per-record examples such as Amazon product records.',
    'Apify proof assets belong in scraping-tool comparisons, actor workflow guides, and no-code extraction pages rather than proxy-network pages.',
  ],
};

export const guideUpgrades: GuideUpgrade[] = [
  {
    slug: 'getting-started',
    evaluationLens: [
      'Start with the target, not the provider: logins, geo checks, anti-bot sensitivity, and data volume decide the proxy type.',
      'Use datacenter for cheap discovery, residential or ISP for protected pages, and mobile only when platform reputation truly requires it.',
      'Treat any provider recommendation as a test plan until success rate, block rate, and unit cost are measured on the actual target.',
    ],
    practicalMistakes: [
      'Buying a large pool before running a 100-request pilot.',
      'Mixing login sessions with per-request rotation.',
      'Comparing providers by advertised IP pool size without checking targeting, rotation, replacement, and refund rules.',
    ],
    recommendedNext: ['choosing-proxy-type', 'troubleshooting', 'provider-comparison'],
  },
  {
    slug: 'choosing-proxy-type',
    evaluationLens: [
      'Residential is the default for protected public sites, but it should be metered carefully because bandwidth costs compound quickly.',
      'ISP is the best middle ground for sticky sessions, account workflows, and stable reputation when datacenter IPs are too easy to flag.',
      'Datacenter is still the best first test for open pages, indexing, and bulk crawl tasks where blocks are manageable.',
      'Mobile should be reserved for social, app, or mobile-carrier reputation cases because it is usually slower and more expensive.',
    ],
    practicalMistakes: [
      'Using mobile proxies for ordinary websites just because they sound “trusted.”',
      'Using datacenter proxies for account actions on protected platforms.',
      'Ignoring session length and rotating a cart or login flow mid-request sequence.',
    ],
    recommendedNext: ['residential-proxies', 'datacenter-proxies', 'mobile-proxies'],
  },
  {
    slug: 'web-scraping-guide',
    evaluationLens: [
      'Separate the scraping stack into access, rendering, parsing, data validation, and retry policy.',
      'Use proxy networks when you own the scraper; use scraper APIs, actor platforms, or datasets when the access and maintenance burden is the bigger problem.',
      'For recurring production data, record success rate, block reason, duplicate rate, and cost per usable record rather than only request volume.',
    ],
    practicalMistakes: [
      'Treating a 200 response as a successful scrape without checking the body for block pages or empty states.',
      'Turning on JavaScript rendering for every request instead of routing only pages that need it.',
      'Retrying aggressively without classifying whether the failure is target, proxy, parser, or fingerprint related.',
    ],
    recommendedNext: ['troubleshooting', 'provider-comparison', 'choosing-proxy-type'],
  },
  {
    slug: 'provider-comparison',
    evaluationLens: [
      'Compare providers by job: access layer, scraper API, actor marketplace, dataset purchase, or no-code extraction.',
      'Use merchant facts for product coverage and dated pricing, but keep site-specific affiliate and ranking preferences separate.',
      'A credible shortlist names where each provider is weak: setup complexity, plan ambiguity, actor variance, or missing product coverage.',
    ],
    practicalMistakes: [
      'Ranking every provider with one universal score despite different proxy types and scraping products.',
      'Trusting importer-generated ratings or generic descriptions without review text.',
      'Putting Apify into proxy-network comparisons when the actual value is actor workflows and developer speed.',
    ],
    recommendedNext: ['web-scraping-guide', 'choosing-proxy-type', 'troubleshooting'],
  },
  {
    slug: 'bright-data-vs-apify-for-scraping',
    evaluationLens: [
      'Use Bright Data when the buying problem is access, scale, compliance, or finished data products such as scraper APIs and datasets.',
      'Use Apify when the buying problem is speed to first result, actor reuse, or developer/no-code workflow flexibility.',
      'Keep proxy-network comparisons, scraper API comparisons, and actor-marketplace comparisons separate so one tool is not forced into the wrong category.',
    ],
    practicalMistakes: [
      'Comparing Bright Data proxy-network pricing directly against Apify actor-event pricing as if they were the same product shape.',
      'Assuming a buyer who wants a ready-made actor also wants to manage proxy rotation themselves.',
      'Forgetting to stamp the comparison with evidence dates when public pricing or store listings shift.',
    ],
    recommendedNext: ['web-scraping-guide', 'provider-comparison', 'troubleshooting'],
  },
];

export function normalizeProviderSlug(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getProviderEvidence(provider: Pick<Provider, 'slug' | 'name'> | null | undefined) {
  if (!provider) return undefined;

  const slug = normalizeProviderSlug(provider.slug);
  const name = normalizeProviderSlug(provider.name);

  return providerEvidence.find((item) => {
    const aliases = [item.slug, ...item.aliases].map(normalizeProviderSlug);
    return aliases.includes(slug) || aliases.includes(name);
  });
}

export function getProviderDisplayName(provider: Pick<Provider, 'slug' | 'name'>) {
  return getProviderEvidence(provider)?.displayName || provider.name;
}

export function getProviderFallbackDescription(provider: Pick<Provider, 'slug' | 'name'>) {
  const evidence = getProviderEvidence(provider);
  if (!evidence) return '';

  const fit = evidence.bestFor[0]?.replace(/\.$/, '') || 'practical proxy and scraping workflows';
  return `${evidence.displayName} is best for ${fit}.`;
}

function isGenericProviderBullet(value: string) {
  const text = value.toLowerCase().trim();
  return [
    'high-quality proxies',
    'reliable service',
    'pricing varies by plan',
  ].includes(text);
}

export function getProviderPros(provider: Pick<Provider, 'pros'>) {
  return (provider.pros || []).filter((item) => item && !isGenericProviderBullet(item));
}

export function getProviderCons(provider: Pick<Provider, 'cons'>) {
  return (provider.cons || []).filter((item) => item && !isGenericProviderBullet(item));
}

export function hasSubstantiveReview(provider: Provider): boolean {
  const reviewLength =
    typeof provider.review_html === 'string'
      ? provider.review_html.replace(/<[^>]*>/g, '').trim().length
      : 0;
  const descriptionLength =
    typeof provider.description === 'string' ? provider.description.trim().length : 0;

  return reviewLength >= 500 || descriptionLength >= 220 || !!getProviderEvidence(provider);
}

export function shouldShowEditorialRating(provider: Provider): boolean {
  return typeof provider.rating === 'number' && hasSubstantiveReview(provider);
}

export function getGuideUpgrade(slug: string): GuideUpgrade | undefined {
  return guideUpgrades.find((guide) => guide.slug === slug);
}

export function getTopProviderEvidence(limit = 4): ProviderEvidence[] {
  const shortlistOrder = ['bright-data', 'decodo', 'soax', 'apify'];
  const ranked = shortlistOrder
    .map((slug) => providerEvidence.find((item) => item.slug === slug))
    .filter((item): item is ProviderEvidence => !!item);

  if (ranked.length >= limit) {
    return ranked.slice(0, limit);
  }

  const seen = new Set(ranked.map((item) => item.slug));
  return ranked
    .concat(providerEvidence.filter((item) => !seen.has(item.slug)))
    .slice(0, limit);
}

export function getProviderTypeInsight(type: ProviderType) {
  const map: Record<ProviderType, { label: string; summary: string; checklist: string[] }> = {
    residential: {
      label: 'Residential proxy fit',
      summary:
        'Residential proxies are the safest default for protected public sites, geo-specific pages, and targets where datacenter IPs trigger blocks quickly.',
      checklist: [
        'Use sticky sessions for carts, logins, and multi-step flows.',
        'Measure cost per successful record, not only cost per GB.',
        'Keep datacenter discovery as a cheaper fallback when target risk is low.',
      ],
    },
    datacenter: {
      label: 'Datacenter proxy fit',
      summary:
        'Datacenter proxies are best for speed, low cost, and open targets where IP reputation is less sensitive.',
      checklist: [
        'Run a small block-rate pilot before buying large IP blocks.',
        'Rotate subnets and throttle bursts instead of only rotating single IPs.',
        'Escalate protected pages to ISP or residential pools when blocks rise.',
      ],
    },
    mobile: {
      label: 'Mobile proxy fit',
      summary:
        'Mobile proxies are strongest when the target cares about carrier reputation, app behavior, or social-platform trust.',
      checklist: [
        'Reserve mobile bandwidth for the steps that truly need it.',
        'Use sticky sessions for account and app workflows.',
        'Track latency and concurrency because mobile pools are not built for cheap bulk crawling.',
      ],
    },
    isp: {
      label: 'ISP proxy fit',
      summary:
        'ISP proxies work well when you need stable IPs with better reputation than ordinary datacenter ranges.',
      checklist: [
        'Use ISP proxies for logins, accounts, carts, and longer sessions.',
        'Check replacement rules and ASN quality before committing.',
        'Pair with residential fallback for the highest-risk pages.',
      ],
    },
    scraping: {
      label: 'Scraping API fit',
      summary:
        'Scraping APIs, browser APIs, and actor platforms are better when maintaining access, rendering, and retries is more costly than buying raw proxies.',
      checklist: [
        'Decide whether you need raw HTML, parsed records, screenshots, or ready datasets.',
        'Compare per-request, per-page-load, per-record, and compute-unit pricing separately.',
        'Keep Bright Data access/data products distinct from Apify actor workflows.',
      ],
    },
    general: {
      label: 'General proxy fit',
      summary:
        'For broad comparisons, shortlist providers by the actual job: network access, unblocker, scraper API, actor workflow, or ready data.',
      checklist: [
        'Do not use one universal ranking for every proxy type.',
        'Check product coverage and dated pricing before recommending a provider.',
        'Disclose affiliate links before the first CTA and near provider cards.',
      ],
    },
  };

  return map[type];
}

export function getUseCaseInsight(page: ProxyClusterPage, proxyType: ProviderType): UseCaseInsight {
  const keyword = page.keyword;
  const text = `${page.keyword} ${page.pageTitle} ${page.topic} ${page.tags.join(' ')}`.toLowerCase();
  const typeInsight = getProviderTypeInsight(proxyType);

  const checklist = [
    ...typeInsight.checklist,
    'Log success rate, response time, block reason, and cost per usable record during the first pilot.',
  ];

  const insight: UseCaseInsight = {
    title: typeInsight.label,
    summary: `${typeInsight.summary} For ${keyword}, start with a small controlled test and only scale the provider once the block pattern is understood.`,
    checklist,
    recommendedProviderType: proxyType,
    providerRationale:
      proxyType === 'scraping'
        ? 'This keyword looks closer to a scraping-workflow decision than a raw proxy-network decision.'
        : `This page maps to ${proxyType} because the keyword and tags imply that reputation, cost, session stability, or target type matters more than a generic proxy pool.`,
  };

  if (
    proxyType === 'scraping' ||
    text.includes('scraper') ||
    text.includes('scraping') ||
    text.includes('api') ||
    text.includes('crawl') ||
    text.includes('data extraction')
  ) {
    insight.scraperAlternative = {
      title: 'Proxy vs scraper platform decision',
      summary:
        'If the hard part is keeping access, rendering, parsing, and retries alive, compare proxy networks against scraper APIs or actor platforms before buying raw IPs.',
      bullets: [
        'Bright Data is the better fit when you want managed access, scraper APIs, datasets, SERP data, or compliance-reviewed data infrastructure.',
        'Apify is the better fit when you want to run a prebuilt actor, prototype a specific source quickly, or hand the workflow to a developer/no-code team.',
        'Use raw proxies when you already own the scraper and mainly need IP reputation, rotation, and geo coverage.',
      ],
      ctaHref: '/guides/bright-data-vs-apify-for-scraping',
      ctaLabel: 'Compare Bright Data vs Apify',
    };
  }

  return insight;
}

export function getUseCaseSignals(page: ProxyClusterPage) {
  const signals: string[] = [];

  if (page.intent) {
    signals.push(`Search intent suggests a ${page.intent.toLowerCase()} workflow, so buyers are comparing execution paths instead of definitions alone.`);
  }

  if (page.serpFeatures.length > 0) {
    signals.push(`SERP features include ${page.serpFeatures.slice(0, 3).join(', ')}, which usually means searchers want practical steps, quick answers, or comparisons fast.`);
  }

  if (page.tags.length > 0) {
    signals.push(`Tags such as ${page.tags.slice(0, 3).join(', ')} hint at the specific anti-bot, geo, or session constraints behind the keyword.`);
  }

  if (page.volume && page.volume >= 1000) {
    signals.push('The search volume is high enough that a generic answer will blend into the SERP; the page needs target-specific setup guidance.');
  }

  if (signals.length === 0) {
    signals.push('Use this page as a practical decision aid: pick the proxy type, validate the target behavior, then scale based on observed success rate and cost.');
  }

  return signals;
}

export function getUseCasePitfalls(page: ProxyClusterPage, proxyType: ProviderType) {
  const text = `${page.keyword} ${page.topic} ${page.tags.join(' ')}`.toLowerCase();
  const pitfalls = [
    'Scaling traffic before you have classified block reasons, retries, and parser failures.',
    'Measuring request volume instead of successful records, screenshots, or completed workflow steps.',
  ];

  if (proxyType === 'mobile' || text.includes('social') || text.includes('instagram') || text.includes('tiktok')) {
    pitfalls.push('Rotating sessions too aggressively during account or device-style workflows.');
  }

  if (proxyType === 'datacenter') {
    pitfalls.push('Using cheap datacenter IPs on login-sensitive targets without a residential or ISP fallback path.');
  }

  if (proxyType === 'scraping') {
    pitfalls.push('Buying raw proxies first when the real pain is rendering, parsing, or workflow maintenance.');
  }

  if (text.includes('price') || text.includes('travel') || text.includes('geo')) {
    pitfalls.push('Ignoring geo consistency and then comparing results across mismatched countries or regions.');
  }

  return pitfalls.slice(0, 4);
}

export function getContentReferenceLinks(page: ProxyClusterPage, limit = 5) {
  return page.contentReferences
    .filter(Boolean)
    .slice(0, limit)
    .map((label) => ({
      label,
      href: `/q/${slugify(label)}`,
    }));
}

export function getCompetitorLinks(page: ProxyClusterPage, limit = 4) {
  return page.competitors
    .filter(Boolean)
    .slice(0, limit)
    .map((label) => ({
      label,
      href: `/providers/${slugify(label)}`,
    }));
}
