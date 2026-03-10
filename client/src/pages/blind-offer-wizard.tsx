import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
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

function fmt(n: number) {
  if (!n || isNaN(n)) return "$0";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
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
  podolskyOfferPerAcre: number;
  podolskyOfferTotal: number;
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
  { id: "county", label: "County Selection", icon: MapPin },
  { id: "comps", label: "Comp Research", icon: BarChart2 },
  { id: "calculate", label: "Offer Calculation", icon: Calculator },
  { id: "exit", label: "Exit Strategy", icon: TrendingUp },
  { id: "letter", label: "Offer Letter", icon: FileText },
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
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Step 1: County & Property Details</h2>
        <p className="text-sm text-muted-foreground">Select the county you're targeting. The system will pull USDA land value benchmarks and demographic data.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label>State</Label>
          <Select value={state} onValueChange={setState}>
            <SelectTrigger>
              <SelectValue placeholder="Select state..." />
            </SelectTrigger>
            <SelectContent>
              {US_STATES.map(s => (
                <SelectItem key={s.code} value={s.code}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>County</Label>
          <Input value={county} onChange={e => setCounty(e.target.value)} placeholder="e.g. Mohave, Pinal, San Juan..." />
        </div>
        <div>
          <Label>Parcel Size (acres)</Label>
          <Input type="number" value={acres || ""} onChange={e => setAcres(parseFloat(e.target.value) || 0)} placeholder="e.g. 5" min="0.01" step="0.1" />
        </div>
      </div>

      <div>
        <h3 className="font-semibold text-sm mb-3">Seller Profile (optional — improves offer tier recommendation)</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { key: "isTaxDelinquent", label: "Tax Delinquent" },
            { key: "isOutOfState", label: "Out-of-State Owner" },
            { key: "isInherited", label: "Inherited Property" },
          ].map(({ key, label }) => (
            <label key={key} className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${sellerProfile[key] ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}>
              <input
                type="checkbox"
                checked={!!sellerProfile[key]}
                onChange={e => setSellerProfile((p: any) => ({ ...p, [key]: e.target.checked }))}
                className="hidden"
              />
              <div className={`w-4 h-4 rounded border flex items-center justify-center ${sellerProfile[key] ? "bg-primary border-primary" : "border-input"}`}>
                {sellerProfile[key] && <CheckCircle className="w-3 h-3 text-primary-foreground" />}
              </div>
              <span className="text-xs font-medium">{label}</span>
            </label>
          ))}
          <div>
            <Label className="text-xs">Years Owned</Label>
            <Input
              type="number"
              value={sellerProfile.yearsOwned || ""}
              onChange={e => setSellerProfile((p: any) => ({ ...p, yearsOwned: parseInt(e.target.value) || 0 }))}
              placeholder="Years"
              className="mt-1"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-900/10 p-4">
        <div className="flex gap-3">
          <Star className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-800 dark:text-blue-300">
            <p className="font-semibold mb-1">County Selection Wisdom</p>
            <p>Validate your county before mailing: search eBay's sold land listings for this county. If you find 10+ listings with multiple bidders, the model works here. No bidders = no buyer market. Counties within 2-3 hours of a major metro consistently outperform remote rural counties.</p>
          </div>
        </div>
      </div>

      <Button onClick={onNext} disabled={!canProceed} className="w-full">
        Continue to Comp Research <ChevronRight className="w-4 h-4 ml-1" />
      </Button>
    </div>
  );
}

