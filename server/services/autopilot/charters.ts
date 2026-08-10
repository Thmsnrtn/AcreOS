/**
 * Wave S · S1 — the Staff Charter registry (charters over gates).
 *
 * Addendum C's finding: the five Trust-Ledger domains are *gates*, not
 * colleagues — no mandates, no owned metrics, no legible track record. This
 * module binds each domain to a CHARTER: mandate · metrics owned (live values
 * or honest absence) · core senses (each honestly marked wired/unwired from
 * the SENSE_INVENTORY) · hands granted (DERIVED from the real hands registry,
 * never declared) · standing orders · ladder state + streak (from the real
 * Trust Ledger) · budget · escalation rules (derived from the real witnessed-
 * send + hard-stop invariants) · report cadence.
 *
 * Honesty is load-bearing, same as everywhere else in the autopilot:
 *   • handsGranted comes from listHandSpecs() at read time — a new hand is
 *     automatically chartered under its domain or the staffCharters suite
 *     names it; nothing here can drift from the registry.
 *   • coreSenses[].wired derives from the SENSE_INVENTORY (loader exists AND
 *     the brain consumes it) — the same derivation the S2 promotion gate
 *     reads, so what the founder sees and what the ladder enforces can never
 *     disagree.
 *   • every metric value is read from a real source, best-effort, and is
 *     null — never a number — when the read fails.
 *
 * Beatrice (compliance) is the SIXTH charter. Extending the AutopilotDomain
 * union through policyGate + the seeded trust-ledger rows is invasive today
 * (crossFunction.ts and the tick build exhaustive Record<AutopilotDomain,·>
 * maps outside this wave's file set), so her charter ships WITHOUT a
 * trust-ledger row, honestly marked as not yet on the ladder.
 *
 * S2 — autonomy follows perception: promotionPerceptionGate() is the pure
 * rule "a domain with ANY unwired core sense cannot be promoted past draft".
 * domainAutonomy.recordCleanCycle consults it before minting a promotion
 * card. Restriction only: it never widens autonomy, never auto-promotes, and
 * the founder's sovereign setDomainLevel override is untouched.
 */
import { desc, inArray } from "drizzle-orm";
import { db } from "../../db";
import { proofReceipts } from "@shared/schema";
import { logger } from "../../utils/logger";
import { listHandSpecs } from "./hands";
import { HARD_STOPS } from "./hardStops";
import {
  getTrustLedger,
  gateResultForLevel,
  levelRank,
  nextLevel,
  type DomainAutonomyLevel,
} from "./domainAutonomy";
import { SENSE_INVENTORY, senseIsWired, type SenseWiring } from "./senses";
import type { AutopilotDomain } from "./policyGate";

// ── Charter definitions (static config; everything dynamic is derived) ──────

/** The staff roster: the five Trust-Ledger domains + Beatrice (compliance). */
export type CharterDomain = AutopilotDomain | "compliance";

export interface CharterDef {
  domain: CharterDomain;
  /** The people-shaped handle. Names stay sparse and real (Addendum C). */
  displayName: string;
  role: string;
  mandate: string;
  /** Keys into SENSE_INVENTORY — the eyes this mandate NEEDS. */
  coreSenseKeys: readonly string[];
  /** Keys into the metric readers in getStaffCharters. */
  metricKeys: readonly string[];
}

