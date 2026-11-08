/**
 * Pax core (E2 slice 1) — the registries both sides read.
 *
 * PRESETS are what Pax does ON ITS OWN INITIATIVE: what it prepares without
 * being asked. They are a separate axis from the Pax controls STANCES
 * (shared/pax-controls.ts), which decide whether an action you ask for in chat
 * waits for a tap. A preset never changes a stance, and no preset can make
 * anything execute: in every preset, sends still wait for your tap and every
 * action still goes through the approval kernel.
 *
 * Slice 1 (Amendment 1, D2): Watch-only and Prepare-only are selectable;
 * Prepare-only is the default for every org. Act-inside-rails and Custom are
 * shown as sentences and are NOT activatable — the server refuses them — and
 * are labelled as arriving with earned expansion.
 */

export type PaxPresetId = "watch_only" | "prepare_only" | "act_inside_rails" | "custom";

export interface PaxPreset {
  id: PaxPresetId;
  label: string;
  /** Whether a user can select it in this slice. */
  selectable: boolean;
  willDo: string;
  willNeverDo: string;
  asksFirst: string;
  /** Shown for presets that are not selectable yet. */
  notYet?: string;
}

// Precise about the live stances: sends, payments and signatures always wait
// for a tap; record changes you ASK for in chat follow "When Pax asks" above
// (under the default stance they run and leave a receipt). Presets govern
// what Pax does UNPROMPTED, so this sentence must not claim more than that.
const NEVER_EXECUTES =
  "Send, pay, sign or change your records on its own initiative. Sends, payments and signatures always wait for your tap; changes you ask for in chat follow \"When Pax asks\" above.";

export const PAX_PRESETS: readonly PaxPreset[] = [
  {
    id: "watch_only",
    label: "Watch only",
    selectable: true,
    willDo: "Read your records and write your morning brief. Pax prepares nothing on its own.",
    willNeverDo: NEVER_EXECUTES,
    asksFirst: "Pax asks before preparing anything — so it prepares only what you ask for in chat.",
  },
  {
    id: "prepare_only",
    label: "Prepare only",
    selectable: true,
    willDo: "Prepare work for you to review — within the rails below — and write your morning brief.",
    willNeverDo: NEVER_EXECUTES,
    asksFirst: "Everything Pax prepares waits for you to approve or dismiss it.",
  },
  {
    id: "act_inside_rails",
    label: "Act inside rails",
    selectable: false,
    willDo: "Act on its own inside rails you set, and show you what it did.",
    willNeverDo: "Act outside your rails, or send, pay or sign without your tap.",
    asksFirst: "Anything outside your rails.",
    notYet: "Arrives with earned expansion — once your trust ledger shows the record to support it.",
  },
  {
    id: "custom",
    label: "Custom",
    selectable: false,
    willDo: "Mix the settings above, area by area.",
    willNeverDo: "Send, pay or sign without your tap.",
    asksFirst: "Whatever you set.",
    notYet: "Arrives with earned expansion.",
  },
];

/** D2: the conservative default for every org. */
export const PAX_DEFAULT_PRESET: PaxPresetId = "prepare_only";

export function isSelectablePreset(id: unknown): id is "watch_only" | "prepare_only" {
  return PAX_PRESETS.some((p) => p.id === id && p.selectable);
}

/**
 * Rail scopes — what a rail can allow Pax to PREPARE unprompted. The server
 * enforces the key; the sentence is the user's (seeded with `defaultText`,
 * editable, shown verbatim). `governs` is the fixed line shown under the
 * sentence so an edited sentence can never misstate what the switch does.
 * A rail never authorizes execution.
 */
export interface PaxRailScope {
  key: string;
  defaultText: string;
  governs: string;
}

export const PAX_RAIL_SCOPES: readonly PaxRailScope[] = [
  {
    key: "memory_proposals",
    defaultText:
      "Pax may suggest things to remember about my business from our conversations. I approve each one before it is saved.",
    governs: "Controls: Pax's memory suggestions. Revoking it stops new suggestions; it never deletes what you saved.",
  },
];

export type PaxRailKey = (typeof PAX_RAIL_SCOPES)[number]["key"];

export const RAIL_TEXT_MAX = 500;

/** Every ledger event this slice writes. */
const PAX_LEDGER_EVENTS = [
  "packet_prepared",
  "packet_approved",
  "packet_dismissed",
  "shadow_recorded",
  "memory_created",
  "memory_edited",
  "memory_deleted",
  "rail_edited",
  "rail_revoked",
  "rail_restored",
  "preset_changed",
  "shadow_mode_on",
  "shadow_mode_off",
] as const;
export type PaxLedgerEvent = (typeof PAX_LEDGER_EVENTS)[number];

/** activity_log receipts merged into the ledger timeline (written by routes-pax-controls). */
export const PAX_LEDGER_RECEIPT_ACTIONS = ["pax_paused", "pax_resumed", "pax_controls_changed"] as const;

/** Words for each event on the timeline. */
export const PAX_LEDGER_WORDS: Readonly<Record<PaxLedgerEvent | (typeof PAX_LEDGER_RECEIPT_ACTIONS)[number], string>> = {
  packet_prepared: "Pax prepared",
  packet_approved: "You approved",
  packet_dismissed: "You dismissed",
  shadow_recorded: "Shadow — Pax would have prepared",
  memory_created: "You added to memory",
  memory_edited: "You edited a memory",
  memory_deleted: "You deleted a memory",
  rail_edited: "You edited a rail",
  rail_revoked: "You revoked a rail",
  rail_restored: "You restored a rail",
  preset_changed: "Preset changed",
  shadow_mode_on: "Shadow mode on",
  shadow_mode_off: "Shadow mode off",
  pax_paused: "Pax paused (stand-down)",
  pax_resumed: "Pax resumed",
  pax_controls_changed: "Pax controls changed",
};

/** The memory categories the package names (§1). */
export const PAX_MEMORY_CATEGORIES = [
  "buy_box",
  "portfolio",
  "counterparty",
  "document",
  "outcome",
  "style",
  "other",
] as const;
export type PaxMemoryCategory = (typeof PAX_MEMORY_CATEGORIES)[number];

/** Words for memory categories. */
export const PAX_MEMORY_CATEGORY_WORDS: Readonly<Record<string, string>> = {
  buy_box: "Buy box",
  portfolio: "Portfolio",
  counterparty: "Counterparty",
  document: "Document",
  outcome: "Outcome",
  style: "Style",
  other: "Other",
};

export const MEMORY_CONTENT_MAX = 2000;
