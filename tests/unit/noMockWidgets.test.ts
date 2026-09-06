/**
 * No-mock-widgets ratchet (wave V2, founder ruling #11).
 *
 * type-specific-widgets.tsx shipped for months with five hardcoded
 * *_MOCK constants ("to be wired to API later"). Two were still reachable
 * in render paths — the land-category fall-through (LAND_MOCK) and the
 * commercial category (COMMERCIAL_MOCK) — fabricated numbers in a
 * confident UI, violating the constitution's fabrication hard-stop.
 * The server-side lint (scripts/check-no-fabrication.mjs) never saw them:
 * it scans only server/ paths and only for Math.random, so client-side
 * static mock literals were a blind spot. This suite is the client-side
 * counterpart ratchet:
 *
 *   1. No *_MOCK identifier may exist in ANY non-test client source file
 *      (comments stripped, so prose history may still mention the names).
 *   2. The land category renders the real sourcing widgets.
 *   3. The commercial category renders the real rent/lease widgets.
 *   4. Every businessType category resolves to a widget set that reads a
 *      real org-scoped endpoint.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "../helpers/stripComments";

const CLIENT_SRC = path.resolve(__dirname, "../../client/src");
const WIDGETS_PATH = path.join(
  CLIENT_SRC,
  "components/dashboard/type-specific-widgets.tsx",
);
const widgetsSrc = fs.readFileSync(WIDGETS_PATH, "utf-8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (
      /\.(ts|tsx)$/.test(entry) &&
      !/\.(test|spec)\.(ts|tsx)$/.test(entry)
    ) {
      out.push(full);
    }
  }
  return out;
}

describe("*_MOCK ratchet — no mock-data identifier in any client render path", () => {
  const MOCK_TOKEN = /\b\w*_MOCK\b/;

  it("type-specific-widgets.tsx contains no *_MOCK identifier in code", () => {
    const code = stripComments(widgetsSrc);
    const hit = code.match(MOCK_TOKEN);
    expect(
      hit,
      hit ? `found mock identifier "${hit[0]}" — wire real data or render an honest empty state` : undefined,
    ).toBeNull();
  });

  it("no non-test file under client/src contains a *_MOCK identifier in code", () => {
    const offenders: string[] = [];
    for (const file of walk(CLIENT_SRC)) {
      const code = stripComments(fs.readFileSync(file, "utf-8"));
      const hit = code.match(MOCK_TOKEN);
      if (hit) offenders.push(`${path.relative(CLIENT_SRC, file)} ("${hit[0]}")`);
    }
    expect(
      offenders,
      `mock-data identifiers found — the constitution's fabrication hard-stop bans them from render paths:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

describe("land category — real sourcing data, not the deleted LandWidgets mock", () => {
  it("routes the land category to LandSourcingWidgets", () => {
    expect(widgetsSrc).toContain('{category === "land" && <LandSourcingWidgets />}');
  });

  it("the mock LandWidgets component no longer exists", () => {
    expect(widgetsSrc).not.toContain("function LandWidgets");
  });

  it("LandSourcingWidgets reads the real properties + leads endpoints and has an honest EmptyState", () => {
    const fn = widgetsSrc.match(/function LandSourcingWidgets\(\)[\s\S]*?\n\/\*\*/);
    expect(fn, "LandSourcingWidgets must exist").toBeTruthy();
    const body = fn![0];
    expect(body).toContain("/api/properties");
    expect(body).toContain('"/api/leads"');
    expect(body).toContain("EmptyState");
  });
});

describe("commercial category — real rent/lease data, not the deleted mock NOI tiles", () => {
  it("routes the commercial category to the real BuyAndHoldWidgets", () => {
    expect(widgetsSrc).toContain('{category === "commercial" && <BuyAndHoldWidgets />}');
  });

  it("the mock CommercialWidgets component no longer exists", () => {
    expect(widgetsSrc).not.toContain("function CommercialWidgets");
  });

  it("BuyAndHoldWidgets reads /api/landlord/dashboard and suppresses when the org has no data", () => {
    const fn = widgetsSrc.match(/function BuyAndHoldWidgets\(\)[\s\S]*?\nfunction /);
    expect(fn, "BuyAndHoldWidgets must exist").toBeTruthy();
    const body = fn![0];
    expect(body).toContain('"/api/landlord/dashboard"');
    expect(body).toMatch(/if \(!live\?\.hasData\) return null/);
  });
});

describe("every category resolves to a real org-scoped endpoint", () => {
  it("all widget sets fetch real endpoints", () => {
    for (const endpoint of [
      "/api/wholesaler/dashboard",
      "/api/flipper/dashboard",
      "/api/landlord/dashboard",
      "/api/subdivider/dashboard",
      "/api/tax-certificates/dashboard/summary",
      "/api/properties",
      "/api/notes",
      '"/api/leads"',
    ]) {
      expect(widgetsSrc, `widgets must read ${endpoint}`).toContain(endpoint);
    }
  });
});
