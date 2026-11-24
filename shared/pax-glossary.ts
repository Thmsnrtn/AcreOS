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

/**
 * BD-6: the shell subset of this glossary (controls path/label, standing
 * line, fixed labels, receipt words, settings/rules copy, stance and
 * rail label words, formatPaxTime) lives in shared/pax-glossary-core.ts
 * and is re-exported here, so the export surface of this module is
 * unchanged for server and test consumers. Client shell surfaces import
 * the core directly; the long copy below reaches the client only as the
 * static asset /pax-glossary.json (see client/src/lib/pax-glossary.tsx).
 */
import {
  formatPaxTime,
  PAX_CONTROLS_LABEL,
  PAX_LABELS,
  PAX_PAUSE_STILL_WORKS,
  PAX_RAIL_DOMAINS,
  PAX_RAIL_LEVEL_WORDS,
  PAX_STANCE_LABELS,
} from "./pax-glossary-core";

export {
  formatPaxTime,
  PAX_CONTROLS_LABEL,
  PAX_CONTROLS_PATH,
  PAX_LABELS,
  PAX_PAUSE_STILL_WORKS,
  PAX_RAIL_DOMAINS,
  PAX_RAIL_LEVEL_WORDS,
  PAX_RECEIPT_WORDS,
  PAX_RULES_COPY,
  PAX_SETTINGS_COPY,
  PAX_STANCE_LABELS,
  PAX_STANDING_LINE,
} from "./pax-glossary-core";

/**
 * Stance copy, keyed by the STORED value. `label` is the segmented-control
 * option, `sentence` the line under it, `toast` the consequence shown on
 * change. The two keys ARE the offered stances — shared/pax-controls.ts
 * derives its labels from here and the type there forces one entry per
 * offered stance.
 */
export const PAX_STANCE_COPY = {
  ask_before_sending: {
    label: PAX_STANCE_LABELS.ask_before_sending,
    sentence:
      "Pax keeps your records up to date on its own and shows you every change. Any message to another person waits for your tap.",
    toast:
      "Ask before sending — Pax will update records on its own again. Messages still wait for your tap.",
  },
  ask_before_everything: {
    label: PAX_STANCE_LABELS.ask_before_everything,
    sentence:
      "Pax only looks and drafts. Every change to your records and every message waits for your tap.",
    toast:
      "Ask before everything — every record change and every message now waits for your tap.",
  },
} as const;

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
  stillWorks: PAX_PAUSE_STILL_WORKS,
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
 * Per-capability rails (PX-2, register P-1; founder ruling 2026-11-10 §6.5 Q4:
 * a refinement INSIDE the existing stance, never a new stance). Keys of
 * `levels` ARE the stored rail levels and keys of `domains` ARE the stored
 * record domains — shared/pax-controls.ts derives its label maps from here
 * and its types force one entry per level / domain.
 */
export const PAX_RAIL_COPY = {
  title: "What Pax may do on each kind of record",
  intro:
    "Your stance above still decides first. These rails can only make Pax more careful for one kind of record — never less careful than your stance.",
  levels: PAX_RAIL_LEVEL_WORDS,
  domains: PAX_RAIL_DOMAINS,
  sendsLabel: "Sends to people",
  sendsCeiling: "Sends never go past Ask. Pax never sends what it wrote without your tap.",
  alwaysOnLabel: "Looks & drafts",
  alwaysOnLine: "Always on — never gated, and it keeps working while paused.",
  runsRulesLabel: "Runs your rules",
  runsRulesLine: "Not a rail. Each rule keeps its own switch, listed under what runs on its own below.",
  /** Toast after a rail changes: "Leads — Ask". */
  changed(areaLabel: string, levelLabel: string): string {
    return `${areaLabel} — ${levelLabel}`;
  },
  /** The refusal when a rail is on Watch (same shape as the pause refusal). */
  watchRefusal(areaLabel: string): string {
    return (
      `Pax is set to Watch for ${areaLabel.toLowerCase()}, so this wasn't done. ` +
      `Change it under ${PAX_CONTROLS_LABEL}. Looking, drafting and anything you approve still work.`
    );
  },
} as const;

