/**
 * Customer-facing changelog entries.
 *
 * This is the *curated* changelog — written for Land Investors using
 * AcreOS, not engineers reviewing diffs. The dev CHANGELOG.md is too
 * noisy for this surface (ticket IDs, file paths, regex counts) and
 * sometimes leaks security-fix detail we don't want to publicize.
 *
 * Editorial rules:
 *   - Phrase changes around the user benefit, not the implementation.
 *   - Group multiple commits into one user-visible bullet when possible.
 *   - Never list specific security vulnerabilities by name —
 *     bundle them as "Security and reliability improvements."
 *   - Reverse-chronological. Newest entry on top.
 *   - `version` is informational; the date is the canonical anchor.
 */

export type ChangelogEntryType = "added" | "improved" | "fixed";

export interface ChangelogChange {
  type: ChangelogEntryType;
  title: string;
  body: string;
}

export interface CustomerChangelogEntry {
  /** ISO date (YYYY-MM-DD). Drives ordering and the visible header. */
  date: string;
  /** Human version label, e.g. "v6.4". Optional. */
  version?: string;
  changes: ChangelogChange[];
}

export const CUSTOMER_CHANGELOG: CustomerChangelogEntry[] = [
  {
    date: "2026-05-01",
    version: "v6.4",
    changes: [
      {
        type: "added",
        title: "Parcel detail view",
        body:
          "Every parcel now has its own page (/parcels/:id) that pulls overview, due diligence, financial, and cross-links into a single composed surface — no more bouncing between four tabs to evaluate one piece of land.",
      },
      {
        type: "added",
        title: "Page topbar with global search",
        body:
          "A sticky breadcrumb topbar now appears on every authenticated page — including theme toggle, notification bell, and ⌘K command palette access — so navigation context is always one keystroke away.",
      },
      {
        type: "improved",
        title: "Auto-resolve review panel",
        body:
          "When AcreOS finishes a task on your behalf, cascade candidates (related follow-ups it could resolve too) now surface in a dedicated panel so you stay in control of the chain.",
      },
    ],
  },
  {
    date: "2026-04-22",
    version: "v6.3",
    changes: [
      {
        type: "added",
        title: "Founder's monthly letter",
        body:
          "Each month you'll receive a personalized brief from Pax — portfolio delta, what worked, what didn't, and one recommended next move. Visit /my-letter to read the latest issue.",
      },
      {
        type: "improved",
        title: "Founder dashboard tone",
        body:
          "Migrated the founder dashboard to semantic color tokens so the surface adapts cleanly to dark mode, custom palettes, and reseller white-labels without manual restyling.",
      },
    ],
  },
  {
    date: "2026-04-09",
    version: "v6.2",
    changes: [
      {
        type: "added",
        title: "Blind-offer wizard",
        body:
          "Generate offers for an entire county in one sitting. The wizard walks through filters, pricing rules, and personalization — then queues mail, email, and SMS in the right cadence.",
      },
      {
        type: "improved",
        title: "Decisions Inbox for any user",
        body:
          "The autonomous-decision review queue is no longer founder-only. Every authenticated user can now see and approve the decisions AcreOS is queuing on their org's behalf.",
      },
      {
        type: "fixed",
        title: "Onboarding state is org-scoped",
        body:
          "Re-inviting a teammate or re-installing the app no longer shows the new-user wizard — onboarding state is tracked at the organization level, not per user.",
      },
    ],
  },
  {
    date: "2026-03-28",
    version: "v6.1",
    changes: [
      {
        type: "added",
        title: "Direct mail integration",
        body:
          "Trigger postcards and letters directly from a campaign or sequence — no more exporting CSVs to Lob. Track delivery, returned mail, and reply attribution in the same view.",
      },
      {
        type: "improved",
        title: "Faster pipeline rendering",
        body:
          "Large pipelines (1,000+ deals) now load in under a second on first paint thanks to virtualized columns and a slimmer initial query.",
      },
      {
        type: "fixed",
        title: "Security and reliability improvements",
        body:
          "Quiet round of hardening across authentication, session handling, and rate limits. No customer action required.",
      },
    ],
  },
  {
    date: "2026-03-12",
    version: "v6.0",
    changes: [
      {
        type: "added",
        title: "AcreOS v6 — Land Investor positioning",
        body:
          "We re-grounded the product around Land Investors specifically — pricing tiers, copy, dashboards, and onboarding all speak to the actual workflow of acquiring, financing, and selling land at scale.",
      },
      {
        type: "added",
        title: "Native e-signing",
        body:
          "Send purchase agreements, deeds, and financing notes for signature without leaving AcreOS or paying a third-party signing vendor. External signers receive a tokenized link — no account required.",
      },
    ],
  },
  {
    date: "2026-02-26",
    version: "v5.8",
    changes: [
      {
        type: "added",
        title: "Acquisition Radar",
        body:
          "A continuous scan across your active counties surfaces parcels matching your buy-box the moment they appear — with seller-intent scoring so you know which to chase first.",
      },
      {
        type: "improved",
        title: "Pax Copilot rail",
        body:
          "The right-side AI rail can now act on the page you're looking at — open a deal, draft a follow-up email, or run a comp pull without losing context.",
      },
      {
        type: "fixed",
        title: "Security and reliability improvements",
        body:
          "Maintenance pass on outbound webhook signing and provider failover behavior.",
      },
    ],
  },
  {
    date: "2026-02-08",
    version: "v5.7",
    changes: [
      {
        type: "added",
        title: "Portfolio P&L",
        body:
          "A dedicated /portfolio-pnl view rolls up realized and unrealized gains across every parcel and seller-finance note — broken out by county, vintage, and acquisition channel.",
      },
      {
        type: "improved",
        title: "Trial banner clarity",
        body:
          "Trial countdown now shows days remaining, what you'll keep on the free tier, and a one-click upgrade — no surprise lockouts.",
      },
    ],
  },
];
