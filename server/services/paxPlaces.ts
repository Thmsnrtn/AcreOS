/**
 * Every menu path Pax can cite, in ONE place.
 *
 * WHY. An oracle pass found Pax telling a customer "Settings -> Communications"
 * for the direct-mail return address. That is not a tab: `communications` is a
 * legacy URL hash that `settings.tsx` rewrites to the `notifications` tab, and
 * the section is "Mail Settings" inside it. A second string in `sendPricing.ts`
 * said "Settings -> Mail" for the same place, so Pax's own two answers
 * disagreed. Each string had been typed by hand next to the sentence using it.
 *
 * So the tab labels live here, every sentence that names a Settings place
 * builds it from `settingsPlace()` / `PLACE_TEXT`, and
 * `tests/unit/paxProductFactsArePlaces.test.ts` pins each tab, section marker
 * and Finance tab to the real client files (and fails if a Pax-facing server
 * file types `Settings ->` by hand again).
 */
import { PAX_SETTINGS_COPY } from "@shared/pax-glossary";

/** `value` of each Settings tab -> the label the customer sees. */
export const SETTINGS_TAB_LABELS = {
  account: "Account",
  security: "Security",
  organization: "Organization",
  billing: "Billing",
  "tax-compliance": "Tax & Compliance",
  notifications: "Notifications",
  integrations: PAX_SETTINGS_COPY.bucketLabel,
} as const;
export type SettingsTab = keyof typeof SETTINGS_TAB_LABELS;

/** The Finance door's tabs (client/src/pages/money.tsx). */
const FINANCE_TAB_LABELS = {
  notes: "Notes",
  portfolio: "Portfolio",
  optimizer: "Optimizer",
  forecast: "Forecast",
} as const;
export type FinanceTab = keyof typeof FINANCE_TAB_LABELS;

const ARROW = " → ";

/** "Settings -> <Tab label>[ -> <section>...]" */
function settingsPlace(tab: SettingsTab, ...sections: string[]): string {
  return ["Settings", SETTINGS_TAB_LABELS[tab], ...sections].join(ARROW);
}

function financePlace(tab: FinanceTab, ...sections: string[]): string {
  return ["Finance", FINANCE_TAB_LABELS[tab], ...sections].join(ARROW);
}

/** A source marker the test must find in a client file (inside `tab`'s content for settings.tsx). */
export interface PlaceEvidence {
  file: string;
  marker: string;
  withinSettingsTab?: SettingsTab;
}

export interface SettingsSection {
  tab: SettingsTab;
  /** The visible section / control name, as the page prints it. */
  section: string;
  evidence: PlaceEvidence[];
}

const SETTINGS_PAGE = "client/src/pages/settings.tsx";

/** Named sections inside Settings. `evidence` pins each to the page that renders it. */
const SETTINGS_SECTIONS = {
  returnAddress: {
    tab: "notifications",
    section: "Mail Settings",
    evidence: [{ file: SETTINGS_PAGE, marker: "Mail Settings", withinSettingsTab: "notifications" }],
  },
  emailIdentity: {
    tab: "notifications",
    section: "Email Settings",
    evidence: [{ file: SETTINGS_PAGE, marker: "Email Settings", withinSettingsTab: "notifications" }],
  },
  creditsAndUsage: {
    tab: "account",
    section: "Usage & Credits",
    evidence: [{ file: SETTINGS_PAGE, marker: "Usage &amp; Credits", withinSettingsTab: "account" }],
  },
  invite: {
    tab: "organization",
    section: "Invite team members",
    evidence: [
      { file: SETTINGS_PAGE, marker: "<TeamInviteCard />", withinSettingsTab: "organization" },
      { file: "client/src/components/settings/TeamInviteCard.tsx", marker: "Invite team members" },
    ],
  },
  cancel: {
    tab: "account",
    section: "Cancel",
    evidence: [
      { file: SETTINGS_PAGE, marker: 'aria-label="Cancel subscription"', withinSettingsTab: "account" },
      { file: "client/src/lib/labels.ts", marker: 'CANCEL: "Cancel"' },
    ],
  },
  plans: {
    tab: "billing",
    section: "Available Plans",
    evidence: [{ file: SETTINGS_PAGE, marker: "Available Plans", withinSettingsTab: "billing" }],
  },
  importExport: {
    tab: "tax-compliance",
    section: "Import / Export Data",
    evidence: [
      { file: SETTINGS_PAGE, marker: "<ImportExportManager />", withinSettingsTab: "tax-compliance" },
      { file: "client/src/components/import-export.tsx", marker: "Import / Export Data" },
    ],
  },
  byok: {
    tab: "integrations",
    section: PAX_SETTINGS_COPY.byokOpen,
    evidence: [
      { file: SETTINGS_PAGE, marker: 'href="/settings/byok"', withinSettingsTab: "integrations" },
      { file: SETTINGS_PAGE, marker: "PAX_SETTINGS_COPY.byokOpen", withinSettingsTab: "integrations" },
    ],
  },
} as const satisfies Record<string, SettingsSection>;
export type SettingsSectionKey = keyof typeof SETTINGS_SECTIONS;

