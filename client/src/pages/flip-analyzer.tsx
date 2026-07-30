/**
 * /flip-analyzer — the comps → ARV → MAO → draft-offer chain, in the UI.
 *
 * WHY A PAGE OF ITS OWN (and not a rehabs.tsx tab)
 * ───────────────────────────────────────────────
 * `server/routes-flip-analyzer.ts` + `server/services/flipUnderwriting.ts`
 * shipped mounted and unreachable: a fix-and-flip operator could not compute a
 * Maximum Allowable Offer in-product while Pax's wholesaler persona prompt
 * discusses MAO as if it were available. /rehabs is the POST-acquisition
 * execution surface (project list, budget vs spend, draws) keyed on a rehab
 * row that only exists once you own the house. MAO is a PRE-acquisition
 * decision keyed on a candidate property with no rehab record at all, so it
 * gets its own surface and links back to /rehabs and /parcels/:id.
 *
 * NAV: no new top-level entry. This is a child surface behind the Deals door,
 * reached from the rehab list and from a deep link
 * (/flip-analyzer/:propertyId). The five customer doors are untouched.
 *
 * HONESTY (this is a valuation surface — every number is load-bearing)
 * ───────────────────────────────────────────────────────────────────
 *   - ARV is NEVER pre-filled with an invented number. It comes from the
 *     property's saved `arv_calculations` row (badged with its comp count,
 *     confidence and date), from the operator's own typing, or from an
 *     explicitly-labelled median-$/sqft derivation the operator opts into.
 *   - When comps are unavailable (no ATTOM connection, no coverage, subject not
 *     locatable) the server's own message is rendered VERBATIM and manual ARV
 *     entry stays open. No land comp, no cached number, no silent substitute.
 *   - Every rule that shapes a figure is badged "Your rule" or "AcreOS default
 *     — assumption". Unset holding cost is shown as excluded and named, never
 *     zero-filled, and net profit reads "not computed" rather than an
 *     optimistic number.
 *   - The MAO card is stamped with the inputs it was computed from; editing an
 *     input marks it stale instead of leaving a stale number looking live.
 *
 * MONEY DOCTRINE (founder ruling #15 — be the rail, not the provider)
 * ──────────────────────────────────────────────────────────────────
 * Calculation and a DRAFT offer record only. This page collects no payment,
 * quotes no escrow, and moves no funds.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Calculator,
  FileText,
  Hammer,
  Home,
  Info,
  RefreshCw,
  Ruler,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { RequiredDisclaimer } from "@/components/required-disclaimer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { dollars, formatDate, percent } from "@/lib/format";
import { Verbs } from "@/lib/labels";
import { apiRequest, fetchJsonArray, queryClient } from "@/lib/queryClient";
import type { Property } from "@shared/schema";

// ── server contracts (server/routes-flip-analyzer.ts) ──────────────────────

type RuleSource = "org_rule" | "platform_default";
type FigureSource = RuleSource | "operator_input" | "saved_arv" | "rehab_budget" | "not_set";

interface FlipRuleValues {
  maoRulePct: number;
  rehabContingencyPct: number;
  sellingCostPct: number;
  purchaseClosingPct: number;
  holdMonths: number;
  monthlyHoldingCostCents: number;
  targetProfitPct: number;
}

interface DefaultsResponse {
  values: FlipRuleValues;
  sources: Record<keyof FlipRuleValues, RuleSource>;
  isCustomised: boolean;
  platformDefaults: FlipRuleValues;
}

interface SubjectResponse {
  property: {
    id: number;
    apn: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    squareFeet: number | null;
    locatable: boolean;
  };
  arv: {
    arvCents: number;
    source: "saved_arv";
    confidence: string | null;
    compCount: number;
    calculatedAt: string;
  } | null;
  rehabEstimate: {
    cents: number;
    source: "rehab_budget" | "property_field";
    rehabId: string | number | null;
  } | null;
  monthlyHoldingCostCents: number | null;
  priceCandidates: {
    purchasePriceCents: number | null;
    listPriceCents: number | null;
  };
}

interface CompRow {
  address: string | null;
  soldPriceCents: number;
  soldDate: string | null;
  sqft: number | null;
  distanceMiles: number | null;
  propertyType: string | null;
}

interface CompsResponse {
  status: "ok" | "unavailable" | "no_data";
  reason?: string;
  message?: string;
  comps: CompRow[];
  droppedNoPrice?: number;
  subjectSqft?: number | null;
  credentialSource?: "organization" | "platform";
  provenance?: string;
}

interface Assumption {
  key: string;
  label: string;
  display: string;
  source: FigureSource;
}

interface MaoResponse {
  arvCents: number;
  rehabEstimateCents: number;
  contingencyCents: number;
  rehabWithContingencyCents: number;
  feeCents: number;
  maoRulePct: number;
  maoCents: number;
  ruleProfitCents: number;
  ruleRoiPct: number;
  profitBasis: "operator_price" | "at_mao";
  priceUsedCents: number;
  purchaseClosingCents: number;
  sellingCostCents: number;
  holdingCostCents: number | null;
  totalCashInCents: number;
  netProfitCents: number | null;
  netProfitPctOfArv: number | null;
  netRoiPct: number | null;
  meetsTargetProfit: boolean | null;
  atOrBelowMao: boolean;
  assumptions: Assumption[];
  missing: string[];
  arvSource: "operator_input" | "saved_arv";
  arvBasis: { confidence: string | null; compCount: number; calculatedAt: string } | null;
  rulesAreCustomised: boolean;
}

interface RentalResponse {
  purchasePriceCents: number;
  monthlyRentCents: number;
  annualNoiCents: number;
  monthlyCashFlowCents: number;
  capRatePct: number;
  grossRentMultiplier: number;
  expenseBasis: "operator" | "assumed_40pct";
  cashOnCashNote: string;
  missing: string[];
}

interface OfferResponse {
  offer: { id: number };
  carried: {
    arvCents: number;
    rehabWithContingencyCents: number;
    maoCents: number;
    offerCents: number;
    offerPctOfArv: number;
    netProfitCents: number | null;
  };
  note: string;
}

/** The exact request the displayed MAO was computed from. */
interface MaoRequest {
  propertyId: number | null;
  arvCents: number;
  rehabEstimateCents: number;
  purchasePriceCents: number | null;
  feeCents: number;
}

