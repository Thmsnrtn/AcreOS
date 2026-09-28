/**
 * DEFECT-0055 (slice) — the HTTP metrics route label cannot be minted by a client.
 *
 * When no route layer matched (a 404, or a 401/403/429 sent by global
 * middleware), `routeKey` fell back to `baseUrl + req.path` with only numeric
 * ids and UUIDs normalised. `req.path` is raw client input, so a scanner
 * requesting random paths created one prom-client series per URL — unbounded
 * memory in every web process. The fallback is now the mount prefix, hard-
 * capped, else "unmatched".
 */
import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { metricsMiddleware, httpRequestsTotal, __resetMetricsForTesting } from "../../server/metrics";

async function routeLabels(): Promise<Set<string>> {
  const metric = await httpRequestsTotal.get();
  return new Set(metric.values.map((v) => String(v.labels.route)));
}

function app() {
  const a = express();
  a.use(metricsMiddleware);
  // A global middleware that answers before any route (like a limiter or auth).
  a.use("/api", (req, res, next) => (req.headers["x-block"] ? res.status(429).end() : next()));
  a.get("/api/leads/:id", (_req, res) => res.json({ ok: true }));
  // A parameterised mount, the case where baseUrl carries the client's value.
  a.use("/api/export/:entityType", (_req, res) => res.status(404).end());
  return a;
}

describe("DEFECT-0055 — metrics route labels are bounded", () => {
  beforeEach(() => __resetMetricsForTesting());

  it("random unmatched paths do not mint a label each", async () => {
    const a = app();
    for (let i = 0; i < 40; i++) await request(a).get(`/api/scan-${i}-x${i}/probe-${i}`);
    for (let i = 0; i < 40; i++) await request(a).get(`/api/whatever/${i}abc`).set("x-block", "1");
    const labels = await routeLabels();
    expect(labels.size).toBeLessThanOrEqual(3);
  });

  it("a matched route keeps its template label", async () => {
    await request(app()).get("/api/leads/123");
    expect(await routeLabels()).toEqual(new Set(["/api/leads/:id"]));
  });

  it("a parameterised mount cannot grow the label set past the cap", async () => {
    const a = app();
    for (let i = 0; i < 260; i++) await request(a).get(`/api/export/type${i}`);
    const labels = await routeLabels();
    expect(labels.size).toBeLessThanOrEqual(201);
    expect(labels.has("unmatched")).toBe(true);
  });
});
