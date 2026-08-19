// scripts/check-model-prefix.mjs — every model id names a model the client it
// is handed to actually serves.
//
// ── THE DEFECT ──────────────────────────────────────────────────────────────
// `server/utils/openaiClient.ts` is named `getOpenAIClient`, and it returns an
// OPENROUTER client. Its own docblock says so ("Platform AI is OpenRouter-only
// … the previous OpenAI fallback was a cost trap"). Sixty-odd call sites across
// thirty-one files believed the name and passed OpenAI's bare model ids —
// `gpt-4o`, `gpt-4o-mini`, `claude-opus-4` — to it.
//
// Measured against the live catalogue on 2026-08-19 (415 models):
//
//   gpt-4o        absent from the catalogue AND 404 on /models/{id}/endpoints
//   gpt-4o-mini   same
//   openai/gpt-4o        present, 200
//   openai/gpt-4o-mini   present, 200
//
// `/models/{id}/endpoints` normalises hyphens to dots but does NOT supply a
// missing author prefix, so this is not a naming nicety — the request 404s.
//
// ── WHY A SOURCE SCAN AND NOT A LIVE PROBE ──────────────────────────────────
// `scripts/check-model-ids.mjs` does the live probe, and refuses when it cannot
// reach the catalogue. This gate is the OFFLINE half: it runs with no network
// and no key, and it enforces the shape rule the probe's findings imply. A
// gate that needs the network is a gate that goes green in the one environment
// that cannot check.
//
// ── WHAT IT GOVERNS ─────────────────────────────────────────────────────────
// Not "the string gpt-4o must not appear" — that proves a symbol. It governs
// the BEHAVIOUR: a model identifier reaching a provider must be one that
// provider serves. So it looks at model-carrying keys anywhere in server/,
// requires an `author/slug` prefix, and carries a small register of ids that
// are deliberately bare, each with the reason it is.
//
// Comments are stripped before scanning. A docblock showing a caller how to
// pass a model id is documentation, not a request — and this repository has
// already been bitten once by a scanner that could not tell the difference
// (see scripts/lib/strip-comments.mjs).
//
//   node scripts/check-model-prefix.mjs             # gate (part of npm run check)
//   node scripts/check-model-prefix.mjs --report    # print every literal seen

import { readFileSync, readdirSync, lstatSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripCommentsPreservingLines, verifyStripper } from "./lib/strip-comments.mjs";

const TAG = "[model-prefix]";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = process.argv.includes("--report");

/**
 * Ids that are deliberately BARE, with the reason. Each entry is a claim that
 * can be checked, not a mute button.
 *
 * The two rules for adding one: the client it is handed to must be a direct
 * provider client (not the OpenRouter-backed platform helper), and the reason
 * must say which client and why.
 */
const BARE_ID_REGISTER = {
  "whisper-1": {
    reason:
      "OpenAI audio transcription. NOT settled: the OpenRouter route " +
      "/api/v1/audio/transcriptions exists (401 unauthenticated, vs 404 for a " +
      "route that does not), but no whisper-* id appears in the 415-model " +
      "catalogue, and which ids that endpoint accepts cannot be enumerated " +
      "without a key. server/routes-field-scout.ts is the sanctioned pattern — " +
      "it reads OPENAI_API_KEY directly — while voiceCallAI.ts and " +
      "routes-ai.ts call it on the OpenRouter-backed helper, which " +
      "openaiClient.ts's own docblock forbids. Registered rather than " +
      "rewritten because rewriting on an unverified premise could move spend " +
      "to a key that may not be configured. On the frontier.",
  },
  "dall-e-3": {
    reason:
      "OpenAI image generation, same unsettled shape as whisper-1: " +
      "/api/v1/images/generations exists at OpenRouter (400 on an empty body, " +
      "so the route is real) but no dall-e-* id is in the catalogue. " +
      "adCreativeService.ts calls it on the OpenRouter-backed helper. On the " +
      "frontier.",
  },
  "text-embedding-3-small": {
    reason:
      "OpenAI embeddings, same unsettled shape: /api/v1/embeddings exists at " +
      "OpenRouter (401) but no embedding id is in the catalogue. " +
      "dealPatternCloning.ts calls it on the OpenRouter-backed helper. On the " +
      "frontier.",
  },
  "gpt-4o": {
    reason:
      "server/services/models.ts only — OPENAI_DIRECT_MODELS holds the BARE " +
      "OpenAI names on purpose, because `openAiModelIdFor()` is the function " +
      "that decides which of the two namespaces a caller needs. The register " +
      "is scoped to that file below.",
    onlyIn: ["server/services/models.ts"],
  },
  "gpt-4o-mini": {
    reason: "As gpt-4o above — OPENAI_DIRECT_MODELS, models.ts only.",
    onlyIn: ["server/services/models.ts"],
  },
  cache: {
    reason:
      "Not a model id, and deliberately so. aiRouter's cascade telemetry stamps " +
      "it on a cache hit — `model: \"cache\"` sits directly beside " +
      "`cacheHit: true` and `costCents: 0`. Naming a real model there would " +
      "attribute a call nobody made to a model nobody used.",
    onlyIn: ["server/services/aiRouter.ts"],
  },
  simulation: {
    reason:
      "Not a model id. utils/openaiClient.ts stamps it on the synthetic " +
      "response SIMULATION_MODE_AI_PAID returns, precisely so a reader can " +
      "tell simulated output from real.",
  },
};

