/**
 * G1.4 — marketing-claims honesty gate + the provable-claims registry pin.
 *
 * Two layers, complementing (not duplicating) the truth-engine CI audit
 * (scripts/audit-public-claims.ts — source-citation layer):
 *
 * 1. CAPS REALITY CHECK — walks the public marketing copy (LANDING_COPY, the
 *    pricing-tier bullets, and the /for/<vertical> pages' derived + template
 *    copy) for "unlimited <resource>" claims and fails wherever the CODE
 *    actually caps that resource. The cap set is DERIVED from the real
 *    sources — shared/billing/tier-limits.ts and the free-tier lifetime mail
 *    cap in server/routes-outreach-mail.ts — never hardcoded here, so a new
 *    cap retroactively fails any stale "unlimited" claim (wave-discipline #4:
 *    derived, not a snapshot). Red-first self-checks prove the scanner
 *    catches planted violations (e.g. "unlimited mail" injected into the
 *    landing pricing copy MUST fail).
 *
 * 2. PROOF REGISTRY PIN — shared/governance/public-claims.ts (rendered as the
 *    /transparency#proof section) may only carry claims whose enforcement
 *    pointers resolve on disk TODAY. Every ref must exist; constitution-
 *    derived rows must mirror machine-enforced invariants only (the drop
 *    list stays empty); audited-verbatim rows must appear in the truth-engine
 *    audit AND match the live landing copy.
 *
 * Maturity honesty: beta/maturity words must not contradict the registry —
 * a CORE vertical's public page copy may never call it beta / coming soon,
 * and the /for template may not hardcode maturity words at all (maturity
 * treatment must derive from shared/business-types.ts).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DROPPED_CONSTITUTION_PROOF_IDS,
  PROOF_KIND_LABELS,
  PUBLIC_PROOF_CLAIMS,
  WEDGE_SENTENCE,
  proofClaimById,
  proofClaimsByCategory,
} from "../../shared/governance/public-claims";
import { invariantById } from "../../shared/governance/constitution";
import {
  TIER_LIMITS,
  getVisibleTiers,
  type SubscriptionTier,
} from "../../shared/billing/tier-limits";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_IDS,
} from "../../shared/business-types";
import { FOR_VERTICAL_SLUGS } from "../../shared/seo/public-routes";
import { LANDING_COPY } from "../../client/src/pages/landing/copy";
import { PRICING_TIER_COPY } from "../../client/src/lib/pricing-copy";
import { deriveForPage } from "../../client/src/pages/for/derive";

const REPO_ROOT = resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// The free-tier lifetime mail cap, read from the enforcing SOURCE so this test
// needs no server import graph. Refuse-not-fabricate: if the constant vanishes
// or moves, this fails loudly instead of assuming a value.
//
// R-2 (2026-08-11): the constant moved from server/routes-outreach-mail.ts to
// server/services/mail/mailLanes.ts — the single credential+lane door — because
// the queue route was only one of four send paths and the other three were
// uncapped. The pin was REWRITTEN to the new truth, not deleted, and gained a
// second assertion: the route must NOT hold a rival copy of the number.
// ---------------------------------------------------------------------------
const mailLanesSrc = readFileSync(
  join(REPO_ROOT, "server", "services", "mail", "mailLanes.ts"),
  "utf8",
);
const outreachMailSrc = readFileSync(
  join(REPO_ROOT, "server", "routes-outreach-mail.ts"),
  "utf8",
);
const freePiecesMatch = mailLanesSrc.match(
  /export const FREE_TIER_LIFETIME_PIECES\s*=\s*(\d+)/,
);

// ---------------------------------------------------------------------------
// Cap engine — derived from the live tier-limit table.
// ---------------------------------------------------------------------------

/** Metered resources a marketing noun can refer to. */
type CappedResource =
  | "leads"
  | "properties"
  | "notes"
  | "campaigns"
  | "sequences"
  | "ai_requests"
  | "seats"
  | "mailPieces";

/**
 * Noun → resource. A noun with NO entry here is not metered anywhere in code
 * (e.g. "counties" — verified: no county cap exists in shared/billing or the
 * server gates at HEAD), so an "unlimited <that noun>" claim is honest.
 * First match wins.
 */
