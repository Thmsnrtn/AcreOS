/**
 * metricsSingleOwner — the /metrics consolidation ratchet (2026-08-16).
 *
 * Three verified production defects motivated this (all confirmed by
 * execution in an audit before the fix):
 *
 *   1. The live GET /metrics handler (then in server/middleware/metrics.ts)
 *      read METRICS_BEARER_TOKEN, while every operator doc (.env.example,
 *      docs/deployment-checklist.md, CHANGELOG, docs/security-audit.md) says
 *      METRICS_TOKEN. A documented production deploy therefore 404'd the
 *      scrape — the endpoint was dark exactly when configured as told.
 *   2. Its exposition was malformed Prometheus text: the hand-rolled
 *      collector emitted `name{labels}_count` / `_sum` / `_p50` — suffixes
 *      AFTER the label braces — which aborts the ENTIRE scrape on parse. No
 *      # HELP / # TYPE lines, and durations in ms where the canonical
 *      histogram is seconds.
 *   3. server/metrics.ts's prom-client handler was correct and DEAD (zero
 *      importers), while its registry held counters genuinely incremented in
 *      production (acreos_stripe_webhook_failed_total,
 *      acreos_public_parcel_report_events_total) that nobody rendered — the
 *      StripeWebhookFailing alert in docs/slo-monitoring.md could never fire.
 *
 * This file pins the consolidated state: server/metrics.ts is the single
 * owner; index.ts mounts ITS handler; the documented env var name is the one
 * the live code reads; the exposition is valid and contains the business
 * counters the alerts depend on.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import {
  metricsMiddleware,
  registry,
  recordStripeWebhookFailure,
  __resetMetricsForTesting,
} from "../../server/metrics";
// This gate walks the source tree; its cost scales with the repo, and under the
// coverage run it does not fit the suite’s 30s default. A killed gate reports
// nothing about what it guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });


const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** Every .ts source file under a directory (recursive, no node_modules under server/). */
function tsFilesUnder(rel: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(ROOT, rel));
  return out;
}

/** Drive one fake request through the real middleware so the registry has a series. */
class FakeResponse extends EventEmitter {
  statusCode = 200;
}

function simulateRequest(routePath: string, rawPath: string, statusCode: number): void {
  const req = {
    method: "GET",
    route: { path: routePath },
    baseUrl: "",
    path: rawPath,
  } as unknown as Request;
  const res = new FakeResponse();
  res.statusCode = statusCode;
  metricsMiddleware(req, res as unknown as Response, () => {});
  res.emit("finish");
}

describe("GET /metrics handler identity", () => {
  const indexSrc = read("server/index.ts");

  it("index.ts mounts the prom-client handler from server/metrics.ts", () => {
    // The handler must be imported from ./metrics (the prom-client owner)...
    expect(indexSrc).toMatch(/import\s*\{[^}]*\bmetricsHandler\b[^}]*\}\s*from\s*["']\.\/metrics["']/);
    // ...and mounted at the app level.
    expect(indexSrc).toMatch(/app\.get\(\s*["']\/metrics["']\s*,\s*metricsHandler\s*\)/);
  });

  it("index.ts no longer takes a handler from the middleware file", () => {
    const middlewareImports = indexSrc.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\/middleware\/metrics["']/);
    expect(middlewareImports).not.toBeNull();
    expect(middlewareImports![1]).not.toContain("metricsHandler");
  });

  it("the middleware file keeps only the middleware — no collector, no handler", () => {
    const middlewareSrc = read("server/middleware/metrics.ts");
    expect(middlewareSrc).not.toContain("MetricsCollector");
    expect(middlewareSrc).not.toContain("toPrometheus");
    expect(middlewareSrc).not.toMatch(/function metricsHandler/);
    expect(middlewareSrc).toMatch(/export\s*\{\s*metricsMiddleware\s*\}\s*from\s*["']\.\.\/metrics["']/);
  });
});

describe("bearer token env var name", () => {
  it("the live handler reads the documented METRICS_TOKEN", () => {
    const src = read("server/metrics.ts");
    expect(src).toContain("process.env.METRICS_TOKEN");
  });

  it("METRICS_BEARER_TOKEN appears nowhere under server/", () => {
    const offenders = tsFilesUnder("server").filter((f) =>
      fs.readFileSync(f, "utf8").includes("METRICS_BEARER_TOKEN"),
    );
    expect(offenders).toEqual([]);
  });

  it("the ms-unit histogram name is gone from server/", () => {
    const offenders = tsFilesUnder("server").filter((f) =>
      fs.readFileSync(f, "utf8").includes("acreos_http_request_duration_ms"),
    );
    expect(offenders).toEqual([]);
  });
});

describe("exposition validity", () => {
  let body: string;

  beforeAll(async () => {
    __resetMetricsForTesting();
    simulateRequest("/api/leads/:id", "/api/leads/123", 200);
    recordStripeWebhookFailure();
    body = await registry.metrics();
  });

  it("carries # HELP and # TYPE for the HTTP families", () => {
    expect(body).toContain("# HELP acreos_http_requests_total");
    expect(body).toContain("# TYPE acreos_http_requests_total counter");
    expect(body).toContain("# TYPE acreos_http_request_duration_seconds histogram");
  });

  it("records the simulated request under the route template, in seconds", () => {
    expect(body).toMatch(
      /acreos_http_requests_total\{method="GET",route="\/api\/leads\/:id",status="2xx"\} 1/,
    );
    // Histogram suffixes sit BEFORE the label braces, as the format requires.
    expect(body).toMatch(/acreos_http_request_duration_seconds_bucket\{le="/);
    expect(body).toMatch(/acreos_http_request_duration_seconds_count\{/);
    expect(body).toMatch(/acreos_http_request_duration_seconds_sum\{/);
  });

  it("never emits the malformed `}_count` / `}_sum` / `}_p50` shape", () => {
    expect(body).not.toMatch(/\}_(count|sum|p\d+)\b/);
  });

  it("renders the production business counters the alerts scrape", () => {
    // Incremented at server/index.ts's stripe webhook catch block — drives
    // the StripeWebhookFailing alert in docs/slo-monitoring.md.
    expect(body).toContain("# TYPE acreos_stripe_webhook_failed_total counter");
    expect(body).toMatch(/^acreos_stripe_webhook_failed_total 1$/m);
    // Incremented from routes-public-parcel-report.ts / publicParcelReport.ts.
    expect(body).toContain("# TYPE acreos_public_parcel_report_events_total counter");
  });
});

describe("no second exposition owner", () => {
  it("routes-metrics.ts delegates to the prom-client handler instead of hand-rolling text", () => {
    const src = read("server/routes-metrics.ts");
    expect(src).toMatch(/import\s*\{[^}]*\bmetricsHandler\b[^}]*\}\s*from\s*["']\.\/metrics["']/);
    expect(src).toMatch(/router\.get\(\s*["']\/["']\s*,\s*metricsHandler\s*\)/);
    expect(src).not.toContain("buildPrometheusOutput");
    expect(src).not.toContain("# HELP");
    // The false "mounted at the app level so Prometheus can reach it" claim
    // must stay dead — this router is session-gated under /api/metrics.
    expect(src).not.toMatch(/so Prometheus can reach it/i);
  });
});