/**
 * Keys whose value is a model identifier handed to a provider or recorded as
 * the model that was. `modelKey`/`aiModel` are included because a label that
 * names a model nobody called is the same defect one step downstream — it is
 * what a cost or eval surface reads back.
 */
const MODEL_KEY_RE =
  /\b(model|modelKey|modelId|aiModel|forceModel|tierCeilingModel)\s*:\s*(["'])([^"'\n]+)\2/g;

const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "test-results"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry) || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry) && !/\.(test|spec)\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

// A stripper that silently returned "" would find zero literals and report a
// clean bill of health, so its correctness is established before it is used.
const [strOk, strTotal] = verifyStripper();
if (strOk !== strTotal) {
  console.error(
    `${TAG} the comment stripper fails ${strTotal - strOk} of its own ${strTotal} ` +
      `cases. Every scan below would have read corrupted source. Refusing.`,
  );
  process.exit(1);
}

const files = walk(join(ROOT, "server"));
const findings = [];
let literalsSeen = 0;

for (const abs of files) {
  const rel = relative(ROOT, abs).split("\\").join("/");
  const code = stripCommentsPreservingLines(readFileSync(abs, "utf8"));
  MODEL_KEY_RE.lastIndex = 0;
  let m;
  while ((m = MODEL_KEY_RE.exec(code)) !== null) {
    const id = m[3];
    literalsSeen++;
    if (REPORT) {
      const line = code.slice(0, m.index).split("\n").length;
      console.log(`  · ${rel}:${line}  ${m[1]}: ${id}`);
    }
    if (/^[a-z0-9-]+\/.+/.test(id)) continue; // prefixed — the shape that works
    const reg = BARE_ID_REGISTER[id];
    if (reg && (!reg.onlyIn || reg.onlyIn.includes(rel))) continue;
    const line = code.slice(0, m.index).split("\n").length;
    findings.push({ rel, line, key: m[1], id, scoped: Boolean(reg) });
  }
}

// VACUITY GUARD, checked before the verdict. A walk that stops seeing files, or
// a regex that stops matching, finds nothing and reports it as compliance.
// MEASURED 2026-08-19: 1379 files, 62 model literals. Floors well under both.
const FILE_FLOOR = 900;
const LITERAL_FLOOR = 30;
if (files.length < FILE_FLOOR || literalsSeen < LITERAL_FLOOR) {
  console.error(
    `${TAG} VACUITY — walked ${files.length} files (floor ${FILE_FLOOR}) and saw ` +
      `${literalsSeen} model literals (floor ${LITERAL_FLOOR}). A scan that sees ` +
      `nothing certifies every model id in the repo. Fix the walk or the ` +
      `pattern; do NOT lower these floors to make this pass.`,
  );
  process.exit(1);
}

console.log(
  `${TAG} walked ${files.length} server files; ${literalsSeen} model literals ` +
    `considered; comment-stripper self-test: ${strOk}/${strTotal} correct; ` +
    `${Object.keys(BARE_ID_REGISTER).length} registered bare ids`,
);

if (findings.length > 0) {
  console.error(
    `${TAG} FAIL — a model id with no \`author/slug\` prefix. The platform AI ` +
      `client is OpenRouter (utils/openaiClient.ts, despite its name), and ` +
      `OpenRouter 404s bare OpenAI names:`,
  );
  for (const f of findings) {
    console.error(
      `  ✗ ${f.rel}:${f.line}  ${f.key}: "${f.id}"` +
        (f.scoped ? "  — registered, but not for this file" : ""),
    );
  }
  console.error(
    `\n  Prefix it (\`openai/gpt-4o\`), or route it through \`MODELS\` in\n` +
      `  server/services/models.ts. If the client really is a DIRECT provider\n` +
      `  client, use \`openAiModelIdFor(baseURL, …)\` so the id follows the\n` +
      `  client instead of assuming — that is the whole reason both names\n` +
      `  exist. Registering an id here requires naming the client and why.`,
  );
  process.exit(1);
}

console.log(`${TAG} PASS — every model id carries a provider prefix or a registered reason.`);
