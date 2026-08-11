/**
 * R-2 — the ONE door for physical mail credentials + purpose lanes.
 *
 * FOUNDER RULING 2026-08-11 (send lane): every mail-sending path resolves its
 * credential HERE, and nowhere else. Before this file the repo had FOUR Lob
 * clients with four different credential stories:
 *
 *   1. mailProvider.getOrgMailCredentials  — org integration read PLAINTEXT
 *      (no decryptJsonCredentials) then an unconditional platform fallback.
 *   2. directMailService.getLobClient      — BYOK vault → legacy → platform.
 *   3. directMail.DirectMailService        — process.env singletons built in a
 *      constructor, org key only if the caller happened to pass an orgId.
 *   4. lobService.LobService               — process.env singletons, NO org
 *      path at all (deleted; see docs/company/deletion-ledger.md).
 *
 * The rule this file enforces (mirrors emailService's counterparty lane,
 * founder decision 2026-07-17):
 *
 *   • A send must name the org it sends for. No organizationId → refusal.
 *     A mail function that cannot name its org IS the bug.
 *   • `counterparty` mail (anything addressed to a customer's sellers,
 *     buyers, borrowers or neighbours) requires the ORG'S OWN connected Lob
 *     credential. There is deliberately NO silent platform fallback — the
 *     honest failure names the connect surface, exactly as SMS/email do.
 *   • The PLATFORM key stays reachable for exactly two things:
 *       (a) `system` purpose — mail AcreOS itself sends about the account;
 *       (b) the registered ACTIVATION WEDGE exception — a free-tier org's
 *           first FREE_TIER_LIFETIME_PIECES letters, so a new customer can
 *           feel the product before wiring a printer account.
 *     Both stay under the live-send interlock (mail/liveSendInterlock.ts):
 *     the platform key is Lob's TEST environment unless production is armed.
 *
 * The wedge counter is the SAME `mail_shipments`-derived lifetime count the
 * outreach queue route has always used (non-cancelled pieces), so this move
 * changes WHERE the cap is enforced, not WHAT it counts.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import { mailShipments, organizations } from "@shared/schema";
import { logger } from "../../utils/logger";
import { resolvePlatformLobKey } from "./liveSendInterlock";
import { resolveProviderCredential } from "../providers/resolveProviderCredential";

/**
 * Purpose lane. `system` = AcreOS writing to its own customer about their
 * account. `counterparty` = the customer writing to THEIR counterparty.
 * Everything the product mails today is counterparty; the system lane exists
 * so the distinction is expressible rather than assumed.
 */
export type MailPurpose = "system" | "counterparty";

/**
 * W2.1 activation wedge — the free tier's LIFETIME physical-mail allowance on
 * the PLATFORM key. Lives here (not in the route) because three other send
 * paths bypassed the route entirely; the cap is only honest at the door every
 * path must pass through.
 */
export const FREE_TIER_LIFETIME_PIECES = 5;

/** Where a customer connects their own Lob account. */
export const MAIL_CONNECT_URL = "/settings/byok";
/** Where a free-tier org converts once the wedge is spent. */
export const MAIL_UPGRADE_URL = "/settings#billing";

export interface MailCredential {
  apiKey: string;
  source: "organization" | "platform";
  /** True when the key is bound to Lob's TEST environment (no paper prints). */
  isTestKey: boolean;
}

export type MailLaneRefusalCode =
  | "mail_org_required"
  | "mail_byo_required"
  | "mail_free_wedge_spent"
  | "mail_free_wedge_cap"
  | "mail_not_configured";

export interface MailLaneRefusalDetails {
  reason: MailLaneRefusalCode;
  message: string;
  /** Present on every refusal a customer can act on. */
  connectUrl?: string;
  upgradeUrl?: string;
  capPieces?: number;
  remainingPieces?: number;
  requestedPieces?: number;
}

/**
 * Thrown by assertMailLane. Callers that render HTTP catch it and map
 * `details` onto Errors.limitExceeded / Errors.badRequest; callers inside a
 * worker let it propagate so the shipment is marked failed and refunded.
 */
export class MailLaneRefusal extends Error {
  readonly details: MailLaneRefusalDetails;
  /** Never retryable — a refusal is a decision, not a transient failure. */
  readonly retryable = false as const;

