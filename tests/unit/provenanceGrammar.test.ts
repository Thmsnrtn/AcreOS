// @vitest-environment jsdom
/**
 * Wave 2.4 + 2.6 — the provenance/freshness GRAMMAR and the
 * DISCLAIMER-COVERAGE lint.
 *
 * Three halves, each falsifiable at the pre-wave HEAD (b2e92be):
 *
 *  1. GRAMMAR — client/src/lib/provenance.ts. `describeProvenance()` renders
 *     source + vintage + retrieval from REAL fields, and states an HONEST
 *     ABSENCE when either is unknown instead of hiding or guessing. Both
 *     components (`DataProvenanceChip`, `DataProvenanceTag`) are mounted in
 *     jsdom and asserted to speak the SAME sentence — before this wave they
 *     each built their own, and used the same prop name `asOf` for two
 *     different facts.
 *
 *  2. LINT BITES — scripts/lint-disclaimer-coverage.mjs. Its pure core is run
 *     against a fixture tree containing one advice-shaped surface with no
 *     RequiredDisclaimer, and the CLI is executed end-to-end against the same
 *     fixture to prove the gate really exits non-zero. The config loader is
 *     asserted to refuse an allowlist entry with no substantive reason.
 *
 *  3. ADOPTION SOURCE-PINS — the migrated files are read from disk. The pins
 *     are written against source truth in BOTH directions: the fabricated
 *     freshness stamp must be GONE and the real one must be PRESENT, and no
 *     provenance sentence may be assembled outside the grammar.
 *
 * Falsifiability at HEAD: client/src/lib/provenance.ts,
 * scripts/lint-disclaimer-coverage.mjs and
 * scripts/ratchets/disclaimer-coverage.json did not exist; comps-analysis.tsx
 * stamped `asOf={new Date().toISOString()}` and rendered no disclaimer. Halves
 * 1–3 all fail there.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  describeProvenance,
  provenanceTone,
  provenanceToneVar,
  PROVENANCE_UNKNOWN_FRESHNESS,
  PROVENANCE_UNKNOWN_SOURCE,
  type ProvenanceDescription,
  type ProvenanceTone,
} from "../../client/src/lib/provenance";
import { DataProvenanceChip } from "../../client/src/components/data-provenance-chip";
import { DataProvenanceTag } from "../../client/src/components/data-provenance-tag";
import { TooltipProvider } from "../../client/src/components/ui/tooltip";
import {
  detectAdviceFamilies,
  loadConfig,
  scanDisclaimerCoverage,
  DISCLAIMER_SYMBOL,
} from "../../scripts/lint-disclaimer-coverage.mjs";

const REPO_ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

/**
 * Source with comment lines removed — the same rule scripts/ratchet.mjs uses
 * so documentation that MENTIONS a pattern doesn't count as an occurrence of
 * it. Every "this string must be GONE" pin below runs against this, because
 * the files deliberately document the idioms they replaced.
 */
const readCode = (rel: string) =>
  read(rel)
    // JSX comment blocks too — several migrated call sites quote the exact
    // idiom they replaced, and quoting it must not count as still doing it.
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

// Fixed clock so relative phrasing is deterministic.
const NOW = new Date("2026-08-10T12:00:00Z").getTime();
const THREE_DAYS_AGO = new Date("2026-08-07T12:00:00Z").toISOString();

// ─── jsdom mount helper (repo pattern — doorErrorStates.test.tsx) ────────────

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

function mount(ui: ReactElement): HTMLDivElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(createElement(TooltipProvider, null, ui));
  });
  return container;
}

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

// ════════════════════════════════════════════════════════════════════════════
// 1. THE GRAMMAR
// ════════════════════════════════════════════════════════════════════════════

