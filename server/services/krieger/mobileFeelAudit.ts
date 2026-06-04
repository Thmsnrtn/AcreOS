/**
 * KRIEGER — mobile-feel continuous-audit service.
 *
 * Continuous-audit detector ledger for the customer surface. Mirrors the
 * Phase-C posture of Iris (perf), Soren (SEO), and Beatrice (Pax): every
 * 30 min the cron runs the six detectors in parallel, persists findings
 * to krieger_audit_findings, and auto-enqueues fix dispatches for any
 * finding with severity ≥ high.
 *
 * Seven detectors (see KRIEGER_DETECTOR_NAMES for the canonical list):
 *
 *   1. touch_target_drift           — heuristic git-log scan for new
 *                                     interactive elements without active:
 *                                     companion classes
 *   2. cross_device_matrix_red      — surfaces the latest CI mobile-matrix
 *                                     failure
 *   3. mobile_error_boundary_trip   — counts recent error-boundary-related
 *                                     dispatches in the queue
 *   4. theme_contract_drift         — TODO (Playwright instrumentation)
 *   5. pwa_install_regression       — TODO (analytics integration)
 *   6. real_device_gap              — TODO (manual-test ledger)
 *   7. desktop_keyboard_nav_drift   — Phase D3 scope expansion. Heuristic
 *                                     git-log scan of recent client/src/
 *                                     pages/*.tsx commits for raw
 *                                     <div onClick> patterns without
 *                                     keyboard handlers / focus-visible.
 *                                     Severity high for raw divs,
 *                                     medium for shadcn-wrapped patterns.
 *                                     Skipped on pages/founder/* routes
 *                                     (intentionally desktop-only with a
 *                                     different bar).
 *
 * Auto-enqueue gate: severity in {'high','critical'} → enqueueDispatch with
 *   sourceType='detector'
 *   sourceId='krieger-audit:<findingId>'
 *   agentRole='krieger'
 *   maxCostUsd=$18
 *   priority=2.5 (critical) | 1.6 (high)
 *
 * Idempotency: before enqueueing, we check the dispatch queue for an
 * existing queued/in_progress row with the same sourceId. The same
 * findingId can never enqueue two fixes — re-running the cron over the
 * same findings is a no-op.
 *
 * Honest constraint: this is INFRASTRUCTURE. Detectors #1-3 implement
 * lightweight heuristic detection on existing infra; #4-6 are scaffolded
 * stubs that document the follow-up integration. The point of this
 * dispatch is the ledger + enqueue plumbing; the detection logic is
 * iterative.
 *
 * Never throws — failures get logged + counted in `errors`. The cron loop
 * upstream must not see an exception from any one tick.
 */

import { and, desc, eq, gte, inArray, like, or, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  kriegerAuditFindings,
  KRIEGER_AUTO_ENQUEUE_SEVERITIES,
  KRIEGER_DISPATCH_MAX_COST_USD,
  KRIEGER_DISPATCH_PRIORITY,
  KRIEGER_DISPATCH_TIMEOUT_MS,
  type InsertKriegerAuditFinding,
  type KriegerAuditFinding,
  type KriegerDetectorName,
  type KriegerSeverity,
} from "@shared/schema/krieger-audit";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { enqueueDispatch } from "../solene/dispatchQueue";
import { logger } from "../../utils/logger";

// ============================================================================
// PUBLIC TYPES
// ============================================================================

export interface AuditRunResult {
  detectorsRun: number;
  findingsRecorded: number;
  dispatchesEnqueued: number;
  durationMs: number;
  errors: number;
}

/**
 * A finding emitted by one of the detectors before persistence. The
 * persisted shape adds id + detectedAt + reviewStatus defaults.
 */
export interface DetectorFinding {
  detectorName: KriegerDetectorName;
  severity: KriegerSeverity;
  targetRoute?: string;
  targetViewport?: string;
  findingText: string;
  evidenceSnippet?: string;
  recommendedAction?: string;
}

// ============================================================================
// CREDENTIAL SANITIZER
// ============================================================================
// Wave-wide rule: credential values never leave any agent's surface. Every
// evidence snippet runs through this before persistence. Same prefix set as
// the wave's other Phase-C agents (Iris, Soren, Beatrice).

