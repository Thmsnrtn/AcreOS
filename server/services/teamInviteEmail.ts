/**
 * Team-invite email: the one place a seat invitation leaves AcreOS by mail.
 *
 * LANE. This is AcreOS inviting a person onto AcreOS on the inviting
 * customer's behalf: account mail, not deal mail. It rides the `system` lane
 * (`purpose: "system"`, "AcreOS talking to its own users"). The invitee is
 * nobody's seller, buyer or borrower, and nothing here touches a counterparty
 * identity or weakens the counterparty guard. The lane is declared explicitly,
 * and `transactional: true` keeps the marketing unsubscribe footer off a
 * one-to-one account message.
 *
 * HONESTY. The result is per invitation and says what actually happened:
 * sent | not_configured | suppressed | failed. It is decided by checks made
 * BEFORE the send (simulation mode, any sender configured, suppression list),
 * because the idempotent send path reports a failure as an error string, not a
 * typed reason, and a route must never answer "sent" for mail that did not
 * leave. This function never throws: the invitation rows already exist when it
 * runs, so a mail fault is a per-invite status, not a 500 that would make the
 * inviter retry and duplicate.
 *
 * SECRETS. The plaintext token appears in the invitation URL inside the
 * message body and nowhere else here: never logged, never in log metadata, and
 * the idempotency key carries a hash prefix, not the token.
 */
import { emailService } from "./emailService";
import { filterSuppressed } from "./emailSuppressions";
import { shouldSimulate } from "../utils/simulationMode";
import { hashInviteToken, buildInviteLink } from "../utils/inviteTokens";
import { logger } from "../utils/logger";
import type { TeamInviteDeliveryStatus } from "@shared/teamInviteDelivery";

interface TeamInviteEmailTarget {
  invitationId: number;
  email: string;
  roleLabel: string;
  /** Plaintext token. Goes into the message body only. */
  token: string;
  expiresAt: Date;
  /** True when this replaces an earlier link for the same invitation. */
  reissued?: boolean;
}

interface TeamInviteEmailRequest {
  organization: { id: number; name?: string | null; settings?: unknown };
  inviterName: string;
  invites: TeamInviteEmailTarget[];
}

const SEND_CONCURRENCY = 5;

function oneLine(value: string | null | undefined, max: number): string {
  return (value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function appBaseUrl(): string {
  return (process.env.APP_URL || "https://app.acreos.io").trim().replace(/\/+$/, "");
}

function compose(
  org: TeamInviteEmailRequest["organization"],
  inviterName: string,
  t: TeamInviteEmailTarget,
) {
  const orgName = oneLine(org.name, 60) || "their team";
  const inviter = oneLine(inviterName, 60) || "A teammate";
  const role = oneLine(t.roleLabel, 30) || "Member";
  // The emailed link is built from server config, never from request headers.
  const link = buildInviteLink(appBaseUrl(), t.token);
  const expires = formatDate(t.expiresAt);
  const address = oneLine(t.email, 254);
  const replaces = t.reissued ? "This link replaces any invitation link you were sent earlier." : "";

  const subject = `${inviter} invited you to join ${orgName} on AcreOS`;
  const text = [
    `${inviter} invited you to join ${orgName} on AcreOS as ${role}.`,
    "",
    "Accept the invitation:",
    link,
    "",
    `The invitation is for ${address}: sign in to AcreOS, or create an account, with that same address. It expires on ${expires}.`,
    ...(replaces ? ["", replaces] : []),
    "",
    "If you weren't expecting this, you can ignore this email. Nothing changes unless you accept.",
  ].join("\n");
  const html = [
    `<p><strong>${escapeHtml(inviter)}</strong> invited you to join <strong>${escapeHtml(orgName)}</strong> on AcreOS as ${escapeHtml(role)}.</p>`,
    `<p><a href="${escapeHtml(link)}">Accept the invitation</a></p>`,
    `<p>The invitation is for ${escapeHtml(address)}: sign in to AcreOS, or create an account, with that same address. It expires on ${escapeHtml(expires)}.</p>`,
    ...(replaces ? [`<p>${escapeHtml(replaces)}</p>`] : []),
    `<p>If you weren't expecting this, you can ignore this email. Nothing changes unless you accept.</p>`,
  ].join("\n");
  return { subject, text, html };
}

async function sendOne(
  org: TeamInviteEmailRequest["organization"],
  inviterName: string,
  t: TeamInviteEmailTarget,
): Promise<TeamInviteDeliveryStatus> {
  try {
    const { subject, text, html } = compose(org, inviterName, t);
    const result = await emailService.sendEmail({
      to: t.email,
      subject,
      html,
      text,
      organizationId: org.id,
      purpose: "system",
      transactional: true,
      idempotencyKey: `team-invite:${t.invitationId}:${hashInviteToken(t.token).slice(0, 16)}`,
    });
    if (result.success) return "sent";
    logger.warn("[team-invite] email not sent", {
      organizationId: org.id,
      metadata: { invitationId: t.invitationId, errorType: result.errorType ?? null },
    });
    return "failed";
  } catch (err) {
    logger.warn("[team-invite] email send threw", {
      organizationId: org.id,
      metadata: { invitationId: t.invitationId, error: err instanceof Error ? err.name : "unknown" },
    });
    return "failed";
  }
}

export async function sendTeamInviteEmails(
  request: TeamInviteEmailRequest,
): Promise<Array<{ invitationId: number; status: TeamInviteDeliveryStatus }>> {
  const { organization, inviterName, invites } = request;
  const all = (status: TeamInviteDeliveryStatus) =>
    invites.map((i) => ({ invitationId: i.invitationId, status }));
  if (invites.length === 0) return [];

  try {
    // Simulation mode sends nothing; reporting "sent" would be a lie.
    if (shouldSimulate("email", organization)) return all("not_configured");

    let configured = false;
    try {
      configured = await emailService.isConfigured(organization.id);
    } catch {
      configured = false;
    }
    if (!configured) {
      logger.info("[team-invite] email not sent: no sender configured", {
        organizationId: organization.id,
        metadata: { invites: invites.length },
      });
      return all("not_configured");
    }

    let suppressed = new Set<string>();
    try {
      const check = await filterSuppressed(invites.map((i) => i.email));
      suppressed = new Set(check.suppressed.map((a) => a.toLowerCase()));
    } catch {
      /* filterSuppressed fails open itself */
    }

    const results: Array<{ invitationId: number; status: TeamInviteDeliveryStatus }> = new Array(invites.length);
    for (let start = 0; start < invites.length; start += SEND_CONCURRENCY) {
      const batch = invites.slice(start, start + SEND_CONCURRENCY);
      await Promise.all(
        batch.map(async (t, offset) => {
          const status: TeamInviteDeliveryStatus = suppressed.has(t.email.toLowerCase())
            ? "suppressed"
            : await sendOne(organization, inviterName, t);
          results[start + offset] = { invitationId: t.invitationId, status };
        }),
      );
    }
    return results;
  } catch (err) {
    logger.warn("[team-invite] email step failed", {
      organizationId: organization.id,
      metadata: { error: err instanceof Error ? err.name : "unknown" },
    });
    return all("failed");
  }
}
