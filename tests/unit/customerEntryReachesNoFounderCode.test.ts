/**
 * No founder-only module is reachable from the CUSTOMER entry — and every one
 * is reachable from the founder entry.
 *
 * P1-9 / X-2 builds the client to two outputs so the founder's pages never ship
 * to customers. The build gate (scripts/check-bundle-size.js) proves that over
 * what Rollup bundled; this proves it over what the SOURCE can reach, before
 * anything is built, with the same population: it walks every static `import`,
 * `export … from` and dynamic `import()` from client/src/main.tsx (following
 * the `@/` alias and relative specifiers) and asserts that no visited module
 * matches the founder-only list.
 *
 * The list is READ FROM scripts/check-bundle-size.js (FOUNDER_ONLY_MODULES), not
 * retyped, so the build gate and this test cannot disagree about what "founder
 * code" is. Population claims are floored (the walk must see hundreds of files)
 * and each shape the walker relies on has a canary: a fixture that hides a
 * founder module behind a dynamic import, an `export … from` re-export and a
 * barrel — if the walker stops following one, its canary goes red on its own.
 *
 * Type-only imports are skipped: they are erased by the compiler and never reach
 * a bundle.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
// This gate walks the client source tree and strips comments from every file it
// reaches; its cost scales with the repo, and under the coverage run it does not
// fit the suite's 30s default. A killed gate reports nothing about what it
// guards, so the budget is declared, not inherited.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const CLIENT_SRC = path.join(ROOT, "client/src");

// ── The founder-only list: one source of truth, the build gate ────────────────
function founderOnlyPatterns(): RegExp[] {
  const script = fs.readFileSync(path.join(ROOT, "scripts/check-bundle-size.js"), "utf8");
  const block = /const FOUNDER_ONLY_MODULES = \[([\s\S]*?)\n\];/.exec(script);
  if (!block) throw new Error("FOUNDER_ONLY_MODULES is gone from scripts/check-bundle-size.js — re-point this test");
  return block[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("/"))
    .map((l) => {
      const m = /^\/(.*)\/,?$/.exec(l);
      if (!m) throw new Error(`unparseable founder-only pattern: ${l}`);
      return new RegExp(m[1]);
    });
}
const PATTERNS = founderOnlyPatterns();
const isFounderOnly = (rel: string) => PATTERNS.some((re) => re.test(rel));

// ── The walker ────────────────────────────────────────────────────────────────
interface Host {
  /** Source text of an absolute path, or null when it is not a file. */
  load(abs: string): string | null;
  /** Absolute path for `spec` imported from `from`, or null (a package, an asset…). */
  resolve(from: string, spec: string): string | null;
}

const IMPORT_RE = /\b(?:import|export)\s+(type\s+)?(?:[\w*${}\s,]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

function specifiersOf(source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  for (const m of code.matchAll(IMPORT_RE)) if (!m[1]) out.push(m[2]);
  for (const m of code.matchAll(DYNAMIC_RE)) out.push(m[1]);
  return out;
}

function reachable(entry: string, host: Host): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const src = host.load(file);
    if (src === null) continue;
    seen.add(file);
    for (const spec of specifiersOf(src)) {
      const next = host.resolve(file, spec);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return seen;
}

const EXTS = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

// Extension probing used to statSync each candidate — a check-then-use shape
// (the answer can change between the probe and the walker's read). Probe
// against a snapshot of the tree instead: one walk up front, membership after.
let clientFileSnapshot: Set<string> | null = null;
function clientFiles(): Set<string> {
  if (clientFileSnapshot) return clientFileSnapshot;
  const files = new Set<string>();
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.add(full);
    }
  };
  walk(CLIENT_SRC);
  clientFileSnapshot = files;
  return files;
}

const realHost: Host = {
  load(abs) {
    // Read-first: a directory or a missing path throws → null; no probe
    // whose answer the read then trusts.
    try {
      return fs.readFileSync(abs, "utf8");
    } catch {
      return null;
    }
  },
  resolve(from, spec) {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(CLIENT_SRC, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
    else return null; // a package, @shared/* (shared never imports client/), @content, @acreos/*
    if (/\.(css|json|svg|png|jpe?g|woff2?)$/.test(base)) return null;
    const files = clientFiles();
    for (const ext of EXTS) {
      const candidate = base + ext;
      if (files.has(candidate)) return candidate;
    }
    return null;
  },
};

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join("/");

describe("the founder-only module list (read from the build gate) is alive", () => {
  it("has one pattern per founder source family, and each matches a real file shape", () => {
    expect(PATTERNS.length).toBeGreaterThanOrEqual(8);
    const samples = [
      "client/src/pages/founder/home.tsx",
      "client/src/pages/founder-letter.tsx",
      "client/src/components/founder/PulseStrip.tsx",
      "client/src/components/founder-chat/Dock.tsx",
      "client/src/components/founder-bridge/BridgeAtlasSheet.tsx",
      "client/src/components/mobile/FounderMobileBottomNav.tsx",
      "client/src/pages/dunning-manager.tsx",
      "client/src/hooks/use-sovereign-dashboard.ts",
      "client/src/founder-routes.tsx",
    ];
    for (const s of samples) expect(isFounderOnly(s), `${s} is not covered by the founder-only list`).toBe(true);
    // Shared on purpose — nav-items derives the shared nav from founder-doors,
    // and /commissions' page is shared with Finance → Commissions.
    for (const s of ["client/src/lib/founder-doors.ts", "client/src/pages/commissions.tsx", "client/src/components/artifacts/text.tsx"]) {
      expect(isFounderOnly(s), `${s} must stay shareable`).toBe(false);
    }
  });

  it("every founder source file the list names really exists on disk (no vacuous pattern)", () => {
    const all: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) all.push(rel(p));
      }
    };
    walk(CLIENT_SRC);
    for (const re of PATTERNS) {
      expect(all.some((f) => re.test(f)), `pattern ${re} matches no file under client/src`).toBe(true);
    }
  });
});

