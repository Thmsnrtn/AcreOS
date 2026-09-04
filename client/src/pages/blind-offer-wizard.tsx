import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Verbs } from "@/lib/labels";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { parseSnapshotPrefill, type SnapshotPrefill } from "@shared/blindOfferPrefill";
import { findStateWarning } from "@/lib/upl-gating";
import { StateUplBanner } from "@/components/upl-gating-banner";
import {
  ChevronRight, ChevronLeft, MapPin, BarChart2, Calculator, FileText,
  DollarSign, TrendingUp, AlertTriangle, CheckCircle, Star,
  Loader2, Download, Copy, Send, RefreshCw, Sparkles,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

// P1 money-precision: K/M compact bands intentionally kept for the wizard's hero
// numbers (offers, ROI, monthly payments — readability over cents). Sub-$1K
// fall-through swapped to canonical usd(noCents) so the precision policy at
// boundary remains usd().
function fmt(n: number) {
  if (!n || isNaN(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return usd(n, { noCents: true });
}

// ─── Land Snapshot → wizard prefill (Maren CPO #5) ────────────────────────────
//
// Close the "so what?": the Land Snapshot's confident, provenanced fields feed
// the blind-offer wizard so the highest-friction step (data entry) is gone and
// the operator goes parcel → offer in under a minute. The pure parse/build
// mapping lives in @shared/blindOfferPrefill (shared with parcel-detail's
// "Make an offer with these numbers" button + directly unit-tested). Honesty
// contract: only real fields prefill — see that module.

// ─── Types ───────────────────────────────────────────────────────────────────

interface Comp {
  pricePerAcre: number;
  acres: number;
  totalPrice: number;
  source: string;
  notes?: string;
}

interface SellerProfile {
  isTaxDelinquent: boolean;
  isOutOfState: boolean;
  isInherited: boolean;
  yearsOwned: number;
}

interface OfferReport {
  state: string;
  county: string;
  targetAcres: number;
  compAnalysis: {
    lowestSalePerAcre: number;
    medianSalePerAcre: number;
    compCount: number;
    dataQuality: "excellent" | "good" | "limited" | "insufficient";
    dataQualityNotes: string[];
    isCountyValidated: boolean;
  };
  baseOfferPerAcre: number;
  baseOfferTotal: number;
  offerTiers: {
    aggressive: { offerTotal: number; pctOfLowestComp: number; acceptanceRateForecast: string };
    standard: { offerTotal: number; pctOfLowestComp: number; acceptanceRateForecast: string };
    competitive: { offerTotal: number; pctOfLowestComp: number; acceptanceRateForecast: string };
  };
  recommendedTier: "aggressive" | "standard" | "competitive";
  recommendedOfferTotal: number;
  recommendationReason: string;
  cashFlipScenario: {
    salePrice: number;
    netProfit: number;
    /** null when there is no cost basis — a return on nothing, not a zero. */
    roi: number | null;
    holdingPeriodDays: number;
    annualizedROI: number | null;
    breakevenSale: number;
    /** Which cost rules this rests on, and whether the operator set them. */
    assumptions: Array<{
      key: string;
      label: string;
      display: string;
      source: "org_rule" | "platform_default";
    }>;
  };
  ownerFinanceScenario: {
    salePrice: number;
    downPayment: number;
    loanAmount: number;
    monthlyPayment: number;
    totalCollected: number;
    roi: number;
    passiveIncomeYears: number;
  };
  hybridRecommendation: string;
  letterVariables: {
    offerAmount: number;
    offerAmountWords: string;
    countyName: string;
    stateName: string;
    urgencyLanguage: string;
    closingTimeline: string;
  };
  marketContext: {
    /** null when USDA has no value on file for the county. */
    usdaLandValuePerAcre: number | null;
    usdaCagr5Year: number;
    marketCondition: string;
    ebayValidationNote: string;
  };
  warnings: string[];
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: "county", label: "County selection", icon: MapPin },
  { id: "comps", label: "Comp research", icon: BarChart2 },
  { id: "calculate", label: "Offer calculation", icon: Calculator },
  { id: "exit", label: "Exit strategy", icon: TrendingUp },
  { id: "letter", label: "Offer letter", icon: FileText },
] as const;

type Step = typeof STEPS[number]["id"];

// ─── US States ────────────────────────────────────────────────────────────────

const US_STATES = [
  { code: "AZ", name: "Arizona" }, { code: "NM", name: "New Mexico" },
  { code: "TX", name: "Texas" }, { code: "FL", name: "Florida" },
  { code: "NC", name: "North Carolina" }, { code: "TN", name: "Tennessee" },
  { code: "CO", name: "Colorado" }, { code: "OR", name: "Oregon" },
  { code: "GA", name: "Georgia" }, { code: "SC", name: "South Carolina" },
  { code: "MO", name: "Missouri" }, { code: "AR", name: "Arkansas" },
  { code: "OK", name: "Oklahoma" }, { code: "AL", name: "Alabama" },
  { code: "MS", name: "Mississippi" }, { code: "LA", name: "Louisiana" },
  { code: "VA", name: "Virginia" }, { code: "WV", name: "West Virginia" },
  { code: "KY", name: "Kentucky" }, { code: "IN", name: "Indiana" },
  { code: "OH", name: "Ohio" }, { code: "MI", name: "Michigan" },
  { code: "WI", name: "Wisconsin" }, { code: "MN", name: "Minnesota" },
  { code: "IA", name: "Iowa" }, { code: "KS", name: "Kansas" },
  { code: "NE", name: "Nebraska" }, { code: "SD", name: "South Dakota" },
  { code: "ND", name: "North Dakota" }, { code: "MT", name: "Montana" },
  { code: "ID", name: "Idaho" }, { code: "WA", name: "Washington" },
  { code: "CA", name: "California" }, { code: "NY", name: "New York" },
  { code: "PA", name: "Pennsylvania" },
];

// ─── Carla Mendoza fix (2026-05-27): UPL / assignment-disclosure warnings ────
//
// The blind-offer wizard's letter-generator emits "I am a private investor … I
// would like to make you a firm offer" — language the broker-licensing and
// equitable-interest doctrines govern. The STATE_UPL_WARNINGS table, the
// findStateWarning lookup, and the StateUplBanner now live in the shared
// modules below so the IDENTICAL gate rides the inline blind-offer composer on
// the Map door too (T3-3B). The warning surfaces at STEP 1 (the moment the
// state is filled) — block-severity states disable Continue — instead of being
// stuffed into the final step after the operator has invested time.
//   - data + helpers: client/src/lib/upl-gating.ts (findStateWarning, above)
//   - banner UI:      client/src/components/upl-gating-banner.tsx (StateUplBanner)

// ─── Step Components ──────────────────────────────────────────────────────────
//
// Every step takes real typed props (T3 W1-7 — the `any`-typed step props are
// gone). The wizard owns state; steps are presentational + callbacks.

interface StepCountyProps {
  state: string;
  setState: (v: string) => void;
  county: string;
  setCounty: (v: string) => void;
  acres: number;
  setAcres: (v: number) => void;
  sellerProfile: SellerProfile;
  setSellerProfile: React.Dispatch<React.SetStateAction<SellerProfile>>;
  onNext: () => void;
}

function StepCounty({ state, setState, county, setCounty, acres, setAcres, sellerProfile, setSellerProfile, onNext }: StepCountyProps) {
  const warning = findStateWarning(state);
  const isBlocked = warning?.severity === "block";
  const canProceed = state && county && acres > 0 && !isBlocked;
  const stateId = useId();
  const countyId = useId();
  const acresId = useId();
  const yearsId = useId();
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => { e.preventDefault(); if (canProceed) onNext(); }}
    >
      <div>
        <h2 className="text-xl font-bold mb-1">Step 1: County & property details</h2>
        <p className="text-sm text-muted-foreground">Select the county you're targeting. The system will pull USDA land-value benchmarks and demographic data.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor={stateId}>State</Label>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger id={stateId}>
              <SelectValue placeholder="Select state…" />
            </SelectTrigger>
            <SelectContent>
              {US_STATES.map(s => (
                <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={countyId}>County</Label>
          <Input id={countyId} value={county} onChange={e => setCounty(e.target.value)} placeholder="e.g. Mohave, Pinal, San Juan…" autoCapitalize="words" />
        </div>
        <div>
          <Label htmlFor={acresId}>Parcel size (acres)</Label>
          <Input id={acresId} type="number" inputMode="decimal" className="tabular-nums" value={acres || ""} onChange={e => setAcres(parseFloat(e.target.value) || 0)} placeholder="e.g. 5" min="0.01" step="0.1" />
        </div>
      </div>

      <fieldset className="border-0 p-0 m-0">
        <legend className="font-semibold text-sm mb-3">Seller profile (optional — improves offer tier recommendation)</legend>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {([
            { key: "isTaxDelinquent", label: "Tax-delinquent owner" },
            { key: "isOutOfState", label: "Out-of-state owner" },
            { key: "isInherited", label: "Inherited property" },
          ] as const).map(({ key, label }) => {
            const cbId = `seller-${key}`;
            const checked = !!sellerProfile[key];
            return (
              <label key={key} htmlFor={cbId} className={`flex items-center gap-2 p-3 min-h-11 rounded-card border cursor-pointer transition-colors ${checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40 active:bg-muted/50"}`}>
                <input
                  id={cbId}
                  type="checkbox"
                  checked={checked}
                  onChange={e => setSellerProfile((p) => ({ ...p, [key]: e.target.checked }))}
                  className="sr-only"
                />
                <span aria-hidden="true" className={`w-4 h-4 rounded border flex items-center justify-center ${checked ? "bg-primary border-primary" : "border-input"}`}>
                  {checked && <CheckCircle className="w-3 h-3 text-primary-foreground" aria-hidden="true" />}
                </span>
                <span className="text-xs font-medium">{label}</span>
              </label>
            );
          })}
          <div>
            <Label htmlFor={yearsId} className="text-xs">Years owned</Label>
            <Input
              id={yearsId}
              type="number"
              inputMode="numeric"
              className="mt-1 tabular-nums"
              value={sellerProfile.yearsOwned || ""}
              onChange={e => setSellerProfile((p) => ({ ...p, yearsOwned: parseInt(e.target.value) || 0 }))}
              placeholder="Years"
            />
          </div>
        </div>
      </fieldset>

      {/* Carla Mendoza fix: surface state-specific UPL / assignment-
          disclosure warnings the MOMENT the operator picks a state.
          Block-severity states disable Continue. */}
      <StateUplBanner state={state} />

      <div className="rounded-xl border border-acr-accent bg-acr-accent dark:border-acr-accent/50 dark:bg-acr-accent/10 p-4">
        <div className="flex gap-3">
          <Star className="w-4 h-4 text-acr-accent mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="text-sm text-acr-accent dark:text-acr-accent">
            <p className="font-semibold mb-1">County selection wisdom</p>
            <p>Validate your county before mailing: search eBay's sold land listings for this county. If you find 10+ listings with multiple bidders, the model works here. No bidders means no buyer market. Counties within 2-3 hours of a major metro consistently outperform remote rural counties.</p>
          </div>
        </div>
      </div>

      <Button type="submit" disabled={!canProceed} className="w-full">
        {isBlocked
          ? "Blocked by state — use double-close flow instead"
          : (<>Continue to comp research <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" /></>)}
      </Button>
    </form>
  );
}

interface StepCompsProps {
  state: string;
  county: string;
  acres: number;
  comps: Comp[];
  setComps: React.Dispatch<React.SetStateAction<Comp[]>>;
  onNext: () => void;
  onBack: () => void;
}

function StepComps({ state, county, acres, comps, setComps, onNext, onBack }: StepCompsProps) {
  const [newComp, setNewComp] = useState({ pricePerAcre: "", acres: "", source: "county_records", notes: "" });
  const [autoLoadState, setAutoLoadState] = useState<"idle" | "loading" | "loaded" | "empty" | "error">("idle");
  const [autoLoadMeta, setAutoLoadMeta] = useState<{ count: number; source: string; fallback: string | null } | null>(null);
  const autoLoadAttempted = useRef(false);
  const ppaId = useId();
  const acreageId = useId();
  const sourceId = useId();

  // Tom Hsiao / Lens 36 fix — auto-pull comps for this county on mount so
  // the user doesn't have to keep PropStream open just to fill Step 2.
  // If the auto-pull fails or finds nothing, we leave the manual form
  // exposed and surface a calm "paste manually" fallback (no error pop).
  async function autoLoadComps(force = false) {
    if (!force && autoLoadAttempted.current) return;
    autoLoadAttempted.current = true;
    setAutoLoadState("loading");
    try {
      const params = new URLSearchParams({ state, county, acres: String(acres || 0) });
      const resp = await fetch(`/api/data-intel/county-comps?${params.toString()}`, { credentials: "include" });
      if (!resp.ok) throw new Error(String(resp.status));
      const data = await resp.json();
      const pulled = Array.isArray(data?.comps) ? data.comps : [];
      setAutoLoadMeta({ count: pulled.length, source: data?.source || "unknown", fallback: data?.fallback ?? null });
      if (pulled.length === 0) {
        setAutoLoadState("empty");
        return;
      }
      // Don't blow away comps the user has already added by hand.
      setComps((prev: Comp[]) => {
        const seen = new Set(prev.map((c: Comp) => `${c.pricePerAcre}-${c.acres}-${c.source}`));
        const additions = pulled.filter((c: Comp) => !seen.has(`${c.pricePerAcre}-${c.acres}-${c.source}`));
        return [...prev, ...additions];
      });
      setAutoLoadState("loaded");
    } catch (err) {
      setAutoLoadState("error");
    }
  }

  useEffect(() => {
    if (state && county && comps.length === 0) {
      autoLoadComps();
    }
    // intentionally not re-running on every comps change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, county]);

  function addComp() {
    const ppa = parseFloat(newComp.pricePerAcre);
    const ac = parseFloat(newComp.acres);
    if (!ppa || !ac) return;
    setComps((prev: Comp[]) => [...prev, {
      pricePerAcre: ppa,
      acres: ac,
      totalPrice: ppa * ac,
      source: newComp.source,
      notes: newComp.notes,
    }]);
    setNewComp({ pricePerAcre: "", acres: "", source: "county_records", notes: "" });
  }

  function removeComp(idx: number) {
    setComps((prev: Comp[]) => prev.filter((_, i) => i !== idx));
  }

  const sortedComps = [...comps].sort((a, b) => a.pricePerAcre - b.pricePerAcre);
  const lowestComp = sortedComps[0]?.pricePerAcre || 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Step 2: Comparable sales research</h2>
        <p className="text-sm text-muted-foreground">Enter recent sold comps for {county} County, {state}. The system also pulls USDA land-value benchmarks automatically.</p>
      </div>

      {/* Tom Hsiao / Lens 36 — Auto-pull status banner */}
      <div className="rounded-xl border p-4 flex items-start gap-3" role="status" aria-live="polite">
        {autoLoadState === "loading" && (
          <>
            <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-primary flex-shrink-0" aria-hidden="true" />
            <div className="text-sm flex-1">
              <p className="font-semibold">Pulling recent sales from {county} County, {state}…</p>
              <p className="text-muted-foreground">±50% acreage of your target. Last 18 months.</p>
            </div>
          </>
        )}
        {autoLoadState === "loaded" && autoLoadMeta && (
          <>
            <Sparkles className="w-4 h-4 mt-0.5 text-acr-pos flex-shrink-0" aria-hidden="true" />
            <div className="text-sm flex-1">
              <p className="font-semibold text-acr-pos">Loaded {autoLoadMeta.count} comps from {county} County</p>
              <p className="text-muted-foreground">Source: ATTOM Data recent sales (last 18 months, ±50% acreage). Add or remove any below.</p>
            </div>
            <Button variant="ghost" size="sm" className="min-h-11 pointer-fine:sm:min-h-9" onClick={() => autoLoadComps(true)} aria-label="Refresh comps from county">
              <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" /> Refresh
            </Button>
          </>
        )}
        {autoLoadState === "empty" && (
          <>
            <AlertTriangle className="w-4 h-4 mt-0.5 text-acr-warn flex-shrink-0" aria-hidden="true" />
            <div className="text-sm flex-1">
              <p className="font-semibold text-acr-warn">No recent comps auto-pulled for {county} County</p>
              <p className="text-muted-foreground">{autoLoadMeta?.fallback || "Add comps manually below — assessor records, LandWatch, or eBay sold listings."}</p>
            </div>
            <Button variant="ghost" size="sm" className="min-h-11 pointer-fine:sm:min-h-9" onClick={() => autoLoadComps(true)} aria-label="Retry comp auto-pull">
              <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" /> {Verbs.RETRY}
            </Button>
          </>
        )}
        {autoLoadState === "error" && (
          <>
            <AlertTriangle className="w-4 h-4 mt-0.5 text-acr-warn flex-shrink-0" aria-hidden="true" />
            <div className="text-sm flex-1">
              <p className="font-semibold text-acr-warn">Comps couldn't load — paste manually</p>
              <p className="text-muted-foreground">Network or ATTOM hiccup. The manual form below works as the fallback.</p>
            </div>
            <Button variant="ghost" size="sm" className="min-h-11 pointer-fine:sm:min-h-9" onClick={() => autoLoadComps(true)} aria-label="Retry comp auto-pull">
              <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" /> {Verbs.RETRY}
            </Button>
          </>
        )}
        {autoLoadState === "idle" && (
          <>
            <BarChart2 className="w-4 h-4 mt-0.5 text-muted-foreground flex-shrink-0" aria-hidden="true" />
            <div className="text-sm flex-1">
              <p className="font-semibold">Pull comps automatically</p>
              <p className="text-muted-foreground">Recent land sales for {county || "this county"}, {state || "your state"} — ATTOM Data.</p>
            </div>
            <Button variant="outline" size="sm" className="min-h-11 pointer-fine:sm:min-h-9" onClick={() => autoLoadComps(true)} disabled={!state || !county}>
              <Sparkles className="w-3 h-3 mr-1" aria-hidden="true" /> Auto-load
            </Button>
          </>
        )}
      </div>

      <div className="rounded-xl border border-acr-warn-soft bg-acr-warn-soft dark:border-acr-warn-soft/50 dark:bg-acr-warn-soft/10 p-4">
        <p className="text-sm font-semibold text-acr-warn dark:text-acr-warn mb-2">Where to find comps:</p>
        <ul className="text-sm text-acr-warn dark:text-acr-warn space-y-1 list-none p-0 m-0">
          <li>• <strong>County assessor records</strong> — real transaction data (best source)</li>
          <li>• <strong>LandWatch.com</strong> → Sold listings filter</li>
          <li>• <strong>Land and Farm / Lands of America</strong> → Sold section</li>
          <li>• <strong>eBay</strong> → Completed listings → Land → your county</li>
          <li>• Goal: 5-10 comps, last 12-18 months, similar acreage</li>
        </ul>
      </div>

      {/* Add comp form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Add a comparable sale</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
            onSubmit={(e) => { e.preventDefault(); addComp(); }}
          >
            <div>
              <Label htmlFor={ppaId} className="text-xs">Price per acre ($)</Label>
              <Input id={ppaId} type="number" inputMode="decimal" className="tabular-nums" value={newComp.pricePerAcre} onChange={e => setNewComp(p => ({ ...p, pricePerAcre: e.target.value }))} placeholder="e.g. 1200" />
            </div>
            <div>
              <Label htmlFor={acreageId} className="text-xs">Acreage</Label>
              <Input id={acreageId} type="number" inputMode="decimal" className="tabular-nums" value={newComp.acres} onChange={e => setNewComp(p => ({ ...p, acres: e.target.value }))} placeholder="e.g. 5" />
            </div>
            <div>
              <Label htmlFor={sourceId} className="text-xs">Source</Label>
              <Select value={newComp.source} onValueChange={v => setNewComp(p => ({ ...p, source: v }))}>
                <SelectTrigger id={sourceId}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="county_records">County records</SelectItem>
                  <SelectItem value="landwatch">LandWatch</SelectItem>
                  <SelectItem value="land_and_farm">Land and Farm</SelectItem>
                  <SelectItem value="ebay">eBay (sold)</SelectItem>
                  <SelectItem value="mls">MLS</SelectItem>
                  <SelectItem value="user_entered">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full">Add comp</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Comp list */}
      {comps.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{comps.length} comp{comps.length === 1 ? "" : "s"} entered</h3>
            {lowestComp > 0 && (
              <p className="text-sm text-muted-foreground">Lowest: <span className="font-bold tabular-nums">{fmt(lowestComp)}/acre</span> → Target offer: <span className="font-bold tabular-nums text-acr-pos">{fmt(lowestComp * 0.25)}/acre</span></p>
            )}
          </div>
          <ul className="space-y-2 list-none p-0 m-0" aria-label="Comparable sales">
            {sortedComps.map((comp, i) => {
              const sourceLabel = comp.source.replace(/_/g, " ");
              return (
                <li key={i} className={`flex items-center gap-3 p-3 rounded-card border ${i === 0 ? "border-acr-pos bg-acr-pos-soft dark:border-acr-pos-soft dark:bg-acr-pos-soft/10" : "border-border"}`}>
                  {i === 0 && <Badge className="bg-acr-pos-soft text-acr-pos-soft-ink dark:bg-acr-pos-soft/30 dark:text-acr-pos-soft-ink text-xs" aria-label="Lowest comp">Lowest</Badge>}
                  <div className="flex-1 grid grid-cols-3 gap-2 text-sm">
                    <span className="font-semibold tabular-nums">{fmt(comp.pricePerAcre)}/acre</span>
                    <span className="text-muted-foreground tabular-nums">{comp.acres} acres</span>
                    <span className="text-muted-foreground capitalize">{sourceLabel}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeComp(comps.indexOf(comp))}
                    className="text-muted-foreground hover:text-destructive active:text-destructive text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive rounded px-2 py-2 -my-2 min-h-11 pointer-fine:sm:min-h-0"
                    aria-label={`Remove ${fmt(comp.pricePerAcre)} per acre comp from ${sourceLabel}`}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {comps.length === 0 && (
        <div className="p-4 rounded-card border border-dashed border-muted-foreground/30 text-center text-sm text-muted-foreground">
          No comps entered yet. You can proceed without comps — the system will use USDA land-value benchmarks.
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back</Button>
        <Button onClick={onNext} className="flex-1">
          Calculate offer <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

interface StepCalculateProps {
  report: OfferReport | null;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  onNext: () => void;
  onBack: () => void;
}

/** Report-shaped skeleton: mirrors the USDA context strip + three offer-tier
 *  cards so the user sees the offer taking shape while the formula runs. */
function CalculateSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div role="status" aria-live="polite" className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />
        <div>
          <p className="font-semibold text-sm">Calculating your offer…</p>
          <p className="text-xs text-muted-foreground">Pulling USDA land values, analyzing comps, running the offer formula.</p>
        </div>
      </div>
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <Skeleton className="h-3 w-20" announce={false} />
                <Skeleton className="h-6 w-24" announce={false} />
                <Skeleton className="h-3 w-16" announce={false} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4 space-y-3">
            <Skeleton className="h-4 w-32" announce={false} />
            <Skeleton className="h-8 w-24" announce={false} />
            <Skeleton className="h-3 w-28" announce={false} />
            <Skeleton className="h-3 w-full" announce={false} />
          </div>
        ))}
      </div>
      <Skeleton className="h-20 w-full rounded-xl" announce={false} />
    </div>
  );
}

function StepCalculate({ report, isLoading, error, onRetry, onNext, onBack }: StepCalculateProps) {
  if (isLoading) {
    return <CalculateSkeleton />;
  }

  if (!report) {
    return (
      <div className="space-y-4">
        <QueryErrorState
          error={error ? new Error(error) : null}
          onRetry={onRetry}
          isRetrying={isLoading}
          title="Couldn't generate the offer report"
          description="Your county, acreage, and comps are all preserved. Most retries succeed — or go back and refine the comp set."
          testId="blind-offer-calculate-error"
        />
        <div className="flex justify-center">
          <Button variant="outline" onClick={onBack} className="min-h-11 pointer-fine:sm:min-h-9">
            <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back to comp research
          </Button>
        </div>
      </div>
    );
  }

  const tiers = [
    { key: "aggressive", label: "Ultra-motivated (20%)", color: "border-acr-warn bg-acr-warn-soft dark:border-acr-warn-soft dark:bg-acr-warn-soft/10" },
    { key: "standard", label: "Standard (25%)", color: "border-acr-accent bg-acr-accent dark:border-acr-accent dark:bg-acr-accent/10" },
    { key: "competitive", label: "Hot market (33%)", color: "border-acr-brand bg-acr-brand-soft dark:border-acr-brand-soft dark:bg-acr-brand-soft/10" },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Step 3: Offer calculation</h2>
        <p className="text-sm text-muted-foreground">Based on {report.compAnalysis.compCount} comp{report.compAnalysis.compCount === 1 ? "" : "s"} and USDA data for {report.county} County, {report.state}.</p>
      </div>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <ul className="space-y-2 list-none p-0 m-0" aria-label="Calculation warnings">
          {report.warnings.map((w: string, i: number) => (
            <li key={i} className="flex gap-2 p-3 rounded-card border border-acr-warn-soft bg-acr-warn-soft dark:border-acr-warn-soft/50 dark:bg-acr-warn-soft/10 text-sm text-acr-warn-soft-ink dark:text-acr-warn-soft-ink" role="alert">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      {/* USDA Context */}
      <Card>
        <CardContent className="p-4">
          <dl className="grid grid-cols-3 gap-4 text-center m-0">
            <div>
              <dt className="text-xs text-muted-foreground">USDA land value</dt>
              <dd className="text-xl font-bold tabular-nums m-0">
                {report.marketContext.usdaLandValuePerAcre === null
                  ? "—"
                  : `${fmt(report.marketContext.usdaLandValuePerAcre)}/ac`}
              </dd>
              <p className="text-xs text-muted-foreground">
                {report.marketContext.usdaLandValuePerAcre === null
                  ? "No USDA value on file for this county"
                  : "Pastureland benchmark"}
              </p>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Lowest comp</dt>
              <dd className="text-xl font-bold tabular-nums m-0">{fmt(report.compAnalysis.lowestSalePerAcre)}/ac</dd>
              <p className="text-xs text-muted-foreground">Comp anchor</p>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">5-yr appreciation</dt>
              <dd className="text-xl font-bold tabular-nums m-0">{report.marketContext.usdaCagr5Year.toFixed(1)}%/yr</dd>
              <p className="text-xs text-muted-foreground">USDA CAGR</p>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Three tiers */}
      <ul className="grid grid-cols-1 md:grid-cols-3 gap-4 list-none p-0 m-0" aria-label="Offer tiers">
        {tiers.map(({ key, label, color }) => {
          const tier = report.offerTiers[key];
          const isRecommended = report.recommendedTier === key;
          return (
            <li
              key={key}
              className={`rounded-xl border p-4 relative ${color} ${isRecommended ? "ring-2 ring-primary" : ""}`}
              aria-current={isRecommended ? "true" : undefined}
              aria-label={`${label} offer ${fmt(tier.offerTotal)}${isRecommended ? " (recommended)" : ""}`}
            >
              {isRecommended && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">Recommended</Badge>
              )}
              <p className="font-semibold text-sm mb-3">{label}</p>
              <p className="text-2xl font-black tabular-nums mb-1">{fmt(tier.offerTotal)}</p>
              <p className="text-xs text-muted-foreground mb-2 tabular-nums">{fmt(report.compAnalysis.lowestSalePerAcre * tier.pctOfLowestComp / 100)}/ac × {report.targetAcres} acres</p>
              <p className="text-xs text-muted-foreground">{tier.acceptanceRateForecast}</p>
            </li>
          );
        })}
      </ul>

      {/* Recommendation reason */}
      <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
        <p className="text-sm font-semibold mb-1">Why this offer?</p>
        <p className="text-sm text-muted-foreground">{report.recommendationReason}</p>
      </div>

      {/* eBay note */}
      <div className="p-3 rounded-card border border-border text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">eBay validation: </span>
        {report.marketContext.ebayValidationNote}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back</Button>
        <Button onClick={onNext} className="flex-1">
          View exit strategies <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

interface StepExitProps {
  report: OfferReport | null;
  onNext: () => void;
  onBack: () => void;
  onGoToComps: () => void;
}

function StepExit({ report, onNext, onBack, onGoToComps }: StepExitProps) {
  if (!report) {
    return (
      <EmptyState
        icon={Calculator}
        headline="No offer report yet"
        subtitle="Exit strategies are built from your calculated offer. Run the comp research and offer calculation first — your county and acreage are saved."
        cta={{
          label: "Go to comp research",
          onClick: onGoToComps,
          "data-testid": "blind-offer-exit-no-report",
        }}
        actionIcon={null}
        testId="blind-offer-exit-empty"
      />
    );
  }
  const { cashFlipScenario: cf, ownerFinanceScenario: of_ } = report;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Step 4: Exit strategy</h2>
        <p className="text-sm text-muted-foreground">Compare cash flip vs. owner financing. Most land investors start with cash flips, then build to a note portfolio.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Cash flip */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cash flip</CardTitle>
            <CardDescription>Buy, list, and sell within 30-45 days.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 m-0">
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">List price</dt>
                <dd className="font-semibold tabular-nums m-0">{fmt(cf.salePrice)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Net profit</dt>
                <dd className="font-bold tabular-nums text-acr-pos m-0">{fmt(cf.netProfit)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">ROI on total cost</dt>
                <dd className="font-bold tabular-nums m-0">
                  {cf.roi === null ? "Not applicable" : `${cf.roi}%`}
                </dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Hold period</dt>
                <dd className="font-semibold tabular-nums m-0">{cf.holdingPeriodDays} days</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Annualized ROI</dt>
                <dd className="font-bold tabular-nums text-acr-accent m-0">
                  {cf.annualizedROI === null ? "Not applicable" : `${cf.annualizedROI}%`}
                </dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Breakeven sale</dt>
                <dd className="font-semibold tabular-nums m-0">{fmt(cf.breakevenSale)}</dd>
              </div>
            </dl>

            {/* WHOSE NUMBERS THESE ARE.
                Every cost above rests on a rule that is either the operator's
                or ours, and until 2026-08-19 they were unattributed constants
                compiled into the calculator. Badging them is what stops a
                platform default from later reading as what the customer
                believed. */}
            {cf.assumptions?.length > 0 && (
              <div className="mt-4 border-t pt-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Based on these assumptions
                </p>
                <ul className="space-y-1 m-0 list-none p-0">
                  {cf.assumptions.map((a) => (
                    <li key={a.key} className="flex justify-between text-xs gap-2">
                      <span className="text-muted-foreground">{a.label}</span>
                      <span className="flex items-center gap-1.5 tabular-nums">
                        {a.display}
                        <Badge
                          variant={a.source === "org_rule" ? "default" : "secondary"}
                          className="text-[10px] px-1.5 py-0"
                        >
                          {a.source === "org_rule" ? "Your rule" : "Our default"}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Owner finance */}
        <Card className="border-acr-pos-soft dark:border-acr-pos-soft">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Owner financing</CardTitle>
              <Badge className="bg-acr-pos-soft text-acr-pos-soft-ink dark:bg-acr-pos-soft/30 dark:text-acr-pos-soft-ink">Wealth-building</Badge>
            </div>
            <CardDescription>9% interest, 84-month note — pure passive income.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 m-0">
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Sale price</dt>
                <dd className="font-semibold tabular-nums m-0">{fmt(of_.salePrice)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Down payment</dt>
                <dd className="font-semibold tabular-nums text-acr-accent m-0">{fmt(of_.downPayment)} (capital recovered)</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Monthly payment</dt>
                <dd className="font-bold tabular-nums text-acr-pos m-0">{fmt(of_.monthlyPayment)}/mo × 84 months</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Total collected</dt>
                <dd className="font-bold tabular-nums m-0">{fmt(of_.totalCollected)}</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Total ROI</dt>
                <dd className="font-bold tabular-nums text-acr-pos m-0">{of_.roi}%</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Hybrid recommendation */}
      <div className="p-4 rounded-xl border border-acr-warn-soft bg-acr-warn-soft dark:border-acr-warn-soft/50 dark:bg-acr-warn-soft/10">
        <div className="flex gap-3">
          <Star className="w-4 h-4 text-acr-warn mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold text-acr-warn dark:text-acr-warn mb-1">Strategic recommendation</p>
            <p className="text-acr-warn dark:text-acr-warn">{report.hybridRecommendation}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back</Button>
        <Button onClick={onNext} className="flex-1">
          Generate offer letter <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

interface StepLetterProps {
  report: OfferReport | null;
  /**
   * The parcel this offer is about, when the operator arrived from one.
   * `maps.tsx` and `parcel-detail.tsx` have always linked in with it; until
   * 2026-08-20 the wizard dropped it on the floor. Null means the operator came
   * in cold (county-level exploration), which is a legitimate way to use this
   * wizard and simply cannot produce a decision — a decision is ABOUT a subject.
   */
  propertyId: number | null;
  onBack: () => void;
  onGoToComps: () => void;
}

function StepLetter({ report, propertyId, onBack, onGoToComps }: StepLetterProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<{ decisionSnapshotId: number } | null>(null);
  if (!report) {
    return (
      <EmptyState
        icon={FileText}
        headline="No offer letter yet"
        subtitle="The letter is generated from your calculated offer. Run the comp research and offer calculation first — your inputs are saved."
        cta={{
          label: "Go to comp research",
          onClick: onGoToComps,
          "data-testid": "blind-offer-letter-no-report",
        }}
        actionIcon={null}
        testId="blind-offer-letter-empty"
      />
    );
  }
  const lv = report.letterVariables;
  const warning = findStateWarning(report.state);

  // Carla Mendoza fix: in disclosure-required states (TX, NC, FL, CA) the
  // assignment-disclosure clause has to be in the OFFER LETTER itself —
  // not buried in the contract that follows. Texas Occ. Code § 1101.0045
  // requires the disclosure BEFORE the contract is signed; an offer
  // letter is "before." Without this paragraph, the wholesaler walks into
  // a TREC complaint the moment a seller forwards the letter to a
  // licensee.
  const assignmentDisclosure = warning && warning.severity === "warn"
    ? `\n\nIMPORTANT DISCLOSURE: I am a real-estate investor who buys land directly from sellers. I may, at my option, assign this contract to another buyer prior to closing, or I may close on the property myself. I am not a licensed real-estate broker or agent in ${lv.stateName}, and I am not representing you as your agent. I hold only an equitable interest in any contract we sign — I am the buyer, not your broker.\n`
    : "";

  const letterText = `[Owner's Name]
[Owner's Address]
[City, State ZIP]

Re: Property in ${lv.countyName} County, ${lv.stateName}

Dear Property Owner,

I am a private investor who purchases land in ${lv.countyName} County, and I would like to make you a firm offer to purchase your property.

${lv.urgencyLanguage}

I am prepared to offer you ${lv.offerAmountWords.toUpperCase()} (${fmt(lv.offerAmount)}) for your property. This is a CASH offer and I can close within ${lv.closingTimeline}.

There are NO real estate commissions, NO agent fees, and NO closing costs on your side. The process is simple:

1. You accept this offer
2. I send a simple purchase agreement
3. We close at a title company of your choice within ${lv.closingTimeline}
4. You receive your money
${assignmentDisclosure}
This offer is valid for 21 days from the date of this letter. There is no obligation — simply call or email to accept or to ask any questions.

Please contact me at:
[Your Name]
[Your Phone]
[Your Email]

I look forward to hearing from you.

Sincerely,

[Your Name]
Private Real Estate Investor`;

  async function copyLetter() {
    try {
      await navigator.clipboard.writeText(letterText);
      toast({ title: "Letter copied to clipboard" });
    } catch {
      toast({ variant: "destructive", title: "Couldn't copy letter", description: "Your browser blocked clipboard access. Select the text and copy manually." });
    }
  }

  /**
   * Record the decision this letter represents.
   *
   * Land could compute an offer and never record one: the operator calculated,
   * the report evaporated, and nothing could grade the choice later. Every
   * other strategy in AcreOS writes into the canonical loop at the moment a
   * number becomes a document — this is that moment for land.
   *
   * The two tiers NOT taken are sent as alternatives, because they are: the
   * wizard showed three and the operator picked one.
   */
  async function commitDecision() {
    if (!report || !propertyId) return;
    setCommitting(true);
    try {
      const tiers = ["aggressive", "standard", "competitive"] as const;
      const chosen = report.recommendedTier;
      const alternatives = tiers
        .filter((t) => t !== chosen)
        .map((t) => ({
          choice: `${t} — ${fmt(report.offerTiers[t].offerTotal)}`,
          reason: `Not taken. ${report.offerTiers[t].acceptanceRateForecast}`,
        }));

      const resp = await apiRequest("POST", "/api/data-intel/blind-offer/commit", {
        propertyId,
        offerAmount: report.letterVariables.offerAmount,
        salePrice: report.cashFlipScenario.salePrice,
        tier: chosen,
        alternatives,
        // Not asked here, and not manufactured: a made-up review date would
        // make the outcome prompt nag about every offer ever committed.
        reviewDueAt: null,
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data?.message ?? "The decision was not recorded");
      setCommitted({ decisionSnapshotId: data.decisionSnapshotId });
      toast({
        title: "Decision recorded",
        description:
          "The offer, the exit you underwrote it to, and the rules behind it are frozen against this parcel.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't record the decision",
        description:
          err instanceof Error
            ? err.message
            : "Nothing was recorded. Your letter is unaffected — try again.",
      });
    } finally {
      setCommitting(false);
    }
  }

  function downloadLetter() {
    const blob = new Blob([letterText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `blind-offer-${report!.county.toLowerCase().replace(/\s+/g, "-")}-${report!.state.toLowerCase()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Letter downloaded", description: "Edit the bracketed fields before mailing." });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Step 5: Blind offer letter</h2>
        <p className="text-sm text-muted-foreground">Your personalized blind offer letter. Customize and mail to the property owner. Keep it simple — one page, specific price, clear call-to-action.</p>
      </div>

      {/* Carla Mendoza fix: re-show the state UPL banner on the letter
          step. Some operators skip step 1 by deep-linking. The
          assignment-disclosure paragraph in the letter is conditional on
          this warning's severity. */}
      <StateUplBanner state={report.state} />

      {/* Offer summary */}
      <dl className="grid grid-cols-3 gap-4 m-0">
        <Card>
          <CardContent className="p-4 text-center">
            <dt className="text-xs text-muted-foreground">Recommended offer</dt>
            <dd className="text-2xl font-black tabular-nums text-acr-pos m-0">{fmt(report.recommendedOfferTotal)}</dd>
            <p className="text-xs text-muted-foreground capitalize">{report.recommendedTier} strategy</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <dt className="text-xs text-muted-foreground">Cash flip target</dt>
            <dd className="text-2xl font-black tabular-nums m-0">{fmt(report.cashFlipScenario.salePrice)}</dd>
            {/* `roi` is null when the offer has no cost basis. Rendering
                "null% ROI" — or silently coercing it to 0 — would present an
                undefined return as a measured break-even. */}
            {report.cashFlipScenario.roi === null ? (
              <p className="text-xs text-muted-foreground">ROI not applicable — no cost basis</p>
            ) : (
              <p className="text-xs text-acr-pos tabular-nums">
                {report.cashFlipScenario.roi}% ROI
                <span className="sr-only"> on total cost in</span>
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <dt className="text-xs text-muted-foreground">Owner-finance monthly</dt>
            <dd className="text-2xl font-black tabular-nums text-acr-accent m-0">{fmt(report.ownerFinanceScenario.monthlyPayment)}</dd>
            <p className="text-xs text-muted-foreground">for 84 months</p>
          </CardContent>
        </Card>
      </dl>

      {/* Letter */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Offer letter template</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="min-h-11 pointer-fine:sm:min-h-9" onClick={copyLetter} aria-label="Copy offer letter to clipboard">
                <Copy className="w-3 h-3 mr-1" aria-hidden="true" /> {Verbs.COPY}
              </Button>
              <Button variant="outline" size="sm" className="min-h-11 pointer-fine:sm:min-h-9" onClick={downloadLetter} aria-label="Download offer letter as a text file">
                <Download className="w-3 h-3 mr-1" aria-hidden="true" /> Download
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground bg-muted/30 rounded-card p-4 leading-relaxed" aria-label="Offer letter draft">
            {letterText}
          </pre>
        </CardContent>
      </Card>

      {/* Campaign sizing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Campaign sizing</CardTitle>
          <CardDescription>How many letters to send for consistent deal flow?</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-3 gap-4 text-center m-0">
            <div className="p-3 rounded-card bg-muted/40">
              <dt className="text-xs text-muted-foreground">Response rate</dt>
              <dd className="text-xl font-bold tabular-nums m-0">~4%</dd>
              <p className="text-xs text-muted-foreground">Industry average</p>
            </div>
            <div className="p-3 rounded-card bg-muted/40">
              <dt className="text-xs text-muted-foreground">Close rate</dt>
              <dd className="text-xl font-bold tabular-nums m-0">~60%</dd>
              <p className="text-xs text-muted-foreground">3 of 5 responses</p>
            </div>
            <div className="p-3 rounded-card bg-muted/40">
              <dt className="text-xs text-muted-foreground">Letters for 1 deal</dt>
              <dd className="text-xl font-bold tabular-nums m-0">~42</dd>
              <p className="text-xs text-muted-foreground">At 4% × 60%</p>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground mt-3 text-center">Mail consistently every month — sellers often respond to your 2nd or 3rd letter, months after the first campaign.</p>
        </CardContent>
      </Card>

      {/* Close the loop: record WHY, not just what. */}
      <Card data-testid="blind-offer-commit-card">
        <CardContent className="p-4 space-y-3">
          <div>
            <h3 className="text-base font-semibold m-0">Record this decision</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Freezes the offer, the exit you underwrote it to, and the rules behind it
              against this parcel — so when you find out whether it landed, the answer
              attaches to what you actually believed at the time.
            </p>
          </div>
          {committed ? (
            <p className="text-sm text-acr-pos m-0" data-testid="blind-offer-commit-done">
              Recorded. Decision #{committed.decisionSnapshotId}.
            </p>
          ) : propertyId ? (
            <Button
              onClick={commitDecision}
              disabled={committing}
              className="w-full min-h-11 pointer-fine:sm:min-h-9"
              data-testid="blind-offer-commit"
            >
              {committing ? "Recording…" : "Record this decision"}
            </Button>
          ) : (
            <p
              className="text-sm text-muted-foreground m-0"
              data-testid="blind-offer-commit-no-parcel"
            >
              A decision is about a parcel, and this session started from a county rather
              than one. Open the parcel and choose “Make an offer with these numbers” to
              record it against that property.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back</Button>
        <Button className="flex-1" onClick={() => setLocation("/direct-mail-campaigns")}>
          <Send className="w-4 h-4 mr-2" aria-hidden="true" /> Launch campaign
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BlindOfferWizardPage() {
  useDocumentTitle("Blind offer wizard");
  const { toast } = useToast();
  // Land Snapshot → wizard prefill (Maren CPO #5): seed step 1 from the
  // confident, provenanced fields the parcel handed us via querystring. Parsed
  // once on mount — only real fields prefill; everything else stays blank.
  const search = useSearch();
  const [prefill] = useState<SnapshotPrefill>(() => parseSnapshotPrefill(search));
  const [currentStep, setCurrentStep] = useState<Step>("county");
  const [state, setState] = useState(prefill.state ?? "");
  const [county, setCounty] = useState(prefill.county ?? "");
  const [acres, setAcres] = useState(prefill.acres ?? 0);
  const [comps, setComps] = useState<Comp[]>([]);
  const [sellerProfile, setSellerProfile] = useState<SellerProfile>({
    isTaxDelinquent: false,
    isOutOfState: false,
    isInherited: false,
    yearsOwned: 0,
  });
  const [report, setReport] = useState<OfferReport | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);

  const stepIndex = STEPS.findIndex(s => s.id === currentStep);

  async function calculateOffer() {
    setIsCalculating(true);
    setCalcError(null);
    try {
      const resp = await apiRequest("POST", "/api/data-intel/blind-offer", {
        state,
        county,
        targetAcres: acres,
        comps: comps.map(c => ({
          pricePerAcre: c.pricePerAcre,
          acres: c.acres,
          totalPrice: c.totalPrice,
          source: c.source,
          notes: c.notes,
        })),
        sellerProfile,
      });
      const data = await resp.json();
      setReport(data);
    } catch (err) {
      setReport(null);
      setCalcError(err instanceof Error ? err.message : "Network error while calculating the offer");
      toast({
        variant: "destructive",
        title: "Couldn't calculate the offer",
        description: "Your inputs are preserved. Try again, or go back and refine the comp set.",
      });
    } finally {
      setIsCalculating(false);
    }
  }

  function goToStep(step: Step) {
    if (step === "calculate" && currentStep === "comps") {
      calculateOffer();
    }
    setCurrentStep(step);
  }

  return (
    <PageShell label="Blind offer wizard">
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Blind offer wizard</h1>
        <p className="text-muted-foreground text-sm md:text-base">Calculate your offer using a proven methodology — the trusted system behind thousands of profitable land deals.</p>
      </div>

      {/* Land Snapshot → wizard prefill notice (Maren CPO #5). Honest: names
          exactly which provenanced fields were carried over from the parcel. */}
      {(prefill.state || prefill.county || prefill.acres) && (
        <div
          className="mb-6 rounded-card border border-acr-pos/40 bg-acr-pos-soft p-3 flex items-start gap-2.5"
          role="status"
          data-testid="blind-offer-prefill-notice"
        >
          <Sparkles className="w-4 h-4 text-acr-pos mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p className="text-sm text-acr-pos">
            Pre-filled from this parcel's Land Snapshot:{" "}
            {[
              prefill.state ? `state ${prefill.state}` : null,
              prefill.county ? `${prefill.county} County` : null,
              prefill.acres ? `${prefill.acres} acres` : null,
            ].filter(Boolean).join(" · ")}. Comps still pull live — review before you mail.
          </p>
        </div>
      )}

      {/* Step progress */}
      <div className="mb-8">
        <ol className="flex items-center gap-2 overflow-x-auto pb-2 list-none p-0 m-0" aria-label="Wizard progress">
          {STEPS.map((step, i) => {
            const isActive = step.id === currentStep;
            const isPast = i < stepIndex;
            const Icon = step.icon;
            return (
              <li key={step.id} className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => isPast && setCurrentStep(step.id)}
                  disabled={!isPast && !isActive}
                  aria-current={isActive ? "step" : undefined}
                  aria-label={`Step ${i + 1} of ${STEPS.length}: ${step.label}${isActive ? " (current)" : isPast ? " (completed)" : " (locked)"}`}
                  className={`flex items-center gap-2 px-3 py-2 min-h-11 rounded-card text-sm font-medium transition-colors ${isActive ? "bg-primary text-primary-foreground" : isPast ? "bg-muted text-foreground cursor-pointer hover:bg-muted/70 active:bg-muted/60" : "bg-muted/40 text-muted-foreground cursor-default"}`}
                >
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden md:block">{step.label}</span>
                </button>
                {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
        <div
          role="progressbar"
          aria-label={`Wizard progress: step ${stepIndex + 1} of ${STEPS.length}`}
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
        >
          <Progress value={((stepIndex + 1) / STEPS.length) * 100} className="h-1 mt-3" aria-hidden="true" />
        </div>
      </div>

      {/* Step content */}
      <div className="max-w-3xl">
        {currentStep === "county" && (
          <StepCounty
            state={state} setState={setState}
            county={county} setCounty={setCounty}
            acres={acres} setAcres={setAcres}
            sellerProfile={sellerProfile} setSellerProfile={setSellerProfile}
            onNext={() => goToStep("comps")}
          />
        )}
        {currentStep === "comps" && (
          <StepComps
            state={state} county={county} acres={acres}
            comps={comps} setComps={setComps}
            onNext={() => goToStep("calculate")}
            onBack={() => setCurrentStep("county")}
          />
        )}
        {currentStep === "calculate" && (
          <StepCalculate
            report={report}
            isLoading={isCalculating}
            error={calcError}
            onRetry={calculateOffer}
            onNext={() => setCurrentStep("exit")}
            onBack={() => setCurrentStep("comps")}
          />
        )}
        {currentStep === "exit" && (
          <StepExit
            report={report}
            onNext={() => setCurrentStep("letter")}
            onBack={() => setCurrentStep("calculate")}
            onGoToComps={() => setCurrentStep("comps")}
          />
        )}
        {currentStep === "letter" && (
          <StepLetter
            report={report}
            propertyId={prefill.propertyId ?? null}
            onBack={() => setCurrentStep("exit")}
            onGoToComps={() => setCurrentStep("comps")}
          />
        )}
      </div>
    </PageShell>
  );
}
