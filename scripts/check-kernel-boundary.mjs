#!/usr/bin/env node
// ============================================================================
// scripts/check-kernel-boundary.mjs
// ----------------------------------------------------------------------------
// The kernel↔domain-pack seam (Foundry move #1). Same lightweight regex-scanner
// shape as check-boundaries.mjs — no dependency-cruiser, no TS program.
//
// THESIS (docs/internal/roadmap/foundry-decision-2026-06-24.md)
// ─────────────────────────────────────────────────────────────
// The durable, reusable asset is the domain-AGNOSTIC governed-autonomy KERNEL
// (the gate stack, the causal world-model machinery, the trust ladder, the
// operator). Each vertical contributes only a thin DOMAIN PACK through a typed
// seam (server/services/autopilot/domainPack.ts). The kernel must therefore
// carry ZERO dependency on any pack — that's what lets a second, foreign pack
// run on the UNCHANGED kernel later. This ratchet makes the boundary
// compiler/CI-enforced instead of a vision doc, exactly like the truth-immutable
// and four-door ratchets. The physical packages/kernel workspace move is
// deferred; the DISCIPLINE locks in now.
//
// RULE
// ────
// Every file listed in KERNEL_MANIFEST (the verified domain-agnostic spine) must
// NOT import:
//   K1. anything under server/services/autopilot/packs/   (a domain pack), or
//   K2. any module in LEGACY_LAND_MODULES — land-domain logic not yet physically
//       moved under packs/ but classified as pack (kernel can't reach it).
//
// Composition layers that WIRE the kernel to a specific pack (e.g.
// cognitionContext.ts) are deliberately NOT in the manifest — they are allowed
// to import a pack; they sit ABOVE the kernel, not inside it.
//
// Baseline: 0. This ratchet only tightens. New kernel modules get added to
// KERNEL_MANIFEST; if a kernel module ever needs domain data, the data moves
// into a pack and arrives through the DomainPack seam — never via a direct
// import.
//
// Exit codes: 0 = clean; 1 = a kernel→pack import, or a manifest entry whose
// file no longer exists (stale manifest can't rot).
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const AUTOPILOT = "server/services/autopilot";

// ----------------------------------------------------------------------------
// The KERNEL — the domain-agnostic governed-autonomy spine. Verified to carry
// zero land vocabulary. A vertical inherits ALL of this unchanged and supplies
// only a DomainPack. Add new domain-agnostic modules here as they're written.
// ----------------------------------------------------------------------------
const KERNEL_MANIFEST = [
  "domainPack.ts", // the seam itself
  "tenantScope.ts", // the typed accountable-scope primitive
  "proofReceipt.ts", // tamper-evident principal-attributed action receipt
  "claimsEngine.ts", // domain-agnostic content-claims screener (profile-driven)
  "cognitionBudget.ts", // per-tick cognition-call ceiling (backpressure)
  "worldModel.ts", // causal-model machinery (the AcreOS seed lives in packs/land)
  "policyGate.ts",
  "domainAutonomy.ts",
  "escalation.ts",
  "escalationLadder.ts",
  "safety.ts",
  "riskautonomy.ts",
  "operator.ts",
  "memory.ts",
  "forecast.ts",
  "decisionEval.ts",
  "settings.ts",
  "economics.ts",
  "deliberate.ts",
  "reasoning.ts",
  "experienceLog.ts",
  "policyInducer.ts",
  "shadowRegret.ts", // off-policy decision-quality (read-only; never feeds reward)
].map((f) => `${AUTOPILOT}/${f}`);

// ----------------------------------------------------------------------------
// LEGACY LAND MODULES — land-domain logic that is conceptually a PACK but hasn't
// been physically relocated under packs/ yet. The kernel may not import any of
// these. (As they migrate under packs/, rule K1 subsumes them and they can be
// dropped from this list.) Matched by basename of the resolved import.
// ----------------------------------------------------------------------------
const LEGACY_LAND_MODULES = new Set([
  "growthPlaybook",
  "growthTargets",
  "claimsGate",
  "dealActions",
  "marketingChannels",
  "attribution",
  "searchEngineSubmit",
  "searchConsoleSense",
  "publishArtifact",
  "ignitionKit",
  "funnelHealth",
  "publishGovernor",
  "growthEngine",
  "supportPlaybook",
  "lifecyclePlaybook",
]);

