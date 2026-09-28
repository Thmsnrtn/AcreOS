/**
 * DEFECT-0149 — subscription_events readers and writers speak one vocabulary.
 *
 * The writers emit cancel / trial_end / change / pause / resume. About ten
 * founder readers filtered on subscription_cancelled / _upgraded / _created /
 * _downgraded, and storage.getSubscriptionStats on upgrade / downgrade /
 * signup / reactivate — values nothing ever wrote — so founder churn, weekly
 * cancellations, Atlas's cancellation counts and upgrade counts all read 0.
 *
 * Population: every server file. Every string literal compared with
 * `subscriptionEvents.eventType` (eq(...) or IN (...)) must be in the
 * vocabulary; every write names a SUBSCRIPTION_EVENT constant, never a
 * literal. The one registered exception is the dormant win-back engine.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import {
  SUBSCRIPTION_EVENT,
  classifyTierChange,
  tallySubscriptionEvents,
  tierRank,
} from "../../shared/billing/subscriptionEventVocabulary";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = resolve(__dirname, "../..");

/**
 * Reads that still name a dead value, each with the reason it is not fixed.
 * Fixing the win-back predicate would START emailing cancelled customers
 * from a job that has never sent — an outbound change the founder decides
 * (DEFECT-0150).
 */
const DORMANT_READERS: Record<string, string> = {
  "server/jobs/growthAutomation.ts::subscription_cancelled": "DEFECT-0150 — win-back engine; activating it is a founder decision",
};

function serverFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules") serverFiles(p, out); }
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("DEFECT-0149 — the vocabulary", () => {
  it("classifies tier changes by rank, legacy aliases included", () => {
    expect(classifyTierChange("free", "starter")).toBe("upgrade");
    expect(classifyTierChange("operator", "solo")).toBe("downgrade");
    expect(classifyTierChange("pro", "operator")).toBe("lateral");
    expect(tierRank("empire")).toBe(3);
    expect(tierRank(null)).toBe(0);
  });

  it("tallies what the writers actually write", () => {
    const t = tallySubscriptionEvents([
      { eventType: "change", fromTier: "free", toTier: "pro" },
      { eventType: "change", fromTier: "pro", toTier: "scale" },
      { eventType: "change", fromTier: "scale", toTier: "starter" },
      { eventType: "cancel", fromTier: "pro", toTier: null },
      { eventType: "trial_end", fromTier: "pro", toTier: null },
      { eventType: "resume", fromTier: "pro", toTier: null },
    ]);
    expect(t).toEqual({ upgrades30d: 2, downgrades30d: 1, cancellations30d: 1, reactivations30d: 1, signups30d: 1 });
  });
});

describe("DEFECT-0149 population — every event_type literal is in the vocabulary", () => {
  const vocab = new Set<string>(Object.values(SUBSCRIPTION_EVENT));
  const reads: string[] = [];
  const offenders: string[] = [];
  const literalWrites: string[] = [];
  for (const p of serverFiles(resolve(ROOT, "server"))) {
    const rel = relative(ROOT, p);
    const src = stripComments(readFileSync(p, "utf8"));
    for (const m of src.matchAll(/eq\(\s*subscriptionEvents\.eventType\s*,\s*([^)]+?)\s*\)/g)) {
      reads.push(rel);
      const arg = m[1];
      const lit = /^["']([^"']+)["']$/.exec(arg);
      const konst = /^SUBSCRIPTION_EVENT\.(\w+)$/.exec(arg);
      if (lit) {
        if (!vocab.has(lit[1]) && !DORMANT_READERS[`${rel}::${lit[1]}`]) offenders.push(`${rel}: ${lit[1]}`);
      } else if (!konst || !(konst[1] in SUBSCRIPTION_EVENT)) {
        offenders.push(`${rel}: unrecognised event_type expression ${arg}`);
      }
    }
    for (const m of src.matchAll(/\$\{subscriptionEvents\.eventType\}\s+IN\s*\(([^)]*)\)/g)) {
      for (const v of m[1].matchAll(/'([^']+)'/g)) {
        reads.push(rel);
        if (!vocab.has(v[1])) offenders.push(`${rel}: ${v[1]}`);
      }
    }
    for (const m of src.matchAll(/(?:insert\(subscriptionEvents\)\.values|logSubscriptionEvent)\(\s*\{([\s\S]{0,400}?)\}\s*\)/g)) {
      if (/eventType:\s*["']/.test(m[1])) literalWrites.push(rel);
    }
  }

  it("reads the population (vacuity)", () => {
    expect(new Set(reads).size).toBeGreaterThanOrEqual(4);
  });

  it("no reader names a value nothing writes", () => {
    expect(offenders).toEqual([]);
  });

  it("writers name the constants", () => {
    expect(literalWrites).toEqual([]);
  });

  it("the dormant register is not stale", () => {
    for (const key of Object.keys(DORMANT_READERS)) {
      const [file, value] = key.split("::");
      expect(stripComments(readFileSync(resolve(ROOT, file), "utf8")), key).toContain(`"${value}"`);
    }
  });
});
