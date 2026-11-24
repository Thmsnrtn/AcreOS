/**
 * Pax land tool family (Land promised bar item (c)).
 *
 * Land's product spine — the parcel passport (LandProfile), the org's own
 * listings, and the sell-on-terms serviced-note payoff — had no Pax object
 * tools: Pax could only see generic property rows. These tools wrap the SAME
 * service layer the REST routes use:
 *   - passport: `assembleLandProfile` (server/services/landProfile.ts), the
 *     assembler behind GET /api/properties/:id/land-profile, over the
 *     property's recorded enrichment bundle. Pax does NOT run a new lookup:
 *     fields never looked up stay honest gaps, named per field (RW-D
 *     cross-book/coverage honesty — a 3-of-17 answer says which 14 are gaps).
 *   - listings: the `propertyListings` rows the Listings pages read, org-pinned.
 *   - paste text: `buildNormalizedListing` + `listingContentForChannels` +
 *     `syndicateListing(["craigslist"])` — the same Craigslist ready-to-paste
 *     text the publish route produces. Craigslist is manual by design.
 *   - payoff: `deriveServicedNotePayoffInput` + `computePayoffQuote`, the
 *     non-recording operator calculator behind GET /api/notes/:id/payoff
 *     (L9-DEF-1: a numeric id is a SERVICED note). Indicative only — no quote
 *     row is recorded, no payment is taken, no money moves.
 *   - mark-listed: the operator-attestation write of
 *     POST /api/listings/:id/mark-listed (L-DEF-1 Option C): status + the
 *     on-market date only; syndicationTargets are untouched.
 *
 * NOT here, by design (FD5 + the BYO-credentials seam): posting a listing to
 * any portal. Portal channels run on the customer's OWN account and
 * `channelCredentialStore.resolve` answers null for every org today, so no
 * portal is connectable; a tool that implied AcreOS posted would lie. The
 * honest tools are read + paste text + mark-listed on the operator's word.
 * Nothing here sends mail, a message, or an offer.
 *
 * The organization always comes from the session (`orgId`), never from a
 * model-supplied argument.
 */
import { and, asc, eq } from "drizzle-orm";
import { organizations, properties, propertyListings, notes as sellerFinanceNotes } from "@shared/schema";
import { LAND_PROFILE_FIELD_LABELS, LAND_PROFILE_FIELD_ORDER } from "@shared/landProfile";
import { toolRefusal, type RefusalParts } from "@shared/refusal/plainRefusal";
import { clock } from "../utils/clock";

export type LandToolOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; refusal: RefusalParts };

const LIST_CAP = 100;
const LISTING_STATUSES = ["draft", "listed", "active", "pending", "sold", "withdrawn"] as const;

const PASSPORT_NOT_COVERED =
  "It does not include parcels in any other account, tax-sale listings, or a fresh data lookup — Pax reads the passport recorded for this account, and fields that were never looked up are listed as gaps, never filled in.";
const LISTING_NOT_COVERED =
  "It does not include external MLS listings, marketplace listings, or any other account's listings, and AcreOS has not posted any of these anywhere — a channel status below is exactly what is recorded.";