describe("provenance grammar — source + freshness from real fields", () => {
  it("names the source, its vintage and our retrieval time, each from its own field", () => {
    const d = describeProvenance(
      {
        source: "FEMA NFHL",
        sourceAsOf: "2024-03-11T00:00:00Z",
        retrievedAt: THREE_DAYS_AGO,
        confidence: 82,
        classification: "authoritative",
      },
      NOW,
    );

    expect(d.sourceKnown).toBe(true);
    expect(d.vintageKnown).toBe(true);
    expect(d.retrievalKnown).toBe(true);
    expect(d.absent).toBeNull();
    expect(d.line).toBe("FEMA NFHL · as of 2024 · retrieved 3d ago · 82%");
    expect(d.aria).toContain("Source: FEMA NFHL");
    expect(d.aria).toContain("82 percent confidence");
  });

  it("keeps SOURCE VINTAGE and RETRIEVAL TIME as separate facts", () => {
    // The whole reason the two dialects were merged: `asOf` meant the source's
    // vintage in one component and our fetch time in the other. Knowing one
    // must never be reported as knowing the other.
    const vintageOnly = describeProvenance(
      { source: "County assessor", sourceAsOf: "2019-06-01" },
      NOW,
    );
    expect(vintageOnly.vintageKnown).toBe(true);
    expect(vintageOnly.retrievalKnown).toBe(false);
    expect(vintageOnly.line).toBe("County assessor · as of 2019");
    expect(vintageOnly.line).not.toContain("retrieved");

    const retrievalOnly = describeProvenance(
      { source: "County assessor", retrievedAt: THREE_DAYS_AGO },
      NOW,
    );
    expect(retrievalOnly.vintageKnown).toBe(false);
    expect(retrievalOnly.line).toBe("County assessor · retrieved 3d ago");
    expect(retrievalOnly.line).not.toContain("as of");
  });

  it("renders event-date vintage at day precision when the caller asks for it", () => {
    const d = describeProvenance(
      { source: "County records", sourceAsOf: "2024-03-12", vintagePrecision: "day" },
      NOW,
    );
    expect(d.vintageText).toBe("Mar 12, 2024");
  });
});

describe("provenance grammar — honest absence", () => {
  it("states an unknown source rather than rendering nothing", () => {
    const d = describeProvenance({ source: null, retrievedAt: THREE_DAYS_AGO }, NOW);
    expect(d.sourceKnown).toBe(false);
    expect(d.sourceText).toBe(PROVENANCE_UNKNOWN_SOURCE);
    expect(d.line.startsWith(PROVENANCE_UNKNOWN_SOURCE)).toBe(true);
    expect(d.absent).toBe("No source is recorded for this figure.");
    expect(d.tone).toBe("neutral");
  });

  it("states an unknown age rather than letting a bare source read as current", () => {
    const d = describeProvenance({ source: "Regrid" }, NOW);
    expect(d.freshnessKnown).toBe(false);
    expect(d.line).toBe(`Regrid · ${PROVENANCE_UNKNOWN_FRESHNESS}`);
    expect(d.absent).toBe(
      "No source vintage or retrieval time is recorded for this figure.",
    );
  });

  it("reports BOTH absences when nothing at all is known", () => {
    const d = describeProvenance({}, NOW);
    expect(d.line).toBe(PROVENANCE_UNKNOWN_SOURCE);
    expect(d.absent).toBe(
      "No source and no retrieval time are recorded for this figure.",
    );
  });

  it("treats epoch 0 as unknown, not as 1970", () => {
    // react-query reports `dataUpdatedAt: 0` for placeholder data. Formatting
    // it would claim the figure was retrieved 56 years ago.
    const d = describeProvenance({ source: "AcreOS comp analysis", retrievedAt: 0 }, NOW);
    expect(d.retrievalKnown).toBe(false);
    expect(d.line).toBe(`AcreOS comp analysis · ${PROVENANCE_UNKNOWN_FRESHNESS}`);
    expect(d.line).not.toContain("1970");
  });

  it("never invents a relative time from an unparseable retrieval value", () => {
    const d = describeProvenance({ source: "X", retrievedAt: "not-a-date" }, NOW);
    expect(d.retrievalText).toBeNull();
    expect(d.line).not.toContain("—");
  });

  it("passes a provider's own pre-formatted vintage label through verbatim", () => {
    const d = describeProvenance({ source: "USDA SSURGO", sourceAsOf: "FY2023-24" }, NOW);
    expect(d.vintageText).toBe("FY2023-24");
  });
});

