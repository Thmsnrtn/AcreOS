/**
 * THE GOLDEN LOOP, FAILING — one complete failure, end to end.
 *
 * Master Audit Section VII(C). The happy-path loop is proved in
 * goldenLoopOneProperty.test.ts; this is its darker twin, and it is the more
 * valuable of the two. Fabrication, fail-open defaults and silent coercions do
 * not live on the success path — nobody writes `?? 0` for a value that arrived.
 * They live in the branches that run when a provider times out, a balance is
 * short, or a payload comes back half-empty.
 *
 * The three failures traced here are the ones this system will actually meet:
 *
 *   1. A PARTIAL provider payload — some fields attributed, some not. The
 *      evidence layer must record what it can, refuse what it cannot, and let
 *      the gap reach the decision as an explicit unknown.
 *   2. A CONFLICT — two authoritative sources disagreeing. Neither may win by
 *      arriving second, and the decision must record the disagreement rather
 *      than a resolved-looking value.
 *   3. An OUTWARD ACTION whose outcome is unknown — the one that spends money
 *      and prints paper. Ambiguity must refuse, and it must be distinguishable
 *      from a refusal that provably never reached the provider.
 *
 * The third is where this file earned its keep — see the block at the bottom.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { claimsFromEnrichment } from "../../server/services/evidence/enrichmentToClaims";
import type { EnrichmentResult } from "../../server/services/propertyEnrichment";
import {
  resolveAll,
  resolveClaims,
  type EvidenceClaim,
  type EvidenceClaimInput,
} from "@shared/evidence/claim";
import { freezeDecision, describeFooting } from "@shared/decisions/snapshot";
import {
  ActionAmbiguousError,
  ActionInFlightError,
  ActionKeyReusedError,
  OutwardActionError,
  ProviderNotContactedError,
  classifyExisting,
  requestHash,
} from "../../server/services/actions/outwardAction";

const ROOT = path.resolve(__dirname, "../..");
const PROPERTY_ID = 8181;
const FETCHED_AT = new Date("2026-05-10T12:00:00Z");
const DECIDED_AT = new Date("2026-05-12T12:00:00Z");

function persist(inputs: EvidenceClaimInput[], startId = 2000): EvidenceClaim[] {
  return inputs.map((c, i) => ({ ...c, id: startId + i, organizationId: 3 }));
}

// ── Failure 1: the provider came back half-attributed ───────────────────────

/**
 * A run that half-worked. The parcel lookup returned and is attributed; the
 * hazard lookup returned a flood zone but its provenance entry never arrived
 * (the timeout landed between the value and its attribution). This is what a
 * partial upstream failure actually looks like — not an empty object.
 */
function partialPayload(): EnrichmentResult {
  return {
    propertyId: PROPERTY_ID,
    latitude: 31.4,
    longitude: -98.2,
    enrichedAt: FETCHED_AT,
    lookupTimeMs: 30_000,
    parcel: { apn: "R-9001", acreage: 22.5, assessedValue: 61_000 },
    hazards: { floodZone: "AE" },
    provenance: {
      parcel_data: { source: "Lampasas CAD", asOf: "2025-08-01" },
      // flood_zone never arrived.
    },
  } as EnrichmentResult;
}

const partialClaims = persist(claimsFromEnrichment(PROPERTY_ID, partialPayload()));
const partialResolved = resolveAll(partialClaims, DECIDED_AT);

const partialDecision = freezeDecision(
  {
    subjectType: "property",
    subjectId: PROPERTY_ID,
    kind: "pass",
    choice: "Pass for now",
    rationale: "Cannot price flood exposure without a zone we can attribute.",
    actorType: "user",
    actorRef: "12",
    authority: "owner",
    strategyPackId: null,
    strategyPackVersion: null,
    assumptions: [],
    alternatives: [],
    reviewDueAt: null, // required-nullable: this fixture has no natural review date
  },
  partialResolved,
  DECIDED_AT,
);

