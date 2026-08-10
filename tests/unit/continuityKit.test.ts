/**
 * continuityKit.test.ts — master-handoff O7 (P5 §6): the deputy break-glass
 * kit is a REAL artifact, its completeness is DERIVED, its freshness
 * ratchets, and the public continuity statement can never outrun either.
 *
 * Deliberately mirrors the house pattern for "a drill artifact with a
 * freshness ratchet" (tests/unit/drDrillFreshness.test.ts over
 * docs/runbooks/dr-drill-history.md) rather than inventing a second
 * mechanism: a markdown artifact CI can parse, a fixture-driven parser proof
 * so the ratchet is only as trusted as its parse, and an honest-dormant
 * zero-state that must keep SAYING it is dormant.
 *
 * Five jobs:
 *  1. PIECE DERIVATION — every piece a deputy needs is enumerated, and its
 *     present/absent state is derived from evidence that cannot be faked by
 *     prose: a file that must resolve on disk, a declaration whose
 *     placeholder value reads ABSENT, or a doc section that must carry real
 *     content. Red-first: an all-placeholder kit with nothing on disk must
 *     derive ZERO present pieces — a missing piece may never render a check.
 *  2. FRESHNESS RATCHET — the kit goes stale after a declared interval.
 *     Fixture-driven (the template line can never count as a review), and
 *     armed on the live ledger the moment the first review block lands.
 *  3. NON-DELEGABLE HARD STOPS — derived from shared/governance/constitution.ts,
 *     never hand-listed, and structurally un-grantable: a proposed deputy
 *     permission naming a hard stop is REFUSED by the derivation itself.
 *  4. FOUNDER SURFACE — the readiness read is actually rendered on the
 *     Controls door and can only reach green through a complete, fresh kit
 *     (built-but-unwired defence + the never-green-unless-proven grammar).
 *  5. PUBLIC CONTINUITY STATEMENT — every claim the /transparency section
 *     makes resolves in shared/governance/public-claims.ts, and the
 *     deputy-arrangement sentence is PINNED to the kit's derived state, so
 *     the page cannot describe a bench the company does not have.
 *
 * idempotent: true — pure parsing + source analysis, no DB, no network.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { readContinuityKit } from "../../server/services/continuityKit";
import { CONSTITUTION } from "../../shared/governance/constitution";
import { proofClaimById } from "../../shared/governance/public-claims";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");

const KIT_DOC = "docs/runbooks/deputy-break-glass-kit.md";
const kit = read(KIT_DOC);
const controls = read("client/src/pages/founder/autopilot-control.tsx");
const routes = read("server/routes-founder-intelligence.ts");
const transparency = read("client/src/pages/transparency.tsx");

/** The live read, judged at a fixed instant so nothing here is time-flaky. */
const live = readContinuityKit();

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * A minimal kit fixture. `declarations` overrides the declaration block;
 * `reviews` are appended as real review blocks. The format template inside
 * the fenced example uses the literal "YYYY-MM-DD", which \d+ can never
 * match — so documenting the format never counts as a review.
 */
function fixtureKit(opts: {
  declarations?: Record<string, string>;
  reviews?: Array<{ date: string; by: string }>;
  sections?: string[];
} = {}): string {
  const decls = {
    "kit-version": "1",
    "deputy-name": "(none named)",
    "deputy-contact": "(none named)",
    "deputy-authority-doc": "(none executed)",
    "credential-custody": "(none provisioned)",
    "founder-emergency-contact": "(none named)",
    ...(opts.declarations ?? {}),
  };
  const sections = (opts.sections ?? []).map((h) => `## ${h}\n\n${"x".repeat(400)}\n`);
  const reviews = (opts.reviews ?? [])
    .map((r) => `${r.date}  reviewed-by=${r.by}\n            pieces-present=1/1  changed: fixture\n`)
    .join("\n");
  return [
    "# Deputy break-glass kit (fixture)",
    "",
    "<!-- continuity-kit:declarations -->",
    "```",
    ...Object.entries(decls).map(([k, v]) => `${k}: ${v}`),
    "```",
    "",
    ...sections,
    "## Review ledger (append-only)",
    "",
    "Format:",
    "",
    "```",
    "YYYY-MM-DD  reviewed-by=<github-login>",
    "```",
    "",
    reviews || "(no reviews recorded yet)",
    "",
  ].join("\n");
}

