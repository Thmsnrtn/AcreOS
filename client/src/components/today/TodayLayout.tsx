/**
 * TodayLayout — persona-aware Today composition (Maren CPO #3 / Krieger UX).
 *
 * Persona tailoring is NOT vocabulary substitution. Each investor archetype
 * does a fundamentally different job, so the FIRST thing they see on Today is
 * shaped to THAT job — not a relabeled clone of the note-investor tape:
 *
 *   • land_investor   → sourcing / offer / closing momentum (their pipeline)
 *   • note_investor   → the performing/at-risk "tape" — payments due + late
 *                       notes on the book they OWN (secondary-market yield)
 *   • note_originator → the origination pipeline — deals ready to convert to a
 *                       note (they are the LENDER at origination, not a buyer)
 *   • note_servicer   → the servicing queue — payments to post + delinquencies
 *                       to work on the book they SERVICE FOR OTHERS (fee income,
 *                       never portfolio value — they don't own the notes)
 *   • tax_delinquent  → the redemption clock (their hard deadline)
 *   • everyone else   → the generic briefing (unchanged default)
 *
 * It does NOT invent new data surfaces or trigger its own fetch — every lede
 * composes the aggregates Today already pulled from /api/today (cash strip +
 * pipeline) into a small "lede" strip rendered above the Decision Queue. When
 * a datum a persona would want isn't on hand, the lede shows an honest empty
 * framing — never a fabricated number. Generic stays the default, so no
 * vertical is ever worse off than before.
 */

import type { ReactNode } from "react";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CalendarClock,
  AlertTriangle,
  Coins,
  ArrowRight,
  Target,
  HandCoins,
  ClipboardList,
  Repeat,
  Layers,
  Hammer,
  Home,
} from "lucide-react";
import type { Persona } from "@shared/models/auth";
import { usd, plural } from "@/lib/format";

// The aggregates Today already has in hand (from /api/today). Every lede reads
// these — none of them triggers its own fetch.
//   • pendingPayments30 — sum of scheduled note payments due in the next 30d
//   • lateCount         — notes currently late or delinquent
//   • openDealsCount    — active (non-closed/cancelled) parcel deals in pipeline
//   • openDealsValue    — total value of those active deals
export interface TodayLedeData {
  pendingPayments30: number;
  lateCount: number;
  openDealsCount: number;
  openDealsValue: number;
}

export interface TodayLayout {
  /** Stable key, for testing + data-testid. */
  key: string;
  /**
   * The persona's lead strip — the job they actually do, surfaced first.
   * Null for the generic default (no lede; the standard briefing leads).
   */
  Lede: ((props: { data: TodayLedeData }) => JSX.Element) | null;
}

type LedeAccent = "pos" | "neg" | "warn" | "brand";

// Literal class strings per accent — Tailwind's JIT scanner only emits classes
// it can see as full literals, so we map here rather than interpolate
// `bg-acr-${accent}-soft` (which would silently fail to render).
const ACCENT_VAR: Record<LedeAccent, string> = {
  pos: "var(--acr-pos)",
  neg: "var(--acr-neg)",
  warn: "var(--acr-warn)",
  brand: "var(--acr-brand)",
};
const ACCENT_SOFT_BG: Record<LedeAccent, string> = {
  pos: "bg-acr-pos-soft",
  neg: "bg-acr-neg-soft",
  warn: "bg-acr-warn-soft",
  brand: "bg-acr-brand-soft",
};

