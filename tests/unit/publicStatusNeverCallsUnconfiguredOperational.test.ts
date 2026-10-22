/**
 * GET /api/status is PUBLIC. It used to map a health status of "unconfigured"
 * to "operational", so a service with no credentials (no Stripe key, no SES,
 * no Redis) read as working to every visitor of /status. "Never set up" is not
 * "up".
 *
 * Driven against the projection, then pinned to real adoption: the route must
 * consume projectPublicStatus rather than re-implement the mapping inline
 * (a canonical function with zero production callers is not canonical).
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { projectPublicStatus, publicServiceStatus } from "../../server/services/publicStatus";

describe("projectPublicStatus (driven)", () => {
  it("an unconfigured service is not_configured, never operational", () => {
    expect(publicServiceStatus("unconfigured")).toBe("not_configured");
    const r = projectPublicStatus([
      { name: "database", status: "healthy" },
      { name: "stripe", status: "unconfigured" },
    ]);
    expect(r.services.find((s) => s.name === "stripe")!.status).toBe("not_configured");
    // Excluded from the overall: the configured service is healthy.
    expect(r.status).toBe("operational");
  });

  it("all-unconfigured or empty has nothing to vouch for — unknown, not operational", () => {
    expect(projectPublicStatus([]).status).toBe("unknown");
    expect(
      projectPublicStatus([
        { name: "stripe", status: "unconfigured" },
        { name: "email", status: "unconfigured" },
      ]).status,
    ).toBe("unknown");
  });

  it("outage and degraded still propagate (negative controls)", () => {
    expect(projectPublicStatus([{ name: "db", status: "unavailable" }, { name: "x", status: "unconfigured" }]).status).toBe("outage");
    expect(projectPublicStatus([{ name: "db", status: "healthy" }, { name: "r", status: "degraded" }]).status).toBe("degraded");
    expect(publicServiceStatus("something-new")).toBe("outage");
  });
});

describe("the public route adopts the projection", () => {
  const src = stripComments(fs.readFileSync(path.resolve(__dirname, "../../server/routes.ts"), "utf8"));
  const at = src.indexOf('app.get("/api/status"');
  const end = src.indexOf("app.get(", at + 10);

  it("the handler is found (vacuity)", () => {
    expect(at, "GET /api/status moved — re-anchor this").toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(at);
  });

  it("calls projectPublicStatus and does not re-map statuses inline", () => {
    const body = src.slice(at, end);
    expect(body).toMatch(/projectPublicStatus\(/);
    expect(body, "the route maps health statuses inline again").not.toMatch(/"unconfigured"|"healthy"|"operational"/);
  });

  it("the status page has a not_configured label that is not 'Operational'", () => {
    const page = stripComments(fs.readFileSync(path.resolve(__dirname, "../../client/src/pages/status.tsx"), "utf8"));
    const m = /not_configured:\s*\{[^}]*label:\s*"([^"]+)"/.exec(page);
    expect(m, "status.tsx has no not_configured entry — it would render as Unknown/red").not.toBeNull();
    expect(m![1]).not.toMatch(/operational/i);
  });
});
