/**
 * The sectioned morning brief — E2 slice 1, leg 2 (package
 * 2026-11-03 "Pax core"; UI design §4.2: brief → work queue → snapshot).
 *
 * EXTENDS the existing brief, it does not replace it: GET /api/today already
 * composed a one-line brief from real state (composeBrief, and the flagged
 * composeBriefWithPax). That line stays as the headline. This module adds the
 * three designed sections beneath it:
 *
 *   changed   — what moved in the last 24 hours
 *   needsYou  — deadlines and things waiting on the user
 *   prepared  — what Pax prepared that waits for you: prepared packets
 *               (pax_packets) and the approval kernel's live asks
 *               (pending_actions). Nothing here prepares anything.
 *
 * PURE: no database, no model, no clock. The route gathers the counts (it
 * already reads every one of them for the queue and the cash strip) and hands
 * them in; this function decides only which sentences are true.
 *
 * Honesty rules (CLAUDE.md "fabrication is never acceptable"; package D17):
 *   - an item exists only when its count is > 0 — a zero is not news, and it
 *     is never padded with filler;
 *   - every item says what its number counts, in the words of the input's
 *     name (the same discipline todayBriefStatesCountsAsTheyAre pins for the
 *     headline);
 *   - every item carries provenance: the table its count was read from and
 *     the instant it was read (`source`, `asOf`). An item without both is a
 *     bug, and morningBriefSections.test.ts fails on one;
 *   - an all-empty brief says so plainly (`empty: true`), never "all good!";
 *   - no model name, no narrative: sections are deterministic, so they render
 *     identically when the AI provider is down or the quota refuses.
 */

export interface BriefSectionInputs {
  /** The instant the counts were read (the route's clock). */
  asOf: Date;
  // ── changed (last 24h) ──
  /** Completed, real payment rows processed in the last 24h. */
  paymentsPosted24h: number;
  /** Leads created in the last 24h. */
  leadsCreated24h: number;
  /** Real deals whose record changed in the last 24h. */
  dealsUpdated24h: number;
  // ── needs you ──
  /** Real seller-finance notes in status late / delinquent. */
  lateNotes: number;
  /** Real active notes with a scheduled payment due in the next 7 days. */
  notePaymentsDue7d: number;
  /** Active portfolio alerts. */
  openAlerts: number;
  /** Open leads with no contact in 14+ days. */
  leadsUncontacted14d: number;
  // ── prepared (approval kernel, live pending_actions) ──
  /** Live asks awaiting a tap (approvalKernel.countPendingActionsByTool), keyed by tool name. */
  pendingAsksByTool: Readonly<Record<string, number>>;
  /** Pax-prepared packets awaiting approve / dismiss (pax_packets, status prepared). */
  packetsPrepared?: number;
  /**
   * Sections whose inputs could NOT be read (a failed query). A failed read is
   * not a zero: the section is reported unreadable, never "nothing here".
   */
  unreadable?: readonly BriefSectionKey[];
}

export type BriefSectionKey = "changed" | "needsYou" | "prepared";

export interface BriefItem {
  /** Stable id within a brief (for React keys and tests). */
  id: string;
  text: string;
  count: number;
  /** Where the user goes to act on / see it. */
  href: string;
  /** Provenance: the table the count was read from. */
  source: string;
  /** Provenance: when it was read (ISO). */
  asOf: string;
}

export interface BriefSections {
  changed: BriefItem[];
  needsYou: BriefItem[];
  prepared: BriefItem[];
  /** Sections some input of which could not be read — the UI says so instead of "nothing". */
  unreadable: BriefSectionKey[];
  /** True only when all three sections are empty AND every input was read. */
  empty: boolean;
  asOf: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Words for what a parked tool prepared. A tool this map does not know is
 * still reported, as "prepared action(s)", rather than dropped or guessed at;
 * morningBriefSections.test.ts composes a brief for every tool in
 * APPROVAL_REQUIRED_TOOLS plus the borrower ladder's parked tool name and fails
 * when any of them falls back to the generic words — a new parked tool must be
 * named here.
 */
const PREPARED_TOOL_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  send_email: ["email", "emails"],
  send_gmail: ["Gmail message", "Gmail messages"],
  send_sms: ["text message", "text messages"],
  send_slack_message: ["Slack message", "Slack messages"],
  create_stripe_payment_link: ["payment link", "payment links"],
  trigger_zapier: ["Zapier trigger", "Zapier triggers"],
  trigger_make: ["Make trigger", "Make triggers"],
  create_calendar_event: ["calendar invite", "calendar invites"],
  send_borrower_reminder: ["borrower payment reminder", "borrower payment reminders"],
};

