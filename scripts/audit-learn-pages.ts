#!/usr/bin/env tsx
/**
 * Audit /learn/<vertical>/<state> public claims — citation coverage and
 * product-claim honesty.
 *
 * REWORKED 2026-09-01. The original version was a gate that COULD NOT FAIL:
 * it token-matched every extracted claim against a "source" built from the
 * page's own body text, so every sentence verified against itself. A planted
 * "AcreOS guarantees a 900% return in 3 days under Tex. Fake Code §99.999"
 * passed 536/536. Worse, under that green light nine of ten pages' valueProps
 * advertised statute-specific product features with NO implementation (a
 * "§5.077 annual-statement generator", a "§2923.55 pre-foreclosure notice
 * workflow", …) — public capability fabrication certified by a circular
 * audit. The token-match pass is deleted, not repaired: matching prose
 * against a bare citation string was never verification.
 *
 * What replaces it — two properties a script can actually prove:
 *
 *   1. CITATION DECLARATION — every §/Chapter reference in the page's prose
 *      must be covered by the page's declared sources (exact token, or
 *      inside a declared §§X–Y range). A page cannot cite a statute it does
 *      not declare; the planted Fake Code §99.999 fails here.
 *   2. PRODUCT-CLAIM REGISTRY CHECK — a §-reference inside `valueProp` is a
 *      claim that ACREOS IMPLEMENTS something for that statute, so it must
 *      appear in shared/governance/statuteRegister.ts (the honest inventory
 *      of every statute the code takes on). Statute-specific product
 *      features the register does not carry fail here — the exact
 *      fabrication class found on 2026-09-01.
 *
 * What this still does NOT prove: that the LEGAL prose is a correct reading
 * of the cited statutes. That is attorney review, same as everywhere else
 * in this repo. This gate keeps the pages honest about their OWN sourcing
 * and about the product; it does not practice law.
 *
 * Exit code: 0 = clean; 1 = any failure. Runs in CI (truth-engine:audit-learn).
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, "..");
const LEARN_ROOT = join(REPO_ROOT, "content", "learn");

interface LearnFaqItem { q: string; a: string; }
interface LearnExample { headline: string; body: string; }
interface LearnSource { name: string; citation: string; url?: string; }
interface LearnContent {
  vertical: string;
  stateSlug: string;
  stateName: string;
  headline: string;
  metaDescription: string;
  intro: string;
  mechanics: string;
  statutes: LearnExample[];
  gotchas: LearnExample[];
  valueProp: string;
  faq: LearnFaqItem[];
  sources: LearnSource[];
}

/**
 * Section tokens the scan may skip, keyed "vertical/state:token", each with
 * a dated reason. Checked for liveness — a resolved exemption must go.
 */
const EXEMPT: Record<string, string> = {
  // (none today)
};

/**
 * All prose fields that can carry citations. County pages share only a
 * subset of the vertical-page schema (no statutes/gotchas/valueProp), so
 * every field is optional here — the audit covers whatever prose exists.
 */
function proseOf(c: LearnContent): string {
  return [
    c.headline, c.metaDescription, c.intro, c.mechanics, c.valueProp,
    ...(c.statutes ?? []).map((s) => `${s.headline} ${s.body}`),
    ...(c.gotchas ?? []).map((g) => `${g.headline} ${g.body}`),
    ...(c.faq ?? []).map((f) => `${f.q} ${f.a}`),
  ].filter(Boolean).join("\n");
}

/** §-and-Chapter tokens in a text: "5.077", "51.002", "392", "44-14-162"… */
function citationTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/§§?\s*([\d][\w.\-]*)/g)) out.push(m[1]);
  for (const m of text.matchAll(/Chapters?\s+(\d[\w.]*(?:\s*(?:,|and)\s*\d[\w.]*)*)/gi)) {
    for (const t of m[1].split(/\s*(?:,|and)\s*/)) out.push(t);
  }
  return out.map((t) => t.replace(/[).,;:]+$/, "")).filter(Boolean);
}

/** Numeric ranges declared as §§X-Y (or §§X–Y / "X through Y"). */
function declaredRanges(citation: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of citation.matchAll(/§§?\s*([\d.]+)\s*[-–]\s*(?:§§?\s*)?([\d.]+)/g)) {
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) ranges.push([Math.min(a, b), Math.max(a, b)]);
  }
  return ranges;
}