const NOTHING_ON_DISK = () => false;
const EVERYTHING_ON_DISK = () => true;

/** The doc-section headings the live piece registry requires. */
const REQUIRED_SECTIONS = () =>
  live.pieces
    .filter((p) => p.evidence.kind === "doc-section")
    .map((p) => (p.evidence.kind === "doc-section" ? p.evidence.heading : ""));

/** A kit with every piece in place — the only shape that can reach "ready". */
function completeKit(reviews: Array<{ date: string; by: string }> = []): string {
  return fixtureKit({
    declarations: {
      "deputy-name": "Jane Roe",
      "deputy-contact": "+1-555-0100 / jane@example.com",
      "deputy-authority-doc": "Limited operating authority, executed 2026-01-04",
      "credential-custody": "Password-manager emergency access, 48h delay",
      "founder-emergency-contact": "A. Norton, +1-555-0111",
    },
    sections: REQUIRED_SECTIONS(),
    reviews,
  });
}

// ---------------------------------------------------------------------------
// 0. Substrate — the kit exists and says what it is
// ---------------------------------------------------------------------------

describe("the kit artifact", () => {
  it("exists as a runbook and names the module + test that read it", () => {
    expect(existsSync(path.join(root, KIT_DOC))).toBe(true);
    expect(kit).toContain("server/services/continuityKit.ts");
    expect(kit).toContain("tests/unit/continuityKit.test.ts");
  });

  it("is linked from the runbooks index (a kit nobody can find is not a kit)", () => {
    expect(read("docs/runbooks/_index.md")).toContain("deputy-break-glass-kit.md");
  });

  it("the live read finds the doc and derives, rather than asserting, its state", () => {
    expect(live.docPresent).toBe(true);
    expect(live.docPath).toBe(KIT_DOC);
    expect(live.piecesRequired).toBe(live.pieces.length);
    expect(live.piecesPresent).toBe(live.pieces.filter((p) => p.present).length);
    expect(live.missingPieces.sort()).toEqual(
      live.pieces.filter((p) => !p.present).map((p) => p.key).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 1. Piece derivation — a missing piece renders ABSENT, never a fake check
// ---------------------------------------------------------------------------

describe("piece derivation (fixtures — the derivation is only as honest as its parse)", () => {
  it("an all-placeholder kit with nothing on disk derives ZERO present pieces", () => {
    const r = readContinuityKit({
      docText: fixtureKit(),
      fileExists: NOTHING_ON_DISK,
    });
    expect(r.piecesPresent).toBe(0);
    expect(r.verdict).toBe("incomplete");
    for (const p of r.pieces) {
      expect(p.present, `${p.key} must be absent`).toBe(false);
      expect(p.detail.length, `${p.key} needs an honest absent line`).toBeGreaterThan(0);
      expect(p.fix.length, `${p.key} must say what puts it in place`).toBeGreaterThan(0);
    }
  });

  it("a placeholder declaration is ABSENT; a real value is PRESENT (same field, same parse)", () => {
    const absent = readContinuityKit({
      docText: fixtureKit(),
      fileExists: NOTHING_ON_DISK,
    }).pieces.find((p) => p.evidence.kind === "declaration" && p.evidence.field === "deputy-name");
    expect(absent?.present).toBe(false);

    const named = readContinuityKit({
      docText: fixtureKit({ declarations: { "deputy-name": "Jane Roe" } }),
      fileExists: NOTHING_ON_DISK,
    }).pieces.find((p) => p.evidence.kind === "declaration" && p.evidence.field === "deputy-name");
    expect(named?.present).toBe(true);
    expect(named?.detail).toContain("Jane Roe");
  });

  it("every placeholder spelling the live kit uses reads as absent", () => {
    // Whatever placeholder grammar the doc actually uses must be recognised —
    // an unrecognised placeholder would render as a PRESENT value, which is
    // exactly the fabrication this module exists to prevent.
    const r = readContinuityKit({ docText: kit, fileExists: NOTHING_ON_DISK });
    for (const p of r.pieces) {
      if (p.evidence.kind !== "declaration") continue;
      const raw = p.detail;
      if (!p.present) continue;
      expect(raw).not.toMatch(/^\(/); // a "(none …)" value must never count as present
    }
  });

  it("a file-evidence piece follows the disk, not the prose", () => {
    const off = readContinuityKit({ docText: kit, fileExists: NOTHING_ON_DISK });
    const on = readContinuityKit({ docText: kit, fileExists: EVERYTHING_ON_DISK });
    const fileKeys = live.pieces.filter((p) => p.evidence.kind === "file").map((p) => p.key);
    expect(fileKeys.length).toBeGreaterThan(0);
    for (const key of fileKeys) {
      expect(off.pieces.find((p) => p.key === key)!.present).toBe(false);
      expect(on.pieces.find((p) => p.key === key)!.present).toBe(true);
    }
  });

  it("a doc-section piece needs real content, not just a heading", () => {
    const sectionKeys = live.pieces.filter((p) => p.evidence.kind === "doc-section");
    expect(sectionKeys.length).toBeGreaterThan(0);
    const headings = sectionKeys.map((p) =>
      p.evidence.kind === "doc-section" ? p.evidence.heading : "",
    );
    const stub = readContinuityKit({
      // headings present, but each section is empty
      docText: fixtureKit({ sections: [] }) + headings.map((h) => `\n## ${h}\n\n`).join(""),
      fileExists: NOTHING_ON_DISK,
    });
    for (const p of sectionKeys) {
      expect(stub.pieces.find((x) => x.key === p.key)!.present, `${p.key} stub`).toBe(false);
    }
    const filled = readContinuityKit({
      docText: fixtureKit({ sections: headings }),
      fileExists: NOTHING_ON_DISK,
    });
    for (const p of sectionKeys) {
      expect(filled.pieces.find((x) => x.key === p.key)!.present, `${p.key} filled`).toBe(true);
    }
  });

  it("a missing kit document is 'no-kit', not an empty green", () => {
    const r = readContinuityKit({ docText: null });
    expect(r.docPresent).toBe(false);
    expect(r.verdict).toBe("no-kit");
    expect(r.piecesPresent).toBe(0);
    expect(r.pieces.every((p) => !p.present)).toBe(true);
    expect(r.headline).toMatch(/not readable|missing/i);
  });

  it("the no-kit copy names the REAL cause (docs/ is excluded from the image)", () => {
    // The deployed server genuinely cannot read docs/ — the same reason the
    // break-glass card email refuses in production. Saying only "missing"
    // would read as "someone deleted the kit", a different and worse claim,
    // and would train the founder to ignore a permanently red card.
    const r = readContinuityKit({ docText: null });
    expect(r.headline).toMatch(/docs\//);
    expect(r.headline).toContain("tests/unit/continuityKit.test.ts");
    // …and .dockerignore really does exclude docs/, so that copy is TRUE.
    // If docs/ ever ships in the image, this fails and the copy must change.
    const dockerignore = read(".dockerignore")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(dockerignore).toContain("docs/");
    expect(dockerignore.some((l) => l.startsWith("!docs"))).toBe(false);
  });
});

describe("piece derivation (live kit) — the gaps are counted, not hidden", () => {
  it("the deputy-identity pieces are absent until a founder names one (today: absent)", () => {
    // This assertion is DERIVED, not pinned to a snapshot: it says the read
    // and the doc agree. When a deputy is really named, the doc changes and
    // this stays true — while the public copy check below forces the
    // /transparency sentence to change in the same commit.
    const deputy = live.pieces.find((p) => p.key === "deputy-named")!;
    expect(deputy).toBeDefined();
    expect(deputy.present).toBe(
      !/deputy-name:\s*\(/.test(kit),
    );
  });

  it("the runbook pieces that DO exist are present (the kit is not vacuously empty)", () => {
    expect(live.piecesPresent).toBeGreaterThan(0);
    expect(live.piecesPresent).toBeLessThanOrEqual(live.piecesRequired);
  });

  it("the headline never claims readiness the pieces do not support", () => {
    if (live.verdict !== "ready") {
      expect(live.headline).not.toMatch(/\bready\b/i);
    }
    if (live.missingPieces.length > 0) {
      expect(live.verdict).toBe("incomplete");
      expect(live.headline).toMatch(/\d+ of \d+/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The freshness ratchet (mirrors drDrillFreshness over dr-drill-history.md)
// ---------------------------------------------------------------------------

describe("freshness ratchet (fixtures)", () => {
  it("a ledger with only the format template parses ZERO reviews", () => {
    const r = readContinuityKit({ docText: fixtureKit(), fileExists: EVERYTHING_ON_DISK });
    expect(r.lastReviewedAt).toBeNull();
    expect(r.reviewAgeDays).toBeNull();
    expect(r.freshness).toBe("never-reviewed");
    expect(r.verdict).not.toBe("ready");
  });

  it("judges by the NEWEST block and goes stale past the declared interval", () => {
    const interval = live.reviewIntervalDays;
    expect(interval).toBeGreaterThan(0);

    // Judged by the NEWEST block: an ancient review alongside a recent one
    // must not drag the kit stale.
    const fresh = readContinuityKit({
      docText: completeKit([
        { date: isoDaysAgo(interval - 10), by: "thmsnrtn" },
        { date: isoDaysAgo(interval + 400), by: "thmsnrtn" },
      ]),
      fileExists: EVERYTHING_ON_DISK,
    });
    expect(fresh.reviewAgeDays).toBe(interval - 10);
    expect(fresh.freshness).toBe("fresh");
    expect(fresh.lastReviewedBy).toBe("thmsnrtn");

    const stale = readContinuityKit({
      docText: completeKit([{ date: isoDaysAgo(interval + 1), by: "thmsnrtn" }]),
      fileExists: EVERYTHING_ON_DISK,
    });
    expect(stale.freshness).toBe("stale");
    expect(stale.verdict).toBe("stale");
    expect(stale.headline).toMatch(/stale|past the/i);

    // One day earlier is still inside the interval — the boundary is exact.
    const edge = readContinuityKit({
      docText: completeKit([{ date: isoDaysAgo(interval), by: "thmsnrtn" }]),
      fileExists: EVERYTHING_ON_DISK,
    });
    expect(edge.freshness).toBe("fresh");
  });

  it("a complete + fresh kit is the ONLY path to 'ready'", () => {
    const complete = readContinuityKit({
      docText: completeKit([{ date: isoDaysAgo(1), by: "thmsnrtn" }]),
      fileExists: EVERYTHING_ON_DISK,
    });
    expect(complete.missingPieces).toEqual([]);
    expect(complete.freshness).toBe("fresh");
    expect(complete.verdict).toBe("ready");

    // …and removing any single ingredient takes "ready" away. Each of the
    // three evidence kinds is exercised: a declaration, a file, a section.
    const noDeputy = readContinuityKit({
      docText: completeKit([{ date: isoDaysAgo(1), by: "thmsnrtn" }]).replace(
        "deputy-name: Jane Roe",
        "deputy-name: (none named)",
      ),
      fileExists: EVERYTHING_ON_DISK,
    });
    expect(noDeputy.verdict).toBe("incomplete");

    const noRunbooks = readContinuityKit({
      docText: completeKit([{ date: isoDaysAgo(1), by: "thmsnrtn" }]),
      fileExists: NOTHING_ON_DISK,
    });
    expect(noRunbooks.verdict).toBe("incomplete");

    const noSections = readContinuityKit({
      docText: fixtureKit({
        declarations: {
          "deputy-name": "Jane Roe",
          "deputy-contact": "+1-555-0100",
          "deputy-authority-doc": "Executed 2026-01-04",
          "credential-custody": "Emergency access provisioned",
          "founder-emergency-contact": "A. Norton",
        },
        reviews: [{ date: isoDaysAgo(1), by: "thmsnrtn" }],
      }),
      fileExists: EVERYTHING_ON_DISK,
    });
    expect(noSections.verdict).toBe("incomplete");

    // Complete but never reviewed is NOT ready either.
    const unreviewed = readContinuityKit({
      docText: completeKit(),
      fileExists: EVERYTHING_ON_DISK,
    });
    expect(unreviewed.verdict).toBe("unreviewed");
  });
});

describe("freshness ratchet (live kit)", () => {
  const reviewDates = [...kit.matchAll(/^(\d{4}-\d{2}-\d{2})\s+reviewed-by=/gm)].map((m) => m[1]);

  it("the doc documents the parseable-block contract this ratchet enforces", () => {
    expect(kit).toMatch(/reviewed-by=<github-login>/);
    expect(kit).toContain("tests/unit/continuityKit.test.ts");
  });

  it("the doc states the SAME review interval the module enforces (no drift)", () => {
    expect(kit).toContain(`${live.reviewIntervalDays}`);
    expect(kit).toMatch(new RegExp(`${live.reviewIntervalDays}\\s*(?:-|\\s)?day`, "i"));
  });

  if (reviewDates.length === 0) {
    it("zero reviews: the ledger still HONESTLY says so, and nothing renders ready", () => {
      expect(kit).toMatch(/no reviews recorded yet/i);
      expect(live.freshness).toBe("never-reviewed");
      expect(live.verdict).not.toBe("ready");
    });
  } else {
    it(`the newest review block must be ≤ ${live.reviewIntervalDays} days old`, () => {
      const age = live.reviewAgeDays!;
      expect(
        age,
        `The newest continuity-kit review is ${age} days old — over the ` +
          `${live.reviewIntervalDays}-day interval. Walk ${KIT_DOC} end to end, ` +
          `correct whatever has drifted, and append a new review block.`,
      ).toBeLessThanOrEqual(live.reviewIntervalDays);
    });

    it("first review recorded: the no-reviews-yet placeholder must be gone", () => {
      expect(kit).not.toMatch(/no reviews recorded yet/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. The hard stops stay founder-only — structurally, not by good intentions
// ---------------------------------------------------------------------------

describe("non-delegable hard stops", () => {
  const constitutionalHardStops = CONSTITUTION.filter((i) => i.category === "hard-stop");

  it("the non-delegable list is DERIVED from the constitution, not hand-listed", () => {
    expect(live.nonDelegable.map((h) => h.id).sort()).toEqual(
      constitutionalHardStops.map((i) => i.id).sort(),
    );
    expect(live.nonDelegable.length).toBeGreaterThan(0);
  });

  it("carries the four forever-founder-only stops by name", () => {
    for (const id of [
      "hard-stop.pricing-changes",
      "hard-stop.legal-signing",
      "hard-stop.spend-over-500",
      "hard-stop.customer-data-deletion",
    ]) {
      expect(live.nonDelegable.map((h) => h.id)).toContain(id);
    }
  });

  it("NO deputy-permitted action names a hard stop", () => {
    for (const action of live.deputyPermitted) {
      for (const h of live.nonDelegable) {
        expect(
          action.hardStopsTouched ?? [],
          `deputy action "${action.key}" must not touch ${h.id}`,
        ).not.toContain(h.id);
      }
    }
  });

  it("no permitted action's WORDS imply a hard-stop act either (second net)", () => {
    const forbidden =
      /\b(chang\w* (?:the )?pric|pricing chang|sign (?:a |the )?(?:contract|agreement)|execute (?:a |the )?contract|delete (?:customer|org|all) data|purge)\b/i;
    for (const action of live.deputyPermitted) {
      expect(
        forbidden.test(`${action.what} ${action.key}`),
        `deputy action "${action.key}" reads like a hard-stop act: ${action.what}`,
      ).toBe(false);
    }
  });

  it("the SHIPPED permission list is clean by construction — nothing of ours is refused", () => {
    // The filter neutralises a hard-stop permission silently, which is the
    // right runtime behaviour but the wrong review behaviour: a built-in
    // permission that had to be filtered means someone tried to delegate a
    // hard stop and the attempt vanished quietly. Make that loud instead.
    expect(
      live.deputyRefused,
      "a built-in deputy permission was refused for touching a hard stop — " +
        "remove it from DEPUTY_ACTIONS rather than leaving it to be filtered",
    ).toEqual([]);
    expect(live.deputyPermitted.length).toBeGreaterThan(0);
  });

  it("REFUSES a proposed permission that names a hard stop (red-first: the filter is real)", () => {
    const r = readContinuityKit({
      proposedDeputyActions: [
        {
          key: "fixture.approve-a-discount",
          what: "Approve a pricing exception to save a churning account",
          hardStopsTouched: ["hard-stop.pricing-changes"],
        },
        {
          key: "fixture.restart-a-machine",
          what: "Restart a stopped Fly machine",
        },
      ],
    });
    expect(r.deputyRefused.map((a) => a.key)).toContain("fixture.approve-a-discount");
    expect(r.deputyPermitted.map((a) => a.key)).not.toContain("fixture.approve-a-discount");
    expect(r.deputyRefused.find((a) => a.key === "fixture.approve-a-discount")!.refusedBecause)
      .toMatch(/hard-stop\.pricing-changes/);
    // …and a clean proposal still passes, so the filter is not a blanket no.
    expect(r.deputyPermitted.map((a) => a.key)).toContain("fixture.restart-a-machine");
  });

  it("the kit doc names EVERY constitutional hard stop (derived — a new one fails this)", () => {
    for (const h of constitutionalHardStops) {
      expect(kit, `${KIT_DOC} must list ${h.id} as non-delegable`).toContain(h.id);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The founder surface — wired, and never green without proof
// ---------------------------------------------------------------------------

describe("Controls door — 'If you cannot be reached' section", () => {
  const start = controls.indexOf("// ── Continuity — the deputy break-glass kit");
  const section = controls.slice(start);

  it("the section exists and is actually RENDERED (built-but-unwired defence)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(controls).toContain("<ContinuityKitSection />");
  });

  it("reads the real endpoint — the fetch is not decorative", () => {
    expect(section).toContain('fetch("/api/founder/intelligence/continuity-kit"');
  });

  it("the ONLY path to green is the server's 'ready' verdict", () => {
    const toneFn = section.slice(
      section.indexOf("function continuityTone"),
      section.indexOf("function ContinuityKitSection"),
    );
    expect(toneFn.match(/return "ready"/g)).toHaveLength(1);
    expect(toneFn).toContain('k.verdict === "ready"');
  });

  it("an absent piece renders as absent — no unconditional check mark", () => {
    expect(section).toMatch(/p\.present \?/);
    expect(section).toContain("Not in place");
    expect(section).not.toContain("✓");
  });

  it("staleness is visible on the founder surface, not only in CI", () => {
    expect(section).toMatch(/stale/i);
    expect(section).toMatch(/reviewIntervalDays/);
  });
});

describe("the endpoint", () => {
  const idx = routes.indexOf('"/continuity-kit"');

  it("GET /api/founder/intelligence/continuity-kit exists and is founder-gated", () => {
    expect(idx).toBeGreaterThan(-1);
    const handler = routes.slice(routes.lastIndexOf("router.get", idx), idx + 2500);
    expect(handler).toContain("requireFounder");
    expect(handler).toContain("readContinuityKit");
  });

  it("uses the house error helper, never a raw res.status().json()", () => {
    const handler = routes.slice(idx, idx + 2500);
    expect(handler).toContain("Errors.internal");
  });
});

// ---------------------------------------------------------------------------
// 5. The public continuity statement — every claim registered, state pinned
// ---------------------------------------------------------------------------

describe("/transparency — the continuity statement", () => {
  const start = transparency.indexOf("function ContinuitySection");
  const section = transparency.slice(start, transparency.indexOf("export default function"));

  it("the section exists, is anchored, and is rendered in every page state", () => {
    expect(start).toBeGreaterThan(-1);
    expect(transparency).toContain('id="continuity"');
    expect(transparency).toContain("<ContinuitySection />");
    // Rendered after the report conditional closes — no report, still shown.
    expect(transparency.indexOf("<ContinuitySection />")).toBeGreaterThan(
      transparency.lastIndexOf("EmptyState"),
    );
  });

  it("EVERY claim it makes resolves in the public-claims registry", () => {
    const listSrc = transparency.slice(
      transparency.indexOf("const CONTINUITY_CLAIM_IDS"),
      transparency.indexOf("function ContinuitySection"),
    );
    const ids = [...listSrc.matchAll(/"([a-z0-9]+(?:[.-][a-z0-9]+)*)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(2);
    for (const id of ids) {
      const row = proofClaimById(id);
      expect(row, `/transparency continuity claim "${id}" is not registered`).toBeDefined();
      expect(row!.enforcement.kind).not.toBe("prose-only");
      for (const ref of row!.enforcement.refs) {
        expect(existsSync(path.join(root, ref)), `${id} → ${ref}`).toBe(true);
      }
    }
    // The section renders FROM the registry — it cannot hand-write a claim.
    expect(section).toContain("proofClaimById");
  });

  it("the three continuity rows this slice registered are the enforced kind", () => {
    for (const id of [
      "continuity.hard-stops-stay-founder-only",
      "continuity.kit-state-derived",
      "continuity.kit-review-ratchet",
    ]) {
      const row = proofClaimById(id);
      expect(row, `${id} must exist in public-claims.ts`).toBeDefined();
      expect(row!.enforcement.refs).toContain("tests/unit/continuityKit.test.ts");
    }
  });

  it("the review-interval claim states the interval the module actually enforces", () => {
    const row = proofClaimById("continuity.kit-review-ratchet")!;
    expect(row.claim).toContain(String(live.reviewIntervalDays));
  });

  it("that claim's dormancy scope note cannot outlive the first recorded review", () => {
    // The note publicly scopes the ratchet as dormant ("no review has been
    // recorded yet"). The moment one IS recorded that sentence becomes false
    // on a public page — the exact staleness class this registry exists to
    // prevent, so derive the check from the kit rather than trusting the note.
    const row = proofClaimById("continuity.kit-review-ratchet")!;
    const claimsDormant = /no review has been recorded yet/i.test(row.enforcement.note ?? "");
    expect(
      claimsDormant,
      "a review is now recorded in the kit — update the continuity.kit-review-ratchet " +
        "scope note in shared/governance/public-claims.ts, which still says none is",
    ).toBe(live.freshness === "never-reviewed");
  });

  it("the review clause states the POLICY, never an unearned practice", () => {
    // Fleet-9 verifier catch (BLOCKING): the public sentence asserted the kit
    // "is reviewed on a fixed interval" in the present tense as an ongoing
    // practice, while the kit has never had a single recorded review — the
    // exact fabrication class this whole page exists to refuse. Derive the
    // required wording from the kit's real freshness so it cannot go stale
    // in either direction.
    const lineSrc = transparency.slice(
      transparency.indexOf("const DEPUTY_ARRANGEMENT_TODAY"),
      transparency.indexOf("const CONTINUITY_CLAIM_IDS"),
    );
    if (live.freshness === "never-reviewed") {
      expect(
        lineSrc,
        "no review is recorded — the page must say so, not imply a review practice",
      ).toMatch(/has not yet had its first recorded review/i);
      expect(lineSrc).not.toMatch(/is reviewed on a fixed interval/i);
    } else {
      expect(
        lineSrc,
        "a review is now recorded — update the /transparency clause to the new truth",
      ).not.toMatch(/has not yet had its first recorded review/i);
    }
    // Either way the declared interval must match what the module enforces.
    expect(lineSrc).toContain(String(live.reviewIntervalDays));
  });

  it("the deputy-arrangement sentence is PINNED to the kit's derived state", () => {
    const deputyNamed = live.pieces.find((p) => p.key === "deputy-named")!.present;
    const lineSrc = transparency.slice(
      transparency.indexOf("const DEPUTY_ARRANGEMENT_TODAY"),
      transparency.indexOf("const CONTINUITY_CLAIM_IDS"),
    );
    expect(lineSrc.length).toBeGreaterThan(0);
    if (deputyNamed) {
      expect(
        lineSrc,
        "a deputy is now named in the kit — rewrite the /transparency sentence to say so",
      ).not.toMatch(/No deputy is named/i);
    } else {
      expect(
        lineSrc,
        "no deputy is named in the kit — /transparency must say so plainly, never imply one",
      ).toMatch(/No deputy is named/i);
    }
  });

  it("the public statement never promises a rescue the code cannot back", () => {
    // Refuse-not-fabricate on a sales-sensitive page: no uptime/continuity
    // guarantee language, no claim that someone else will take over.
    expect(section).not.toMatch(/guarantee[ds]?\b/i);
    expect(section).not.toMatch(/\b24\/7\b/);
    expect(section).not.toMatch(/will (?:keep|continue) (?:running|operating) (?:indefinitely|forever)/i);
  });
});

// ─── Fleet-9 verifier catches — each fix pinned ─────────────────────────────

describe("fleet-9 catch — the Controls card measures before it reports", () => {
  const card = read("client/src/pages/founder/autopilot-control.tsx");

  it("an unreadable kit says so, instead of '0 of N pieces in place'", () => {
    // The deployed image excludes docs/ (.dockerignore), so in production
    // readContinuityKit() returns the no-kit branch and every piece comes
    // back absent. Rendering a 0-of-N count there — plus N red rows — states
    // twelve measurements that were never taken.
    expect(card).toContain('k.verdict === "no-kit"');
    expect(card).toContain("Readiness can't be read from here");
    // …and the per-piece list is suppressed in that state.
    expect(card).toMatch(/k\.verdict === "no-kit" \? "hidden" : ""/);
  });

  it("the vacation-drill line is DERIVED from the kit, not hardcoded", () => {
    // A hardcoded "has not been run" goes stale the moment one is run.
    expect(card).toContain("k.lastVacationDrill");
    expect(card).not.toMatch(/vacation test is a founder act and has not been run/);
    const svc = read("server/services/continuityKit.ts");
    expect(svc).toMatch(/lastVacationDrill: string \| null;/);
    // NONE (any case) parses to null — honest absence, not a date.
    expect(svc).toMatch(/\/\^none\\b\/i\.test\(vacationRaw\)/);
  });

  it("the live kit records no drill today, and the payload says so", () => {
    // Current truth, derived. When a drill IS recorded this flips and the
    // pin must be rewritten to the new truth, not deleted.
    expect(live.lastVacationDrill).toBeNull();
  });
});
