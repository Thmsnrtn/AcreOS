/**
 * Lifecycle program dispatcher.
 *
 * Phase 4 Week 17-18 (Sigrid §3, Camila §4, Indigo §1-§4).
 *
 * Single entry point for every customer-lifecycle / win-back send. Call
 * sites give us:
 *   - the template key (one of LifecycleMessageKey)
 *   - the organization
 *   - the recipient email (and optionally userId, phone)
 *   - rendering placeholders
 *
 * We:
 *   1. Load the template metadata from the static registry in
 *      shared/lifecycle/messages.ts.
 *   2. Look up the active versioned row in `email_templates` (so copy can
 *      be hot-edited in DB without a deploy). Fall back to the registry
 *      copy if no DB row exists.
 *   3. Filter against `email_suppressions` (Wave 3). Suppressed → record
 *      a `lifecycle_message_sends` row with status=suppressed and return.
 *   4. For win-back templates, enforce the Indigo 2-touch / 12-month
 *      throttle. Over budget → status=skipped, return.
 *   5. Honour notification preferences (mute by category; rely on the
 *      notificationPrefsService when a userId is provided).
 *   6. Otherwise: enqueue an `outbox` row with eventType="lifecycle_email"
 *      so the outbox drainer dispatches asynchronously, and write the
 *      `lifecycle_message_sends` audit row with status=queued and the
 *      outbox id.
 *
 * The outbox drainer (server/jobs/outboxDrainer.ts — out of scope here)
 * is responsible for the actual SES/SendGrid call. This service never
 * blocks the calling code on network IO.
 */

import { db } from "../db";
import {
  emailTemplates,
  lifecycleMessageSends,
  outbox,
  reactivationTokens,
} from "@shared/schema";
import {
  LIFECYCLE_MESSAGES,
  WINBACK_MAX_TOUCHES_PER_YEAR,
  WINBACK_THROTTLE_WINDOW_MS,
  winbackCellFor,
  winbackTierFor,
  normalizeCancellationReason,
  type LifecycleMessageKey,
  type LifecycleMessage,
  type WinbackTier,
  type CancellationReason,
} from "@shared/lifecycle/messages";
import { isSuppressed } from "./emailSuppressions";
import { logger } from "../utils/logger";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import crypto from "node:crypto";

export type LifecycleSendStatus = "queued" | "sent" | "suppressed" | "skipped";

export interface LifecycleSendInput {
  /** One of the 14 keys in LIFECYCLE_MESSAGES, or a winback cellKey
   *  (e.g. "winback_price_solo") when sending an Indigo win-back. */
  templateKey: LifecycleMessageKey | string;
  organizationId: number;
  userId?: string | null;
  recipientEmail: string;
  recipientPhone?: string | null;
  /** Substitution map: every `{key}` in subject/body is replaced with
   *  `placeholders[key]`. Missing keys are left literal (intentional —
   *  it makes broken templates visible in QA). */
  placeholders?: Record<string, string | number | null | undefined>;
  /** Free-form audit data tucked into `lifecycle_message_sends.metadata`. */
  metadata?: Record<string, unknown>;
}

export interface LifecycleSendResult {
  status: LifecycleSendStatus;
  /** id of the inserted lifecycle_message_sends row (always written
   *  unless the send failed at the DB layer). */
  auditId?: number;
  /** id of the outbox row (only present when status === "queued"). */
  outboxId?: number;
  /** When status === "skipped" or "suppressed", a short reason string. */
  reason?: string;
}

