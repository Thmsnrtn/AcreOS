/**
 * Status text and secondary text clear WCAG AA on every theme's own surfaces.
 *
 * The 2026-10 crawl found serious `color-contrast` failures on 35 routes. They
 * were not 35 page bugs; they were a handful of TOKENS:
 *
 *   - `text-acr-warn` / `text-acr-accent` / `text-acr-pos` — the status colours
 *     are FILL colours first (dots, bars, borders, washes). As small text on
 *     Bedrock light they measured 2.44 / 2.54 / 3.49 : 1. ~1,900 usages.
 *   - `text-muted-foreground` on the nav rail — every surface the token's own
 *     fixer read passed, but the sidebar background was never in its list
 *     (4.35:1 on Bedrock light).
 *
 * The fix is tokens only, no hardcoded colour in any component:
 *   - each theme that needs it defines `--acr-<x>-text`, an AA ink of the same
 *     hue, and tailwind.config.ts maps the `text-acr-<x>` utilities (text only —
 *     fills untouched) to `var(--acr-<x>-text, var(--acr-<x>))`;
 *   - tests/personas/fixMutedContrast.mjs now includes sidebar-background.
 *
 * This file recomputes the contrast from index.css for EVERY theme block, so
 * changing any colour re-derives the verdict. Population: the theme blocks are
 * enumerated from the stylesheet with a floor, and each block must carry every
 * token this reads — a block the parser half-read fails rather than passes.
 * The tailwind mapping is read from a TS parse of the config (tests must not
 * import it), so the ink tokens cannot exist in CSS and be dead in utilities.
 *
 * Mutation probes (must go RED): delete Bedrock light's `--acr-warn-text`;
 * point textColor.acr.warn back at acrToken("--acr-warn"); drop
 * "sidebar-background" from fixMutedContrast.mjs and restore L 34% on Bedrock.
 */

import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
// index.css holds no `//`, so the shared lexer reads it exactly: block
// comments are blanked and everything else is kept in place.
const CSS = stripComments(fs.readFileSync(path.join(ROOT, "client/src/index.css"), "utf8"));

type RGB = [number, number, number];
const hsl2rgb = (h: number, s: number, l: number): RGB => {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(x * 255)) as RGB;
};
type Paint = { rgb: RGB; a: number };
function parseColour(v: string | undefined): Paint | null {
  if (!v) return null;
  v = v.trim();
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m) return { rgb: [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as RGB, a: 1 };
  m = v.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (m) return { rgb: hsl2rgb(+m[1], +m[2], +m[3]), a: 1 };
  m = v.match(/^rgba\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(",").map(Number);
    return { rgb: [p[0], p[1], p[2]], a: p[3] };
  }
  return null;
}
const over = (top: Paint, base: RGB): RGB =>
  top.rgb.map((c, i) => Math.round(c * top.a + base[i] * (1 - top.a))) as RGB;
