/**
 * Pax glossary — the CORE subset that must render synchronously.
 *
 * BD-6 (bundle diet): shared/pax-glossary.ts rendered 16,714 B inside the
 * entry chunk because every Pax surface — shell labels on the copilot
 * rail, the ask card, the receipts feed, the settings index — imports
 * from the one module, so the whole glossary (including the Settings →
 * Pax page's long copy) rode in the entry chunk. The full glossary now
 * ships as a static asset (shared/pax-glossary.json, served at
 * /pax-glossary.json — see the acreos-pax-glossary vite plugin) and the
 * one fetch-tolerant consumer (the Settings → Pax page) loads it through
 * client/src/lib/pax-glossary.tsx, shell first, text on arrival.
 *
 * What stays here is only what a shell surface prints in its first
 * render and cannot wait for a fetch without flashing empty: the
 * controls path/label, the standing line, the fixed labels, the receipt
 * words, the settings-index and rules-editor copy, the pause
 * "still works" line, the stance/rail label words shared/pax-controls.ts
 * derives its maps from, and formatPaxTime (code, not copy).
 *
 * shared/pax-glossary.ts re-exports everything here, so server and test
 * consumers keep the one-file surface they have always imported. The
 * verbatim pin (tests/unit/paxGlossaryServedAsData.test.ts) holds this
 * module, the full glossary and the served JSON to the same strings.
 *
 * Browser-safe by construction: no Node builtins, no process.env.
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

/** "asked / ran on its own / rule" — the third column of a receipt row. */
export const PAX_RECEIPT_WORDS = {
  asked: "asked",
  onItsOwn: "ran on its own",
  rule: "rule",
} as const;

/**
 * What Pause does NOT stop — printed under the list of what it does, and
 * on the ask card while paused. The full pause copy (status lines,
 * refusals) lives in shared/pax-glossary.ts / the served asset; this one
 * sentence is shell copy because the ask card prints it in first render.
 */
export const PAX_PAUSE_STILL_WORKS =
  "Pax still answers and drafts, still asks, and anything you approve still goes out.";

/**
 * Stance labels, keyed by the STORED value. shared/pax-glossary.ts's
 * PAX_STANCE_COPY takes its `label` fields from here and
 * shared/pax-controls.ts derives STANCE_LABELS from here, so the
 * segmented control never waits on the asset fetch.
 */
export const PAX_STANCE_LABELS = {
  ask_before_sending: "Ask before sending",
  ask_before_everything: "Ask before everything",
} as const;

/**
 * Rail level words (PX-2). shared/pax-glossary.ts's PAX_RAIL_COPY.levels
 * IS this object; shared/pax-controls.ts derives its label/sentence maps
 * from here.
 */
export const PAX_RAIL_LEVEL_WORDS = {
  watch: {
    label: "Watch",
    sentence: "Pax looks but does not change anything.",
  },
  draft: {
    label: "Draft",
    sentence: "Pax prepares the change and holds it for you. Nothing is written until you tap.",
  },
  ask: {
    label: "Ask",
    sentence: "Pax proposes each change and waits for your tap.",
  },
  act_and_report: {
    label: "Act and report",
    sentence: "Pax makes the change and leaves a receipt.",
  },
} as const;

/** Rail domains (PX-2). PAX_RAIL_COPY.domains IS this object. */
export const PAX_RAIL_DOMAINS = {
  leads: { label: "Leads" },
  properties: { label: "Properties" },
  deals: { label: "Deals" },
  tasks: { label: "Tasks" },
  follow_ups: { label: "Follow-ups" },
  account: { label: "Account fixes" },
} as const;

/** Settings bucket + quick-find entry points (spec §3a "Entry points"). */
export const PAX_SETTINGS_COPY = {
  bucketLabel: "Pax & connections",
  cardTitle: "Pax — when it asks, what runs on its own",
  cardOpen: "Open",
  byokCardTitle: "Use your own provider accounts",
  byokCardBody:
    "Plug in your own Twilio, SendGrid, Lob or AI account so texts, emails, mail and Pax bill to you directly.",
  byokOpen: "Open your keys",
  quickFind: {
    pax: { label: "Pax — pause, when it asks", description: "One page: pause, stance, what runs on its own" },
    // PAX_PAGE_COPY.pauseButton in the full glossary — the same string,
    // pinned verbatim by tests/unit/paxGlossaryServedAsData.test.ts.
    pause: { label: "Pause Pax", description: "Stop everything Pax and your rules do on their own" },
    waiting: { label: PAX_LABELS.queue, description: "Approve, edit or reject what Pax wrote" },
    byok: { label: "Your own keys (BYOK)", description: "Twilio, SendGrid, Lob, AI, property data" },
  },
} as const;

/** Honesty lines for the rules editors (spec §6 workflow toast; provider status chip). */
export const PAX_RULES_COPY = {
  workflowActive: "Your workflow is now active.",
  workflowSavedNotLive(eventLabel: string): string {
    return `Saved — will run when ${eventLabel} goes live`;
  },
  /** Factual AI-key status on the provider card: read from GET /api/byok. */
  aiOwnKey(providerName: string): string {
    return `Pax runs on your own ${providerName} account`;
  },
  aiPlatformKey: "Pax runs on AcreOS's AI account",
} as const;

/**
 * "Thu 8:00 am" — the one way a pause time is printed. `timeZone` is an
 * IANA name (the org's `timezone` column, or the user's browser zone on
 * the client). Never prints an ISO string to a customer.
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
