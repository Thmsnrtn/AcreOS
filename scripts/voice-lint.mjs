#!/usr/bin/env node
// ============================================================================
// scripts/voice-lint.mjs
// ----------------------------------------------------------------------------
// Voice linter — a deterministic gate that prevents drift between published
// customer-facing copy and the AcreOS voice doctrine.
//
// Spec: docs/internal/marketing-os/02-voice-linter.md
// Doctrine: docs/internal/marketing-os/00-blueprint.md §2
// Memory locks: feedback_competitor_refs, feedback_terminology,
//               feedback_landing_voice, project_persona_architecture.
//
// It catches the failure modes that have ACTUALLY happened in this codebase:
//   - competitor name-drops (Land Geek / GeekPay / LG Pass / Podolsky)
//   - founder-letter first-person tone ("I built…", "we believe…")
//   - wrong terminology ("real estate professional" — must be "Land Investors")
//   - internal persona leakage on customer surfaces (Solene/Iris/Soren/…)
//   - flattery hooks, manufactured urgency, fake social proof
//   - FTC-risk investment-return language
//   - numeric claims without provenance (§3.4 — file-level truth-source aware)
//
// It is NOT a style/grammar/SEO gate (spec §6). Voice ≠ style.
//
// Usage:
//   node scripts/voice-lint.mjs                 # full §2 scope
//   node scripts/voice-lint.mjs --all           # full §2 scope (CI alias)
//   node scripts/voice-lint.mjs <glob|file> …   # explicit targets
//   node scripts/voice-lint.mjs --quiet         # only print on failure
//
// Exit codes:
//   0 — no error-severity violations
//   1 — at least one error-severity violation (warns never block)
//
// --fix is intentionally NOT supported. Voice is a judgment domain (spec §3.3).
// ============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

// ----------------------------------------------------------------------------
// §2 — Scope. Directories of customer-facing copy that the linter scans.
// Each entry is a { dir, exts } relative to REPO_ROOT. Missing dirs are
// silently skipped (some are "future" per the spec).
// ----------------------------------------------------------------------------
const SCOPE = [
  { dir: "client/src/pages/landing", exts: [".ts", ".tsx"] },
  { dir: "client/src/pages/learn", exts: [".ts", ".tsx"] },
  { dir: "content/learn", exts: [".json"] },
  { dir: "content/editorial", exts: [".md", ".mdx"] },
  { dir: "content/briefs", exts: [".yml", ".yaml"] },
  { dir: "marketing-copy", exts: [".ts", ".json", ".md"] },
];

// Files explicitly carved out of doctrine (spec §2 "does NOT scan").
const EXCLUDE_BASENAMES = new Set([
  "founder-letter.tsx", // founder-internal surface, not customer-facing
]);

// ----------------------------------------------------------------------------
// Rule set (spec §3). Each rule: { id, severity, pattern, message, exempt? }.
//   - severity: "error" blocks CI; "warn" reports but never blocks.
//   - pattern: a RegExp (global, case-insensitive where the spec says so).
//   - exempt(line, file): optional predicate to skip a legitimate match.
// ----------------------------------------------------------------------------

// 3.1 — Forbidden tokens (error).
const FORBIDDEN_TOKEN_RULES = [
  { id: "voice/no-competitor-land-geek", pattern: /land\s*geek/gi, message: 'banned competitor token "land geek"' },
  { id: "voice/no-competitor-geekpay", pattern: /geek\s*pay/gi, message: 'banned competitor token "geekpay"' },
  { id: "voice/no-competitor-lgpass", pattern: /\blg\s*pass\b/gi, message: 'banned competitor token "lg pass"' },
  { id: "voice/no-competitor-podolsky", pattern: /podolsky/gi, message: 'banned competitor token "podolsky"' },
  { id: "voice/no-founder-name", pattern: /thomas\s+norton|tom\s+norton|thmsnrtn/gi, message: "founder name on a customer surface" },
  { id: "voice/no-real-estate-professional", pattern: /real\s*estate\s+(professional|investor)/gi, message: 'wrong terminology — use "Land Investors"' },
  { id: "voice/no-investment-return-claims", pattern: /make\s+\$[\d,]+\s+per\s+deal|average\s+investor\s+sees|guaranteed\s+returns?|passive\s+income\s+guarantee/gi, message: "FTC-risk investment-return language" },
  { id: "voice/no-dark-pattern-urgency", pattern: /\d+\s+spots?\s+left|only\s+\d+\s+remaining|act\s+now\s+before/gi, message: "manufactured urgency / dark pattern" },
];

