/**
 * deadTokens.test.ts — no class or CSS-var may reference an acr token that
 * does not exist.
 *
 * Why this exists (2026-08 dead-token sweep): `bg-acr-success` resolved to
 * NOTHING — there was never a `success` key in the tailwind `acr` color group
 * and never a `--acr-success` CSS var (the real green token is `acr-pos`).
 * Tailwind silently drops unknown classes, so ~46 "green means good" states
 * across PulseStrip, autopilot-control, the readiness ladder, etc. rendered
 * with NO color, and chartPalette.ts's `hsl(var(--acr-success))` produced an
 * invalid color. Nothing failed; the UI just quietly lied by omission.
 *
 * This suite is derived, not hardcoded:
 *   1. The allowed CLASS tokens are parsed out of tailwind.config.ts's `acr`
 *      color group at test time.
 *   2. The allowed VAR names are parsed out of client/src/index.css's
 *      `--acr-*:` declarations at test time.
 *   3. Every `bg-acr-X` / `text-acr-X` / `var(--acr-X)` / … usage in
 *      client/src is collected and checked for membership.
 * So adding a real token to the config/CSS automatically allows it, and a
 * typo'd or removed token fails CI instead of shipping an invisible state.
 *
 * LEGACY BASELINES: the sweep that introduced this test retired acr-success
 * (pinned at zero forever, below) and acr-primary/acr-error, but the census
 * found OTHER pre-existing dead tokens (`acr-warning` alone has ~142 uses)
 * outside that sweep's file set. Those are pinned as shrink-only baselines —
 * repo ratchet discipline applies: when you fix occurrences, lower the
 * baseline in the SAME commit; when a count reaches zero, delete its entry.
 * NEW dead tokens (not in a baseline) fail immediately.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf-8");

// ── Ground truth 1: the tailwind `acr` color group ─────────────────────────
const tw = read("tailwind.config.ts");
const groupStart = tw.indexOf("acr: {");
const groupEnd = tw.indexOf("\n        },", groupStart);
const acrGroup = tw.slice(groupStart, groupEnd);
const CLASS_KEYS = new Set<string>();
for (const m of acrGroup.matchAll(/^\s*(?:"([\w-]+)"|([A-Za-z][\w-]*)):\s*acrToken/gm)) {
  CLASS_KEYS.add((m[1] ?? m[2]) as string);
}

// ── Ground truth 2: the `--acr-*` CSS custom properties ────────────────────
const css = read("client/src/index.css");
const VAR_NAMES = new Set<string>();
for (const m of css.matchAll(/^\s*--acr-([a-z0-9-]+)\s*:/gm)) {
  VAR_NAMES.add(m[1]);
}

// ── The scanned surface: every .ts/.tsx/.css under client/src ──────────────
const files = readdirSync(path.join(root, "client/src"), {
  recursive: true,
  withFileTypes: true,
})
  .filter((d) => d.isFile() && /\.(tsx?|css)$/.test(d.name))
  .map((d) => path.join(d.parentPath, d.name));

// Color-utility prefixes only. `shadow-acr-1/2/3/ring`, `duration-acr-*`, and
// `ease-acr-*` come from the boxShadow/transition scales, not the color group,
// so those prefixes are deliberately excluded here.
const CLASS_RE =
  /(?:^|[^\w-])(?:bg|text|border|ring-offset|ring|outline|fill|stroke|from|via|to|divide|decoration|accent|caret|placeholder)-acr-([a-z0-9]+(?:-[a-z0-9]+)*)/g;
const VAR_RE = /var\(\s*--acr-([a-z0-9-]+)/g;
// Every --acr-* var holds RAW HEX/RGBA (see the acrToken comment in
// tailwind.config.ts) — wrapping one in hsl() always yields an invalid color.
const HSL_WRAP_RE = /hsl\(\s*var\(\s*--acr-/g;

interface Census {
  /** dead token → total occurrence count */
  counts: Map<string, number>;
  /** dead token → repo-relative files it appears in */
  where: Map<string, Set<string>>;
}
const emptyCensus = (): Census => ({ counts: new Map(), where: new Map() });
const record = (c: Census, token: string, file: string) => {
  c.counts.set(token, (c.counts.get(token) ?? 0) + 1);
  if (!c.where.has(token)) c.where.set(token, new Set());
  c.where.get(token)!.add(path.relative(root, file));
};

const deadClasses = emptyCensus();
const deadVars = emptyCensus();
const hslWrapped = emptyCensus();
let successOccurrences = 0;

for (const f of files) {
  const src = readFileSync(f, "utf-8");
  for (const m of src.matchAll(CLASS_RE)) {
    if (!CLASS_KEYS.has(m[1])) record(deadClasses, m[1], f);
  }
  for (const m of src.matchAll(VAR_RE)) {
    if (!VAR_NAMES.has(m[1])) record(deadVars, m[1], f);
  }
  for (const _ of src.matchAll(HSL_WRAP_RE)) record(hslWrapped, "hsl(var(--acr-*))", f);
  successOccurrences += (src.match(/acr-success/g) ?? []).length;
}

