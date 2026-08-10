/**
 * Founder Autopilot — code-change safety classifier (Elite Vision H2: immune system).
 *
 * The load-bearing guardrail for autonomous self-repair. Before the system may
 * ever propose a fix to its own code, this classifies the change into exactly
 * one of three tiers — and it is deliberately CONSERVATIVE: the default is
 * "witnessed" (needs the founder's tap), and only a narrow, explicitly-safe
 * class may ever auto-handle.
 *
 *   • forbidden  — never autonomous, even witnessed through this path. The
 *                  things the immune system must never touch on its own: the
 *                  constitution/immutables, ALL CI workflows, the truth/lint
 *                  ratchets + their baselines, the governance registries, the
 *                  unit-test estate, the gate-tamper watch + its manifest,
 *                  auth + encryption cores, AND this gate itself (no
 *                  self-modification of the guardrail).
 *   • safe_auto  — may auto-open a PR for the SAFE CLASS only: a dependency
 *                  PATCH-version bump (npm audit fix) touching only package.json
 *                  / lockfile, no new deps, no minor/major. Still goes through
 *                  full CI + the deploy gate; "auto" means no founder tap to
 *                  open the PR, never "skip the tests".
 *   • witnessed  — everything else: source fixes, minor/major deps, migrations,
 *                  config. Freezes for the founder's approval (the H1 seam).
 *
 * Pure + total → exhaustively unit-testable. This module classifies; it never
 * acts. Acting is gated behind this + earned autonomy + the execution seam + the
 * (off-by-default) git capability.
 */

export type CodeChangeClass = "safe_auto" | "witnessed" | "forbidden";

export interface DepChange {
  name: string;
  fromVersion: string;
  toVersion: string;
}

export interface ProposedChange {
  /** Repo-relative paths the change touches. */
  files: string[];
  /** Dependency version changes, when the change is a dep bump. */
  depChanges?: DepChange[];
  description?: string;
}

export interface CodeChangeVerdict {
  class: CodeChangeClass;
  reasons: string[];
}

/**
 * Files/areas the immune system must NEVER modify autonomously. Matched as
 * substrings of the repo-relative path (lowercased) — conservative on purpose.
 * Includes THIS gate so the guardrail can't weaken itself.
 */
const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  "immutable", // @sovereign/immutables, constitution data
  "constitution", // constitutionalGuard, preCallConstitutionalChecker
  "codechangegate", // this guardrail itself
  // F3 "eternal lines" (2026-08): the original list named only the security +
  // deploy workflows, leaving ci/test and every other CI lane touchable. ALL
  // workflows are gates — widen to the whole directory.
  ".github/workflows",
  "scripts/lint-no-fabrication", // the truth ratchet
  "scripts/lint-eslint-ratchet",
  "scripts/lint-truth",
  "scripts/ratchet", // ratchet.mjs evaluator + every scripts/ratchets/*.json baseline
  "statuteregister", // shared/governance/statuteRegister.ts (matched lowercased)
  "tests/unit", // the ratchet-test estate — the immune system never edits tests
  "gatetamper", // gateTamperWatch.ts + gateTamperManifest.json (the tamper watch may not be tampered)
  "gate-manifest", // scripts/regenerate-gate-manifest.mjs — the manifest's only sanctioned writer
  "server/auth", // auth core
  "server/services/encryption", // encryption core
  "approvalkernel", // the witnessed-send kernel
  "pendinghands", // the autopilot execution seam
];

/** Files allowed in a safe_auto dependency bump — nothing else may be touched. */
const SAFE_AUTO_FILES = new Set(["package.json", "package-lock.json"]);

function norm(p: string): string {
  return p.replace(/^\.\//, "").toLowerCase();
}

/** Pure: is `to` a patch-only bump of `from` (same major.minor, patch ≥)? */
export function isPatchBump(from: string, to: string): boolean {
  const parse = (v: string): [number, number, number] | null => {
    const m = /^\D*(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  };
  const a = parse(from);
  const b = parse(to);
  if (!a || !b) return false;
  // same major AND same minor, patch strictly greater (a real upgrade).
  return a[0] === b[0] && a[1] === b[1] && b[2] > a[2];
}

/**
 * Classify a proposed self-repair change. Conservative: forbidden wins over
 * everything; safe_auto requires the WHOLE change to be a clean patch bump;
 * default is witnessed.
 */
export function classifyCodeChange(change: ProposedChange): CodeChangeVerdict {
  const files = (change.files ?? []).map(norm);
  const reasons: string[] = [];

  // 1. Forbidden — any touched file in a protected area.
  const forbiddenHits = files.filter((f) => FORBIDDEN_SUBSTRINGS.some((s) => f.includes(s)));
  if (forbiddenHits.length > 0) {
    return { class: "forbidden", reasons: [`touches protected area(s): ${forbiddenHits.join(", ")}`] };
  }
  if (files.length === 0) {
    return { class: "witnessed", reasons: ["no files declared — cannot prove the safe class; defaulting to witnessed"] };
  }

  // 2. Safe-auto — ONLY a dependency patch bump touching only package files.
  const onlyDepFiles = files.every((f) => SAFE_AUTO_FILES.has(f));
  const depChanges = change.depChanges ?? [];
  if (onlyDepFiles && depChanges.length > 0) {
    const nonPatch = depChanges.filter((d) => !isPatchBump(d.fromVersion, d.toVersion));
    if (nonPatch.length === 0) {
      return {
        class: "safe_auto",
        reasons: [`dependency patch bump(s) only: ${depChanges.map((d) => `${d.name} ${d.fromVersion}→${d.toVersion}`).join(", ")}`],
      };
    }
    reasons.push(`dep change includes non-patch bump(s): ${nonPatch.map((d) => d.name).join(", ")} → witnessed`);
  } else if (onlyDepFiles && depChanges.length === 0) {
    reasons.push("package files changed but no declared dep bumps to verify → witnessed");
  }

  // 3. Default — witnessed.
  if (reasons.length === 0) reasons.push("source/config change → witnessed");
  return { class: "witnessed", reasons };
}
