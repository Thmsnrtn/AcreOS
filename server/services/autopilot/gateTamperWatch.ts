/**
 * Gate-estate tamper watch (master-handoff item F3, "eternal lines").
 *
 * WHY THIS EXISTS
 * ───────────────
 * Every hard line in this repo is enforced by a small estate of gate files:
 * the ratchet baselines (scripts/ratchets/*.json + their evaluator), the
 * governance registries (shared/governance/*.ts), the sovereign immutables,
 * codeChangeGate, the named ratchet tests, and the security + deploy CI
 * workflows. Each gate defends something else — but a quiet edit to a gate
 * file ITSELF (a widened baseline, a deleted assertion, a softened forbidden
 * list) defeats the defense while every check stays green. CI would catch
 * some of that in review, but nothing watched the RUNNING system's copy of
 * the estate, and nothing made an estate change loud as a category.
 *
 * THE MECHANISM (mirrors the sovereign-immutables hash pin)
 * ─────────────────────────────────────────────────────────
 * A committed manifest (gateTamperManifest.json, beside this file) pins the
 * SHA-256 of every estate file. It is regenerated ONLY by
 * scripts/regenerate-gate-manifest.mjs, so any estate change ships with a
 * deliberate, reviewable manifest diff. Two consumers:
 *
 *   • tests/unit/gateTamperWatch.test.ts — CI half: the committed manifest
 *     must verify clean against the repo, so an estate edit without a regen
 *     fails the build (the amendment forcing function).
 *   • the `gate_tamper_watch` scheduled job (registered from
 *     runScheduledJobs.ts, rostered critical in jobRegistry so Wave 0.9's
 *     pager matrix pages its ABSENCE too) — runtime half: re-hashes the
 *     estate on disk every few hours; a mismatch pages the founder critical
 *     (pagerService) and writes an experience-log row so the Story shows the
 *     watching.
 *
 * HONESTY: a deployed image without a source checkout cannot re-hash the
 * estate. The job then reports SKIPPED with the reason — it never claims
 * "verified" for files it could not read (refuse, don't fabricate), and it
 * never false-pages "tampered" for files that were simply never shipped.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { logger } from "../../utils/logger";

export const GATE_MANIFEST_RELPATH = "server/services/autopilot/gateTamperManifest.json";

export interface GateEstateSpec {
  /** Directories scanned for estate members, filtered by extension. */
  dirs: ReadonlyArray<{ dir: string; ext: string }>;
  /** Individually named estate members — MUST exist; absence is a finding. */
  files: readonly string[];
}

/**
 * The gate estate. Kept in sync BY TEST (not by import — the regen script is
 * plain .mjs and cannot import TS) with the copy in
 * scripts/regenerate-gate-manifest.mjs: gateTamperWatch.test.ts asserts the
 * script's output keys equal this spec's enumeration, so the two cannot drift.
 */
export const GATE_ESTATE: GateEstateSpec = {
  dirs: [
    { dir: "scripts/ratchets", ext: ".json" }, // every ratchet baseline
    { dir: "shared/governance", ext: ".ts" }, // constitution + statute registries
  ],
  files: [
    "sovereign-protocol/immutables.json",
    "server/services/autopilot/codeChangeGate.ts",
    "server/services/autopilot/gateTamperWatch.ts", // the watcher watches itself
    "scripts/ratchet.mjs", // the baseline evaluator
    "scripts/lint-reachability.mjs", // the external reachability evaluator
    "scripts/regenerate-gate-manifest.mjs", // the manifest's only sanctioned writer
    ".github/workflows/security.yml", // the two gate workflows
    ".github/workflows/deploy.yml",
    // The named ratchet tests — the lines themselves.
    "tests/unit/constitution.test.ts",
    "tests/unit/moneyCustodyHardStop.test.ts",
    "tests/unit/founderHardStopGuardrails.test.ts",
    "tests/unit/sovereign-protocol-immutables.test.ts",
    "tests/unit/founderFourDoors.test.ts",
    "tests/unit/sidebarHiddenRoutes.test.ts",
    "tests/unit/workflowActionHonesty.test.ts",
    "tests/unit/statuteRegister.test.ts",
    "tests/unit/pagerMatrix.test.ts",
    "tests/unit/jobRosterCoverage.test.ts",
    "tests/unit/selfPatchCannotMerge.test.ts",
    "tests/unit/gateTamperWatch.test.ts",
  ],
};

export function sha256OfFile(absPath: string): string {
  return createHash("sha256").update(readFileSync(absPath)).digest("hex");
}

export interface GateEstateEnumeration {
  /** Estate members present on disk, sorted, repo-relative. */
  present: string[];
  /** NAMED members absent from disk — a gate file has vanished. */
  missingNamed: string[];
}