export function composeBriefSections(inputs: BriefSectionInputs): BriefSections {
  const asOf = inputs.asOf.toISOString();
  const item = (
    id: string,
    count: number,
    text: string,
    href: string,
    source: string,
  ): BriefItem | null => (count > 0 ? { id, text, count, href, source, asOf } : null);
  const keep = (xs: Array<BriefItem | null>): BriefItem[] => xs.filter((x): x is BriefItem => x !== null);

  const changed = keep([
    item(
      "payments-posted-24h",
      inputs.paymentsPosted24h,
      `${plural(inputs.paymentsPosted24h, "payment")} posted in the last 24 hours`,
      "/money",
      "payments",
    ),
    item(
      "leads-created-24h",
      inputs.leadsCreated24h,
      `${plural(inputs.leadsCreated24h, "new lead")} in the last 24 hours`,
      "/leads",
      "leads",
    ),
    item(
      "deals-updated-24h",
      inputs.dealsUpdated24h,
      `${plural(inputs.dealsUpdated24h, "deal")} created or updated in the last 24 hours`,
      "/deals",
      "deals",
    ),
  ]);

  const needsYou = keep([
    item(
      "notes-late",
      inputs.lateNotes,
      `${plural(inputs.lateNotes, "note")} late or delinquent`,
      "/notes",
      "notes",
    ),
    item(
      "note-payments-due-7d",
      inputs.notePaymentsDue7d,
      `${plural(inputs.notePaymentsDue7d, "note payment")} due in the next 7 days`,
      "/notes",
      "notes",
    ),
    item(
      "open-alerts",
      inputs.openAlerts,
      `${plural(inputs.openAlerts, "open alert")}`,
      "/today",
      "portfolio_alerts",
    ),
    item(
      "leads-uncontacted-14d",
      inputs.leadsUncontacted14d,
      `${plural(inputs.leadsUncontacted14d, "lead")} not contacted in 14+ days`,
      "/leads",
      "leads",
    ),
  ]);

  // Sorted by tool name so the order is stable whatever order the database
  // grouped them in.
  const packets = inputs.packetsPrepared ?? 0;
  const prepared = keep([
    item(
      "prepared-packets",
      packets,
      `${packets} ${packets === 1 ? "item" : "items"} Pax prepared, waiting for you to approve or dismiss`,
      "/today",
      "pax_packets",
    ),
    ...Object.keys(inputs.pendingAsksByTool)
      .sort()
      .map((tool) => {
        const n = inputs.pendingAsksByTool[tool] ?? 0;
        const [one, many] = PREPARED_TOOL_WORDS[tool] ?? ["prepared action", "prepared actions"];
        return item(
          `prepared-${tool}`,
          n,
          PREPARED_TOOL_WORDS[tool]
            ? `${n} ${n === 1 ? one : many} prepared, waiting for your tap`
            : `${n} ${n === 1 ? one : many} waiting for your tap`,
          "/today",
          "pending_actions",
        );
      }),
  ]);

  const unreadable = (["changed", "needsYou", "prepared"] as const).filter((k) =>
    (inputs.unreadable ?? []).includes(k),
  );
  return {
    changed,
    needsYou,
    prepared,
    unreadable,
    empty: changed.length + needsYou.length + prepared.length === 0 && unreadable.length === 0,
    asOf,
  };
}

/**
 * A client's getTimezoneOffset() value, or null when it is absent or not a
 * real offset. Real offsets run from −840 (UTC+14) to +720 (UTC−12); anything
 * outside that, or non-integral, is not a zone and is refused rather than
 * clamped into a wrong day.
 */
export function parseTzOffset(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= -840 && n <= 720 ? n : null;
}

/**
 * The viewer's local YYYY-MM-DD for `now`, given a parsed getTimezoneOffset()
 * (UTC − local, minutes). There is no fallback zone: without the viewer's
 * offset there is no "their day" to key an archive row by, so callers pass a
 * parsed offset or do not archive.
 */
export function localBriefDate(now: Date, tzOffsetMin: number): string {
  return new Date(now.getTime() - tzOffsetMin * 60_000).toISOString().slice(0, 10);
}
