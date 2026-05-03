/**
 * Verb canon — the single source of truth for action verbs across the AcreOS UI.
 *
 * Why this file exists:
 *   - Buttons, menu items, command-palette actions, toasts and aria-labels keep
 *     drifting apart ("Edit Lead" vs "Edit lead" vs "Update Lead" vs "Modify").
 *   - Land-investor framing demands consistent, plain-English verbs.
 *   - Centralizing makes localization, persona vocabulary, and tone audits trivial.
 *
 * Convention:
 *   - Sentence case ("Add lead", not "Add Lead").
 *   - Imperative voice ("Send letter", not "Sending letter…").
 *   - No trailing punctuation, no ellipses (callers add their own).
 *   - Object-specific verbs win over generic ones — prefer `Verbs.LEAD_EDIT`
 *     over `Verbs.EDIT` when the object is known.
 *
 * Usage:
 *   import { Verbs } from "@/lib/labels";
 *   <Button>{Verbs.LEAD_CREATE}</Button>
 *
 * Contributors: when adding a new button/action label, add a constant here
 * first. Reviewers: please reject inline string literals for any verb that
 * already has a canonical entry (or could justify one).
 */
export const Verbs = {
  // Lead lifecycle
  LEAD_CREATE: "Add lead",
  LEAD_EDIT: "Edit lead",
  LEAD_ARCHIVE: "Archive",
  LEAD_DELETE: "Delete",
  LEAD_CONTACT: "Mark contacted",
  LEAD_QUALIFY: "Qualify",
  LEAD_DISMISS: "Dismiss",
  LEAD_ASSIGN: "Assign",

  // Property lifecycle
  PROPERTY_CREATE: "Add property",
  PROPERTY_EDIT: "Edit property",
  PROPERTY_DELETE: "Delete",
  PROPERTY_RUN_AVM: "Run valuation",
  PROPERTY_FLAG_DD: "Mark for due diligence",

  // Deal lifecycle
  DEAL_CREATE: "New deal",
  DEAL_ADVANCE: "Advance stage",
  DEAL_CLOSE_WON: "Close won",
  DEAL_CLOSE_LOST: "Close lost",
  DEAL_REOPEN: "Reopen",

  // Communication
  SEND_LETTER: "Send letter",
  SEND_SMS: "Send text",
  SEND_EMAIL: "Send email",
  CALL: "Call",

  // Generic
  SAVE: "Save",
  CANCEL: "Cancel",
  CONFIRM: "Confirm",
  DELETE: "Delete",
  EDIT: "Edit",
  CREATE: "Create",
  SUBMIT: "Submit",
  ENABLE: "Enable",
  DISABLE: "Disable",
  RETRY: "Retry",
  EXPORT: "Export",
  IMPORT: "Import",
  COPY: "Copy",
  SHARE: "Share",
  ARCHIVE: "Archive",
  RESTORE: "Restore",
} as const;

export type VerbKey = keyof typeof Verbs;
export type VerbValue = (typeof Verbs)[VerbKey];