  constructor(details: MailLaneRefusalDetails) {
    super(details.message);
    this.name = "MailLaneRefusal";
    this.details = details;
  }

  get reason(): MailLaneRefusalCode {
    return this.details.reason;
  }
}

export function isMailLaneRefusal(err: unknown): err is MailLaneRefusal {
  return err instanceof MailLaneRefusal || (err as any)?.name === "MailLaneRefusal";
}

/**
 * The org's OWN Lob credential: canonical BYOK vault first, legacy
 * organization_integrations second (both handled by resolveProviderCredential,
 * which DECRYPTS — the plaintext read in mailProvider.getOrgMailCredentials was
 * a real bug on the autopilot send-letter path: an org whose key was stored
 * encrypted looked "not connected" and silently fell through to the platform).
 */
async function resolveOrgMailCredential(
  organizationId: number,
): Promise<MailCredential | null> {
  const secret = await resolveProviderCredential(organizationId, {
    channel: "lob",
    legacyProvider: "lob",
    legacyField: "apiKey",
  });
  if (!secret) return null;
  return {
    apiKey: secret,
    source: "organization",
    isTestKey: secret.startsWith("test_"),
  };
}

/** The platform key, under the live-send interlock. Null when unset. */
export function resolvePlatformMailCredential(): MailCredential | null {
  try {
    const { apiKey, isTestKey } = resolvePlatformLobKey();
    return { apiKey, source: "platform", isTestKey };
  } catch {
    return null;
  }
}

/** Is a platform Lob key configured at all? Used by status/pricing surfaces. */
export function isPlatformMailConfigured(): boolean {
  return resolvePlatformMailCredential() !== null;
}

/**
 * Lifetime non-cancelled pieces this org has put through the mail queue.
 *
 * `excludeShipmentId` exists for the flusher: by the time a queued shipment
 * is flushed its own pieces are already counted, so re-checking the cap
 * without excluding it would refuse a shipment the queue legitimately
 * admitted.
 */
export async function freeTierMailPiecesUsed(
  organizationId: number,
  excludeShipmentId?: number,
): Promise<number> {
  const conditions = [
    eq(mailShipments.organizationId, organizationId),
    sql`${mailShipments.status} != 'cancelled'`,
  ];
  if (excludeShipmentId != null) {
    conditions.push(ne(mailShipments.id, excludeShipmentId));
  }
  const [row] = await db
    .select({ used: sql<number>`coalesce(sum(${mailShipments.pieceCount}), 0)::int` })
    .from(mailShipments)
    .where(and(...conditions));
  return Number(row?.used ?? 0);
}

async function orgSubscriptionTier(organizationId: number): Promise<string> {
  const [row] = await db
    .select({ tier: organizations.subscriptionTier })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return (row?.tier ?? "free").toLowerCase();
}

export interface AssertMailLaneArgs {
  /** REQUIRED. A send that cannot name its org is refused. */
  organizationId?: number | null;
  purpose: MailPurpose;
  /** Pieces this send will print. Batch callers pass the whole batch. */
  pieceCount: number;
  /** Flusher only — don't count the shipment being flushed against its own cap. */
  excludeShipmentId?: number;
}

/**
 * THE DOOR. Resolves the credential a send may use, or throws MailLaneRefusal.
 *
 * There is no other way to obtain a Lob credential in this codebase: every
 * client constructs `new Lob({ apiKey })` from what this function returns.
 */