export const CHARTER_DEFS: readonly CharterDef[] = [
  {
    domain: "growth",
    displayName: "Growth",
    role: "Demand & activation",
    mandate:
      "Grow qualified demand through owned channels — content, outreach, parcel-check — and convert trials to customers, without ever outranking an open incident, a red envelope, or an open compliance finding.",
    coreSenseKeys: ["trials", "trials_ending", "attributed_signups", "activation_funnel"],
    metricKeys: ["trials", "attributed_signups"],
  },
  {
    domain: "support",
    displayName: "Support",
    role: "Customers & retention",
    mandate:
      "Answer waiting customers fast and honestly, retain the at-risk, and escalate anything the playbooks cannot ground — refuse-not-fabricate applies to every reply.",
    coreSenseKeys: ["support_backlog", "churn_signals", "support_sla_timers"],
    metricKeys: ["support_backlog", "churn_signals_24h"],
  },
  {
    domain: "deploy",
    displayName: "Solene — Deploy",
    role: "Build & runtime",
    mandate:
      "Keep the product shippable and stable: watch incidents and the reflex layer, prepare fixes through the code-change gate — and never merge its own patch.",
    coreSenseKeys: ["open_incidents", "reflex_failures", "deploy_canary_health"],
    metricKeys: ["flagged_dispatches_24h", "reflex_failures_6h"],
  },
  {
    domain: "ops",
    displayName: "Ops",
    role: "Platform health",
    mandate:
      "Keep the machine's own systems healthy — deliverability, uptime, cost posture — and tighten a playbook or reduce a cost when nothing is urgent.",
    coreSenseKeys: ["email_complaints", "uptime", "slo_canaries"],
    metricKeys: ["email_complaints_24h", "uptime_pct"],
  },
  {
    domain: "finance",
    displayName: "Finance",
    role: "Runway & recovery",
    mandate:
      "Protect runway and recover revenue: dunning, trial conversion, the spend envelope. Money never moves without a founder tap, and customer money never moves on AcreOS's account at all.",
    coreSenseKeys: ["envelope_status", "dunning_pressure", "budget_books", "unit_economics"],
    metricKeys: ["mrr", "dunning_pressure_24h", "mtd_spend_usd"],
  },
  {
    domain: "compliance",
    displayName: "Beatrice — Compliance",
    role: "Findings, statutes & obligations",
    mandate:
      "Own the findings ledger, statute verification, claims lint, and dated obligations. Nothing outward ships over an open compliance finding, and legal assertions are sourced or absent — never invented.",
    coreSenseKeys: ["compliance_open", "obligation_countdowns", "claim_verification"],
    metricKeys: ["compliance_open"],
  },
];

// ── Pure derivations (no IO — unit-tested directly) ─────────────────────────

export function getCharterDef(domain: CharterDomain): CharterDef | undefined {
  return CHARTER_DEFS.find((c) => c.domain === domain);
}

export interface CharterSense {
  key: string;
  label: string;
  wired: boolean;
  gap?: string;
}

/** A charter's core senses, each honestly marked wired/unwired. */
export function charterCoreSenses(domain: CharterDomain): CharterSense[] {
  const def = getCharterDef(domain);
  if (!def) return [];
  return def.coreSenseKeys.map((key) => {
    const inv: SenseWiring | undefined = SENSE_INVENTORY.find((s) => s.key === key);
    return {
      key,
      label: inv?.label ?? key,
      // An unknown key reads as unwired — the fail-safe direction (it can
      // only RESTRICT promotion, never widen it).
      wired: senseIsWired(key),
      ...(inv?.gap ? { gap: inv.gap } : {}),
    };
  });
}

/** The unwired core senses of a charter (founder-facing labels). */
function unwiredCoreSenseLabels(domain: CharterDomain): string[] {
  return charterCoreSenses(domain)
    .filter((s) => !s.wired)
    .map((s) => s.label);
}