describe("the walker follows every import shape it relies on (canaries)", () => {
  const files: Record<string, string> = {
    "/v/main.tsx": 'import App from "./App";',
    "/v/App.tsx": [
      "// import X from './founder/commented'",
      'import { Barrel } from "./barrel";',
      'const Lazy = React.lazy(() => import("./lazy-parent"));',
      'import type { Erased } from "./founder/type-only";',
    ].join("\n"),
    "/v/barrel.ts": 'export { Thing } from "./thing";',
    "/v/thing.ts": "export const Thing = 1;",
    "/v/lazy-parent.tsx": 'export default () => import("./founder/page");',
    "/v/founder/page.tsx": "export default 1;",
    "/v/founder/commented.tsx": "export default 2;",
    "/v/founder/type-only.ts": "export type Erased = 1;",
  };
  const host: Host = {
    load: (abs) => files[abs] ?? null,
    resolve(from, spec) {
      if (!spec.startsWith(".")) return null;
      const base = path.posix.join(path.posix.dirname(from), spec);
      for (const ext of [".ts", ".tsx", ""]) if (files[base + ext] !== undefined) return base + ext;
      return null;
    },
  };

  it("static imports, barrel re-exports and dynamic import() are followed", () => {
    const seen = reachable("/v/main.tsx", host);
    expect(seen.has("/v/barrel.ts"), "static import not followed").toBe(true);
    expect(seen.has("/v/thing.ts"), "`export … from` re-export not followed").toBe(true);
    expect(seen.has("/v/lazy-parent.tsx"), "React.lazy(() => import()) not followed").toBe(true);
    expect(seen.has("/v/founder/page.tsx"), "a founder page behind a dynamic import is invisible to the walker").toBe(true);
  });

  it("comments and type-only imports do not count as reachability", () => {
    const seen = reachable("/v/main.tsx", host);
    expect(seen.has("/v/founder/commented.tsx")).toBe(false);
    expect(seen.has("/v/founder/type-only.ts")).toBe(false);
  });
});

describe("the CUSTOMER entry reaches no founder-only module", () => {
  const customer = reachable(path.join(CLIENT_SRC, "main.tsx"), realHost);

  it("walked a real population (floor), not an entry that imports nothing", () => {
    expect(customer.size, "customer entry reaches too few files — the walker went blind").toBeGreaterThanOrEqual(300);
    expect(customer.has(path.join(CLIENT_SRC, "App.tsx"))).toBe(true);
    expect(customer.has(path.join(CLIENT_SRC, "pages/today.tsx"))).toBe(true);
  });

  it("no founder-only module is reachable (static, re-export or dynamic)", () => {
    const leaks = [...customer].map(rel).filter(isFounderOnly);
    expect(
      leaks,
      "founder-only code is reachable from the customer entry, so it ships in the customer bundle. " +
        "Move the founder usage behind the founder build (client/src/FounderApp.tsx / founder-routes.tsx) " +
        "or relocate the shared piece to a neutral module (see components/artifacts/text.tsx).",
    ).toEqual([]);
  });

  it("the founder-chat text artifact is shared through the neutral module, not founder-chat/", () => {
    expect(customer.has(path.join(CLIENT_SRC, "components/artifacts/text.tsx"))).toBe(true);
    expect(customer.has(path.join(CLIENT_SRC, "components/founder-chat/artifacts/text.tsx"))).toBe(false);
  });

  it("the AI-console panels left the customer's /ai page", () => {
    expect(customer.has(path.join(CLIENT_SRC, "pages/command-center.tsx"))).toBe(true);
    expect(customer.has(path.join(CLIENT_SRC, "components/founder/ai-console/VaTeamPanel.tsx"))).toBe(false);
  });
});

describe("the FOUNDER entry reaches the founder surface (the split moved it, not lost it)", () => {
  const founder = reachable(path.join(CLIENT_SRC, "founder-main.tsx"), realHost);
  const has = (p: string) => founder.has(path.join(CLIENT_SRC, p));

  it("reaches the route tree, the founder pages, the dock and the console panels", () => {
    expect(founder.size).toBeGreaterThanOrEqual(150);
    for (const p of [
      "FounderApp.tsx",
      "founder-routes.tsx",
      "pages/founder/home.tsx",
      "pages/founder-decisions.tsx",
      "pages/dunning-manager.tsx",
      "components/founder-chat/Dock.tsx",
      "components/mobile/FounderMobileBottomNav.tsx",
      "components/founder/ai-console/VaTeamPanel.tsx",
    ]) {
      expect(has(p), `${p} is not reachable from the founder entry`).toBe(true);
    }
  });

  it("does not drag the customer router in (it would defeat the split from the other side)", () => {
    // Founder pages may legitimately share components with customer pages, so
    // the check is on the ROUTER, not on individual pages.
    expect(has("App.tsx")).toBe(false);
    expect(has("main.tsx")).toBe(false);
  });
});