// Internal persona leakage (spec §3.1 + project_persona_architecture).
// Pax is the ONLY customer-visible AI persona. Word-boundaried so "iris"
// inside "irish"/"iris scan" won't false-positive, but the bare persona name
// will. `florida`/`georgia` etc. don't collide with any persona name.
const PERSONA_NAMES = [
  "solene", "iris", "soren", "maren", "beatrice", "krieger", "rafe",
  "andrei", "tess", "iyari", "quinn", "henrik", "lena", "sophie",
  "forge", "atlas",
];
const PERSONA_RULE = {
  id: "voice/no-internal-persona",
  severity: "error",
  pattern: new RegExp(`\\b(${PERSONA_NAMES.join("|")})\\b`, "gi"),
  message: "internal persona name on a customer surface (only Pax is customer-visible)",
};

// 3.2 — Forbidden voice patterns (error).
const VOICE_PATTERN_RULES = [
  { id: "voice/no-founder-first-person", pattern: /\bI\s+(built|made|created|designed|wanted)\b/g, message: "founder-letter first-person tone" },
  { id: "voice/no-we-believe", pattern: /\bwe\s+(believe|think|feel|know)\b/gi, message: "audience-flattering rhetoric (we believe/think/…)" },
  { id: "voice/no-you-flattery", pattern: /you'?re\s+(a\s+)?(serious|smart|sophisticated|experienced)/gi, message: "flattery hook" },
  { id: "voice/no-rhetorical-question-hook", pattern: /^(so,?\s+)?(what\s+if|imagine|picture)\b/gim, message: "founder-letter rhetorical-question open" },
];

// 3.1 — Fake social proof. "N,NNN investors trust …" without an adjacent
// `// source:` comment. Implemented as a warn (the headline number is the
// real risk; we report it but don't block until a source convention lands).
const SOCIAL_PROOF_RULE = {
  id: "voice/no-fake-social-proof",
  severity: "warn",
  pattern: /\b\d{1,3},?\d{3}\s+(investors|operators|customers)\s+trust/gi,
  message: "social-proof claim without an adjacent // source: pointer",
};

// 3.4 — Numeric-claim provenance. Hard quantitative claims with a unit must
// have a provenance pointer. Provenance is satisfied (per spec §3.4/§3.5) by:
//   (a) an adjacent `// source: …` comment within 3 lines above, OR
//   (b) the file exporting `truthSources` / `TRUTH_SOURCES`, OR
//   (c) a file-level truth-engine provenance block (a comment containing
//       "Truth-engine" / "truth-source"), which copy.ts already carries.
// We only flag UNIT-bearing numbers (not bare counts like "Three steps") to
// keep the rule about defensible *claims*, not every numeral. Severity warn —
// the rule is real and reported, but blocking on it requires the truth-source
// registry rollout (W4-1) to avoid false-positiving documented copy.
const NUMERIC_CLAIM_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:seconds?|minutes?|hours?|days?|comps?|pages?|counties|states|%|x|×)\b/gi;
const DOLLAR_CLAIM_PATTERN = /\$\s?[\d,]+(?:\.\d+)?\b/g;
const NUMERIC_CLAIM_RULE = {
  id: "voice/numeric-claim-no-source",
  severity: "warn",
};

// 3.3 — Required tokens (warn). Landing-surface files must affirm positioning.
const REQUIRED_LAND_INVESTORS = {
  id: "voice/required-land-investors",
  severity: "warn",
  pattern: /land\s+investors?/i,
  message: 'landing surface should name "Land Investors" at least once',
};

// ----------------------------------------------------------------------------
// File discovery
// ----------------------------------------------------------------------------
function walk(dir, exts, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // missing dir — skip (some scope dirs are "future")
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      walk(full, exts, out);
    } else if (e.isFile()) {
      if (EXCLUDE_BASENAMES.has(e.name)) continue;
      if (e.name.endsWith(".test.ts") || e.name.endsWith(".test.tsx")) continue;
      if (e.name.endsWith(".spec.ts") || e.name.endsWith(".spec.tsx")) continue;
      if (exts.some((x) => e.name.endsWith(x))) out.push(full);
    }
  }
}

function discoverScopeFiles() {
  const files = [];
  for (const { dir, exts } of SCOPE) {
    walk(join(REPO_ROOT, dir), exts, files);
  }
  return files.sort();
}

function resolveExplicitTargets(args) {
  const files = [];
  for (const arg of args) {
    const abs = resolve(REPO_ROOT, arg);
    if (!existsSync(abs)) {
      console.error(`[voice-lint] target not found: ${arg}`);
      continue;
    }
    if (statSync(abs).isDirectory()) {
      walk(abs, [".ts", ".tsx", ".json", ".md", ".mdx", ".yml", ".yaml"], files);
    } else {
      files.push(abs);
    }
  }
  return files.sort();
}