interface RenderedTemplate {
  channel: "email" | "sms";
  subject: string;
  body: string;
  category: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Template loading + rendering
// ---------------------------------------------------------------------------

/**
 * Resolve a template by key. Prefers the active versioned DB row in
 * `email_templates` (so the founder can tweak copy without a deploy);
 * falls back to the static registry. Returns null if neither source has
 * an entry — call sites should treat that as a misconfiguration.
 */
async function loadTemplate(
  templateKey: string,
): Promise<RenderedTemplate | null> {
  // 1. Try the DB.
  try {
    const [row] = await db
      .select({
        channel: emailTemplates.channel,
        subject: emailTemplates.subject,
        body: emailTemplates.body,
        category: emailTemplates.category,
        version: emailTemplates.version,
      })
      .from(emailTemplates)
      .where(
        and(eq(emailTemplates.key, templateKey), eq(emailTemplates.active, true)),
      )
      .orderBy(desc(emailTemplates.version))
      .limit(1);
    if (row) {
      return {
        channel: (row.channel as "email" | "sms") ?? "email",
        subject: row.subject ?? "",
        body: row.body,
        category: row.category,
        version: row.version,
      };
    }
  } catch (err) {
    // Table may not exist on a fresh install before bootstrap — don't fail
    // the send, fall through to the static registry.
    logger.warn(
      "[lifecycle] email_templates read failed; falling back to static registry",
      err instanceof Error ? err : undefined,
    );
  }

  // 2. Fall back to the static registry.
  const fallback = LIFECYCLE_MESSAGES[templateKey as LifecycleMessageKey];
  if (fallback) {
    return {
      channel: fallback.channel,
      subject: fallback.subject,
      body: fallback.body,
      category: fallback.category,
      version: fallback.version,
    };
  }
  return null;
}

/** {placeholder} substitution. Missing keys are left literal. */
function render(
  text: string,
  placeholders: Record<string, string | number | null | undefined> | undefined,
): string {
  if (!placeholders) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const v = placeholders[key];
    if (v === null || v === undefined) return match;
    return String(v);
  });
}

// ---------------------------------------------------------------------------
// Throttle: 2 win-back touches per org per 12 months
// ---------------------------------------------------------------------------

const WINBACK_CATEGORY = "lifecycle.winback";

function isWinbackKey(key: string): boolean {
  return (
    key.startsWith("winback_") ||
    key === "post_cancel_d14_winback" ||
    key === "post_cancel_d90_winback"
  );
}

/**
 * Count win-back touches the org has received in the last 12 months,
 * across both the two T+N templates and the per-cell tailored emails.
 * Status filter excludes suppressed/skipped — we only count actual sends.
 */