/** Enumerate the estate under `root`. Directory members are whatever exists; named members are asserted. */
export function computeGateEstate(
  root: string,
  estate: GateEstateSpec = GATE_ESTATE,
): GateEstateEnumeration {
  const present = new Set<string>();
  const missingNamed: string[] = [];
  for (const { dir, ext } of estate.dirs) {
    const abs = path.join(root, dir);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      if (!entry.endsWith(ext)) continue;
      const rel = `${dir}/${entry}`;
      if (rel === GATE_MANIFEST_RELPATH) continue;
      present.add(rel);
    }
  }
  for (const rel of estate.files) {
    if (rel === GATE_MANIFEST_RELPATH) continue; // the manifest cannot pin itself
    if (existsSync(path.join(root, rel))) present.add(rel);
    else missingNamed.push(rel);
  }
  return { present: [...present].sort(), missingNamed: missingNamed.sort() };
}

export interface GateManifest {
  note: string;
  algorithm: "sha256";
  /** repo-relative path → hex SHA-256, keys sorted. */
  files: Record<string, string>;
}

export const GATE_MANIFEST_NOTE =
  "Generated ONLY by scripts/regenerate-gate-manifest.mjs — never edit by hand. " +
  "tests/unit/gateTamperWatch.test.ts fails CI when this drifts from the repo; " +
  "the gate_tamper_watch job pages the founder when the running estate drifts from this.";

/**
 * Hash the estate into a manifest. THROWS when a named estate file is absent —
 * a manifest that silently blesses a missing gate would hide a deletion.
 */
export function buildGateManifest(
  root: string,
  estate: GateEstateSpec = GATE_ESTATE,
): GateManifest {
  const { present, missingNamed } = computeGateEstate(root, estate);
  if (missingNamed.length > 0) {
    throw new Error(
      `refusing to build a gate manifest while named estate files are missing: ${missingNamed.join(", ")}`,
    );
  }
  const files: Record<string, string> = {};
  for (const rel of present) files[rel] = sha256OfFile(path.join(root, rel));
  return { note: GATE_MANIFEST_NOTE, algorithm: "sha256", files };
}

export type TamperFindingKind =
  | "hash_mismatch" // a pinned file's bytes changed
  | "missing_file" // a pinned or named gate file is gone
  | "unlisted_file" // an estate file exists that the manifest never pinned
  | "manifest_missing"; // the estate is on disk but the manifest is not

export interface TamperFinding {
  kind: TamperFindingKind;
  file: string;
  detail: string;
}

export interface GateTamperVerdict {
  /** true = every pinned hash matched and the estate is fully covered. */
  ok: boolean;
  /** Files whose hash was actually compared. */
  checked: number;
  findings: TamperFinding[];
  /** true = could not verify at all (no estate on disk) — NOT a pass. */
  skipped: boolean;
  reason: string;
}

