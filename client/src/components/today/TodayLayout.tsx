/**
 * TodayLayout — vertical-aware Today composition (Maren CPO #3).
 *
 * Persona tailoring today is mostly vocabulary substitution. That's the LABEL
 * of tailoring, not the substance. The Today door is still the generic land-
 * investor briefing for every vertical. This registry makes the vertical's most
 * fiduciary obligation the FIRST thing the operator sees:
 *
 *   • a note investor   → payments due + delinquency (their tape)
 *   • a tax-lien operator → the redemption clock (their hard deadline)
 *   • everyone else      → the generic briefing (unchanged default)
 *
 * It does NOT invent new data surfaces — it composes EXISTING widgets and links
 * (CashStrip data the page already fetched; the existing /redemption-clock and
 * /money surfaces) into a small "lede" strip rendered above the Decision Queue.
 * Generic stays the default, so no vertical is ever worse off than before.
 */

import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CalendarClock, AlertTriangle, Coins, ArrowRight } from "lucide-react";
import type { Persona } from "@shared/models/auth";
import { usd } from "@/lib/format";

// The cash aggregates Today already has in hand (from /api/today). The lede
// reads these — it never triggers its own fetch.
export interface TodayLedeData {
  pendingPayments30: number;
  lateCount: number;
}

export interface TodayLayout {
  /** Stable key, for testing + data-testid. */
  key: string;
  /**
   * The vertical's lead strip — the most fiduciary obligation, surfaced first.
   * Null for the generic default (no lede; the standard briefing leads).
   */
  Lede: ((props: { data: TodayLedeData }) => JSX.Element) | null;
}

// ── Note-investor lede: payments due + delinquency ──────────────────────────
function NoteInvestorLede({ data }: { data: TodayLedeData }) {
  const hasLate = data.lateCount > 0;
  return (
    <Card
      className="rounded-card border-l-2 mb-4"
      style={{ borderLeftColor: hasLate ? "var(--acr-neg)" : "var(--acr-pos)" }}
      data-testid="today-lede-note_investor"
    >
      <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-card bg-acr-pos-soft shrink-0">
            <Coins className="w-4 h-4 text-acr-pos" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">
              {usd(data.pendingPayments30, { noCents: true })} due across your book this month
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              {hasLate ? (
                <span className="inline-flex items-center gap-1 text-acr-neg">
                  <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                  {data.lateCount} note{data.lateCount === 1 ? "" : "s"} behind — work the tape first.
                </span>
              ) : (
                "Every note current. Collect, then hunt."
              )}
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant={hasLate ? "default" : "outline"} className="shrink-0">
          <Link href="/money" data-testid="today-lede-note_investor-cta">
            {hasLate ? "Work delinquencies" : "Open the book"}
            <ArrowRight className="w-3.5 h-3.5 ml-1" aria-hidden="true" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Tax-lien lede: the redemption clock ─────────────────────────────────────
function TaxLienLede({ data: _data }: { data: TodayLedeData }) {
  return (
    <Card
      className="rounded-card border-l-2 mb-4"
      style={{ borderLeftColor: "var(--acr-warn)" }}
      data-testid="today-lede-tax_delinquent"
    >
      <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 rounded-card bg-acr-warn-soft shrink-0">
            <CalendarClock className="w-4 h-4 text-acr-warn" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">
              The redemption clock leads your day
            </p>
            <p className="text-xs text-muted-foreground leading-snug">
              Liens redeem (or convert) on a hard deadline — check what's closing before anything else.
            </p>
          </div>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/redemption-clock" data-testid="today-lede-tax_delinquent-cta">
            Open redemption clock
            <ArrowRight className="w-3.5 h-3.5 ml-1" aria-hidden="true" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

// ── The registry ────────────────────────────────────────────────────────────
// Note personas (investor / originator / servicer) all lead with the tape;
// tax-delinquent leads with the redemption clock; everyone else is generic.
const NOTE_LEDE: TodayLayout = { key: "note", Lede: NoteInvestorLede };
const TAX_LIEN_LEDE: TodayLayout = { key: "tax_lien", Lede: TaxLienLede };
const GENERIC_LAYOUT: TodayLayout = { key: "generic", Lede: null };

const TODAY_LAYOUTS: Partial<Record<Persona, TodayLayout>> = {
  note_investor: NOTE_LEDE,
  note_originator: NOTE_LEDE,
  note_servicer: NOTE_LEDE,
  tax_delinquent: TAX_LIEN_LEDE,
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