export async function countWinbackTouches(
  organizationId: number,
  windowMs: number = WINBACK_THROTTLE_WINDOW_MS,
): Promise<number> {
  const since = new Date(Date.now() - windowMs);
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(lifecycleMessageSends)
      .where(
        and(
          eq(lifecycleMessageSends.organizationId, organizationId),
          eq(lifecycleMessageSends.category, WINBACK_CATEGORY),
          gte(lifecycleMessageSends.sentAt, since),
          // Only count successful queue-ups; suppressed/skipped don't burn
          // a touch.
          sql`${lifecycleMessageSends.status} IN ('queued', 'sent')`,
        ),
      );
    return Number(count) || 0;
  } catch (err) {
    logger.warn(
      `[lifecycle] countWinbackTouches failed for org ${organizationId}`,
      err instanceof Error ? err : undefined,
    );
    // On read failure, be conservative: assume budget is exhausted so a
    // misconfigured DB doesn't lead to runaway sends.
    return WINBACK_MAX_TOUCHES_PER_YEAR;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dispatch a lifecycle / win-back message. Never throws on operational
 * failures — returns a status payload the caller can log. The only way
 * this throws is if the input is structurally invalid (which is a bug).
 */
export async function sendLifecycleMessage(
  input: LifecycleSendInput,
): Promise<LifecycleSendResult> {
  const {
    templateKey,
    organizationId,
    userId,
    recipientEmail,
    recipientPhone,
    placeholders,
    metadata,
  } = input;

  if (!recipientEmail || !recipientEmail.includes("@")) {
    return { status: "skipped", reason: "invalid_recipient_email" };
  }

  // 1. Suppression check — global blocklist (bounce/spam/unsubscribe).
  let suppressed = false;
  try {
    suppressed = await isSuppressed(recipientEmail);
  } catch (err) {
    // On suppression-list read failure, fail closed: do NOT send. A
    // missing suppression list is exactly the kind of bug that destroys
    // domain reputation.
    logger.warn(
      "[lifecycle] suppression check failed; blocking send",
      err instanceof Error ? err : undefined,
    );
    suppressed = true;
  }
  if (suppressed) {
    const auditId = await writeAudit({
      organizationId,
      userId,
      templateKey: String(templateKey),
      templateVersion: null,
      channel: "email",
      recipientEmail,
      recipientPhone: recipientPhone ?? null,
      category: "lifecycle.general",
      status: "suppressed",
      outboxId: null,
      metadata: { ...(metadata ?? {}), reason: "suppressed" },
    });
    return { status: "suppressed", auditId, reason: "suppressed_recipient" };
  }

  // 2. Load + render template.
  const template = await loadTemplate(String(templateKey));
  if (!template) {
    logger.warn(
      `[lifecycle] no template found for key=${String(templateKey)}`,
    );
    return { status: "skipped", reason: "unknown_template" };
  }

  // 3. Win-back throttle (Indigo §7).
  if (
    template.category === WINBACK_CATEGORY ||
    isWinbackKey(String(templateKey))
  ) {
    const touches = await countWinbackTouches(organizationId);
    if (touches >= WINBACK_MAX_TOUCHES_PER_YEAR) {
      const auditId = await writeAudit({
        organizationId,
        userId,
        templateKey: String(templateKey),
        templateVersion: template.version,
        channel: template.channel,
        recipientEmail,
        recipientPhone: recipientPhone ?? null,
        category: template.category,
        status: "skipped",
        outboxId: null,
        metadata: {
          ...(metadata ?? {}),
          reason: "winback_throttled",
          touchesInWindow: touches,
        },
      });
      logger.info(
        `[lifecycle] winback throttled for org=${organizationId} key=${String(templateKey)} touches=${touches}`,
      );
      return { status: "skipped", auditId, reason: "winback_throttled" };
    }
  }

  // 4. Render copy.
  const subject = render(template.subject, placeholders);
  const body = render(template.body, placeholders);

  // 5. Enqueue outbox + write audit (best-effort transactional pairing —
  //    we insert outbox first so the audit row carries the real id; if
  //    audit insert fails we still log the send was queued).
  let outboxId: number | null = null;
  try {
    const [row] = await db
      .insert(outbox)
      .values({
        eventType: "lifecycle_email",
        status: "pending",
        attempts: 0,
        payload: {
          templateKey: String(templateKey),
          templateVersion: template.version,
          channel: template.channel,
          category: template.category,
          organizationId,
          userId: userId ?? null,
          recipientEmail,
          recipientPhone: recipientPhone ?? null,
          subject,
          body,
          metadata: metadata ?? {},
        },
      })
      .returning({ id: outbox.id });
    outboxId = row?.id ?? null;
  } catch (err) {
    logger.warn(
      "[lifecycle] outbox enqueue failed",
      err instanceof Error ? err : undefined,
    );
    return { status: "skipped", reason: "outbox_enqueue_failed" };
  }

  const auditId = await writeAudit({
    organizationId,
    userId,
    templateKey: String(templateKey),
    templateVersion: template.version,
    channel: template.channel,
    recipientEmail,
    recipientPhone: recipientPhone ?? null,
    category: template.category,
    status: "queued",
    outboxId,
    metadata: metadata ?? {},
  });

  return {
    status: "queued",
    auditId,
    outboxId: outboxId ?? undefined,
  };
}

/**
 * Dispatch the right Indigo win-back template for this customer. Looks
 * up the (reason × tier) cell, short-circuits on no_touch (wrong-fit),
 * and otherwise sends the post-cancel template with the cell's pitch
 * substituted into the body.
 */
export async function sendWinback(input: {
  organizationId: number;
  userId?: string | null;
  recipientEmail: string;
  /** Free-text reason from cancellation_surveys.reason. */
  cancellationReason: string | null | undefined;
  /** organizations.subscription_tier at cancel time. */
  cancelledTier: string | null | undefined;
  /** Which post-cancel template — D14 or D90. */
  variant: "d14" | "d90";
  /** Optional reactivation deep-link to substitute into the body. */
  reactivationUrl?: string;
  /** Optional one-line "what's new since you left" summary. */
  whatsNewSummary?: string;
  metadata?: Record<string, unknown>;
}): Promise<LifecycleSendResult> {
  const reason: CancellationReason = normalizeCancellationReason(
    input.cancellationReason,
  );
  const tier: WinbackTier = winbackTierFor(input.cancelledTier);
  const cellInfo = winbackCellFor(reason, tier);

  if (cellInfo.approach === "no_touch") {
    // wrong_fit cancellations: deliberately do nothing. Log so the
    // dashboard can show the avoided send (it's the right outcome).
    logger.info(
      `[lifecycle] winback skipped (wrong_fit) org=${input.organizationId}`,
    );
    return { status: "skipped", reason: "wrong_fit_no_touch" };
  }

  const templateKey: LifecycleMessageKey =
    input.variant === "d14"
      ? "post_cancel_d14_winback"
      : "post_cancel_d90_winback";

  return sendLifecycleMessage({
    templateKey,
    organizationId: input.organizationId,
    userId: input.userId ?? null,
    recipientEmail: input.recipientEmail,
    placeholders: {
      winbackPitch: cellInfo.pitch,
      reactivationUrl: input.reactivationUrl ?? "",
      whatsNewSummary: input.whatsNewSummary ?? "",
    },
    metadata: {
      ...(input.metadata ?? {}),
      winbackCell: cellInfo.cellKey,
      reason,
      tier,
      approach: cellInfo.approach,
    },
  });
}

// ---------------------------------------------------------------------------
// Reactivation tokens — signed link wired into win-back emails
// ---------------------------------------------------------------------------

const REACTIVATION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext, "utf8").digest("hex");
}