// Shared chrome so each lede reads as one consistent strip while differing in
// substance. Accent drives the left border + icon tint via design tokens.
function LedeShell({
  testId,
  accent,
  icon,
  title,
  detail,
  cta,
}: {
  testId: string;
  accent: LedeAccent;
  icon: JSX.Element;
  title: ReactNode;
  detail: ReactNode;
  cta: { href: string; label: string; emphasised?: boolean };
}) {
  return (
    <Card
      className="rounded-card shadow-acr-1 border-l-2 mb-4"
      style={{ borderLeftColor: ACCENT_VAR[accent] }}
      data-testid={testId}
    >
      <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-card ${ACCENT_SOFT_BG[accent]} shrink-0`}>{icon}</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">{title}</p>
            <p className="text-xs text-muted-foreground leading-snug">{detail}</p>
          </div>
        </div>
        <Button
          asChild
          size="sm"
          variant={cta.emphasised ? "default" : "outline"}
          className="shrink-0"
        >
          <Link href={cta.href} data-testid={`${testId}-cta`}>
            {cta.label}
            <ArrowRight className="w-3.5 h-3.5 ml-1" aria-hidden="true" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ── land_investor: sourcing / offer / closing momentum ───────────────────────
// Land investors source raw/vacant land, underwrite, offer, and close. Today
// leads with deal momentum: how many parcels are live in the pipeline and what
// they're worth. Honest empty when nothing's in flight — a hunt prompt, never a
// fabricated count.
function LandInvestorLede({ data }: { data: TodayLedeData }) {
  const hasPipeline = data.openDealsCount > 0;
  return (
    <LedeShell
      testId="today-lede-land_investor"
      accent="brand"
      icon={<Target className="w-4 h-4 text-acr-brand" aria-hidden="true" />}
      title={
        hasPipeline ? (
          <>
            {plural(data.openDealsCount, "deal")} in flight
            {data.openDealsValue > 0 && (
              <> · {usd(data.openDealsValue, { noCents: true })} on the table</>
            )}
          </>
        ) : (
          "No deals in flight yet"
        )
      }
      detail={
        hasPipeline
          ? "Move one offer forward before you source the next parcel."
          : "Source a parcel, underwrite it, and get an offer out today."
      }
      cta={{
        href: "/deals",
        label: hasPipeline ? "Work the pipeline" : "Start sourcing",
        emphasised: hasPipeline,
      }}
    />
  );
}

// ── note_investor: the performing / at-risk tape ─────────────────────────────
// Note investors BUY existing seller-financed notes for yield. Today leads with
// the tape on the book they OWN: payments due this month + any notes behind.
function NoteInvestorLede({ data }: { data: TodayLedeData }) {
  const hasLate = data.lateCount > 0;
  return (
    <LedeShell
      testId="today-lede-note_investor"
      accent={hasLate ? "neg" : "pos"}
      icon={<Coins className="w-4 h-4 text-acr-pos" aria-hidden="true" />}
      title={<>{usd(data.pendingPayments30, { noCents: true })} due across your book this month</>}
      detail={
        hasLate ? (
          <span className="inline-flex items-center gap-1 text-acr-neg">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            {plural(data.lateCount, "note")} behind — work the tape first.
          </span>
        ) : (
          "Every note current. Collect, then hunt the secondary market."
        )
      }
      cta={{
        href: "/money",
        label: hasLate ? "Work delinquencies" : "Open the book",
        emphasised: hasLate,
      }}
    />
  );
}

// ── note_originator: the origination pipeline ────────────────────────────────
// Originators CREATE seller-financed notes — they are the lender at origination
// (land seller-financer / tax-lien-to-note convertor). Today leads with the
// pipeline of deals ready to convert into a note, NOT secondary-market yield.
// openDealsCount honestly counts deals in the pipeline that can be structured
// into a note; the CTA routes to the note-origination pipeline, not the book.
function NoteOriginatorLede({ data }: { data: TodayLedeData }) {
  const hasPipeline = data.openDealsCount > 0;
  return (
    <LedeShell
      testId="today-lede-note_originator"
      accent="brand"
      icon={<HandCoins className="w-4 h-4 text-acr-brand" aria-hidden="true" />}
      title={
        hasPipeline ? (
          <>{plural(data.openDealsCount, "deal")} ready to structure into a note</>
        ) : (
          "No deals queued to originate"
        )
      }
      detail={
        hasPipeline
          ? "Underwrite the borrower, set the terms, and originate today."
          : "Line up a seller-financed deal — then structure and fund the note."
      }
      cta={{
        href: "/notes/pipeline",
        label: hasPipeline ? "Open origination pipeline" : "Start a note",
        emphasised: hasPipeline,
      }}
    />
  );
}

// ── note_servicer: the servicing queue ───────────────────────────────────────
// Servicers SERVICE notes for OTHERS — they don't own them, so this lede leads
// with the work, never portfolio value. pendingPayments30 = payments expected
// across the serviced book to post this month (their fee base); lateCount =
// delinquencies to work. We have no per-note servicing-fee datum on hand, so we
// frame fee income honestly ("fee income tracks the book you service") rather
// than invent a dollar figure.
function NoteServicerLede({ data }: { data: TodayLedeData }) {
  const hasLate = data.lateCount > 0;
  const hasBook = data.pendingPayments30 > 0 || data.lateCount > 0;
  return (
    <LedeShell
      testId="today-lede-note_servicer"
      accent={hasLate ? "neg" : "pos"}
      icon={<ClipboardList className="w-4 h-4 text-acr-pos" aria-hidden="true" />}
      title={
        hasBook ? (
          <>{usd(data.pendingPayments30, { noCents: true })} in payments to post this month</>
        ) : (
          "Servicing queue is clear"
        )
      }
      detail={
        hasLate ? (
          <span className="inline-flex items-center gap-1 text-acr-neg">
            <AlertTriangle className="w-3 h-3" aria-hidden="true" />
            {plural(data.lateCount, "delinquency")} to work — fee income tracks the book you service.
          </span>
        ) : hasBook ? (
          "Post payments and disbursements — fee income tracks the book you service."
        ) : (
          "No payments or delinquencies queued for the book you service."
        )
      }
      cta={{
        href: "/money",
        label: hasLate ? "Work delinquencies" : "Open servicing queue",
        emphasised: hasLate,
      }}
    />
  );
}

// ── tax_delinquent: the redemption clock ─────────────────────────────────────
function TaxLienLede({ data: _data }: { data: TodayLedeData }) {
  return (
    <LedeShell
      testId="today-lede-tax_delinquent"
      accent="warn"
      icon={<CalendarClock className="w-4 h-4 text-acr-warn" aria-hidden="true" />}
      title="The redemption clock leads your day"
      detail="Liens redeem (or convert) on a hard deadline — check what's closing before anything else."
      cta={{ href: "/redemption-clock", label: "Open redemption clock", emphasised: true }}
    />
  );
}

// ── wholesaler: contracts to assign ──────────────────────────────────────────
// Wholesalers get a property under contract and assign it to a cash buyer for a
// fee — speed and a ready buyers list are everything. Leads with contracts in
// flight; honest empty is a "lock one up" prompt.
function WholesalerLede({ data }: { data: TodayLedeData }) {
  const hasPipeline = data.openDealsCount > 0;
  return (
    <LedeShell
      testId="today-lede-wholesaler"
      accent="brand"
      icon={<Repeat className="w-4 h-4 text-acr-brand" aria-hidden="true" />}
      title={
        hasPipeline ? (
          <>
            {plural(data.openDealsCount, "contract")} to assign
            {data.openDealsValue > 0 && <> · {usd(data.openDealsValue, { noCents: true })} in spread</>}
          </>
        ) : (
          "No contracts to assign yet"
        )
      }
      detail={
        hasPipeline
          ? "Match a cash buyer and assign before your inspection window closes."
          : "Lock up a motivated seller, then line up the cash buyer."
      }
      cta={{ href: "/deals", label: hasPipeline ? "Work assignments" : "Find a deal", emphasised: hasPipeline }}
    />
  );
}

// ── subdivider: parent parcels mid-split ─────────────────────────────────────
// Subdividers buy a large parent parcel and sell child lots over 18-36 months —
// the job is moving projects through entitlement and selling lots. Leads with
// active projects.
function SubdividerLede({ data }: { data: TodayLedeData }) {
  const hasProjects = data.openDealsCount > 0;
  return (
    <LedeShell
      testId="today-lede-subdivider"
      accent="brand"
      icon={<Layers className="w-4 h-4 text-acr-brand" aria-hidden="true" />}
      title={
        hasProjects ? (
          <>
            {plural(data.openDealsCount, "project")} in progress
            {data.openDealsValue > 0 && <> · {usd(data.openDealsValue, { noCents: true })} in lot value</>}
          </>
        ) : (
          "No subdivision projects yet"
        )
      }
      detail={
        hasProjects
          ? "Advance one project through entitlement or move a child lot today."
          : "Find a parent parcel that pencils once it's cut into lots."
      }
      cta={{ href: "/deals", label: hasProjects ? "Work projects" : "Find a parcel", emphasised: hasProjects }}
    />
  );
}

// ── fix_flipper: flips in progress ───────────────────────────────────────────
// Fix-and-flippers buy distressed, rehab, and resell — holding cost is the
// enemy, so the lede leads with active flips and pushes one forward.
function FixFlipperLede({ data }: { data: TodayLedeData }) {
  const hasFlips = data.openDealsCount > 0;
  return (
    <LedeShell
      testId="today-lede-fix_flipper"
      accent="brand"
      icon={<Hammer className="w-4 h-4 text-acr-brand" aria-hidden="true" />}
      title={
        hasFlips ? (
          <>
            {plural(data.openDealsCount, "flip")} in progress
            {data.openDealsValue > 0 && <> · {usd(data.openDealsValue, { noCents: true })} at work</>}
          </>
        ) : (
          "No flips in progress yet"
        )
      }
      detail={
        hasFlips
          ? "Every holding day costs — push one rehab or listing forward today."
          : "Find a distressed deal where the rehab math leaves room."
      }
      cta={{ href: "/deals", label: hasFlips ? "Work flips" : "Find a flip", emphasised: hasFlips }}
    />
  );
}

// ── landlord: building the rental book ───────────────────────────────────────
// Buy-and-hold landlords add doors and run them long-term. Today's aggregates
// only carry the acquisition pipeline, so the lede leads with acquisitions in
// flight (honest empty otherwise) and points at the portfolio.
function LandlordLede({ data }: { data: TodayLedeData }) {
  const hasPipeline = data.openDealsCount > 0;
  return (
    <LedeShell
      testId="today-lede-landlord"
      accent="brand"
      icon={<Home className="w-4 h-4 text-acr-brand" aria-hidden="true" />}
      title={
        hasPipeline ? (
          <>
            {plural(data.openDealsCount, "acquisition")} in flight
            {data.openDealsValue > 0 && <> · {usd(data.openDealsValue, { noCents: true })} to add</>}
          </>
        ) : (
          "No acquisitions in flight"
        )
      }
      detail={
        hasPipeline
          ? "Move one acquisition toward close to add the next door."
          : "Find a property where the rent covers the note and then some."
      }
      cta={{ href: "/deals", label: hasPipeline ? "Work acquisitions" : "Find a rental", emphasised: hasPipeline }}
    />
  );
}

// ── The registry ─────────────────────────────────────────────────────────────
// Each persona leads with its OWN job — note investor (tape), originator
// (origination pipeline), servicer (servicing queue), land investor (sourcing
// momentum), tax-delinquent (redemption clock), and the deal-driven verticals
// (wholesaler/subdivider/fix_flipper/landlord) each with their own framing of
// the shared deal aggregates. No persona is left on the generic briefing.
const LAND_LEDE: TodayLayout = { key: "land", Lede: LandInvestorLede };
const NOTE_INVESTOR_LEDE: TodayLayout = { key: "note_investor", Lede: NoteInvestorLede };
const NOTE_ORIGINATOR_LEDE: TodayLayout = { key: "note_originator", Lede: NoteOriginatorLede };
const NOTE_SERVICER_LEDE: TodayLayout = { key: "note_servicer", Lede: NoteServicerLede };
const TAX_LIEN_LEDE: TodayLayout = { key: "tax_lien", Lede: TaxLienLede };
const WHOLESALER_LEDE: TodayLayout = { key: "wholesaler", Lede: WholesalerLede };
const SUBDIVIDER_LEDE: TodayLayout = { key: "subdivider", Lede: SubdividerLede };
const FIX_FLIPPER_LEDE: TodayLayout = { key: "fix_flipper", Lede: FixFlipperLede };
const LANDLORD_LEDE: TodayLayout = { key: "landlord", Lede: LandlordLede };
const GENERIC_LAYOUT: TodayLayout = { key: "generic", Lede: null };

const TODAY_LAYOUTS: Partial<Record<Persona, TodayLayout>> = {
  land_investor: LAND_LEDE,
  note_investor: NOTE_INVESTOR_LEDE,
  note_originator: NOTE_ORIGINATOR_LEDE,
  note_servicer: NOTE_SERVICER_LEDE,
  tax_delinquent: TAX_LIEN_LEDE,
  wholesaler: WHOLESALER_LEDE,
  subdivider: SUBDIVIDER_LEDE,
  fix_flipper: FIX_FLIPPER_LEDE,
  landlord: LANDLORD_LEDE,
};

/**
 * Resolve the Today layout for a persona. Unknown / generic personas fall
 * through to the generic default (no lede) — every vertical we don't have a
 * variant for keeps exactly the experience it has today.
 */
export function getTodayLayout(persona: Persona | undefined): TodayLayout {
  if (!persona) return GENERIC_LAYOUT;
  return TODAY_LAYOUTS[persona] ?? GENERIC_LAYOUT;
}