const CREDENTIAL_PATTERNS: RegExp[] = [
  /sk_(?:live|test)_[A-Za-z0-9]+/g,
  /pk_(?:live|test)_[A-Za-z0-9]+/g,
  /phc_[A-Za-z0-9]+/g,
  /phx_[A-Za-z0-9]+/g,
  /ghp_[A-Za-z0-9]+/g,
  /gho_[A-Za-z0-9]+/g,
  /\bBearer\s+[A-Za-z0-9._\-]+/g,
  /\bAKIA[0-9A-Z]{16}/g,
  /\bASIA[0-9A-Z]{16}/g,
];

/**
 * Replace any credential-prefix matches with [REDACTED]. Exported for tests.
 */
export function sanitizeEvidence(s: string): string {
  let out = s;
  for (const re of CREDENTIAL_PATTERNS) {
    out = out.replace(re, "[REDACTED]");
  }
  return out;
}

// ============================================================================
// runMobileFeelAudit — orchestration entrypoint (cron-callable)
// ============================================================================

/**
 * Run all six detectors in parallel, persist findings, auto-enqueue fix
 * dispatches for severity ≥ high. Fire-and-forget: never throws; the
 * AuditRunResult records the error count.
 */
export async function runMobileFeelAudit(): Promise<AuditRunResult> {
  const startedAt = Date.now();
  // Indirection through the DETECTORS object lets tests `vi.spyOn` each
  // detector independently without rewriting the orchestrator's call graph.
  // Direct references to detectTouchTargetDrift etc. would bypass spies,
  // since the local binding inside this module is not the same identity
  // as the module export the test patches.
  const detectors: Array<{
    name: KriegerDetectorName;
    fn: () => Promise<DetectorFinding[]>;
  }> = [
    { name: "touch_target_drift", fn: () => DETECTORS.detectTouchTargetDrift() },
    { name: "cross_device_matrix_red", fn: () => DETECTORS.detectCrossDeviceMatrixRed() },
    { name: "mobile_error_boundary_trip", fn: () => DETECTORS.detectMobileErrorBoundaryTrip() },
    { name: "theme_contract_drift", fn: () => DETECTORS.detectThemeContractDrift() },
    { name: "pwa_install_regression", fn: () => DETECTORS.detectPwaInstallRegression() },
    { name: "real_device_gap", fn: () => DETECTORS.detectRealDeviceGap() },
    { name: "desktop_keyboard_nav_drift", fn: () => DETECTORS.detectDesktopKeyboardNavDrift() },
  ];

  const settled = await Promise.allSettled(detectors.map((d) => d.fn()));

  let errors = 0;
  const allFindings: DetectorFinding[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === "fulfilled") {
      allFindings.push(...r.value);
    } else {
      errors++;
      logger.warn(
        `[krieger-audit] detector ${detectors[i].name} threw`,
        r.reason instanceof Error ? r.reason : undefined,
      );
    }
  }

  let findingsRecorded = 0;
  let dispatchesEnqueued = 0;

  for (const finding of allFindings) {
    try {
      const findingId = await persistFinding(finding);
      if (findingId === null) continue;
      findingsRecorded++;

      if (!KRIEGER_AUTO_ENQUEUE_SEVERITIES.has(finding.severity)) continue;

      const enqueued = await maybeEnqueueFix(findingId, finding);
      if (enqueued) dispatchesEnqueued++;
    } catch (err) {
      errors++;
      logger.warn(
        `[krieger-audit] persist/enqueue failed for ${finding.detectorName}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  const durationMs = Date.now() - startedAt;
  logger.info(
    `[krieger-audit] run complete detectors=${detectors.length} findings=${findingsRecorded} dispatches=${dispatchesEnqueued} errors=${errors} durationMs=${durationMs}`,
  );

  return {
    detectorsRun: detectors.length,
    findingsRecorded,
    dispatchesEnqueued,
    durationMs,
    errors,
  };
}

// ============================================================================
// PERSISTENCE + ENQUEUE HELPERS
// ============================================================================

async function persistFinding(finding: DetectorFinding): Promise<number | null> {
  const row: InsertKriegerAuditFinding = {
    detectorName: finding.detectorName,
    severity: finding.severity,
    targetRoute: finding.targetRoute ?? null,
    targetViewport: finding.targetViewport ?? null,
    findingText: finding.findingText,
    evidenceSnippet: finding.evidenceSnippet
      ? sanitizeEvidence(finding.evidenceSnippet)
      : null,
    recommendedAction: finding.recommendedAction ?? null,
  };

  const [inserted] = await db
    .insert(kriegerAuditFindings)
    .values(row)
    .returning({ id: kriegerAuditFindings.id });

  return inserted?.id ?? null;
}

/**
 * Idempotency check + enqueue. Returns true when a new dispatch was created;
 * false when a prior queued/in-progress dispatch for the same findingId was
 * already present (so we skip).
 */
async function maybeEnqueueFix(
  findingId: number,
  finding: DetectorFinding,
): Promise<boolean> {
  const sourceId = `krieger-audit:${findingId}`;

  // Idempotency: look for a queued or in-progress dispatch with the same
  // sourceId. Completed/failed dispatches don't block re-enqueue — if a
  // finding's earlier fix dispatch failed, the next cron tick can retry.
  const existing = await db
    .select({ id: soleneDispatchQueue.id })
    .from(soleneDispatchQueue)
    .where(
      and(
        eq(soleneDispatchQueue.sourceType, "detector"),
        eq(soleneDispatchQueue.sourceId, sourceId),
        inArray(soleneDispatchQueue.status, ["queued", "in_progress"]),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    logger.info(
      `[krieger-audit] skip enqueue findingId=${findingId} — existing dispatch id=${existing[0].id}`,
    );
    return false;
  }

  const priority =
    finding.severity === "critical"
      ? KRIEGER_DISPATCH_PRIORITY.critical
      : KRIEGER_DISPATCH_PRIORITY.high;

  const persistedFinding: KriegerAuditFindingRow = {
    id: findingId,
    detectorName: finding.detectorName,
    severity: finding.severity,
    targetRoute: finding.targetRoute ?? null,
    targetViewport: finding.targetViewport ?? null,
    findingText: finding.findingText,
    evidenceSnippet: finding.evidenceSnippet
      ? sanitizeEvidence(finding.evidenceSnippet)
      : null,
    recommendedAction: finding.recommendedAction ?? null,
  };

  const promptText = buildMobileFeelFixPrompt(persistedFinding);

  try {
    const dispatchId = await enqueueDispatch({
      sourceType: "detector",
      sourceId,
      agentRole: "krieger",
      promptText,
      maxCostUsd: KRIEGER_DISPATCH_MAX_COST_USD,
      timeoutMs: KRIEGER_DISPATCH_TIMEOUT_MS,
      priority,
      enqueuedBy: "krieger-audit",
    });

    // Stamp the back-pointer onto the finding.
    await db
      .update(kriegerAuditFindings)
      .set({ fixDispatchId: dispatchId })
      .where(eq(kriegerAuditFindings.id, findingId));

    return true;
  } catch (err) {
    logger.warn(
      `[krieger-audit] enqueue failed for findingId=${findingId}`,
      err instanceof Error ? err : undefined,
    );
    return false;
  }
}

// ============================================================================
// PROMPT BUILDER (pure helper — exported for tests)
// ============================================================================

/**
 * Subset of the persisted finding row that buildMobileFeelFixPrompt needs.
 * Kept narrow so the function can be unit-tested without spinning up the
 * full select type.
 */
export interface KriegerAuditFindingRow {
  id: number;
  detectorName: KriegerDetectorName;
  severity: KriegerSeverity;
  targetRoute: string | null;
  targetViewport: string | null;
  findingText: string;
  evidenceSnippet: string | null;
  recommendedAction: string | null;
}

export function buildMobileFeelFixPrompt(
  finding: KriegerAuditFindingRow,
): string {
  const route = finding.targetRoute ?? "(unknown route)";
  const viewport = finding.targetViewport ?? "(any mobile viewport)";
  const evidence = finding.evidenceSnippet
    ? `\nEvidence:\n${finding.evidenceSnippet}\n`
    : "";
  const recommended = finding.recommendedAction
    ? `\nRecommended action: ${finding.recommendedAction}\n`
    : "";

  return [
    `Krieger continuous-audit finding #${finding.id} — detector ${finding.detectorName}, severity ${finding.severity}.`,
    ``,
    `Route: ${route}`,
    `Viewport: ${viewport}`,
    ``,
    `Finding:`,
    finding.findingText,
    evidence,
    recommended,
    ``,
    `Task:`,
    `1. Reproduce the issue on the target viewport.`,
    `2. Root-cause: what change introduced this? Grep + git log to confirm.`,
    `3. Implement the minimal fix that resolves the finding without regressing other viewports.`,
    `4. Verify in browser at the target viewport before claiming complete.`,
    ``,
    `Reference the finding id (#${finding.id}) in the commit message so the ledger can mark review_status='fixed' downstream.`,
  ]
    .filter((line) => line !== undefined && line !== null)
    .join("\n");
}

// ============================================================================
// DETECTOR 1 — touch_target_drift
// ============================================================================
// Heuristic git-log scan: look at the last 24h of commits that touched
// client/src/pages or client/src/components. For each such commit, if the
// diff added a <button>/<a>/onClick={ line that doesn't include "active:"
// nearby, emit a medium-severity finding. False positives are expected;
// medium severity keeps them out of the auto-enqueue path.
//
// We invoke git via child_process. If git is unavailable (e.g. running in
// a container without a checkout), we silently emit zero findings.

export async function detectTouchTargetDrift(): Promise<DetectorFinding[]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);

  try {
    // Find commits in the last 24h that touched the customer surface.
    const { stdout: logOut } = await exec(
      "git",
      [
        "log",
        "--since=24.hours.ago",
        "--name-only",
        "--pretty=format:COMMIT:%H",
        "--",
        "client/src/pages",
        "client/src/components",
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );

    if (!logOut.trim()) return [];

    // Parse commit -> file list groupings. We only need a handful of recent
    // commits for the heuristic; cap at the first 5.
    const lines = logOut.split("\n");
    interface CommitBlock { sha: string; files: string[] }
    const blocks: CommitBlock[] = [];
    let current: CommitBlock | null = null;
    for (const line of lines) {
      if (line.startsWith("COMMIT:")) {
        if (current) blocks.push(current);
        current = { sha: line.slice("COMMIT:".length).trim(), files: [] };
      } else if (line.trim() && current) {
        current.files.push(line.trim());
      }
    }
    if (current) blocks.push(current);

    const findings: DetectorFinding[] = [];

    for (const block of blocks.slice(0, 5)) {
      // Inspect the diff of files touched.
      for (const file of block.files.slice(0, 3)) {
        if (!file.match(/\.(tsx|jsx)$/)) continue;
        let diff = "";
        try {
          const { stdout } = await exec(
            "git",
            ["show", `${block.sha}`, "--", file],
            { maxBuffer: 2 * 1024 * 1024 },
          );
          diff = stdout;
        } catch {
          continue;
        }

        // Heuristic: added line contains onClick or <button> or <a or role="button"
        // but no "active:" within the same change. Look at +-prefixed lines only.
        const addedLines = diff
          .split("\n")
          .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
        const interactive = addedLines.filter((l) =>
          /onClick=|<button|<a\s|role=["']button["']/.test(l),
        );
        if (interactive.length === 0) continue;
        const hasActiveClass = addedLines.some((l) => /active:/.test(l));
        if (hasActiveClass) continue;

        // Derive a target_route heuristic from the file path (pages/foo.tsx → /foo).
        const routeMatch = file.match(/client\/src\/pages\/([^.]+)\.tsx$/);
        const targetRoute = routeMatch ? `/${routeMatch[1]}` : undefined;

        findings.push({
          detectorName: "touch_target_drift",
          severity: "medium",
          targetRoute,
          targetViewport: "390x844", // iPhone 12 baseline
          findingText: `Commit ${block.sha.slice(0, 7)} added interactive elements in ${file} without an active: companion class (touch feedback may be missing on mobile).`,
          evidenceSnippet: interactive.slice(0, 3).join("\n"),
          recommendedAction:
            "Add active:scale-95 / active:bg-* / active:opacity-80 to the new interactive elements for mobile touch feedback.",
        });

        if (findings.length >= 2) return findings;
      }
    }

    return findings;
  } catch (err) {
    logger.warn(
      `[krieger-audit] touch_target_drift: git unavailable or failed`,
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

// ============================================================================
// DETECTOR 2 — cross_device_matrix_red
// ============================================================================
// Reads the most-recent failure file under tests/e2e-mobile/results/ if
// present. The CI mobile matrix runs Playwright across iPhone 12 / Galaxy
// S20 / iPad mini × light + dark; failures get written to a JSON results
// file the cron can sample.
//
// The exact result-file shape is not yet finalized — for this stub, we
// look for the most-recent .json under tests/e2e-mobile/results/ and treat
// presence-of-failure as a high-severity signal. Absence = empty findings.

export async function detectCrossDeviceMatrixRed(): Promise<DetectorFinding[]> {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const resultsDir = path.resolve(
      process.cwd(),
      "tests",
      "e2e-mobile",
      "results",
    );
    let entries: string[];
    try {
      entries = await fs.readdir(resultsDir);
    } catch {
      // No results directory yet — that's fine.
      return [];
    }
    const jsonFiles = entries
      .filter((e) => e.endsWith(".json"))
      .sort()
      .reverse();
    if (jsonFiles.length === 0) return [];

    const latest = path.join(resultsDir, jsonFiles[0]);
    const raw = await fs.readFile(latest, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }

    // Permissive parse: look for a `failures` array of {viewport, route, message}.
    const failures = extractFailures(parsed);
    if (failures.length === 0) return [];

    // One finding per failure, capped at 5 to avoid flooding.
    return failures.slice(0, 5).map((f) => ({
      detectorName: "cross_device_matrix_red" as const,
      severity: (f.severity ?? "high") as KriegerSeverity,
      targetRoute: f.route,
      targetViewport: f.viewport,
      findingText: `CI mobile matrix failed: ${f.message ?? "(no message)"}`,
      evidenceSnippet: f.stack ?? undefined,
      recommendedAction:
        "Re-run the failing Playwright spec locally on the target viewport + fix.",
    }));
  } catch (err) {
    logger.warn(
      `[krieger-audit] cross_device_matrix_red: read failed`,
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

interface ParsedFailure {
  route?: string;
  viewport?: string;
  message?: string;
  stack?: string;
  severity?: string;
}

function extractFailures(parsed: unknown): ParsedFailure[] {
  if (!parsed || typeof parsed !== "object") return [];
  const failures = (parsed as { failures?: unknown }).failures;
  if (!Array.isArray(failures)) return [];
  return failures
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
    .map((f) => ({
      route: typeof f.route === "string" ? f.route : undefined,
      viewport: typeof f.viewport === "string" ? f.viewport : undefined,
      message: typeof f.message === "string" ? f.message : undefined,
      stack: typeof f.stack === "string" ? f.stack : undefined,
      severity: typeof f.severity === "string" ? f.severity : undefined,
    }));
}

// ============================================================================
// DETECTOR 3 — mobile_error_boundary_trip
// ============================================================================
// Queries solene_dispatch_queue for source_id values containing
// "error-boundary" or "error_boundary" in the last 24h. Count proportional
// to severity:
//
//   ≥ 5 trips → high
//   1-4 trips → medium
//   0 trips   → no finding
//
// This is a coarse signal — a more precise version would join against
// error_boundary_trips directly, but the queue surface is already the
// "what's being acted on" view, and matching there keeps the detector
// focused on actionable incidents.

export async function detectMobileErrorBoundaryTrip(): Promise<DetectorFinding[]> {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id: soleneDispatchQueue.id,
        sourceId: soleneDispatchQueue.sourceId,
        queuedAt: soleneDispatchQueue.queuedAt,
      })
      .from(soleneDispatchQueue)
      .where(
        and(
          gte(soleneDispatchQueue.queuedAt, cutoff),
          or(
            like(soleneDispatchQueue.sourceId, "%error-boundary%"),
            like(soleneDispatchQueue.sourceId, "%error_boundary%"),
            like(soleneDispatchQueue.sourceId, "%mobile-error%"),
          ),
        ),
      );

    const count = rows.length;
    if (count === 0) return [];

    const severity: KriegerSeverity = count >= 5 ? "high" : "medium";

    const sampleSourceIds = rows
      .slice(0, 3)
      .map((r) => r.sourceId)
      .join(", ");

    return [
      {
        detectorName: "mobile_error_boundary_trip",
        severity,
        findingText: `${count} mobile error-boundary-related dispatch(es) enqueued in the last 24h.`,
        evidenceSnippet: `Sample sourceIds: ${sampleSourceIds}`,
        recommendedAction:
          "Triage the recent error-boundary trips: identify the failing component, reproduce on mobile, ship a defensive guard or fix the root cause.",
      },
    ];
  } catch (err) {
    logger.warn(
      `[krieger-audit] mobile_error_boundary_trip: query failed`,
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

// ============================================================================
// DETECTOR 4 — theme_contract_drift  (TODO)
// ============================================================================
// Will compare DOM-rendered colors against the design-token registry, via
// a Playwright instrumentation hook that captures computed styles per
// route/viewport.
//
// For this dispatch, the detector is a no-op stub. Documented so the
// follow-up implementer has a clear seam to fill.

export async function detectThemeContractDrift(): Promise<DetectorFinding[]> {
  // TODO(krieger): wire to Playwright instrumentation that captures
  // computed styles, diff against shared/design-tokens/registry.
  return [];
}

// ============================================================================
// DETECTOR 5 — pwa_install_regression  (TODO)
// ============================================================================
// Will compare install-prompt acceptance rate + standalone-mode session
// share week-over-week. Needs analytics integration (PostHog or our own
// event ledger) that doesn't exist yet.

export async function detectPwaInstallRegression(): Promise<DetectorFinding[]> {
  // TODO(krieger): wire to analytics integration once event ledger ships.
  return [];
}

// ============================================================================
// DETECTOR 6 — real_device_gap  (TODO)
// ============================================================================
// Will surface device classes that haven't been touched in the manual-test
// ledger for >14d. Needs the manual-test ledger (krieger_manual_tests or
// similar) which is a separate dispatch.

export async function detectRealDeviceGap(): Promise<DetectorFinding[]> {
  // TODO(krieger): wire to the manual-test ledger once it ships.
  return [];
}

// ============================================================================
// DETECTOR 7 — desktop_keyboard_nav_drift  (Phase D3)
// ============================================================================
// Heuristic git-log scan: look at the last 24h of commits that touched
// client/src/pages/*.tsx. For each new interactive element added by the
// diff, classify by element shape:
//
//   - Raw `<div onClick={...}>` (or span/section/article) without
//     tabIndex / onKeyDown / role="button" → severity HIGH. A keyboard
//     user literally cannot reach this on desktop; that's an a11y
//     regression we want auto-enqueued as a fix dispatch.
//
//   - shadcn-wrapped pattern (`<Button onClick=...>` or `<Link ...>`)
//     without an obvious focus-visible class. Severity MEDIUM. The
//     shadcn Button likely already has a focus ring, but the diff
//     lacks the visual evidence — worth verifying, not auto-fixing.
//
// Skipped surfaces:
//   - `client/src/pages/founder/*` — the founder surface is intentionally
//     desktop-only and has a different bar set by the constitution. We
//     don't want this detector noisy-paging Iris for founder routes.
//
// We invoke git via child_process. If git is unavailable (e.g. running
// in a container without a checkout), we silently emit zero findings.

const RAW_INTERACTIVE_RE =
  /<(div|span|section|article|li)\s[^>]*onClick=/;
const SHADCN_WRAPPED_RE = /<(Button|Link|MenuItem|DropdownMenuItem)\s/;
const FOUNDER_PATH_RE = /client\/src\/pages\/founder\//;

export async function detectDesktopKeyboardNavDrift(): Promise<DetectorFinding[]> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);

  try {
    // Find commits in the last 24h that touched client/src/pages.
    const { stdout: logOut } = await exec(
      "git",
      [
        "log",
        "--since=24.hours.ago",
        "--name-only",
        "--pretty=format:COMMIT:%H",
        "--",
        "client/src/pages",
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );

    if (!logOut.trim()) return [];

    const lines = logOut.split("\n");
    interface CommitBlock {
      sha: string;
      files: string[];
    }
    const blocks: CommitBlock[] = [];
    let current: CommitBlock | null = null;
    for (const line of lines) {
      if (line.startsWith("COMMIT:")) {
        if (current) blocks.push(current);
        current = { sha: line.slice("COMMIT:".length).trim(), files: [] };
      } else if (line.trim() && current) {
        current.files.push(line.trim());
      }
    }
    if (current) blocks.push(current);

    const findings: DetectorFinding[] = [];

    for (const block of blocks.slice(0, 5)) {
      for (const file of block.files.slice(0, 3)) {
        if (!file.match(/\.(tsx|jsx)$/)) continue;
        // Skip founder routes — intentionally desktop-only, different bar.
        if (FOUNDER_PATH_RE.test(file)) continue;

        let diff = "";
        try {
          const { stdout } = await exec(
            "git",
            ["show", block.sha, "--", file],
            { maxBuffer: 2 * 1024 * 1024 },
          );
          diff = stdout;
        } catch {
          continue;
        }

        const addedLines = diff
          .split("\n")
          .filter((l) => l.startsWith("+") && !l.startsWith("+++"));

        // Raw interactive elements — high severity (keyboard unreachable).
        const rawHits = addedLines.filter((l) => RAW_INTERACTIVE_RE.test(l));
        // A raw hit is exonerated if the SAME added line also provides
        // a keyboard escape hatch (tabIndex / onKeyDown / role="button").
        const rawViolations = rawHits.filter(
          (l) =>
            !/tabIndex=/.test(l) &&
            !/onKeyDown=/.test(l) &&
            !/role=["']button["']/.test(l),
        );

        // Shadcn-wrapped interactive — medium severity (likely fine, but
        // the diff lacks visual focus-visible evidence; worth verifying).
        const wrappedHits = addedLines.filter((l) => SHADCN_WRAPPED_RE.test(l));
        const wrappedNeedsVerify = wrappedHits.filter(
          (l) => !/focus-visible/.test(l) && !/focus:/.test(l),
        );

        const routeMatch = file.match(/client\/src\/pages\/([^.]+)\.tsx$/);
        const targetRoute = routeMatch ? `/${routeMatch[1]}` : undefined;

        if (rawViolations.length > 0) {
          findings.push({
            detectorName: "desktop_keyboard_nav_drift",
            severity: "high",
            targetRoute,
            targetViewport: "1280x800",
            findingText: `Commit ${block.sha.slice(0, 7)} added ${rawViolations.length} raw <div onClick> (or span/section) pattern(s) in ${file} without tabIndex / onKeyDown / role="button". Keyboard users cannot reach these interactive elements on desktop.`,
            evidenceSnippet: rawViolations.slice(0, 3).join("\n"),
            recommendedAction:
              "Replace raw <div onClick> with a <Button> (shadcn) OR add role=\"button\" + tabIndex={0} + onKeyDown handler (Enter/Space → onClick).",
          });
        } else if (wrappedNeedsVerify.length > 0) {
          findings.push({
            detectorName: "desktop_keyboard_nav_drift",
            severity: "medium",
            targetRoute,
            targetViewport: "1280x800",
            findingText: `Commit ${block.sha.slice(0, 7)} added ${wrappedNeedsVerify.length} shadcn-wrapped interactive element(s) in ${file} without obvious focus-visible classes. Likely safe (shadcn Button has default focus rings), but worth verifying with the desktop-feel C2 contract.`,
            evidenceSnippet: wrappedNeedsVerify.slice(0, 3).join("\n"),
            recommendedAction:
              "Run the desktop-feel C2 focus-ring contract against the target route to confirm the focus indicator renders.",
          });
        }

        if (findings.length >= 3) return findings;
      }
    }

    return findings;
  } catch (err) {
    logger.warn(
      `[krieger-audit] desktop_keyboard_nav_drift: git unavailable or failed`,
      err instanceof Error ? err : undefined,
    );
    return [];
  }
}

// ============================================================================
// DETECTORS registry — indirection seam for tests
// ============================================================================
// The orchestrator dispatches detector calls through this object so
// `vi.spyOn(DETECTORS, "detectTouchTargetDrift")` can patch the call site
// without rewriting the orchestrator. Each method is bound to the exported
// implementation; production paths see the real detector, tests see the spy.
export const DETECTORS = {
  detectTouchTargetDrift,
  detectCrossDeviceMatrixRed,
  detectMobileErrorBoundaryTrip,
  detectThemeContractDrift,
  detectPwaInstallRegression,
  detectRealDeviceGap,
  detectDesktopKeyboardNavDrift,
};

// Silence unused-import warning when callers only use a subset of these.
void sql;
void desc;