// ── Shrink-only baselines for PRE-EXISTING dead tokens (census 2026-08-10).
// Fix occurrences → lower the number in the same commit; at zero, delete the
// entry. Never raise a number; never add an entry for NEW code.
const LEGACY_DEAD_CLASS_BASELINE: Record<string, number> = {
  warning: 142, // the real amber token is `warn`
  "warn-foreground": 1,
  "ink-1": 8, // the ink scale is ink, ink-2, ink-3, ink-4
  info: 5,
  ok: 1, // the real green token is `pos`
};
const LEGACY_DEAD_VAR_BASELINE: Record<string, number> = {
  fg: 1,
  muted: 1,
  "surface-1": 1,
  border: 2,
};
const HSL_WRAP_BASELINE = 22;

const describeCensus = (c: Census): string =>
  [...c.counts.entries()]
    .map(([t, n]) => `  acr-${t} ×${n} in: ${[...(c.where.get(t) ?? [])].join(", ")}`)
    .join("\n");

describe("token ground truth parses (parser self-check)", () => {
  it("found the tailwind acr color group and its keys", () => {
    expect(groupStart).toBeGreaterThan(-1);
    expect(groupEnd).toBeGreaterThan(groupStart);
    for (const k of ["pos", "warn", "neg", "brand", "ink"]) {
      expect(CLASS_KEYS, `acr color group must contain "${k}"`).toContain(k);
    }
    expect(CLASS_KEYS.size).toBeGreaterThanOrEqual(30);
  });

  it("found the --acr-* CSS var declarations", () => {
    for (const v of ["pos", "warn", "neg", "brand", "ink"]) {
      expect(VAR_NAMES, `index.css must declare --acr-${v}`).toContain(v);
    }
    expect(VAR_NAMES.size).toBeGreaterThanOrEqual(40);
    expect(files.length).toBeGreaterThan(100);
  });

  it("every acrToken() arg in tailwind.config.ts is backed by a declared CSS var", () => {
    const missing: string[] = [];
    for (const m of tw.matchAll(/acrToken\("--acr-([a-z0-9-]+)"\)/g)) {
      if (!VAR_NAMES.has(m[1])) missing.push(m[1]);
    }
    expect(missing, "tailwind acr keys backed by undeclared CSS vars").toEqual([]);
  });
});

describe("dead acr tokens cannot ship (derived sweep)", () => {
  it("acr-success stays retired — zero references, any form, forever", () => {
    // The 2026-08 sweep replaced every acr-success with acr-pos. This count
    // includes classes, vars, and comments; it must never leave zero.
    expect(successOccurrences).toBe(0);
  });

  it("acr-primary and acr-error stay retired (swept with acr-success)", () => {
    expect(deadClasses.counts.get("primary") ?? 0).toBe(0);
    expect(deadClasses.counts.get("error") ?? 0).toBe(0);
  });

  it("no CLASS references a token absent from the tailwind acr color group", () => {
    const newDead: string[] = [];
    const grown: string[] = [];
    for (const [token, count] of deadClasses.counts) {
      const baseline = LEGACY_DEAD_CLASS_BASELINE[token];
      if (baseline === undefined) newDead.push(token);
      else if (count > baseline) grown.push(`acr-${token}: ${count} > baseline ${baseline}`);
    }
    expect(
      newDead,
      `NEW dead class token(s) — these compile to NOTHING (Tailwind drops unknown ` +
        `classes) so the state renders with no color:\n${describeCensus(deadClasses)}`,
    ).toEqual([]);
    expect(
      grown,
      `Legacy dead-token counts may only SHRINK (fix the occurrence, not the ` +
        `baseline):\n${describeCensus(deadClasses)}`,
    ).toEqual([]);
  });

  it("no var() references an --acr-* custom property that is never declared", () => {
    const newDead: string[] = [];
    const grown: string[] = [];
    for (const [token, count] of deadVars.counts) {
      const baseline = LEGACY_DEAD_VAR_BASELINE[token];
      if (baseline === undefined) newDead.push(token);
      else if (count > baseline) grown.push(`--acr-${token}: ${count} > baseline ${baseline}`);
    }
    expect(
      newDead,
      `NEW undeclared --acr-* var reference(s) — var() resolves to nothing and the ` +
        `property is dropped (or falls to a hardcoded fallback):\n${describeCensus(deadVars)}`,
    ).toEqual([]);
    expect(grown, `Legacy dead-var counts may only SHRINK:\n${describeCensus(deadVars)}`).toEqual(
      [],
    );
  });

  it("no hsl(var(--acr-*)) — the acr vars hold raw hex, so the wrapper is always invalid", () => {
    const count = hslWrapped.counts.get("hsl(var(--acr-*))") ?? 0;
    expect(
      count,
      `hsl(var(--acr-*)) wraps a raw-hex var and yields an INVALID color (the ` +
        `element renders unstyled). Use var(--acr-*) bare. May only shrink from ` +
        `${HSL_WRAP_BASELINE}:\n${describeCensus(hslWrapped)}`,
    ).toBeLessThanOrEqual(HSL_WRAP_BASELINE);
  });
});
