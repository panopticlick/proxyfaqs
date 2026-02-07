/**
 * API Endpoint Tests
 *
 * Unit tests for health, search, and chat API endpoints.
 * Run with: bun test
 */

import { describe, it, expect } from 'bun:test';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

describe('Health API', () => {
  it('should return 200 OK with status', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('status');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('uptime');
    expect(['ok', 'degraded', 'error']).toContain(data.status);
  });

  it('should return verbose info when requested', async () => {
    const response = await fetch(`${BASE_URL}/api/health?verbose=true`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('meta');
    expect(data.meta).toHaveProperty('nodeVersion');
  });

  it('should include proper cache headers', async () => {
    const response = await fetch(`${BASE_URL}/api/health`);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
});

describe('Search API', () => {
  it('should return empty results for short queries', async () => {
    const response = await fetch(`${BASE_URL}/api/search?q=a`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results).toEqual([]);
  });

  it('should return results for valid queries', async () => {
    const response = await fetch(`${BASE_URL}/api/search?q=proxy`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data).toHaveProperty('results');
    expect(data).toHaveProperty('query');
    expect(data.query).toBe('proxy');
  });

  it('should respect limit parameter', async () => {
    const response = await fetch(`${BASE_URL}/api/search?q=proxy&limit=5`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.results.length).toBeLessThanOrEqual(5);
  });

  it('should include rate limit headers', async () => {
    const response = await fetch(`${BASE_URL}/api/search?q=test`);
    expect(response.headers.get('X-RateLimit-Limit')).toBeTruthy();
    expect(response.headers.get('X-RateLimit-Remaining')).toBeTruthy();
  });

  it('should sanitize query input', async () => {
    const response = await fetch(`${BASE_URL}/api/search?q=<script>alert(1)</script>`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.query).not.toContain('<script>');
  });
});

describe('Chat API', () => {
  it('should reject empty messages', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toHaveProperty('error');
  });

  it('should reject messages that are too long', async () => {
    const longMessage = 'a'.repeat(1001);
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: longMessage }),
    });

    expect(response.status).toBe(400);
  });

  it('should accept valid messages', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is a residential proxy?',
        sessionId: 'test_session_123',
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty('response');
  });

  it('should include rate limit headers', async () => {
    const response = await fetch(`${BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'test' }),
    });

    expect(response.headers.get('X-RateLimit-Limit')).toBeTruthy();
  });
});

describe('Rate Limiting', () => {
  it('should track requests per IP', async () => {
    // Make multiple requests and check remaining count decreases
    const response1 = await fetch(`${BASE_URL}/api/search?q=test1`);
    const remaining1 = parseInt(response1.headers.get('X-RateLimit-Remaining') || '0');

    const response2 = await fetch(`${BASE_URL}/api/search?q=test2`);
    const remaining2 = parseInt(response2.headers.get('X-RateLimit-Remaining') || '0');

    expect(remaining2).toBeLessThan(remaining1);
  });
});
