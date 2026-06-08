/**
 * Unit tests: customer-critical integration readiness summary.
 *
 * Verifies the summary reports LIVE vs DARK by NAME only and never reads or
 * leaks a secret VALUE ([[feedback-credential-value-handling]]).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeIntegrationReadiness,
  logIntegrationReadiness,
} from "../../server/services/integrationReadiness";

const SECRET_VARS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SES_FROM_EMAIL",
  "STRIPE_SECRET_KEY",
  "VITE_MAPBOX_ACCESS_TOKEN",
  "VITE_MAPBOX_TOKEN",
  "MAPBOX_TOKEN",
];

function clearAll() {
  for (const v of SECRET_VARS) delete process.env[v];
}

describe("integrationReadiness", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of SECRET_VARS) original[v] = process.env[v];
    clearAll();
  });

  afterEach(() => {
    for (const v of SECRET_VARS) {
      if (original[v] === undefined) delete process.env[v];
      else process.env[v] = original[v];
    }
    vi.restoreAllMocks();
  });

  it("reports all three integrations DARK when no secrets are set", () => {
    const r = computeIntegrationReadiness();
    const byKey = Object.fromEntries(r.map((x) => [x.key, x]));
    expect(byKey.aws_ses.live).toBe(false);
    expect(byKey.stripe.live).toBe(false);
    expect(byKey.mapbox.live).toBe(false);
    // Missing vars are reported by NAME.
    expect(byKey.aws_ses.missingVars).toContain("AWS_SES_FROM_EMAIL");
    expect(byKey.mapbox.missingVars).toContain("VITE_MAPBOX_ACCESS_TOKEN");
  });

  it("marks AWS SES LIVE only when all three required vars are present", () => {
    process.env.AWS_ACCESS_KEY_ID = "x";
    process.env.AWS_SECRET_ACCESS_KEY = "x";
    expect(computeIntegrationReadiness().find((r) => r.key === "aws_ses")!.live).toBe(false);
    process.env.AWS_SES_FROM_EMAIL = "no-reply@acreos.io";
    expect(computeIntegrationReadiness().find((r) => r.key === "aws_ses")!.live).toBe(true);
  });

  it("accepts any of the three Mapbox token names", () => {
    process.env.VITE_MAPBOX_TOKEN = "pk.test";
    const mapbox = computeIntegrationReadiness().find((r) => r.key === "mapbox")!;
    expect(mapbox.live).toBe(true);
    expect(mapbox.satisfiedBy).toBe("VITE_MAPBOX_TOKEN");
    expect(mapbox.missingVars).toEqual([]);
  });

  it("detects presence only — never reads the secret value", () => {
    // Set a recognizable sentinel value and assert it never appears in output.
    const SENTINEL = "sk_live_THIS_MUST_NEVER_BE_LOGGED_123456";
    process.env.STRIPE_SECRET_KEY = SENTINEL;
    const r = computeIntegrationReadiness();
    const serialized = JSON.stringify(r);
    expect(serialized).not.toContain(SENTINEL);
    expect(r.find((x) => x.key === "stripe")!.live).toBe(true);
  });

  it("logs a structured summary that contains NAMES but no secret VALUES", () => {
    const SENTINEL = "pk.eyJ_SECRET_TOKEN_VALUE_DO_NOT_LEAK";
    process.env.VITE_MAPBOX_ACCESS_TOKEN = SENTINEL;
    process.env.STRIPE_SECRET_KEY = "sk_live_SECRET_DO_NOT_LEAK";

    const lines: string[] = [];
    const infoSpy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });

    logIntegrationReadiness();

    const all = lines.join("\n");
    // Names of the missing AWS vars must appear (it's DARK here).
    expect(all).toContain("AWS_SES_FROM_EMAIL");
    // No secret values may appear anywhere in the log output.
    expect(all).not.toContain(SENTINEL);
    expect(all).not.toContain("sk_live_SECRET_DO_NOT_LEAK");

    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
