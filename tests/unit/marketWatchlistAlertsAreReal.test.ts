/**
 * P1 false-claims sweep — the market watchlist offers no alert nothing makes.
 *
 * The "Watch county" dialog offered alert triggers ("New tax delinquent
 * parcels", price drop, demand score, "Foreclosure filings") and email / push
 * channels, and the page said alerts "can push to email/SMS". But
 * marketWatchlist.triggerAlert had ZERO production callers — only testAlert
 * ever wrote an alert — and emitAlert only inserts an in-app row.
 *
 * Coupled to the code: while nothing in server/ calls .triggerAlert( (the
 * population is every server .ts file, comments stripped, with a vacuity
 * check that the scan sees the real .testAlert( call), the page may render no
 * trigger or channel toggles.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(name)) out.push(full);
  }
  return out;
}

function callSites(method: string): string[] {
  const hits: string[] = [];
  const re = new RegExp(`\\.${method}\\s*\\(`);
  for (const file of walk(path.join(ROOT, "server"))) {
    const raw = readFileSync(file, "utf8");
    // Cheap prefilter on raw text (a superset); strip comments only for candidates.
    if (!re.test(raw)) continue;
    if (re.test(stripComments(raw))) hits.push(path.relative(ROOT, file));
  }
  return hits;
}

describe("market watchlist alerts", () => {
  let alertsGenerated = true;

  it("finds whether any production code generates alerts", { timeout: 120_000 }, () => {
    // Vacuity: the scanner sees the call that DOES exist.
    expect(callSites("testAlert")).toContain("server/routes-market-watchlist.ts");
    alertsGenerated = callSites("triggerAlert").length > 0;
  });

  it("the service sends no email or push for an alert", () => {
    const svc = stripComments(readFileSync(path.join(ROOT, "server/services/marketWatchlist.ts"), "utf8"));
    expect(svc).toMatch(/private async emitAlert/); // vacuity
    expect(svc).not.toMatch(/emailService|sendEmail|sendPush|pushService|smsService/);
  });

  it("the page offers no alert trigger or channel that nothing produces", () => {
    if (alertsGenerated) return;
    const page = stripComments(readFileSync(path.join(ROOT, "client/src/pages/market-watchlist.tsx"), "utf8"));
    expect(page).toMatch(/Market watchlist/); // vacuity
    for (const claim of [
      /New tax delinquent parcels/i,
      /Foreclosure filings/i,
      /Price drop ≥/,
      /Demand score ≥/,
      /Email alerts/i,
      /Push notifications/i,
      /receive market alerts/i,
      /<Switch\b/,
      /alertOnTaxDelinquent:\s*true/,
    ]) {
      expect(page).not.toMatch(claim);
    }
    expect(page).toMatch(/aren't generated yet/);
  });
});
