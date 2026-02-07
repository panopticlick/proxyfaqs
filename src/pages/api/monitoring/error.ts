/**
 * Error Monitoring Endpoint
 *
 * Receives client-side error reports for tracking and alerting.
 */

import type { APIRoute } from 'astro';
import { getCorsHeaders, addSecurityHeaders } from '../../../lib/security';
import { captureError, logger, incrementCounter, Metrics } from '../../../lib/telemetry';

interface ClientErrorReport {
  name: string;
  message: string;
  stack?: string;
  context?: {
    userAgent?: string;
    url?: string;
    timestamp?: string;
    [key: string]: unknown;
  };
}

export const POST: APIRoute = async ({ request }) => {
  const origin = request.headers.get('origin');

  try {
    const data = (await request.json()) as ClientErrorReport;

    // Create error from client report
    const error = new Error(data.message);
    error.name = data.name;
    if (data.stack) {
      error.stack = data.stack;
    }

    // Capture the error with context
    captureError(error, {
      source: 'client',
      userAgent: data.context?.userAgent,
      url: data.context?.url,
      ...data.context,
    });

    // Increment error counter
    incrementCounter(Metrics.API_ERROR_COUNT, 1, {
      source: 'client',
      errorName: data.name,
    });

    logger.info('Client error reported', {
      name: data.name,
      message: data.message,
      url: data.context?.url,
    });

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
    logger.error('Error monitoring endpoint failed', error);

    const headers = new Headers({
      'Content-Type': 'application/json',
      ...getCorsHeaders(origin),
    });
    addSecurityHeaders(headers);

    return new Response(JSON.stringify({ error: 'Failed to process error report' }), {
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
