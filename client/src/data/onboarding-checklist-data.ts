/**
 * Getting-started checklist copy DATA — the per-vertical step rows.
 *
 * Source of truth for the checklist's copy: every vertical's step rows
 * ({base, title, description, optional href/iconKey overrides}) plus the
 * connect-services nudge copy. This module is NOT bundled by the client:
 * the checklist component (client/src/components/getting-started-checklist.tsx)
 * loads the same data as the served asset /onboarding-checklist.json
 * through the shared static-data loader, and the factory + selectors in
 * client/src/lib/onboarding-checklist.ts rehydrate the rows into full
 * ChecklistItemDefs (the BD-6 / diet pattern; tests/unit/
 * staticDataServedAsData.test.ts pins the asset deep-equal to this
 * module, so the two cannot drift). Tests import this module
 * synchronously; client code must not value-import it (type-only
 * imports are erased and fine).
 *
 * The `base` of each row names a step in the lib's STEP_BASE registry,
 * which binds the row to its honest completion signal + Lucide icon +
 * default door IN CODE — signals and icons never travel in the data.
 * An `iconKey` override names an entry in the lib's row-icon map (the
 * landlord family's Building2), likewise resolved in code.
 *
 * Regenerate the asset after editing:
 *   npx tsx -e 'import {ONBOARDING_CHECKLIST_DATA} from "./client/src/data/onboarding-checklist-data"; import fs from "node:fs"; fs.writeFileSync("client/public/onboarding-checklist.json", JSON.stringify(ONBOARDING_CHECKLIST_DATA, null, 2)+"\n")'
 */
import type { BusinessTypeId } from "@shared/business-types";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

/** A step base in the lib's STEP_BASE registry (signal/icon/door live there). */
export type ChecklistStepBaseId =
  | "propertyLookup"
  | "lead"
  | "import"
  | "campaign"
  | "deal"
  | "notePayment";

/** One checklist step as DATA: copy + optional door/icon overrides only. */
export interface ChecklistStepRow {
  base: ChecklistStepBaseId;
  title: string;
  description: string;
  /** Door override (the base's default href otherwise). */
  href?: string;
  /** Icon override key into the lib's row-icon map (the base's icon otherwise). */
  iconKey?: string;
}

export interface OnboardingChecklistData {
  /** The optional connect-services nudge copy (its wiring stays in code). */
  connectServices: { title: string; description: string };
  /** Per-vertical step rows, in display order, for all 15 business types. */
  checklists: Record<BusinessTypeId, ChecklistStepRow[]>;
}

// ---------------------------------------------------------------------------
// Shared copy fragments (verbatim from the pre-extraction config)
// ---------------------------------------------------------------------------

const PARCEL_AHA_DESCRIPTION =
  "Open a parcel on the map — soils, flood, wetlands & elevation light up from free public data";

// The landlord family (buy_and_hold / short_term_rental / multifamily /
// mobile_home — all "landlord" in persona-mapping.ts) shares one loop with
// per-type nouns. hasPropertyLookup completes on a real property row, so
// "add your first X" is honest for it.
function landlordRows(noun: string, addDescription: string): ChecklistStepRow[] {
  return [
    {
      base: "propertyLookup",
      title: `Add your first ${noun}`,
      description: addDescription,
      href: "/properties",
      iconKey: "building2",
    },
    {
      base: "lead",
      title: "Add your first seller lead",
      description:
        "Your next acquisition starts as a lead — import a list or paste an address",
    },
    {
      base: "deal",
      title: "Track your first acquisition",
      description: "Move a lead into Deals and follow it from offer to close",
    },
  ];
}

// ---------------------------------------------------------------------------
// The data: all 15 business types
// ---------------------------------------------------------------------------

