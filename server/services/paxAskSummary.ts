/**
 * Ask summaries — the SERVER-formatted card behind "Waiting for your tap"
 * (AUTONOMY_SPEC.md §4.5). `formatApprovalArgs` used to live in
 * client/src/components/pax-copilot-rail.tsx; the phone, Today's queue, the
 * support chat and the rail now render the same summary from here, so four
 * hosts cannot drift into four wordings.
 *
 * What a summary says, and where each line comes from:
 *   verb        "Text Bill Thompson" — from the frozen args, never re-derived
 *   to / from   the recipient; the org's connected identity for that channel
 *               (supplied by the route from BYOK / mailbox status) or the
 *               glossary's "no sending identity connected" line
 *   text        the full frozen message, when the tool carries one
 *   change      before → after for a record write (before is captured by the
 *               kernel writers in wave 1; null until then, never guessed)
 *   why         `reason` verbatim, labelled "Pax's explanation"; absent when
 *               null; NEVER a number
 *   origin      in words — "from your scheduled prompt 'Monday lead pull'"
 *   parked      still waiting (a PARKED_STATES member and not past expiry)
 *   alwaysAsks  waits at every stance (a send, a billing fix) vs. waiting
 *               because the customer chose "Ask before everything"
 *
 * Pure: no I/O, no clock other than `ctx.now`. Wave-1 consumers:
 * GET /api/pax/needs-you (C), PaxAskCard hosts (E). Wave 0 consumer:
 * server/services/paxAskExecutors.ts (the receipt's "what" line).
 */

import { APPROVAL_REQUIRED_TOOLS, toolChannel } from "./approvalKernel";
import {
  ALWAYS_ASK_SUPPORT_TOOLS,
  PARKED_STATES,
  PAX_ASK_ORIGINS,
  PAX_TOOL_GROUPS,
  STANCE_LABELS,
  type PaxAskOrigin,
  type PaxAskSourceRef,
  type PaxToolGroup,
} from "@shared/pax-controls";
import {
  formatPaxTime,
  originPhrase,
  PAX_GROUP_COPY,
  PAX_LABELS,
  PAX_STANDING_LINE,
} from "@shared/pax-glossary";

/** The columns of a pending_actions row this module reads. */
export interface AskRow {
  id: number;
  toolName: string;
  args: Record<string, unknown>;
  status: string;
  expiresAt: Date | null;
  origin?: string | null;
  reason?: string | null;
  sourceRef?: PaxAskSourceRef | null;
}

export interface AskContext {
  /** IANA zone for the expiry line (the org's, or the viewer's). */
  timeZone?: string;
  /**
   * The org's connected sending identity per channel, in the customer's
   * words ("your Twilio number", "your Gmail"), or null when none is
   * connected. Keys are approvalKernel.toolChannel values.
   */
  identities?: Partial<Record<string, string | null>>;
  /** Injectable clock. */
  now?: Date;
}

