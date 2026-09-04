/**
 * Pure logic + types for the founder Command cockpit (`/founder/command`).
 *
 * This module holds NO React — every export is a pure function or a type so
 * the worst-severity rollup / status-banner derivation is unit-testable
 * without a DOM. The page and tile components import from here.
 *
 * Contract (owned by a parallel substrate agent):
 *   GET /api/founder/audit-findings → { findings: AuditFinding[]; rollup: DomainRollup[] }
 *   POST /api/founder/audit-findings/:id/acknowledge
 *   POST /api/founder/audit-findings/:id/resolve
 *
 * We consume it DEFENSIVELY: the page derives its own rollup from `findings`
 * when the server omits `rollup`, and tolerates unknown domains/severities.
 */

import {
  Wallet,
  Scale,
  Compass,
  Sparkles,
  ActivitySquare,
  Telescope,
  Package,
  HeartHandshake,
  TrendingUp,
  Circle,
  type LucideIcon,
} from "lucide-react";

// ─── Domains ────────────────────────────────────────────────────────────────

export const DOMAINS = [
  "finance",
  "compliance",
  "alignment",
  "ai",
  "reliability",
  "future",
  "product",
  "cs",
  "growth",
] as const;

export type Domain = (typeof DOMAINS)[number];

export interface DomainMeta {
  key: Domain;
  label: string;
  icon: LucideIcon;
  /** One-line "what this domain watches" for the tile sub-label. */
  blurb: string;
}

export const DOMAIN_META: Record<Domain, DomainMeta> = {
  finance: {
    key: "finance",
    label: "Finance",
    icon: Wallet,
    blurb: "Capital, burn, runway, ledger integrity",
  },
  compliance: {
    key: "compliance",
    label: "Compliance",
    icon: Scale,
    blurb: "Legal, security, regulatory posture",
  },
  alignment: {
    key: "alignment",
    label: "Alignment",
    icon: Compass,
    blurb: "Constitutional drift, ethics, guardrails",
  },
  ai: {
    key: "ai",
    label: "AI",
    icon: Sparkles,
    blurb: "Pax behaviour, calibration, model evals",
  },
  reliability: {
    key: "reliability",
    label: "Reliability",
    icon: ActivitySquare,
    blurb: "Uptime, errors, capacity, incidents",
  },
  future: {
    key: "future",
    label: "Future",
    icon: Telescope,
    blurb: "Horizon scans, R&D, experiments",
  },
  product: {
    key: "product",
    label: "Product",
    icon: Package,
    blurb: "Activation, funnels, feature health",
  },
  cs: {
    key: "cs",
    label: "Customer Success",
    icon: HeartHandshake,
    blurb: "Retention, support, expansion",
  },
  growth: {
    key: "growth",
    label: "Growth",
    icon: TrendingUp,
    blurb: "Acquisition, conversion, distribution",
  },
};

/** Defensive lookup — unknown domains still render with a neutral icon. */
export function domainMeta(domain: string): DomainMeta {
  return (
    DOMAIN_META[domain as Domain] ?? {
      key: domain as Domain,
      label: titleCase(domain),
      icon: Circle,
      blurb: "Continuous audit findings",
    }
  );
}

