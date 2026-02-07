/**
 * Event Monitoring Endpoint
 *
 * Receives client-side telemetry events for tracking.
 */

import type { APIRoute } from 'astro';
import { getCorsHeaders, addSecurityHeaders } from '../../../lib/security';
import { logger, incrementCounter, recordHistogram, Metrics } from '../../../lib/telemetry';

interface TelemetryEvent {
  type: 'pageview' | 'search' | 'chat' | 'click' | 'scroll' | 'form_submit';
  timestamp: string;
  path: string;
  action?: string;
  url?: string;
  referrer?: string;
  title?: string;
  metadata?: Record<string, unknown>;
  performance?: {
    domContentLoaded: number;
    load: number;
    firstPaint?: number;
    firstContentfulPaint?: number;
  };
}

export const POST: APIRoute = async ({ request }) => {
  const origin = request.headers.get('origin');

  try {
    const event = (await request.json()) as TelemetryEvent;

    // Process event based on type
    switch (event.type) {
      case 'pageview':
        incrementCounter(Metrics.PAGE_VIEW_COUNT, 1, {
          path: event.path,
        });

        // Track performance metrics
        if (event.performance) {
          recordHistogram(Metrics.PAGE_LOAD_DURATION, event.performance.load, {
            path: event.path,
          });

          logger.debug('Page view tracked', {
            path: event.path,
            loadTime: event.performance.load,
          });
        }
        break;

      case 'search':
        incrementCounter('search.client.count', 1, {
          path: event.path,
        });
        break;

      case 'chat':
        incrementCounter(Metrics.CHAT_REQUEST_COUNT, 1, {
          source: 'client',
        });
        break;

      case 'scroll':
        // Track scroll depth
        incrementCounter('page.scroll_depth', 1, {
          depth: String(event.metadata?.depth || 0),
        });
        break;

      default:
        incrementCounter('telemetry.event', 1, {
          type: event.type,
        });
    }

    const headers = new Headers({
      'Content-Type': 'application/json',
      ...getCorsHeaders(origin),
    });
    addSecurityHeaders(headers);

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers,
    });
  } catch (error) {
    logger.error('Event monitoring endpoint failed', error);

    const headers = new Headers({
      'Content-Type': 'application/json',
      ...getCorsHeaders(origin),
    });
    addSecurityHeaders(headers);

    return new Response(JSON.stringify({ error: 'Failed to process event' }), {
      status: 500,
      headers,
    });
  }
};

export const OPTIONS: APIRoute = async ({ request }) => {
  const origin = request.headers.get('origin');

  const headers = new Headers({
    ...getCorsHeaders(origin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  addSecurityHeaders(headers);

  return new Response(null, { status: 204, headers });
};