function sectionPlace(key: SettingsSectionKey): string {
  const s: SettingsSection = SETTINGS_SECTIONS[key];
  return settingsPlace(s.tab, s.section);
}

/** Finance-door places. */
const FINANCE_PLACES = {
  recordPayment: {
    tab: "notes",
    control: "Record payment",
    evidence: [
      { file: "client/src/pages/money.tsx", marker: '<TabsTrigger value="notes"' },
      { file: "client/src/pages/finance.tsx", marker: 'data-testid="button-record-payment"' },
      { file: "client/src/pages/finance.tsx", marker: "Record payment" },
    ],
  },
} as const satisfies Record<string, { tab: FinanceTab; control: string; evidence: PlaceEvidence[] }>;

/** Other places inside a door that Pax names. */
export const OTHER_PLACES = {
  acquiredNotePayment: {
    text: "open the note from your Notes list (/notes/<id>), then Payment ledger \u2192 Record payment",
    evidence: [
      { file: "client/src/App.tsx", marker: '<Route path="/notes/:id">' },
      { file: "client/src/pages/note-detail.tsx", marker: 'data-testid="record-payment-button"' },
      { file: "client/src/pages/note-detail.tsx", marker: "Payment ledger" },
    ],
  },
  sequences: {
    text: "Deals \u2192 Outreach (/campaigns) \u2192 Sequences tab",
    evidence: [
      { file: "client/src/pages/campaigns.tsx", marker: 'value="sequences"' },
      { file: "client/src/pages/campaigns.tsx", marker: "Sequences\n" },
      { file: "client/src/components/sequences-content.tsx", marker: 'data-testid="select-enrollment-trigger"' },
    ],
  },
} as const satisfies Record<string, { text: string; evidence: PlaceEvidence[] }>;

function recordPaymentPlace(): string {
  return financePlace(FINANCE_PLACES.recordPayment.tab, "open the note", FINANCE_PLACES.recordPayment.control);
}

/** Every Pax-facing sentence fragment that names a place, keyed for the test. */
export const PLACE_TEXT = {
  returnAddress: sectionPlace("returnAddress"),
  creditsAndUsage: sectionPlace("creditsAndUsage"),
  invite: sectionPlace("invite"),
  cancel: sectionPlace("cancel"),
  plans: sectionPlace("plans"),
  importExport: sectionPlace("importExport"),
  byok: sectionPlace("byok"),
  teamRoles: settingsPlace("organization"),
  recordPayment: recordPaymentPlace(),
} as const;

/**
 * The directory of every named place: tabs, sections (with the visible text
 * and the source markers that pin each to the client), and the Finance
 * payment control. Pax's navigation facts list `places` from it; the places
 * test reads `evidence` from it.
 */
export function placeDirectory() {
  return {
    settingsTabs: SETTINGS_TAB_LABELS,
    financeTabs: FINANCE_TAB_LABELS,
    sections: Object.fromEntries(
      (Object.keys(SETTINGS_SECTIONS) as SettingsSectionKey[]).map((k) => [
        k,
        { place: sectionPlace(k), section: SETTINGS_SECTIONS[k].section, evidence: SETTINGS_SECTIONS[k].evidence as readonly PlaceEvidence[] },
      ]),
    ),
    finance: {
      recordPayment: { place: recordPaymentPlace(), evidence: FINANCE_PLACES.recordPayment.evidence as readonly PlaceEvidence[] },
    },
  };
}