function titleCase(s: string): string {
  if (!s) return "Unknown";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Findings ───────────────────────────────────────────────────────────────

export type Severity = "info" | "warn" | "critical";
export type FindingStatus = "open" | "acknowledged" | "resolved" | "stale";

export interface AuditFinding {
  id: string;
  domain: string;
  detector: string;
  severity: Severity;
  title: string;
  detail: string;
  citedReason: string;
  status: FindingStatus;
  subjectRef?: string | null;
  metadata?: Record<string, unknown> | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Per-domain counts, as the substrate may return them. */
export interface DomainRollup {
  domain: string;
  open: number;
  warn: number;
  critical: number;
}

export interface AuditFindingsResponse {
  findings: AuditFinding[];
  rollup?: DomainRollup[];
}

// ─── Status model ─────────────────────────────────────────────────────────────

/** Three-state company / domain status, ordered worst-last for max(). */
export type StatusLevel = "green" | "amber" | "red";

const STATUS_RANK: Record<StatusLevel, number> = {
  green: 0,
  amber: 1,
  red: 2,
};

/** A finding is "active" (counts toward status) only when open or acknowledged. */
export function isActiveFinding(f: Pick<AuditFinding, "status">): boolean {
  return f.status === "open" || f.status === "acknowledged";
}

/**
 * Map a single severity to a status level.
 * critical → red, warn → amber, info → green (info is informational, not a problem).
 */
export function severityToStatus(sev: Severity): StatusLevel {
  if (sev === "critical") return "red";
  if (sev === "warn") return "amber";
  return "green";
}

/** The worse of two statuses (red beats amber beats green). */
export function worseStatus(a: StatusLevel, b: StatusLevel): StatusLevel {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

// ─── Per-domain aggregation ─────────────────────────────────────────────────

export interface DomainSummary {
  domain: string;
  meta: DomainMeta;
  status: StatusLevel;
  /** Active findings only (open + acknowledged). */
  activeFindings: AuditFinding[];
  openCount: number;
  warnCount: number;
  criticalCount: number;
  /** Highest-severity, most-recently-seen active finding (or null). */
  topFinding: AuditFinding | null;
}

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warn: 1, critical: 2 };

/**
 * Pick the "top" finding: highest severity, breaking ties by most-recent
 * lastSeenAt. Returns null for an empty list.
 */
export function pickTopFinding(findings: AuditFinding[]): AuditFinding | null {
  let top: AuditFinding | null = null;
  for (const f of findings) {
    if (top === null) {
      top = f;
      continue;
    }
    const sevDelta = SEVERITY_RANK[f.severity] - SEVERITY_RANK[top.severity];
    if (sevDelta > 0) {
      top = f;
    } else if (sevDelta === 0 && f.lastSeenAt > top.lastSeenAt) {
      top = f;
    }
  }
  return top;
}

/**
 * Build a per-domain summary for one domain from its findings.
 * `open` count = number of active findings (status open|acknowledged).
 * `warn`/`critical` = active findings at that severity.
 */
export function summarizeDomain(
  domain: string,
  findings: AuditFinding[],
): DomainSummary {
  const active = findings.filter(isActiveFinding);
  let warnCount = 0;
  let criticalCount = 0;
  let status: StatusLevel = "green";
  for (const f of active) {
    if (f.severity === "warn") warnCount += 1;
    else if (f.severity === "critical") criticalCount += 1;
    status = worseStatus(status, severityToStatus(f.severity));
  }
  return {
    domain,
    meta: domainMeta(domain),
    status,
    activeFindings: active,
    openCount: active.length,
    warnCount,
    criticalCount,
    topFinding: pickTopFinding(active),
  };
}

/**
 * Build summaries for ALL canonical domains (so every tile renders even with
 * zero findings), in canonical order, from the flat findings array.
 */
export function summarizeAllDomains(findings: AuditFinding[]): DomainSummary[] {
  const byDomain = new Map<string, AuditFinding[]>();
  for (const f of findings) {
    const arr = byDomain.get(f.domain);
    if (arr) arr.push(f);
    else byDomain.set(f.domain, [f]);
  }
  // Canonical domains first, then any unexpected extra domains the server sent.
  const extras = [...byDomain.keys()].filter(
    (d) => !DOMAINS.includes(d as Domain),
  );
  const order = [...DOMAINS, ...extras];
  return order.map((d) => summarizeDomain(d, byDomain.get(d) ?? []));
}

/**
 * The company-wide status banner level: the worst status across every domain.
 * Empty / all-green → "green".
 */
export function companyStatus(summaries: DomainSummary[]): StatusLevel {
  let status: StatusLevel = "green";
  for (const s of summaries) status = worseStatus(status, s.status);
  return status;
}

/** Total active findings across all domains. */
export function totalActiveFindings(summaries: DomainSummary[]): number {
  return summaries.reduce((acc, s) => acc + s.openCount, 0);
}

/** Total criticals / warns across all domains (for banner copy). */
export function totalsBySeverity(summaries: DomainSummary[]): {
  critical: number;
  warn: number;
} {
  let critical = 0;
  let warn = 0;
  for (const s of summaries) {
    critical += s.criticalCount;
    warn += s.warnCount;
  }
  return { critical, warn };
}

// ─── Presentation helpers (token class names + copy, no JSX) ──────────────────

export interface StatusCopy {
  /** Banner headline. */
  headline: string;
  /** Banner sub-line. */
  sub: string;
}

export function companyStatusCopy(
  status: StatusLevel,
  criticalCount: number,
  warnCount: number,
): StatusCopy {
  if (status === "green") {
    return {
      headline: "All clear — nothing needs you",
      sub: "Every domain's continuous audit is green right now.",
    };
  }
  if (status === "amber") {
    return {
      headline: `${warnCount} thing${warnCount === 1 ? "" : "s"} worth a look`,
      sub: "No criticals — these are warnings the team is watching.",
    };
  }
  return {
    headline: `${criticalCount} critical${criticalCount === 1 ? "" : "s"} need attention`,
    sub: "At least one domain has a critical finding. Start there.",
  };
}

/**
 * Tailwind token class names per status. Uses the acr-* sentiment tokens
 * (pos/warn/neg) so this respects every theme + dark mode. Never hardcode hex.
 */
export const STATUS_CLASSES: Record<
  StatusLevel,
  { dot: string; text: string; border: string; surface: string; ring: string }
> = {
  green: {
    dot: "bg-acr-pos",
    text: "text-acr-pos",
    border: "border-acr-pos/30",
    surface: "bg-acr-pos-soft",
    ring: "focus-visible:ring-acr-pos",
  },
  amber: {
    dot: "bg-acr-warn",
    text: "text-acr-warn",
    border: "border-acr-warn/30",
    surface: "bg-acr-warn-soft",
    ring: "focus-visible:ring-acr-warn",
  },
  red: {
    dot: "bg-acr-neg",
    text: "text-acr-neg",
    border: "border-acr-neg/40",
    surface: "bg-acr-neg-soft",
    ring: "focus-visible:ring-acr-neg",
  },
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  info: "Info",
  warn: "Warning",
  critical: "Critical",
};

/** Status class set for one severity chip (info renders neutral). */
export function severityChipClasses(sev: Severity): { text: string; surface: string } {
  if (sev === "critical") return { text: "text-acr-neg-soft-ink", surface: "bg-acr-neg-soft" };
  if (sev === "warn") return { text: "text-acr-warn-soft-ink", surface: "bg-acr-warn-soft" };
  return { text: "text-muted-foreground", surface: "bg-muted" };
}
