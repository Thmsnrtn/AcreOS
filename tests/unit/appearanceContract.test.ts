/**
 * The personal-appearance contract holds end to end: one list of colorways
 * (shared/appearance.ts), and every place that stores, boots, validates or
 * paints a colorway agrees with it.
 *
 * Fieldstone redesign, founder decision 2026-10-18 — three colorways
 * (Fieldstone default, Bedrock, Meridian) × Light / Dark / Match device.
 *
 * What each block defends, and the mutation that turns it red:
 *   - normalization: Bedrock stays Bedrock, Homestead → Bedrock, the
 *     experimental finishes → Fieldstone WITHOUT inferring a mode, `system`
 *     → Match device, garbage → defaults. (Map nocturne → "dark" mode.)
 *   - token parity: every colorway × mode block in index.css defines the SAME
 *     custom properties. The Fieldstone blocks are also the `:root`/`.dark`
 *     fallback, so their selectors match under every colorway — a token
 *     another block omits silently renders Fieldstone's value there.
 *     (Delete `--acr-neg-text` from Bedrock light — it happened once.)
 *   - swatches: the picker previews read hexes from the contract, so they must
 *     equal the tokens the colorway actually paints. (Change one hex.)
 *   - boot script: client/index.html resolves the palette before React with
 *     its own copy of the rules; it is EXECUTED here over a corpus and
 *     compared with normalizeAppearance. (Drop `homestead` from its map.)
 *   - server: legacy colorways are accepted and stored as their successor,
 *     retired fields are accepted and dropped, garbage is rejected, and a
 *     pre-redesign row reads back as a current colorway.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { stripComments } from "../helpers/stripComments";
import {
  COLORWAYS,
  COLORWAY_IDS,
  DEFAULT_COLORWAY,
  DEFAULT_DISPLAY_MODE,
  LEGACY_COLORWAY_MIGRATION,
  normalizeAppearance,
  resolveDisplayMode,
} from "../../shared/appearance";

vi.mock("../../server/db", () => ({ db: {} }));

const ROOT = path.resolve(__dirname, "../..");
const CSS = stripComments(fs.readFileSync(path.join(ROOT, "client/src/index.css"), "utf8"));

describe("normalization of stored appearance", () => {
  it("offers exactly the three approved colorways (founder decision 2026-10-18)", () => {
    // docs/company/founder-decisions-2026-10-18-fieldstone.md — only the
    // founder can add or remove one.
    expect([...COLORWAY_IDS]).toEqual(["fieldstone", "bedrock", "meridian"]);
  });

  it("a fresh account/browser is Fieldstone + Match device", () => {
    expect(DEFAULT_COLORWAY).toBe("fieldstone");
    expect(DEFAULT_DISPLAY_MODE).toBe("auto");
    expect(normalizeAppearance(undefined)).toEqual({ theme: "fieldstone", mode: "auto" });
    expect(normalizeAppearance({})).toEqual({ theme: "fieldstone", mode: "auto" });
  });

  it("keeps current choices and migrates retired ones without inventing a mode", () => {
    expect(normalizeAppearance({ theme: "bedrock", mode: "dark" })).toEqual({ theme: "bedrock", mode: "dark" });
    expect(normalizeAppearance({ theme: "meridian", mode: "light" })).toEqual({ theme: "meridian", mode: "light" });
    expect(normalizeAppearance({ theme: "homestead", mode: "light" })).toEqual({ theme: "bedrock", mode: "light" });
    for (const retired of ["quarry", "nocturne", "meadow", "slate"]) {
      expect(normalizeAppearance({ theme: retired, mode: "light" })).toEqual({ theme: "fieldstone", mode: "light" });
      expect(normalizeAppearance({ theme: retired })).toEqual({ theme: "fieldstone", mode: "auto" });
    }
    expect(normalizeAppearance({ theme: "bedrock", mode: "system" })).toEqual({ theme: "bedrock", mode: "auto" });
  });

  it("ignores malformed values safely", () => {
    for (const raw of [null, 42, "bedrock", [], { theme: 7, mode: {} }, { theme: "neon", mode: "dim" }, { theme: "__proto__" }]) {
      expect(normalizeAppearance(raw)).toEqual({ theme: "fieldstone", mode: "auto" });
    }
  });

  it("manual modes ignore the device; Match device follows it", () => {
    expect(resolveDisplayMode("light", true)).toBe("light");
    expect(resolveDisplayMode("dark", false)).toBe("dark");
    expect(resolveDisplayMode("auto", true)).toBe("dark");
    expect(resolveDisplayMode("auto", false)).toBe("light");
  });
});

/** Every `[data-theme=…]` block → (colorway, mode, token map). */
function colorwayBlocks() {
  const out: Array<{ theme: string; mode: "light" | "dark"; selector: string; tokens: Record<string, string> }> = [];
  for (const m of CSS.matchAll(/(^|\n)([^\n{}@]*data-theme="([\w-]+)"[^\n{}]*)\{([^}]*)\}/g)) {
    const tokens: Record<string, string> = {};
    for (const d of m[4].matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[d[1]] = d[2].trim();
    out.push({ theme: m[3], mode: m[2].includes(".dark") ? "dark" : "light", selector: m[2].trim(), tokens });
  }
  return out;
}