describe("failure 1 — a provider run that only half worked", () => {
  it("records what was attributed and drops what was not", () => {
    const predicates = partialClaims.map((c) => c.predicate);
    expect(predicates).toContain("parcel.apn");
    expect(predicates).toContain("parcel.acreage");
    // The flood zone HAD a value. It had no source, so it is not evidence.
    expect(predicates).not.toContain("property.flood_zone");
  });

  it("a partial run still produces a usable record — it does not fail closed to nothing", () => {
    // Refusing the whole run because one category lost its attribution would be
    // the opposite error: the parcel facts are real, attributed and useful.
    expect(partialClaims.length).toBeGreaterThan(0);
    expect(partialDecision.evidence.length).toBeGreaterThan(0);
  });

  it("asking for the missing predicate returns unknown, never a default", () => {
    // Nothing anywhere coerces the absent flood zone into "X", "unknown" or "".
    //
    // THIS ASSERTION FOUND A SECOND DEFECT. It hands `resolveClaims` the whole
    // claim set — which is what a caller who forgot to pre-filter would do — and
    // the parcel claims were being read as rival answers for the flood zone,
    // returning `conflict`: a confident, user-visible, entirely FABRICATED
    // disagreement between sources that never disagreed.
    //
    // Not a live bug — the one production caller (`resolveFact`) filters via
    // `claimsForPredicate`. But the safety of the evidence read path rested on a
    // convention nothing enforced, and "no fabrication" is not a rule a pure
    // function should delegate to its callers. It now filters by predicate
    // itself, so the mixed-set call returns the RIGHT answer instead of a
    // fabricated one.
    const r = resolveClaims("property.flood_zone", partialClaims, DECIDED_AT);
    expect(r.state).toBe("unknown");
    expect(r).not.toHaveProperty("value");
    expect(r.factors.length).toBeGreaterThan(0); // it explains itself
  });

  it("a mixed claim set can never manufacture a conflict", () => {
    // The general form. Claims about OTHER predicates must be invisible, not
    // rivals — asserted directly so the guard cannot be quietly removed.
    const mixed = [...partialClaims, ...persist(claimsFromEnrichment(PROPERTY_ID, partialPayload()), 9000)];
    const apn = resolveClaims("parcel.apn", mixed, DECIDED_AT);
    expect(apn.state).toBe("known");
    expect(apn.value).toBe("R-9001");
    for (const c of apn.candidates.flatMap((x) => x.claims)) {
      expect(c.predicate).toBe("parcel.apn");
    }
  });

  it("the decision is honest that it was made on a partial picture", () => {
    const frozen = new Set(partialDecision.evidence.map((f) => f.predicate));
    expect(frozen.has("property.flood_zone")).toBe(false);
    expect(describeFooting(partialDecision)).toContain("known fact(s) at decision time");
  });
});

// ── Failure 2: two authorities disagree ─────────────────────────────────────

const conflicting: EvidenceClaim[] = [
  {
    subjectType: "property",
    subjectId: PROPERTY_ID,
    predicate: "property.flood_zone",
    value: "AE",
    provider: "fema-direct",
    source: "FEMA NFHL",
    authority: "authoritative",
    observedAt: new Date("2026-01-05T00:00:00Z"),
    fetchedAt: new Date("2026-05-01T00:00:00Z"),
    providerConfidence: null,
    license: null,
    costCents: 0,
    id: 3001,
    organizationId: 3,
  },
  {
    subjectType: "property",
    subjectId: PROPERTY_ID,
    predicate: "property.flood_zone",
    value: "X",
    provider: "county-gis",
    source: "Lampasas County GIS",
    authority: "authoritative",
    observedAt: new Date("2026-01-05T00:00:00Z"),
    fetchedAt: new Date("2026-05-02T00:00:00Z"), // fetched LATER
    providerConfidence: null,
    license: null,
    costCents: 0,
    id: 3002,
    organizationId: 3,
  },
];

