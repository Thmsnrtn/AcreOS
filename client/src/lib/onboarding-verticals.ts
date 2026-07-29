/**
 * Per-vertical onboarding config — founder ruling #12(b).
 *
 * Single data-driven map that gives every one of the 15 registry verticals
 * (shared/business-types.ts) a TAILORED onboarding: the wizard's data-step
 * copy, the vertical's pipeline vocabulary, and the finishing destination all
 * come from here. The wizard component reads this map instead of forking
 * per-type — add or adjust a vertical by editing ONE entry.
 *
 * Pure data + pure functions only (no React, no DOM) so the wizard logic is
 * unit-testable under vitest's node environment (tests/unit/
 * onboardingVerticals.test.ts pins: all 15 ids covered, every finish path is
 * a real registered route, prefill never silently flips a vertical back to
 * the land_flipper default).
 */
import {
  isBusinessType,
  type BusinessType,
  type NoteRole,
} from "@shared/models/persona-mapping";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface VerticalFinish {
  /** Destination route — must be a real registered route in App.tsx. */
  path: string;
  /** Primary CTA label on the finish screen. */
  cta: string;
  /** Finishing copy, in the vertical's own language. */
  blurb: string;
}

export interface VerticalOnboardingCopy {
  /** What this vertical calls its pipeline items — used in step copy. */
  noun: string;
  /** Data-step heading: [plain half, italic half] (house type treatment). */
  dataTitle: [string, string];
  /** Data-step subcopy in the vertical's language. */
  dataSub: string;
  finish: VerticalFinish;
}

// ---------------------------------------------------------------------------
// The 15-entry map. Keys are the canonical registry ids.
// Finish destinations verified against App.tsx routes (test-pinned).
// ---------------------------------------------------------------------------