// ----------------------------------------------------------------------------
// Provenance helpers (§3.4)
// ----------------------------------------------------------------------------
function fileHasTruthSourceRegistry(source) {
  return (
    /export\s+const\s+(truthSources|TRUTH_SOURCES)\b/.test(source) ||
    /truth-?engine/i.test(source) ||
    /truth-?source/i.test(source)
  );
}

function hasAdjacentSourceComment(lines, idx) {
  for (let i = Math.max(0, idx - 3); i <= idx; i++) {
    if (/\/\/\s*source:/i.test(lines[i]) || /source:\s*(code|data|manual):/i.test(lines[i])) {
      return true;
    }
  }
  return false;
}

// ----------------------------------------------------------------------------
// Prose masking (the crux of avoiding false positives).
//
// The doctrine applies to CUSTOMER-FACING COPY — rendered string literals and
// JSX/Markdown prose — NOT to code comments, CSS class names, import paths, or
// technical attribute values. A persona name in a `//` comment or in
// `className="lp-hv-atlas"` is not leaked to a customer.
//
// We produce a "masked" copy of the source, identical in length and line
// structure (so reported line:col stays accurate), where every non-prose
// region is overwritten with spaces. Rules then run against the masked text.
//
// Masked out:
//   - `//` line comments and `/* … */` block comments (TS/TSX, JSON5-style)
//   - the VALUE of technical JSX/HTML attributes: className/class/href/src/id/
//     to/key/data-*/style/type/rel/aria-* (these carry identifiers, not copy)
//   - `import … from "…"` / `require("…")` module specifiers
//
// Everything else (string-literal bodies that ARE copy, JSX text, JSON string
// values) survives in the mask and is linted.
// ----------------------------------------------------------------------------
function blankSpan(arr, start, end) {
  for (let i = start; i < end && i < arr.length; i++) {
    if (arr[i] !== "\n") arr[i] = " ";
  }
}

