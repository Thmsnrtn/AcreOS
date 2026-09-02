/**
 * Banned words — the customer never reads the machine's vocabulary
 * (AUTONOMY_SPEC.md §2 "Banned words", §7 paxControlsSurfaceIsHonest).
 *
 * The pre-program surfaces described the same idea as "autopilot", an
 * "autonomy level", a "slider", "Suggest only / Ask first / Act & tell",
 * "witnessed", "kernel" and a cast of codenames. The customer model has two
 * stances, one pause, one queue. This test scans the STRING LITERALS of the
 * program's files for the words the spec bans and fails on any hit.
 *
 * POPULATION (wave 0): the six files this program authored. They are listed
 * by name, each must exist, and each must yield string literals — a scanner
 * that stops matching one file reads exactly like that file being clean.
 * Wave 1 F extends the population to client/src/pages/**,
 * client/src/components/** and client/src/pages/landing/** (founder
 * directories allowlisted, per-directory vacuity) in
 * paxControlsSurfaceIsHonest.test.ts, and adds the checks that need the
 * page: the stance strings come from the glossary, "what Pause stops" is
 * rendered from UNATTENDED_PATHS, PAX_CONTROLS_PATH resolves in App.tsx.
 *
 * Comments and identifiers are NOT scanned — `paxAskExecutors.ts` is a file
 * name, not a sentence — and neither are import specifiers or bare
 * identifier-shaped strings ("ask_before_sending", "/settings/pax"). The one
 * honest exception the spec keeps, "Not yet live", is allowlisted.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

/** Files whose string literals a customer can read. Wave 1 F widens this. */
const POPULATION = [
  "shared/pax-glossary.ts",
  "shared/pax-controls.ts",
  "server/services/paxControls.ts",
  "server/services/paxReceipts.ts",
  "server/services/paxAskSummary.ts",
  "server/services/paxAskExecutors.ts",
] as const;

/** Spec §2. Case-insensitive unless the label is a proper noun or a product label. */
const BANNED: Array<{ word: string; re: RegExp }> = [
  { word: "autopilot", re: /\bautopilot\b/i },
  { word: "autonomy / autonomous(ly)", re: /\bautonom(?:y|ous|ously)\b/i },
  { word: "unattended", re: /\bunattended\b/i },
  { word: "slider", re: /\bslider\b/i },
  { word: "threshold", re: /\bthreshold\b/i },
  { word: "matrix", re: /\bmatrix\b/i },
  { word: "assisted (label)", re: /\bassisted\b/i },
  { word: "supervised (label)", re: /\bsupervised\b/i },
  { word: "Observe / Draft / Execute", re: /\bObserve\s*\/\s*Draft\s*\/\s*Execute\b/i },
  { word: "Suggest only", re: /\bSuggest only\b/i },
  { word: "Ask first", re: /\bAsk first\b/i },
  { word: "Act & tell", re: /\bAct & tell\b/i },
  { word: "Review-then-send", re: /\bReview-then-send\b/i },
  { word: "Auto-send", re: /\bAuto-send\b/i },
  { word: "Auto above N%", re: /\bAuto above\b/i },
  { word: "confidence %", re: /confidence\s*%/i },
  { word: "Pax would handle", re: /\bPax would handle\b/i },
  { word: "Override", re: /\bOverride\b/ },
  { word: "agent / agents", re: /\bagents?\b/i },
  { word: "co-pilot / coworker", re: /\bco-?(?:pilot|worker)\b/i },
  { word: "VA", re: /\bVA\b/ },
  { word: "codename", re: /\b(?:Atlas|Sophie|Solene|Forge|Samantha|Alex|Maya|Charlie|Riley)\b/ },
  { word: "AI Hub", re: /\bAI Hub\b/i },
  { word: "Command center", re: /\bCommand center\b/i },
  { word: "AI Tasks", re: /\bAI Tasks\b/i },
  { word: "witnessed", re: /\bwitnessed\b/i },
  { word: "kernel", re: /\bkernel\b/i },
  { word: "executor", re: /\bexecutors?\b/i },
  { word: "envelope", re: /\benvelope\b/i },
  { word: "trace (not skip-trace)", re: /(?<!skip[- ])\btrace\b/i },
  { word: "circuit breaker", re: /\bcircuit breaker\b/i },
  { word: "manual-only", re: /\bmanual-only\b/i },
  { word: "Reset Pax", re: /\bReset Pax\b/i },
  { word: "cost-saving / full-power mode", re: /\b(?:cost-saving|full-power) mode\b/i },
  { word: "dunning", re: /\bdunning\b/i },
  { word: "Settings → Pax controls", re: /Settings → Pax controls/ },
  { word: "Pax > Controls", re: /Pax > Controls/ },
  { word: "$0.02 per task", re: /\$0\.02 per task/ },
  { word: "Insights (menu label)", re: /\bInsights\b/ },
  { word: "Pax always asks before taking an action", re: /Pax always asks before taking an action/i },
  { word: "it never decides for you", re: /it never decides for you/i },
  { word: "Pax can take real actions", re: /Pax can take real actions/i },
];

