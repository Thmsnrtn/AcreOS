/**
 * emailRegistry.ts — Tahoe E10
 *
 * The single typed entrypoint for ALL outbound transactional + lifecycle
 * email. Every send is:
 *   - NAMED        — addressed by a typed `kind` (welcome, trial_ending, …)
 *   - TEMPLATED    — each kind owns a render(props) → { subject, html }
 *   - TYPED        — props are statically checked per kind (EmailKindProps)
 *   - CATEGORIZED  — "transactional" (always sends; password reset, alerts)
 *                    vs "lifecycle" (marketing-shaped; suppression-checked,
 *                    carries List-Unsubscribe + CAN-SPAM footer)
 *   - SUPPRESSION-AWARE — lifecycle sends consult emailSuppressions and abort
 *                    when the recipient has opted out / bounced / complained.
 *                    (Transactional sends still pass through the transport-
 *                    level filterSuppressed for hard bounces, but a marketing
 *                    opt-out never blocks a password reset.)
 *   - RATE-LIMITED — delegates to emailService.sendEmail, which enforces the
 *                    per-org warmup ramp (reserveSend).
 *   - LOGGED       — one row in outbound_email_log per attempt, regardless of
 *                    outcome (sent | failed | suppressed | skipped).
 *
 * Voice: customer-facing copy follows docs/internal/marketing-os/02-voice-linter.md
 * — "Land Investors" (never "real estate professional/investor"), no competitor
 * references, honest unsubscribe on lifecycle/marketing sends (CAN-SPAM).
 *
 * MOUNT: existing lifecycle/transactional senders call sendRegisteredEmail()
 * instead of the raw emailService.sendEmail / sendTransactionalEmail. See
 * churnEngine.ts, founderBriefing.ts, routes-inbound-email.ts.
 */

import { db } from "../db";
import { outboundEmailLog } from "@shared/schema";
import { emailService, type EmailResult } from "./emailService";
import { isSuppressed } from "./emailSuppressions";
import { logger } from "../utils/logger";

export type EmailCategory = "transactional" | "lifecycle";

const APP_URL = process.env.APP_URL ?? "https://app.acreos.io";