const PACKS_DIR_REL = `${AUTOPILOT}/packs/`;

// ----------------------------------------------------------------------------
// Import-specifier extraction (shared shape with check-boundaries.mjs).
// ----------------------------------------------------------------------------
function stripComments(source) {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return noBlocks
    .split("\n")
    .map((line) => {
      const t = line.trimStart();
      if (t.startsWith("//") || t.startsWith("*")) return "";
      return line;
    })
    .join("\n");
}

const SPEC_RE =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

function extractSpecifiers(source) {
  const specs = [];
  const lines = stripComments(source).split("\n");
  for (let i = 0; i < lines.length; i++) {
    let m;
    SPEC_RE.lastIndex = 0;
    while ((m = SPEC_RE.exec(lines[i])) !== null) {
      specs.push({ spec: m[1], line: i + 1 });
    }
  }
  return specs;
}

// Resolve a relative import to a repo-relative posix path (no extension).
function resolveRel(fileAbs, spec) {
  if (!spec.startsWith(".")) return null;
  const resolved = resolve(dirname(fileAbs), spec);
  return relative(REPO_ROOT, resolved).split("\\").join("/");
}

function classify(spec, fileAbs) {
  const rel = resolveRel(fileAbs, spec);
  if (rel === null) return null; // bare/npm import — never a pack
  // K1: anything under packs/
  if (rel.startsWith(PACKS_DIR_REL) || rel === PACKS_DIR_REL.replace(/\/$/, "")) {
    return { rule: "K1-imports-pack", detail: spec };
  }
  // K2: a legacy land module (by basename)
  const base = rel.split("/").pop().replace(/\.(ts|tsx|js|mjs)$/, "");
  if (LEGACY_LAND_MODULES.has(base)) {
    return { rule: "K2-imports-land", detail: spec };
  }
  return null;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  const violations = [];
  const missing = [];

  for (const relPath of KERNEL_MANIFEST) {
    const abs = join(REPO_ROOT, relPath);
    if (!existsSync(abs)) {
      missing.push(relPath);
      continue;
    }
    const source = readFileSync(abs, "utf8");
    for (const { spec, line } of extractSpecifiers(source)) {
      const v = classify(spec, abs);
      if (v) violations.push({ file: relPath, line, ...v });
    }
  }

  console.log(
    `[check-kernel-boundary] kernel modules: ${KERNEL_MANIFEST.length}; ` +
      `kernel→pack imports: ${violations.length}; missing manifest files: ${missing.length}`,
  );

  if (violations.length === 0 && missing.length === 0) {
    console.log("[check-kernel-boundary] PASS — the kernel imports no domain pack.");
    process.exit(0);
  }

  if (violations.length > 0) {
    console.error("");
    console.error(
      `[check-kernel-boundary] FAIL — ${violations.length} kernel→pack import(s):`,
    );
    for (const v of violations) {
      console.error(`  • ${v.file}:${v.line} [${v.rule}] imports "${v.detail}"`);
    }
    console.error("");
    console.error(
      "  The kernel is the domain-AGNOSTIC reusable spine — it must not depend",
    );
    console.error(
      "  on any domain pack. Domain data/logic belongs in a pack and reaches the",
    );
    console.error(
      "  kernel only through the typed DomainPack seam (domainPack.ts). If this",
    );
    console.error(
      "  module genuinely composes the kernel WITH a pack (like cognitionContext),",
    );
    console.error("  it isn't kernel — remove it from KERNEL_MANIFEST.");
  }

  if (missing.length > 0) {
    console.error("");
    console.error(
      `[check-kernel-boundary] FAIL — ${missing.length} stale manifest entry(ies) ` +
        "(file no longer exists — update KERNEL_MANIFEST):",
    );
    for (const m of missing) console.error(`  • ${m}`);
  }

  process.exit(1);
}

main();