describe("provenance grammar — tone is semantic and token-resolved", () => {
  it("treats a modeled/estimate value as caution regardless of its confidence", () => {
    expect(provenanceTone({ source: "X", classification: "modeled", confidence: 99 })).toBe(
      "caution",
    );
    expect(provenanceTone({ source: "X", classification: "estimate", confidence: 99 })).toBe(
      "caution",
    );
  });

  it("never reports an unsourced figure as positive", () => {
    expect(provenanceTone({ source: null, confidence: 100 })).toBe("neutral");
  });

  it("resolves every tone to a CSS custom property, never a literal color", () => {
    const tones: ProvenanceTone[] = ["positive", "caution", "negative", "info", "neutral"];
    for (const tone of tones) {
      const v = provenanceToneVar(tone);
      expect(v.startsWith("var(--")).toBe(true);
      expect(v).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });
});

describe("provenance grammar — composes with stale-while-error, does not fork it", () => {
  it("never emits the stale-cache chip's sentence", () => {
    // lib/stale-while-error.tsx owns "Showing data from {time}" — that is about
    // the CLIENT CACHE after a failed refetch. This grammar is about the
    // UPSTREAM RECORD. Two questions, two vocabularies, no overlap.
    const samples: ProvenanceDescription[] = [
      describeProvenance({ source: "A", retrievedAt: THREE_DAYS_AGO }, NOW),
      describeProvenance({ source: null }, NOW),
      describeProvenance({ source: "B", sourceAsOf: "2024" }, NOW),
    ];
    for (const d of samples) {
      expect(d.line).not.toContain("Showing data from");
      expect(d.line).not.toContain("previously loaded");
    }
    // Composes with it, does not import it: the grammar has no dependency on
    // the stale-cache primitive (and this wave never edits that file).
    expect(readCode("client/src/lib/provenance.ts")).not.toContain(
      "@/lib/stale-while-error",
    );
  });

  it("speaks the same relative-time dialect as the rest of the client", () => {
    // House rule: human-facing dates go through lib/format. The grammar uses
    // formatRelative, so "3d ago" here reads identically to "3d ago" anywhere
    // else — and scripts/lint-date-format.mjs stays green.
    const src = readCode("client/src/lib/provenance.ts");
    expect(src).toContain('from "@/lib/format"');
    expect(src).not.toContain(".toLocaleDateString(");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1b. THE COMPONENT PAIR — one grammar, two presentations
// ════════════════════════════════════════════════════════════════════════════

describe("component pair renders the grammar identically", () => {
  const props = {
    source: "FEMA NFHL",
    retrievedAt: THREE_DAYS_AGO,
    classification: "authoritative" as const,
  };

  it("the chip renders the grammar's line, and the full sentence for AT", () => {
    const el = mount(createElement(DataProvenanceChip, { ...props, sourceAsOf: "2024" }));
    const chip = el.querySelector('[data-testid="data-provenance-chip"]')!;
    expect(chip).toBeTruthy();
    const line = chip.querySelector('[data-testid="data-provenance-chip-line"]')!;
    expect(line.textContent).toContain("FEMA NFHL");
    expect(line.textContent).toContain("as of 2024");
    expect(line.textContent).toContain("retrieved");
    // The visible line is abbreviated and hidden from AT; the sr-only span
    // carries the unabbreviated sentence. `aria-label` on a plain span is not
    // a valid accessible name, so the provenance must not depend on one.
    expect(line.getAttribute("aria-hidden")).toBe("true");
    const sr = chip.querySelector('[data-testid="data-provenance-chip-sr"]')!;
    expect(sr.textContent).toContain("Source: FEMA NFHL");
    expect(sr.className).toContain("sr-only");
  });

  it("the tag renders the SAME line as the chip for the same facts", () => {
    const chipEl = mount(createElement(DataProvenanceChip, props));
    const chipText = chipEl
      .querySelector('[data-testid="data-provenance-chip-line"]')!
      .textContent!.trim();
    act(() => root!.unmount());
    root = null;
    container?.remove();

    const tagEl = mount(createElement(DataProvenanceTag, props));
    const tagText = tagEl
      .querySelector('[data-testid="data-provenance-tag-line"]')!
      .textContent!.trim();
    expect(tagText).toBe(chipText);
  });

  it("the chip STATES an unknown source by default", () => {
    const el = mount(createElement(DataProvenanceChip, { source: null }));
    const chip = el.querySelector('[data-testid="data-provenance-chip"]');
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toContain(PROVENANCE_UNKNOWN_SOURCE);
    expect(chip!.getAttribute("data-provenance-absent")).toBe("true");
    // The reason is spoken, not just implied by a missing chip.
    expect(
      chip!.querySelector('[data-testid="data-provenance-chip-sr"]')!.textContent,
    ).toContain("No source and no retrieval time are recorded for this figure.");
  });

  it('hides only when explicitly told the page states the absence itself', () => {
    const el = mount(
      createElement(DataProvenanceChip, { source: null, whenUnknown: "hide" }),
    );
    expect(el.querySelector('[data-testid="data-provenance-chip"]')).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. THE DISCLAIMER-COVERAGE LINT BITES
// ════════════════════════════════════════════════════════════════════════════

const ADVICE_FIXTURE = `
import { Card } from "@/components/ui/card";
import { usd } from "@/lib/format";

export function OfferAdvicePage({ value }: { value: number }) {
  return (
    <Card>
      <h2>Estimated market value</h2>
      <p>{usd(value)}</p>
      <p>Suggested offer: {usd(value * 0.65)}</p>
    </Card>
  );
}
`;

const DISCLAIMER_PANEL = `
export function AdvicePanel() {
  return <RequiredDisclaimer type="valuation" />;
}
`;

function makeFixtureTree(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "disclaimer-cov-"));
  fs.mkdirSync(path.join(dir, "client/src/pages"), { recursive: true });
  fs.mkdirSync(path.join(dir, "client/src/components"), { recursive: true });
  fs.writeFileSync(path.join(dir, "client/src/pages/offer-advice.tsx"), ADVICE_FIXTURE);
  return dir;
}

describe("disclaimer-coverage lint — derives the advice-shaped set and bites", () => {
  let fixtureRoot: string;

  beforeEach(() => {
    fixtureRoot = makeFixtureTree();
  });

  afterEach(() => {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("flags an advice surface with no disclaimer", () => {
    const r = scanDisclaimerCoverage({ root: fixtureRoot });
    expect(r.candidates.map((c: { file: string }) => c.file)).toEqual([
      "client/src/pages/offer-advice.tsx",
    ]);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0].families.sort()).toEqual(["offer", "valuation"]);
  });

  it("counts a surface as covered through a component it imports", () => {
    fs.writeFileSync(
      path.join(fixtureRoot, "client/src/components/advice-panel.tsx"),
      DISCLAIMER_PANEL,
    );
    fs.writeFileSync(
      path.join(fixtureRoot, "client/src/pages/offer-advice.tsx"),
      `import { AdvicePanel } from "@/components/advice-panel";\n${ADVICE_FIXTURE}`,
    );
    const r = scanDisclaimerCoverage({ root: fixtureRoot });
    expect(r.missing).toHaveLength(0);
    expect(r.covered[0].coveredVia).toBe("client/src/components/advice-panel.tsx");
  });

  it("does not flag a surface that merely names the concept without printing a figure", () => {
    fs.writeFileSync(
      path.join(fixtureRoot, "client/src/pages/offer-advice.tsx"),
      `export function Glossary() {\n  return <dt>Estimated market value</dt>;\n}\n`,
    );
    expect(scanDisclaimerCoverage({ root: fixtureRoot }).candidates).toHaveLength(0);
    // …and route literals / imports are not advice either.
    expect(detectAdviceFamilies('import X from "@/pages/avm";\nusd(1)')).toEqual([]);
    expect(detectAdviceFamilies('const r = "/dodd-frank-checker"; usd(1);')).toEqual([]);
  });

  it("FAILS end-to-end when the fixture tree exceeds its baseline", () => {
    const script = path.join(REPO_ROOT, "scripts/lint-disclaimer-coverage.mjs");
    let code = 0;
    let out = "";
    try {
      out = execFileSync(
        process.execPath,
        [script, "--root", fixtureRoot, "--baseline", "0"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      code = e.status;
      out = `${e.stdout}${e.stderr}`;
    }
    expect(code).toBe(1);
    expect(out).toContain("UNCOVERED client/src/pages/offer-advice.tsx");
    expect(out).toContain(DISCLAIMER_SYMBOL);
    // The gate must also PASS when the fixture matches its baseline — a gate
    // that only ever fails is not a ratchet.
    const pass = execFileSync(
      process.execPath,
      [script, "--root", fixtureRoot, "--baseline", "1"],
      { encoding: "utf8" },
    );
    expect(pass).toContain("PASS");
  });

  it("prints what it cannot see, on every run", () => {
    const out = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, "scripts/lint-disclaimer-coverage.mjs"), "--measure"],
      { encoding: "utf8" },
    );
    expect(out).toContain("LIMITS:");
    expect(out).toContain("Presence, not reachability");
  });

  it("refuses an allowlist entry with no substantive reason", () => {
    const bad = path.join(fixtureRoot, "bad-config.json");
    fs.writeFileSync(
      bad,
      JSON.stringify({
        baselines: { adviceSurfacesMissingDisclaimer: 0 },
        allowlist: [{ file: "client/src/pages/offer-advice.tsx", reason: "known" }],
      }),
    );
    expect(() => loadConfig(bad)).toThrow(/substantive "reason"/);
  });

  it("the committed baseline is green at HEAD and is wired into npm run check", () => {
    const cfg = loadConfig();
    const r = scanDisclaimerCoverage({
      root: REPO_ROOT,
      allowlist: cfg.allowlist.map((a: { file: string }) => a.file),
    });
    expect(r.missing).toHaveLength(cfg.baselines.adviceSurfacesMissingDisclaimer);
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["lint:disclaimer-coverage"]).toBe(
      "node scripts/lint-disclaimer-coverage.mjs",
    );
    expect(pkg.scripts.check).toContain("npm run lint:disclaimer-coverage");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. ADOPTION SOURCE-PINS — verified against the files, in both directions
// ════════════════════════════════════════════════════════════════════════════

describe("adoption — every provenance surface renders the one grammar", () => {
  const MIGRATED = [
    "client/src/components/data-provenance-chip.tsx",
    "client/src/components/data-provenance-tag.tsx",
  ];

  it("both components import the grammar and build no sentence of their own", () => {
    for (const rel of MIGRATED) {
      const src = readCode(rel);
      expect(src, rel).toContain('from "@/lib/provenance"');
      expect(src, rel).toContain("describeProvenance");
      // No local formatting or sentence assembly — that is what forked before.
      expect(src, rel).not.toContain(".toLocaleDateString(");
      expect(src, rel).not.toContain("formatDistanceToNow");
      expect(src, rel).not.toMatch(/parts\.push/);
    }
  });

  it("the tag no longer appears in the date-format lint baseline", () => {
    // It formatted dates itself (2 toLocaleDateString calls) and was
    // grandfathered. Removing the calls without removing the entry would make
    // that ratchet stale-high and red.
    expect(read("scripts/lint-date-format.mjs")).not.toContain("data-provenance-tag.tsx");
  });

  it("the enrichment widget passes its REAL fetch time, not a render-time clock", () => {
    const src = readCode("client/src/components/property-enrichment-widget.tsx");
    expect(src).toContain(
      "retrievedAt={enrichmentData.lastEnrichedAt ?? enrichmentData.enrichedAt}",
    );
    expect(src).not.toMatch(/retrievedAt=\{new Date\(\)/);
  });

  it("comps-analysis no longer stamps its estimate with the render clock", () => {
    const src = readCode("client/src/components/comps-analysis.tsx");
    // BEFORE: asOf={new Date().toISOString()} — "today", every render, forever.
    expect(src).not.toContain("new Date().toISOString()");
    // AFTER: react-query's real fetch time for this analysis.
    expect(src).toContain("dataUpdatedAt");
    expect(src).toContain("retrievedAt={dataUpdatedAt}");
  });

  it("comps-analysis carries the valuation disclaimer its figures require", () => {
    const src = read("client/src/components/comps-analysis.tsx");
    expect(src).toContain('<RequiredDisclaimer type="valuation"');
    const cfg = loadConfig();
    const r = scanDisclaimerCoverage({
      root: REPO_ROOT,
      allowlist: cfg.allowlist.map((a: { file: string }) => a.file),
    });
    const comps = r.candidates.find(
      (c: { file: string }) => c.file === "client/src/components/comps-analysis.tsx",
    );
    expect(comps?.covered).toBe(true);
  });

  it("the two pages that state the absence themselves opt out explicitly", () => {
    for (const rel of [
      "client/src/pages/public-parcel-report.tsx",
      "client/src/pages/tools/parcel-check.tsx",
    ]) {
      const src = read(rel);
      expect(src, rel).toContain('whenUnknown="hide"');
      // The opt-out is only honest because the page says it in prose.
      expect(src, rel).toContain("Source unavailable for this location.");
    }
  });

  it("every per-figure provenance component in client/src/components goes through the grammar", () => {
    // Scoped to components/: client/src/pages/landing/DataProvenance.tsx is a
    // marketing band that NAMES the agencies behind the free tier (FEMA / USDA
    // / USGS). It renders no per-figure source+freshness sentence, so it is not
    // a dialect and is deliberately out of scope.
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(dir)) {
        if (e.startsWith(".") || e === "node_modules") continue;
        const full = path.join(dir, e);
        if (fs.lstatSync(full).isDirectory()) walk(full, out);
        else if (full.endsWith(".tsx")) out.push(full);
      }
      return out;
    };
    const components = walk(path.join(REPO_ROOT, "client/src/components"));
    const named = components.filter((f) => /provenance/i.test(path.basename(f)));
    expect(named.map((f) => path.relative(REPO_ROOT, f)).sort()).toEqual(MIGRATED);
    for (const f of named) {
      expect(fs.readFileSync(f, "utf8"), f).toContain('from "@/lib/provenance"');
    }
  });

  it("the two latent provenance forks still have ZERO consumers", () => {
    // A negative claim, so it is checked in the direction that could falsify
    // it. source-attribution-panel.tsx (SourceAttributionPanel) and
    // data-confidence-badge.tsx (DataConfidenceBadge) each render their own
    // source+staleness vocabulary and predate this grammar. They are dead
    // today — searched by BOTH exported symbol and module path across
    // client/src, server, shared and tests — which is the only reason "one
    // grammar" is a true statement. If anything wires one up, this fails and
    // that surface has to come through lib/provenance instead.
    const roots = ["client/src", "server", "shared", "tests"];
    const walkAll = (dir: string, out: string[] = []): string[] => {
      if (!fs.existsSync(dir)) return out;
      for (const e of fs.readdirSync(dir)) {
        if (e.startsWith(".") || e === "node_modules") continue;
        const full = path.join(dir, e);
        const st = fs.lstatSync(full);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) walkAll(full, out);
        else if (/\.(ts|tsx|mjs)$/.test(full)) out.push(full);
      }
      return out;
    };
    const forks = [
      { file: "client/src/components/source-attribution-panel.tsx", symbol: "SourceAttributionPanel", module: "source-attribution-panel" },
      { file: "client/src/components/data-confidence-badge.tsx", symbol: "DataConfidenceBadge", module: "data-confidence-badge" },
    ];
    const all = roots.flatMap((r) => walkAll(path.join(REPO_ROOT, r)));
    for (const fork of forks) {
      const consumers = all.filter((f) => {
        const rel = path.relative(REPO_ROOT, f);
        if (rel === fork.file || rel === path.relative(REPO_ROOT, __filename)) return false;
        const src = fs.readFileSync(f, "utf8");
        return src.includes(fork.symbol) || src.includes(fork.module);
      });
      expect(consumers.map((f) => path.relative(REPO_ROOT, f)), fork.file).toEqual([]);
    }
  });
});