export const VERTICAL_ONBOARDING: Record<BusinessType, VerticalOnboardingCopy> = {
  land_flipper: {
    noun: "seller leads",
    dataTitle: ["See AcreOS", "in action."],
    dataSub:
      "Pax can load 50 realistic seller leads right now so Today shows you exactly what the product does — Decision Queue, Morning Brief, Cash Strip, all live. Wipe them whenever you're ready.",
    finish: {
      path: "/maps",
      cta: "Make your first offer →",
      blurb:
        "Open a parcel on the Map, get a recommended blind offer, and hand it to Pax to draft — your first offer can be out the door in minutes.",
    },
  },
  note_investor: {
    noun: "notes",
    dataTitle: ["Bring in", "your portfolio."],
    dataSub:
      "Your job is yield on paper you own. Import the notes you've acquired — payer, balance, rate, and payment — or load sample data first to see the book come alive.",
    finish: {
      path: "/money",
      cta: "Open your note book →",
      blurb:
        "The Finance door's Notes tab is your book: balances, payment schedules, dunning, and portfolio health in one place.",
    },
  },
  hybrid: {
    noun: "leads and notes",
    dataTitle: ["Two books,", "one workspace."],
    dataSub:
      "You run land and paper side by side. Pax can load realistic sample leads so Today shows both books working — land pipeline and note payments together.",
    finish: {
      path: "/today",
      cta: "Open Today →",
      blurb:
        "Today is where both books meet each morning — land deals in the queue, note payments on the Cash Strip.",
    },
  },
  residential_wholesaler: {
    noun: "seller leads",
    dataTitle: ["Fill the top of", "your funnel."],
    dataSub:
      "Your job is contracts assigned to cash buyers. Load sample seller leads to see the pipeline work — intake, contract, buyer blast, assignment — or import your own list.",
    finish: {
      path: "/deals",
      cta: "Open your deal pipeline →",
      blurb:
        "The Deals door runs your assignment pipeline — contract to buyer blast to assignment fee, with earnest money and state rules a click away.",
    },
  },
  fix_and_flip: {
    noun: "projects",
    dataTitle: ["Set up your", "flip pipeline."],
    dataSub:
      "Load sample data to see the deal pipeline and rehab tracking in motion, or import your own leads. Heads up: residential comps run through your connected ATTOM key — the vertical is in beta.",
    finish: {
      path: "/rehabs",
      cta: "Open your rehab board →",
      blurb:
        "The rehab board tracks each project from acquisition through milestones to listing-ready — budgets, contractors, and draws in one place.",
    },
  },
  buy_and_hold: {
    noun: "rentals",
    dataTitle: ["Set up your", "rental book."],
    dataSub:
      "Your job is doors that pay every month. Load sample data to see the workspace live, then bring in your rent roll — tenants, leases, and charges import together.",
    finish: {
      path: "/rent-roll",
      cta: "Open your rent roll →",
      blurb:
        "The rent roll is home base: every door, every lease, every charge — with maintenance and renewals tracked alongside.",
    },
  },
  short_term_rental: {
    noun: "rentals",
    dataTitle: ["Set up your", "property book."],
    dataSub:
      "Load sample data to see the workspace live, then bring in your properties. Honest note: AcreOS models term leases today — nightly-booking sync (Airbnb/VRBO) isn't built yet.",
    finish: {
      path: "/rent-roll",
      cta: "Open your rentals →",
      blurb:
        "The Rentals stack covers your properties, mid-term stays on the ledger, and maintenance dispatch — channel-manager sync is on the roadmap.",
    },
  },
  multifamily: {
    noun: "units",
    dataTitle: ["Set up your", "unit book."],
    dataSub:
      "Your job is occupied units and on-time rent. Load sample data to see the workspace live, then bring in your rent roll — leases carry per-unit labels and renewal countdowns.",
    finish: {
      path: "/rent-roll",
      cta: "Open your rent roll →",
      blurb:
        "The rent roll tracks every unit's lease, rent, and renewal — with maintenance triage and unit-turn checklists built in.",
    },
  },
  mobile_home: {
    noun: "lot leases",
    dataTitle: ["Set up your", "park book."],
    dataSub:
      "Your job is lot rent, every month, every pad. Load sample data to see the workspace live, then bring in your lot leases — rent ledger, renewals, and park maintenance together.",
    finish: {
      path: "/rent-roll",
      cta: "Open your rent roll →",
      blurb:
        "The rent roll runs your lot leases — rent receipts, renewal countdowns, and maintenance dispatch for park infrastructure.",
    },
  },
  commercial: {
    noun: "leases",
    dataTitle: ["Set up your", "lease book."],
    dataSub:
      "Your job is signed leases and collected base rent. Load sample data to see the workspace live, then bring in your leases. Honest note: CAM/NNN pass-throughs aren't modeled yet.",
    finish: {
      path: "/leases",
      cta: "Open your leases →",
      blurb:
        "The lease book tracks terms, base-rent charges, expirations, and maintenance — the core commercial loop, with CAM/NNN on the roadmap.",
    },
  },
  creative_finance: {
    noun: "deals",
    dataTitle: ["Set up your", "carry pipeline."],
    dataSub:
      "Your job is deals that become paper — subject-to, wraps, lease-options. Load sample data to see a seller-financed deal flow from close to carried note, or import your own leads.",
    finish: {
      path: "/money",
      cta: "Open your carried-note book →",
      blurb:
        "Close & Carry turns a closed seller-finance deal into a serviced note with no re-keying — your carried book lives behind the Finance door, with the Dodd-Frank checker alongside.",
    },
  },
  developer: {
    noun: "projects",
    dataTitle: ["Set up your", "project pipeline."],
    dataSub:
      "Your job is entitled dirt. Load sample data to see the workspace live, then track permits, county timelines, and lot pricing per project.",
    finish: {
      path: "/permits",
      cta: "Open permits & timelines →",
      blurb:
        "Permits and county timelines are your critical path — track each submission, milestone, and recording date per project.",
    },
  },
  subdivider: {
    noun: "parcels",
    dataTitle: ["Find your", "parent parcel."],
    dataSub:
      "Your job is acreage split into lots that sell. Load sample data to see the workspace live — then the real work starts on the Map: find the parent parcel worth splitting.",
    finish: {
      path: "/maps",
      cta: "Find a parent parcel →",
      blurb:
        "Start on the Map: find acreage worth splitting, then run the split from the parcel's Subdivision tab — plats, phases, and lot pricing follow.",
    },
  },
  tax_lien_deed: {
    noun: "certificates",
    dataTitle: ["Set up your", "certificate book."],
    dataSub:
      "Your job is certificates bought right and redemptions tracked to the day. Load sample data to see the workspace live, then bring in your certificates — every redemption window on one clock.",
    finish: {
      path: "/redemption-clock",
      cta: "Open the redemption clock →",
      blurb:
        "The redemption clock tracks every certificate's window — auction worksheets, state rules, and quiet-title next steps are one click away.",
    },
  },
  agent_investor: {
    noun: "leads",
    dataTitle: ["See AcreOS", "in action."],
    dataSub:
      "You run the same sourcing loop for clients and your own book — map to owner to offer. Pax can load 50 realistic seller leads so Today is live from the start.",
    finish: {
      path: "/maps",
      cta: "Make your first offer →",
      blurb:
        "Open a parcel on the Map, get a recommended blind offer, and hand it to Pax to draft — the same loop works for client deals and your own.",
    },
  },
};