const ALLOWED_PHRASES = ["Not yet live"];

interface Literal {
  text: string;
  line: number;
  /** Preceded by `from ` / `import(` — a module path, never prose. */
  isImport: boolean;
}

/**
 * String literals of a TS file, with comments skipped. Template literals are
 * captured whole (their `${…}` text included — it is never prose). Regex
 * literals in the population contain no quotes, so a `/` that is not `//` or
 * `/*` is treated as code.
 */
function stringLiterals(src: string): Literal[] {
  const out: Literal[] = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "\n") {
      line++;
      i++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const startLine = line;
      const before = src.slice(Math.max(0, i - 12), i);
      let j = i + 1;
      let text = "";
      while (j < n && src[j] !== quote) {
        if (src[j] === "\\") {
          text += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (src[j] === "\n") line++;
        text += src[j];
        j++;
      }
      out.push({ text, line: startLine, isImport: /(?:from\s*|import\s*\()$/.test(before) });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

/** Identifier-, path-, or key-shaped: never a sentence a customer reads. */
function isMachineToken(text: string): boolean {
  if (/\s/.test(text)) return false;
  return /[/_.:@]/.test(text) || text === text.toLowerCase();
}

function scan(rel: string): { scanned: Literal[]; hits: string[] } {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const scanned = stringLiterals(src).filter((l) => !l.isImport && l.text.length > 0 && !isMachineToken(l.text));
  const hits: string[] = [];
  for (const lit of scanned) {
    let text = lit.text;
    for (const ok of ALLOWED_PHRASES) text = text.split(ok).join(" ");
    for (const b of BANNED) {
      if (b.re.test(text)) hits.push(`${rel}:${lit.line}  [${b.word}]  ${JSON.stringify(lit.text).slice(0, 120)}`);
    }
  }
  return { scanned, hits };
}

describe("the scanner can see (vacuity)", () => {
  it("every population file exists and yields prose-shaped string literals", () => {
    let total = 0;
    for (const rel of POPULATION) {
      expect(fs.existsSync(path.join(ROOT, rel)), `${rel} is gone — update the population`).toBe(true);
      const { scanned } = scan(rel);
      expect(scanned.length, `${rel} yielded ${scanned.length} scannable strings`).toBeGreaterThanOrEqual(3);
      total += scanned.length;
    }
    expect(total).toBeGreaterThan(40);
  });

  it("flags a planted sentence and ignores comments, imports and identifiers", () => {
    const fixture = [
      'import { x } from "./autopilot-agent";',
      "// autopilot in a comment is not a customer word",
      "/* the kernel, in a block comment */",
      'const origin = "autopilot";',
      'const label = "Full autopilot";',
      "const line = `Every ${thing} waits for your tap.`;",
    ].join("\n");
    const literals = stringLiterals(fixture).filter((l) => !l.isImport && !isMachineToken(l.text));
    expect(literals.map((l) => l.text)).toEqual(["Full autopilot", "Every ${thing} waits for your tap."]);
    const banned = BANNED.filter((b) => b.re.test("Full autopilot")).map((b) => b.word);
    expect(banned).toContain("autopilot");
  });

  it("the skip-trace exception is narrow", () => {
    const trace = BANNED.find((b) => b.word.startsWith("trace"))!;
    expect(trace.re.test("skip-trace from chat")).toBe(false);
    expect(trace.re.test("skip trace from chat")).toBe(false);
    expect(trace.re.test("see the trace")).toBe(true);
  });
});

describe("no banned word reaches a customer string", () => {
  for (const rel of POPULATION) {
    it(rel, () => {
      const { hits } = scan(rel);
      expect(hits.join("\n"), "banned vocabulary in a customer-readable string").toBe("");
    });
  }
});
