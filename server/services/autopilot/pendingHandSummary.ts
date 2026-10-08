/**
 * The one-line summary on a pending-action (witnessed-send) approval card.
 *
 * The card is the founder's ONLY look at an outward action before it runs, so
 * it must show the dangerous part: HOW MUCH, to WHOM, and HOW OFTEN. It used to
 * read "run_ad_campaign → meta" (no $/day, no hint that it recurs) and
 * "apply_refund → ch_…" (no amount). Every summary now carries all three
 * fields, each stated honestly as absent when the input does not carry it —
 * never guessed.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Hands whose effect repeats until someone stops it. */
const RECURRING: Record<string, string> = {
  run_ad_campaign: "recurring daily until stopped",
};

function recipientOf(input: Record<string, unknown>): string {
  const to = input.to;
  if (typeof to === "string" && to.trim()) return to.trim();
  if (to && typeof to === "object") {
    const a = to as Record<string, unknown>;
    const name = str(a.name);
    const where = [str(a.city), str(a.state)].filter(Boolean).join(", ");
    if (name) return where ? `${name} (${where})` : name;
  }
  if (num(input.lead_id) != null) return `lead #${input.lead_id}`;
  if (num(input.ticket_id) != null) return `support ticket #${input.ticket_id} (the customer who opened it)`;
  if (str(input.charge_id)) return `charge ${str(input.charge_id)}`;
  if (str(input.user_id)) return `user ${str(input.user_id)}${num(input.organization_id) != null ? ` (org ${input.organization_id})` : ""}`;
  if (num(input.event_id) != null) return `dunning event #${input.event_id}`;
  if (str(input.platform)) {
    const audience = str(input.audience);
    return `${str(input.platform)} ads${audience ? ` — audience: ${audience.slice(0, 80)}` : ""}`;
  }
  return "no recipient given";
}

/** Facts the request itself does not carry, resolved by the caller (e.g. a dunning event's amount due). */
export interface PendingSummaryContext {
  /** The hand's own declaration that it moves money (HandSpec.movesMoney). */
  movesMoney?: boolean;
  /** An amount resolved from the record the hand acts on. */
  amountCents?: number | null;
  /** A recipient resolved from the record the hand acts on (e.g. "org 12"). */
  recipient?: string | null;
}

function amountOf(input: Record<string, unknown>, ctx: PendingSummaryContext): string {
  const daily = num(input.daily_budget_cents);
  if (daily != null) return `${usd(daily)}/day`;
  const cents = num(input.amount_cents) ?? num(ctx.amountCents);
  if (cents != null) return usd(cents);
  // Never claim "no money moves" for a hand that declares it does.
  return ctx.movesMoney ? "amount not stated — check before approving" : "no money moves";
}

/** A short human-readable summary of what approving this hand will do. */
export function summarizePendingHand(
  handName: string,
  input: Record<string, unknown>,
  ctx: PendingSummaryContext = {},
): string {
  const recurrence = RECURRING[handName] ?? "one-time";
  const action = str(input.action);
  const subject = str(input.subject);
  const head = action ? `${handName} (${action})` : handName;
  const tail = subject ? `: "${subject}"` : "";
  const recipient = recipientOf(input);
  const who = ctx.recipient ? `${recipient} (${ctx.recipient})` : recipient;
  return `${head} → ${who} · ${amountOf(input, ctx)} · ${recurrence}${tail}`;
}

/**
 * Resolve the facts a request leaves implicit. A dunning action names only an
 * event id; the amount it retries and the org it charges live on the event.
 * Best-effort: an unreadable record leaves the summary saying the amount is not
 * stated, never a guessed figure.
 */
export async function resolvePendingSummaryContext(
  handName: string,
  input: Record<string, unknown>,
  movesMoney: boolean,
): Promise<PendingSummaryContext> {
  const ctx: PendingSummaryContext = { movesMoney };
  if (handName === "dunning_action" && num(input.event_id) != null) {
    try {
      // A dunning event is AcreOS's own subscription billing of an org; the
      // hand's request carries only the event id. Read through the dunning
      // console's one by-id platform read rather than a second copy of it.
      const { dunningService } = await import("../dunning");
      const ev = await dunningService.getCaseForConsole(input.event_id as number);
      if (ev) {
        ctx.amountCents = ev.amountDueCents ?? null;
        ctx.recipient = `org ${ev.organizationId}`;
      }
    } catch {
      /* honest: amount stays "not stated" */
    }
  }
  return ctx;
}