function StepComps({ state, county, comps, setComps, onNext, onBack }: any) {
  const [newComp, setNewComp] = useState({ pricePerAcre: "", acres: "", source: "county_records", notes: "" });

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
        <h2 className="text-xl font-bold mb-1">Step 2: Comparable Sales Research</h2>
        <p className="text-sm text-muted-foreground">Enter recent sold comps for {county} County, {state}. The system also pulls USDA land value benchmarks automatically.</p>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10 p-4">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-2">Where to find comps:</p>
        <ul className="text-sm text-amber-700 dark:text-amber-400 space-y-1">
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
          <CardTitle className="text-sm">Add a Comparable Sale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Price/Acre ($)</Label>
              <Input value={newComp.pricePerAcre} onChange={e => setNewComp(p => ({ ...p, pricePerAcre: e.target.value }))} placeholder="e.g. 1200" />
            </div>
            <div>
              <Label className="text-xs">Acreage</Label>
              <Input value={newComp.acres} onChange={e => setNewComp(p => ({ ...p, acres: e.target.value }))} placeholder="e.g. 5" />
            </div>
            <div>
              <Label className="text-xs">Source</Label>
              <Select value={newComp.source} onValueChange={v => setNewComp(p => ({ ...p, source: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="county_records">County Records</SelectItem>
                  <SelectItem value="landwatch">LandWatch</SelectItem>
                  <SelectItem value="land_and_farm">Land and Farm</SelectItem>
                  <SelectItem value="ebay">eBay Sold</SelectItem>
                  <SelectItem value="mls">MLS</SelectItem>
                  <SelectItem value="user_entered">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={addComp} className="w-full">Add Comp</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Comp list */}
      {comps.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{comps.length} comp(s) entered</h3>
            {lowestComp > 0 && (
              <p className="text-sm text-muted-foreground">Lowest: <span className="font-bold">{fmt(lowestComp)}/acre</span> → Podolsky offer: <span className="font-bold text-green-600">{fmt(lowestComp * 0.25)}/acre</span></p>
            )}
          </div>
          {sortedComps.map((comp, i) => (
            <div key={i} className={`flex items-center gap-3 p-3 rounded-lg border ${i === 0 ? "border-green-300 bg-green-50 dark:border-green-900 dark:bg-green-900/10" : "border-border"}`}>
              {i === 0 && <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs">Lowest</Badge>}
              <div className="flex-1 grid grid-cols-3 gap-2 text-sm">
                <span className="font-semibold">{fmt(comp.pricePerAcre)}/acre</span>
                <span className="text-muted-foreground">{comp.acres} acres</span>
                <span className="text-muted-foreground capitalize">{comp.source.replace(/_/g, " ")}</span>
              </div>
              <button onClick={() => removeComp(comps.indexOf(comp))} className="text-muted-foreground hover:text-destructive text-xs">Remove</button>
            </div>
          ))}
        </div>
      )}

      {comps.length === 0 && (
        <div className="p-4 rounded-lg border border-dashed border-muted-foreground/30 text-center text-sm text-muted-foreground">
          No comps entered yet. You can proceed without comps — the system will use USDA land value benchmarks.
        </div>
      )}

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
        <Button onClick={onNext} className="flex-1">
          Calculate Offer <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function StepCalculate({ report, isLoading, onNext, onBack }: any) {
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <p className="font-semibold">Calculating your offer...</p>
        <p className="text-sm text-muted-foreground">Pulling USDA land values, analyzing comps, running Podolsky formula</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-3" />
        <p className="font-semibold">Error generating offer report</p>
        <Button variant="outline" onClick={onBack} className="mt-4">Go Back</Button>
      </div>
    );
  }

  const tiers = [
    { key: "aggressive", label: "Ultra-Motivated (20%)", color: "border-orange-300 bg-orange-50 dark:border-orange-900 dark:bg-orange-900/10" },
    { key: "standard", label: "Podolsky Standard (25%)", color: "border-blue-300 bg-blue-50 dark:border-blue-900 dark:bg-blue-900/10" },
    { key: "competitive", label: "Hot Market (33%)", color: "border-purple-300 bg-purple-50 dark:border-purple-900 dark:bg-purple-900/10" },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Step 3: Offer Calculation</h2>
        <p className="text-sm text-muted-foreground">Based on {report.compAnalysis.compCount} comp(s) and USDA data for {report.county} County, {report.state}</p>
      </div>

      {/* Warnings */}
      {report.warnings.length > 0 && (
        <div className="space-y-2">
          {report.warnings.map((w: string, i: number) => (
            <div key={i} className="flex gap-2 p-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900/50 dark:bg-yellow-900/10 text-sm text-yellow-800 dark:text-yellow-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* USDA Context */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-muted-foreground">USDA Land Value</p>
              <p className="text-xl font-bold">{fmt(report.marketContext.usdaLandValuePerAcre)}/ac</p>
              <p className="text-xs text-muted-foreground">Pastureland benchmark</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Lowest Comp</p>
              <p className="text-xl font-bold">{fmt(report.compAnalysis.lowestSalePerAcre)}/ac</p>
              <p className="text-xs text-muted-foreground">Podolsky anchor</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">5-Yr Appreciation</p>
              <p className="text-xl font-bold">{report.marketContext.usdaCagr5Year.toFixed(1)}%/yr</p>
              <p className="text-xs text-muted-foreground">USDA CAGR</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Three tiers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tiers.map(({ key, label, color }) => {
          const tier = report.offerTiers[key];
          const isRecommended = report.recommendedTier === key;
          return (
            <div key={key} className={`rounded-xl border p-4 relative ${color} ${isRecommended ? "ring-2 ring-primary" : ""}`}>
              {isRecommended && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground">Recommended</Badge>
              )}
              <p className="font-semibold text-sm mb-3">{label}</p>
              <p className="text-2xl font-black mb-1">{fmt(tier.offerTotal)}</p>
              <p className="text-xs text-muted-foreground mb-2">{fmt(report.compAnalysis.lowestSalePerAcre * tier.pctOfLowestComp / 100)}/ac × {report.targetAcres} acres</p>
              <p className="text-xs text-muted-foreground">{tier.acceptanceRateForecast}</p>
            </div>
          );
        })}
      </div>

      {/* Recommendation reason */}
      <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
        <p className="text-sm font-semibold mb-1">Why this offer?</p>
        <p className="text-sm text-muted-foreground">{report.recommendationReason}</p>
      </div>

      {/* eBay note */}
      <div className="p-3 rounded-lg border border-border text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">eBay Validation: </span>
        {report.marketContext.ebayValidationNote}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
        <Button onClick={onNext} className="flex-1">
          View Exit Strategies <ChevronRight className="w-4 h-4 ml-1" />
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
        <h2 className="text-xl font-bold mb-1">Step 4: Exit Strategy</h2>
        <p className="text-sm text-muted-foreground">Compare cash flip vs. owner financing. Most land investors start with cash flips, then build to a note portfolio.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Cash flip */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cash Flip</CardTitle>
            <CardDescription>Buy, list, and sell within 30-45 days</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">List Price</span>
              <span className="font-semibold">{fmt(cf.salePrice)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Net Profit</span>
              <span className="font-bold text-green-600">{fmt(cf.netProfit)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">ROI</span>
              <span className="font-bold">{cf.roi}%</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Hold Period</span>
              <span className="font-semibold">{cf.holdingPeriodDays} days</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Annualized ROI</span>
              <span className="font-bold text-blue-600">{cf.annualizedROI}%</span>
            </div>
          </CardContent>
        </Card>

        {/* Owner finance */}
        <Card className="border-green-200 dark:border-green-900">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Owner Financing</CardTitle>
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Wealth Building</Badge>
            </div>
            <CardDescription>9% interest, 84-month note — pure passive income</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Sale Price</span>
              <span className="font-semibold">{fmt(of_.salePrice)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Down Payment</span>
              <span className="font-semibold text-blue-600">{fmt(of_.downPayment)} (capital recovered!)</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Monthly Payment</span>
              <span className="font-bold text-green-600">{fmt(of_.monthlyPayment)}/mo × 84 months</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Collected</span>
              <span className="font-bold">{fmt(of_.totalCollected)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total ROI</span>
              <span className="font-bold text-green-600">{of_.roi}%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Hybrid recommendation */}
      <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-900/10">
        <div className="flex gap-3">
          <Star className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300 mb-1">Strategic Recommendation</p>
            <p className="text-amber-700 dark:text-amber-400">{report.hybridRecommendation}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
        <Button onClick={onNext} className="flex-1">
          Generate Offer Letter <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function StepLetter({ report, onBack }: any) {
  const { toast } = useToast();
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
Private Land Investor`;

  function copyLetter() {
    navigator.clipboard.writeText(letterText);
    toast({ title: "Letter copied to clipboard" });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold mb-1">Step 5: Blind Offer Letter</h2>
        <p className="text-sm text-muted-foreground">Your personalized blind offer letter. Customize and mail to the property owner. Keep it simple — one page, specific price, clear call-to-action.</p>
      </div>

      {/* Offer summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Recommended Offer</p>
            <p className="text-2xl font-black text-green-600">{fmt(report.recommendedOfferTotal)}</p>
            <p className="text-xs text-muted-foreground capitalize">{report.recommendedTier} strategy</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Cash Flip Target</p>
            <p className="text-2xl font-black">{fmt(report.cashFlipScenario.salePrice)}</p>
            <p className="text-xs text-green-600">{report.cashFlipScenario.roi}% ROI</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-muted-foreground">Owner Finance Monthly</p>
            <p className="text-2xl font-black text-blue-600">{fmt(report.ownerFinanceScenario.monthlyPayment)}</p>
            <p className="text-xs text-muted-foreground">for 84 months</p>
          </CardContent>
        </Card>
      </div>

      {/* Letter */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Offer Letter Template</CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={copyLetter}>
                <Copy className="w-3 h-3 mr-1" /> Copy
              </Button>
              <Button variant="outline" size="sm">
                <Download className="w-3 h-3 mr-1" /> Download
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground bg-muted/30 rounded-lg p-4 leading-relaxed">
            {letterText}
          </pre>
        </CardContent>
      </Card>

      {/* Campaign sizing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Campaign Sizing</CardTitle>
          <CardDescription>How many letters to send for consistent deal flow?</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="p-3 rounded-lg bg-muted/40">
              <p className="text-xs text-muted-foreground">Response Rate</p>
              <p className="text-xl font-bold">~4%</p>
              <p className="text-xs text-muted-foreground">Industry average</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40">
              <p className="text-xs text-muted-foreground">Close Rate</p>
              <p className="text-xl font-bold">~60%</p>
              <p className="text-xs text-muted-foreground">3 of 5 responses</p>
            </div>
            <div className="p-3 rounded-lg bg-muted/40">
              <p className="text-xs text-muted-foreground">Letters for 1 deal</p>
              <p className="text-xl font-bold">~42</p>
              <p className="text-xs text-muted-foreground">At 4% × 60%</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3 text-center">Mail consistently every month — sellers often respond to your 2nd or 3rd letter, months after the first campaign.</p>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack}><ChevronLeft className="w-4 h-4 mr-1" /> Back</Button>
        <Button className="flex-1" onClick={() => window.location.href = "/direct-mail-campaigns"}>
          <Send className="w-4 h-4 mr-2" /> Launch Campaign
        </Button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BlindOfferWizardPage() {
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
      // Use mock report for UI development
      setReport(null);
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
    <PageShell>
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">Blind Offer Wizard</h1>
        <p className="text-muted-foreground text-sm md:text-base">Calculate your offer using the Podolsky formula — the proven system behind thousands of profitable land deals</p>
      </div>

      {/* Step progress */}
      <div className="mb-8">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {STEPS.map((step, i) => {
            const isActive = step.id === currentStep;
            const isPast = i < stepIndex;
            const Icon = step.icon;
            return (
              <div key={step.id} className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => isPast && setCurrentStep(step.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive ? "bg-primary text-primary-foreground" : isPast ? "bg-muted text-foreground cursor-pointer hover:bg-muted/70" : "bg-muted/40 text-muted-foreground cursor-default"}`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="hidden md:block">{step.label}</span>
                </button>
                {i < STEPS.length - 1 && <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              </div>
            );
          })}
        </div>
        <Progress value={((stepIndex + 1) / STEPS.length) * 100} className="h-1 mt-3" />
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
