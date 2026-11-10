/**
 * PKG-5c ratchet — every in-scope AI-advice surface carries the existing
 * disclaimer component, proven against the surface's SOURCE, not the registry's
 * own claim.
 *
 * Three questions, per the repo's three laws:
 *  1. PROPERTY — the JSX opening tag (`<RequiredDisclaimer type="ai"`) is in
 *     the comment-stripped source, the expected number of times. A comment that
 *     merely names the component does not count (canary below).
 *  2. ADOPTION — covered-by-host entries are only honest if their hosts carry
 *     it; the hosts are asserted, and the surface is asserted to be rendered
 *     only inside them.
 *  3. POPULATION — the registry is not a hand list we trust: a sweep of
 *     client/src finds every non-founder file that calls an `/api/ai/` or
 *     `/api/pax/` endpoint and requires each to be registered. A new AI surface
 *     added without a registry entry is what fails here.
 *
 * This test adds no disclaimer wording and asserts none.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { stripComments } from "../helpers/stripComments";
import {
  AI_DISCLAIMER_COUNSEL_FLAGS,
  AI_DISCLAIMER_SURFACES,
  FOUNDER_ONLY_PATH_SEGMENTS,
  type AiDisclaimerSurface,
} from "../../shared/governance/aiDisclaimerSurfaces";

// Walks client/src; the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = process.cwd();
const CLIENT_SRC = path.join(ROOT, "client/src");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const isFounderPath = (r: string) => FOUNDER_ONLY_PATH_SEGMENTS.some((s) => `/${r}`.includes(s));
const code = (file: string) => stripComments(readFileSync(path.join(ROOT, file), "utf8"));

/** Count JSX usages of `<Component type="variant"` in comment-stripped source. */
export function countUsages(source: string, component: string, variant: string): number {
  const re = new RegExp(`<${component}\\s+type=["']${variant}["']`, "g");
  return (source.match(re) ?? []).length;
}

const carriers = AI_DISCLAIMER_SURFACES.filter((s) => s.status === "present" || s.status === "added");

describe("AI disclaimer surface registry — shape", () => {
  it("has a populated registry with every status represented", () => {
    expect(AI_DISCLAIMER_SURFACES.length).toBeGreaterThanOrEqual(30);
    for (const status of ["present", "added", "covered-by-host", "not-advice", "founder-only"]) {
      expect(AI_DISCLAIMER_SURFACES.some((s) => s.status === status), status).toBe(true);
    }
  });

  it("has no duplicate files and every file exists", () => {
    const files = AI_DISCLAIMER_SURFACES.map((s) => s.file);
    expect(new Set(files).size).toBe(files.length);
    for (const f of files) expect(existsSync(path.join(ROOT, f)), f).toBe(true);
  });

  it("every non-carrier entry states a reason; carriers name component + variant", () => {
    for (const s of AI_DISCLAIMER_SURFACES) {
      if (s.status === "present" || s.status === "added") {
        expect(s.component, s.file).toBeTruthy();
        expect(s.variant, s.file).toBeTruthy();
        if (s.status === "added") expect(s.before, `${s.file} must record its pre-PKG-5c state`).toBeTruthy();
      } else {
        expect((s.reason ?? "").length, s.file).toBeGreaterThan(10);
      }
    }
  });

  it("records the counsel flags (flags only)", () => {
    expect(AI_DISCLAIMER_COUNSEL_FLAGS.length).toBeGreaterThanOrEqual(2);
    expect(AI_DISCLAIMER_COUNSEL_FLAGS.some((f) => f.includes("§7") && f.includes("§3"))).toBe(true);
    expect(AI_DISCLAIMER_COUNSEL_FLAGS.some((f) => f.includes("LQ-03"))).toBe(true);
  });
});