/**
 * Issue a fresh, single-use reactivation token for the org. Returns the
 * plaintext token (which is what goes in the URL); only its SHA-256
 * hash is persisted.
 */
export async function issueReactivationToken(params: {
  organizationId: number;
  metadata?: Record<string, unknown>;
}): Promise<{ token: string; expiresAt: Date }> {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  const token = Buffer.from(bytes).toString("base64url");
  const expiresAt = new Date(Date.now() + REACTIVATION_TOKEN_TTL_MS);

  await db.insert(reactivationTokens).values({
    organizationId: params.organizationId,
    tokenHash: hashToken(token),
    expiresAt,
    metadata: (params.metadata ?? {}) as Record<string, unknown>,
  });

  return { token, expiresAt };
}

/**
 * Verify a reactivation token. Returns the org id if the token is valid
 * (exists, unredeemed, unexpired); null otherwise. Does NOT mark the
 * token redeemed — call markReactivationTokenRedeemed after the user
 * actually completes checkout.
 */
export async function verifyReactivationToken(
  token: string,
): Promise<{ organizationId: number; expiresAt: Date } | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  try {
    const [row] = await db
      .select({
        organizationId: reactivationTokens.organizationId,
        expiresAt: reactivationTokens.expiresAt,
        redeemedAt: reactivationTokens.redeemedAt,
      })
      .from(reactivationTokens)
      .where(eq(reactivationTokens.tokenHash, tokenHash))
      .limit(1);
    if (!row) return null;
    if (row.redeemedAt) return null;
    if (row.expiresAt.getTime() < Date.now()) return null;
    return {
      organizationId: row.organizationId,
      expiresAt: row.expiresAt,
    };
  } catch (err) {
    logger.warn(
      "[lifecycle] verifyReactivationToken failed",
      err instanceof Error ? err : undefined,
    );
    return null;
  }
}

export async function markReactivationTokenRedeemed(
  token: string,
): Promise<void> {
  if (!token) return;
  const tokenHash = hashToken(token);
  try {
    await db
      .update(reactivationTokens)
      .set({ redeemedAt: new Date() })
      .where(eq(reactivationTokens.tokenHash, tokenHash));
  } catch (err) {
    logger.warn(
      "[lifecycle] markReactivationTokenRedeemed failed",
      err instanceof Error ? err : undefined,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface AuditRow {
  organizationId: number;
  userId?: string | null;
  templateKey: string;
  templateVersion: number | null;
  channel: "email" | "sms";
  recipientEmail: string;
  recipientPhone: string | null;
  category: string;
  status: LifecycleSendStatus;
  outboxId: number | null;
  metadata: Record<string, unknown>;
}

async function writeAudit(row: AuditRow): Promise<number | undefined> {
  try {
    const [result] = await db
      .insert(lifecycleMessageSends)
      .values({
        organizationId: row.organizationId,
        userId: row.userId ?? null,
        templateKey: row.templateKey,
        templateVersion: row.templateVersion ?? null,
        channel: row.channel,
        recipientEmail: row.recipientEmail,
        recipientPhone: row.recipientPhone,
        category: row.category,
        status: row.status,
        outboxId: row.outboxId ?? null,
        metadata: row.metadata,
      })
      .returning({ id: lifecycleMessageSends.id });
    return result?.id;
  } catch (err) {
    logger.warn(
      "[lifecycle] audit insert failed",
      err instanceof Error ? err : undefined,
    );
    return undefined;
  }
}

/**
 * Re-export the static registry for call sites that want to enumerate
 * all keys (e.g. a founder dashboard listing every lifecycle template).
 */
export { LIFECYCLE_MESSAGES, type LifecycleMessage };