function positiveInt(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

const noProperty = (): LandToolOutcome => ({
  ok: false,
  refusal: {
    what: "No property with that number is in this account",
    why: "It may have been removed, or the number came from another list",
    unlock: "Ask me to list your properties and pick the one you mean",
  },
});

const badPropertyId = (): LandToolOutcome => ({
  ok: false,
  refusal: {
    what: "That is not a property number",
    why: "Property numbers are the whole numbers from your property list, not an APN or an address",
    unlock: "Ask me to list your properties and use the number it shows",
  },
});

const noListing = (): LandToolOutcome => ({
  ok: false,
  refusal: {
    what: "No listing with that number is in this account",
    why: "It may have been removed, or the number came from another list",
    unlock: "Ask me to list your land listings and pick the one you mean",
  },
});

const badListingId = (): LandToolOutcome => ({
  ok: false,
  refusal: {
    what: "That is not a listing number",
    why: "Listing numbers are the whole numbers from your listings list",
    unlock: "Ask me to list your land listings and use the number it shows",
  },
});

async function loadProperty(orgId: number, propertyId: unknown) {
  const id = positiveInt(propertyId);
  if (id === null) return "bad_id" as const;
  const { db } = await import("../db");
  const [row] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, id), eq(properties.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

async function loadListing(orgId: number, listingId: unknown) {
  const id = positiveInt(listingId);
  if (id === null) return "bad_id" as const;
  const { db } = await import("../db");
  const [row] = await db
    .select()
    .from(propertyListings)
    .where(and(eq(propertyListings.id, id), eq(propertyListings.organizationId, orgId)))
    .limit(1);
  return row ?? null;
}

type ListingRow = typeof propertyListings.$inferSelect;

function channelStatusOf(row: ListingRow) {
  return (row.syndicationTargets ?? []).map((t) => ({
    platform: t.platform,
    status: t.status,
    listingUrl: t.listingUrl ?? null,
    postedAt: t.postedAt ?? null,
  }));
}

function shapeListing(row: ListingRow) {
  return {
    id: row.id,
    propertyId: row.propertyId,
    title: row.title,
    askingPrice: row.askingPrice,
    minimumPrice: row.minimumPrice ?? null,
    status: row.status,
    sellerFinancingAvailable: row.sellerFinancingAvailable === true,
    downPaymentMin: row.downPaymentMin ?? null,
    monthlyPaymentMin: row.monthlyPaymentMin ?? null,
    interestRate: row.interestRate ?? null,
    termMonths: row.termMonths ?? null,
    channels: channelStatusOf(row),
    publishedAt: row.publishedAt ?? null,
    createdAt: row.createdAt ?? null,
  };
}

/** The parcel passport (LandProfile) for one property in this account. */
export async function paxGetParcelPassport(orgId: number, propertyId: unknown): Promise<LandToolOutcome> {
  const property = await loadProperty(orgId, propertyId);
  if (property === "bad_id") return badPropertyId();
  if (!property) return noProperty();
  const { assembleLandProfile } = await import("../services/landProfile");
  const cached = property.enrichmentData as
    | (import("../services/propertyEnrichment").EnrichmentResult & { lastEnrichedAt?: string })
    | null
    | undefined;
  // Same cache-first rule as the Land Snapshot route: a recorded bundle
  // assembles the profile; without one the profile is honest all-gaps.
  // Pax never runs a live lookup, so "not looked up" stays a stated gap.
  const hasBundle = !!(cached && (cached.provenance || cached.parcel || cached.hazards));
  const profile = assembleLandProfile(property as never, hasBundle ? cached : null, hasBundle);
  const fields: Record<string, unknown> = {};
  for (const key of LAND_PROFILE_FIELD_ORDER) {
    const f = profile[key];
    if (f) fields[key] = { label: LAND_PROFILE_FIELD_LABELS[key], value: f.value, source: f.source, asOf: f.asOf, confidence: f.confidence, classification: f.classification };
  }
  return {
    ok: true,
    data: {
      coverage:
        `Coverage: the parcel passport for ONE property in THIS account — ${profile.fieldsPopulated} of ${profile.fieldsTotal} fields have a recorded value; ` +
        `the other ${profile.gaps.length} are gaps, listed by name with the reason. State the coverage when you quote any figure from it: a value read here is only as good as its source and date. ` +
        PASSPORT_NOT_COVERED,
      propertyId: property.id,
      apn: property.apn ?? null,
      county: property.county ?? null,
      state: property.state ?? null,
      fieldsPopulated: profile.fieldsPopulated,
      fieldsTotal: profile.fieldsTotal,
      fromCache: profile.fromCache,
      assembledAt: profile.assembledAt,
      fields,
      gaps: profile.gaps.map((g) => ({ field: g.field, label: g.label, reason: g.reason })),
    },
  };
}

/** This account's own land listings, newest first, with channel status. */
export async function paxGetLandListings(orgId: number, args: { status?: string }): Promise<LandToolOutcome> {
  const { db } = await import("../db");
  const conditions = [eq(propertyListings.organizationId, orgId)];
  const filters: string[] = [];
  const status = typeof args.status === "string" ? args.status.trim().toLowerCase() : "";
  if ((LISTING_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(propertyListings.status, status));
    filters.push(`status ${status}`);
  } else {
    filters.push("every status");
  }
  const rows = await db
    .select()
    .from(propertyListings)
    .where(and(...conditions))
    .orderBy(asc(propertyListings.id))
    .limit(LIST_CAP + 1);
  const shown = rows.slice(0, LIST_CAP);
  const capped = rows.length > LIST_CAP;
  return {
    ok: true,
    data: {
      coverage:
        `Coverage: this account's own land listings only (${shown.length} shown${filters.length ? ` — ${filters.join(", ")}` : ""}). ` +
        LISTING_NOT_COVERED +
        (capped ? ` The list is capped at ${LIST_CAP}; more exist.` : ""),
      listings: shown.map(shapeListing),
    },
  };
}

/** One of this account's listings, with its recorded channel status. */
export async function paxGetLandListing(orgId: number, listingId: unknown): Promise<LandToolOutcome> {
  const row = await loadListing(orgId, listingId);
  if (row === "bad_id") return badListingId();
  if (!row) return noListing();
  return {
    ok: true,
    data: {
      coverage:
        `Coverage: ONE listing in THIS account, with the channel status recorded on it. ` +
        `A status of "listed" is the operator's own word that they posted it; "active" means a channel accepted a posting through AcreOS. ` +
        LISTING_NOT_COVERED,
      listing: { ...shapeListing(row), description: row.description ?? null, viewCount: row.viewCount ?? 0, inquiryCount: row.inquiryCount ?? 0 },
    },
  };
}

/**
 * The ready-to-paste Craigslist text for one listing. Returns text for the
 * operator to post THEMSELVES — AcreOS posts nothing (Craigslist is manual).
 */
export async function paxGetListingPasteText(orgId: number, listingId: unknown): Promise<LandToolOutcome> {
  const row = await loadListing(orgId, listingId);
  if (row === "bad_id") return badListingId();
  if (!row) return noListing();
  const property = await loadProperty(orgId, row.propertyId);
  if (property === "bad_id" || !property) return noProperty();
  const { db } = await import("../db");
  const [orgRow] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const { buildNormalizedListing, listingContentForChannels, syndicateListing } = await import("../services/listingSyndication");
  const normalized = await buildNormalizedListing(property, orgRow ?? { name: "" }, listingContentForChannels(row));
  const [result] = await syndicateListing(normalized, ["craigslist"]);
  if (!result?.success || !result.preformattedText) {
    return {
      ok: false,
      refusal: {
        what: "The paste text could not be built for this listing",
        why: result?.error ?? "The listing is missing facts the text needs",
        unlock: "Open the listing, check its title, price and parcel facts, then ask again",
      },
    };
  }
  return {
    ok: true,
    data: {
      coverage:
        "Coverage: ready-to-paste Craigslist text built from THIS account's listing, exactly as the publish screen builds it. " +
        "AcreOS has NOT posted anything — Craigslist has no posting API here; the customer pastes this themselves, then can ask me to mark the listing as listed.",
      listingId: row.id,
      pasteText: result.preformattedText,
      manualInstructions: result.manualInstructions ?? null,
      deepLinkUrl: result.deepLinkUrl ?? null,
    },
  };
}

/**
 * Indicative payoff for one SERVICED note (the land sell-on-terms book):
 * the same non-recording calculator as GET /api/notes/:id/payoff. Records
 * no quote row and takes no payment.
 */
export async function paxGetLandPayoffQuote(
  orgId: number,
  args: { note_id?: unknown; payoff_date?: string },
): Promise<LandToolOutcome> {
  const noteId = positiveInt(args.note_id);
  if (noteId === null) {
    return {
      ok: false,
      refusal: {
        what: "That is not a serviced-note number",
        why: "Serviced-note numbers are the whole numbers from your notes list; a long identifier belongs to the acquired-note book, which this quote does not price",
        unlock: "Ask me for your notes and use the serviced note's number",
      },
    };
  }
  const today = clock.now().toISOString().slice(0, 10);
  const dateStr = typeof args.payoff_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.payoff_date.trim()) ? args.payoff_date.trim() : today;
  const payoffDate = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(payoffDate.getTime())) {
    return {
      ok: false,
      refusal: {
        what: "That payoff date is not a real date",
        why: "Payoff dates are written YYYY-MM-DD",
        unlock: "Give the date the payoff would close, like 2026-12-15",
      },
    };
  }
  const { db } = await import("../db");
  const [note] = await db
    .select()
    .from(sellerFinanceNotes)
    .where(and(eq(sellerFinanceNotes.id, noteId), eq(sellerFinanceNotes.organizationId, orgId)))
    .limit(1);
  if (!note) {
    return {
      ok: false,
      refusal: {
        what: "No serviced note with that number is in this account",
        why: "It may have been paid off and removed, or the number came from another list",
        unlock: "Ask me for your notes and pick the serviced one you mean",
      },
    };
  }
  const { deriveServicedNotePayoffInput } = await import("../services/notes/servicedNotePayoff");
  const { resolveOrgTimeZone } = await import("../services/form1098Batch");
  const { computePayoffQuote } = await import("../services/notePaymentMath");
  const { input, ledgerRowsConsidered, lateFeesCollectedToDateCents } = await deriveServicedNotePayoffInput({
    note: note as never,
    payoffDate,
    lenderTimeZone: await resolveOrgTimeZone(orgId),
  });
  const quote = computePayoffQuote(input);
  return {
    ok: true,
    data: {
      coverage:
        "Coverage: an INDICATIVE payoff for ONE serviced note in THIS account (a seller-financed note this account originated — the land sell-on-terms book), " +
        "computed by the same engine as the note payoff calculator from the note's own completed payment ledger. It is not a recorded quote and binds nobody: " +
        "a payoff a third party will rely on is issued from the note's payoff screen, which records it. It does not include acquired notes or any other account's notes.",
      noteId: note.id,
      status: note.status,
      payoffDate: dateStr,
      goodThroughDate: dateStr,
      recorded: false,
      principalBalanceCents: quote.principalBalanceCents,
      accruedInterestCents: quote.accruedInterestCents,
      perDiemInterestCents: quote.perDiemInterestCents,
      daysAccrued: quote.daysAccrued,
      lateFeesOutstandingCents: quote.lateFeesOutstandingCents,
      lateFeesCollectedToDateCents,
      totalPayoffCents: quote.totalPayoffCents,
      ledgerRowsConsidered,
    },
  };
}

