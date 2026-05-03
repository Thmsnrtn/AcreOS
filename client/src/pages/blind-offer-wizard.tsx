import { useId, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  ChevronRight, ChevronLeft, MapPin, BarChart2, Calculator, FileText,
  DollarSign, TrendingUp, AlertTriangle, CheckCircle, Star,
  Loader2, Download, Copy, Send,
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface Comp {
  pricePerAcre: number;
  acres: number;
  totalPrice: number;
  source: string;
  notes?: string;
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
    roi: number;
    holdingPeriodDays: number;
    annualizedROI: number;
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
    usdaLandValuePerAcre: number;
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

// ─── Step Components ──────────────────────────────────────────────────────────

function StepCounty({ state, setState, county, setCounty, acres, setAcres, sellerProfile, setSellerProfile, onNext }: any) {
  const canProceed = state && county && acres > 0;
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
          {[
            { key: "isTaxDelinquent", label: "Tax-delinquent owner" },
            { key: "isOutOfState", label: "Out-of-state owner" },
            { key: "isInherited", label: "Inherited property" },
          ].map(({ key, label }) => {
            const cbId = `seller-${key}`;
            const checked = !!sellerProfile[key];
            return (
              <label key={key} htmlFor={cbId} className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${checked ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
                <input
                  id={cbId}
                  type="checkbox"
                  checked={checked}
                  onChange={e => setSellerProfile((p: any) => ({ ...p, [key]: e.target.checked }))}
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
              onChange={e => setSellerProfile((p: any) => ({ ...p, yearsOwned: parseInt(e.target.value) || 0 }))}
              placeholder="Years"
            />
          </div>
        </div>
      </fieldset>

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
        Continue to comp research <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
      </Button>
    </form>
  );
}

function StepComps({ state, county, comps, setComps, onNext, onBack }: any) {
  const [newComp, setNewComp] = useState({ pricePerAcre: "", acres: "", source: "county_records", notes: "" });
  const ppaId = useId();
  const acreageId = useId();
  const sourceId = useId();

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
                <li key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${i === 0 ? "border-acr-pos bg-acr-pos-soft dark:border-acr-pos-soft dark:bg-acr-pos-soft/10" : "border-border"}`}>
                  {i === 0 && <Badge className="bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos text-xs" aria-label="Lowest comp">Lowest</Badge>}
                  <div className="flex-1 grid grid-cols-3 gap-2 text-sm">
                    <span className="font-semibold tabular-nums">{fmt(comp.pricePerAcre)}/acre</span>
                    <span className="text-muted-foreground tabular-nums">{comp.acres} acres</span>
                    <span className="text-muted-foreground capitalize">{sourceLabel}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeComp(comps.indexOf(comp))}
                    className="text-muted-foreground hover:text-destructive text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive rounded px-1"
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
        <div className="p-4 rounded-lg border border-dashed border-muted-foreground/30 text-center text-sm text-muted-foreground">
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

function StepCalculate({ report, isLoading, onNext, onBack }: any) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4" role="status" aria-live="polite">
        <Loader2 className="w-12 h-12 animate-spin text-primary" aria-hidden="true" />
        <p className="font-semibold">Calculating your offer…</p>
        <p className="text-sm text-muted-foreground">Pulling USDA land values, analyzing comps, running offer formula.</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-20" role="alert">
        <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-3" aria-hidden="true" />
        <p className="font-semibold">Couldn't generate offer report</p>
        <p className="text-sm text-muted-foreground mt-1">Your inputs are preserved. Try again or adjust comps and re-run.</p>
        <Button variant="outline" onClick={onBack} className="mt-4">Go back</Button>
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
            <li key={i} className="flex gap-2 p-3 rounded-lg border border-acr-warn-soft bg-acr-warn-soft dark:border-acr-warn-soft/50 dark:bg-acr-warn-soft/10 text-sm text-acr-warn dark:text-acr-warn" role="alert">
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
              <dd className="text-xl font-bold tabular-nums m-0">{fmt(report.marketContext.usdaLandValuePerAcre)}/ac</dd>
              <p className="text-xs text-muted-foreground">Pastureland benchmark</p>
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
      <div className="p-3 rounded-lg border border-border text-sm text-muted-foreground">
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

function StepExit({ report, onNext, onBack }: any) {
  if (!report) return null;
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
                <dt className="text-muted-foreground">ROI</dt>
                <dd className="font-bold tabular-nums m-0">{cf.roi}%</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Hold period</dt>
                <dd className="font-semibold tabular-nums m-0">{cf.holdingPeriodDays} days</dd>
              </div>
              <div className="flex justify-between text-sm">
                <dt className="text-muted-foreground">Annualized ROI</dt>
                <dd className="font-bold tabular-nums text-acr-accent m-0">{cf.annualizedROI}%</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Owner finance */}
        <Card className="border-acr-pos-soft dark:border-acr-pos-soft">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Owner financing</CardTitle>
              <Badge className="bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos">Wealth-building</Badge>
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

function StepLetter({ report, onBack }: any) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  if (!report) return null;
  const lv = report.letterVariables;

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Step 5: Blind offer letter</h2>
        <p className="text-sm text-muted-foreground">Your personalized blind offer letter. Customize and mail to the property owner. Keep it simple — one page, specific price, clear call-to-action.</p>
      </div>

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
            <p className="text-xs text-acr-pos tabular-nums">{report.cashFlipScenario.roi}% ROI</p>
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
              <Button variant="outline" size="sm" onClick={copyLetter} aria-label="Copy offer letter to clipboard">
                <Copy className="w-3 h-3 mr-1" aria-hidden="true" /> Copy
              </Button>
              <Button variant="outline" size="sm" aria-label="Download offer letter">
                <Download className="w-3 h-3 mr-1" aria-hidden="true" /> Download
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground bg-muted/30 rounded-lg p-4 leading-relaxed" aria-label="Offer letter draft">
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
            <div className="p-3 rounded-lg bg-muted/40">
              <dt className="text-xs text-muted-foreground">Response rate</dt>
              <dd className="text-xl font-bold tabular-nums m-0">~4%</dd>
              <p className="text-xs text-muted-foreground">Industry average</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40">
              <dt className="text-xs text-muted-foreground">Close rate</dt>
              <dd className="text-xl font-bold tabular-nums m-0">~60%</dd>
              <p className="text-xs text-muted-foreground">3 of 5 responses</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40">
              <dt className="text-xs text-muted-foreground">Letters for 1 deal</dt>
              <dd className="text-xl font-bold tabular-nums m-0">~42</dd>
              <p className="text-xs text-muted-foreground">At 4% × 60%</p>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground mt-3 text-center">Mail consistently every month — sellers often respond to your 2nd or 3rd letter, months after the first campaign.</p>
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
  const [currentStep, setCurrentStep] = useState<Step>("county");
  const [state, setState] = useState("");
  const [county, setCounty] = useState("");
  const [acres, setAcres] = useState(0);
  const [comps, setComps] = useState<Comp[]>([]);
  const [sellerProfile, setSellerProfile] = useState({
    isTaxDelinquent: false,
    isOutOfState: false,
    isInherited: false,
    yearsOwned: 0,
  });
  const [report, setReport] = useState<OfferReport | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const stepIndex = STEPS.findIndex(s => s.id === currentStep);

  async function calculateOffer() {
    setIsCalculating(true);
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
    } catch {
      setReport(null);
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
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? "bg-primary text-primary-foreground" : isPast ? "bg-muted text-foreground cursor-pointer hover:bg-muted/70" : "bg-muted/40 text-muted-foreground cursor-default"}`}
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
            state={state} county={county}
            comps={comps} setComps={setComps}
            onNext={() => goToStep("calculate")}
            onBack={() => setCurrentStep("county")}
          />
        )}
        {currentStep === "calculate" && (
          <StepCalculate
            report={report}
            isLoading={isCalculating}
            onNext={() => setCurrentStep("exit")}
            onBack={() => setCurrentStep("comps")}
          />
        )}
        {currentStep === "exit" && (
          <StepExit
            report={report}
            onNext={() => setCurrentStep("letter")}
            onBack={() => setCurrentStep("calculate")}
          />
        )}
        {currentStep === "letter" && (
          <StepLetter
            report={report}
            onBack={() => setCurrentStep("exit")}
          />
        )}
      </div>
    </PageShell>
  );
}