describe("failure 2 — two authoritative sources disagree", () => {
  const resolved = resolveClaims("property.flood_zone", conflicting, DECIDED_AT);

  it("reports conflict rather than letting the later fetch win", () => {
    // "Last write wins" is the single most dangerous default here: it would turn
    // a genuine disagreement between FEMA and a county GIS into a confident
    // answer, and the answer would depend on lookup ORDER.
    expect(resolved.state).toBe("conflict");
    expect(resolved).not.toHaveProperty("value");
  });

  it("names both sides, so a human can adjudicate", () => {
    const sources = resolved.candidates.flatMap((c) => c.claims.map((x) => x.source));
    expect(sources).toContain("FEMA NFHL");
    expect(sources).toContain("Lampasas County GIS");
  });

  it("the conflict reaches the DECISION as a conflict, not as an unknown", () => {
    // These are different facts. "We never looked" and "we looked twice and got
    // two answers" call for different next actions, and collapsing them loses
    // the more actionable one.
    const decision = freezeDecision(
      {
        subjectType: "property",
        subjectId: PROPERTY_ID,
        kind: "pass",
        choice: "Pass pending flood adjudication",
        rationale: "FEMA and the county disagree on the zone.",
        actorType: "user",
        actorRef: "12",
        authority: "owner",
        strategyPackId: null,
        strategyPackVersion: null,
        assumptions: [],
        alternatives: [],
        reviewDueAt: null, // required-nullable: this fixture has no natural review date
      },
      [resolved],
      DECIDED_AT,
    );
    const fact = decision.evidence.find((f) => f.predicate === "property.flood_zone")!;
    expect(fact.state).toBe("conflict");
    expect(fact).not.toHaveProperty("value");
    const unknown = decision.unknowns.find((u) => u.subject === "property.flood_zone")!;
    expect(unknown.kind).toBe("conflict");
  });
});

// ── Failure 3: the action that spends money ─────────────────────────────────

