/**
 * Pax glossary — EVERY customer-visible string for the Pax controls model.
 *
 * Customer autonomy clarity program (founder directive 2026-09-02).
 * Spec: docs/autonomous/AUTONOMY_SPEC.md §1–§2, §4.6, §6. Dispositions:
 * docs/company/founder-decision-2026-09-02-pax-controls.md.
 *
 * The model, in the customer's words: two positions ("Ask before sending" —
 * the default and today's real behaviour; "Ask before everything"), one state
 * above them (Paused), one queue ("Waiting for your tap"), one receipts feed
 * ("What Pax did"), one fixed "Never" list. No level, no slider, no
 * percentage, no persona.
 *
 * WHY ONE FILE. The pre-program surfaces carried at least three vocabularies
 * for the same idea (spec §3d), and each was typed inline where it was
 * rendered. Everything a customer reads about what Pax does on its own now
 * comes from here: the Settings page, the refusal messages the engines
 * return, the ask cards, the digest, the landing FAQ. A string that is not
 * in this file is not a string the customer sees.
 *
 * BANNED WORDS (spec §2) are ratcheted by tests/unit/paxGlossaryBannedWords
 * .test.ts over the string literals of this program's files; wave 1 F widens
 * that population to client/src/** (paxControlsSurfaceIsHonest.test.ts).
 *
 * Browser-safe by construction: no Node builtins, no process.env (this file
 * is bundled into the client as well as the server).
 *
 * Consumers (wave 0): shared/pax-controls.ts, server/services/paxControls.ts,
 * server/services/paxReceipts.ts, server/services/paxAskSummary.ts. Wave 1
 * adds the page (D), the ask card (E), the routes (C), the refusals in the
 * engines (A/B) and the landing/disclosure copy (F).
 */

/** The one place the Pax controls live. Nested under Settings — never a door. */
export const PAX_CONTROLS_PATH = "/settings/pax";

/** How the controls are named in prose ("Resume under Settings → Pax"). */
export const PAX_CONTROLS_LABEL = "Settings → Pax";

/**
 * The standing line — replaces "Pax can take real actions · Always review…"
 * on the rail footer and the disclosure rail (spec §6).
 */
export const PAX_STANDING_LINE =
  "Pax looks, drafts and updates your records. Every message waits for your tap.";

/** Fixed labels and the fixed sentences that are not tied to a stance. */
export const PAX_LABELS = {
  /** The one queue. */
  queue: "Waiting for your tap",
  /** The one receipts feed. */
  receipts: "What Pax did",
  /** Status strip, not paused. */
  active: "Pax is active",
  /** Status strip, paused (the "until when" follows). */
  paused: "Paused",
  /** Printed once on the page, under the stance control. */
  fixedRule:
    "Anything Pax writes to another person — email, text, letter, payment link — waits for your tap. Always.",
  /** The three sentences of the mental model (spec §1), in order. */
  mentalModel: [
    "Pax looks things up and writes drafts on its own, and it keeps your records up to date — lead status, tasks, deals, calendar, scores — showing you every change.",
    "Pax never sends a message to anyone until you tap Approve; everything waiting for you is in one place, \"Waiting for your tap\".",
    "Rules you turned on — drips, workflows, scheduled prompts — run by themselves on your own connected accounts, each behind its own switch, and one red button pauses all of it.",
  ] as const,
  /** Appended to the disclosure (v2) after the mental model. */
  youStartOn:
    "You start on Ask before sending. Change it, or pause everything, any time under Settings → Pax.",
  /** An ask past its expiry, still listed for 7 days. */
  expiredAsk: "Expired — ask Pax to draft it again",
  /** The Never list's one-line answer. */
  notEvenIfYouAsk: "Not even if you ask.",
  /** The ask card's "from" line when the channel has no connected identity. */
  noSendingIdentity: "no sending identity connected → Settings → BYOK",
  /** Label over Pax's own explanation on an ask card. Never a number. */
  whyLabel: "Pax's explanation",
  /** The one honest badge exception (spec §2). */
  notYetLive: "Not yet live",
  /** Who paused, when the holder's name is not on file. */
  unknownHolder: "a teammate",
  /** An approved ask whose tool name no rail can replay. */
  notRunnable: "This can't be run from a tap. Ask Pax to draft it again.",
} as const;