function covered(token: string, sources: LearnSource[]): boolean {
  const joined = sources.map((s) => `${s.name} ${s.citation}`).join("\n");
  if (joined.includes(token)) return true;
  const n = parseFloat(token);
  if (Number.isFinite(n) && sources.some((s) => declaredRanges(s.citation).some(([a, b]) => n >= a && n <= b))) {
    return true;
  }
  // A declared chapter covers its own subsections: §392 covers §392.301,
  // Chapter 180 covers §180.003. Only the pre-dot prefix qualifies — a
  // declared §5.061 never covers §5.077.
  const dot = token.indexOf(".");
  if (dot > 0) {
    const chapter = token.slice(0, dot);
    return new RegExp(`(?:§§?\\s*|Chapters?[^.]*?)${chapter}(?![\\d.])`).test(joined);
  }
  return false;
}

function loadAllContent(): LearnContent[] {
  // RECURSIVE, deliberately: the original loader read only *.json directly
  // under each vertical, so the county pages (county/arizona/*.json,
  // county/texas/*.json) were never in the audit population at all —
  // 13 public pages existed, 10 were audited (found 2026-09-01, the same
  // day as the circular-source defect). A new nesting level must never
  // silently shrink the population again.
  const out: LearnContent[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (e.name.endsWith(".json")) {
        out.push(JSON.parse(readFileSync(full, "utf8")) as LearnContent);
      }
    }
  };
  walk(LEARN_ROOT);
  return out;
}

function main() {
  console.log("[truth-engine] auditing /learn pages (citation coverage + product-claim honesty)…");
  console.log("");
  const registerText = readFileSync(
    join(REPO_ROOT, "shared/governance/statuteRegister.ts"),
    "utf8",
  );
  const pages = loadAllContent();
  let failures = 0;
  let tokensSeen = 0;
  let vpTokensSeen = 0;

  for (const c of pages) {
    const pageId = c.vertical ? `${c.vertical}/${c.stateSlug}` : `county/${c.stateSlug}/${(c as any).countySlug}`;
    const pageFailures: string[] = [];

    // Pass 1 — every cited section is declared as a source.
    for (const token of new Set(citationTokens(proseOf(c)))) {
      tokensSeen += 1;
      if (EXEMPT[`${pageId}:${token}`]) continue;
      if (!covered(token, c.sources)) {
        pageFailures.push(`cites §${token} but declares no source covering it`);
      }
    }

    // Pass 2 — valueProp §-references are product claims; each must be a
    // statute the register carries (i.e. an implementation that exists).
    for (const token of new Set(citationTokens(c.valueProp ?? ""))) {
      vpTokensSeen += 1;
      if (EXEMPT[`${pageId}:valueProp:${token}`]) continue;
      if (!registerText.includes(token)) {
        pageFailures.push(
          `valueProp claims a product capability for §${token}, which the statute register does not carry — ` +
            `either the feature does not exist (rewrite the claim) or the register is missing a REAL implementation (add the entry with its code sites)`,
        );
      }
    }

    // Structure.
    if (c.sources.length < 2) pageFailures.push(`only ${c.sources.length} declared source(s)`);

    const mark = pageFailures.length === 0 ? "OK" : "FAIL";
    console.log(`[${mark}] /learn/${pageId}`);
    for (const f of pageFailures) console.log(`       ${f}`);
    failures += pageFailures.length;
  }

  // Vacuity floors — a parser matching nothing reads exactly like a clean corpus.
  if (pages.length < 8) { failures += 1; console.error("[VACUOUS] fewer than 8 learn pages loaded"); }
  if (tokensSeen < 50) { failures += 1; console.error(`[VACUOUS] citation parser saw only ${tokensSeen} tokens`); }
  for (const key of Object.keys(EXEMPT)) {
    const [pageId] = key.split(":");
    const page = pages.find((c) =>
      (c.vertical ? `${c.vertical}/${c.stateSlug}` : `county/${c.stateSlug}/${(c as any).countySlug}`) === pageId);
    const token = key.split(":").pop() as string;
    if (!page || !proseOf(page).includes(token)) {
      failures += 1;
      console.error(`[STALE-EXEMPT] ${key} no longer occurs — remove the exemption.`);
    }
  }

  console.log("");
  console.log(
    `[truth-engine] summary: ${pages.length} pages, ${tokensSeen} citation tokens checked, ` +
      `${vpTokensSeen} product-claim tokens checked, ${failures} failure(s)`,
  );
  process.exit(failures > 0 ? 1 : 0);
}

main();