describe("AI disclaimer surfaces — the component is actually in the source", () => {
  it("carrier population is non-vacuous", () => {
    expect(carriers.length).toBeGreaterThanOrEqual(14);
  });

  for (const s of carriers) {
    it(`${s.file} renders <${s.component} type="${s.variant}">`, () => {
      const n = countUsages(code(s.file), s.component!, s.variant!);
      expect(n).toBeGreaterThanOrEqual(s.minUsages ?? 1);
    });
  }

  it("canary: a comment or string that only NAMES the component does not count", () => {
    const fixture = [
      '// <RequiredDisclaimer type="ai" /> was removed from here',
      '/* <DisclaimerBanner type="ai" /> */',
      "const x = 1;",
    ].join("\n");
    expect(countUsages(stripComments(fixture), "RequiredDisclaimer", "ai")).toBe(0);
    expect(countUsages(stripComments(fixture), "DisclaimerBanner", "ai")).toBe(0);
    expect(countUsages(stripComments('<RequiredDisclaimer type="ai" />'), "RequiredDisclaimer", "ai")).toBe(1);
    // wrong variant does not satisfy the entry
    expect(countUsages('<RequiredDisclaimer type="financial" />', "RequiredDisclaimer", "ai")).toBe(0);
  });
});

describe("covered-by-host entries are honest", () => {
  const covered = AI_DISCLAIMER_SURFACES.filter((s) => s.status === "covered-by-host");

  it("is non-vacuous", () => {
    expect(covered.length).toBeGreaterThanOrEqual(2);
  });

  for (const s of covered) {
    it(`${s.file}: every host carries a disclaimer`, () => {
      expect(s.hosts?.length ?? 0).toBeGreaterThan(0);
      for (const h of s.hosts!) {
        const host = AI_DISCLAIMER_SURFACES.find((x) => x.file === h);
        expect(host, `${h} must be registered`).toBeTruthy();
        expect(["present", "added"], h).toContain(host!.status);
        expect(countUsages(code(h), host!.component!, host!.variant!), h).toBeGreaterThanOrEqual(1);
      }
    });

    it(`${s.file}: is rendered only inside its hosts`, () => {
      const base = path.basename(s.file).replace(/\.tsx?$/, "");
      const importers = walk(CLIENT_SRC)
        .map(rel)
        .filter((f) => f !== s.file)
        .filter((f) => new RegExp(`<${base}[\\s>/]`).test(code(f)) || new RegExp(`/${base}["']`).test(code(f)))
        .filter((f) => !isFounderPath(f));
      expect(importers.length, `${base} has no consumers — registry entry is vacuous`).toBeGreaterThan(0);
      for (const f of importers) expect(s.hosts, `${f} renders ${base} but is not a registered host`).toContain(f);
    });
  }
});

describe("AI disclaimer surfaces — population sweep", () => {
  const registered = new Set<string>(AI_DISCLAIMER_SURFACES.map((s: AiDisclaimerSurface) => s.file));
  // String literals naming an AI/Pax endpoint. Comments stripped first.
  const AI_ENDPOINT = /["'`]\/api\/(ai|pax)\//;

  const files = walk(CLIENT_SRC).map(rel);
  const callers = files.filter((f) => AI_ENDPOINT.test(code(f)));

  it("the sweep reads a real population (floor, not a hope)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(callers.length).toBeGreaterThanOrEqual(20);
  });

  it("every registered carrier is itself inside the sweep or a known host (spot floor)", () => {
    // The sweep must see at least the Pax rail and the offer generator, or the
    // endpoint predicate has silently stopped matching.
    expect(callers).toContain("client/src/components/pax-copilot-rail.tsx");
    expect(callers).toContain("client/src/components/ai-offer-generator.tsx");
    expect(callers).toContain("client/src/pages/inbox.tsx");
  });

  it("no non-founder file calls an AI/Pax endpoint without a registry entry", () => {
    const unregistered = callers.filter((f) => !isFounderPath(f) && !registered.has(f));
    expect(unregistered, "Register each in shared/governance/aiDisclaimerSurfaces.ts").toEqual([]);
  });
});