/**
 * Daily limits, per-member narrowing and the rails reset (PX-3, register P-1).
 * Keys of `labels` ARE the stored limit keys (shared/pax-controls.ts PaxLimits);
 * keys of `refusals` / `deniedLine` are the limit kinds paxLimits.ts reports
 * (asks, credits, browse, batchRows). Every refusal is whole sentences with a
 * way forward — tests/unit/refusalsArePlainWords.test.ts judges each one
 * through paxLimitRefusalMessage.
 */
export const PAX_LIMIT_COPY = {
  title: "Daily limits",
  intro:
    "Cap how much Pax may do in one day. Leave a box blank for no limit. When Pax reaches a cap it stops and tells you; nothing is cut short halfway.",
  resetNote: "Counts start again at midnight in your workspace's time zone.",
  placeholder: "No limit",
  labels: {
    asksPerDay: "Asks Pax may put in front of you",
    creditSpendPerDay: "Credits Pax's approved sends may cost",
    browseCallsPerDay: "Web pages Pax may open",
    batchRowsPerDay: "Records Pax may add in a batch",
  },
  save: "Save limits",
  saved: "Daily limits saved",
  adminHint: "Ask an owner to change the daily limits.",
  /** The refusal each cap gives, by kind. Built by paxLimitRefusalMessage. */
  refusals: {
    asks:
      "Pax has reached your daily limit for asks, so this wasn't done. Your count starts again at midnight, or you can raise the limit under " +
      `${PAX_CONTROLS_LABEL}.`,
    credits:
      "This send would take Pax past your daily limit for credits, so it wasn't put in front of you. Your count starts again at midnight, or you can raise the limit under " +
      `${PAX_CONTROLS_LABEL}.`,
    browse:
      "Pax has reached your daily limit for opening web pages, so the page wasn't opened. Your count starts again at midnight, or you can raise the limit under " +
      `${PAX_CONTROLS_LABEL}.`,
    batchRows:
      "Adding these records would take Pax past your daily limit for batch additions, so none of them were added. Your count starts again at midnight, or you can raise the limit under " +
      `${PAX_CONTROLS_LABEL}.`,
  },
  /** The receipt line for a stopped attempt, in the customer's words. */
  deniedLine: {
    asks: "Stopped at the daily limit for asks",
    credits: "Stopped at the daily limit for credits",
    browse: "Stopped at the daily limit for web pages",
    batchRows: "Stopped at the daily limit for batch additions",
  },
  // Your own narrower settings
  memberTitle: "Your own narrower settings",
  memberIntro:
    "Make Pax more careful when it acts for you. These can only narrow what the workspace allows — a choice that is wider than the workspace's has no effect.",
  memberLimitNote: "A number above the workspace's limit has no effect; the smaller one always applies.",
  memberApplies: "What applies to you right now",
  memberNoLimit: "no limit",
  memberSave: "Save my settings",
  memberSaved: "Your narrower settings saved",
  memberClear: "Clear my narrower settings",
  memberCleared: "Your narrower settings cleared",
  memberCouldNotSave: "Could not save your settings",
  // Reset all rails
  resetButton: "Reset all rails",
  resetConfirm: "Tap again to reset",
  resetCancel: "Keep my settings",
  resetWhat:
    "Resets every rail to its starting level, removes every daily limit, and clears everyone's own narrower settings.",
  resetWhatNot: "Does not change your stance, the three switches, or a pause.",
  resetDone: "Rails, limits and everyone's narrower settings reset",
  couldNotReset: "Could not reset the rails",
} as const;

/**
 * "My county sites" (PX-7) — the list of public sites Pax may run a search on.
 * Listing a site lets Pax type a search into that site's own search box and read
 * the results page; it is not a licence, and the line below says so without
 * claiming more than the fence enforces (a handful of web-sourced records per
 * conversation, each tagged with where it came from).
 */
