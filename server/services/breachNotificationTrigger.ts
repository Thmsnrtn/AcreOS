/**
 * Breach Notification Trigger — Niko (privacy audit, 2026-05-27).
 *
 * Regulators do not care that you weren't a bank. GLBA Safeguards Rule
 * (16 CFR 314.4(j)) requires notification within 30 days of discovery of
 * an event affecting ≥500 customers. GDPR Art. 33 requires the controller
 * to notify the supervisory authority "without undue delay and, where
 * feasible, not later than 72 hours after having become aware" of a
 * personal data breach. State laws vary (CA — Civ. Code §1798.82,
 * NY SHIELD Act — Gen. Bus. Law §899-aa, IL PIPA, MA 201 CMR 17, etc.)
 * — most cluster around 30-60 days, with notable exceptions (FL, OH at
 * 30 days; Maine "as expeditiously as possible"; Colorado 30 days).
 *
 * This module:
 *   1. Computes deadlines for every triggered jurisdiction
 *   2. Creates a `system_alerts` row that paths to founder
 *   3. Returns the assessment so calling code can audit-log it
 *
 * Calling code: any security event where personal data exposure is
 * confirmed or reasonably suspected. Examples:
 *   - DB credential leak with row-level access
 *   - Production backup with PII shared externally
 *   - Compromised vendor (sub-processor) that holds AcreOS PII
 *   - Unauthorized employee access to non-scoped tenants
 *   - Lost laptop holding unencrypted PII
 *
 * WHERE IT IS ACTUALLY WIRED (2026-08-16, founder ruling "Wire
 * breachNotificationTrigger only"). Read this before adding a call site.
 *
 * The five examples above are incident TYPES, not code locations, and a
 * search of this repo found NO automated emitter for any of them: nothing
 * detects a leaked DB credential, an externally-shared backup, a
 * sub-processor compromise, a confirmed cross-tenant read, or a lost
 * device. Every one is discovered by a human. So the honest hook is the
 * one mounted, human-driven surface where a security event is DECLARED —
 * the founder-only incident tracker (`server/routes-incidents.ts`,
 * mounted at server/routes.ts) — at both moments awareness can arrive:
 *
 *   POST  /api/founder/incidents      — known to be an exposure at open
 *   PATCH /api/founder/incidents/:id  — reclassified as one after triage
 *
 * `exposureKind` distinguishes which of the five (or which of the four
 * other kinds) occurred; the operator supplies it, along with
 * `affectedDataSubjects` and `categoriesExposed`. Those three are NEVER
 * defaulted or inferred at a call site: `affectedOrgCount` on an incident
 * counts ORGS, not data subjects, and substituting one for the other
 * would be a fabricated statutory input. No exposure block on the request
 * means no assessment runs.
 *
 * Preventive controls that BLOCK (the untrusted-bash egress screens in
 * solene/dispatchToolExecutor, the IDOR guards in utils/orgScope, the
 * bulk-export rate limiter) are deliberately NOT wired here: a blocked
 * attempt is not an exposure, and starting a 72-hour GDPR countdown from
 * one would manufacture obligations that do not exist.
 *
 * THIS DOES NOT REPLACE LEGAL COUNSEL. The triggers and timelines below
 * are best-effort statutory references; the founder must consult counsel
 * before notifying any authority or affected user.
 */

import { db } from "../db";
import { systemAlerts } from "@shared/schema";
import { auditLog, AuditActions } from "../utils/auditLog";
import { logger } from "../utils/logger";

// ─── Deadline matrix ────────────────────────────────────────────────────────
// hoursFromDiscovery for each jurisdiction. We keep this as a static table
// because the deadlines are statutory — they don't change between deploys.
// Updates require a code change so the diff lands in `audit_events`.
export interface JurisdictionDeadline {
  jurisdiction: string;
  authority: string;
  statute: string;
  hoursFromDiscovery: number;
  /** True when the deadline runs from "discovery" rather than "investigation
   * complete" — important because most US state statutes use a "without
   * unreasonable delay, but not later than X days" formulation and several
   * carve out delays for active law-enforcement investigations. */
  startsAtDiscovery: boolean;
  /** Threshold below which notification may not be required. NULL = always. */
  affectedThreshold: number | null;
  /** Whether the regulator wants notification before the affected users. */
  regulatorBeforeUsers: boolean;
}