// ---------------------------------------------------------------------------
// Note-role data-step overrides — the three note jobs each have a real first
// job that isn't "load 50 leads". Applied ON TOP of the note_investor entry
// when businessType === "note_investor".
// ---------------------------------------------------------------------------

export interface NoteRoleDataOverride {
  dataTitle: [string, string];
  dataSub: string;
  jobLabel: string;
  jobHref: string;
}

export const NOTE_ROLE_DATA_OVERRIDES: Record<NoteRole, NoteRoleDataOverride> = {
  invest: {
    dataTitle: ["Bring in", "your portfolio."],
    dataSub:
      "Your job is yield on paper you own. Import the notes you've acquired — payer, balance, rate, and payment — or load sample data first to see the book come alive.",
    jobLabel: "Import your note portfolio",
    jobHref: "/notes?action=new",
  },
  originate: {
    dataTitle: ["Set up", "origination."],
    dataSub:
      "Your job is creating paper. Set your default rate and term, then turn deals into seller-financed notes — or load sample data first to see the pipeline.",
    jobLabel: "Set origination terms",
    jobHref: "/settings?tab=tax-compliance",
  },
  service: {
    dataTitle: ["Bring in", "your book."],
    dataSub:
      "Your job is servicing notes for others. Import the serviced book and set your fee & escrow handling — or load sample data first to see delinquency and escrow tracking.",
    jobLabel: "Import the serviced book",
    jobHref: "/notes?action=new",
  },
};

// ---------------------------------------------------------------------------
// Pure helpers the wizard consumes
// ---------------------------------------------------------------------------

/** Config for a (possibly unknown) businessType; falls back to land_flipper. */
export function getVerticalOnboarding(
  businessType: string | null | undefined,
): VerticalOnboardingCopy {
  if (isBusinessType(businessType)) {
    return VERTICAL_ONBOARDING[businessType];
  }
  return VERTICAL_ONBOARDING.land_flipper;
}

/**
 * Data-step copy for the current selection: the vertical's own copy, with the
 * note-role override applied for the note vertical. `jobLabel`/`jobHref` are
 * null when the vertical has no dedicated first-job link.
 */
export function getDataStepCopy(
  businessType: string | null | undefined,
  noteRole: NoteRole,
): {
  dataTitle: [string, string];
  dataSub: string;
  jobLabel: string | null;
  jobHref: string | null;
} {
  if (businessType === "note_investor") {
    const o = NOTE_ROLE_DATA_OVERRIDES[noteRole] ?? NOTE_ROLE_DATA_OVERRIDES.invest;
    return {
      dataTitle: o.dataTitle,
      dataSub: o.dataSub,
      jobLabel: o.jobLabel,
      jobHref: o.jobHref,
    };
  }
  const v = getVerticalOnboarding(businessType);
  return { dataTitle: v.dataTitle, dataSub: v.dataSub, jobLabel: null, jobHref: null };
}

const NOTE_ROLES: readonly NoteRole[] = ["invest", "originate", "service"];

export interface WizardPrefill {
  /** Valid stored businessType, or null (= no prefill; wizard keeps its default). */
  businessType: BusinessType | null;
  /** Valid stored noteRole, or null. */
  noteRole: NoteRole | null;
}

/**
 * Prefill for a re-run: reads the org's stored onboardingData (as returned by
 * GET /api/onboarding/status → data). After POST /api/onboarding/reset the
 * server PRESERVES businessType/noteRole, so a re-run starts from the org's
 * CURRENT type. Anything missing or unrecognized yields null — the wizard
 * only applies non-null values, so a re-run can never silently flip the org
 * back to the land_flipper default.
 */
export function resolveWizardPrefill(data: unknown): WizardPrefill {
  const d = (data ?? {}) as Record<string, unknown>;
  const bt = typeof d.businessType === "string" ? d.businessType : null;
  const role = typeof d.noteRole === "string" ? d.noteRole : null;
  return {
    businessType: isBusinessType(bt) ? bt : null,
    noteRole: role && (NOTE_ROLES as readonly string[]).includes(role) ? (role as NoteRole) : null,
  };
}
