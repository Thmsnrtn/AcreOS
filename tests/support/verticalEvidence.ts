/**
 * Measure, from source, what this repository can actually demonstrate about
 * each vertical.
 *
 * ── WHY THIS IS SHARED RATHER THAN COPIED ───────────────────────────────────
 * Two tests need it, and they need it to be the SAME measurement.
 * `verticalReadiness.test.ts` uses it to hold the overclaim ratchet;
 * `publicMaturityRendered.test.tsx` uses it as the independent anchor for what
 * the landing may call `core`.
 *
 * That second use is the reason this file exists. The rendered test originally
 * derived its expectation from `PUBLIC_CLAIM_DEMOTIONS` — so deleting a
 * demotion moved the expectation and the DOM together, and the test passed
 * while a vertical that cannot show a decision went back to being advertised as
 * fully supported. A projection compared against itself proves only that it is
 * a function. The anchor has to come from the evidence, which is what this
 * measures.
 *
 * Nothing here is hand-listed. Every fact is read out of the live source.
 */

import fs from "node:fs";
import path from "node:path";
import { type BusinessTypeId } from "../../shared/business-types";
import { type VerticalEvidence } from "../../shared/business-types/readiness";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string): string => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Template ids the workflow engine really defines (`id: "tpl_…"`). */
function definedTemplateIds(): Set<string> {
  const src = read("server/services/workflow-engine.ts");
  return new Set([...src.matchAll(/\bid:\s*"(tpl_[a-z0-9_]+)"/g)].map((m) => m[1]));
}

/**
 * Economics engines that write a scenario in production, mapped to the vertical
 * whose surface owns that route.
 *
 * Deliberately narrow and explicit: inferring a vertical from an engine name
 * would let a rename silently promote one.
 */
const ENGINE_ROUTE_OWNER: Record<string, BusinessTypeId> = {
  // POST /api/flip-analyzer/offer — the flip module is businessTypeOnly
  // ["fix_and_flip"] in layout-sidebar.tsx.
  flip_mao: "fix_and_flip",
};

/**
 * Routes that record a decision snapshot AND are owned by a vertical.
 *
 * `routes-decisions.ts` is the generic API and owns no vertical, so it promotes
 * nothing — an API no customer surface calls is not evidence that a vertical
 * decides.
 *
 * DELIBERATELY ABSENT: `server/routes-team-messaging.ts`. Its offer-letter batch
 * DOES call `recordDecision` as of 2026-08-19, so land operators finally get
 * decision memory for the offers they send — but `/offers/batches` and
 * `/blind-offer-wizard` sit under Deals with no `businessTypeOnly`, which makes
 * them SHARED surfaces rather than any vertical's own loop. Adding the file here
 * would promote land_flipper to `decided` on the strength of a CRM surface every
 * persona uses, which is the same overclaim this map exists to prevent — and it
 * would drop the overclaim count the ratchet pins at exactly 13.
 *
 * What would legitimately promote land: a land-owned surface that records a
 * decision, the way flip-analyzer does for fix_and_flip.
 */
const DECISION_ROUTE_OWNER: Record<string, BusinessTypeId> = {
  "server/routes-flip-analyzer.ts": "fix_and_flip",
  "server/routes-lot-pricing.ts": "subdivider",
};

function routeFiles(): string[] {
  return fs
    .readdirSync(path.join(ROOT, "server"))
    .filter((f) => f.startsWith("routes") && f.endsWith(".ts") && !f.includes(".test."))
    .map((f) => `server/${f}`);
}

function underwrittenTypes(): Set<BusinessTypeId> {
  const out = new Set<BusinessTypeId>();
  for (const file of routeFiles()) {
    const src = read(file);
    if (!src.includes("recordScenario(")) continue;
    for (const m of src.matchAll(/engineId:\s*"([a-z0-9_]+)"/g)) {
      const owner = ENGINE_ROUTE_OWNER[m[1]];
      if (owner) out.add(owner);
    }
  }
  return out;
}

function decidingTypes(): Set<BusinessTypeId> {
  const out = new Set<BusinessTypeId>();
  for (const [file, owner] of Object.entries(DECISION_ROUTE_OWNER)) {
    if (read(file).includes("recordDecision(")) out.add(owner);
  }
  return out;
}

/**
 * The measured evidence. Callers MUST vacuity-guard it — a scan that silently
 * finds nothing reports the most flattering possible answer.
 */
export function measureVerticalEvidence(): VerticalEvidence {
  return {
    definedWorkflowTemplateIds: definedTemplateIds(),
    underwrittenBusinessTypes: underwrittenTypes(),
    decidingBusinessTypes: decidingTypes(),
  };
}