const lum = (c: RGB) => {
  const [r, g, b] = c.map((x) => {
    x /= 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const A = lum(a);
  const B = lum(b);
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
};

/** Every `[data-theme=…]` block, with its custom properties, in source order. */
function themeBlocks(css: string = CSS) {
  const out: Array<{ selector: string; tokens: Record<string, string> }> = [];
  for (const m of css.matchAll(/(^|\n)([^\n{}@]*data-theme[^\n{}]*)\{([^}]*)\}/g)) {
    const tokens: Record<string, string> = {};
    for (const d of m[3].matchAll(/--([\w-]+):\s*([^;]+);/g)) tokens[d[1]] = d[2].trim();
    out.push({ selector: m[2].trim().replace(/\s+/g, " "), tokens });
  }
  return out;
}

/**
 * The tokens IN EFFECT for each (theme, mode), as the cascade applies them.
 *
 * theme-context puts `data-theme` and `class="dark"` on the SAME <html>. So in
 * dark mode the light block `[data-theme="x"]:root` still matches, and the
 * dark block `[data-theme="x"].dark` (same specificity, later in the file)
 * overrides only what it redefines. Reading the two blocks separately — as
 * this file first did — certified a dark palette that never renders: a
 * `--acr-warn-text` defined only in the light block leaked into dark mode
 * (Bedrock dark warn measured 2.75:1, base 8.33). Effective = light merged
 * with dark, and `var(--x)` resolved against that merge.
 */
function effectivePalettes(css: string = CSS) {
  const blocks = themeBlocks(css);
  const names = [...new Set(blocks.map((b) => /data-theme="([\w-]+)"/.exec(b.selector)?.[1]).filter(Boolean))] as string[];
  const out: Array<{ selector: string; theme: string; mode: "light" | "dark"; tokens: Record<string, string>; darkOwn: Record<string, string> }> = [];
  for (const name of names) {
    const mine = blocks.filter((b) => b.selector.includes(`data-theme="${name}"`));
    const light = Object.assign({}, ...mine.filter((b) => !b.selector.includes(".dark")).map((b) => b.tokens));
    const darkOwn = Object.assign({}, ...mine.filter((b) => b.selector.includes(".dark")).map((b) => b.tokens));
    const resolve = (t: Record<string, string>) => {
      const r: Record<string, string> = {};
      for (const [k, v] of Object.entries(t)) {
        let x = v;
        for (let i = 0; i < 5; i++) {
          const m = /^var\(--([\w-]+)\)$/.exec(x);
          if (!m) break;
          x = t[m[1]] ?? x;
        }
        r[k] = x;
      }
      return r;
    };
    if (light["acr-warn"] !== undefined) out.push({ selector: `[data-theme="${name}"] light`, theme: name, mode: "light", tokens: resolve(light), darkOwn });
    if (Object.keys(darkOwn).length) out.push({ selector: `[data-theme="${name}"] dark`, theme: name, mode: "dark", tokens: resolve({ ...light, ...darkOwn }), darkOwn });
  }
  return out;
}

const STATUS = ["acr-warn", "acr-accent", "acr-pos", "acr-neg"] as const;
const MAIN_SURFACES = ["acr-bg", "acr-surface", "background", "card"] as const;
const MUTED_SURFACES = ["background", "card", "muted", "popover", "sidebar-background"] as const;
const AA = 4.5;
/** The opacity of `bg-acr-<x>/15`, the wash for a status token with no -soft. */
const WASH_ALPHA = 0.15;

/** The palettes in effect — one per (theme, mode), cascade applied. */
const palettes = effectivePalettes().filter((b) => b.tokens["acr-warn"] !== undefined);

describe("status inks and muted text clear AA on every theme", () => {
  it("the contrast arithmetic is real (canary)", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    // The defect this file exists for, measured on the base token: Bedrock
    // light's fill amber as text. If this ever passes, the -text ink is no
    // longer load-bearing and the reasoning here has gone stale.
    const bedrock = palettes.find((b) => b.theme === "bedrock" && b.mode === "light");
    expect(bedrock, "Bedrock light block not found — the parser stopped reading index.css").toBeTruthy();
    const warn = parseColour(bedrock!.tokens["acr-warn"])!.rgb;
    const bg = parseColour(bedrock!.tokens["background"])!.rgb;
    expect(contrast(warn, bg)).toBeLessThan(AA);
  });

  it("the population is every theme, fully read", () => {
    // 6 themes × light/dark = 12 on 2026-10-07.
    expect(palettes.length, "theme palette blocks found").toBeGreaterThanOrEqual(12);
    for (const b of palettes) {
      for (const t of [...STATUS, ...MAIN_SURFACES, "muted-foreground", "muted", "popover", "sidebar-background"]) {
        expect(parseColour(b.tokens[t]), `${b.selector} --${t} missing or unparseable`).not.toBeNull();
      }
    }
  });

  it("text-acr-<status> clears AA on main surfaces and its own soft wash, in every theme", () => {
    const failures: string[] = [];
    for (const b of palettes) {
      const main = MAIN_SURFACES.map((s) => parseColour(b.tokens[s])!.rgb);
      for (const t of STATUS) {
        const ink = parseColour(b.tokens[`${t}-text`] ?? b.tokens[t])!.rgb;
        // A token with no -soft wash is used as `bg-acr-<x>/15` behind its own
        // ink (accent has none) — that wash is what the ink must clear.
        const base = parseColour(b.tokens[t])!;
        const soft = parseColour(b.tokens[`${t}-soft`]) ?? { rgb: base.rgb, a: WASH_ALPHA };
        const surfaces = [...main, ...(soft ? main.map((s) => over(soft, s)) : [])];
        const worst = Math.min(...surfaces.map((s) => contrast(ink, s)));
        if (worst < AA) failures.push(`${b.selector} text-${t}: ${worst.toFixed(2)}:1`);
      }
    }
    expect(
      failures,
      "a status colour used as text is under 4.5:1. Define (or darken) --<token>-text " +
        "in that theme block; do not change the fill token or hardcode a colour.",
    ).toEqual([]);
  });

  it("text-muted-foreground clears AA on every surface it renders on, including the nav rail", () => {
    const failures: string[] = [];
    for (const b of palettes) {
      const mf = parseColour(b.tokens["muted-foreground"])!.rgb;
      for (const s of MUTED_SURFACES) {
        const c = contrast(mf, parseColour(b.tokens[s])!.rgb);
        if (c < AA) failures.push(`${b.selector} muted-foreground on ${s}: ${c.toFixed(2)}:1`);
      }
    }
    expect(failures, "run: node tests/personas/fixMutedContrast.mjs").toEqual([]);
  });

  it("the muted-token fixer reads the sidebar surface", () => {
    const src = fs.readFileSync(path.join(ROOT, "tests/personas/fixMutedContrast.mjs"), "utf8");
    const sf = ts.createSourceFile("f.mjs", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    const literals: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isArrayLiteralExpression(n)) {
        const items = n.elements.filter(ts.isStringLiteral).map((e) => e.text);
        if (items.includes("background") && items.includes("card")) literals.push(...items);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(literals, "the fixer's surface list was not found").toContain("background");
    expect(literals).toContain("sidebar-background");
  });
});

describe("the text utilities actually read the ink tokens", () => {
  const src = fs.readFileSync(path.join(ROOT, "tailwind.config.ts"), "utf8");
  const sf = ts.createSourceFile("tailwind.config.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  /** textColor.acr.<key> → the call expression it is assigned. */
  function textColorAcr(): Map<string, ts.CallExpression> {
    const out = new Map<string, ts.CallExpression>();
    const visit = (n: ts.Node) => {
      if (ts.isPropertyAssignment(n) && n.name.getText(sf) === "textColor" && ts.isObjectLiteralExpression(n.initializer)) {
        for (const p of n.initializer.properties) {
          if (ts.isPropertyAssignment(p) && p.name.getText(sf) === "acr" && ts.isObjectLiteralExpression(p.initializer)) {
            for (const q of p.initializer.properties) {
              if (ts.isPropertyAssignment(q) && ts.isCallExpression(q.initializer)) out.set(q.name.getText(sf).replace(/"/g, ""), q.initializer);
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  it("textColor.acr.{warn,accent,pos,neg} resolve to var(--acr-<x>-text, var(--acr-<x>))", () => {
    const map = textColorAcr();
    for (const key of ["warn", "accent", "pos", "neg"]) {
      const call = map.get(key);
      expect(call, `textColor.acr.${key} is not mapped — text-acr-${key} falls back to the fill colour`).toBeTruthy();
      expect(call!.expression.getText(sf)).toBe("acrTextToken");
      const args = call!.arguments.map((a) => (ts.isStringLiteral(a) ? a.text : a.getText(sf)));
      expect(args).toEqual([`--acr-${key}-text`, `--acr-${key}`]);
    }
  });

  it("acrTextToken emits the ink with the base as fallback, with and without an opacity modifier", () => {
    let body = "";
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && n.name.getText(sf) === "acrTextToken" && n.initializer) body = n.initializer.getText(sf);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(body, "acrTextToken not found").not.toBe("");
    // Evaluate the arrow itself — it is a pure function of its arguments.
    const js = ts.transpileModule(`module.exports = ${body};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: undefined as unknown as (t: string, b: string) => (o?: { opacityValue?: string }) => string };
    new Function("module", js)(mod);
    const fn = mod.exports("--acr-warn-text", "--acr-warn");
    expect(fn()).toBe("var(--acr-warn-text, var(--acr-warn))");
    expect(fn({ opacityValue: "0.7" })).toContain("var(--acr-warn-text, var(--acr-warn))");
  });
});

/**
 * Status text never sits on its own SOLID fill.
 *
 * `bg-acr-accent text-acr-accent` paints a colour on itself. A mechanical
 * colour migration left 64 of these class strings across 32 modules (chips,
 * badges, the trial banner on every customer route): the after-fix crawl
 * measured the banner alone at 336 serious color-contrast nodes. No ink token
 * can fix a pairing whose two halves are the same hue at full strength, so the
 * pairing itself is forbidden: use the -soft wash with its -soft-ink, or, for
 * accent (no -soft), `bg-acr-accent/15` — the wash the ink is pinned against
 * above.
 *
 * Population: every string literal (and template piece) in every client/src
 * module, read from a TS parse so comments are never matched, with floors on
 * files and on literals that use an acr status token at all. The pairing is
 * read per variant prefix, so `dark:bg-acr-x` pairs with `dark:text-acr-x`.
 * Limit, stated: a fill on a parent and the text on a child are two literals,
 * and this check does not join them.
 */
describe("no status ink on its own solid fill", () => {
  const STATUS_KEYS = ["accent", "warn", "pos", "neg", "brand"];

  function sameFillPairs(classList: string): string[] {
    const tok = classList.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (const t of tok) {
      const m = /^((?:[\w-]+:)*)bg-acr-([a-z]+)$/.exec(t);
      if (!m || !STATUS_KEYS.includes(m[2])) continue;
      if (tok.includes(`${m[1]}text-acr-${m[2]}`)) out.push(`${m[1]}bg-acr-${m[2]} + ${m[1]}text-acr-${m[2]}`);
    }
    return out;
  }

  function literalsOf(file: string, src: string): string[] {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
    const out: string[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
      else if (ts.isTemplateExpression(n)) {
        out.push(n.head.text);
        for (const sp of n.templateSpans) out.push(sp.literal.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  }

  it("canary — the checker sees the pairing, per prefix, and only in code", () => {
    expect(sameFillPairs("rounded bg-acr-accent text-acr-accent px-2")).toHaveLength(1);
    expect(sameFillPairs("dark:bg-acr-warn dark:text-acr-warn")).toHaveLength(1);
    expect(sameFillPairs("bg-acr-warn-soft text-acr-warn-soft-ink")).toEqual([]);
    expect(sameFillPairs("bg-acr-accent/15 text-acr-accent")).toEqual([]);
    expect(sameFillPairs("bg-acr-pos dark:text-acr-pos")).toEqual([]);
    const lits = literalsOf("f.tsx", `// "bg-acr-neg text-acr-neg"\nconst c = cn("bg-acr-neg text-acr-neg", \`x \${y} bg-acr-pos text-acr-pos\`);`);
    expect(lits.flatMap(sameFillPairs)).toHaveLength(2);
  });

  it("no client module pairs a status fill with the same status text", () => {
    const CLIENT = path.join(ROOT, "client/src");
    const files: string[] = [];
    (function walk(d: string) {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(f);
      }
    })(CLIENT);
    let withStatus = 0;
    const offenders: string[] = [];
    for (const f of files) {
      for (const lit of literalsOf(f, fs.readFileSync(f, "utf8"))) {
        if (!/\bacr-(accent|warn|pos|neg|brand)\b/.test(lit)) continue;
        withStatus += 1;
        for (const p of sameFillPairs(lit)) offenders.push(`${path.relative(CLIENT, f)}: ${p}`);
      }
    }
    expect(files.length, "client/src walk").toBeGreaterThan(600);
    // ~2,000+ literals use a status token on 2026-10-08; far below = parser broke.
    expect(withStatus, "literals using an acr status token").toBeGreaterThan(1000);
    expect(
      offenders,
      "a status colour is used as text on its own solid fill. Use bg-acr-<x>-soft + " +
        "text-acr-<x>-soft-ink, or bg-acr-accent/15 + text-acr-accent.",
    ).toEqual([]);
  });
});

describe("dark mode reads the cascade, not the dark block alone", () => {
  it("every theme yields both modes", () => {
    const themes = new Set(palettes.map((p) => p.theme));
    expect(themes.size, "themes found").toBeGreaterThanOrEqual(6);
    for (const t of themes) {
      expect(palettes.filter((p) => p.theme === t).map((p) => p.mode).sort(), `${t} modes`).toEqual(["dark", "light"]);
    }
  });

  it("every dark block redefines each -text ink its light block defines", () => {
    // The structural form of the leak: a light -text with no dark counterpart
    // reaches dark mode unchanged. A -text that happens to pass AA in dark is
    // still a light-mode colour rendered in dark mode, so this is absolute.
    const missing: string[] = [];
    for (const p of palettes.filter((x) => x.mode === "dark")) {
      const light = palettes.find((x) => x.theme === p.theme && x.mode === "light");
      expect(light, `${p.theme} has no light palette`).toBeTruthy();
      for (const t of STATUS) {
        const key = `${t}-text`;
        if (light!.tokens[key] !== undefined && p.darkOwn[key] === undefined) missing.push(`${p.selector}: --${key}`);
      }
    }
    expect(missing, "define --acr-<x>-text in the dark block (var(--acr-<x>) or an AA ink)").toEqual([]);
  });

  it("canary — a light-only ink leaks into effective dark, and the checks see it", () => {
    const css = `
[data-theme="t"]:root { --acr-warn: #B97A1E; --acr-warn-text: #7C5114; --background: 38 40% 96%; }
[data-theme="t"].dark { --acr-warn: #D9A24A; --background: 30 20% 8%; }
`;
    const [light, dark] = effectivePalettes(css);
    expect(light.mode).toBe("light");
    expect(dark.mode).toBe("dark");
    // The leak: dark mode's effective ink is the LIGHT block's.
    expect(dark.tokens["acr-warn-text"]).toBe("#7C5114");
    expect(dark.darkOwn["acr-warn-text"]).toBeUndefined();
    const ink = parseColour(dark.tokens["acr-warn-text"])!.rgb;
    const bg = parseColour(dark.tokens["background"])!.rgb;
    expect(contrast(ink, bg), "the leaked light ink on a dark surface").toBeLessThan(AA);
    // And the fix shape resolves: var(--acr-warn) in the dark block.
    const fixed = effectivePalettes(css.replace("--acr-warn: #D9A24A;", "--acr-warn: #D9A24A; --acr-warn-text: var(--acr-warn);"));
    expect(fixed[1].tokens["acr-warn-text"]).toBe("#D9A24A");
  });
});
