/**
 * Help-centre copy — the feature guides and FAQ items for /help.
 *
 * This module is the SOURCE OF TRUTH for the copy, but it is not part of
 * the client bundle: the HelpContent component loads the same data as a
 * static asset (/help-content.json, generated verbatim from these arrays)
 * so the strings ship as data, not JS (the BD-6 / legal-docs pattern).
 * tests/unit/staticDataServedAsData.test.ts pins the served asset
 * deep-equal to these arrays — edit here, regenerate the asset, and the
 * pin keeps the two from drifting.
 *
 * Two kinds of value stay OUT of the data on purpose:
 *  - Icons are lucide component NAMES; the component maps each name back
 *    to the component it imported before this extraction.
 *  - Strings that interpolate the Pax glossary's single-source constants
 *    carry {{TOKEN}} placeholders instead of baked values; the component
 *    substitutes them at render time from @shared/pax-glossary-core, so
 *    the one-edit Pax copy flip still propagates (same discipline as the
 *    legal-doc assets).
 */

export interface HelpFeatureGuide {
  /** Lucide icon component name, e.g. "Users". */
  icon: string;
  title: string;
  description: string;
  details: string[];
}

export interface HelpFaqItem {
  question: string;
  answer: string;
}

export const HELP_FEATURE_GUIDES: HelpFeatureGuide[] = [
  {
    icon: "Users",
    title: "Leads & CRM",
    description: "Manage your seller and buyer leads with a full-featured CRM system.",
    details: [
      "Import leads from various sources or add them manually",
      "Track lead status through customizable pipelines",
      "Store contact information, notes, and communication history",
      "Set follow-up reminders and automate outreach",
      "Filter and search leads by location, status, or custom fields"
    ]
  },
  {
    icon: "Map",
    title: "Properties & Inventory",
    description: "Track all properties in your pipeline from acquisition to sale.",
    details: [
      "Add properties with parcel data, acreage, and location details",
      "Attach documents, photos, and due diligence materials",
      "Track property status (researching, under contract, owned, listed, sold)",
      "View properties on an interactive map",
      "Calculate comps and market values"
    ]
  },
  {
    icon: "GitBranch",
    title: "Deals Pipeline",
    description: "Visualize and manage deals from initial offer to closing.",
    details: [
      "Kanban-style deal pipeline with customizable stages",
      "Track offer amounts, counter-offers, and negotiations",
      "Set closing dates and track contract deadlines",
      "Associate deals with leads and properties",
      "Calculate profit margins and ROI projections"
    ]
  },
  {
    icon: "Mail",
    title: "Campaigns (Email, SMS, Direct Mail)",
    description: "Run multi-channel marketing campaigns to reach motivated sellers.",
    details: [
      "Create email campaigns with templates and personalization",
      "Send SMS messages to leads with opt-in/opt-out management",
      "Launch direct mail campaigns with automated letter printing",
      "Set a planned send date as a reminder, then send when you're ready (campaigns are not sent automatically)",
      "Track open rates, responses, and conversions"
    ]
  },
  {
    icon: "Banknote",
    title: "Finance & Notes",
    description: "Manage seller financing and track note performance.",
    details: [
      "Create and track seller finance notes",
      "Set up payment schedules and amortization",
      "Monitor payment status and send reminders",
      "Generate borrower portals for online payments",
      "Track portfolio performance and cash flow"
    ]
  },
  {
    icon: "Bot",
    title: "Pax",
    description: "{{PAX_STANDING_LINE}}",
    details: [
      "Ask about your leads, properties, deals or notes — Pax answers from your own records",
      "Ask it to update a record — a lead's status, a task, a deal, a calendar event — and it does, leaving a receipt",
      "Ask for a draft — an email, a text, an offer letter — and it writes one for you to read",
      "Turn on rules that run by themselves: workflows, campaign sequences, scheduled prompts, lead scoring",
      "One button under {{PAX_CONTROLS_LABEL}} pauses everything that runs on its own"
    ]
  }
];

export const HELP_FAQ_ITEMS: HelpFaqItem[] = [
  {
    question: "How do I get started with AcreOS?",
    answer: "After signing up, complete the onboarding wizard to configure your organization. Start by importing or adding your first leads, then explore the different modules like Properties, Deals, and Campaigns. The Dashboard provides a quick overview of your entire operation."
  },
  {
    question: "What's the difference between Platform and Custom credentials?",
    answer: "Custom credentials are your own SendGrid, AWS SES, Twilio or Lob accounts, connected under Settings → Your provider keys: mail goes out from your domain and your numbers, and you pay the provider directly. Platform credentials are AcreOS's shared SMS and direct-mail rails, billed to you in credits. Email to a seller or buyer is the exception — it only sends from an email identity you have connected. AcreOS's own address is used for mail to you, like receipts and trial notices."
  },
  {
    question: "How does the credit system work?",
    answer: "AcreOS uses a credit-based system for billable actions like sending emails, SMS messages, and direct mail. Credits are deducted based on the action type. You can view pricing in Settings and purchase additional credits as needed. Your subscription tier may include monthly credit allowances."
  },
  {
    question: "Can I import existing leads?",
    answer: "Yes! AcreOS supports bulk lead import via CSV files. Navigate to the Leads page and use the Import feature. You can map your CSV columns to AcreOS fields and even deduplicate leads during import."
  },
  {
    question: "How does Pax work?",
    answer:
      "{{PAX_MENTAL_MODEL}} The chat and the queue are behind the Pax door in the sidebar. The switches, the receipts and the pause button are under {{PAX_CONTROLS_LABEL}}. Most plans include a set number of Pax messages each month; connect your own AI key under Settings \u2192 Your provider keys to chat past it."
  },
  {
    question: "Can Pax email or text someone without me?",
    answer:
      "No. {{PAX_FIXED_RULE}} Pax writes the message and puts it in \"{{PAX_QUEUE}}\" on the Pax page, with what it wrote and why. You approve it, edit it, or reject it \u2014 nothing leaves until you do. Drips and campaign sequences you switched on are the exception: those go out on the schedule you set, and each one has its own switch."
  },
  {
    question: "How do I stop Pax?",
    answer:
      "Open {{PAX_CONTROLS_LABEL}} and tap Pause, then choose how long. That stops the things that run without you \u2014 workflows, campaign sequences, scheduled prompts, lead scoring, borrower reminder prep. {{PAX_PAUSE_STILL_WORKS}} The same page lists each of them separately, so you can switch off one thing instead of all of it."
  },
  {
    question: "Is my data secure?",
    answer: "Yes. AcreOS uses industry-standard encryption for data at rest and in transit. Your data is isolated per organization, and we follow security best practices. You can also connect your own API keys instead of using platform credentials for added control."
  },
  {
    question: "How do I track deal profitability?",
    answer: "Use the Deals Pipeline to track acquisition costs, selling price, and associated expenses. The deal calculator helps you analyze potential profit margins before making offers. Finance module tracks ongoing returns from seller-financed notes."
  },
  {
    question: "Can multiple team members use AcreOS?",
    answer: "Yes, AcreOS supports team collaboration. Organization members can access shared leads, properties, and deals. Different subscription tiers include varying numbers of team seats. Contact support to add team members."
  }
];