export const NOTIFICATION_DEADLINES: JurisdictionDeadline[] = [
  // ─── EU / EEA ───────────────────────────────────────────────────────────
  {
    jurisdiction: "EU",
    authority: "Supervisory authority (per Art. 55 lead authority)",
    statute: "GDPR Art. 33(1) — 72h to supervisory authority",
    hoursFromDiscovery: 72,
    startsAtDiscovery: true,
    affectedThreshold: null,
    regulatorBeforeUsers: true,
  },
  {
    jurisdiction: "EU",
    authority: "Affected data subjects",
    statute: "GDPR Art. 34 — without undue delay when high risk",
    hoursFromDiscovery: 24 * 30, // 30d soft ceiling; actual rule is "without undue delay"
    startsAtDiscovery: true,
    affectedThreshold: null,
    regulatorBeforeUsers: false,
  },
  // ─── US federal ────────────────────────────────────────────────────────
  {
    jurisdiction: "US-Federal",
    authority: "FTC",
    statute: "GLBA Safeguards Rule 16 CFR 314.4(j) — 30d if ≥500 affected",
    hoursFromDiscovery: 24 * 30,
    startsAtDiscovery: true,
    affectedThreshold: 500,
    regulatorBeforeUsers: false,
  },
  // ─── US states (selection of the strictest — full set per counsel) ─────
  // California — Civ. Code §1798.82. "Most expedient time possible and
  // without unreasonable delay" + Attorney General notification when ≥500
  // CA residents affected.
  {
    jurisdiction: "US-CA",
    authority: "California AG + affected residents",
    statute: "Cal. Civ. Code §1798.82 + §1798.29",
    hoursFromDiscovery: 24 * 30,
    startsAtDiscovery: true,
    affectedThreshold: null,
    regulatorBeforeUsers: false,
  },
  // New York — Gen. Bus. Law §899-aa (SHIELD Act). "Most expedient time
  // possible and without unreasonable delay"; NY AG + NY Dept of State +
  // NY Div. of State Police when ≥500 NY residents.
  {
    jurisdiction: "US-NY",
    authority: "NY AG + Dept of State + State Police",
    statute: "NY Gen. Bus. Law §899-aa (SHIELD Act)",
    hoursFromDiscovery: 24 * 30,
    startsAtDiscovery: true,
    affectedThreshold: null,
    regulatorBeforeUsers: false,
  },
  // Florida — F.S. §501.171. 30d hard deadline (extendable to 45 with cause).
  {
    jurisdiction: "US-FL",
    authority: "FL Dept of Legal Affairs",
    statute: "Fla. Stat. §501.171(3)(a)",
    hoursFromDiscovery: 24 * 30,
    startsAtDiscovery: true,
    affectedThreshold: null,
    regulatorBeforeUsers: false,
  },
  // Texas — Bus. & Com. Code §521.053. "As quickly as possible" + ≥250 TX
  // residents triggers TX AG notification.
  {
    jurisdiction: "US-TX",
    authority: "TX AG + affected residents",
    statute: "Tex. Bus. & Com. Code §521.053",
    hoursFromDiscovery: 24 * 60,
    startsAtDiscovery: true,
    affectedThreshold: null,
    regulatorBeforeUsers: false,
  },
  // Colorado — C.R.S. §6-1-716. 30d hard deadline.
  {
    jurisdiction: "US-CO",
    authority: "CO AG + affected residents",
    statute: "Colo. Rev. Stat. §6-1-716(2)(a)",
    hoursFromDiscovery: 24 * 30,
    startsAtDiscovery: true,
    affectedThreshold: null,
    regulatorBeforeUsers: false,
  },
];

// ─── Triggering surface ─────────────────────────────────────────────────────

// These are RUNTIME arrays, not bare type unions, because the call sites
// have to validate operator-supplied input against them (a route's Zod
// schema cannot read a TypeScript union). Deriving the types from the
// arrays keeps one source of truth — a category added here is immediately
// accepted at every wired call site, and cannot drift.
export const PERSONAL_DATA_CATEGORIES = [
  "name",
  "email",
  "phone",
  "address",
  "ssn",
  "tax_id",
  "credit_card",
  "bank_account",
  "drivers_license",
  "credit_score",
  "eviction_record",
  "criminal_record",
  "ip_address",
  "geolocation",
  "health",
  "biometric",
  "credentials",
  "session_token",
] as const;

export type PersonalDataCategory = (typeof PERSONAL_DATA_CATEGORIES)[number];

export const EXPOSURE_KINDS = [
  "unauthorized_access",      // confirmed actor read or copied data
  "data_exfiltration",        // confirmed bulk export off-platform
  "credentials_leaked",       // creds in public repo / paste site
  "vendor_compromise",        // sub-processor incident
  "internal_misuse",          // employee or operator overreach
  "device_loss",              // unencrypted laptop / phone
  "misconfiguration",         // S3 bucket public, RLS gap, etc.
  "ransomware",
  "physical_intrusion",
] as const;

export type ExposureKind = (typeof EXPOSURE_KINDS)[number];

