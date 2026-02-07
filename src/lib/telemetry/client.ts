/**
 * Client-side Telemetry
 *
 * Browser-based tracking for page views, performance, and user behavior.
 * Designed to work with Cloudflare Pages.
 */

export interface PageViewEvent {
  type: 'pageview';
  timestamp: string;
  url: string;
  referrer: string;
  title: string;
  path: string;
  search: string;
  userAgent: string;
  screen: {
    width: number;
    height: number;
  };
  viewport: {
    width: number;
    height: number;
  };
  performance?: {
    domContentLoaded: number;
    load: number;
    firstPaint?: number;
    firstContentfulPaint?: number;
  };
  traceId?: string;
}

export interface UserBehaviorEvent {
  type: 'search' | 'chat' | 'click' | 'scroll' | 'form_submit';
  timestamp: string;
  path: string;
  action: string;
  metadata?: Record<string, unknown>;
}

/**
 * Get trace ID from headers if available
 */
function getTraceId(): string | undefined {
  const metaTag = document.querySelector('meta[name="x-trace-id"]');
  return metaTag?.getAttribute('content') || undefined;
}

/**
 * Collect performance metrics
 */
function getPerformanceMetrics(): PageViewEvent['performance'] {
  if (!window.performance || !window.performance.timing) {
    return undefined;
  }

  const timing = window.performance.timing;
  const navigation = timing.navigationStart;

  const metrics: PageViewEvent['performance'] = {
    domContentLoaded: timing.domContentLoadedEventEnd - navigation,
    load: timing.loadEventEnd - navigation,
  };

  // Try to get paint metrics
  const paintEntries = window.performance.getEntriesByType('paint');
  for (const entry of paintEntries) {
    if (entry.name === 'first-paint') {
      metrics.firstPaint = entry.startTime;
    }
    if (entry.name === 'first-contentful-paint') {
      metrics.firstContentfulPaint = entry.startTime;
    }
  }

  return metrics;
}

/**
 * Send telemetry to server
 */
function sendTelemetry(data: PageViewEvent | UserBehaviorEvent): void {
  // In development, just log
  if (import.meta.env.DEV) {
    console.log('[Telemetry]', data);
    return;
  }

  // Use sendBeacon for reliable delivery
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });

  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/monitoring/event', blob);
  } else {
    // Fallback to fetch
    fetch('/api/monitoring/event', {
      method: 'POST',
      body: blob,
      keepalive: true,
    }).catch(() => {
      // Silently fail
    });
  }
}

/**
 * Track page view
 */
export function trackPageView(): void {
  // Wait for page to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageView);
    return;
  }

  const event: PageViewEvent = {
    type: 'pageview',
    timestamp: new Date().toISOString(),
    url: window.location.href,
    referrer: document.referrer,
    title: document.title,
    path: window.location.pathname,
    search: window.location.search,
    userAgent: navigator.userAgent,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    performance: getPerformanceMetrics(),
    traceId: getTraceId(),
  };

  sendTelemetry(event);
}

/**
 * Track user behavior event
 */
export function trackEvent(
  action: UserBehaviorEvent['action'],
  metadata?: Record<string, unknown>
): void {
  const event: UserBehaviorEvent = {
    type: 'click',
    timestamp: new Date().toISOString(),
    path: window.location.pathname,
    action,
    metadata,
  };

  sendTelemetry(event);
}

/**
 * Track search query
 */
export function trackSearch(query: string, resultCount: number): void {
  const event: UserBehaviorEvent = {
    type: 'search',
    timestamp: new Date().toISOString(),
    path: window.location.pathname,
    action: 'search',
    metadata: {
      query: query.slice(0, 100), // Limit length
      resultCount,
    },
  };

  sendTelemetry(event);
}

/**
 * Track chat interaction
 */
export function trackChat(messageLength: number, responseLength: number): void {
  const event: UserBehaviorEvent = {
    type: 'chat',
    timestamp: new Date().toISOString(),
    path: window.location.pathname,
    action: 'chat_message',
    metadata: {
      messageLength,
      responseLength,
    },
  };

  sendTelemetry(event);
}

/**
 * Initialize telemetry
 */
export function initTelemetry(): void {
  // Track initial page view
  trackPageView();

  // Track visibility changes (user returns to tab)
  let lastHiddenTime = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      lastHiddenTime = Date.now();
    } else if (lastHiddenTime && Date.now() - lastHiddenTime > 30000) {
      // User was away for more than 30 seconds, track as new page view
      trackPageView();
    }
  });

  // Track scroll depth
  let maxScrollDepth = 0;
  const scrollDepths = [25, 50, 75, 90, 100];

  const checkScrollDepth = () => {
    const scrollPercent = Math.round(
      (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
    );

    for (const depth of scrollDepths) {
      if (scrollPercent >= depth && maxScrollDepth < depth) {
        maxScrollDepth = depth;
        trackEvent('scroll_depth_reached', { depth });
      }
    }
  };

  window.addEventListener('scroll', () => {
    requestAnimationFrame(checkScrollDepth);
  });
}

// Auto-initialize when imported
if (typeof window !== 'undefined') {
  // Defer initialization to not block page load
  if (document.readyState === 'complete') {
    setTimeout(initTelemetry, 0);
  } else {
    window.addEventListener('load', () => setTimeout(initTelemetry, 0));
  }
}