export const PAX_MY_SITES_COPY = {
  title: "My county sites",
  intro:
    "Public sites you want Pax to search for you — a county assessor, recorder or treasurer. Pax types your search into the site's own search box and reads the results page.",
  limitLine:
    "Listing a site lets Pax run searches on it. It does not let Pax copy a site's data in bulk: Pax still adds only a few records from a web page at a time, and notes where each one came from.",
  empty: "No sites yet. Add the ones you use and Pax can search them when you ask.",
  labelField: "Name",
  labelPlaceholder: "Cochise County assessor",
  hostField: "Website address",
  hostPlaceholder: "https://assessor.example.gov",
  addButton: "Add site",
  removeButton: "Remove",
  added: (label: string) => `${label} added to your sites`,
  removed: (label: string) => `${label} removed from your sites`,
  notAddress: "That does not look like a website address. Paste the address of the site, like https://assessor.example.gov.",
  alreadyListed: "That site is already on your list.",
  listFull: (max: number) => `You can list up to ${max} sites. Remove one to add another.`,
  readOnly: "Ask an owner to change your sites.",
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

// ───────────────────────────────────────────────────────────────────────────
// Wave 1 D additions — the Settings → Pax page and its entry points.
// ADDITIONS ONLY: nothing above this line changed. Every heading, button and
// row line the page prints that is not already a stance / pause / group
// string lives here. Numbers are ALWAYS parameters read from
// GET /api/pax/controls or a constant whose source is cited beside it —
// nothing here types a count.
// ───────────────────────────────────────────────────────────────────────────

/** "4 workflows" / "1 workflow" — the page's only grammar helper. */
function nOf(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The fixed send rules, in the customer's words. The hours are the TCPA
 * quiet-hours window the send chokepoint enforces
 * (server/services/tcpaCompliance.ts: `local < 8 || local >= 21` blocks);
 * the daily limits are NOT typed here — they arrive from the controls
 * route (`fixedRules.emailLimit` / `textLimit`, read from the limiter's own
 * constants). Cadences cite the job roster (server/jobs/jobRegistry.ts):
 * `lead_nurturing` every 15 min, `finance_agent` every 30 min;
 * tests/unit/paxControlsPage.test.ts pins both against the roster.
 */
export const PAX_FIXED_RULES = {
  textHours: "8 am–9 pm",
  leadScoringCadence: "every 15 min",
  borrowerRemindersCadence: "every 30 min",
} as const;

/** The three "until when" choices (founder question 6). Keys are the API values. */
export const PAX_PAUSE_OPTIONS = {
  tomorrow_8am: "Tomorrow 8 am",
  "3d": "3 days",
  "30d": "Until I resume",
} as const;

export type PaxPauseOption = keyof typeof PAX_PAUSE_OPTIONS;

export const PAX_PAGE_COPY = {
  title: "Pax",
  intro: "When Pax asks, what runs on its own, and one button that pauses all of it.",

  // ── 1. Status strip ──
  pauseButton: "Pause Pax",
  resumeButton: "Resume",
  pauseUntilPrompt: "Until when?",
  /** Under "Until I resume": the safety lift is real, so say so. */
  pauseOptionLiftNote: "30 days at most — it lifts by itself if you forget.",
  cancel: "Cancel",
  whatPauseStops: "What Pause stops",
  whatPauseKeeps: "What it does not stop",
  resumeNotYours: "An owner, an admin, or the person who paused can resume.",

  // ── 2. When Pax asks ──
  whenPaxAsks: "When Pax asks",
  askAnOwner: "Ask an owner to change this",
  rightNowLabel: "Right now",
  rightNow(n: {
    waiting: number;
    changedTodayOnItsOwn: number;
    rulesRunning: { workflows: number; sequences: number; scheduledPrompts: number };
  }): string {
    return (
      `${PAX_LABELS.queue}: ${n.waiting} · Changed on its own today: ${n.changedTodayOnItsOwn} · ` +
      `Rules running: ${nOf(n.rulesRunning.workflows, "workflow", "workflows")}, ` +
      `${nOf(n.rulesRunning.sequences, "sequence", "sequences")}, ` +
      `${nOf(n.rulesRunning.scheduledPrompts, "scheduled prompt", "scheduled prompts")}`
    );
  },

  // ── 3. What runs on its own ──
  runsOnItsOwn: "What runs on its own",
  runsOnItsOwnIntro: "Each has its own switch. Pause stops all of them.",
  switchesLiveOn(where: string): string {
    return `Switches are on ${where}`;
  },
  noRunsYet: "no runs yet",
  noSendsYet: "no sends yet",
  lastRan(when: string): string {
    return `last ran ${when}`;
  },
  lastSend(when: string): string {
    return `last send ${when}`;
  },
  workflows: "Workflows",
  workflowsLine(w: { active: number; live: number; lastRan: string | null }): string {
    const notLive = Math.max(0, w.active - w.live);
    return (
      `${w.active} on · ${w.live} live` +
      (notLive > 0 ? ` · ${notLive} ${PAX_LABELS.notYetLive.toLowerCase()}` : "") +
      ` · ${w.lastRan ? PAX_PAGE_COPY.lastRan(w.lastRan) : PAX_PAGE_COPY.noRunsYet}`
    );
  },
  sequences: "Campaign sequences",
  sequencesLine(s: { activeEnrollments: number; lastSend: string | null }): string {
    return (
      `${nOf(s.activeEnrollments, "active enrollment", "active enrollments")} · ` +
      (s.lastSend ? PAX_PAGE_COPY.lastSend(s.lastSend) : PAX_PAGE_COPY.noSendsYet)
    );
  },
  scheduledPrompts: "Scheduled prompts",
  scheduledPromptsLine(n: { on: number; total: number }): string {
    return `${n.on} of ${n.total} on · runs the prompt you wrote, on the schedule you chose`;
  },
  scheduledPromptsEmpty: "No scheduled prompts yet — schedule one from the Pax chat.",
  promptPause: "Pause",
  promptResume: "Resume",
  promptDelete: "Delete",
  promptHistory: "Run history",
  promptPaused: "Paused",
  promptOk: "OK",
  promptError: "Error",
  /** skipped_paused / skipped_off are neutral outcomes, never the Error badge. */
  promptSkippedPaused: "Skipped — paused",
  promptSkippedOff: "Skipped — off",
  promptNextRun(when: string): string {
    return `next ${when}`;
  },
  runHistoryTitle(name: string): string {
    return `Run history — ${name}`;
  },
  runHistoryIntro: "The last 20 runs of this prompt.",
  runHistoryEmpty: "No runs recorded yet.",
  leadScoring: "Lead scoring",
  leadScoringLine(l: { lastRan: string | null; rescoredToday: number }): string {
    return (
      `${PAX_FIXED_RULES.leadScoringCadence} · scores and stages leads · ` +
      `${l.lastRan ? PAX_PAGE_COPY.lastRan(l.lastRan) : PAX_PAGE_COPY.noRunsYet} · ` +
      `${l.rescoredToday} rescored today`
    );
  },
  borrowerReminders: "Prepare borrower payment reminders",
  borrowerRemindersLine(b: { waiting: number }): string {
    return `prepared ${PAX_FIXED_RULES.borrowerRemindersCadence} · each one waits for your tap · ${b.waiting} waiting`;
  },
  inboxDrafts: "Draft a reply when I open a message",
  inboxDraftsLine: "a draft is not an action — nothing is sent until you send it",
  fixedRules: "Fixed rules",
  fixedRulesLine(f: { emailsUsedToday: number; emailLimit: number; textsUsedToday: number; textLimit: number }): string {
    return (
      `Texts only ${PAX_FIXED_RULES.textHours} recipient time · ` +
      `${f.emailsUsedToday} of ${f.emailLimit} emails and ${f.textsUsedToday} of ${f.textLimit} texts used today · ` +
      "never to anyone who opted out · from your own connected accounts"
    );
  },
  switchOn: "on",
  switchOff: "off",
  switchToast(label: string, on: boolean): string {
    return `${label} — ${on ? PAX_PAGE_COPY.switchOn : PAX_PAGE_COPY.switchOff}`;
  },

  // ── 4. What Pax can use ──
  canUse: "What Pax can use",
  canUseIntro: "Your own accounts — your keys, your invoices. Pax sends from these, never from an AcreOS address.",
  connected: "Connected",
  connect: "Connect",
  capabilities: {
    texts: "Text sellers",
    email: "Send email",
    mail: "Send mail",
    data: "Pull property data",
    inbox: "Read & reply to your inbox",
  },

  // ── 5. Links ──
  waitingLink(n: number): string {
    return `${PAX_LABELS.queue} (${n})`;
  },
  waitingHint: "Everything Pax wrote for someone else, in one place.",
  receiptsEmpty: "Nothing yet. When Pax changes a record or a rule runs, it shows up here.",
  receiptsHint: "when · what · which record · how",
  teamLink: "Who on your team can ask Pax to do what",
  teamHint: "Settings → Team",

  // ── 6. Never ──
  neverLead: "Pax will never:",

  // ── Toasts / errors ──
  couldNotLoad: "Couldn't load your Pax settings",
  couldNotPause: "Couldn't pause Pax",
  couldNotResume: "Couldn't resume Pax",
  couldNotChange: "Couldn't change this",
  promptDeleted: "Scheduled prompt deleted",
} as const;
