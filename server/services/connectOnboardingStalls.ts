/**
 * Lender Connect onboarding stalls — autopilot brief B-7 (founder-autopilot
 * drills, 2026-11-16, ranked Medium).
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 * A lender's Standard Connect account sits in `currentlyDue` until the
 * account holder finishes Stripe's hosted onboarding — and nothing in
 * AcreOS watches the wait. P3-4's six runs are the incident record: the
 * fixture account needed manual API completion of every requirement, the
 * settlement leg failed three times at the onboarding wall, and the stall
 * was visible only because a human kept re-reading the account. An
 * unseen stall costs the lender their first payment and costs AcreOS a
 * customer who concludes the product is broken.
 *
 * ── WHAT THIS DOES ─────────────────────────────────────────────────────────
 *   (a) CLOCK — every observation of a connected account with requirements
 *       outstanding (the `account.updated` webhook via
 *       `updateAccountStatus`, or this module's daily sweep live-reading
 *       Stripe) seeds `stripeConnectStallFirstSeenAt` in the integration
 *       row's settings the first time it is seen stuck, and keeps it
 *       while the stall persists. The day the requirements empty, the
 *       stall keys clear — a resolved stall never re-alerts.
 *   (b) LIST — `listOnboardingStalls` reads the stalled rows from the
 *       database alone (no Stripe call) and shapes the founder-visible
 *       aging list: org, account, requirements, days stuck, alert state.
 *       The founder integrations endpoint serves it; the Bridge action
 *       queue carries the 7-day-plus rows.
 *   (c) ALERT — at 7 days stuck, the daily sweep raises ONE founder
 *       `systemAlert` (org-scoped, warning) and notifies the lender
 *       through the witnessed rails (push + in-app, preference-gated on
 *       `finance.onboarding_stall`, mirroring the B-2 dispute notice).
 *       `stripeConnectStallAlertedAt` stamps the firing so it happens
 *       once per stall episode; the aging list keeps the stall visible
 *       every day after that.
 *
 * ── WHAT THIS NEVER DOES ───────────────────────────────────────────────────
 * NO AUTOMATIC ACCOUNT CHANGES. The sweep reads Stripe and writes stall
 * bookkeeping only — never a capability request, never an onboarding
 * write, never a charge. NO EMAIL OR SMS TO THE LENDER: a lender-facing
 * reminder is a customer send, and the only lender leg here is the
 * witnessed push + in-app notice (the B-2 rails). An emailed reminder,
 * if the founder ever wants one, goes through the outward-action rail
 * as its own founder decision — it is deliberately not built here.
 * Detection + surfacing only.
 *
 * ── FIRST-SEEN HONESTY ─────────────────────────────────────────────────────
 * A stall that predates this slice has no first-seen timestamp until the
 * first observation after deploy seeds it — its clock starts then, not
 * at account creation. The age shown is "stuck since first seen by the
 * detector", and the record says so rather than backdating a guess.
 *
 * Dependencies are injectable (the outbox-reaper DI pattern) so the whole
 * behaviour is unit-provable without a database or a Stripe account; the
 * defaults are the production seams.
 */

import type { InsertOrganizationIntegration } from "@shared/schema";
import { logger } from "../utils/logger";
import { clock } from "../utils/clock";

/** Days stuck before the founder alert + lender notice fire. */
const ONBOARDING_STALL_ALERT_AFTER_DAYS = 7;
/** Founder systemAlert type for a stalled lender onboarding. */
const ONBOARDING_STALL_ALERT_TYPE = "stripe_connect_onboarding_stall";
const ONBOARDING_STALL_EVENT_ID = "finance.onboarding_stall";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The three stall keys carried in the integration row's settings JSONB. */
export interface OnboardingStallSettings {
  stripeConnectStallFirstSeenAt?: string;
  stripeConnectStallRequirements?: string[];
  stripeConnectStallAlertedAt?: string | null;
}

export interface StripeConnectIntegrationSnapshot {
  organizationId: number;
  accountId: string;
  settings: Record<string, unknown> | null;
  /** Cached capability flag from the last Stripe observation, if known. */
  chargesEnabled?: boolean | null;
  lastValidatedAt: Date | null;
}

export interface OnboardingStallEntry {
  organizationId: number;
  organizationName: string;
  accountId: string;
  requirements: string[];
  firstSeenStuckAt: string;
  daysStuck: number;
  alertedAt: string | null;
  lastValidatedAt: string | null;
  chargesEnabled: boolean | null;
}

export interface LiveConnectStatus {
  isConnected: boolean;
  chargesEnabled: boolean;
  requirements?: { currentlyDue: string[] };
}