const NOUN_PATTERNS: ReadonlyArray<{ pattern: RegExp; resource: CappedResource }> = [
  { pattern: /\blead/i, resource: "leads" },
  { pattern: /\bpropert/i, resource: "properties" },
  { pattern: /\bnote/i, resource: "notes" },
  { pattern: /\bcampaign/i, resource: "campaigns" },
  { pattern: /\bsequence/i, resource: "sequences" },
  { pattern: /\bseat|\buser/i, resource: "seats" },
  { pattern: /\bmessage|\bturn|\bpax\b|\bai\b/i, resource: "ai_requests" },
  { pattern: /\bmailer|\bletter|\bmail\b|\bpiece|\bpostcard/i, resource: "mailPieces" },
];

/**
 * The enforced cap for a resource on a tier, or null when the code genuinely
 * does not cap it there. mailPieces: the free tier's lifetime cap is enforced
 * on the mail queue route (FREE_TIER_LIFETIME_PIECES); paid tiers carry no
 * per-piece code cap (the credit pool meters SPEND, not pieces, and BYOK
 * postage bypasses it), so "unlimited campaigns (BYOK for postage)" on Pro is
 * honest while any free-tier "unlimited mail" claim is not.
 */
function capForTier(resource: CappedResource, tier: SubscriptionTier): number | null {
  if (resource === "seats") return TIER_LIMITS[tier].maxSeats;
  if (resource === "mailPieces") {
    return tier === "free" ? Number(freePiecesMatch?.[1] ?? NaN) : null;
  }
  return TIER_LIMITS[tier][resource];
}

interface UnlimitedViolation {
  raw: string;
  resource: CappedResource;
  cappedAt: string;
}

/**
 * Scan a copy string for "unlimited <noun…>" claims and return the ones the
 * code contradicts. `tier` scopes the claim to one tier's caps; unscoped
 * copy (the landing page, the /for pages) must hold on EVERY visible tier —
 * an unscoped "unlimited leads" is dishonest while any tier caps leads.
 */
function scanUnlimitedViolations(
  text: string,
  tier?: SubscriptionTier,
): UnlimitedViolation[] {
  const out: UnlimitedViolation[] = [];
  const re = /\bunlimited\s+([a-z][a-z-]*(?:\s+[a-z][a-z-]*){0,2})/gi;
  for (const match of text.matchAll(re)) {
    const phrase = match[1];
    const noun = NOUN_PATTERNS.find((n) => n.pattern.test(phrase));
    if (!noun) continue; // not a metered resource — no cap to contradict
    const tiers = tier ? [tier] : getVisibleTiers();
    const capped = tiers
      .map((t) => ({ t, cap: capForTier(noun.resource, t) }))
      .filter((c) => typeof c.cap === "number" && Number.isFinite(c.cap));
    if (capped.length > 0) {
      out.push({
        raw: match[0],
        resource: noun.resource,
        cappedAt: capped.map((c) => `${c.t}=${c.cap}`).join(", "),
      });
    }
  }
  return out;
}

/** Recursively collect every string in a copy object. */
function flattenStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) flattenStrings(v, out);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) flattenStrings(v, out);
  }
  return out;
}

/** Strip // and /* comments so doc-comment prose doesn't trip source scans. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/([^:'"])\/\/[^\n]*/g, "$1");
}

/** All strings the /for page derivation renders for one vertical. */
function forPageStrings(id: (typeof BUSINESS_TYPE_IDS)[number]): string[] {
  const content = deriveForPage(FOR_VERTICAL_SLUGS[id]);
  expect(content, `deriveForPage must resolve ${id}`).not.toBeNull();
  return [
    content!.label,
    content!.shortDescription,
    content!.noun,
    content!.finishCta,
    content!.finishBlurb,
    ...content!.spotlights.map((s) => s.label),
    ...content!.integrations.map((i) => i.label),
  ];
}

const MATURITY_WORDS = /\bbeta\b|coming soon|early access|\bwaitlist\b|\bexperimental\b/i;

// ---------------------------------------------------------------------------
// 0. Substrate
// ---------------------------------------------------------------------------