export interface AskSummary {
  id: number;
  toolName: string;
  group: PaxToolGroup | null;
  groupLabel: string | null;
  /** "Text Bill Thompson", "Mark lead #12 as hot", "Retry the failed payment". */
  verb: string;
  to: string | null;
  from: string | null;
  /** The full frozen message text, when the tool carries one. */
  text: string | null;
  /** before → after for a record write; null for anything else. */
  change: { before: unknown; after: Record<string, unknown> } | null;
  /** Pax's explanation, verbatim; null when none was recorded. */
  why: string | null;
  whyLabel: string;
  origin: PaxAskOrigin | null;
  originPhrase: string | null;
  sourceRef: PaxAskSourceRef | null;
  expiresAt: string | null;
  expiresLine: string | null;
  /** Still waiting for a tap. */
  parked: boolean;
  /** Past expiry (listed for 7 days under the glossary's expired line). */
  expired: boolean;
  expiredLine: string | null;
  /** Waits at every stance, not because of the chosen one. */
  alwaysAsks: boolean;
  waitingBecause: string;
  standingLine: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim().length > 0 ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "update_lead_status" → "Update lead status". */
function humanizeTool(tool: string): string {
  const words = tool.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : tool;
}

function recipientOf(args: Record<string, unknown>): string | null {
  const named =
    str(args.to) ??
    str(args.recipient) ??
    str(args.phone_number) ??
    str(args.phone) ??
    str(args.email) ??
    str(args.lead_name);
  if (named) return named;
  const leadId = num(args.lead_id) ?? num(args.leadId);
  if (leadId !== null) return `lead #${leadId}`;
  const channel = str(args.channel);
  return channel ? `#${channel.replace(/^#/, "")}` : null;
}

function messageTextOf(args: Record<string, unknown>): string | null {
  return str(args.message) ?? str(args.body) ?? str(args.content) ?? str(args.text) ?? null;
}

function moneyOf(v: unknown): string | null {
  const n = num(v);
  if (n === null) return null;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function verbLine(toolName: string, args: Record<string, unknown>, to: string | null): string {
  const who = to ?? "someone";
  switch (toolName) {
    case "send_sms":
      return `Text ${who}`;
    case "send_email":
    case "send_gmail": {
      const subject = str(args.subject);
      return `Email ${who}${subject ? `: "${subject}"` : ""}`;
    }
    case "send_slack_message":
      return `Post in ${to ?? "Slack"}`;
    case "create_stripe_payment_link": {
      const amount = moneyOf(args.amount);
      const what = str(args.description) ?? "payment";
      return `Create a ${amount ? `${amount} ` : ""}payment link — ${what}`;
    }
    case "send_borrower_reminder":
      return "Send a borrower payment reminder";
    case "update_lead_status": {
      const status = str(args.status);
      return `Mark ${to ?? "the lead"}${status ? ` as ${status}` : ""}`;
    }
    case "create_lead": {
      const name = str(args.name) ?? str(args.first_name);
      return `Add a lead${name ? `: ${name}` : ""}`;
    }
    case "create_task": {
      const title = str(args.title);
      return `Add a task${title ? `: ${title}` : ""}`;
    }
    case "complete_task":
      return `Complete task${num(args.task_id) !== null ? ` #${num(args.task_id)}` : ""}`;
    case "create_calendar_event": {
      const title = str(args.title) ?? str(args.summary);
      return `Add a calendar event${title ? `: ${title}` : ""}`;
    }
    case "schedule_followup":
    case "schedule_follow_up":
      return `Schedule a follow-up${to ? ` with ${to}` : ""}`;
    case "apply_billing_fix": {
      const fix = str(args.fix_type) ?? str(args.action);
      return `Apply a billing fix${fix ? ` (${fix.replace(/_/g, " ")})` : ""}`;
    }
    case "resync_stripe":
      return "Re-sync your billing with Stripe";
    case "reset_user_preferences":
      return "Reset your preferences";
    case "fix_common_issue": {
      const issue = str(args.issue_type) ?? str(args.issue);
      return `Fix ${issue ? issue.replace(/_/g, " ") : "a common issue"}`;
    }
    case "apply_bulk_fix":
      return "Apply a fix across affected records";
    default:
      return humanizeTool(toolName);
  }
}

/** The frozen args minus the fields that are not part of the record. */
function changeOf(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === "reason" || k === "_approved") continue;
    out[k] = v;
  }
  return out;
}

/**
 * One card's worth of server-formatted truth for a pending_actions row.
 */
export function summarizeAsk(row: AskRow, ctx: AskContext = {}): AskSummary {
  const now = ctx.now ?? new Date();
  const args = row.args ?? {};
  const group = PAX_TOOL_GROUPS[row.toolName] ?? null;
  const to = recipientOf(args);
  const isSend = group === "sends";

  const channel = row.toolName === "send_borrower_reminder" ? str(args.channel) : toolChannel(row.toolName);
  const identity = channel ? ctx.identities?.[channel] : undefined;
  // A "from" line only for sends that leave on the org's own connected
  // identity: the five kernel sends and the borrower reminder. Billing fixes
  // are "sends" in the page's grouping but go nowhere a customer connects.
  const leavesOnOwnIdentity =
    (isSend && APPROVAL_REQUIRED_TOOLS.has(row.toolName)) || row.toolName === "send_borrower_reminder";
  const from = leavesOnOwnIdentity ? (identity ?? PAX_LABELS.noSendingIdentity) : null;

  const expiresAt = row.expiresAt instanceof Date && Number.isFinite(row.expiresAt.getTime()) ? row.expiresAt : null;
  const expired = row.status === "expired" || (expiresAt !== null && expiresAt.getTime() <= now.getTime());
  const parked = !expired && (PARKED_STATES as readonly string[]).includes(`pending_actions:${row.status}`);

  const alwaysAsks =
    isSend || APPROVAL_REQUIRED_TOOLS.has(row.toolName) || ALWAYS_ASK_SUPPORT_TOOLS.has(row.toolName);

  const origin = (PAX_ASK_ORIGINS as readonly string[]).includes(row.origin ?? "")
    ? (row.origin as PaxAskOrigin)
    : null;
  const sourceRef = row.sourceRef ?? null;

  return {
    id: row.id,
    toolName: row.toolName,
    group,
    groupLabel: group ? PAX_GROUP_COPY[group].label : null,
    verb: verbLine(row.toolName, args, to),
    to,
    from,
    text: messageTextOf(args),
    change: group === "changes_records" ? { before: null, after: changeOf(args) } : null,
    why: str(row.reason),
    whyLabel: PAX_LABELS.whyLabel,
    origin,
    originPhrase: origin ? originPhrase(origin, sourceRef) : null,
    sourceRef,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    expiresLine: expiresAt && !expired ? `Expires ${formatPaxTime(expiresAt, ctx.timeZone)}` : null,
    parked,
    expired,
    expiredLine: expired ? PAX_LABELS.expiredAsk : null,
    alwaysAsks,
    waitingBecause: alwaysAsks
      ? PAX_GROUP_COPY.sends.ifYouNeverTouchThis
      : `You chose ${STANCE_LABELS.ask_before_everything}.`,
    standingLine: PAX_STANDING_LINE,
  };
}
