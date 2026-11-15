/**
 * First-value call to action on /today (D11 front-door fix 2).
 *
 * "A home that does not tell a new user what to do first is not a home."
 * The CTA is the UI design's own pinned form (§4.1) — "Import your first
 * tape" — with the real action attached: it opens the note-tape import
 * (Linnea's day-one path, V-Notes-1 N1), which already does preview,
 * row-level errors and refusal-before-build. No new flow, no new endpoint,
 * no mock numbers.
 *
 * Audience: a note investor with no acquired notes yet. The fresh-state test
 * reads data the product already has — the acquired-note book's `total`
 * (GET /api/notes/acquired) — and nothing new is tracked. Once one note is
 * on the book the CTA is gone for good; Today's quiet confirmation ("Here's
 * what's on the horizon.") is what a user with nothing needing them sees.
 *
 * Scope note: the design pins a second form, "Add your first watch". It is
 * NOT rendered here — the material available to this package does not say
 * which product object a "watch" is (see the PR's Step 0 record), and a CTA
 * must route to a real flow. Every other persona keeps Today exactly as it
 * was.
 *
 * Copy: verbatim, no experience claim (D17), no send of any kind (D6).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePersona } from "@/hooks/use-persona";
import { useOrganization } from "@/hooks/use-organization";
import { resolveChecklistBusinessType } from "@/lib/onboarding-checklist";

/** The pinned copy and the real flow it opens. */
export const FIRST_TAPE_CTA = {
  label: "Import your first tape",
  // /notes?action=new opens NotesImportDialog, whose default intent is
  // "acquired" — the note-tape import itself (notes.tsx, notes-import-dialog.tsx).
  href: "/notes?action=new",
} as const;

/**
 * Land: "Make your first offer" opens the blind-offer wizard at its first step
 * (county). A new org can enter it with nothing set up; pricing needs a dated
 * comp (pulled for the county, or pasted), and a recorded decision needs a
 * parcel. "Made an offer" is read from real rows (GET /api/today/first-offer).
 */
export const FIRST_OFFER_CTA = {
  label: "Make your first offer",
  href: "/blind-offer-wizard",
} as const;

/** Land flippers, and the land side of hybrid. Persona stays authoritative. */
export function isLandFirstOfferAudience(
  persona: string | null | undefined,
  businessType: string | null | undefined,
): boolean {
  return persona === "land_investor" && (businessType === "land_flipper" || businessType === "hybrid");
}

/** Null until the answer is known: never flash at someone who may have made an offer. */
export function firstOfferCtaFor(
  persona: string | null | undefined,
  businessType: string | null | undefined,
  madeAnOffer: boolean | null | undefined,
): typeof FIRST_OFFER_CTA | null {
  if (!isLandFirstOfferAudience(persona, businessType)) return null;
  if (typeof madeAnOffer !== "boolean") return null;
  return madeAnOffer ? null : FIRST_OFFER_CTA;
}

/**
 * Who sees what. Null means "render nothing": not a note investor, or the
 * book's size is not known yet (never flash a CTA at a user who may already
 * have notes), or the user is past first value.
 */
export function firstValueCtaFor(
  persona: string | null | undefined,
  acquiredNoteTotal: number | null | undefined,
): typeof FIRST_TAPE_CTA | null {
  if (persona !== "note_investor") return null;
  if (typeof acquiredNoteTotal !== "number") return null;
  return acquiredNoteTotal === 0 ? FIRST_TAPE_CTA : null;
}

export function FirstValueCta() {
  const persona = usePersona();
  const isNoteInvestor = persona === "note_investor";
  // Keyed under the "/api/notes" prefix so the import dialog's existing
  // invalidateQueries({ queryKey: ["/api/notes"] }) retires the CTA the
  // moment the first tape lands.
  const { data } = useQuery<{ total: number }>({
    queryKey: ["/api/notes", "acquired", "first-value"],
    queryFn: async () => {
      const res = await fetch("/api/notes/acquired?limit=1", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load notes (${res.status})`);
      return res.json();
    },
    enabled: isNoteInvestor,
  });

  // Org not loaded => business type unknown => no land CTA (the resolver's
  // land_flipper fallback must not fire while loading).
  const { data: org } = useOrganization();
  const businessType = org
    ? resolveChecklistBusinessType(org.onboardingData?.businessType, org.investorType)
    : undefined;
  const isLand = isLandFirstOfferAudience(persona, businessType);
  const offer = useQuery<{ madeAnOffer: boolean }>({
    queryKey: ["/api/today/first-offer"],
    enabled: isLand,
    // Re-ask on every Today visit until true, so it retires right after the
    // first offer is recorded; once true it is permanent.
    staleTime: (q) => (q.state.data?.madeAnOffer ? Infinity : 0),
  });

  const cta =
    firstValueCtaFor(persona, data?.total) ?? firstOfferCtaFor(persona, businessType, offer.data?.madeAnOffer);
  if (!cta) return null;

  return (
    <Button
      asChild
      className="mt-4 min-h-11 pointer-fine:sm:min-h-10 px-4 shadow-acr-1"
    >
      <Link href={cta.href} data-testid="button-first-value-cta">
        {cta.label}
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </Link>
    </Button>
  );
}