/** The hands a charter holds — DERIVED from the real registry, never declared. */
export function charterHandSpecs(domain: CharterDomain): ReturnType<typeof listHandSpecs> {
  return listHandSpecs()
    .filter((h) => h.domain === domain)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * S2 — the promotion-perception rule, pure: a promotion whose TARGET level is
 * past `draft` is refused while the charter has ANY unwired core sense.
 * observe → draft always passes this gate (drafting is how a domain earns its
 * eyes); the rest of the promotion machinery (thresholds, calibration and
 * quality holds, the founder's tap) is unchanged and still applies.
 */
export function promotionPerceptionGate(
  domain: AutopilotDomain,
  targetLevel: DomainAutonomyLevel,
): { allowed: boolean; reason: string | null } {
  if (levelRank(targetLevel) <= levelRank("draft")) {
    return { allowed: true, reason: null };
  }
  // Fail SAFE, not open: a domain with no charter on file cannot be promoted
  // past draft either — otherwise an unchartered domain would slip past the
  // perception rule entirely (fleet-7 verifier catch). The staffCharters
  // coverage pin makes this unreachable in CI, but the runtime rule must
  // match the module's fail-safe claim on its own.
  if (!getCharterDef(domain)) {
    return {
      allowed: false,
      reason: "cannot be promoted past draft — no charter on file for this domain",
    };
  }
  const unwired = unwiredCoreSenseLabels(domain);
  if (unwired.length === 0) return { allowed: true, reason: null };
  return {
    allowed: false,
    reason:
      `cannot be promoted past draft — autonomy follows perception, and this charter cannot yet see: ` +
      unwired.join("; "),
  };
}

// ── The assembled charter (IO — best-effort, honest absence everywhere) ─────

export interface CharterMetric {
  key: string;
  label: string;
  /** null = the read failed or the source has no data — never invented. */
  value: number | null;
  unit: "count" | "usd" | "pct";
}

export interface CharterLadder {
  onLedger: boolean;
  level?: DomainAutonomyLevel;
  cleanCycleCount?: number;
  threshold?: number;
  lastDemotedAt?: string | null;
  lastDemotionReason?: string | null;
  /** S2 — why the NEXT promotion card will not be minted, if it won't. */
  promotionBlockedReason?: string | null;
  /** For charters not on the trust ledger (Beatrice), the honest note. */
  note?: string;
}

export interface StaffCharter {
  domain: CharterDomain;
  displayName: string;
  role: string;
  mandate: string;
  metricsOwned: CharterMetric[];
  coreSenses: CharterSense[];
  handsGranted: Array<{ name: string; witnessed: boolean }>;
  standingOrders: string[];
  ladder: CharterLadder;
  /** The shared AI/data envelope this staff spends from; null when unreadable. */
  budget: { effectiveCapUsd: number; mtdSpendUsd: number } | null;
  escalationRules: string[];
  reportCadence: string;
  /** Last three proof receipts for this charter's hands (may be empty). */
  receipts: Array<{ atIso: string | null; line: string }>;
}

export interface BlindSpot {
  senseKey: string;
  label: string;
  /** Which staff members this gap blinds. */
  blinds: string[];
  /** The Letter line, composed server-side. */
  line: string;
}

export interface StaffChartersResponse {
  charters: StaffCharter[];
  blindSpots: BlindSpot[];
}

/**
 * The Letter's blindness lines — every unwired core sense across the staff,
 * deduped, each naming who it blinds. Pure over the static registry.
 */
export function deriveBlindSpots(): BlindSpot[] {
  const byKey = new Map<string, BlindSpot>();
  for (const def of CHARTER_DEFS) {
    for (const s of charterCoreSenses(def.domain)) {
      if (s.wired) continue;
      const existing = byKey.get(s.key);
      if (existing) {
        existing.blinds.push(def.displayName);
      } else {
        byKey.set(s.key, { senseKey: s.key, label: s.label, blinds: [def.displayName], line: "" });
      }
    }
  }
  const out = [...byKey.values()];
  for (const b of out) {
    b.line = `I cannot yet see ${b.label} — it keeps ${b.blinds.join(" and ")} at watching/drafting.`;
  }
  return out;
}

// All charters report the same way today — these are the real surfaces.
const REPORT_CADENCE =
  "Daily in the Letter (the morning brief); every witnessed action leaves a proof receipt in the Story.";

/**
 * Assemble the full staff-charter roster for the founder endpoint. Every
 * dynamic value reads a real source best-effort; a failed read renders as
 * honest absence (null / empty), never as a fabricated number.
 */
export async function getStaffCharters(): Promise<StaffChartersResponse> {
  // ── Shared source reads (each isolated; failure ⇒ honest absence) ─────────
  let pulse: {
    mrr: number;
    trials: number;
    uptimePct: number | null;
    complianceOpenCount: number;
    dispatchesFlaggedLast24h?: number;
  } | null = null;
  try {
    const { getLatestMorningPulse } = await import("../solene/continuousLoop");
    pulse = await getLatestMorningPulse();
  } catch {
    pulse = null;
  }

  let outward: { emailComplaints: number; dunningPressure: number; churnSignals: number } | null = null;
  try {
    const { readOutwardSenses, outwardSignalFrom } = await import("./perception");
    const sig = outwardSignalFrom(await readOutwardSenses(24));
    outward = {
      emailComplaints: sig.emailComplaints,
      dunningPressure: sig.dunningPressure,
      churnSignals: sig.churnSignals,
    };
  } catch {
    outward = null;
  }

  let supportBacklog: number | null = null;
  try {
    const { getOpenSupportCaseCount } = await import("./senses");
    supportBacklog = await getOpenSupportCaseCount();
  } catch {
    supportBacklog = null;
  }

  let attributedSignups: number | null = null;
  try {
    const { getConversionSummary } = await import("./attribution");
    attributedSignups = (await getConversionSummary()).totalSignups;
  } catch {
    attributedSignups = null;
  }

  let reflexFailures: number | null = null;
  try {
    const { readReflexHealth } = await import("./reflexes");
    reflexFailures = (await readReflexHealth(6)).failed;
  } catch {
    reflexFailures = null;
  }

  let budget: { effectiveCapUsd: number; mtdSpendUsd: number } | null = null;
  try {
    const { getEffectiveMonthlyCapUsd, getMonthToDateSpendForType } = await import(
      "../solene/capitalTracker"
    );
    budget = {
      effectiveCapUsd: await getEffectiveMonthlyCapUsd(),
      mtdSpendUsd: await getMonthToDateSpendForType("agent_dispatch"),
    };
  } catch {
    budget = null;
  }

  let standingOrders: string[] = [];
  try {
    const { listStandingOrders } = await import("./standingOrders");
    standingOrders = (await listStandingOrders({ activeOnly: true })).map((o) => o.body);
  } catch {
    standingOrders = [];
  }

  let ledger: Awaited<ReturnType<typeof getTrustLedger>> = [];
  try {
    ledger = await getTrustLedger();
  } catch {
    ledger = [];
  }

  // Last three receipts per charter, from the real proof-receipt chain: one
  // bounded query over every registered hand name, grouped client-side here.
  const receiptsByDomain = new Map<CharterDomain, Array<{ atIso: string | null; line: string }>>();
  try {
    const specs = listHandSpecs();
    // Per-domain queries, not one shared window: a single recent-60 window
    // could show "no witnessed actions" for a quiet domain whose receipts
    // all fall outside the busy domains' window — a false negative once
    // volume grows (fleet-7 verifier catch). Six bounded queries on a
    // founder-only read is the correct trade.
    const domains = [...new Set(specs.map((h) => h.domain as CharterDomain))];
    for (const domain of domains) {
      const handNames = specs.filter((h) => (h.domain as CharterDomain) === domain).map((h) => h.name);
      if (handNames.length === 0) continue;
      const rows = await db
        .select({
          actionKind: proofReceipts.actionKind,
          scope: proofReceipts.scope,
          issuedAt: proofReceipts.issuedAt,
        })
        .from(proofReceipts)
        .where(inArray(proofReceipts.actionKind, handNames))
        .orderBy(desc(proofReceipts.id))
        .limit(3);
      if (rows && rows.length > 0) {
        receiptsByDomain.set(
          domain,
          rows.map((r) => ({
            atIso: r.issuedAt ?? null,
            line: `${r.actionKind} — witnessed (${r.scope})`,
          })),
        );
      }
    }
  } catch (err) {
    logger.warn(
      "[autopilot/charters] receipt read failed — rendering honest absence",
      err instanceof Error ? err : undefined,
    );
  }

  // ── Metric readers (every value real-or-null) ─────────────────────────────
  const METRICS: Record<string, { label: string; unit: CharterMetric["unit"]; value: number | null }> = {
    trials: { label: "Trials in window", unit: "count", value: pulse ? pulse.trials : null },
    attributed_signups: { label: "Attributed signups (lower bound)", unit: "count", value: attributedSignups },
    support_backlog: { label: "Customers waiting on support", unit: "count", value: supportBacklog },
    churn_signals_24h: { label: "Churn signals (24h)", unit: "count", value: outward ? outward.churnSignals : null },
    mrr: { label: "MRR", unit: "usd", value: pulse ? pulse.mrr : null },
    dunning_pressure_24h: { label: "Failed payments in dunning (24h)", unit: "count", value: outward ? outward.dunningPressure : null },
    mtd_spend_usd: { label: "AI + data spend (month to date)", unit: "usd", value: budget ? budget.mtdSpendUsd : null },
    flagged_dispatches_24h: { label: "Flagged dispatches (24h)", unit: "count", value: pulse ? (pulse.dispatchesFlaggedLast24h ?? null) : null },
    reflex_failures_6h: { label: "Reflex failures (6h)", unit: "count", value: reflexFailures },
    email_complaints_24h: { label: "Spam complaints (24h)", unit: "count", value: outward ? outward.emailComplaints : null },
    uptime_pct: { label: "Uptime (30d window)", unit: "pct", value: pulse ? pulse.uptimePct : null },
    compliance_open: { label: "Open compliance findings", unit: "count", value: pulse ? pulse.complianceOpenCount : null },
  };

  const ledgerByDomain = new Map(ledger.map((r) => [r.domain, r]));

  const charters: StaffCharter[] = CHARTER_DEFS.map((def) => {
    const hands = charterHandSpecs(def.domain);
    const witnessedHands = hands.filter((h) => h.requiresApproval).map((h) => h.name);

    // Ladder — real Trust-Ledger standing for the five domains; Beatrice is
    // honestly off the ladder until the compliance domain is added to it.
    let ladder: CharterLadder;
    if (def.domain === "compliance") {
      ladder = {
        onLedger: false,
        note:
          "Not yet on the trust ledger — Beatrice's findings run through the compliance system; her autonomy ladder starts when the compliance domain joins it.",
      };
    } else {
      const row = ledgerByDomain.get(def.domain);
      const level = (row?.level ?? "observe") as DomainAutonomyLevel;
      const target = nextLevel(level);
      const verdict = target ? promotionPerceptionGate(def.domain, target) : { allowed: true, reason: null };
      ladder = {
        onLedger: true,
        level,
        cleanCycleCount: row?.cleanCycleCount ?? 0,
        threshold: row?.threshold ?? 10,
        lastDemotedAt: row?.lastDemotedAt ? new Date(row.lastDemotedAt).toISOString() : null,
        lastDemotionReason: row?.lastDemotionReason ?? null,
        promotionBlockedReason: verdict.allowed ? null : verdict.reason,
      };
    }

    // Escalation rules — derived from the real invariants, never prose-only:
    // the current autonomy-gate verdict, the witnessed-send set, hard-stops.
    const escalationRules: string[] = [];
    if (ladder.onLedger && ladder.level) {
      const gate = gateResultForLevel(ladder.level);
      escalationRules.push(
        gate.status === "pass"
          ? "Auto-executes only through the full policy-gate stack (compliance / quality / budget / witnessed)."
          : gate.reason ?? "Blocked by the autonomy gate.",
      );
    } else {
      escalationRules.push("Observes and files findings; no autonomy ladder yet — every outward step is a founder decision.");
    }
    if (witnessedHands.length > 0) {
      escalationRules.push(`${witnessedHands.join(", ")}: always your tap first (witnessed-send).`);
    }
    escalationRules.push(
      `Hard-stops stay yours forever: ${HARD_STOPS.map((h) => h.replace(/_/g, " ")).join(", ")}.`,
    );

    return {
      domain: def.domain,
      displayName: def.displayName,
      role: def.role,
      mandate: def.mandate,
      metricsOwned: def.metricKeys.map((k) => ({
        key: k,
        label: METRICS[k]?.label ?? k,
        value: METRICS[k]?.value ?? null,
        unit: METRICS[k]?.unit ?? "count",
      })),
      coreSenses: charterCoreSenses(def.domain),
      handsGranted: hands
        .map((h) => ({ name: h.name, witnessed: h.requiresApproval }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      standingOrders,
      ladder,
      budget,
      escalationRules,
      reportCadence: REPORT_CADENCE,
      receipts: receiptsByDomain.get(def.domain) ?? [],
    };
  });

  return { charters, blindSpots: deriveBlindSpots() };
}