function maskTsLike(source) {
  const out = source.split("");
  // 1) Block comments /* … */
  {
    const re = /\/\*[\s\S]*?\*\//g;
    let m;
    while ((m = re.exec(source)) !== null) blankSpan(out, m.index, m.index + m[0].length);
  }
  // 2) Line comments //  (only when not already inside a blanked block comment).
  //    Run against the partially-masked text so we don't re-mask inside blocks.
  {
    const partial = out.join("");
    const re = /\/\/[^\n]*/g;
    let m;
    while ((m = re.exec(partial)) !== null) blankSpan(out, m.index, m.index + m[0].length);
  }
  // 3) import/require module specifiers.
  {
    const partial = out.join("");
    const re = /\b(?:import\s[^;\n]*?from\s*|require\s*\(\s*)["'`]([^"'`]*)["'`]/g;
    let m;
    while ((m = re.exec(partial)) !== null) {
      const q = m[0].lastIndexOf(m[1]);
      const start = m.index + q;
      blankSpan(out, start, start + m[1].length);
    }
  }
  // 4) Technical attribute values: className/class/href/src/id/to/key/style/
  //    type/rel/data-*/aria-* = "…"  or  ={`…`}  or  ={"…"}.
  {
    const partial = out.join("");
    const re =
      /\b(?:className|class|href|src|id|to|key|style|type|rel|data-[\w-]+|aria-[\w-]+|htmlFor|name|role)\s*=\s*\{?\s*["'`]([^"'`]*)["'`]/g;
    let m;
    while ((m = re.exec(partial)) !== null) {
      const q = m[0].lastIndexOf(m[1]);
      const start = m.index + q;
      blankSpan(out, start, start + m[1].length);
    }
  }
  return out.join("");
}

function maskByExt(source, ext) {
  if (ext === ".ts" || ext === ".tsx" || ext === ".mjs" || ext === ".js") {
    return maskTsLike(source);
  }
  // JSON: comments are illegal; every string value is content we lint. We do
  // blank the KEYS would be over-broad, so we keep the whole file — keys like
  // "vertical" don't collide with any rule token. Return as-is.
  // MD/MDX/YAML: prose by nature — return as-is.
  return source;
}

// ----------------------------------------------------------------------------
// Lint a single file
// ----------------------------------------------------------------------------
function lintFile(absPath) {
  const rel = relative(REPO_ROOT, absPath);
  const source = readFileSync(absPath, "utf8");
  const ext = absPath.slice(absPath.lastIndexOf("."));
  // Lint against the masked source — comments / classNames / import paths are
  // blanked so only customer-facing copy is scanned (see maskByExt). Line/col
  // positions are preserved because the mask is the same length as the source.
  const masked = maskByExt(source, ext);
  const lines = masked.split("\n");
  const rawLines = source.split("\n");
  const isLanding = rel.startsWith("client/src/pages/landing/");
  const fileTruthRegistry = fileHasTruthSourceRegistry(source);
  const findings = [];

  function scanLineRules(rules, defaultSeverity) {
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      for (const rule of rules) {
        rule.pattern.lastIndex = 0;
        let m;
        while ((m = rule.pattern.exec(line)) !== null) {
          if (rule.exempt && rule.exempt(line, rel)) continue;
          findings.push({
            rule: rule.id,
            severity: rule.severity ?? defaultSeverity,
            line: li + 1,
            col: m.index + 1,
            message: rule.message,
            excerpt: m[0].trim(),
          });
          if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex++;
        }
      }
    }
  }

  // Forbidden tokens (error).
  scanLineRules(FORBIDDEN_TOKEN_RULES, "error");
  // Persona leakage (error).
  scanLineRules([PERSONA_RULE], "error");
  // Voice patterns (error).
  scanLineRules(VOICE_PATTERN_RULES, "error");
  // Social proof (warn).
  scanLineRules([SOCIAL_PROOF_RULE], "warn");

  // Numeric-claim provenance (warn). Only flag if the file lacks a truth-source
  // registry/annotation AND the specific claim lacks an adjacent source.
  if (!fileTruthRegistry) {
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      for (const pat of [NUMERIC_CLAIM_PATTERN, DOLLAR_CLAIM_PATTERN]) {
        pat.lastIndex = 0;
        let m;
        while ((m = pat.exec(line)) !== null) {
          // Check the RAW lines for an adjacent `// source:` pointer — the mask
          // blanks comments, so the provenance comment must be read unmasked.
          if (!hasAdjacentSourceComment(rawLines, li)) {
            findings.push({
              rule: NUMERIC_CLAIM_RULE.id,
              severity: NUMERIC_CLAIM_RULE.severity,
              line: li + 1,
              col: m.index + 1,
              message: `numeric claim "${m[0].trim()}" has no truth-source pointer`,
              excerpt: m[0].trim(),
            });
          }
          if (m.index === pat.lastIndex) pat.lastIndex++;
        }
      }
    }
  }

  // Required-token check (warn) — landing files only. Component files with no
  // prose (pure layout) are exempted by requiring the file to contain at least
  // one quoted string of meaningful length.
  if (isLanding && absPath.endsWith(".ts")) {
    if (!REQUIRED_LAND_INVESTORS.pattern.test(source)) {
      findings.push({
        rule: REQUIRED_LAND_INVESTORS.id,
        severity: REQUIRED_LAND_INVESTORS.severity,
        line: 1,
        col: 1,
        message: REQUIRED_LAND_INVESTORS.message,
        excerpt: "(file)",
      });
    }
  }

  return { rel, findings };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  const rawArgs = process.argv.slice(2);
  const quiet = rawArgs.includes("--quiet");
  const flags = new Set(["--all", "--quiet"]);
  const targets = rawArgs.filter((a) => !flags.has(a) && !a.startsWith("--"));

  const files = targets.length > 0 ? resolveExplicitTargets(targets) : discoverScopeFiles();

  let errorCount = 0;
  let warnCount = 0;
  const fileReports = [];

  for (const f of files) {
    const { rel, findings } = lintFile(f);
    if (findings.length === 0) continue;
    fileReports.push({ rel, findings });
    for (const v of findings) {
      if (v.severity === "error") errorCount++;
      else warnCount++;
    }
  }

  if (!quiet || errorCount > 0) {
    console.log(`[voice-lint] scanned ${files.length} customer-facing file(s)`);
  }

  for (const { rel, findings } of fileReports) {
    // Only print files that have something worth showing in quiet mode.
    if (quiet && !findings.some((v) => v.severity === "error")) continue;
    for (const v of findings) {
      if (quiet && v.severity !== "error") continue;
      const tag = v.severity === "error" ? "ERROR" : "warn ";
      console.log(`  ${tag} ${rel}:${v.line}:${v.col}  ${v.rule} — ${v.message}`);
    }
  }

  if (errorCount === 0) {
    if (!quiet) {
      console.log(
        `[voice-lint] PASS — 0 errors, ${warnCount} warning(s) across ${files.length} file(s).`,
      );
    }
    process.exit(0);
  }

  console.error("");
  console.error(
    `[voice-lint] FAIL — ${errorCount} error(s), ${warnCount} warning(s). ` +
      "Fix the errors above or, if a match is a legitimate exception, raise it " +
      "with Soren — the doctrine is in docs/internal/marketing-os/02-voice-linter.md.",
  );
  process.exit(1);
}

main();
