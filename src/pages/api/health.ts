/**
 * Health Check API Endpoint
 *
 * Production-grade health check with comprehensive metrics.
 * Used by Docker healthcheck, load balancers, and monitoring systems.
 */

import type { APIRoute } from "astro";
import { env } from "../../lib/env";

export const prerender = false;

const startedAt = Date.now();
const version = "1.0.0";
const buildTime = new Date().toISOString();

interface HealthStatus {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: { status: string; latency?: number };
    memory: { status: string; used: number; total: number; percentage: number };
    api: { status: string };
  };
  meta?: {
    buildTime: string;
    nodeVersion: string;
    environment: string;
  };
}

async function checkDatabase(): Promise<{ status: string; latency?: number }> {
  const start = Date.now();
  try {
    const url = `${env.PUBLIC_SUPABASE_URL}/rest/v1/categories?select=id&limit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      headers: {
        apikey: env.PUBLIC_SUPABASE_ANON_KEY,
        "Accept-Profile": "proxyfaqs",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latency = Date.now() - start;

    if (response.ok) {
      return { status: latency < 1000 ? "ok" : "slow", latency };
    }
    return { status: "error", latency };
  } catch {
    return { status: "unreachable", latency: Date.now() - start };
  }
}

function checkMemory(): { status: string; used: number; total: number; percentage: number } {
  if (typeof process !== "undefined" && process.memoryUsage) {
    const mem = process.memoryUsage();
    const used = Math.round(mem.heapUsed / 1024 / 1024);
    const total = Math.round(mem.heapTotal / 1024 / 1024);
    const percentage = Math.round((mem.heapUsed / mem.heapTotal) * 100);

    return {
      status: percentage < 85 ? "ok" : percentage < 95 ? "warning" : "critical",
      used,
      total,
      percentage,
    };
  }
  return { status: "unknown", used: 0, total: 0, percentage: 0 };
}

export const GET: APIRoute = async ({ url }) => {
  const verbose = url.searchParams.get("verbose") === "true";

  const [dbCheck, memCheck] = await Promise.all([
    checkDatabase(),
    Promise.resolve(checkMemory()),
  ]);

  const overallStatus: "ok" | "degraded" | "error" =
    dbCheck.status === "unreachable" || dbCheck.status === "error"
      ? "error"
      : dbCheck.status === "slow" || memCheck.status === "warning"
        ? "degraded"
        : "ok";

  const health: HealthStatus = {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    version,
    checks: {
      database: dbCheck,
      memory: memCheck,
      api: { status: "ok" },
    },
  };

  if (verbose) {
    health.meta = {
      buildTime,
      nodeVersion: typeof process !== "undefined" ? process.version : "unknown",
      environment: typeof process !== "undefined" ? process.env.NODE_ENV || "production" : "unknown",
    };
  }

  const httpStatus = overallStatus === "error" ? 503 : 200;

  return new Response(JSON.stringify(health), {
    status: httpStatus,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "X-Health-Status": overallStatus,
    },
  });
};

export const OPTIONS: APIRoute = async ({ request }) => {
  return corsOptionsResponse(request.headers.get('origin'));
};