describe("caps substrate — the derived cap sources are real", () => {
  it("FREE_TIER_LIFETIME_PIECES still exists at the enforcing chokepoint", () => {
    expect(
      freePiecesMatch,
      "server/services/mail/mailLanes.ts no longer exports FREE_TIER_LIFETIME_PIECES — " +
        "update this test's cap derivation to the constant's new home, never delete the check",
    ).not.toBeNull();
    expect(Number(freePiecesMatch![1])).toBeGreaterThan(0);
  });

  it("the queue route re-exports that constant rather than holding a rival copy", () => {
    // Two definitions of one cap is how a marketing claim and an enforced
    // limit drift apart. The route may re-export; it may not redefine.
    expect(outreachMailSrc).not.toMatch(/export const FREE_TIER_LIFETIME_PIECES\s*=\s*\d+/);
    expect(outreachMailSrc).toMatch(
      /export \{ FREE_TIER_LIFETIME_PIECES \} from ["'].*mail\/mailLanes["']/,
    );
  });

  it("the free pricing tile's letter count is PINNED to the enforced constant (this test is the pin)", () => {
    const free = PRICING_TIER_COPY.find((t) => t.id === "free")!;
    const bullet = free.features.find((f) => /first \d+ letters/i.test(f));
    expect(bullet, "free tile must state the first-letters cap").toBeDefined();
    expect(bullet!.match(/first (\d+) letters/i)![1]).toBe(freePiecesMatch![1]);
  });
});

// ---------------------------------------------------------------------------
// 1. Caps reality check over the live public copy
// ---------------------------------------------------------------------------

describe('caps reality check — no "unlimited X" where the code caps X', () => {
  it("LANDING_COPY carries no unlimited-claim the tier caps contradict", () => {
    const violations = flattenStrings(LANDING_COPY).flatMap((s) =>
      scanUnlimitedViolations(s),
    );
    expect(
      violations,
      `landing copy claims "unlimited" for capped resources: ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });

  it("each pricing tile's bullets hold against THAT tier's cap table", () => {
    for (const tile of PRICING_TIER_COPY) {
      const violations = tile.features.flatMap((f) =>
        scanUnlimitedViolations(f, tile.id),
      );
      expect(
        violations,
        `${tile.id} tile claims "unlimited" for resources its own tier caps: ${JSON.stringify(violations)}`,
      ).toEqual([]);
    }
  });

  it("every /for/<vertical> page's derived copy is unlimited-claim clean", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      const violations = forPageStrings(id).flatMap((s) =>
        scanUnlimitedViolations(s),
      );
      expect(violations, `${id} /for copy`).toEqual([]);
    }
  });

  it("the /for template source hardcodes no unlimited claims", () => {
    const src = stripComments(
      readFileSync(
        join(REPO_ROOT, "client", "src", "pages", "for", "vertical.tsx"),
        "utf8",
      ),
    );
    expect(scanUnlimitedViolations(src)).toEqual([]);
  });

  // Red-first: the scanner must CATCH planted violations, or the green
  // checks above prove nothing.
  it("catches a planted unscoped violation (unlimited leads — free caps leads)", () => {
    const v = scanUnlimitedViolations("Get unlimited leads on every plan.");
    expect(v).toHaveLength(1);
    expect(v[0].resource).toBe("leads");
  });

  it('catches "unlimited mail" planted into the landing pricing copy (the G1.4 exit check)', () => {
    const tampered = `${LANDING_COPY.pricing.sub} Unlimited mail included.`;
    const v = scanUnlimitedViolations(tampered);
    expect(v.length).toBeGreaterThan(0);
    expect(v.some((x) => x.resource === "mailPieces")).toBe(true);
  });

  it("catches a planted tier-scoped violation and passes a genuinely uncapped one", () => {
    // Pro caps leads at a finite number → violation.
    expect(scanUnlimitedViolations("Unlimited leads", "pro")).toHaveLength(1);
    // Pro campaigns are null (uncapped) in TIER_LIMITS → honest claim.
    expect(scanUnlimitedViolations("Unlimited campaigns", "pro")).toEqual([]);
    // Free letters are lifetime-capped on the mail route → violation.
    expect(scanUnlimitedViolations("unlimited letters", "free")).toHaveLength(1);
    // "counties" is not metered anywhere in code → honest claim.
    expect(scanUnlimitedViolations("Unlimited counties in buy-box", "pro")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Maturity honesty — beta words must not contradict the registry
// ---------------------------------------------------------------------------

describe("maturity honesty — copy never contradicts the registry maturity", () => {
  it("no CORE vertical's /for copy carries beta/maturity words (derived from the live registry)", () => {
    for (const id of BUSINESS_TYPE_IDS) {
      if (BUSINESS_TYPES[id].maturity !== "core") continue;
      const copy = forPageStrings(id).join(" ");
      expect(
        MATURITY_WORDS.test(copy),
        `${id} is registry-maturity "core" but its /for copy says: ` +
          `${copy.match(MATURITY_WORDS)?.[0]}`,
      ).toBe(false);
    }
  });

  it("the /for template + derivation hardcode no maturity words — maturity must derive from the registry", () => {
    for (const rel of [
      ["client", "src", "pages", "for", "vertical.tsx"],
      ["client", "src", "pages", "for", "derive.ts"],
    ]) {
      const src = stripComments(readFileSync(join(REPO_ROOT, ...rel), "utf8"));
      expect(
        MATURITY_WORDS.test(src),
        `${rel.join("/")} hardcodes a maturity word (${src.match(MATURITY_WORDS)?.[0]}) — ` +
          "maturity treatment must derive from shared/business-types.ts",
      ).toBe(false);
    }
  });

  it("no landing string pairs a core vertical's label with 'beta'", () => {
    const coreLabels = BUSINESS_TYPE_IDS.filter(
      (id) => BUSINESS_TYPES[id].maturity === "core",
    ).map((id) => BUSINESS_TYPES[id].label);
    for (const s of flattenStrings(LANDING_COPY)) {
      for (const label of coreLabels) {
        const idx = s.indexOf(label);
        if (idx === -1) continue;
        const nearby = s.slice(Math.max(0, idx - 40), idx + label.length + 40);
        expect(
          /\bbeta\b/i.test(nearby),
          `landing copy labels core vertical "${label}" as beta: "${nearby}"`,
        ).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The provable-claims registry — enforced claims only, pointers resolve
// ---------------------------------------------------------------------------

describe("proof registry — shape and hygiene", () => {
  it("has rows, unique kebab/dotted ids, non-empty claims and refs", () => {
    expect(PUBLIC_PROOF_CLAIMS.length).toBeGreaterThan(0);
    const ids = PUBLIC_PROOF_CLAIMS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of PUBLIC_PROOF_CLAIMS) {
      expect(row.id).toMatch(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/);
      expect(row.title.trim().length, row.id).toBeGreaterThan(0);
      expect(row.claim.trim().length, row.id).toBeGreaterThan(0);
      expect(row.enforcement.refs.length, `${row.id} refs`).toBeGreaterThan(0);
      expect(
        PROOF_KIND_LABELS[row.enforcement.kind],
        `${row.id} kind ${row.enforcement.kind}`,
      ).toBeTruthy();
    }
  });

  it("EVERY enforcement pointer resolves to a file on disk (the registry's core contract)", () => {
    const missing: string[] = [];
    for (const row of PUBLIC_PROOF_CLAIMS) {
      for (const ref of row.enforcement.refs) {
        if (!existsSync(join(REPO_ROOT, ref))) missing.push(`${row.id} → ${ref}`);
      }
    }
    expect(
      missing,
      `stale proof-registry enforcement pointers (a public claim lost its enforcement):\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("no row renders as prose-only, and no maturity word appears in a proof claim", () => {
    for (const row of PUBLIC_PROOF_CLAIMS) {
      expect(row.enforcement.kind, row.id).not.toBe("prose-only");
      expect(MATURITY_WORDS.test(row.claim), `${row.id} claim carries a maturity word`).toBe(false);
    }
  });

  it("proofClaimsByCategory covers every row exactly once; proofClaimById round-trips", () => {
    const grouped = proofClaimsByCategory().flatMap((g) => g.claims.map((c) => c.id));
    expect([...grouped].sort()).toEqual(
      PUBLIC_PROOF_CLAIMS.map((c) => c.id).sort(),
    );
    expect(proofClaimById("constitution.hard-stop.no-platform-money-custody")).toBeDefined();
    expect(proofClaimById("nope")).toBeUndefined();
  });
});

describe("proof registry — constitution linkage", () => {
  it("drops nothing: every listed constitution row is machine-enforced at HEAD", () => {
    expect(
      DROPPED_CONSTITUTION_PROOF_IDS,
      "a constitution invariant the public proof page cites lost its automated " +
        "enforcement (or was removed). Restore the enforcement or remove the row " +
        "deliberately — the page must never show an unenforced claim.",
    ).toEqual([]);
  });

  it("constitution-derived rows mirror the invariant verbatim (statement + refs), never prose-only", () => {
    for (const row of PUBLIC_PROOF_CLAIMS) {
      if (!row.constitutionId) continue;
      const inv = invariantById(row.constitutionId);
      expect(inv, `${row.id} cites unknown invariant ${row.constitutionId}`).toBeDefined();
      expect(inv!.enforcement.kind).not.toBe("prose-only");
      expect(row.claim).toBe(inv!.statement);
      expect(row.enforcement.refs).toEqual(inv!.enforcement.refs);
      expect(row.enforcement.kind).toBe(inv!.enforcement.kind);
    }
  });

  it("carries the money-custody hard stop — the flagship public proof (G1.4 brief)", () => {
    const row = proofClaimById("constitution.hard-stop.no-platform-money-custody");
    expect(row).toBeDefined();
    expect(row!.category).toBe("money");
    expect(row!.enforcement.refs).toContain("tests/unit/moneyCustodyHardStop.test.ts");
  });
});

describe("proof registry — audited-verbatim rows sync with the live copy and the CI audit", () => {
  const auditSrc = readFileSync(
    join(REPO_ROOT, "scripts", "audit-public-claims.ts"),
    "utf8",
  );

  it("every auditedVerbatim claim appears verbatim in scripts/audit-public-claims.ts", () => {
    const rows = PUBLIC_PROOF_CLAIMS.filter((c) => c.auditedVerbatim);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(
        auditSrc.includes(row.claim),
        `${row.id}: claim not registered in the truth-engine audit`,
      ).toBe(true);
    }
  });

  it("the wedge row IS the live hero wedge sentence (registry ↔ copy cannot drift)", () => {
    expect(WEDGE_SENTENCE).toBe(LANDING_COPY.hero.wedge);
    expect(proofClaimById("copy.hero-wedge-audited")?.claim).toBe(
      LANDING_COPY.hero.wedge,
    );
  });

  it("the truth-engine audit is actually wired into CI (built AND wired)", () => {
    const ci = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toContain("truth-engine:audit");
    const pkg = readFileSync(join(REPO_ROOT, "package.json"), "utf8");
    expect(pkg).toContain("audit-public-claims.ts");
  });
});

// ---------------------------------------------------------------------------
// 4. Page wiring — the registry renders on /transparency (wave-discipline #3:
//    hunt "built but unwired")
// ---------------------------------------------------------------------------

describe("proof section wiring on /transparency", () => {
  const pageSrc = readFileSync(
    join(REPO_ROOT, "client", "src", "pages", "transparency.tsx"),
    "utf8",
  );

  it("transparency.tsx consumes the registry and anchors the section at #proof", () => {
    expect(pageSrc).toContain("proofClaimsByCategory");
    expect(pageSrc).toContain("PROOF_KIND_LABELS");
    expect(pageSrc).toContain('id="proof"');
    expect(pageSrc).toContain("<ProofSection />");
  });

  it("the section renders outside the report query conditional (static truth, every page state)", () => {
    // ProofSection is invoked after the published/empty/error conditional
    // closes — the registry needs no report to render.
    const invocation = pageSrc.indexOf("<ProofSection />");
    const conditionalClose = pageSrc.lastIndexOf("EmptyState");
    expect(invocation).toBeGreaterThan(conditionalClose);
  });
});