describe("index.css paints exactly the contract's colorways", () => {
  const blocks = colorwayBlocks();

  it("one light and one dark block per colorway, and nothing else", () => {
    expect(blocks.length, "the block parser stopped reading index.css").toBe(COLORWAY_IDS.length * 2);
    for (const id of COLORWAY_IDS) {
      expect(blocks.filter((b) => b.theme === id).map((b) => b.mode).sort(), id).toEqual(["dark", "light"]);
    }
    for (const retired of Object.keys(LEGACY_COLORWAY_MIGRATION)) {
      expect(CSS.includes(`data-theme="${retired}"`), `retired colorway ${retired} still styled`).toBe(false);
    }
  });

  it("the default colorway is the :root / .dark fallback", () => {
    expect(CSS).toMatch(new RegExp(`:root,\\s*\\[data-theme="${DEFAULT_COLORWAY}"\\]:root\\s*\\{`));
    expect(CSS).toMatch(new RegExp(`\\.dark,\\s*\\[data-theme="${DEFAULT_COLORWAY}"\\]\\.dark\\s*\\{`));
  });

  it("every block defines the identical token set (no fallback leak)", () => {
    const reference = new Set(Object.keys(blocks[0].tokens));
    expect(reference.size, "suspiciously few tokens — parser broke").toBeGreaterThan(80);
    const problems: string[] = [];
    for (const b of blocks) {
      const own = new Set(Object.keys(b.tokens));
      for (const k of reference) if (!own.has(k)) problems.push(`${b.theme} ${b.mode} is missing --${k}`);
      for (const k of own) if (!reference.has(k)) problems.push(`${b.theme} ${b.mode} adds --${k} the others lack`);
    }
    expect(problems, "a token missing from one block renders the Fieldstone fallback there").toEqual([]);
  });

  it("picker swatches equal the tokens each colorway paints", () => {
    const pairs: Array<[keyof (typeof COLORWAYS)[number]["light"], string]> = [
      ["page", "acr-bg"],
      ["surface", "acr-surface"],
      ["primary", "acr-brand"],
      ["rail", "acr-sidebar-bg"],
      ["accent", "acr-accent"],
    ];
    const problems: string[] = [];
    for (const def of COLORWAYS) {
      for (const mode of ["light", "dark"] as const) {
        const block = blocks.find((b) => b.theme === def.id && b.mode === mode)!;
        for (const [sw, token] of pairs) {
          if (def[mode][sw].toUpperCase() !== (block.tokens[token] ?? "").toUpperCase()) {
            problems.push(`${def.id} ${mode} swatch.${sw}=${def[mode][sw]} but --${token}=${block.tokens[token]}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("the contract lists each colorway once, with a name and description", () => {
    expect(COLORWAYS.map((c) => c.id)).toEqual([...COLORWAY_IDS]);
    for (const c of COLORWAYS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });
});

describe("every token a utility reads is defined", () => {
  // `border-card-border` read hsl(var(--card-border)) for months with no
  // --card-border anywhere: the declaration is invalid at computed time, so
  // every Card outline fell back to currentColor (full-strength text). The
  // population is EVERY var() the Tailwind config references.
  const config = stripComments(fs.readFileSync(path.join(ROOT, "tailwind.config.ts"), "utf8"));
  const referenced = [...new Set([...config.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))];
  const FONTS = stripComments(fs.readFileSync(path.join(ROOT, "client/src/fonts.css"), "utf8"));
  const defined = new Set([...(CSS + FONTS).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  // Set at runtime on the element by Radix primitives (accordion/collapsible
  // measure their own content height) — not ours to define.
  const RUNTIME_PREFIX = "--radix-";

  it("reads a real population", () => {
    // 54 distinct var() references measured 2026-10-18.
    expect(referenced.length, "tailwind var() extraction broke").toBeGreaterThanOrEqual(50);
  });

  it("no utility references an undefined custom property", () => {
    const missing = referenced.filter((v) => !defined.has(v) && !v.startsWith(RUNTIME_PREFIX));
    expect(missing, "define these in client/src/index.css (or stop referencing them)").toEqual([]);
  });
});

describe("the pre-paint boot script agrees with the shared rules", () => {
  const html = fs.readFileSync(path.join(ROOT, "client/index.html"), "utf8");
  const script = /<script[^>]*data-appearance-boot[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];

  function boot(stored: Record<string, string>, deviceDark: boolean) {
    const attrs: Record<string, string> = {};
    const classes = new Set<string>();
    const sandbox = {
      localStorage: { getItem: (k: string) => (k in stored ? stored[k] : null) },
      window: { matchMedia: () => ({ matches: deviceDark }) },
      document: {
        documentElement: {
          setAttribute: (k: string, v: string) => { attrs[k] = v; },
          classList: { add: (c: string) => classes.add(c) },
          style: {} as Record<string, string>,
        },
      },
    };
    vm.runInNewContext(script!, sandbox);
    return { theme: attrs["data-theme"], dark: classes.has("dark") };
  }

  it("the script is found", () => {
    expect(script, "data-appearance-boot script missing from client/index.html").toBeTruthy();
  });

  const corpus: Array<Record<string, string>> = [
    {},
    { "acreos-theme-config": JSON.stringify({ theme: "bedrock", mode: "dark" }) },
    { "acreos-theme-config": JSON.stringify({ theme: "homestead", mode: "light", fontPairing: "modern" }) },
    { "acreos-theme-config": JSON.stringify({ theme: "nocturne", mode: "light" }) },
    { "acreos-theme-config": JSON.stringify({ theme: "quarry" }) },
    { "acreos-theme-config": JSON.stringify({ theme: "meadow", mode: "system" }) },
    { "acreos-theme-config": JSON.stringify({ theme: "slate", mode: "auto" }) },
    { "acreos-theme-config": JSON.stringify({ theme: "meridian", mode: "dark" }) },
    { "acreos-theme-config": JSON.stringify({ theme: "neon", mode: "dim" }) },
    { "acreos-theme-config": JSON.stringify({ theme: "__proto__", mode: "light" }) },
    { "acreos-theme-config": "{not json" },
    { "acreos-theme-config": "null" },
    { "acreos-theme": "dark" },
  ];

  for (const [i, stored] of corpus.entries()) {
    for (const deviceDark of [false, true]) {
      it(`case ${i} (device ${deviceDark ? "dark" : "light"})`, () => {
        let expected;
        const raw = stored["acreos-theme-config"];
        if (raw !== undefined) {
          let parsed: unknown = null;
          try { parsed = JSON.parse(raw); } catch { parsed = null; }
          expected = normalizeAppearance(parsed);
        } else if (stored["acreos-theme"]) {
          expected = { ...normalizeAppearance({}), mode: stored["acreos-theme"] as "dark" };
        } else {
          expected = normalizeAppearance({});
        }
        const got = boot(stored, deviceDark);
        expect(got.theme).toBe(expected.theme);
        expect(got.dark).toBe(resolveDisplayMode(expected.mode, deviceDark) === "dark");
      });
    }
  }
});

describe("the preferences API speaks the same contract", async () => {
  const { preferencesSchema, serializePreferences } = await import("../../server/routes-preferences");

  it("stores a retired colorway as its successor, never as itself", () => {
    expect(preferencesSchema.parse({ theme: "homestead" }).theme).toBe("bedrock");
    expect(preferencesSchema.parse({ theme: "slate" }).theme).toBe("fieldstone");
    expect(preferencesSchema.parse({ theme: "meridian", mode: "auto" })).toEqual({ theme: "meridian", mode: "auto" });
  });

  it("accepts an old client's retired fields (so its colorway still saves) but rejects garbage", () => {
    expect(preferencesSchema.safeParse({ theme: "bedrock", fontPairing: "modern", density: "compact", motion: "reduced" }).success).toBe(true);
    expect(preferencesSchema.safeParse({ theme: "neon" }).success).toBe(false);
    expect(preferencesSchema.safeParse({ mode: "dim" }).success).toBe(false);
    expect(preferencesSchema.safeParse({ fontPairing: "comic" }).success).toBe(false);
  });

  it("reads a pre-redesign row back as a current colorway, without the retired fields", () => {
    const out = serializePreferences({ theme: "quarry", mode: "dark", fontPairing: "modern", density: "compact", motion: "reduced", listViews: { inbox: "cards" } });
    expect(out.theme).toBe("fieldstone");
    expect(out.mode).toBe("dark");
    expect(out.listViews).toEqual({ inbox: "cards" });
    expect(out).not.toHaveProperty("fontPairing");
    expect(out).not.toHaveProperty("density");
    expect(out).not.toHaveProperty("motion");
    expect(serializePreferences(null)).toMatchObject({ theme: "fieldstone", mode: "auto" });
    expect(serializePreferences({ theme: "bedrock" })).toMatchObject({ theme: "bedrock", mode: "auto" });
  });
});