// ── money boundary (dollars typed by a human ⇄ integer cents on the wire) ──

function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToDollarField(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

function numberField(value: string): number | null {
  const n = Number(value.replace(/[%,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// ── provenance badges ──────────────────────────────────────────────────────

const SOURCE_LABEL: Record<FigureSource, string> = {
  org_rule: "Your rule",
  platform_default: "AcreOS default — assumption",
  operator_input: "You entered this",
  saved_arv: "From your saved ARV",
  rehab_budget: "From the rehab budget",
  not_set: "Not set — excluded",
};

function SourceBadge({ source }: { source: FigureSource }) {
  const variant = source === "org_rule" || source === "operator_input" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="font-normal">
      {SOURCE_LABEL[source]}
    </Badge>
  );
}

/** A figure row: label, value, and where the value came from. Never bare. */
function FigureRow({
  label,
  value,
  note,
  strong,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 py-1.5 border-b border-border last:border-b-0">
      <dt className={strong ? "text-sm font-medium" : "text-sm text-muted-foreground"}>
        {label}
        {note ? <span className="block text-xs text-muted-foreground">{note}</span> : null}
      </dt>
      <dd className={`font-mono tabular-nums ${strong ? "text-base font-semibold" : "text-sm"}`}>
        {value}
      </dd>
    </div>
  );
}

/** The honest-gap surface. Renders the server's own words, verbatim. */
function GapNotice({
  title,
  message,
  testId,
}: {
  title: string;
  message: string;
  testId?: string;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-card border border-acr-warn/50 bg-acr-warn-soft p-3"
      data-testid={testId}
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-acr-warn" aria-hidden="true" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

const RULE_FIELDS: Array<{
  key: keyof FlipRuleValues;
  label: string;
  hint: string;
  kind: "percent" | "months" | "money";
}> = [
  { key: "maoRulePct", label: "MAO rule (% of ARV)", hint: "70 is the classic 70% rule.", kind: "percent" },
  { key: "rehabContingencyPct", label: "Rehab contingency (%)", hint: "Added on top of your rehab estimate.", kind: "percent" },
  { key: "sellingCostPct", label: "Selling cost (% of ARV)", hint: "Agent, closing, concessions on the resale.", kind: "percent" },
  { key: "purchaseClosingPct", label: "Acquisition closing (% of price)", hint: "What it costs you to buy.", kind: "percent" },
  { key: "holdMonths", label: "Hold (months)", hint: "Close to resale.", kind: "months" },
  { key: "monthlyHoldingCostCents", label: "Monthly holding cost ($)", hint: "Taxes, insurance, utilities, interest. Left unset, carry is EXCLUDED from net profit rather than guessed.", kind: "money" },
  { key: "targetProfitPct", label: "Target profit (% of ARV)", hint: "The minimum net you will accept.", kind: "percent" },
];

export default function FlipAnalyzerPage() {
  useDocumentTitle("Flip analyzer — MAO");
  const { toast } = useToast();
  const params = useParams<{ propertyId?: string }>();

  const routePropertyId = params.propertyId ? Number(params.propertyId) : null;
  const [propertyId, setPropertyId] = useState<number | null>(
    routePropertyId !== null && Number.isFinite(routePropertyId) ? routePropertyId : null,
  );

  // Inputs the operator owns. Dollar-denominated text — converted at the wire.
  const [arvField, setArvField] = useState("");
  const [rehabField, setRehabField] = useState("");
  const [priceField, setPriceField] = useState("");
  const [feeField, setFeeField] = useState("");
  /** Set only when the operator opts into a derived ARV; carries its basis. */
  const [arvBasisNote, setArvBasisNote] = useState<string | null>(null);
  const [arvPrefilledFrom, setArvPrefilledFrom] = useState<FigureSource | null>(null);

  // Rules form (seeded from the server, saved back explicitly).
  const [ruleForm, setRuleForm] = useState<Record<keyof FlipRuleValues, string> | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  // Explicit-action gates: comps cost a provider lookup, so they are pulled
  // only when asked; the MAO is only shown for inputs the operator committed.
  const [compsRequestedFor, setCompsRequestedFor] = useState<number | null>(null);
  const [maoRequest, setMaoRequest] = useState<MaoRequest | null>(null);

  // Buy-and-hold comparison (same subject, different exit).
  const [rentField, setRentField] = useState("");
  const [expensesField, setExpensesField] = useState("");
  const [rentalRequest, setRentalRequest] = useState<{
    purchasePriceCents: number;
    monthlyRentCents: number;
    monthlyExpensesCents: number | null;
  } | null>(null);

  const propertiesQuery = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    queryFn: () => fetchJsonArray<Property>("/api/properties"),
  });

  const defaultsQuery = useQuery<DefaultsResponse>({
    queryKey: ["/api/flip-analyzer/defaults"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/flip-analyzer/defaults");
      return res.json() as Promise<DefaultsResponse>;
    },
  });

  const subjectQuery = useQuery<SubjectResponse>({
    queryKey: ["/api/flip-analyzer/subject", propertyId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/flip-analyzer/subject/${propertyId}`);
      return res.json() as Promise<SubjectResponse>;
    },
    enabled: propertyId !== null,
  });

  const compsQuery = useQuery<CompsResponse>({
    queryKey: ["/api/flip-analyzer/comps", compsRequestedFor],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/flip-analyzer/comps", {
        propertyId: compsRequestedFor,
      });
      return res.json() as Promise<CompsResponse>;
    },
    enabled: compsRequestedFor !== null,
    staleTime: 5 * 60 * 1000,
  });

  const maoQuery = useQuery<MaoResponse>({
    queryKey: ["/api/flip-analyzer/mao", maoRequest],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/flip-analyzer/mao", {
        ...(maoRequest?.propertyId !== null && maoRequest?.propertyId !== undefined
          ? { propertyId: maoRequest.propertyId }
          : {}),
        arvCents: maoRequest?.arvCents,
        rehabEstimateCents: maoRequest?.rehabEstimateCents ?? 0,
        ...(maoRequest?.purchasePriceCents !== null && maoRequest?.purchasePriceCents !== undefined
          ? { purchasePriceCents: maoRequest.purchasePriceCents }
          : {}),
        feeCents: maoRequest?.feeCents ?? 0,
      });
      return res.json() as Promise<MaoResponse>;
    },
    enabled: maoRequest !== null,
  });

  const rentalQuery = useQuery<RentalResponse>({
    queryKey: ["/api/flip-analyzer/rental", rentalRequest],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/flip-analyzer/rental", rentalRequest);
      return res.json() as Promise<RentalResponse>;
    },
    enabled: rentalRequest !== null,
  });

  // Seed the rules form once the org's real rules arrive.
  useEffect(() => {
    if (!defaultsQuery.data || ruleForm !== null) return;
    const v = defaultsQuery.data.values;
    setRuleForm({
      maoRulePct: String(v.maoRulePct),
      rehabContingencyPct: String(v.rehabContingencyPct),
      sellingCostPct: String(v.sellingCostPct),
      purchaseClosingPct: String(v.purchaseClosingPct),
      holdMonths: String(v.holdMonths),
      monthlyHoldingCostCents: centsToDollarField(v.monthlyHoldingCostCents),
      targetProfitPct: String(v.targetProfitPct),
    });
  }, [defaultsQuery.data, ruleForm]);

  // Pre-fill from the SUBJECT's real records — and badge where each came from.
  // Nothing is invented: a property with no saved ARV leaves the field empty.
  const subject = subjectQuery.data;
  useEffect(() => {
    if (!subject) return;
    if (subject.arv) {
      setArvField(centsToDollarField(subject.arv.arvCents));
      setArvPrefilledFrom("saved_arv");
      setArvBasisNote(null);
    } else {
      setArvField("");
      setArvPrefilledFrom(null);
      setArvBasisNote(null);
    }
    if (subject.rehabEstimate) {
      setRehabField(centsToDollarField(subject.rehabEstimate.cents));
    } else {
      setRehabField("");
    }
    const price =
      subject.priceCandidates.purchasePriceCents ?? subject.priceCandidates.listPriceCents;
    setPriceField(price !== null ? centsToDollarField(price) : "");
    setMaoRequest(null);
  }, [subject]);

  const saveRules = useMutation({
    mutationFn: async (patch: Partial<FlipRuleValues>) => {
      const res = await apiRequest("PATCH", "/api/flip-analyzer/defaults", patch);
      return res.json() as Promise<DefaultsResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/flip-analyzer/defaults"] });
      queryClient.invalidateQueries({ queryKey: ["/api/flip-analyzer/mao"] });
      setRuleForm({
        maoRulePct: String(data.values.maoRulePct),
        rehabContingencyPct: String(data.values.rehabContingencyPct),
        sellingCostPct: String(data.values.sellingCostPct),
        purchaseClosingPct: String(data.values.purchaseClosingPct),
        holdMonths: String(data.values.holdMonths),
        monthlyHoldingCostCents: centsToDollarField(data.values.monthlyHoldingCostCents),
        targetProfitPct: String(data.values.targetProfitPct),
      });
      toast({
        title: "Rules saved.",
        description: "Every figure on this page now uses your own numbers.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't save your rules",
        description: `${error.message} — your saved rules are unchanged.`,
        variant: "destructive",
      });
    },
  });

  const createDraftOffer = useMutation({
    mutationFn: async (input: { propertyId: number; offerCents: number; mao: MaoResponse }) => {
      const res = await apiRequest("POST", "/api/flip-analyzer/offer", {
        propertyId: input.propertyId,
        arvCents: input.mao.arvCents,
        rehabEstimateCents: input.mao.rehabEstimateCents,
        feeCents: input.mao.feeCents,
        offerCents: input.offerCents,
      });
      return res.json() as Promise<OfferResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/offer-letters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/flip-analyzer/subject", propertyId] });
      toast({ title: "Draft offer saved.", description: data.note });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't start the offer",
        description: `${error.message} — nothing was saved and nothing was sent.`,
        variant: "destructive",
      });
    },
  });

  const properties = propertiesQuery.data ?? [];
  const arvCents = dollarsToCents(arvField);
  const rehabCents = dollarsToCents(rehabField) ?? 0;
  const priceCents = dollarsToCents(priceField);
  const feeCents = dollarsToCents(feeField) ?? 0;

  const pendingRequest: MaoRequest | null =
    arvCents !== null && arvCents > 0
      ? {
          propertyId,
          arvCents,
          rehabEstimateCents: rehabCents,
          purchasePriceCents: priceCents,
          feeCents,
        }
      : null;

  /** True when the visible inputs no longer match the computed MAO. */
  const maoIsStale = useMemo(() => {
    if (!maoRequest || !pendingRequest) return false;
    return JSON.stringify(maoRequest) !== JSON.stringify(pendingRequest);
  }, [maoRequest, pendingRequest]);

  const compMedianPerSqftCents = useMemo(() => {
    const comps = compsQuery.data?.status === "ok" ? compsQuery.data.comps : [];
    const perSqft = comps
      .filter((c): c is CompRow & { sqft: number } => typeof c.sqft === "number" && c.sqft > 0)
      .map((c) => c.soldPriceCents / (c.sqft as number))
      .sort((a, b) => a - b);
    if (perSqft.length === 0) return null;
    const mid = Math.floor(perSqft.length / 2);
    const median =
      perSqft.length % 2 === 0 ? (perSqft[mid - 1] + perSqft[mid]) / 2 : perSqft[mid];
    return { medianCents: median, sampleSize: perSqft.length };
  }, [compsQuery.data]);

  const subjectSqft = subject?.property.squareFeet ?? compsQuery.data?.subjectSqft ?? null;

  const handleUseCompMedian = () => {
    if (!compMedianPerSqftCents || !subjectSqft) return;
    const derived = Math.round(compMedianPerSqftCents.medianCents * subjectSqft);
    setArvField(centsToDollarField(derived));
    setArvPrefilledFrom(null);
    setArvBasisNote(
      `Assumption, derived in this browser: median ${dollars(
        Math.round(compMedianPerSqftCents.medianCents),
      )}/sq ft across ${compMedianPerSqftCents.sampleSize} pulled comp${
        compMedianPerSqftCents.sampleSize === 1 ? "" : "s"
      } × ${subjectSqft.toLocaleString("en-US")} sq ft subject. NOT adjusted for condition — ` +
        `ATTOM does not report post-rehab condition. Replace it with a real ARV before you offer.`,
    );
    setMaoRequest(null);
  };

  const selectedProperty = properties.find((p) => p.id === propertyId) ?? null;

  return (
    <PageShell label="Flip analyzer">
      <div className="acr-cc-hero" style={{ marginTop: 0 }}>
        <div>
          <div className="acr-eyebrow">Flip analyzer</div>
          <h1 className="acr-cc-greeting" data-testid="text-page-title">
            What is the most you can pay?
            <span className="acr-cc-greeting-soft">
              {" "}
              Your MAO, computed from a real ARV and your own rules — never a
              guess.
            </span>
          </h1>
        </div>
      </div>

      <RequiredDisclaimer type="valuation" className="mt-4" />

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Subject ─────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Home className="h-4 w-4 text-primary" aria-hidden="true" />
              Subject property
            </CardTitle>
            <CardDescription>
              Pick the house you are underwriting. Everything below is optional
              without one — you can analyse a deal by typing the numbers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {propertiesQuery.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : propertiesQuery.isError ? (
              <QueryErrorState
                error={propertiesQuery.error as Error}
                onRetry={() => propertiesQuery.refetch()}
                compact
                testId="flip-properties-error"
              />
            ) : properties.length === 0 ? (
              <EmptyState
                icon={Home}
                headline="No properties yet"
                subtitle="Add a property and the analyzer can read its saved ARV, rehab budget and price. Until then, type the numbers below by hand."
                cta={{ label: "Open inventory", href: "/properties" }}
                actionIcon={null}
              />
            ) : (
              <div className="space-y-2">
                <Label htmlFor="flip-subject">Property</Label>
                <Select
                  value={propertyId === null ? "none" : String(propertyId)}
                  onValueChange={(v) => {
                    const next = v === "none" ? null : Number(v);
                    setPropertyId(next);
                    setCompsRequestedFor(null);
                    setMaoRequest(null);
                  }}
                >
                  <SelectTrigger id="flip-subject" data-testid="select-flip-subject">
                    <SelectValue placeholder="Choose a property" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No property — manual entry</SelectItem>
                    {properties.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.address || p.apn || `Property #${p.id}`}
                        {p.state ? ` · ${p.state}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {propertyId !== null && subjectQuery.isLoading ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-5 w-1/3" />
              </div>
            ) : propertyId !== null && subjectQuery.isError ? (
              <QueryErrorState
                error={subjectQuery.error as Error}
                onRetry={() => subjectQuery.refetch()}
                compact
                testId="flip-subject-error"
              />
            ) : subject ? (
              <dl className="space-y-1" data-testid="flip-subject-snapshot">
                <FigureRow
                  label="Saved ARV"
                  value={subject.arv ? dollars(subject.arv.arvCents) : "None on file"}
                  note={
                    subject.arv
                      ? `${subject.arv.compCount} comp${subject.arv.compCount === 1 ? "" : "s"}` +
                        `${subject.arv.confidence ? ` · ${subject.arv.confidence} confidence` : ""}` +
                        ` · calculated ${formatDate(subject.arv.calculatedAt)}`
                      : "Nothing has been calculated for this parcel yet."
                  }
                />
                <FigureRow
                  label="Rehab estimate"
                  value={
                    subject.rehabEstimate ? dollars(subject.rehabEstimate.cents) : "None on file"
                  }
                  note={
                    subject.rehabEstimate
                      ? subject.rehabEstimate.source === "rehab_budget"
                        ? "From this property's rehab budget."
                        : "From the property's repair-cost field."
                      : "Type your own below."
                  }
                />
                <FigureRow
                  label="Subject size"
                  value={
                    subject.property.squareFeet
                      ? `${subject.property.squareFeet.toLocaleString("en-US")} sq ft`
                      : "Not on file"
                  }
                />
              </dl>
            ) : null}

            {subject && !subject.arv ? (
              <GapNotice
                title="No ARV on file for this property"
                message="The MAO is a function of ARV, so nothing is computed until one exists. Pull sold comps below and build an ARV on the parcel page, or type an ARV you already trust."
                testId="flip-no-arv-notice"
              />
            ) : null}

            {subject ? (
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/parcels/${subject.property.id}`}>
                    <Ruler className="mr-2 h-4 w-4" aria-hidden="true" />
                    Build an ARV from comps
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/rehabs">
                    <Hammer className="mr-2 h-4 w-4" aria-hidden="true" />
                    Active rehabs
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* ── Comps ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4 text-primary" aria-hidden="true" />
              Sold comps
            </CardTitle>
            <CardDescription>
              Sold residential comparables for the subject. Pulled only when you
              ask — a lookup can cost a provider credit.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button
              onClick={() => setCompsRequestedFor(propertyId)}
              disabled={propertyId === null || compsQuery.isFetching}
              data-testid="button-pull-comps"
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {compsQuery.isFetching ? "Pulling comps…" : "Pull sold comps"}
            </Button>
            {propertyId === null ? (
              <p className="text-sm text-muted-foreground">
                Choose a property first — comps are pulled for a specific
                address, and AcreOS will not guess a location.
              </p>
            ) : null}

            {compsQuery.isFetching ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-5/6" />
              </div>
            ) : compsQuery.isError ? (
              <QueryErrorState
                error={compsQuery.error as Error}
                onRetry={() => compsQuery.refetch()}
                compact
                testId="flip-comps-error"
              />
            ) : compsQuery.data && compsQuery.data.status !== "ok" ? (
              <GapNotice
                title="Comps are not available for this property"
                message={
                  compsQuery.data.message ??
                  "The comps provider returned nothing for this subject. Enter an ARV by hand below."
                }
                testId="flip-comps-unavailable"
              />
            ) : compsQuery.data && compsQuery.data.comps.length === 0 ? (
              <GapNotice
                title="No usable comps came back"
                message="Every comparable the provider returned was missing a sale price, so none of them can support an ARV. Enter an ARV by hand below."
                testId="flip-comps-empty"
              />
            ) : compsQuery.data ? (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">Address</TableHead>
                        <TableHead scope="col">Sold</TableHead>
                        <TableHead scope="col">Price</TableHead>
                        <TableHead scope="col">Sq ft</TableHead>
                        <TableHead scope="col">Miles</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {compsQuery.data.comps.map((comp, i) => (
                        <TableRow key={`${comp.address ?? "comp"}-${i}`} data-testid={`row-comp-${i}`}>
                          <TableCell className="max-w-[16rem] truncate">
                            {comp.address ?? "Address not reported"}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {comp.soldDate ? formatDate(comp.soldDate) : "Date not reported"}
                          </TableCell>
                          <TableCell className="font-mono tabular-nums">
                            {dollars(comp.soldPriceCents)}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {comp.sqft ? comp.sqft.toLocaleString("en-US") : "—"}
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {comp.distanceMiles !== null ? comp.distanceMiles.toFixed(2) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">
                  {compsQuery.data.provenance}
                  {compsQuery.data.credentialSource
                    ? ` Pulled on the ${
                        compsQuery.data.credentialSource === "organization"
                          ? "organization's own"
                          : "platform"
                      } ATTOM credential.`
                    : ""}
                  {compsQuery.data.droppedNoPrice
                    ? ` ${compsQuery.data.droppedNoPrice} returned comparable${
                        compsQuery.data.droppedNoPrice === 1 ? " was" : "s were"
                      } dropped for having no sale price.`
                    : ""}
                </p>
                {compMedianPerSqftCents && subjectSqft ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleUseCompMedian}
                    data-testid="button-use-comp-median"
                  >
                    <Calculator className="mr-2 h-4 w-4" aria-hidden="true" />
                    Use median $/sq ft as a working ARV
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    A median $/sq ft ARV needs both comp square footage and the
                    subject's square footage. One of them is missing, so AcreOS
                    will not derive one.
                  </p>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* ── Inputs + rules ────────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
            Your inputs
          </CardTitle>
          <CardDescription>
            The MAO is <span className="font-mono">ARV × your rule − rehab (with contingency) − fee</span>.
            Nothing here is filled in for you unless it came from a record you can see.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (pendingRequest) setMaoRequest(pendingRequest);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="flip-arv">After-repair value (ARV, $)</Label>
                <Input
                  id="flip-arv"
                  inputMode="decimal"
                  className="tabular-nums"
                  value={arvField}
                  onChange={(e) => {
                    setArvField(e.target.value);
                    setArvPrefilledFrom(null);
                    setArvBasisNote(null);
                  }}
                  placeholder="285,000"
                  data-testid="input-flip-arv"
                />
                {arvPrefilledFrom ? <SourceBadge source={arvPrefilledFrom} /> : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor="flip-rehab">Rehab estimate ($)</Label>
                <Input
                  id="flip-rehab"
                  inputMode="decimal"
                  className="tabular-nums"
                  value={rehabField}
                  onChange={(e) => setRehabField(e.target.value)}
                  placeholder="45,000"
                  data-testid="input-flip-rehab"
                />
                <p className="text-xs text-muted-foreground">Before contingency.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="flip-price">Price being tested ($, optional)</Label>
                <Input
                  id="flip-price"
                  inputMode="decimal"
                  className="tabular-nums"
                  value={priceField}
                  onChange={(e) => setPriceField(e.target.value)}
                  placeholder="Leave blank to model at the MAO"
                  data-testid="input-flip-price"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="flip-fee">Assignment fee ($, optional)</Label>
                <Input
                  id="flip-fee"
                  inputMode="decimal"
                  className="tabular-nums"
                  value={feeField}
                  onChange={(e) => setFeeField(e.target.value)}
                  placeholder="0"
                  data-testid="input-flip-fee"
                />
                <p className="text-xs text-muted-foreground">Carved out of the MAO.</p>
              </div>
            </div>

            {arvBasisNote ? (
              <GapNotice
                title="This ARV is an assumption, not a valuation"
                message={arvBasisNote}
                testId="flip-arv-assumption"
              />
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={pendingRequest === null} data-testid="button-compute-mao">
                <Calculator className="mr-2 h-4 w-4" aria-hidden="true" />
                Calculate MAO
              </Button>
              {pendingRequest === null ? (
                <span className="text-sm text-muted-foreground">
                  Enter an ARV — the MAO cannot be estimated without one.
                </span>
              ) : null}
              {maoIsStale ? (
                <Badge variant="outline" data-testid="badge-mao-stale">
                  Inputs changed — recalculate
                </Badge>
              ) : null}
            </div>
          </form>

          {/* Rules — the org's own numbers, each badged with its provenance. */}
          <div className="border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-medium">Your rules</h2>
                <p className="text-xs text-muted-foreground">
                  {defaultsQuery.data?.isCustomised
                    ? "Some of these are your own; the rest are AcreOS starting points, labelled below."
                    : "You have saved none of these yet, so every one below is an AcreOS starting point — an assumption, not your underwriting."}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRulesOpen((v) => !v)}
                data-testid="button-toggle-rules"
                aria-expanded={rulesOpen}
              >
                {rulesOpen ? "Hide rules" : "Show rules"}
              </Button>
            </div>

            {rulesOpen ? (
              defaultsQuery.isLoading || !ruleForm || !defaultsQuery.data ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : defaultsQuery.isError ? (
                <QueryErrorState
                  error={defaultsQuery.error as Error}
                  onRetry={() => defaultsQuery.refetch()}
                  compact
                  testId="flip-defaults-error"
                />
              ) : (
                <form
                  className="mt-4 space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const patch: Partial<FlipRuleValues> = {};
                    for (const field of RULE_FIELDS) {
                      const raw = ruleForm[field.key];
                      const parsed =
                        field.kind === "money" ? dollarsToCents(raw) : numberField(raw);
                      if (parsed === null) continue;
                      patch[field.key] = parsed;
                    }
                    if (Object.keys(patch).length > 0) saveRules.mutate(patch);
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {RULE_FIELDS.map((field) => (
                      <div key={field.key} className="space-y-1">
                        <Label htmlFor={`flip-rule-${field.key}`}>{field.label}</Label>
                        <Input
                          id={`flip-rule-${field.key}`}
                          inputMode="decimal"
                          className="tabular-nums"
                          value={ruleForm[field.key]}
                          onChange={(e) =>
                            setRuleForm((prev) =>
                              prev === null ? prev : { ...prev, [field.key]: e.target.value },
                            )
                          }
                          data-testid={`input-flip-rule-${field.key}`}
                        />
                        <div className="flex flex-wrap items-center gap-1">
                          <SourceBadge
                            source={
                              field.key === "monthlyHoldingCostCents" &&
                              defaultsQuery.data.values.monthlyHoldingCostCents === 0
                                ? "not_set"
                                : defaultsQuery.data.sources[field.key]
                            }
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{field.hint}</p>
                      </div>
                    ))}
                  </div>
                  <Button type="submit" disabled={saveRules.isPending} data-testid="button-save-rules">
                    {saveRules.isPending ? "Saving…" : `${Verbs.SAVE} rules`}
                  </Button>
                </form>
              )
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* ── The MAO ───────────────────────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-4 w-4 text-primary" aria-hidden="true" />
            Maximum allowable offer
          </CardTitle>
          <CardDescription>
            Every line below traces to an input above or to a rule, labelled
            with which.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {maoRequest === null ? (
            <EmptyState
              icon={Calculator}
              headline="Nothing calculated yet"
              subtitle="Enter an ARV and your rehab estimate, then calculate. AcreOS shows no MAO until it has a real ARV to work from."
              // TODO(cta): the action lives in the inputs form directly above
              // this card — a second button here would just scroll to itself.
              cta={{ label: "", _noOp: true }}
              actionIcon={null}
            />
          ) : maoQuery.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-12 w-1/2" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-2/3" />
            </div>
          ) : maoQuery.isError ? (
            <QueryErrorState
              error={maoQuery.error as Error}
              onRetry={() => maoQuery.refetch()}
              title="That MAO could not be computed"
              testId="flip-mao-error"
            />
          ) : maoQuery.data ? (
            <div className="space-y-5" data-testid="flip-mao-result">
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Your MAO
                  </p>
                  <p
                    className="font-mono text-4xl font-semibold tabular-nums"
                    data-testid="text-mao-value"
                  >
                    {dollars(maoQuery.data.maoCents)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {percent(maoQuery.data.maoRulePct)} of {dollars(maoQuery.data.arvCents)} ARV
                    {" − "}
                    {dollars(maoQuery.data.rehabWithContingencyCents)} rehab with contingency
                    {maoQuery.data.feeCents > 0
                      ? ` − ${dollars(maoQuery.data.feeCents)} fee`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <SourceBadge source={maoQuery.data.arvSource} />
                  {maoQuery.data.rulesAreCustomised ? null : (
                    <Badge variant="outline">Computed on AcreOS default rules</Badge>
                  )}
                  {maoQuery.data.atOrBelowMao ? null : (
                    <Badge variant="destructive" data-testid="badge-above-mao">
                      Tested price is ABOVE your MAO
                    </Badge>
                  )}
                </div>
              </div>

              {maoQuery.data.arvBasis ? (
                <p className="text-xs text-muted-foreground" data-testid="text-arv-basis">
                  ARV basis: your saved calculation from {maoQuery.data.arvBasis.compCount} comp
                  {maoQuery.data.arvBasis.compCount === 1 ? "" : "s"}
                  {maoQuery.data.arvBasis.confidence
                    ? ` at ${maoQuery.data.arvBasis.confidence} confidence`
                    : ""}
                  , calculated {formatDate(maoQuery.data.arvBasis.calculatedAt)}.
                </p>
              ) : null}

              <div className="grid gap-6 md:grid-cols-2">
                <dl>
                  <FigureRow
                    label="ARV"
                    value={dollars(maoQuery.data.arvCents)}
                    note={
                      maoQuery.data.arvSource === "saved_arv"
                        ? "From the saved ARV calculation."
                        : "You entered this."
                    }
                  />
                  <FigureRow
                    label="Rehab estimate"
                    value={dollars(maoQuery.data.rehabEstimateCents)}
                  />
                  <FigureRow
                    label="Contingency"
                    value={dollars(maoQuery.data.contingencyCents)}
                    note="Your contingency rule applied to the estimate."
                  />
                  <FigureRow
                    label="Price used for the net model"
                    value={dollars(maoQuery.data.priceUsedCents)}
                    note={
                      maoQuery.data.profitBasis === "operator_price"
                        ? "The price you entered."
                        : "No price entered — modelled AT the MAO."
                    }
                  />
                  <FigureRow
                    label="Acquisition closing"
                    value={dollars(maoQuery.data.purchaseClosingCents)}
                  />
                  <FigureRow
                    label="Selling cost"
                    value={dollars(maoQuery.data.sellingCostCents)}
                  />
                  <FigureRow
                    label="Holding cost"
                    value={
                      maoQuery.data.holdingCostCents === null
                        ? "Not set — excluded"
                        : dollars(maoQuery.data.holdingCostCents)
                    }
                  />
                  <FigureRow
                    label="Total cash in"
                    value={dollars(maoQuery.data.totalCashInCents)}
                    strong
                  />
                  <FigureRow
                    label="Net profit"
                    value={
                      maoQuery.data.netProfitCents === null
                        ? "Not computed"
                        : dollars(maoQuery.data.netProfitCents)
                    }
                    note={
                      maoQuery.data.netProfitCents === null
                        ? "Holding cost is unknown, so AcreOS will not show a net it cannot stand behind."
                        : `${percent(maoQuery.data.netProfitPctOfArv ?? 0, { decimals: 1 })} of ARV · ${percent(
                            maoQuery.data.netRoiPct ?? 0,
                            { decimals: 1 },
                          )} on cash`
                    }
                    strong
                  />
                  <FigureRow
                    label="Rule-only profit"
                    value={dollars(maoQuery.data.ruleProfitCents)}
                    note="The raw 70%-rule line. It ignores acquisition closing and carry, so it reads HIGH — the net above is the fuller model."
                  />
                </dl>

                <div className="space-y-3">
                  <h3 className="text-sm font-medium">What went into this</h3>
                  <motion.ul
                    variants={staggerContainer}
                    initial="hidden"
                    animate="visible"
                    className="m-0 list-none space-y-2 p-0"
                    aria-label="Assumptions behind this MAO"
                  >
                    {maoQuery.data.assumptions.map((a) => (
                      <motion.li
                        key={a.key}
                        variants={staggerItem}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border p-2"
                        data-testid={`assumption-${a.key}`}
                      >
                        <span className="text-sm">
                          {a.label}
                          <span className="block font-mono text-xs tabular-nums text-muted-foreground">
                            {a.display}
                          </span>
                        </span>
                        <SourceBadge source={a.source} />
                      </motion.li>
                    ))}
                  </motion.ul>

                  {maoQuery.data.meetsTargetProfit === null ? (
                    <p className="text-sm text-muted-foreground">
                      Whether this clears your target profit cannot be judged
                      while holding cost is unset.
                    </p>
                  ) : (
                    <p className="text-sm" data-testid="text-target-verdict">
                      {maoQuery.data.meetsTargetProfit
                        ? "This clears your target profit."
                        : "This does NOT clear your target profit."}
                    </p>
                  )}

                  {maoQuery.data.missing.length > 0 ? (
                    <ul className="m-0 list-none space-y-2 p-0" data-testid="flip-mao-missing">
                      {maoQuery.data.missing.map((m) => (
                        <li key={m}>
                          <GapNotice title="Known gap" message={m} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>

              {/* Draft offer — a record, not a send, and never a payment. */}
              <div className="border-t border-border pt-4">
                <p className="text-sm text-muted-foreground">
                  Saving a draft offer records the number on this property. It
                  sends nothing, and no money moves through AcreOS — payment
                  happens between you and the seller at closing.
                </p>
                <Button
                  className="mt-3"
                  disabled={
                    propertyId === null ||
                    createDraftOffer.isPending ||
                    maoIsStale ||
                    (maoQuery.data.profitBasis === "operator_price" && !maoQuery.data.atOrBelowMao)
                  }
                  onClick={() => {
                    if (propertyId === null || !maoQuery.data) return;
                    createDraftOffer.mutate({
                      propertyId,
                      offerCents:
                        maoQuery.data.profitBasis === "operator_price"
                          ? maoQuery.data.priceUsedCents
                          : maoQuery.data.maoCents,
                      mao: maoQuery.data,
                    });
                  }}
                  data-testid="button-draft-offer"
                >
                  <FileText className="mr-2 h-4 w-4" aria-hidden="true" />
                  {createDraftOffer.isPending
                    ? "Saving draft…"
                    : `Save draft offer at ${dollars(
                        maoQuery.data.profitBasis === "operator_price"
                          ? maoQuery.data.priceUsedCents
                          : maoQuery.data.maoCents,
                      )}`}
                </Button>
                {propertyId === null ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    A draft offer needs a property — pick one above.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Buy-and-hold comparison ───────────────────────────────────── */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Home className="h-4 w-4 text-primary" aria-hidden="true" />
            If you kept it instead
          </CardTitle>
          <CardDescription>
            The same house as a rental, at the price you are testing. Expenses
            you don't enter are replaced by a stated 40%-of-rent assumption, and
            labelled as one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              const price = priceCents ?? maoQuery.data?.maoCents ?? null;
              const rent = dollarsToCents(rentField);
              if (price === null || price <= 0 || rent === null) return;
              setRentalRequest({
                purchasePriceCents: price,
                monthlyRentCents: rent,
                monthlyExpensesCents: dollarsToCents(expensesField),
              });
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="flip-rent">Monthly rent ($)</Label>
              <Input
                id="flip-rent"
                inputMode="decimal"
                className="tabular-nums"
                value={rentField}
                onChange={(e) => setRentField(e.target.value)}
                placeholder="1,850"
                data-testid="input-flip-rent"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="flip-expenses">Monthly operating expenses ($)</Label>
              <Input
                id="flip-expenses"
                inputMode="decimal"
                className="tabular-nums"
                value={expensesField}
                onChange={(e) => setExpensesField(e.target.value)}
                placeholder="Leave blank to see the assumption"
                data-testid="input-flip-expenses"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="submit"
                variant="outline"
                disabled={dollarsToCents(rentField) === null}
                data-testid="button-compute-rental"
              >
                Compare as a rental
              </Button>
            </div>
          </form>

          {rentalRequest === null ? null : rentalQuery.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-5 w-1/3" />
            </div>
          ) : rentalQuery.isError ? (
            <QueryErrorState
              error={rentalQuery.error as Error}
              onRetry={() => rentalQuery.refetch()}
              compact
              testId="flip-rental-error"
            />
          ) : rentalQuery.data ? (
            <div className="space-y-3" data-testid="flip-rental-result">
              <dl>
                <FigureRow
                  label="Annual NOI"
                  value={dollars(rentalQuery.data.annualNoiCents)}
                  note={
                    rentalQuery.data.expenseBasis === "operator"
                      ? "Using the expenses you entered."
                      : "Using a stated 40%-of-rent expense assumption."
                  }
                />
                <FigureRow
                  label="Monthly cash flow"
                  value={dollars(rentalQuery.data.monthlyCashFlowCents)}
                />
                <FigureRow
                  label="Cap rate"
                  value={percent(rentalQuery.data.capRatePct, { decimals: 1 })}
                  note={rentalQuery.data.cashOnCashNote}
                />
                <FigureRow
                  label="Gross rent multiplier"
                  value={rentalQuery.data.grossRentMultiplier.toFixed(1)}
                />
              </dl>
              {rentalQuery.data.missing.map((m) => (
                <GapNotice key={m} title="Known gap" message={m} />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selectedProperty ? (
        <p className="mt-6 text-xs text-muted-foreground">
          Subject: {selectedProperty.address ?? `Property #${selectedProperty.id}`}
          {selectedProperty.state ? ` (${selectedProperty.state})` : ""}. Figures on
          this page are your underwriting, not an appraisal.
        </p>
      ) : null}
    </PageShell>
  );
}
