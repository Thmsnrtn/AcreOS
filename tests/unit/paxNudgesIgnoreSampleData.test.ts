/**
 * DEFECT-0147 — Pax's nudges are about the customer's own book.
 *
 * generateNudgesForOrg (a live scheduled job) counted the seeded sample book:
 * "N new leads added this month", stale-lead and stuck-deal nudges fired on
 * fixtures. The stale count was also a LIMIT-10 page filtered afterwards, and
 * the stuck-deal nudge asserted "Deals typically close in 21 days" — a
 * benchmark nothing measured. Population: every query in the function that
 * reads leads or deals, each required to carry the sample exclusion.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const src = stripComments(readFileSync(resolve(__dirname, "../../server/services/paxNudges.ts"), "utf8"));
const body = src.slice(src.indexOf("async function generateNudgesForOrg"), src.indexOf("export async function handleDomainEvent"));
const queries = body.split("await db.select").slice(1).map((q) => q.slice(0, q.indexOf(";")));

describe("DEFECT-0147 — nudges exclude the sample book", () => {
  it("reads the function (vacuity)", () => {
    expect(queries.length).toBeGreaterThanOrEqual(4);
  });

  it("every leads/deals query carries the sample exclusion", () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const q of queries) {
      if (/\.from\(leads\)/.test(q)) { checked++; if (!/realLead\(\)/.test(q)) offenders.push(q.slice(0, 80)); }
      if (/\.from\(deals\)/.test(q)) { checked++; if (!/realDeal\(\)/.test(q)) offenders.push(q.slice(0, 80)); }
    }
    expect(checked).toBeGreaterThanOrEqual(4);
    expect(offenders).toEqual([]);
  });

  it("states no unmeasured benchmark", () => {
    expect(body).not.toMatch(/typically close/i);
  });
});