// ---------------------------------------------------------------------------
// Shared chrome — keeps every template visually consistent and on-voice.
// ---------------------------------------------------------------------------
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(opts: {
  heading: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  ctaColor?: string;
}): string {
  const color = opts.ctaColor ?? "#16a34a";
  const cta =
    opts.ctaText && opts.ctaUrl
      ? `<div style="margin:28px 0;">
           <a href="${opts.ctaUrl}" style="background:${color};color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;display:inline-block;">${escapeHtml(opts.ctaText)}</a>
         </div>`
      : "";
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1a1a1a;max-width:580px;margin:0 auto;padding:20px;background:#fff;">
  <div style="padding:20px 0 16px;border-bottom:1px solid #e5e7eb;">
    <span style="display:inline-block;width:24px;height:24px;background:linear-gradient(135deg,#16a34a,#0ea5e9);border-radius:5px;vertical-align:middle;"></span>
    <span style="font-weight:700;font-size:16px;vertical-align:middle;margin-left:6px;">AcreOS</span>
  </div>
  <div style="padding:28px 0;">
    <h2 style="font-size:22px;font-weight:700;margin:0 0 16px;">${escapeHtml(opts.heading)}</h2>
    ${opts.bodyHtml}
    ${cta}
  </div>
</body>
</html>`;
}

function paragraphs(body: string): string {
  return body
    .split("\n\n")
    .map((p) => `<p style="margin:0 0 16px;line-height:1.7;color:#374151;">${escapeHtml(p)}</p>`)
    .join("");
}

// ---------------------------------------------------------------------------
// Kind catalogue — props types + render + category.
//
// To add a kind: add a member to EmailKindProps and a matching entry to
// EMAIL_KINDS. The send() entrypoint is statically typed against this map.
// ---------------------------------------------------------------------------

export interface EmailKindProps {
  welcome: { firstName?: string; dashboardUrl?: string };
  trial_ending: { firstName?: string; daysLeft: number; upgradeUrl?: string };
  payment_failed: { firstName?: string; updatePaymentUrl?: string; amountDueCents?: number };
  churn_rescue: {
    headline: string;
    body: string;
    subject: string;
    ctaText?: string;
    ctaUrl?: string;
  };
  milestone_nudge: {
    milestoneLabel: string;
    subject: string;
    referralUrl?: string;
  };
  nps_prompt: { firstName?: string; surveyUrl?: string };
  kb_reply: { subject: string; question: string; answer: string; articleUrl?: string };
  founder_briefing: {
    subject?: string;
    briefingParagraphs: string[];
    stats?: Record<string, string | number>;
  };
  password_reset: { name?: string; resetUrl: string; expiresIn?: string };
  // Quinn + Rafe — close-the-loop notification when an appeal of a Pax
  // refusal is resolved. Transactional (a direct response to the customer's
  // action), so it always sends. Honest by construction: "upheld" says the
  // decision stands, "reversed" says we got it wrong.
  appeal_outcome: {
    firstName?: string;
    decision: "upheld" | "reversed";
    outcomeMessage: string;
  };
}

export type EmailKind = keyof EmailKindProps;

interface EmailKindDef<K extends EmailKind> {
  category: EmailCategory;
  /** Render the message body + subject for a typed props payload. */
  render: (props: EmailKindProps[K]) => { subject: string; html: string };
}

type EmailKindRegistry = { [K in EmailKind]: EmailKindDef<K> };

export const EMAIL_KINDS: EmailKindRegistry = {
  // ---- transactional ------------------------------------------------------
  password_reset: {
    category: "transactional",
    render: (p) => ({
      subject: "Reset your AcreOS password",
      html: shell({
        heading: "Reset your password",
        bodyHtml: paragraphs(
          `Hi ${p.name ?? "there"},\n\nWe received a request to reset your password. Use the button below to set a new one. This link expires in ${p.expiresIn ?? "1 hour"}.\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`,
        ),
        ctaText: "Reset password",
        ctaUrl: p.resetUrl,
        ctaColor: "#0ea5e9",
      }),
    }),
  },

  appeal_outcome: {
    category: "transactional",
    render: (p) => {
      const reversed = p.decision === "reversed";
      const heading = reversed
        ? "We reviewed your appeal — you were right"
        : "We reviewed your appeal";
      return {
        subject: reversed
          ? "Your appeal was upheld — we reversed Pax's decision"
          : "An update on your appeal",
        html: shell({
          heading,
          bodyHtml: paragraphs(
            `Hi ${p.firstName ?? "there"},\n\nYou appealed a decision Pax made, and a person reviewed it. Here's where it landed:\n\n${p.outcomeMessage}`,
          ),
          ctaText: "Open Pax",
          ctaUrl: `${APP_URL}/pax`,
          ctaColor: reversed ? "#16a34a" : "#0ea5e9",
        }),
      };
    },
  },

  kb_reply: {
    category: "transactional",
    render: (p) => ({
      subject: p.subject,
      html: shell({
        heading: "Here's the answer",
        bodyHtml:
          paragraphs(`You asked: ${p.question}`) +
          paragraphs(p.answer),
        ctaText: p.articleUrl ? "Read the full article" : undefined,
        ctaUrl: p.articleUrl,
        ctaColor: "#0ea5e9",
      }),
    }),
  },

  // founder-internal operational mail; not customer marketing, but carries a
  // CTA so we route it as lifecycle to keep the unsubscribe footer honest.
  founder_briefing: {
    category: "lifecycle",
    render: (p) => {
      const date = new Date().toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const statsHtml = p.stats
        ? `<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:20px 0;padding:16px;background:#f9fafb;border-radius:8px;">
             ${Object.entries(p.stats)
               .map(
                 ([k, v]) =>
                   `<div style="text-align:center;"><div style="font-size:22px;font-weight:700;color:#18181b;">${escapeHtml(String(v))}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;">${escapeHtml(k)}</div></div>`,
               )
               .join("")}
           </div>`
        : "";
      return {
        subject:
          p.subject ??
          `AcreOS Daily Briefing — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        html: shell({
          heading: `Daily Briefing · ${date}`,
          bodyHtml:
            statsHtml +
            p.briefingParagraphs
              .map((para) => `<p style="margin:0 0 16px;line-height:1.7;color:#374151;">${escapeHtml(para)}</p>`)
              .join(""),
          ctaText: "Open Founder Dashboard",
          ctaUrl: `${APP_URL}/founder`,
          ctaColor: "#18181b",
        }),
      };
    },
  },

  // ---- lifecycle / marketing ---------------------------------------------
  welcome: {
    category: "lifecycle",
    render: (p) => ({
      subject: "Welcome to AcreOS",
      html: shell({
        heading: "Welcome to AcreOS",
        bodyHtml:
          paragraphs(
            `Hi ${p.firstName ?? "there"},\n\nThanks for joining. AcreOS is built for Land Investors — find parcels, mail offers, reply to sellers, close, and service the note, all in one place.`,
          ) +
          `<ul style="margin:0 0 16px;padding-left:20px;color:#374151;line-height:1.7;">
             <li>Import your first list of parcels</li>
             <li>Launch a mail campaign</li>
             <li>Let Pax handle the replies</li>
           </ul>`,
        ctaText: "Go to your dashboard",
        ctaUrl: p.dashboardUrl ?? `${APP_URL}/today`,
      }),
    }),
  },

  trial_ending: {
    category: "lifecycle",
    render: (p) => ({
      subject:
        p.daysLeft <= 1
          ? "Your AcreOS trial ends tomorrow"
          : `Your AcreOS trial ends in ${p.daysLeft} days`,
      html: shell({
        heading:
          p.daysLeft <= 1
            ? "Your trial ends tomorrow"
            : `${p.daysLeft} days left on your trial`,
        bodyHtml: paragraphs(
          `Hi ${p.firstName ?? "there"},\n\nYour AcreOS trial is wrapping up. Upgrade now to keep your parcels, campaigns, and Pax replies running without interruption.\n\nNo pressure — your data stays put either way.`,
        ),
        ctaText: "Choose a plan",
        ctaUrl: p.upgradeUrl ?? `${APP_URL}/pricing`,
      }),
    }),
  },

  payment_failed: {
    category: "lifecycle",
    render: (p) => ({
      subject: "We couldn't process your AcreOS payment",
      html: shell({
        heading: "Your payment didn't go through",
        bodyHtml: paragraphs(
          `Hi ${p.firstName ?? "there"},\n\nWe tried to charge your card${
            p.amountDueCents ? ` for $${(p.amountDueCents / 100).toFixed(2)}` : ""
          } and it didn't go through. Update your payment method to keep your account active.`,
        ),
        ctaText: "Update payment method",
        ctaUrl: p.updatePaymentUrl ?? `${APP_URL}/settings#billing`,
        ctaColor: "#f59e0b",
      }),
    }),
  },

  churn_rescue: {
    category: "lifecycle",
    render: (p) => ({
      subject: p.subject,
      html: shell({
        heading: p.headline,
        bodyHtml: paragraphs(p.body),
        ctaText: p.ctaText,
        ctaUrl: p.ctaUrl,
      }),
    }),
  },

  milestone_nudge: {
    category: "lifecycle",
    render: (p) => ({
      subject: p.subject,
      html: shell({
        heading: `You hit a milestone: ${p.milestoneLabel}`,
        bodyHtml: paragraphs(
          `That's real traction. Your land business is moving forward with AcreOS.\n\nKnow another Land Investor who could use the same momentum? Share AcreOS — you'll both benefit. Your referral link lives in Settings → Refer & Earn.`,
        ),
        ctaText: "Get your referral link",
        ctaUrl: p.referralUrl ?? `${APP_URL}/settings#referral`,
      }),
    }),
  },

  nps_prompt: {
    category: "lifecycle",
    render: (p) => ({
      subject: "Quick question — how's AcreOS working for you?",
      html: shell({
        heading: "How likely are you to recommend AcreOS?",
        bodyHtml: paragraphs(
          `Hi ${p.firstName ?? "there"},\n\nIt takes 15 seconds and it genuinely shapes what we build next for Land Investors. One tap on the scale below.`,
        ),
        ctaText: "Answer in one tap",
        ctaUrl: p.surveyUrl ?? `${APP_URL}/today?nps=1`,
        ctaColor: "#0ea5e9",
      }),
    }),
  },
};