export const ONBOARDING_CHECKLIST_DATA: OnboardingChecklistData = {
  connectServices: {
    title: "Connect your services (optional)",
    description:
      "Bring your own Twilio, SendGrid, Lob, or data accounts — your keys, your invoices. Or keep running on ours.",
  },
  checklists: {
    land_flipper: [
      { base: "propertyLookup", title: "Look up your first parcel", description: PARCEL_AHA_DESCRIPTION },
      {
        base: "import",
        // Was "Pull your first county list": nothing pulls one — the task is a
        // CSV import (quality directive 2026-09-29; readiness plan item 0.7).
        title: "Import your county list",
        description:
          "Import a CSV of owners from your target county — your acquisition pipeline starts here",
      },
      {
        base: "campaign",
        title: "Send your first mailer",
        description: "Pick a template, target your list, watch responses land",
      },
      {
        base: "deal",
        title: "Track your first deal",
        description: "Move a lead to deal and see the offer/close pipeline light up",
      },
    ],
    note_investor: [
      {
        base: "import",
        title: "Import your note portfolio",
        description:
          "Upload your existing notes — amortization schedules render automatically",
        href: "/finance",
      },
      {
        base: "notePayment",
        title: "Record your first payment",
        description: "Log a P&I payment and see the schedule update to the cent",
      },
      {
        base: "deal",
        title: "Track a note buy or sell",
        description: "Move a note acquisition or disposition through your pipeline",
      },
    ],
    hybrid: [
      { base: "propertyLookup", title: "Look up your first property", description: PARCEL_AHA_DESCRIPTION },
      {
        base: "lead",
        title: "Add your first lead or note",
        description:
          "Import a CSV — leads, notes, or both. Same pipeline, different surfaces",
      },
      {
        base: "campaign",
        title: "Send your first outreach",
        description: "Mailer for sellers, or direct outreach to note holders",
      },
      {
        base: "notePayment",
        title: "Record your first note payment",
        description: "Log a P&I payment and see the schedule update to the cent",
      },
    ],
    residential_wholesaler: [
      {
        base: "lead",
        title: "Add your first seller lead",
        description:
          "Import a motivated-seller list or paste an address — your assignment pipeline starts here",
      },
      {
        base: "campaign",
        title: "Launch your first outreach campaign",
        description:
          "Reach sellers by mail — responses land as leads you can put under contract",
      },
      {
        base: "deal",
        title: "Get your first contract into the pipeline",
        description:
          "Move a signed contract into Deals — buyer blasts and assignment tracking light up",
      },
    ],
    fix_and_flip: [
      {
        base: "lead",
        title: "Add your first property lead",
        description:
          "Import a distressed-property list or paste an address — your flip pipeline starts here",
      },
      {
        base: "campaign",
        title: "Send your first off-market mailer",
        description: "Reach owners before the MLS does — pick a template, target your list",
      },
      {
        base: "deal",
        title: "Track your first flip",
        description:
          "Move a lead into Deals and follow it from offer through rehab to resale",
      },
    ],
    buy_and_hold: landlordRows(
      "rental property",
      "Add a property (or look one up on the map) — your portfolio starts here",
    ),
    short_term_rental: landlordRows(
      "rental",
      "Add a property (or look one up on the map) — your portfolio starts here",
    ),
    multifamily: landlordRows(
      "building",
      "Add a building (or look one up on the map) — your unit portfolio starts here",
    ),
    mobile_home: landlordRows(
      "park or home",
      "Add a park or home (or look one up on the map) — your portfolio starts here",
    ),
    commercial: [
      { base: "propertyLookup", title: "Look up your first parcel", description: PARCEL_AHA_DESCRIPTION },
      {
        base: "lead",
        title: "Add your first owner lead",
        description:
          "Import an owner list or paste an address — your acquisition pipeline starts here",
      },
      {
        base: "deal",
        title: "Track your first acquisition",
        description: "Move a lead into Deals and follow it from LOI to close",
      },
    ],
    creative_finance: [
      {
        base: "lead",
        title: "Add your first seller lead",
        description:
          "Subject-to and owner-carry candidates enter here — import a list or paste an address",
      },
      {
        base: "deal",
        title: "Move your first creative deal",
        description:
          "Track a subject-to or wrap through the pipeline — Close & Carry turns it into a serviced note",
      },
      {
        base: "notePayment",
        title: "Record a payment on your carried note",
        description:
          "Log a P&I payment and see the amortization schedule update to the cent",
      },
    ],
    developer: [
      {
        base: "propertyLookup",
        title: "Look up your first parent parcel",
        description:
          "Soils, flood, wetlands & elevation from free public data — the build decision starts here",
      },
      {
        base: "lead",
        title: "Add your first landowner lead",
        description: "Import a list or paste an address — your land pipeline starts here",
      },
      {
        base: "deal",
        title: "Track your first acquisition",
        description: "Move a parent parcel into Deals — permits, timelines and lot pricing follow",
      },
    ],
    subdivider: [
      {
        base: "propertyLookup",
        title: "Look up your first parent parcel",
        description:
          "Soils, flood, wetlands & elevation from free public data — the split decision starts here",
      },
      {
        base: "lead",
        title: "Add your first landowner lead",
        description:
          "Import a list or paste an address — your parent-parcel pipeline starts here",
      },
      {
        base: "deal",
        title: "Track your first acquisition",
        description: "Move a parent parcel into Deals — plats, permits and lot pricing follow",
      },
    ],
    tax_lien_deed: [
      {
        base: "import",
        title: "Import your first certificate list",
        description:
          "Upload the county's delinquent roll as a CSV — every certificate becomes a trackable lead",
      },
      {
        base: "propertyLookup",
        title: "Look up a delinquent parcel",
        description:
          "Open it on the map — soils, flood, wetlands & elevation from free public data",
      },
      {
        base: "deal",
        title: "Track a certificate to deed",
        description:
          "Move a certificate into Deals — the redemption clock and foreclosure timeline follow",
      },
    ],
    agent_investor: [
      { base: "propertyLookup", title: "Look up your first parcel", description: PARCEL_AHA_DESCRIPTION },
      {
        base: "lead",
        title: "Add your first seller lead",
        description:
          "Import a list or paste an address — own book or client sourcing, same pipeline",
      },
      {
        base: "deal",
        title: "Track your first deal",
        description: "Move a lead into Deals and follow it from offer to close",
      },
    ],
  },
};
