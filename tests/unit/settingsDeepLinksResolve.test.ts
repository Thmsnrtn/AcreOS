/**
 * Every /settings deep link in the repository must land on a real tab.
 *
 * `settings.tsx` resolved its tab from the URL HASH only. Nineteen
 * `/settings?tab=…` links existed across the app and the transactional emails —
 * six of them `?tab=billing` — and every one landed on Account: no billing UI,
 * no explanation, no way to tell a broken link from a redesigned page. A
 * customer clicking "Manage subscription" in a Stripe renewal email, or
 * "Upgrade plan" in the product, arrived somewhere that answered neither.
 *
 * The convention WAS documented. settings.tsx's own header says deep links must
 * use the `#billing` form, and records that the same gap had already "misled the
 * dunning-email link author into a broken recovery link". It kept happening
 * because a convention no code enforces is a comment, and this is the code.
 *
 * ── WHY THE FIX ACCEPTS BOTH CARRIERS ─────────────────────────────────────
 * Rewriting the nineteen call sites would not have been enough. Renewal and
 * dunning emails carrying `?tab=billing` are already in customers' inboxes and
 * cannot be edited. So the page reads the hash first (documented canonical) and
 * the query second, and this test holds BOTH forms to the same standard.
 *
 * ── THE POPULATION IS DERIVED ─────────────────────────────────────────────
 * Every `/settings` link is found by scanning client/ and server/ — not listed
 * here — so a twentieth link added tomorrow is checked by existing, and a
 * misspelled tab fails here rather than in an inbox.
 */

import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS, stripComments } from "../helpers/stripComments";

// THIS FILE SWEEPS THE WHOLE REPOSITORY. Stripping comments correctly means
// parsing, ~2.7ms a file, and under the coverage run's instrumentation a
// sweep does not fit the suite's 30s default. Killing it does not make the
// suite faster — it makes this gate stop reporting. Declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = process.cwd();
const SETTINGS = path.join(ROOT, "client", "src", "pages", "settings.tsx");

/** The tabs settings.tsx actually renders, read from the page itself. */
function validTabs(): Set<string> {
  const src = stripComments(readFileSync(SETTINGS, "utf8"));
  const block = /const VALID_TABS = \[([\s\S]*?)\] as const;/.exec(src);
  expect(block, "VALID_TABS is no longer a literal array — re-derive this list").toBeTruthy();
  return new Set([...block![1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));
}

/** The legacy spellings the page canonicalises, read from the page itself. */
function legacyMap(): Set<string> {
  const src = stripComments(readFileSync(SETTINGS, "utf8"));
  const block = /const LEGACY_TO_CANONICAL: Record<string, TabValue> = \{([\s\S]*?)\n\};/.exec(src);
  expect(block, "LEGACY_TO_CANONICAL is no longer a literal — re-derive this list").toBeTruthy();
  return new Set([...block![1].matchAll(/^\s*"?([a-zA-Z-]+)"?\s*:/gm)].map((m) => m[1]));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (["node_modules", "dist", "build", "__snapshots__"].includes(e)) continue;
    const abs = path.join(dir, e);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(abs);
  }
  return out;
}

type Link = { file: string; line: number; raw: string; tab: string; carrier: "query" | "hash" };

function settingsLinks(): Link[] {
  const files = [...walk(path.join(ROOT, "client", "src")), ...walk(path.join(ROOT, "server"))];
  const found: Link[] = [];
  for (const abs of files) {
    // Comments stripped: settings.tsx's own header enumerates legacy spellings
    // in prose, and a scan that read them would validate its own documentation.
    const src = stripComments(readFileSync(abs, "utf8"));
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\/settings\?tab=([a-zA-Z-]+)/g)) {
        found.push({ file: path.relative(ROOT, abs), line: i + 1, raw: m[0], tab: m[1], carrier: "query" });
      }
      for (const m of line.matchAll(/\/settings#([a-zA-Z-]+)/g)) {
        found.push({ file: path.relative(ROOT, abs), line: i + 1, raw: m[0], tab: m[1], carrier: "hash" });
      }
    });
  }
  return found;
}

describe("settings deep links land where they say", () => {
  const tabs = validTabs();
  const legacy = legacyMap();
  const links = settingsLinks();

  it("the page still declares its tabs and its legacy map", () => {
    expect(tabs.size, "no VALID_TABS parsed — every assertion below is vacuous")
      .toBeGreaterThan(3);
    expect(tabs.has("billing"), "billing is the revenue-adjacent one").toBe(true);
    expect(legacy.size, "no LEGACY_TO_CANONICAL parsed").toBeGreaterThan(3);
  });

  it("the link scan finds the real population", () => {
    expect(
      links.length,
      "no /settings deep links found anywhere — the scan has stopped matching " +
        "and this suite proves nothing",
    ).toBeGreaterThan(5);
  });

  it("every deep link resolves to a tab that exists", () => {
    const broken = links
      .filter((l) => !tabs.has(l.tab) && !legacy.has(l.tab))
      .map((l) => `${l.file}:${l.line}  ${l.raw}  (${l.carrier})`);
    expect(
      broken,
      "these land on the Account tab because the page cannot resolve them. A " +
        "customer following one — from a renewal email, or the upgrade funnel — " +
        "arrives at a page that answers neither their question nor why not. Add " +
        "the spelling to LEGACY_TO_CANONICAL or fix the link.",
    ).toEqual([]);
  });

  it("the RESOLVER reads the query carrier, not just the hash", () => {
    // Nineteen links used `?tab=`; the page read `#`. This asserts the tab
    // RESOLVER consults both — scoped to that function's body on purpose.
    //
    // The first version of this test searched the whole FILE for
    // `searchParams.get("tab")`, and reverting the resolver to hash-only left it
    // GREEN: applyBillingIntent below also reads that param, so the string was
    // still present while the defect was fully restored. Same mention-trap as
    // the mail-suppression gate — a symbol appearing somewhere in a file says
    // nothing about the code path that matters.
    const src = stripComments(readFileSync(SETTINGS, "utf8"));
    const fn = /const getTabFromHash = \(\): TabValue => \{([\s\S]*?)\n  \};/.exec(src);
    expect(fn, "getTabFromHash is no longer a recognisable function — re-scope this assertion")
      .toBeTruthy();
    expect(
      /searchParams\.get\(\s*["']tab["']\s*\)/.test(fn![1]),
      "the settings tab resolver no longer reads ?tab= — every /settings?tab= " +
        "link in the repo, and every one already sitting in a customer's inbox, " +
        "silently lands on Account again",
    ).toBe(true);
  });
});