export interface RegisteredSendOptions {
  to: string;
  organizationId?: number;
  /** Override the from-name (defaults to AcreOS). */
  fromName?: string;
  replyTo?: string;
  /** Override the suppression check — only honor for transactional sends. */
  bypassSuppression?: boolean;
}

export interface RegisteredSendResult extends EmailResult {
  kind: EmailKind;
  category: EmailCategory;
  /** True when the send was short-circuited by a lifecycle opt-out. */
  suppressed?: boolean;
}

async function logSend(row: {
  organizationId?: number;
  kind: EmailKind;
  category: EmailCategory;
  recipient: string;
  subject: string;
  status: "sent" | "failed" | "suppressed" | "skipped";
  messageId?: string;
  error?: string;
  errorType?: string;
}): Promise<void> {
  try {
    await db.insert(outboundEmailLog).values({
      organizationId: row.organizationId,
      kind: row.kind,
      category: row.category,
      recipient: row.recipient,
      subject: row.subject,
      status: row.status,
      messageId: row.messageId,
      error: row.error,
      errorType: row.errorType,
    });
  } catch (err) {
    // Logging the send must never break the send path.
    logger.error(
      "[emailRegistry] failed to write outbound_email_log row",
      err instanceof Error ? err : undefined,
      { metadata: { kind: row.kind, recipient: row.recipient } },
    );
  }
}