/**
 * Stance copy, keyed by the STORED value. `label` is the segmented-control
 * option, `sentence` the line under it, `toast` the consequence shown on
 * change. The two keys ARE the offered stances — shared/pax-controls.ts
 * derives its labels from here and the type there forces one entry per
 * offered stance.
 */
export const PAX_STANCE_COPY = {
  ask_before_sending: {
    label: "Ask before sending",
    sentence:
      "Pax keeps your records up to date on its own and shows you every change. Any message to another person waits for your tap.",
    toast:
      "Ask before sending — Pax will update records on its own again. Messages still wait for your tap.",
  },
  ask_before_everything: {
    label: "Ask before everything",
    sentence:
      "Pax only looks and drafts. Every change to your records and every message waits for your tap.",
    toast:
      "Ask before everything — every record change and every message now waits for your tap.",
  },
} as const;

/**
 * "Thu 8:00 am" — the one way a pause time is printed. `timeZone` is an
 * IANA name (the org's `timezone` column, or the user's browser zone on the
 * client). Never prints an ISO string to a customer.
 */
export function formatPaxTime(date: Date, timeZone?: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone,
    }).formatToParts(date);
  } catch {
    // An unknown zone must not turn a refusal into a crash — fall back to
    // the runtime's default zone rather than inventing a time.
    parts = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(date);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const dayPeriod = get("dayPeriod").toLowerCase();
  return `${get("weekday")} ${get("hour")}:${get("minute")} ${dayPeriod}`.trim();
}

export interface PaxPauseWords {
  /** Latest active expiry across the org; null when it cannot be known. */
  until: Date | null;
  /** Display name of the person who paused; null when unknown. */
  byName: string | null;
  /** IANA zone for printing `until`. */
  timeZone?: string;
}

/**
 * Pause copy (spec §2 "Paused" row and §4.6). Every function takes the real
 * expiry and the real holder; when either is unknown it says less, never
 * invents a time or a name.
 */
export const PAX_PAUSE_COPY = {
  /** Status strip: "Paused until Thu 8:00 am by Maria". */
  statusLine({ until, byName, timeZone }: PaxPauseWords): string {
    const when = until ? ` until ${formatPaxTime(until, timeZone)}` : "";
    const who = byName ? ` by ${byName}` : "";
    return `${PAX_LABELS.paused}${when}${who}`;
  },
  /** The stance-row sentence while paused. */
  sentence({ until, byName, timeZone }: PaxPauseWords): string {
    const when = until ? ` until ${formatPaxTime(until, timeZone)}` : "";
    const who = byName ? ` (paused by ${byName})` : "";
    return (
      `Everything Pax and your rules do on their own is stopped${when}${who}. ` +
      "Pax still looks, drafts and asks; anything you approve still goes out."
    );
  },
  /** What Pause does NOT stop — printed under the list of what it does. */
  stillWorks:
    "Pax still answers and drafts, still asks, and anything you approve still goes out.",
  /** The 30-day safety lift, shown for "until I resume". */
  resumesByItself(until: Date, timeZone?: string): string {
    return `Pax resumes by itself on ${formatPaxTime(until, timeZone)} if you forget.`;
  },
  /** The refusal an engine returns for a side-effecting action while paused. */
  refusal({ until, byName, timeZone }: PaxPauseWords): string {
    const when = until ? ` until ${formatPaxTime(until, timeZone)}` : "";
    const who = byName ? ` (paused by ${byName})` : "";
    return (
      `Pax is paused${when}${who}, so this wasn't done. ` +
      `Resume under ${PAX_CONTROLS_LABEL}. Looking, drafting and anything you approve still work.`
    );
  },
  /** The refusal when the pause read itself failed (fail closed, say so). */
  checkFailedRefusal:
    `Pax could not verify its pause setting, so this wasn't done. Try again or check ${PAX_CONTROLS_LABEL}.`,
  /** The scheduled-prompt run summary while paused (spec §6). */
  skippedLine({ until, timeZone }: Pick<PaxPauseWords, "until" | "timeZone">): string {
    const when = until ? ` until ${formatPaxTime(until, timeZone)}` : "";
    return `Skipped — Pax is paused${when}. Resume under ${PAX_CONTROLS_LABEL}.`;
  },
} as const;

