/**
 * EXTERNAL-WATCH — npm vulnerability feed.
 *
 * Layer 1 cap #4 (#17 in 32-cap map). Runs `npm audit --json
 * --audit-level=high` in the repo root daily and persists each
 * vulnerability as an external_watch_events row with source='npm_vuln'.
 * The audit-level flag means we skip 'low' and 'moderate' by default;
 * the floor is controllable via the NPM_WATCH_MIN_SEVERITY env (one of
 * 'low' | 'moderate' | 'high' | 'critical').
 *
 * `npm audit --json` returns a structure roughly:
 *   {
 *     vulnerabilities: {
 *       "<pkg-name>": {
 *         name, severity, via: [string | { url, title, source, ... }, ...],
 *         range, effects, fixAvailable, ...
 *       },
 *       ...
 *     },
 *     metadata: { vulnerabilities: { info, low, moderate, high, critical, total } }
 *   }
 *
 * We flatten one row per (pkg × advisory URL). The advisory URL is the
 * GitHub advisory link from the `via[]` array — we prefer the first
 * object entry with a `url` field. If no URL is present (some indirect
 * dependencies surface only as a string name), we synthesise a stable
 * `npm:` scheme URL so dedup still works.
 *
 * Iris owns 7d ack (high) / 24h ack (critical) per
 * docs/internal/npm-watch-discipline.md. Critical vulnerabilities fire
 * to Solene's page channel as severity=urgent.
 */

import { spawn } from "node:child_process";
import { db } from "../../db";
import {
  externalWatchEvents,
  type InsertExternalWatchEvent,
} from "@shared/schema/external-watch";
import { logger } from "../../utils/logger";

// ============================================================================
// fetchNpmVulnerabilities — cron entrypoint
// ============================================================================

export type NpmAuditSeverity = "low" | "moderate" | "high" | "critical";

const SEVERITY_RANK: Record<NpmAuditSeverity, number> = {
  low: 0,
  moderate: 1,
  high: 2,
  critical: 3,
};

export interface FetchNpmVulnerabilitiesResult {
  advisoriesScanned: number;
  advisoriesMatched: number;
  advisoriesPersisted: number;
  advisoriesSkippedDuplicate: number;
  auditError?: string;
}