/**
 * THE single typed send entrypoint. Renders the named template, applies the
 * lifecycle suppression gate, logs the attempt, and delegates to the SES
 * transport (which enforces hard-bounce suppression + warmup rate limiting).
 */
export async function sendRegisteredEmail<K extends EmailKind>(
  kind: K,
  props: EmailKindProps[K],
  options: RegisteredSendOptions,
): Promise<RegisteredSendResult> {
  const def = EMAIL_KINDS[kind] as EmailKindDef<K>;
  const { subject, html } = def.render(props);
  const category = def.category;

  // Lifecycle/marketing sends honor the recipient's marketing opt-out. A
  // transactional send (password reset, etc.) is never blocked by a marketing
  // opt-out — but the transport-level filterSuppressed still blocks hard
  // bounces/complaints for ALL sends.
  if (category === "lifecycle" && !options.bypassSuppression) {
    const optedOut = await isSuppressed(options.to);
    if (optedOut) {
      logger.info("[emailRegistry] lifecycle send suppressed (recipient opted out)", {
        metadata: { kind, recipient: options.to, organizationId: options.organizationId },
      });
      await logSend({
        organizationId: options.organizationId,
        kind,
        category,
        recipient: options.to,
        subject,
        status: "suppressed",
      });
      return {
        success: false,
        kind,
        category,
        suppressed: true,
        error: "Recipient is suppressed / opted out of lifecycle email",
        errorType: "recipient_rejected",
        attempts: 0,
      };
    }
  }

  const result = await emailService.sendEmail({
    to: options.to,
    subject,
    html,
    organizationId: options.organizationId,
    fromName: options.fromName,
    replyTo: options.replyTo,
    // Lifecycle sends carry the List-Unsubscribe header + CAN-SPAM footer.
    isCampaignEmail: category === "lifecycle",
  });

  await logSend({
    organizationId: options.organizationId,
    kind,
    category,
    recipient: options.to,
    subject,
    status: result.success ? "sent" : "failed",
    messageId: result.messageId,
    error: result.error,
    errorType: result.errorType,
  });

  return { ...result, kind, category };
}