describe("failure 3 — an outward action whose outcome is unknown", () => {
  const KIND = "physical_mail.letter";
  const KEY = "mailing-order:55:lead:7";
  const hash = requestHash({ to: "A Seller", body: "<p>offer</p>" });
  const row = (over: Record<string, unknown> = {}) =>
    ({
      actionKind: KIND,
      idempotencyKey: KEY,
      requestHash: hash,
      status: "succeeded",
      externalId: "ltr_abc",
      ...over,
    }) as Parameters<typeof classifyExisting>[0];

  it("an unknown prior outcome REFUSES — never guess with someone else's money", () => {
    const v = classifyExisting(row({ status: "ambiguous" }), hash);
    expect(v.verdict).toBe("refuse");
    expect((v as { error: Error }).error).toBeInstanceOf(ActionAmbiguousError);
  });

  it("a concurrent claim refuses rather than racing the other worker", () => {
    const v = classifyExisting(row({ status: "in_flight" }), hash);
    expect(v.verdict).toBe("refuse");
    expect((v as { error: Error }).error).toBeInstanceOf(ActionInFlightError);
  });

  it("a key reused for different content refuses BEFORE status is even considered", () => {
    // Otherwise a `succeeded` row would replay a stale result for new content
    // and silently suppress a send the caller genuinely wanted.
    const v = classifyExisting(row({ status: "succeeded" }), requestHash({ different: true }));
    expect(v.verdict).toBe("refuse");
    expect((v as { error: Error }).error).toBeInstanceOf(ActionKeyReusedError);
  });

  it("an unrecognised status refuses rather than falling through to send", () => {
    const v = classifyExisting(row({ status: "weird" as never }), hash);
    expect(v.verdict).toBe("refuse");
    expect((v as { error: Error }).error).toBeInstanceOf(OutwardActionError);
  });

  it("a prior FAILED attempt re-executes — nothing happened, so retry is safe", () => {
    expect(classifyExisting(row({ status: "failed" }), hash).verdict).toBe("execute");
  });

  // ── THE DEFECT THIS FILE FOUND ────────────────────────────────────────────

  it("a refusal that never reached the provider is FAILED (retryable), not ambiguous", () => {
    // Tracing the credit-refusal path end to end is what exposed this.
    //
    // `withOutwardAction` records any unclassified throw as `ambiguous`, which
    // is the correct DEFAULT and was the wrong ANSWER for the several steps that
    // run BEFORE the provider is contacted. `checkCreditsAndRecord` only READS
    // the balance — it deducts nothing despite its name — and Lob has not been
    // called. Yet an org that ran out of credits got a PERMANENTLY POISONED
    // idempotency key: top up, retry, and hit ActionAmbiguousError forever, with
    // a message telling the operator to reconcile against a provider that never
    // heard of the request. The letter could never be sent under its own durable
    // key again.
    //
    // Severity, stated honestly: this failed SAFE. Nothing double-sent and no
    // money moved. It was an operational dead end, not a duplicate letter — but
    // a dead end that requires a human to clear, on the money-spending path.
    const src = fs.readFileSync(
      path.join(ROOT, "server/services/actions/outwardAction.ts"),
      "utf8",
    );
    expect(src).toMatch(
      /error instanceof ProviderNotContactedError[\s\S]{0,200}markClaim\(claimId,\s*"failed"/,
    );
    // And it is a subclass, so a caller catching the family still catches it.
    const e = new ProviderNotContactedError("Insufficient credits.");
    expect(e).toBeInstanceOf(OutwardActionError);
  });

  it("the polarity is PROVE-no-contact, not assume-no-contact", () => {
    // The default must stay ambiguous. A transport opts IN to retryability by
    // throwing the specific type; anything else — including a plain Error that
    // happens to mention credits — stays ambiguous. Assuming no contact unless
    // proven otherwise is how a second letter reaches a real mailbox.
    const src = fs.readFileSync(
      path.join(ROOT, "server/services/actions/outwardAction.ts"),
      "utf8",
    );
    // No string-matching on error messages anywhere in the classification.
    expect(src).not.toMatch(/\.message\s*\.\s*(includes|match|indexOf)\(/);
    // The ambiguous fallback still exists and is still the last word.
    expect(src).toMatch(/markClaim\(claimId,\s*"ambiguous",\s*null,\s*error\.message\)/);
  });

  it("the credit refusal actually throws the typed error", () => {
    // The classification is worthless if no transport uses it. Both Lob paths
    // (letter and postcard) must raise it — a gate on the exact defect, since
    // wiring one and not the other is precisely how a half-fix ships.
    const mail = fs.readFileSync(
      path.join(ROOT, "server/services/directMailService.ts"),
      "utf8",
    );
    const throwsTyped = mail.match(/throw new ProviderNotContactedError\(/g) ?? [];
    expect(throwsTyped.length).toBe(2);
    // And the old untyped throw is gone from the credit branch.
    expect(mail).not.toMatch(/hasCredits\s*\)\s*\{\s*throw new Error\(creditCheck\.errorMessage\)/);
  });

  it("a genuine mid-flight failure is still ambiguous", () => {
    // The Lob call itself must NOT be reclassified. A network failure there may
    // or may not have printed a letter, and that is the case the whole ledger
    // exists for.
    const mail = fs.readFileSync(
      path.join(ROOT, "server/services/directMailService.ts"),
      "utf8",
    );
    // The exec body rethrows unchanged rather than flattening the type away.
    expect(mail).toMatch(/const error = err instanceof Error \? err : new Error\(String\(err\)\);[\s\S]{0,900}throw error;/);
    // The client.letters.create call is NOT wrapped in the typed error.
    const lobCall = mail.slice(mail.indexOf("client.letters.create"));
    expect(lobCall.slice(0, 1500)).not.toContain("ProviderNotContactedError");
  });
});