/**
 * Record the operator's word that a listing is on the market — the same
 * attestation write as POST /api/listings/:id/mark-listed. Touches ONLY
 * status + publishedAt; channel records keep saying what AcreOS itself did.
 */
export async function paxMarkLandListingListed(
  orgId: number,
  listingId: unknown,
): Promise<LandToolOutcome & { receipt?: { before: unknown; after: unknown; description: string } }> {
  const row = await loadListing(orgId, listingId);
  if (row === "bad_id") return badListingId();
  if (!row) return noListing();
  if (row.status === "sold" || row.status === "withdrawn") {
    return {
      ok: false,
      refusal: {
        what: "That listing was not marked as listed",
        why: `It is ${row.status} — a listing that is off the market cannot be marked as listed`,
        unlock: "If the parcel is back on the market, create or reopen its listing first, then ask me to mark it",
      },
    };
  }
  if (row.status === "active") {
    return {
      ok: false,
      refusal: {
        what: "That listing was not marked as listed",
        why: "It is already active — a channel accepted its posting through AcreOS, and marking it listed would understate that",
        unlock: "Nothing to do: the listing is already live through AcreOS",
      },
    };
  }
  if (row.status === "listed") {
    return {
      ok: true,
      data: {
        message: "That listing is already marked as listed; its original on-market date stands. Nothing changed.",
        listingId: row.id,
        alreadyListed: true,
        listing: shapeListing(row),
      },
    };
  }
  const { db } = await import("../db");
  const now = clock.now();
  const [updated] = await db
    .update(propertyListings)
    .set({ status: "listed", publishedAt: now, updatedAt: now })
    .where(and(eq(propertyListings.id, row.id), eq(propertyListings.organizationId, orgId)))
    .returning();
  if (!updated) return noListing();
  return {
    ok: true,
    data: {
      message:
        "Marked as listed on the operator's word: this records that the customer posted the listing themselves. AcreOS did not post it to any channel.",
      listingId: row.id,
      alreadyListed: false,
      listing: shapeListing(updated),
    },
    receipt: {
      before: { listingId: row.id, status: row.status, publishedAt: row.publishedAt ?? null },
      after: { listingId: row.id, status: "listed", publishedAt: now },
      description: `Marked land listing ${row.id} ("${row.title}") as listed on the operator's word`,
    },
  };
}

/** Plain-words converter for the executor. */
export function landOutcomeToResult(o: LandToolOutcome): { success: boolean; data?: Record<string, unknown>; refusal?: RefusalParts; error?: string } {
  return o.ok ? { success: true, data: o.data } : toolRefusal(o.refusal);
}