export async function fetchNpmVulnerabilities(
  options: {
    runAudit?: () => Promise<string>;
    minSeverity?: NpmAuditSeverity;
    cwd?: string;
  } = {},
): Promise<FetchNpmVulnerabilitiesResult> {
  const minSeverity =
    options.minSeverity ??
    (process.env.NPM_WATCH_MIN_SEVERITY as NpmAuditSeverity | undefined) ??
    "high";
  const runAudit = options.runAudit ?? (() => runNpmAudit(options.cwd));

  let rawJson: string;
  try {
    rawJson = await runAudit();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[npmWatch] audit failed: ${msg}`, {
      metadata: { err: msg },
    });
    return {
      advisoriesScanned: 0,
      advisoriesMatched: 0,
      advisoriesPersisted: 0,
      advisoriesSkippedDuplicate: 0,
      auditError: msg,
    };
  }

  const advisories = parseNpmAuditJson(rawJson);
  const filtered = filterBySeverity(advisories, minSeverity);

  let advisoriesPersisted = 0;
  let advisoriesSkippedDuplicate = 0;

  for (const adv of filtered) {
    const row: InsertExternalWatchEvent = {
      source: "npm_vuln",
      sourceUrl: adv.sourceUrl,
      title: `[${adv.severity}] ${adv.packageName}: ${adv.summary}`,
      summary: adv.detail,
      publishedAt: new Date(),
      severityKeywordMatch: [adv.severity, adv.packageName],
    };
    try {
      const result = await db
        .insert(externalWatchEvents)
        .values(row)
        .onConflictDoNothing({
          target: [externalWatchEvents.source, externalWatchEvents.sourceUrl],
        })
        .returning({ id: externalWatchEvents.id });
      if (result.length > 0) {
        advisoriesPersisted++;
      } else {
        advisoriesSkippedDuplicate++;
      }
    } catch (err) {
      logger.warn(
        `[npmWatch] persist failed for ${adv.sourceUrl}`,
        err instanceof Error
          ? { metadata: { err: err.message } }
          : { metadata: { err: String(err) } },
      );
    }
  }

  return {
    advisoriesScanned: advisories.length,
    advisoriesMatched: filtered.length,
    advisoriesPersisted,
    advisoriesSkippedDuplicate,
  };
}

// ============================================================================
// parseNpmAuditJson — pure function, exported for tests
// ============================================================================

export interface NpmAdvisory {
  packageName: string;
  severity: NpmAuditSeverity;
  summary: string;
  detail: string;
  sourceUrl: string;
}

interface RawAuditVia {
  url?: string;
  title?: string;
  source?: number | string;
  severity?: string;
  name?: string;
}

interface RawAuditVulnerability {
  name?: string;
  severity?: string;
  via?: Array<string | RawAuditVia>;
  range?: string;
  fixAvailable?: boolean | { name: string; version: string };
}

/**
 * Parse `npm audit --json` output into a flat advisory list. One row per
 * (package × advisory URL). Returns an empty list on malformed input
 * rather than throwing — a single corrupted run shouldn't kill the
 * daily cron.
 */
export function parseNpmAuditJson(raw: string): NpmAdvisory[] {
  if (!raw || typeof raw !== "string") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];

  const root = parsed as { vulnerabilities?: Record<string, RawAuditVulnerability> };
  const vulns = root.vulnerabilities;
  if (!vulns || typeof vulns !== "object") return [];

  const out: NpmAdvisory[] = [];
  for (const [pkgName, vuln] of Object.entries(vulns)) {
    if (!vuln || typeof vuln !== "object") continue;
    const severity = normalizeSeverity(vuln.severity);
    if (!severity) continue;

    // via[] is the heart — it carries advisory URLs. Items can be either
    // a string (indirect dep, just the dependency name) or an object
    // with the advisory metadata.
    const viaList = Array.isArray(vuln.via) ? vuln.via : [];
    const advisoryObjects = viaList.filter(
      (v): v is RawAuditVia => typeof v === "object" && v !== null,
    );

    if (advisoryObjects.length === 0) {
      // Indirect-only — no advisory URL available. Still surface it so
      // Iris knows the dep tree is affected, but synthesise a stable
      // dedup URL based on (pkg, severity).
      out.push({
        packageName: pkgName,
        severity,
        summary: "vulnerable dependency (indirect)",
        detail: `Package ${pkgName} is affected via its dependency tree. No direct advisory URL. Run \`npm audit\` for the full chain.`,
        sourceUrl: `npm:${pkgName}#${severity}`,
      });
      continue;
    }

    for (const adv of advisoryObjects) {
      const url = adv.url ?? `npm:${pkgName}#${adv.source ?? adv.title ?? severity}`;
      const title = adv.title ?? "advisory";
      const advSeverity = normalizeSeverity(adv.severity) ?? severity;
      out.push({
        packageName: pkgName,
        severity: advSeverity,
        summary: title,
        detail:
          `Package: ${pkgName}. ` +
          `Range: ${vuln.range ?? "unknown"}. ` +
          `Fix available: ${formatFixAvailable(vuln.fixAvailable)}. ` +
          `Advisory: ${title}.`,
        sourceUrl: url,
      });
    }
  }
  return out;
}

function normalizeSeverity(input: unknown): NpmAuditSeverity | null {
  if (typeof input !== "string") return null;
  const lower = input.toLowerCase();
  if (lower === "low" || lower === "moderate" || lower === "high" || lower === "critical") {
    return lower;
  }
  return null;
}

function formatFixAvailable(
  fix: boolean | { name: string; version: string } | undefined,
): string {
  if (fix === undefined) return "unknown";
  if (typeof fix === "boolean") return fix ? "yes" : "no";
  return `upgrade ${fix.name}@${fix.version}`;
}

// ============================================================================
// filterBySeverity — pure function, exported for tests
// ============================================================================

export function filterBySeverity(
  advisories: NpmAdvisory[],
  minSeverity: NpmAuditSeverity,
): NpmAdvisory[] {
  const floor = SEVERITY_RANK[minSeverity];
  return advisories.filter((a) => SEVERITY_RANK[a.severity] >= floor);
}

// ============================================================================
// runNpmAudit — child-process helper, not exported
// ============================================================================

async function runNpmAudit(cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["audit", "--json", "--audit-level=high"], {
      cwd: cwd ?? process.cwd(),
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore — process may already be gone
      }
      reject(new Error("npm audit timed out after 60s"));
    }, 60_000);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      // npm audit exits non-zero when vulnerabilities are found — that's
      // an expected case, not a failure. Reject only when stdout is
      // empty (real exec failure).
      if (!stdout) {
        reject(new Error(`npm audit exited ${code} with no stdout: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}
