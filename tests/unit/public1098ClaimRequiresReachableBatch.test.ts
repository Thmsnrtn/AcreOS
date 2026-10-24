/**
 * Public copy may not claim AcreOS files or batches Form 1098s while no
 * customer surface can reach the 1098 batch (best-in-class audit 2026-10-20).
 *
 * The landing page said the Servicing agent "Files 1098s", and five /learn
 * pages said "1098s batch for IRS e-file". `POST /api/accounting/1098-batch`
 * returned counts only and nothing in client/src called it, so the claim
 * named a capability no customer could use.
 *
 * The rule is coupled to the capability, not to a phrase: once a client
 * surface calls the batch route, the claim is allowed again.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "../helpers/stripComments";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

// The public surfaces. Each population carries a floor so a moved directory
// reads as a failure, not as "clean".
const POPULATIONS: Array<{ name: string; files: string[]; floor: number }> = [
  { name: "landing sections", files: walk("client/src/pages/landing", [".tsx", ".ts"]), floor: 10 },
  { name: "landing page", files: ["client/src/pages/landing.tsx"], floor: 1 },
  { name: "learn content", files: walk("content/learn", [".json"]), floor: 10 },
];

const batchIsReachable = walk("client/src", [".ts", ".tsx"]).some((f) =>
  stripComments(readFileSync(f, "utf8")).includes("/api/accounting/1098-batch"),
);

describe("public 1098 claims require a reachable 1098 batch", () => {
  for (const pop of POPULATIONS) {
    it(`${pop.name}: population is non-vacuous`, () => {
      expect(pop.files.length).toBeGreaterThanOrEqual(pop.floor);
    });
    it(`${pop.name}: no 1098 claim unless a customer surface reaches the batch`, () => {
      if (batchIsReachable) return;
      const offenders = pop.files.filter((f) => {
        const raw = readFileSync(f, "utf8");
        const text = f.endsWith(".json") ? raw : stripComments(raw);
        return /\b1098s?\b/.test(text);
      });
      expect(offenders).toEqual([]);
    });
  }
});