/** Verify the committed manifest against the estate on disk. Pure; never throws. */
export function verifyGateManifest(
  root: string = process.cwd(),
  estate: GateEstateSpec = GATE_ESTATE,
  manifestPath: string = path.join(root, GATE_MANIFEST_RELPATH),
): GateTamperVerdict {
  const sourcePresent = estate.dirs.some(({ dir }) => existsSync(path.join(root, dir)));
  if (!sourcePresent) {
    return {
      ok: false,
      checked: 0,
      findings: [],
      skipped: true,
      reason:
        "gate estate not on disk (deployed image without a source checkout) — cannot verify, refusing to claim verified",
    };
  }

  const findings: TamperFinding[] = [];
  let checked = 0;

  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      checked: 0,
      findings: [
        {
          kind: "manifest_missing",
          file: GATE_MANIFEST_RELPATH,
          detail: "the estate is on disk but the pinned manifest is gone — regenerate via scripts/regenerate-gate-manifest.mjs (and review why it vanished)",
        },
      ],
      skipped: false,
      reason: "manifest missing",
    };
  }

  let pinned: Record<string, string> = {};
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as Partial<GateManifest>;
    pinned = parsed.files ?? {};
  } catch (err) {
    return {
      ok: false,
      checked: 0,
      findings: [
        {
          kind: "hash_mismatch",
          file: GATE_MANIFEST_RELPATH,
          detail: `manifest unreadable/unparsable: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      skipped: false,
      reason: "manifest unparsable",
    };
  }

  for (const [rel, expected] of Object.entries(pinned)) {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) {
      findings.push({ kind: "missing_file", file: rel, detail: "pinned gate file is gone" });
      continue;
    }
    const actual = sha256OfFile(abs);
    checked++;
    if (actual !== expected) {
      findings.push({
        kind: "hash_mismatch",
        file: rel,
        detail: `expected sha256 ${expected}, found ${actual}`,
      });
    }
  }

  const { present, missingNamed } = computeGateEstate(root, estate);
  for (const rel of missingNamed) {
    if (!(rel in pinned)) {
      findings.push({ kind: "missing_file", file: rel, detail: "named gate file absent and never pinned" });
    }
  }
  for (const rel of present) {
    if (!(rel in pinned)) {
      findings.push({
        kind: "unlisted_file",
        file: rel,
        detail: "estate file exists but the manifest never pinned it — regenerate deliberately",
      });
    }
  }

  return {
    ok: findings.length === 0,
    checked,
    findings,
    skipped: false,
    reason: findings.length === 0 ? "all pinned hashes match; estate fully covered" : `${findings.length} finding(s)`,
  };
}

/**
 * One watch pass: verify, and on tamper page the founder (critical) + write
 * an experience-log row. Best-effort side effects — a broken pager must never
 * mask the verdict, so failures there are logged and swallowed. Re-paging on
 * every subsequent pass while the mismatch persists is DELIBERATE: a tampered
 * gate line stays a siren until a human resolves it.
 */
export async function runGateTamperWatch(root: string = process.cwd()): Promise<GateTamperVerdict> {
  const verdict = verifyGateManifest(root);
  if (verdict.skipped) {
    logger.warn(`[gateTamperWatch] verification skipped — ${verdict.reason}`);
    return verdict;
  }
  if (verdict.ok) {
    logger.info(`[gateTamperWatch] gate estate verified — ${verdict.checked} files match the pinned manifest`);
    return verdict;
  }

  const summary = verdict.findings
    .map((f) => `${f.kind}: ${f.file} — ${f.detail}`)
    .join("\n");
  logger.error(`[gateTamperWatch] GATE ESTATE TAMPERED — ${verdict.findings.length} finding(s):\n${summary}`);

  try {
    const { sendSolenePage } = await import("../solene/pagerService");
    await sendSolenePage({
      severity: "critical",
      subject: `Gate estate TAMPERED — ${verdict.findings.length} finding(s)`,
      body:
        `The gate-tamper watch found the running gate estate diverged from the ` +
        `pinned manifest (${GATE_MANIFEST_RELPATH}). A ratchet baseline, governance ` +
        `registry, ratchet test, or CI gate file changed outside the sanctioned ` +
        `regeneration path.\n\n${summary}\n\nIf this was a legitimate reviewed change, ` +
        `the deploy is missing its manifest regen (scripts/regenerate-gate-manifest.mjs); ` +
        `otherwise treat it as an integrity incident.`,
    });
  } catch (err) {
    logger.error(
      "[gateTamperWatch] failed to page the founder about a tampered gate estate",
      err instanceof Error ? err : undefined,
    );
  }

  try {
    const { recordExperience } = await import("./experienceLog");
    await recordExperience({
      moveKind: "gate_tamper_watch",
      domain: "governance",
      playId: null,
      outcome: "escalated",
      reasoningTrace: {
        narrative: `Gate tamper watch: ${verdict.findings.length} finding(s) against the pinned manifest — paged the founder critical.`,
        findings: verdict.findings,
        checked: verdict.checked,
      },
    });
  } catch (err) {
    logger.warn(
      "[gateTamperWatch] experience-log write failed (page already sent)",
      err instanceof Error ? err : undefined,
    );
  }

  return verdict;
}

// ── Scheduling ──────────────────────────────────────────────────────────────

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
/** Under the 6h interval so a crashed run cannot wedge the lane. */
const LOCK_TTL_SECONDS = 20 * 60;
/** First pass shortly after boot — a tampered estate should not wait 6h. */
const STARTUP_DELAY_MS = 5 * 60 * 1000;

/**
 * Registered from runScheduledJobs.ts (dynamic import, S3 convention — that
 * file is under a strictly-DOWN line-count ratchet). The job name
 * `gate_tamper_watch` is passed to withJobLock as a STRING LITERAL because
 * jobRosterCoverage.test.ts derives roster parity from the literals; the
 * JOB_ROSTER entry (critical: true → Wave 0.9 pager matrix resolves its
 * ABSENCE to a page) must carry the same string.
 */
export function startGateTamperWatchJob(): void {
  void import("../../utils/jobRuntime")
    .then(({ trackInterval, withJobLock, jobLog: log }) => {
      log("Registering gate-estate tamper watch (6h, first pass in 5m)", "gate-tamper");
      const tick = () => {
        withJobLock("gate_tamper_watch", LOCK_TTL_SECONDS, async () => {
          const v = await runGateTamperWatch();
          log(
            v.skipped
              ? `Gate tamper watch skipped — ${v.reason}`
              : `Gate tamper watch: checked=${v.checked} ok=${v.ok} findings=${v.findings.length}`,
            "gate-tamper",
          );
        }).catch((err) => log(`Gate tamper watch failed: ${err}`, "gate-tamper"));
      };
      setTimeout(tick, STARTUP_DELAY_MS);
      trackInterval(tick, SIX_HOURS_MS);
    })
    .catch((err) => {
      logger.error(
        "[gateTamperWatch] job registration failed",
        err instanceof Error ? err : undefined,
      );
    });
}