export async function assertMailLane(args: AssertMailLaneArgs): Promise<MailCredential> {
  const { purpose, excludeShipmentId } = args;
  const pieceCount = Math.max(1, Math.trunc(args.pieceCount || 1));
  const organizationId = args.organizationId ?? null;

  if (!organizationId || !Number.isFinite(organizationId) || organizationId <= 0) {
    throw new MailLaneRefusal({
      reason: "mail_org_required",
      message:
        "Physical mail requires an organizationId — every letter is sent on behalf of a specific customer org.",
    });
  }

  // 1. The org's own printer account always wins, for every purpose. The
  //    customer pays their own Lob bill; nothing here is our spend.
  const orgCredential = await resolveOrgMailCredential(organizationId);
  if (orgCredential) return orgCredential;

  // 2. No org credential. The platform key is now the only candidate — and
  //    it is fenced.
  const platform = resolvePlatformMailCredential();
  if (!platform) {
    throw new MailLaneRefusal({
      reason: "mail_not_configured",
      message:
        "No mail provider is configured for this organization. Connect your Lob account to send physical mail.",
      connectUrl: MAIL_CONNECT_URL,
    });
  }

  // 2a. System mail — AcreOS writing to its own customer — is the platform
  //     sender's job by design (founder decision 2026-07-17).
  if (purpose === "system") return platform;

  // 2b. Counterparty mail on the platform key: allowed ONLY inside the
  //     registered activation-wedge exception.
  const tier = await orgSubscriptionTier(organizationId);
  if (tier !== "free") {
    throw new MailLaneRefusal({
      reason: "mail_byo_required",
      message:
        "Mail to your sellers and buyers goes out on YOUR printer account, not AcreOS's. " +
        "Connect your Lob account in Settings → Connections to send physical mail.",
      connectUrl: MAIL_CONNECT_URL,
    });
  }

  const used = await freeTierMailPiecesUsed(organizationId, excludeShipmentId);
  const remainingPieces = Math.max(0, FREE_TIER_LIFETIME_PIECES - used);

  if (remainingPieces === 0) {
    throw new MailLaneRefusal({
      reason: "mail_free_wedge_spent",
      message:
        `Your ${FREE_TIER_LIFETIME_PIECES} free letters are in the mail. ` +
        "Connect your own Lob account to keep mailing, or upgrade for a monthly outreach pool.",
      connectUrl: MAIL_CONNECT_URL,
      upgradeUrl: MAIL_UPGRADE_URL,
      capPieces: FREE_TIER_LIFETIME_PIECES,
      remainingPieces: 0,
    });
  }

  if (pieceCount > remainingPieces) {
    throw new MailLaneRefusal({
      reason: "mail_free_wedge_cap",
      message:
        `The free plan includes ${FREE_TIER_LIFETIME_PIECES} letters total and you have ` +
        `${remainingPieces} left — narrow the send to ${remainingPieces} ` +
        `recipient${remainingPieces === 1 ? "" : "s"}, connect your own Lob account, or upgrade.`,
      connectUrl: MAIL_CONNECT_URL,
      upgradeUrl: MAIL_UPGRADE_URL,
      capPieces: FREE_TIER_LIFETIME_PIECES,
      remainingPieces,
      requestedPieces: pieceCount,
    });
  }

  logger.info("[mailLanes] counterparty send on the platform key under the activation wedge", {
    metadata: { organizationId, pieceCount, used, remainingPieces },
  });
  return platform;
}

export interface MailLaneStatus {
  /** Does the org have its own Lob credential connected? */
  connected: boolean;
  /** Which credential a counterparty send would use right now, if any. */
  source: "organization" | "platform" | null;
  /** Would a 1-piece counterparty send be allowed right now? */
  canSendCounterparty: boolean;
  /** Honest test/live posture of the credential that would be used. */
  isTestMode: boolean | null;
  /** Free-tier wedge pieces left; null when the wedge does not apply. */
  wedgeRemaining: number | null;
  refusal: MailLaneRefusalDetails | null;
  connectUrl: string;
}

/**
 * Org-scoped, honest status for the direct-mail settings surfaces. Replaces
 * the old process-wide `directMailService.isAvailable()/hasLiveMode()` reads,
 * which answered "does the PLATFORM have a key" for a question that is always
 * about a specific org.
 */
export async function mailLaneStatus(organizationId: number): Promise<MailLaneStatus> {
  try {
    const credential = await assertMailLane({ organizationId, purpose: "counterparty", pieceCount: 1 });
    const wedgeRemaining =
      credential.source === "platform"
        ? Math.max(0, FREE_TIER_LIFETIME_PIECES - (await freeTierMailPiecesUsed(organizationId)))
        : null;
    return {
      connected: credential.source === "organization",
      source: credential.source,
      canSendCounterparty: true,
      isTestMode: credential.isTestKey,
      wedgeRemaining,
      refusal: null,
      connectUrl: MAIL_CONNECT_URL,
    };
  } catch (err) {
    if (!isMailLaneRefusal(err)) throw err;
    return {
      connected: false,
      source: null,
      canSendCounterparty: false,
      isTestMode: null,
      wedgeRemaining: err.details.remainingPieces ?? null,
      refusal: err.details,
      connectUrl: MAIL_CONNECT_URL,
    };
  }
}