export interface OnboardingStallNotice {
  orgId: number;
  accountId: string;
  daysStuck: number;
  requirements: string[];
}

export interface ConnectOnboardingStallDeps {
  /** Every stripe_connect integration row that holds an account id. */
  listStripeConnectIntegrations: () => Promise<StripeConnectIntegrationSnapshot[]>;
  /** Live Stripe read for one connected account; null when Stripe cannot be read. */
  getAccountStatus: (accountId: string) => Promise<LiveConnectStatus | null>;
  /** Persist the stall keys for one integration (merge over its settings; nothing else moves). */
  saveStallObservation: (
    integration: StripeConnectIntegrationSnapshot,
    patch: OnboardingStallSettings,
  ) => Promise<void>;
  createSystemAlert: (alert: {
    organizationId: number | null;
    type: string;
    severity: "critical" | "warning" | "info";
    title: string;
    message: string;
    relatedEntityType: string;
    relatedEntityId: number | null;
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  notifyLender: (notice: OnboardingStallNotice) => Promise<void>;
  getOrganizationName: (organizationId: number) => Promise<string | null>;
  now: () => Date;
}

// ─── Pure observation logic (no I/O) ────────────────────────────────────────

/**
 * Whole days between a first-seen timestamp and now, clamped at 0 —
 * a clock-skewed future timestamp reads as "just seen", never negative.
 */
function daysStuck(firstSeenStuckAt: string, now: Date): number {
  const firstSeenMs = new Date(firstSeenStuckAt).getTime();
  if (Number.isNaN(firstSeenMs)) return 0;
  return Math.max(0, Math.floor((now.getTime() - firstSeenMs) / DAY_MS));
}

function readStallSettings(settings: Record<string, unknown> | null): OnboardingStallSettings {
  if (!settings) return {};
  return {
    stripeConnectStallFirstSeenAt:
      typeof settings.stripeConnectStallFirstSeenAt === "string"
        ? settings.stripeConnectStallFirstSeenAt
        : undefined,
    stripeConnectStallRequirements: Array.isArray(settings.stripeConnectStallRequirements)
      ? (settings.stripeConnectStallRequirements as string[])
      : undefined,
    stripeConnectStallAlertedAt:
      typeof settings.stripeConnectStallAlertedAt === "string"
        ? settings.stripeConnectStallAlertedAt
        : null,
  };
}

function sameRequirements(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Apply one observation to the stall keys. Returns the new stall keys
 * (to be merged over the integration's settings) plus whether anything
 * changed — or null when the observation moves nothing.
 *
 *   - Requirements outstanding, never seen stuck: seed firstSeen = now,
 *     snapshot the requirements, alertedAt null.
 *   - Requirements outstanding, already seen stuck: keep firstSeen and
 *     alertedAt; refresh the requirements snapshot when it changed.
 *   - Requirements empty: clear all three keys (resolved) — but only
 *     when any of them is set; a never-stalled row stays untouched.
 *   - Unobservable (no requirements list — Stripe unreadable): null.
 *     A failed read must neither seed a stall nor clear one.
 */
export function computeStallObservation(
  settings: Record<string, unknown> | null,
  currentlyDue: string[] | undefined,
  now: Date,
): { patch: OnboardingStallSettings; changed: boolean } | null {
  if (currentlyDue === undefined) return null;
  const current = readStallSettings(settings);

  if (currentlyDue.length === 0) {
    if (
      current.stripeConnectStallFirstSeenAt === undefined &&
      current.stripeConnectStallRequirements === undefined &&
      current.stripeConnectStallAlertedAt == null
    ) {
      return null;
    }
    return {
      patch: {
        stripeConnectStallFirstSeenAt: undefined,
        stripeConnectStallRequirements: undefined,
        stripeConnectStallAlertedAt: null,
      },
      changed: true,
    };
  }

  if (!current.stripeConnectStallFirstSeenAt) {
    return {
      patch: {
        stripeConnectStallFirstSeenAt: now.toISOString(),
        stripeConnectStallRequirements: [...currentlyDue],
        stripeConnectStallAlertedAt: null,
      },
      changed: true,
    };
  }

  if (!sameRequirements(current.stripeConnectStallRequirements, currentlyDue)) {
    return {
      patch: {
        stripeConnectStallFirstSeenAt: current.stripeConnectStallFirstSeenAt,
        stripeConnectStallRequirements: [...currentlyDue],
        stripeConnectStallAlertedAt: current.stripeConnectStallAlertedAt,
      },
      changed: true,
    };
  }

  return null;
}

// ─── Production seams ───────────────────────────────────────────────────────

async function defaultListStripeConnectIntegrations(): Promise<StripeConnectIntegrationSnapshot[]> {
  const { unscopedForPlatformOps } = await import("../utils/orgScopedDb");
  // The stall sweep is a platform job by design: it watches every org's
  // lender onboarding so a stall in any org is seen — the sanctioned
  // cross-org hatch, with the reason logged on every run. Every write
  // the sweep makes from these rows is scoped to the row's own org, and
  // the founder list endpoint reads the same rows read-only.
  const db = unscopedForPlatformOps(
    "Connect onboarding stall sweep: scan all organizations' Stripe Connect integrations for accounts stuck in currentlyDue",
  );
  const { organizationIntegrations } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");
  const rows = await db
    .select({
      organizationId: organizationIntegrations.organizationId,
      credentials: organizationIntegrations.credentials,
      settings: organizationIntegrations.settings,
      lastValidatedAt: organizationIntegrations.lastValidatedAt,
    })
    .from(organizationIntegrations)
    .where(eq(organizationIntegrations.provider, "stripe_connect"));
  const out: StripeConnectIntegrationSnapshot[] = [];
  for (const row of rows) {
    const credentials = row.credentials as Record<string, unknown> | null;
    const accountId = typeof credentials?.stripeConnectAccountId === "string" ? credentials.stripeConnectAccountId : null;
    if (!accountId) continue;
    const settings = row.settings as Record<string, unknown> | null;
    const chargesEnabled =
      (settings as { stripeConnectChargesEnabled?: unknown } | null)?.stripeConnectChargesEnabled;
    out.push({
      organizationId: row.organizationId,
      accountId,
      settings,
      chargesEnabled: typeof chargesEnabled === "boolean" ? chargesEnabled : null,
      lastValidatedAt: row.lastValidatedAt ? new Date(row.lastValidatedAt) : null,
    });
  }
  return out;
}

async function defaultGetAccountStatus(accountId: string): Promise<LiveConnectStatus | null> {
  const { stripeConnectService } = await import("./stripeConnect");
  const status = await stripeConnectService.getAccountStatus(accountId);
  // getAccountStatus swallows Stripe errors into isConnected: false with
  // no requirements — that is "unreadable", not "unstuck". The caller
  // must not seed or clear a stall on it.
  if (!status.isConnected || !status.requirements) return null;
  return {
    isConnected: status.isConnected,
    chargesEnabled: status.chargesEnabled,
    requirements: { currentlyDue: status.requirements.currentlyDue },
  };
}

async function defaultSaveStallObservation(
  integration: StripeConnectIntegrationSnapshot,
  patch: OnboardingStallSettings,
): Promise<void> {
  const { storage } = await import("../storage");
  type IntegrationSettings = InsertOrganizationIntegration["settings"];
  // Merge over the row's own settings and write settings only — the
  // partial upsert leaves credentials, flags and validation columns
  // exactly as they were. Undefined values drop out of the merge, which
  // is how a resolved stall's keys are removed.
  const merged: Record<string, unknown> = { ...(integration.settings ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  await storage.upsertOrganizationIntegration({
    organizationId: integration.organizationId,
    provider: "stripe_connect",
    settings: merged as IntegrationSettings,
  });
}

async function defaultCreateSystemAlert(alert: Parameters<ConnectOnboardingStallDeps["createSystemAlert"]>[0]): Promise<void> {
  const { storage } = await import("../storage");
  await storage.createSystemAlert({
    organizationId: alert.organizationId as number,
    type: alert.type,
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    relatedEntityType: alert.relatedEntityType,
    relatedEntityId: alert.relatedEntityId ?? undefined,
    metadata: alert.metadata,
  });
}

async function defaultGetOrganizationName(organizationId: number): Promise<string | null> {
  const { storage } = await import("../storage");
  const org = await storage.getOrganization(organizationId);
  return org?.name ?? null;
}

const defaultConnectOnboardingStallDeps: ConnectOnboardingStallDeps = {
  listStripeConnectIntegrations: defaultListStripeConnectIntegrations,
  getAccountStatus: defaultGetAccountStatus,
  saveStallObservation: defaultSaveStallObservation,
  createSystemAlert: defaultCreateSystemAlert,
  notifyLender: async (notice) => {
    await notifyLenderOfOnboardingStall(notice);
  },
  getOrganizationName: defaultGetOrganizationName,
  now: () => clock.now(),
};

// ─── Lender notice (witnessed rails, mirroring borrowerMessageNotify) ──────

const STALL_NOTICE_TITLE = "Finish your Stripe onboarding";
const STALL_NOTICE_URL = "/settings#billing";

/**
 * Tell the lender, through the witnessed rails: push (family
 * `onboarding_stall`, preference-gated) + one in-app row per active team
 * member whose preferences allow it. BEST EFFORT — every leg is guarded;
 * a notification failure never fails the sweep that carries the alert.
 * No borrower PII, no money amounts: the payload names the outstanding
 * requirement count and the place to finish onboarding. No email, no
 * SMS — a lender-facing reminder sent that way is a customer send and
 * goes through the outward-action rail, not this job.
 */
async function notifyLenderOfOnboardingStall(notice: OnboardingStallNotice): Promise<{ pushed: boolean; inApp: number }> {
  const result = { pushed: false, inApp: 0 };
  if (!Number.isInteger(notice.orgId) || notice.orgId <= 0) return result;
  const body =
    `Your Stripe account still needs ${notice.requirements.length} item${notice.requirements.length === 1 ? "" : "s"} ` +
    `before you can take payments — it has been waiting ${notice.daysStuck} days. Finish onboarding in Settings → Billing.`;

  try {
    const { pushOrgEvent } = await import("./orgPushFanout");
    result.pushed = await pushOrgEvent(notice.orgId, {
      family: "onboarding_stall",
      title: STALL_NOTICE_TITLE,
      body,
      url: STALL_NOTICE_URL,
      tag: `onboarding-stall-${notice.accountId}`,
    });
  } catch (err) {
    logger.warn("[ConnectOnboardingStall] lender push leg failed (alert unaffected)", {
      metadata: { orgId: notice.orgId, accountId: notice.accountId, error: err instanceof Error ? err.message : String(err) },
    });
  }

  try {
    const { storage } = await import("../storage");
    const { notificationPrefsService } = await import("./notificationPreferences");
    const members = await storage.getTeamMembers(notice.orgId);
    for (const member of members) {
      if (!member.isActive || !member.userId) continue;
      try {
        const allowed = await notificationPrefsService.shouldNotify(member.userId, notice.orgId, ONBOARDING_STALL_EVENT_ID, "inApp");
        if (!allowed) continue;
        await storage.createNotification({
          organizationId: notice.orgId,
          userId: member.userId,
          type: ONBOARDING_STALL_EVENT_ID,
          title: STALL_NOTICE_TITLE,
          message: `${body} Outstanding: ${notice.requirements.join(", ")}.`,
          entityType: "organization",
          entityId: notice.orgId,
          metadata: {
            source: "onboarding_stall",
            accountId: notice.accountId,
            daysStuck: notice.daysStuck,
            requirements: notice.requirements,
            actionUrl: STALL_NOTICE_URL,
          },
        });
        result.inApp++;
      } catch (err) {
        logger.error("[ConnectOnboardingStall] in-app row failed for a member (alert unaffected)", err instanceof Error ? err : undefined);
      }
    }
  } catch (err) {
    logger.error("[ConnectOnboardingStall] in-app leg failed (alert unaffected)", err instanceof Error ? err : undefined);
  }

  return result;
}

// ─── The founder-visible aging list (database only — no Stripe call) ────────

/**
 * Every account currently observed stuck, oldest first. The clock is the
 * first-seen timestamp the observations wrote; rows whose requirements
 * emptied carry no stall keys and never appear here.
 */
export async function listOnboardingStalls(
  deps: ConnectOnboardingStallDeps = defaultConnectOnboardingStallDeps,
): Promise<OnboardingStallEntry[]> {
  const now = deps.now();
  const rows = await deps.listStripeConnectIntegrations();
  const out: OnboardingStallEntry[] = [];
  for (const row of rows) {
    const stall = readStallSettings(row.settings);
    if (!stall.stripeConnectStallFirstSeenAt) continue;
    const requirements = stall.stripeConnectStallRequirements ?? [];
    if (requirements.length === 0) continue;
    const organizationName =
      (await deps.getOrganizationName(row.organizationId)) ?? `Organization ${row.organizationId}`;
    out.push({
      organizationId: row.organizationId,
      organizationName,
      accountId: row.accountId,
      requirements,
      firstSeenStuckAt: stall.stripeConnectStallFirstSeenAt,
      daysStuck: daysStuck(stall.stripeConnectStallFirstSeenAt, now),
      alertedAt: stall.stripeConnectStallAlertedAt ?? null,
      lastValidatedAt: row.lastValidatedAt ? row.lastValidatedAt.toISOString() : null,
      chargesEnabled: row.chargesEnabled ?? null,
    });
  }
  out.sort((a, b) => b.daysStuck - a.daysStuck || a.organizationId - b.organizationId);
  return out;
}

// ─── The daily aging sweep ──────────────────────────────────────────────────

export interface OnboardingStallSweepResult {
  scanned: number;
  stalled: number;
  newlySeeded: number;
  resolved: number;
  alerted: number;
}

/**
 * One daily pass: live-read every connected account, advance each stall
 * clock, and fire the 7-day founder alert + lender notice once per stall
 * episode. Per-row failures are isolated and logged — one bad account
 * never suppresses the alerts owed for the others. A row whose live read
 * fails is left exactly as it was: an unreadable account is neither
 * seeded nor cleared nor alerted on.
 */
export async function runOnboardingStallSweep(
  deps: ConnectOnboardingStallDeps = defaultConnectOnboardingStallDeps,
): Promise<OnboardingStallSweepResult> {
  const now = deps.now();
  const rows = await deps.listStripeConnectIntegrations();
  const result: OnboardingStallSweepResult = {
    scanned: rows.length,
    stalled: 0,
    newlySeeded: 0,
    resolved: 0,
    alerted: 0,
  };

  for (const row of rows) {
    try {
      const status = await deps.getAccountStatus(row.accountId);
      if (!status) {
        logger.warn("[ConnectOnboardingStall] live read failed — leaving stall state untouched", {
          metadata: { organizationId: row.organizationId, accountId: row.accountId },
        });
        continue;
      }
      const currentlyDue = status.requirements?.currentlyDue ?? [];
      const wasStalled = readStallSettings(row.settings).stripeConnectStallFirstSeenAt != null;
      const observation = computeStallObservation(row.settings, currentlyDue, now);
      let settings = row.settings;
      if (observation?.changed) {
        await deps.saveStallObservation(row, observation.patch);
        // The in-memory snapshot follows the write so the alert decision
        // below reads the state just persisted, not the stale row.
        settings = { ...(row.settings ?? {}) };
        for (const [key, value] of Object.entries(observation.patch)) {
          if (value === undefined) delete settings[key];
          else settings[key] = value;
        }
        if (currentlyDue.length === 0 && wasStalled) result.resolved++;
        if (currentlyDue.length > 0 && !wasStalled) result.newlySeeded++;
      }

      if (currentlyDue.length === 0) continue;
      result.stalled++;
      const stall = readStallSettings(settings);
      if (!stall.stripeConnectStallFirstSeenAt) continue;
      const stuckDays = daysStuck(stall.stripeConnectStallFirstSeenAt, now);
      if (stuckDays < ONBOARDING_STALL_ALERT_AFTER_DAYS) continue;
      if (stall.stripeConnectStallAlertedAt) continue;

      const organizationName =
        (await deps.getOrganizationName(row.organizationId)) ?? `Organization ${row.organizationId}`;
      await deps.createSystemAlert({
        organizationId: row.organizationId,
        type: ONBOARDING_STALL_ALERT_TYPE,
        severity: "warning",
        title: `Stripe onboarding stalled ${stuckDays} days — ${organizationName}`,
        message:
          `The lender's Stripe Connect account ${row.accountId} has been stuck in onboarding for ${stuckDays} days ` +
          `(${currentlyDue.length} requirement${currentlyDue.length === 1 ? "" : "s"} outstanding: ${currentlyDue.join(", ")}). ` +
          `Until onboarding completes the lender cannot take payments — the same stall that blocked P3-4's settlement leg. ` +
          `The lender has been reminded in-app. No account changes were made; onboarding completes only in Stripe's hosted flow.`,
        relatedEntityType: "organization",
        relatedEntityId: row.organizationId,
        metadata: {
          accountId: row.accountId,
          organizationId: row.organizationId,
          daysStuck: stuckDays,
          requirements: currentlyDue,
          firstSeenStuckAt: stall.stripeConnectStallFirstSeenAt,
        },
      });
      await deps.notifyLender({
        orgId: row.organizationId,
        accountId: row.accountId,
        daysStuck: stuckDays,
        requirements: currentlyDue,
      });
      // Stamp AFTER the alert + notice go out, so a failed fan-out
      // retries on the next run and a fired alert never repeats.
      await deps.saveStallObservation(row, {
        ...readStallSettings(settings),
        stripeConnectStallAlertedAt: now.toISOString(),
      });
      result.alerted++;
    } catch (err) {
      logger.error(
        `[ConnectOnboardingStall] sweep failed for account ${row.accountId} (org ${row.organizationId}) — will retry next run`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  return result;
}