export interface BreachInput {
  /** Brief description suitable for system_alerts.title (max 200 chars). */
  summary: string;
  /** Free-text incident-response narrative (events, scope, containment). */
  description: string;
  /** UTC ISO timestamp of when AcreOS became aware. Defaults to now. */
  discoveredAt?: Date;
  /** Number of distinct data subjects affected. Use the high-confidence upper bound. */
  affectedDataSubjects: number;
  /** Personal-data categories confirmed or reasonably suspected to be exposed. */
  categoriesExposed: PersonalDataCategory[];
  /** Kind of exposure event. */
  exposureKind: ExposureKind;
  /** Jurisdictions where affected residents live. Used to filter the deadline matrix.
   *  Pass ["ALL"] to surface every deadline (default — safer for the first triage). */
  jurisdictions?: string[];
  /** Incident-response runbook URL, when available. */
  runbookUrl?: string;
  /** ID of the system_alert row that originated this breach trigger, when
   *  the trigger was raised from an existing alert path. */
  sourceAlertId?: number;
}

export interface BreachAssessment {
  alertId: number;
  discoveredAt: string;
  gdpr72hDeadline: string;
  deadlines: Array<{
    jurisdiction: string;
    authority: string;
    statute: string;
    deadlineAt: string;
    hoursRemaining: number;
    triggered: boolean;
    triggerReason: string;
  }>;
  triggeredJurisdictions: string[];
  notificationRequired: boolean;
}

/**
 * Determine whether a category set crosses the "personal information" line
 * for breach-notification purposes. Most US state statutes require notice
 * only when "personal information" is exposed; the federal GLBA standard
 * + GDPR are broader.
 *
 * This is intentionally generous — false positives result in a system_alert
 * the founder can dismiss; false negatives are statutory violations.
 */
function isPersonalInfoExposed(categories: PersonalDataCategory[]): boolean {
  if (categories.length === 0) return false;
  // Any of these alone crosses the "personal information" threshold.
  const triggeringCategories: PersonalDataCategory[] = [
    "ssn", "tax_id", "credit_card", "bank_account", "drivers_license",
    "credentials", "session_token", "biometric", "health",
    "credit_score", "eviction_record", "criminal_record",
  ];
  if (categories.some((c) => triggeringCategories.includes(c))) return true;
  // Name + (email | phone | address) combinations also trigger most
  // state statutes (the "name plus identifier" pattern).
  const hasName = categories.includes("name");
  const hasIdentifier = categories.some((c) =>
    c === "email" || c === "phone" || c === "address" || c === "ip_address" || c === "geolocation",
  );
  return hasName && hasIdentifier;
}

/**
 * Assess a security event and, if personal data was exposed, create a
 * breach-notification countdown row in system_alerts.
 *
 * Returns the assessment in either case so callers can audit-log the
 * decision (including "no notification required" with the reasoning).
 *
 * Never throws — failures are logged and surfaced as a critical alert.
 */