/**
 * The capability groups, in page order, each with its "If you never touch
 * this" line (spec §2). `runs_rules` takes the real send envelope because its
 * numbers are limits read from server/services/autonomyGuardrails.ts, never
 * typed here.
 */
export const PAX_GROUP_COPY = {
  looks_and_drafts: {
    label: "Looks & drafts",
    ifYouNeverTouchThis:
      "Pax answers, researches and drafts whenever you ask. This is never gated, never counted, and keeps working while paused.",
  },
  changes_records: {
    label: "Changes your records",
    ifYouNeverTouchThis:
      "When you ask Pax to change something, it does it and leaves a receipt. Scheduled prompts you set up do the same. Switch to 'Ask before everything' and every change waits for your tap instead.",
  },
  sends: {
    label: "Sends to people",
    ifYouNeverTouchThis:
      "Pax never sends what it wrote without your tap. Always. There is no setting that changes this.",
  },
  runs_rules: {
    label: "Runs your rules",
    ifYouNeverTouchThis(limits: {
      emailsPerDay: number;
      textsPerDay: number;
      textHours: string;
    }): string {
      return (
        `Things you turned on run by themselves from your own connected accounts — texts only ${limits.textHours} recipient time, ` +
        `never to anyone who opted out, never more than ${limits.emailsPerDay} emails / ${limits.textsPerDay} texts a day. ` +
        "Each has its own switch. Pause stops all of them."
      );
    },
  },
  never: {
    label: "Never",
    ifYouNeverTouchThis: PAX_LABELS.notEvenIfYouAsk,
  },
} as const;

/**
 * The fixed Never list — facts, each with the gate that makes it a fact
 * (spec §2). A line is listed ONLY while its gate exists; the pricing line
 * ("change what you pay AcreOS") is appended by wave 1 A together with
 * paxSupportNoPricing.test.ts and the model-unreachable apply_credit — it is
 * deliberately absent until then, because a Never line without a gate is a
 * claim, not a fact.
 */
export const PAX_NEVER_LIST = [
  {
    id: "delete_data",
    line: "delete your data",
    gate: "tests/unit/paxToolsPerformNoDeletion.test.ts",
  },
  {
    id: "move_money",
    line: "move money or take a payment on AcreOS's account",
    gate: "tests/unit/moneyCustodyHardStop.test.ts",
  },
  {
    id: "skip_trace",
    line: "skip-trace from chat",
    gate: "tests/unit/paxToolScopeAndFcra.test.ts",
  },
  {
    id: "platform_sender",
    line: "send to a seller or buyer from an AcreOS address",
    gate: "tests/unit/connectorCatalogIsHonest.test.ts",
  },
] as const;

/** "asked / ran on its own / rule" — the third column of a receipt row. */
export const PAX_RECEIPT_WORDS = {
  asked: "asked",
  onItsOwn: "ran on its own",
  rule: "rule",
} as const;

/**
 * Where an ask came from, in words (spec §4.5). `sourceRef` is the frozen
 * pending_actions.source_ref; only its NAME fields are read here.
 */
export function originPhrase(
  origin: string,
  sourceRef?: { scheduledTaskName?: string | null } | null,
): string | null {
  switch (origin) {
    case "chat":
      return "from your chat";
    case "scheduled": {
      const name = sourceRef?.scheduledTaskName;
      return name ? `from your scheduled prompt '${name}'` : "from a scheduled prompt";
    }
    case "inbound_signal":
      return "from a reply that came in";
    case "support":
      return "from your support chat";
    case "approval_replay":
      return "after your tap";
    case "finance_ladder":
      return "borrower reminder ladder";
    case "revised":
      return "from your edit";
    default:
      return null;
  }
}