export async function assessBreachNotification(input: BreachInput): Promise<BreachAssessment> {
  const discoveredAt = input.discoveredAt ?? new Date();
  const piExposed = isPersonalInfoExposed(input.categoriesExposed);

  const wantedJurisdictions = input.jurisdictions ?? ["ALL"];
  const filtered = wantedJurisdictions.includes("ALL")
    ? NOTIFICATION_DEADLINES
    : NOTIFICATION_DEADLINES.filter((d) => wantedJurisdictions.includes(d.jurisdiction));

  const deadlines = filtered.map((d) => {
    const deadlineAt = new Date(discoveredAt.getTime() + d.hoursFromDiscovery * 60 * 60 * 1000);
    const meetsThreshold =
      d.affectedThreshold === null || input.affectedDataSubjects >= d.affectedThreshold;
    const triggered = piExposed && meetsThreshold;
    const triggerReason = !piExposed
      ? "no personal information exposed"
      : !meetsThreshold
        ? `affected (${input.affectedDataSubjects}) below threshold (${d.affectedThreshold})`
        : `personal information exposed (${input.categoriesExposed.join(", ")})`;
    const hoursRemaining = Math.max(
      0,
      Math.floor((deadlineAt.getTime() - Date.now()) / (60 * 60 * 1000)),
    );
    return {
      jurisdiction: d.jurisdiction,
      authority: d.authority,
      statute: d.statute,
      deadlineAt: deadlineAt.toISOString(),
      hoursRemaining,
      triggered,
      triggerReason,
    };
  });

  const triggeredJurisdictions = Array.from(
    new Set(deadlines.filter((d) => d.triggered).map((d) => d.jurisdiction)),
  );
  const notificationRequired = triggeredJurisdictions.length > 0;
  const gdpr72hDeadline = new Date(
    discoveredAt.getTime() + 72 * 60 * 60 * 1000,
  ).toISOString();

  // Always create a system_alerts row so the founder sees this even when
  // the trigger evaluates to "no notification required" — an audit trail
  // beats a missed close call.
  let alertId = 0;
  try {
    const severity = notificationRequired ? "critical" : "warning";
    const [row] = await db
      .insert(systemAlerts)
      .values({
        type: "breach_notification",
        alertType: "breach_notification",
        severity,
        title: notificationRequired
          ? `BREACH NOTIFICATION TRIGGERED — ${input.summary}`
          : `Security event (assess only): ${input.summary}`,
        message: buildAlertMessage(input, deadlines, discoveredAt, notificationRequired),
        // Path to founder (org-scoped null = platform-level alert).
        organizationId: null,
        relatedEntityType: input.sourceAlertId ? "system_alert" : null,
        relatedEntityId: input.sourceAlertId ?? null,
        status: "new",
        autoResolvable: false,
        metadata: {
          discoveredAt: discoveredAt.toISOString(),
          gdpr72hDeadline,
          affectedDataSubjects: input.affectedDataSubjects,
          categoriesExposed: input.categoriesExposed,
          exposureKind: input.exposureKind,
          jurisdictions: wantedJurisdictions,
          deadlines,
          triggeredJurisdictions,
          runbookUrl: input.runbookUrl ?? "/docs/incident-response.md",
          description: input.description,
        },
      })
      .returning({ id: systemAlerts.id });
    alertId = row?.id ?? 0;
  } catch (err) {
    logger.error(
      "[breach-notification] failed to create system_alerts row — manual escalation REQUIRED",
      err as Error,
      {
        metadata: {
          summary: input.summary,
          affectedDataSubjects: input.affectedDataSubjects,
          triggeredJurisdictions,
        },
      },
    );
  }

  // Land an immutable audit row too — even if the system_alert insert
  // succeeded, the audit log is where the regulator will look first.
  try {
    await auditLog({
      actor: { userId: null, email: "system@acreos.io", ip: null, userAgent: null },
      action: "security.breach_notification_assessed",
      target: { type: "settings", id: String(alertId) },
      justification: input.summary,
      metadata: {
        discoveredAt: discoveredAt.toISOString(),
        affectedDataSubjects: input.affectedDataSubjects,
        categoriesExposed: input.categoriesExposed,
        exposureKind: input.exposureKind,
        notificationRequired,
        triggeredJurisdictions,
        gdpr72hDeadline,
      },
    });
    // Reference the AuditActions namespace so this file's lint doesn't
    // mark the import as unused while the audit-action name evolves.
    void AuditActions;
  } catch (err) {
    logger.error("[breach-notification] audit_events write failed", err as Error);
  }

  return {
    alertId,
    discoveredAt: discoveredAt.toISOString(),
    gdpr72hDeadline,
    deadlines,
    triggeredJurisdictions,
    notificationRequired,
  };
}

function buildAlertMessage(
  input: BreachInput,
  deadlines: BreachAssessment["deadlines"],
  discoveredAt: Date,
  notificationRequired: boolean,
): string {
  const lines: string[] = [];
  lines.push(input.description);
  lines.push("");
  lines.push(`Discovered at: ${discoveredAt.toISOString()}`);
  lines.push(`Affected data subjects (upper bound): ${input.affectedDataSubjects}`);
  lines.push(`Exposure kind: ${input.exposureKind}`);
  lines.push(`Categories exposed: ${input.categoriesExposed.join(", ") || "none"}`);
  lines.push("");
  if (!notificationRequired) {
    lines.push("ASSESSMENT: No statutory breach-notification trigger fired.");
    lines.push("Reasoning: either personal information was not exposed or affected counts were below thresholds.");
    lines.push("Founder still reviews — assessment is recorded in audit_events.");
    return lines.join("\n");
  }
  lines.push("ASSESSMENT: Statutory breach-notification triggers fired.");
  lines.push("Founder MUST consult counsel before notifying any authority.");
  lines.push("");
  lines.push("Deadlines (triggered first):");
  const sorted = [...deadlines].sort((a, b) => {
    if (a.triggered !== b.triggered) return a.triggered ? -1 : 1;
    return a.hoursRemaining - b.hoursRemaining;
  });
  for (const d of sorted) {
    const flag = d.triggered ? "TRIGGERED" : "monitor only";
    lines.push(
      `  [${flag}] ${d.jurisdiction} — ${d.authority}: ${d.deadlineAt} (${d.hoursRemaining}h remaining) — ${d.statute}`,
    );
  }
  return lines.join("\n");
}

/**
 * Convenience: assess from an existing `system_alerts` row. Used by the
 * SOC pipeline when an alert's metadata indicates personal-data exposure
 * (e.g. autonomousHealthMonitor sees a "row leak" telemetry signal).
 */
export async function assessFromExistingAlert(alertId: number, input: Omit<BreachInput, "sourceAlertId">): Promise<BreachAssessment> {
  return assessBreachNotification({ ...input, sourceAlertId: alertId });
}
