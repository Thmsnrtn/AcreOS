/**
 * /rehabs/:id — single rehab w/ line items + budget vs. spent + holding meter (FF-2).
 *
 * Devon §3 (per-surface friction): "What's missing for a flipper: a 'Project
 * status' chip per row — Acquired / Demo / Framing / Rough-ins / Drywall /
 * Finishes / Listed / Under Contract / Closed."
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { Hammer, PlusCircle, Trash2, Sparkles } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { BidsSection } from "@/components/rehabs/bids-section";
import { DrawsSection } from "@/components/rehabs/draws-section";
import { ArvCalculator } from "@/components/parcels/arv-calculator";
import { RehabPhotoGallery } from "@/components/rehabs/rehab-photo-gallery";

const CATEGORIES = [
  "demolition", "framing", "roof", "siding", "windows",
  "exterior_paint", "interior_paint", "flooring", "kitchen", "bathroom",
  "hvac", "plumbing", "electrical", "drywall", "trim_doors",
  "appliances", "landscaping", "permits", "dumpster", "cleaning",
  "punch_list", "contingency", "other",
] as const;

const STATUSES = [
  "planning", "demo", "framing", "rough_ins", "drywall",
  "finishes", "punch_list", "listed", "under_contract", "closed", "on_hold",
] as const;

/** Must match REHAB_HOLDING_CATEGORIES in shared/schema/fix-and-flip.ts. */
const HOLDING_CATEGORIES = [
  "taxes", "insurance", "utilities", "interest", "hoa", "other",
] as const;

interface Rehab {
  id: string;
  propertyId: number;
  name: string;
  status: string;
  startedAt: string | null;
  plannedListingDate: string | null;
  purchasePriceCents: number | null;
  budgetTotalCents: number | null;
  spentTotalCents: number | null;
  holdingCostMonthlyCents: number | null;
  arvCents: number | null;
  targetMarginCents: number | null;
}

interface LineItem {
  id: string;
  rehabId: string;
  sequence: number;
  category: string;
  scope: string;
  contractorId: string | null;
  budgetCents: number;
  committedCents: number;
  spentCents: number;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
}

interface LineVariance {
  id: string;
  estimateCents: number;
  committedCents: number | null;
  actualCents: number;
  actualVsEstimateCents: number;
  actualVsCommittedCents: number | null;
  approvedChangeOrderCents?: number;
  effectiveEstimateCents?: number;
}

interface ChangeOrder {
  id: string;
  lineItemId: string;
  description: string;
  amountCents: number;
  scheduleImpactDays: number;
  status: "proposed" | "approved" | "rejected";
  decidedBy: string | null;
  decidedAt: string | null;
  recordedBy: string;
  createdAt: string;
}

interface ChangeOrdersPayload {
  orders: ChangeOrder[];
  totals: {
    originalEstimateCents: number;
    approvedChangeOrderCents: number;
    effectiveEstimateCents: number;
    approvedCount: number;
    proposedCount: number;
    rejectedCount: number;
  };
}

type ExitKind = "sell" | "hold" | "wholesale";

interface ExitDecision {
  id: string;
  decidedAt: string;
  kind: string;
  exitKind: ExitKind;
  choice: string;
  rationale: string;
  expectedPriceCents: number | null;
  reviewDueAt: string | null;
}

interface RealizedPayload {
  facts: null | { salePriceCents: number; sellingCostsCents: number; closingDate: string; recordedBy: string; recordedAt: string };
  grading: null | {
    holdDays: number | null;
    investedCents: number | null;
    investedParts: { purchaseCents: number | null; rehabSpentCents: number | null; holdingRecordedCents: number | null };
    realizedNetCents: number | null;
    netMissing: string[];
    realizedRoiRatio: number | null;
    deltas: {
      saleVsArvCents: number | null;
      holdDaysVsScenarioDays: number | null;
      netVsScenarioProfitCents: number | null;
      roiVsScenarioRatio: number | null;
    };
  };
  /** The frozen Leg 1 scenario the grading used; null = no recorded flip scenario. */
  scenario: null | { arvCents: number | null; profitCents: number | null; roiRatio: number | null; holdMonths: number | null };
}

interface TimelineBaseline {
  id: string;
  supersedesId: string | null;
  plannedStartDate: string | null;
  plannedListingDate: string | null;
  plannedHoldMonths: number | null;
  plannedHoldingMonthlyCents: number | null;
  phasePlans: { phase: string; plannedDate: string }[];
  recordedBy: string;
  createdAt: string;
  isOriginal: boolean;
}

interface TimelineTransition {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  transitionedAt: string;
}

interface TimelineHoldingEntry {
  id: string;
  entryDate: string;
  category: string;
  amountCents: number;
  note: string | null;
  createdAt: string;
}

/** Leg 3 — plan vs recorded, computed server-side and rendered as returned. */
interface RehabTimeline {
  baselines: TimelineBaseline[];
  transitions: TimelineTransition[];
  holdingEntries: TimelineHoldingEntry[];
  schedule: {
    phases: Array<{
      phase: string;
      plannedDate: string | null;
      actualDate: string | null;
      varianceDays: number | null;
    }>;
    listingVarianceDays: number | null;
    approvedChangeOrderDays?: number;
    adjustedPlannedListingDate?: string | null;
  };
  holding: {
    scenario: null | {
      holdMonths: number | null;
      monthlyHoldingCostCents: number | null;
      assumedTotalCents: number | null;
      holdMonthsOrigin: string | null;
      monthlyOrigin: string | null;
    };
    baselinePlan: null | {
      plannedHoldMonths: number | null;
      plannedHoldingMonthlyCents: number | null;
      plannedTotalCents: number | null;
    };
    actuals: {
      entriesTotalCents: number;
      elapsedDays: number | null;
      meterAccruedCents: number | null;
    };
    disagreement: { spendPastScenario: boolean; timePastScenario: boolean };
  };
}

interface RehabDetail {
  rehab: Rehab;
  items: LineItem[];
  /** Estimate → committed → actual (Leg 2). A null committed means nothing is committed. */
  variance: {
    lines: LineVariance[];
    project: {
      estimateCents: number;
      committedCents: number;
      committedLineCount: number;
      uncommittedLineCount: number;
      actualCents: number;
      actualVsEstimateCents: number;
      actualVsCommittedCents: number | null;
      approvedChangeOrderCents?: number;
      effectiveEstimateCents?: number;
    };
    flags: Array<{ kind: string; fact: string }>;
  };
  estimateLock: { locked: boolean; message?: string };
  totals: {
    budgetCents: number;
    committedCents: number;
    spentCents: number;
    varianceCents: number;
    byCategory: Record<string, { budget: number; committed: number; spent: number; variance: number }>;
    daysOnSite: number | null;
    accruedHoldingCents: number | null;
  };
  /** Plan vs recorded: append-only baselines, the status log, holding entries. */
  timeline: RehabTimeline;
  /** Priced, approved scope changes (Leg 4). Optional: an older payload has none. */
  changeOrders?: ChangeOrdersPayload;
  exit?: { decisions: ExitDecision[] };
  realized?: RealizedPayload;
}

interface ScopeTemplate {
  key: string;
  label: string;
  description: string;
  lineCount: number;
}

function fmtUsdCents(c: number | null | undefined): string {
  if (c === null || c === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(c / 100);
}

/** "+$1,200" / "−$300" — the sign is part of the fact. */
function fmtSignedUsdCents(c: number): string {
  if (c < 0) return `−${fmtUsdCents(-c)}`;
  return `+${fmtUsdCents(c)}`;
}

function scheduleImpactLabel(days: number): string {
  if (days === 0) return "no schedule impact";
  const n = Math.abs(days);
  return `${days > 0 ? "+" : "−"}${n} ${n === 1 ? "day" : "days"}`;
}

function fmtSignedDays(days: number): string {
  const n = Math.abs(days);
  return `${days < 0 ? "−" : "+"}${n} ${n === 1 ? "day" : "days"}`;
}

function fmtPct1(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

const EXIT_KIND_LABELS: Record<ExitKind, string> = {
  sell: "Sell",
  hold: "Hold as a rental",
  wholesale: "Wholesale",
};

/** The server's own refusal text (e.g. the estimate lock's reason), not a bare status code. */
async function serverMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return typeof body?.message === "string" && body.message ? body.message : `Failed (${res.status})`;
}

function csrfHeader(): Record<string, string> {
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return { "Content-Type": "application/json", "x-csrf-token": decodeURIComponent(m?.[1] ?? "") };
}

/** "rough_ins" → "Rough ins"; HOA keeps its capitals. */
function humanize(value: string): string {
  if (value === "hoa") return "HOA";
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Where a scenario assumption came from — the operator's rule or the platform's. */
function originLabel(origin: string | null): string | null {
  if (origin === null) return null;
  if (origin === "user") return "your rule";
  if (origin === "platform-default") return "platform default";
  return origin;
}

/** "Hold length: your rule · Monthly: platform default" — only parts present. */
function provenanceLine(holdMonthsOrigin: string | null, monthlyOrigin: string | null): string {
  const hold = originLabel(holdMonthsOrigin);
  const monthly = originLabel(monthlyOrigin);
  return [
    hold ? `Hold length: ${hold}` : null,
    monthly ? `Monthly: ${monthly}` : null,
  ].filter((part): part is string => part !== null).join(" · ");
}

/** "3 months × $1,200/mo = $3,600", with unrecorded parts named rather than zero. */
function holdLine(months: number | null, monthlyCents: number | null, totalCents: number | null): string {
  const monthsText = months === null ? "Hold length not recorded" : `${months} ${months === 1 ? "month" : "months"}`;
  const monthlyText = monthlyCents === null ? "monthly holding not recorded" : `${fmtUsdCents(monthlyCents)}/mo`;
  const base = `${monthsText} × ${monthlyText}`;
  return totalCents === null ? base : `${base} = ${fmtUsdCents(totalCents)}`;
}

function varianceLabel(days: number | null): string {
  if (days === null) return "—";
  if (days > 0) return `+${days} days`;
  if (days < 0) return `${days} days`;
  return "on plan";
}

function varianceClass(days: number | null): string {
  if (days === null || days === 0) return "text-muted-foreground";
  return days > 0 ? "text-acr-warning" : "text-acr-pos";
}

/** A labelled form field — one wrapper for every input in the Leg 3 forms. */
function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor} className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** One labelled figure in the holding comparison — scenario, plan, or actual. */
function Figure({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function listingVarianceLabel(days: number): string {
  if (days === 0) return "Listing was on plan";
  const n = Math.abs(days);
  return `Listing ran ${n} ${n === 1 ? "day" : "days"} ${days > 0 ? "late" : "early"}`;
}

export default function RehabDetailPage() {
  useDocumentTitle("Rehab — AcreOS");
  const [match, params] = useRoute("/rehabs/:id");
  const id = params?.id ?? "";
  const { toast } = useToast();

  const [newCategory, setNewCategory] = useState<typeof CATEGORIES[number]>("kitchen");
  const [newScope, setNewScope] = useState("");
  const [newBudget, setNewBudget] = useState("");
  const [templateKey, setTemplateKey] = useState("");

  // Baseline form (Leg 3). Everything is optional — a baseline can record only
  // the dates the operator knows.
  const [baselineStart, setBaselineStart] = useState("");
  const [baselineListing, setBaselineListing] = useState("");
  const [baselineHoldMonths, setBaselineHoldMonths] = useState("");
  const [baselineMonthly, setBaselineMonthly] = useState("");
  const [phaseDates, setPhaseDates] = useState<Record<string, string>>({});

  // Holding-cost form (Leg 3).
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryCategory, setEntryCategory] = useState("taxes");
  const [entryAmount, setEntryAmount] = useState("");
  const [entryNote, setEntryNote] = useState("");

  // Change-order propose form (Leg 4).
  const [coLine, setCoLine] = useState("");
  const [coDescription, setCoDescription] = useState("");
  const [coAmount, setCoAmount] = useState("");
  const [coDays, setCoDays] = useState("0");

  // Exit-decision form (Leg 4).
  const [exitKind, setExitKind] = useState<ExitKind>("sell");
  const [exitPrice, setExitPrice] = useState("");
  const [exitRationale, setExitRationale] = useState("");
  const [exitReviewMode, setExitReviewMode] = useState<"none" | "date">("none");
  const [exitReviewDate, setExitReviewDate] = useState("");

  // Realized-facts form (Leg 4).
  const [realSale, setRealSale] = useState("");
  const [realCosts, setRealCosts] = useState("");
  const [realClosing, setRealClosing] = useState("");

  const detail = useQuery<RehabDetail>({
    queryKey: ["/api/rehabs", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/rehabs/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
  });

  const templates = useQuery<{ templates: ScopeTemplate[] }>({
    queryKey: ["/api/rehab-scope-templates"],
    queryFn: async () => {
      const res = await fetch("/api/rehab-scope-templates", { credentials: "include" });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
  });

  const updateRehab = useMutation({
    mutationFn: async (updates: Partial<Rehab>) => {
      const res = await fetch(`/api/rehabs/${id}`, { method: "PATCH", credentials: "include", headers: csrfHeader(), body: JSON.stringify(updates) });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] }),
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const addItem = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/rehabs/${id}/line-items`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify({
          category: newCategory,
          scope: newScope,
          budgetCents: Math.round(parseFloat(newBudget || "0") * 100),
        }),
      });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] });
      setNewScope(""); setNewBudget("");
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const updateItem = useMutation({
    mutationFn: async (vars: { itemId: string; updates: Partial<LineItem> }) => {
      const res = await fetch(`/api/rehab-line-items/${vars.itemId}`, {
        method: "PATCH", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify(vars.updates),
      });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] }),
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (itemId: string) => {
      const res = await fetch(`/api/rehab-line-items/${itemId}`, {
        method: "DELETE", credentials: "include", headers: csrfHeader(),
      });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] }),
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const seedTemplate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/rehabs/${id}/seed-template`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify({ templateKey }),
      });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: (r: any) => {
      toast({ title: `${r.inserted} line items added`, description: "Budgets start at $0 — enter your cost for each line." });
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] });
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  // A revision is a NEW baseline row — the server points it at the previous
  // one and the original is never rewritten.
  const recordBaseline = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (baselineStart) body.plannedStartDate = baselineStart;
      if (baselineListing) body.plannedListingDate = baselineListing;
      if (baselineHoldMonths) body.plannedHoldMonths = Math.trunc(Number(baselineHoldMonths));
      if (baselineMonthly) body.plannedHoldingMonthlyCents = Math.round(parseFloat(baselineMonthly) * 100);
      const plans = STATUSES.filter((phase) => phaseDates[phase]).map((phase) => ({ phase, plannedDate: phaseDates[phase] }));
      if (plans.length > 0) body.phasePlans = plans;

      const res = await fetch(`/api/rehabs/${id}/baselines`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] });
      setBaselineStart("");
      setBaselineListing("");
      setBaselineHoldMonths("");
      setBaselineMonthly("");
      setPhaseDates({});
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  // Holding entries are facts: a correction is a NEW negative entry whose note
  // says what it corrects (the server refuses a zero amount too).
  const addHoldingEntry = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(entryAmount);
      const cents = Number.isFinite(amount) ? Math.round(amount * 100) : 0;
      if (cents === 0) {
        throw new Error("Enter a non-zero amount. A correction is a negative entry whose note says what it corrects.");
      }
      const body: Record<string, unknown> = { entryDate, category: entryCategory, amountCents: cents };
      if (entryNote.trim()) body.note = entryNote.trim();

      const res = await fetch(`/api/rehabs/${id}/holding-entries`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] });
      setEntryAmount("");
      setEntryNote("");
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  // A change order prices a scope change; the original estimate is never edited.
  const proposeChangeOrder = useMutation({
    mutationFn: async (lineItemId: string) => {
      const dollars = parseFloat(coAmount);
      const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
      if (cents === 0) {
        throw new Error("Enter a non-zero amount. A $0 change order adjusts nothing; a negative amount is a priced reduction.");
      }
      const days = Math.trunc(Number(coDays || "0"));
      const res = await fetch(`/api/rehabs/${id}/change-orders`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify({
          lineItemId,
          description: coDescription.trim(),
          amountCents: cents,
          scheduleImpactDays: Number.isFinite(days) ? days : 0,
        }),
      });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] });
      setCoDescription("");
      setCoAmount("");
      setCoDays("0");
    },
    onError: (error) => {
      toast({ title: getErrorTitle(error), description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const decideChangeOrder = useMutation({
    mutationFn: async (vars: { orderId: string; decision: "approved" | "rejected" }) => {
      const res = await fetch(`/api/rehabs/${id}/change-orders/${vars.orderId}/decide`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify({ decision: vars.decision }),
      });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] }),
    onError: (error) => {
      toast({ title: getErrorTitle(error), description: getErrorMessage(error), variant: "destructive" });
    },
  });

  // Both keys are always sent: null is an answer ("no price", "no review date").
  const recordExitDecision = useMutation({
    mutationFn: async () => {
      let expectedPriceCents: number | null = null;
      if (exitPrice.trim() !== "") {
        const dollars = parseFloat(exitPrice);
        if (!Number.isFinite(dollars)) throw new Error("Enter the expected price as a number of dollars.");
        expectedPriceCents = Math.round(dollars * 100);
      }
      const reviewDueAt = exitReviewMode === "date" && exitReviewDate
        ? new Date(`${exitReviewDate}T00:00:00.000Z`).toISOString()
        : null;
      const res = await fetch(`/api/rehabs/${id}/exit-decision`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify({ exitKind, expectedPriceCents, rationale: exitRationale.trim(), reviewDueAt }),
      });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] });
      setExitPrice("");
      setExitRationale("");
      setExitReviewMode("none");
      setExitReviewDate("");
    },
    onError: (error) => {
      toast({ title: getErrorTitle(error), description: getErrorMessage(error), variant: "destructive" });
    },
  });

  const recordRealized = useMutation({
    mutationFn: async () => {
      const sale = parseFloat(realSale);
      const costs = parseFloat(realCosts);
      if (!Number.isFinite(sale) || !Number.isFinite(costs)) {
        throw new Error("Enter the sale price and the selling costs as dollar amounts.");
      }
      const res = await fetch(`/api/rehabs/${id}/realized`, {
        method: "POST", credentials: "include", headers: csrfHeader(),
        body: JSON.stringify({
          salePriceCents: Math.round(sale * 100),
          sellingCostsCents: Math.round(costs * 100),
          closingDate: realClosing,
        }),
      });
      if (!res.ok) throw new Error(await serverMessage(res));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rehabs", id] });
      setRealSale("");
      setRealCosts("");
      setRealClosing("");
    },
    onError: (error) => {
      toast({ title: getErrorTitle(error), description: getErrorMessage(error), variant: "destructive" });
    },
  });

  if (!id) return <PageShell label="Rehab"><Card><CardContent>Invalid id</CardContent></Card></PageShell>;
  if (detail.isLoading) return <PageShell label="Rehab"><Skeleton className="h-32" /></PageShell>;
  if (!detail.data) return <PageShell label="Rehab"><Card><CardContent>Not found.</CardContent></Card></PageShell>;

  const { rehab, items, totals } = detail.data;
  const data = detail.data;
  // A partial payload (an older fixture, or a client cached before Leg 3) must
  // still render: a missing timeline reads as an empty one, never a crash.
  const timeline: RehabTimeline = data.timeline ?? {
    baselines: [],
    transitions: [],
    holdingEntries: [],
    schedule: { phases: [], listingVarianceDays: null },
    holding: {
      scenario: null,
      baselinePlan: null,
      actuals: { entriesTotalCents: 0, elapsedDays: null, meterAccruedCents: null },
      disagreement: { spendPastScenario: false, timePastScenario: false },
    },
  };
  const originalBaseline = timeline.baselines.find((b) => b.isOriginal) ?? null;
  const scenarioHold = timeline.holding.scenario;
  const baselinePlan = timeline.holding.baselinePlan;
  const holdActuals = timeline.holding.actuals;
  const scenarioProvenance = scenarioHold
    ? provenanceLine(scenarioHold.holdMonthsOrigin, scenarioHold.monthlyOrigin)
    : "";
  const changeOrders: ChangeOrdersPayload = data.changeOrders ?? {
    orders: [],
    totals: {
      originalEstimateCents: totals.budgetCents,
      approvedChangeOrderCents: 0,
      effectiveEstimateCents: totals.budgetCents,
      approvedCount: 0,
      proposedCount: 0,
      rejectedCount: 0,
    },
  };
  const exitDecisions = data.exit?.decisions ?? [];
  const latestExit = exitDecisions[0] ?? null;
  const realized: RealizedPayload = data.realized ?? { facts: null, grading: null, scenario: null };
  const grading = realized.grading;
  const scenario = realized.scenario;
  const rehabListedOrLater = ["listed", "under_contract", "closed"].includes(rehab.status);
  const coLineId = coLine || (items[0] ? String(items[0].id) : "");
  const coAmountParsed = parseFloat(coAmount);
  const coAmountValid = Number.isFinite(coAmountParsed) && Math.round(coAmountParsed * 100) !== 0;
  const exitPriceNeeded = exitKind !== "hold";
  const exitPriceValid = exitPrice.trim() === ""
    ? !exitPriceNeeded
    : Number.isFinite(parseFloat(exitPrice));
  const exitFormValid = exitPriceValid && exitRationale.trim() !== "" && (exitReviewMode === "none" || exitReviewDate !== "");
  const realFormValid = Number.isFinite(parseFloat(realSale)) && Number.isFinite(parseFloat(realCosts)) && realClosing !== "";
  const entryAmountParsed = parseFloat(entryAmount);
  const entryAmountValid = Number.isFinite(entryAmountParsed) && Math.round(entryAmountParsed * 100) !== 0;
  const spentPct = totals.budgetCents > 0 ? Math.min(100, Math.round((totals.spentCents / totals.budgetCents) * 100)) : 0;
  const arvMargin = rehab.arvCents !== null && rehab.purchasePriceCents !== null && rehab.budgetTotalCents !== null
    ? rehab.arvCents - rehab.purchasePriceCents - rehab.budgetTotalCents
    : null;

  return (
    <PageShell label={rehab.name}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Hammer className="w-6 h-6 text-primary" aria-hidden="true" />
          {rehab.name}
        </h1>
        <div className="flex items-center gap-2 mt-2">
          <Select value={rehab.status} onValueChange={(s) => updateRehab.mutate({ status: s })}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <SelectValue><Badge variant="outline">{rehab.status.replace(/_/g, " ")}</Badge></SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                // Once a project leaves planning it cannot return (the estimate lock, §4.3).
                <SelectItem key={s} value={s} disabled={s === "planning" && data.estimateLock.locked}>
                  {s.replace(/_/g, " ")}
                  {s === "planning" && data.estimateLock.locked ? " (closed)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {totals.daysOnSite !== null && (
            <Badge variant="outline" className="text-xs">{totals.daysOnSite} days on site</Badge>
          )}
        </div>
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Budget</div>
          <div className="text-xl font-semibold">{fmtUsdCents(totals.budgetCents)}</div>
          <Progress value={spentPct} className="mt-2 h-2" />
          <div className="text-xs text-muted-foreground mt-1">{spentPct}% spent</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Spent</div>
          <div className="text-xl font-semibold">{fmtUsdCents(totals.spentCents)}</div>
          <div className={`text-xs mt-1 ${totals.varianceCents > 0 ? "text-acr-warning" : "text-acr-pos"}`}>
            Variance: {fmtUsdCents(totals.varianceCents)}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Holding accrued</div>
          <div className="text-xl font-semibold">{fmtUsdCents(totals.accruedHoldingCents)}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {rehab.holdingCostMonthlyCents ? `${fmtUsdCents(Math.round(rehab.holdingCostMonthlyCents / 30))}/day` : "set holding cost"}
          </div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">ARV margin</div>
          <div className={`text-xl font-semibold ${arvMargin !== null && arvMargin < 0 ? "text-acr-neg" : ""}`}>
            {fmtUsdCents(arvMargin)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">ARV − basis − budget</div>
        </Card>
      </div>

      {/* Seed template */}
      {items.length === 0 && (
        <Card className="mb-6 border-dashed">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              Seed from a scope template
            </CardTitle>
            <CardDescription>
              A starting scope of line items so you don't begin from a blank slate. Budgets start at $0 — enter what each line costs in your market.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[280px]">
              <Label className="text-xs">Template</Label>
              <Select value={templateKey} onValueChange={setTemplateKey}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pick a scope template…" /></SelectTrigger>
                <SelectContent>
                  {templates.data?.templates.map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.label} — {t.lineCount} lines</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!templateKey || seedTemplate.isPending} onClick={() => seedTemplate.mutate()}>
              Apply template
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Construction draws */}
      <DrawsSection rehabId={id} />

      {/* Bids comparison */}
      <BidsSection rehabId={id} />

      {/* ARV calculator — same component as parcel-detail, but with rehabId
          populated on save so arv_calculations.rehab_id back-links to this
          project. Devon §2.9: "An AVM is not an ARV." */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">ARV (after-repair value)</CardTitle>
          <CardDescription>
            Post-rehab value from your own comps. Saved against this rehab.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ArvCalculator propertyId={rehab.propertyId} rehabId={id} />
        </CardContent>
      </Card>

      {/* Photo evidence — before/during/after, defect, lender_draw, tax */}
      <RehabPhotoGallery rehabId={id} />

      {/* Variance flags — facts from the lines, no threshold (Leg 2 §4.4). */}
      {data.variance.flags.length > 0 ? (
        <Card className="mb-6" data-testid="rehab-variance-flags">
          <CardHeader>
            <CardTitle className="text-base">Over estimate</CardTitle>
            <CardDescription>Where what's spent or committed has passed what you estimated.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="m-0 list-none space-y-1 p-0 text-sm">
              {data.variance.flags.map((f, i) => (
                <li key={`${f.kind}-${i}`}>{f.fact}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Timeline & holding — kickoff baselines, the status log and recorded
          carry (Leg 3). Plan, scenario and actual are shown side by side and
          never merged: a plan is not spend, and an accrual is not a ledger. */}
      <Card className="mb-6" data-testid="rehab-timeline">
        <CardHeader>
          <CardTitle className="text-base">Timeline &amp; holding</CardTitle>
          <CardDescription>
            Plan vs recorded: baselines, the status log, and holding costs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Baseline */}
          <section aria-labelledby="rehab-baseline-heading">
            <h2 id="rehab-baseline-heading" className="text-sm font-medium">Kickoff baseline</h2>
            {timeline.baselines.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No kickoff baseline recorded yet. Variance is measured against the plan you started with — record it to see plan vs actual.
              </p>
            ) : originalBaseline ? (
              <div className="mt-2 space-y-1">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Planned start</div>
                    <div className="text-sm tabular-nums">{originalBaseline.plannedStartDate ?? "—"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Planned listing</div>
                    <div className="text-sm tabular-nums">{originalBaseline.plannedListingDate ?? "—"}</div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Recorded {originalBaseline.createdAt.slice(0, 10)}
                </p>
                {timeline.baselines.length > 1 ? (
                  <p className="text-xs text-muted-foreground">
                    Revised {timeline.baselines.length - 1} {timeline.baselines.length - 1 === 1 ? "time" : "times"} since.
                    Variance is still measured against the original baseline.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* Baseline form */}
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => { e.preventDefault(); recordBaseline.mutate(); }}
            >
              <h3 className="text-sm font-medium">
                {timeline.baselines.length > 0 ? "Record a revised baseline" : "Record baseline"}
              </h3>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {([
                  ["baseline-start", "Planned start", "date", baselineStart, setBaselineStart, {}],
                  ["baseline-listing", "Planned listing", "date", baselineListing, setBaselineListing, {}],
                  ["baseline-hold-months", "Planned hold (months)", "number", baselineHoldMonths, setBaselineHoldMonths, { min: 1, step: 1 }],
                  ["baseline-monthly", "Planned monthly holding ($)", "number", baselineMonthly, setBaselineMonthly, { min: 0, step: "0.01" }],
                ] as const).map(([id, label, type, value, set, extra]) => (
                  <Field key={id} label={label} htmlFor={id}>
                    <Input id={id} type={type} value={value} onChange={(e) => set(e.target.value)} className="h-9" {...extra} />
                  </Field>
                ))}
              </div>

              <div>
                <div className="text-xs text-muted-foreground">Planned entry date per phase — leave a phase blank if you have not planned it.</div>
                <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-3">
                  {STATUSES.map((phase) => (
                    <Field key={phase} label={humanize(phase)} htmlFor={`phase-date-${phase}`}>
                      <Input id={`phase-date-${phase}`} type="date" value={phaseDates[phase] ?? ""} onChange={(e) => setPhaseDates((d) => ({ ...d, [phase]: e.target.value }))} className="h-9" />
                    </Field>
                  ))}
                </div>
              </div>

              <Button type="submit" size="sm" disabled={recordBaseline.isPending}>
                {timeline.baselines.length > 0 ? "Record revision" : "Record baseline"}
              </Button>
            </form>
          </section>

          {/* Schedule: planned vs recorded */}
          {originalBaseline ? (
            <section aria-labelledby="rehab-schedule-heading">
              <h2 id="rehab-schedule-heading" className="text-sm font-medium">Schedule: planned vs recorded</h2>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                    <th className="px-2 py-2 text-left font-medium">Phase</th>
                    <th className="px-2 py-2 text-left font-medium">Planned</th>
                    <th className="px-2 py-2 text-left font-medium">Actual</th>
                    <th className="px-2 py-2 text-right font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.schedule.phases.map((p) => (
                    <tr key={p.phase} className="border-b border-border/40">
                      <td className="px-2 py-1">{humanize(p.phase)}</td>
                      <td className="px-2 py-1 tabular-nums">{p.plannedDate ?? "—"}</td>
                      <td className={`px-2 py-1 tabular-nums ${p.actualDate === null ? "text-muted-foreground" : ""}`}>
                        {p.actualDate ?? "not recorded"}
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums ${varianceClass(p.varianceDays)}`}>
                        {varianceLabel(p.varianceDays)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {timeline.schedule.phases.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  No phases planned or recorded yet — a phase appears here once the baseline plans it or the status log enters it.
                </p>
              ) : null}
              {timeline.schedule.listingVarianceDays !== null ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {listingVarianceLabel(timeline.schedule.listingVarianceDays)}
                </p>
              ) : null}
              {(timeline.schedule.approvedChangeOrderDays ?? 0) > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground" data-testid="rehab-schedule-change-order-days">
                  Approved change orders add {timeline.schedule.approvedChangeOrderDays} days — planned listing{" "}
                  {originalBaseline.plannedListingDate ?? "not recorded"} →{" "}
                  {timeline.schedule.adjustedPlannedListingDate ?? "not derivable"} (adjusted)
                </p>
              ) : null}
            </section>
          ) : null}

          {/* Holding: scenario vs plan vs recorded */}
          <section aria-labelledby="rehab-holding-heading">
            <h2 id="rehab-holding-heading" className="text-sm font-medium">Holding: scenario vs plan vs recorded</h2>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <Figure title="MAO scenario assumed">
                {scenarioHold === null ? (
                  <p className="mt-1 text-sm text-muted-foreground">No MAO decision recorded for this property yet.</p>
                ) : (
                  <>
                    <div className="mt-1 text-sm">
                      {holdLine(scenarioHold.holdMonths, scenarioHold.monthlyHoldingCostCents, scenarioHold.assumedTotalCents)}
                    </div>
                    {scenarioProvenance ? (
                      <div className="mt-1 text-xs text-muted-foreground">{scenarioProvenance}</div>
                    ) : null}
                  </>
                )}
              </Figure>

              <Figure title="Baseline plan">
                {baselinePlan === null ? (
                  <p className="mt-1 text-sm text-muted-foreground">No baseline recorded.</p>
                ) : (
                  <div className="mt-1 text-sm">
                    {holdLine(baselinePlan.plannedHoldMonths, baselinePlan.plannedHoldingMonthlyCents, baselinePlan.plannedTotalCents)}
                  </div>
                )}
              </Figure>

              <Figure title="Recorded actuals to date">
                <div className="mt-1 text-sm">
                  {fmtUsdCents(holdActuals.entriesTotalCents)} across {timeline.holdingEntries.length} recorded{" "}
                  {timeline.holdingEntries.length === 1 ? "entry" : "entries"}
                  {holdActuals.elapsedDays !== null ? ` · ${holdActuals.elapsedDays} days on site` : ""}
                </div>
                {holdActuals.meterAccruedCents !== null ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Meter accrual (monthly rate × days elapsed — an accrual, not recorded spend): {fmtUsdCents(holdActuals.meterAccruedCents)}
                  </div>
                ) : null}
              </Figure>
            </div>

            {timeline.holding.disagreement.spendPastScenario ? (
              <p className="mt-3 text-sm" data-testid="rehab-timeline-spend-past-scenario">
                Recorded holding spend has passed what the MAO scenario assumed. The scenario is unchanged.
              </p>
            ) : null}
            {timeline.holding.disagreement.timePastScenario ? (
              <p className="mt-1 text-sm" data-testid="rehab-timeline-time-past-scenario">
                Time on site has passed the hold the MAO scenario assumed.
              </p>
            ) : null}
          </section>

          {/* Recorded holding costs */}
          <section aria-labelledby="rehab-holding-entries-heading">
            <h2 id="rehab-holding-entries-heading" className="text-sm font-medium">Holding costs recorded</h2>
            {timeline.holdingEntries.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No holding costs recorded yet — add taxes, insurance, utilities, interest or HOA as they are paid.
              </p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                    <th className="px-2 py-2 text-left font-medium">Date</th>
                    <th className="px-2 py-2 text-left font-medium">Category</th>
                    <th className="px-2 py-2 text-right font-medium">Amount</th>
                    <th className="px-2 py-2 text-left font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.holdingEntries.map((entry) => (
                    <tr key={entry.id} className="border-b border-border/40">
                      <td className="px-2 py-1 tabular-nums">{entry.entryDate}</td>
                      <td className="px-2 py-1">
                        {humanize(entry.category)}
                      </td>
                      <td className={`px-2 py-1 text-right tabular-nums ${entry.amountCents < 0 ? "text-acr-pos" : ""}`}>
                        {fmtUsdCents(entry.amountCents)}
                      </td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">{entry.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Add holding cost */}
            <form
              className="mt-4 space-y-3"
              onSubmit={(e) => { e.preventDefault(); addHoldingEntry.mutate(); }}
            >
              <h3 className="text-sm font-medium">Add holding cost</h3>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Field label="Date" htmlFor="holding-date"><Input id="holding-date" type="date" required value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className="h-9" /></Field>
                <Field label="Category">
                  <select aria-label="Holding-cost category" value={entryCategory} onChange={(e) => setEntryCategory(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs">
                    {HOLDING_CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                  </select>
                </Field>
                <Field label="Amount ($)" htmlFor="holding-amount"><Input id="holding-amount" type="number" step="0.01" required value={entryAmount} onChange={(e) => setEntryAmount(e.target.value)} aria-describedby="holding-amount-hint" className="h-9" /></Field>
                <Field label="Note (optional)" htmlFor="holding-note"><Input id="holding-note" value={entryNote} onChange={(e) => setEntryNote(e.target.value)} placeholder="What this covers…" className="h-9" /></Field>
              </div>
              <p id="holding-amount-hint" className="text-xs text-muted-foreground">
                May be negative for a correction — its note says what it corrects. Zero is not a cost.
              </p>
              <Button type="submit" size="sm" disabled={!entryAmountValid || addHoldingEntry.isPending}>
                Add holding cost
              </Button>
            </form>
          </section>
        </CardContent>
      </Card>

      {/* Change orders — a scope change after work starts is priced and
          approved before the work it covers starts (Leg 4). The original
          estimate is never edited to absorb it. */}
      <Card className="mb-6" data-testid="rehab-change-orders">
        <CardHeader>
          <CardTitle className="text-base">Change orders</CardTitle>
          {changeOrders.orders.length > 0 ? (
            <CardDescription data-testid="rehab-change-orders-totals">
              Original estimate {fmtUsdCents(changeOrders.totals.originalEstimateCents)} · approved change orders{" "}
              {fmtSignedUsdCents(changeOrders.totals.approvedChangeOrderCents)} · effective estimate{" "}
              {fmtUsdCents(changeOrders.totals.effectiveEstimateCents)}
            </CardDescription>
          ) : (
            <CardDescription>
              A scope change after work starts is priced (amount and schedule impact) and approved before the work it covers starts.
              The original estimate is never edited to absorb it.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {changeOrders.orders.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-2 py-2 text-left font-medium">Description</th>
                  <th className="px-2 py-2 text-left font-medium">Line</th>
                  <th className="px-2 py-2 text-right font-medium">Amount</th>
                  <th className="px-2 py-2 text-left font-medium">Schedule</th>
                  <th className="px-2 py-2 text-left font-medium">Status</th>
                  <th className="px-2 py-2 text-left font-medium">Recorded</th>
                  <th className="px-2 py-2"><span className="sr-only">Decide</span></th>
                </tr>
              </thead>
              <tbody>
                {changeOrders.orders.map((o) => {
                  const line = items.find((it) => String(it.id) === String(o.lineItemId));
                  return (
                    <tr key={o.id} className="border-b border-border/40 align-top" data-testid={`change-order-${o.id}`}>
                      <td className="px-2 py-1">{o.description}</td>
                      <td className="px-2 py-1 text-xs text-muted-foreground">{line ? line.scope : "line no longer listed"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmtSignedUsdCents(o.amountCents)}</td>
                      <td className="px-2 py-1 text-xs">{scheduleImpactLabel(o.scheduleImpactDays)}</td>
                      <td className="px-2 py-1">
                        <Badge variant={o.status === "approved" ? "default" : "secondary"}>
                          {o.status === "proposed" ? "Proposed" : o.status === "approved" ? "Approved" : "Rejected"}
                        </Badge>
                        {o.status !== "proposed" ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            by {o.decidedBy ?? "—"}{o.decidedAt ? ` · ${o.decidedAt.slice(0, 10)}` : ""}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 text-xs text-muted-foreground tabular-nums">{o.createdAt.slice(0, 10)}</td>
                      <td className="px-2 py-1 text-right">
                        {o.status === "proposed" ? (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" disabled={decideChangeOrder.isPending}
                              onClick={() => decideChangeOrder.mutate({ orderId: o.id, decision: "approved" })}>Approve</Button>
                            <Button size="sm" variant="outline" disabled={decideChangeOrder.isPending}
                              onClick={() => decideChangeOrder.mutate({ orderId: o.id, decision: "rejected" })}>Reject</Button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : null}

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add a line item first — a change order prices a change to a line.</p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => { e.preventDefault(); proposeChangeOrder.mutate(coLineId); }}
            >
              <h3 className="text-sm font-medium">Propose a change order</h3>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Field label="Line" htmlFor="co-line">
                  <select id="co-line" value={coLineId} onChange={(e) => setCoLine(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs">
                    {items.map((it) => <option key={it.id} value={String(it.id)}>{it.sequence}. {it.scope}</option>)}
                  </select>
                </Field>
                <Field label="Description" htmlFor="co-description">
                  <Input id="co-description" required value={coDescription} onChange={(e) => setCoDescription(e.target.value)} className="h-9" />
                </Field>
                <Field label="Amount ($)" htmlFor="co-amount">
                  <Input id="co-amount" type="number" step="0.01" required value={coAmount} onChange={(e) => setCoAmount(e.target.value)} aria-describedby="co-amount-hint" className="h-9" />
                </Field>
                <Field label="Schedule impact (days)" htmlFor="co-days">
                  <Input id="co-days" type="number" step={1} value={coDays} onChange={(e) => setCoDays(e.target.value)} className="h-9" />
                </Field>
              </div>
              <p id="co-amount-hint" className="text-xs text-muted-foreground">
                A $0 order adjusts nothing. A negative amount is a priced reduction.
              </p>
              <Button type="submit" size="sm" disabled={!coAmountValid || coDescription.trim() === "" || proposeChangeOrder.isPending}>
                Propose change order
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Exit & outcome — the exit decision, then the realized facts and what
          they were graded against (Leg 4). The panel grades a forecast, never
          the operator. */}
      <Card className="mb-6" data-testid="rehab-exit-outcome">
        <CardHeader>
          <CardTitle className="text-base">Exit &amp; outcome</CardTitle>
          <CardDescription>The exit you chose, and what the close recorded against the forecast.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <section aria-labelledby="rehab-exit-heading">
            <h2 id="rehab-exit-heading" className="text-sm font-medium">Exit decision</h2>
            {latestExit ? (
              <div className="mt-2 rounded-card border border-border p-3 text-sm" data-testid="rehab-exit-latest">
                <div className="font-medium">{latestExit.choice}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {EXIT_KIND_LABELS[latestExit.exitKind] ?? latestExit.exitKind}
                  {latestExit.expectedPriceCents !== null ? ` · expected price ${fmtUsdCents(latestExit.expectedPriceCents)}` : ""}
                </div>
                <p className="mt-2">{latestExit.rationale}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Recorded {latestExit.decidedAt.slice(0, 10)} ·{" "}
                  {latestExit.reviewDueAt ? `review ${latestExit.reviewDueAt.slice(0, 10)}` : "no review date set"}
                </p>
                {exitDecisions.length > 1 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {exitDecisions.length - 1} earlier exit {exitDecisions.length - 1 === 1 ? "decision" : "decisions"}.
                  </p>
                ) : null}
              </div>
            ) : null}

            {latestExit?.exitKind === "hold" ? (
              <p className="mt-3 text-sm">
                <a
                  href={`/rentals/underwrite?propertyId=${rehab.propertyId}`}
                  className="underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  data-testid="rehab-exit-rentals-link"
                >
                  Underwrite this property as a rental →
                </a>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Following it creates nothing — no unit, lease, or tenant is made by the exit decision.
                </span>
              </p>
            ) : null}

            {rehabListedOrLater ? (
              <form
                className="mt-4 space-y-3"
                onSubmit={(e) => { e.preventDefault(); recordExitDecision.mutate(); }}
              >
                <h3 className="text-sm font-medium">Record an exit decision</h3>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Field label="Exit" htmlFor="exit-kind">
                    <select id="exit-kind" value={exitKind} onChange={(e) => setExitKind(e.target.value as ExitKind)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs">
                      {(Object.keys(EXIT_KIND_LABELS) as ExitKind[]).map((k) => <option key={k} value={k}>{EXIT_KIND_LABELS[k]}</option>)}
                    </select>
                  </Field>
                  <Field label={exitPriceNeeded ? "Expected price ($)" : "Expected price ($, optional)"} htmlFor="exit-price">
                    <Input id="exit-price" type="number" min={0} step="0.01" value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} required={exitPriceNeeded} className="h-9" />
                  </Field>
                  <Field label="Review" htmlFor="exit-review-mode">
                    <select id="exit-review-mode" value={exitReviewMode} onChange={(e) => setExitReviewMode(e.target.value as "none" | "date")} className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs">
                      <option value="none">No set date</option>
                      <option value="date">Review on a date</option>
                    </select>
                  </Field>
                  {exitReviewMode === "date" ? (
                    <Field label="Review date" htmlFor="exit-review-date">
                      <Input id="exit-review-date" type="date" required value={exitReviewDate} onChange={(e) => setExitReviewDate(e.target.value)} className="h-9" />
                    </Field>
                  ) : null}
                </div>
                <Field label="Rationale" htmlFor="exit-rationale">
                  <textarea id="exit-rationale" required rows={3} value={exitRationale} onChange={(e) => setExitRationale(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
                </Field>
                <Button type="submit" size="sm" disabled={!exitFormValid || recordExitDecision.isPending}>
                  Record exit decision
                </Button>
              </form>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">The exit decision is recorded once the project is listed.</p>
            )}
          </section>

          <section aria-labelledby="rehab-realized-heading">
            <h2 id="rehab-realized-heading" className="text-sm font-medium">Realized outcome</h2>
            {rehab.status !== "closed" ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Realized economics are recorded at close, when the outcome is a fact.
              </p>
            ) : realized.facts === null ? (
              <form
                className="mt-2 space-y-3"
                onSubmit={(e) => { e.preventDefault(); recordRealized.mutate(); }}
              >
                <p className="text-xs text-muted-foreground">
                  Record what the close actually was. Recorded facts are not edited afterwards.
                </p>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <Field label="Sale price ($)" htmlFor="realized-sale">
                    <Input id="realized-sale" type="number" min={0} step="0.01" required value={realSale} onChange={(e) => setRealSale(e.target.value)} className="h-9" />
                  </Field>
                  <Field label="Selling costs ($)" htmlFor="realized-costs">
                    <Input id="realized-costs" type="number" min={0} step="0.01" required value={realCosts} onChange={(e) => setRealCosts(e.target.value)} className="h-9" />
                  </Field>
                  <Field label="Closing date" htmlFor="realized-closing">
                    <Input id="realized-closing" type="date" required value={realClosing} onChange={(e) => setRealClosing(e.target.value)} className="h-9" />
                  </Field>
                </div>
                <Button type="submit" size="sm" disabled={!realFormValid || recordRealized.isPending}>
                  Record realized facts
                </Button>
              </form>
            ) : (
              <div className="mt-2 space-y-4">
                <div className="rounded-card border border-border p-3 text-sm" data-testid="rehab-realized-facts">
                  <div>Sale price {fmtUsdCents(realized.facts.salePriceCents)} · selling costs {fmtUsdCents(realized.facts.sellingCostsCents)} · closed {realized.facts.closingDate}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Recorded by {realized.facts.recordedBy} on {realized.facts.recordedAt.slice(0, 10)}. Recorded facts are not edited.
                  </div>
                  {grading ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {grading.holdDays !== null
                        ? `actual hold: ${grading.holdDays} days (derived from the recorded start and closing dates)`
                        : "hold days not derivable — no start date recorded"}
                    </div>
                  ) : null}
                </div>

                {grading ? (
                  <div className="space-y-1 text-sm" data-testid="rehab-realized-grading">
                    {grading.realizedNetCents !== null ? (
                      <>
                        <div className="font-medium">
                          Realized net {grading.realizedNetCents < 0 ? "−" : ""}{fmtUsdCents(Math.abs(grading.realizedNetCents))}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          sale {fmtUsdCents(realized.facts.salePriceCents)} − selling costs {fmtUsdCents(realized.facts.sellingCostsCents)} −
                          purchase {fmtUsdCents(grading.investedParts.purchaseCents)} − rehab spent {fmtUsdCents(grading.investedParts.rehabSpentCents)} −
                          recorded holding {fmtUsdCents(grading.investedParts.holdingRecordedCents)}
                        </div>
                      </>
                    ) : (
                      <div>A realized net is not computed — {grading.netMissing.join(", ")} not recorded.</div>
                    )}
                    {grading.realizedRoiRatio !== null ? <div>Realized ROI {fmtPct1(grading.realizedRoiRatio)}</div> : null}
                    {grading.deltas.saleVsArvCents !== null ? (
                      <div>
                        Sold {fmtUsdCents(realized.facts.salePriceCents)}
                        {scenario?.arvCents != null ? ` vs ${fmtUsdCents(scenario.arvCents)} ARV in the recorded scenario` : " vs the recorded scenario ARV"}
                        : {fmtSignedUsdCents(grading.deltas.saleVsArvCents)}
                      </div>
                    ) : null}
                    {grading.deltas.holdDaysVsScenarioDays !== null ? (
                      <div>
                        Held {grading.holdDays ?? "—"} days
                        {scenario?.holdMonths != null ? ` vs the scenario's ${scenario.holdMonths}-month hold` : " vs the scenario's hold"}
                        : {fmtSignedDays(grading.deltas.holdDaysVsScenarioDays)}
                      </div>
                    ) : null}
                    {grading.deltas.netVsScenarioProfitCents !== null ? (
                      <div>
                        Net vs the scenario's profit
                        {scenario?.profitCents != null ? ` of ${fmtUsdCents(scenario.profitCents)}` : ""}
                        : {fmtSignedUsdCents(grading.deltas.netVsScenarioProfitCents)}
                      </div>
                    ) : null}
                    {grading.deltas.roiVsScenarioRatio !== null ? (
                      <div>
                        ROI vs the scenario's
                        {scenario?.roiRatio != null ? ` ${fmtPct1(scenario.roiRatio)}` : ""}
                        : {grading.deltas.roiVsScenarioRatio < 0 ? "−" : "+"}{Math.abs(grading.deltas.roiVsScenarioRatio * 100).toFixed(1)} percentage points
                      </div>
                    ) : null}
                    {Object.values(grading.deltas).every((d) => d === null) ? (
                      <p className="text-muted-foreground">
                        No recorded flip scenario to grade against — the forecast side of this panel is the scenario recorded with the flip decision.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
          </section>
        </CardContent>
      </Card>

      {/* Line items */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line items</CardTitle>
          <CardDescription>
            Estimate is what you priced, committed is what a contractor agreed to, actual is what was spent.
            Each cell saves on blur.
          </CardDescription>
          {data.estimateLock.locked ? (
            <p className="mt-2 rounded-card border border-border bg-muted/30 p-2 text-xs" role="status" data-testid="rehab-estimate-locked">
              {data.estimateLock.message}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border bg-muted/30">
                <th className="px-2 py-2 text-left font-medium">#</th>
                <th className="px-2 py-2 text-left font-medium">Category</th>
                <th className="px-2 py-2 text-left font-medium">Scope</th>
                <th className="px-2 py-2 text-right font-medium">Estimate</th>
                <th className="px-2 py-2 text-right font-medium">Committed</th>
                <th className="px-2 py-2 text-right font-medium">Actual</th>
                <th className="px-2 py-2 text-right font-medium">Actual vs estimate</th>
                <th className="px-2 py-2 text-right font-medium">Actual vs committed</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const variance = it.spentCents - it.budgetCents;
                const v = data.variance.lines.find((l) => l.id === String(it.id));
                return (
                  <tr key={it.id} className="border-b border-border/40">
                    <td className="px-2 py-1 text-xs text-muted-foreground">{it.sequence + 1}</td>
                    <td className="px-2 py-1"><Badge variant="outline" className="text-xs">{it.category.replace(/_/g, " ")}</Badge></td>
                    <td className="px-2 py-1">{it.scope}</td>
                    <td className="px-2 py-1 text-right">
                      {data.estimateLock.locked ? (
                        <span className="text-xs tabular-nums" data-testid={`estimate-locked-${it.id}`}>
                          {fmtUsdCents(it.budgetCents)}
                          <span className="sr-only"> — estimate locked; the project has left planning</span>
                        </span>
                      ) : (
                        <CellInput
                          label={`Estimate for ${it.scope}`}
                          defaultValue={(it.budgetCents / 100).toFixed(0)}
                          onCommit={(v) => updateItem.mutate({ itemId: it.id, updates: { budgetCents: Math.round(parseFloat(v || "0") * 100) } as any })}
                        />
                      )}
                      {v && (v.approvedChangeOrderCents ?? 0) !== 0 ? (
                        <span className="block text-[11px] text-muted-foreground" data-testid={`estimate-change-orders-${it.id}`}>
                          {fmtSignedUsdCents(v.approvedChangeOrderCents ?? 0)} approved change orders → {fmtUsdCents(v.effectiveEstimateCents)} effective
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <CellInput
                        label={`Committed for ${it.scope}`}
                        placeholder="not committed"
                        defaultValue={it.committedCents > 0 ? (it.committedCents / 100).toFixed(0) : ""}
                        onCommit={(v) => updateItem.mutate({ itemId: it.id, updates: { committedCents: Math.round(parseFloat(v || "0") * 100) } as any })}
                      />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <CellInput
                        label={`Actual spent on ${it.scope}`}
                        defaultValue={(it.spentCents / 100).toFixed(0)}
                        onCommit={(v) => updateItem.mutate({ itemId: it.id, updates: { spentCents: Math.round(parseFloat(v || "0") * 100) } as any })}
                      />
                    </td>
                    <td className={`px-2 py-1 text-right ${variance > 0 ? "text-acr-warning" : variance < 0 ? "text-acr-pos" : "text-muted-foreground"}`}>
                      {fmtUsdCents(variance)}
                    </td>
                    <td className="px-2 py-1 text-right text-muted-foreground" data-testid={`vs-committed-${it.id}`}>
                      {v && v.actualVsCommittedCents !== null ? fmtUsdCents(v.actualVsCommittedCents) : "not committed"}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {data.estimateLock.locked && it.budgetCents > 0 ? null : (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteItem.mutate(it.id)} aria-label={`Delete line ${it.scope}`}>
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {/* Add row */}
              <tr className="border-t border-border bg-muted/30">
                <td colSpan={2} className="px-2 py-2">
                  <Select value={newCategory} onValueChange={(v) => setNewCategory(v as any)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-2 py-2"><Input aria-label="New line item scope" value={newScope} onChange={(e) => setNewScope(e.target.value)} placeholder="Scope description…" className="h-8" /></td>
                <td className="px-2 py-2 text-right">
                  {data.estimateLock.locked ? (
                    <span className="text-xs text-muted-foreground" data-testid="new-line-estimate-locked">$0 estimate (locked)</span>
                  ) : (
                    <Input aria-label="New line item estimate" type="number" value={newBudget} onChange={(e) => setNewBudget(e.target.value)} placeholder="0" className="h-8 text-right" />
                  )}
                </td>
                <td colSpan={5}></td>
                <td className="px-2 py-2 text-right">
                  <Button size="sm" disabled={!newScope || (!newBudget && !data.estimateLock.locked) || addItem.isPending} onClick={() => addItem.mutate()}>
                    <PlusCircle className="w-4 h-4 mr-1" aria-hidden="true" /> Add
                  </Button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="font-semibold border-t-2 border-border">
                <td colSpan={3} className="px-2 py-2 text-right">Totals</td>
                <td className="px-2 py-2 text-right">{fmtUsdCents(totals.budgetCents)}</td>
                <td className="px-2 py-2 text-right">
                  {data.variance.project.committedLineCount === 0 ? "not committed" : fmtUsdCents(data.variance.project.committedCents)}
                  {data.variance.project.committedLineCount > 0 && data.variance.project.uncommittedLineCount > 0 ? (
                    <span className="block text-[11px] font-normal text-muted-foreground">
                      {data.variance.project.uncommittedLineCount} not committed
                    </span>
                  ) : null}
                </td>
                <td className="px-2 py-2 text-right">{fmtUsdCents(totals.spentCents)}</td>
                <td className={`px-2 py-2 text-right ${totals.varianceCents > 0 ? "text-acr-warning" : totals.varianceCents < 0 ? "text-acr-pos" : ""}`}>
                  {fmtUsdCents(totals.varianceCents)}
                </td>
                <td className="px-2 py-2 text-right" data-testid="vs-committed-total">
                  {data.variance.project.actualVsCommittedCents === null ? "not committed" : fmtUsdCents(data.variance.project.actualVsCommittedCents)}
                  {data.variance.project.actualVsCommittedCents !== null ? (
                    <span className="block text-[11px] font-normal text-muted-foreground">committed lines only</span>
                  ) : null}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function CellInput({
  defaultValue,
  onCommit,
  label,
  placeholder,
}: {
  defaultValue: string;
  onCommit: (v: string) => void;
  /**
   * Required, not optional. A bare number in a table cell is the case where an
   * accessible name matters most — "1,250" announced with no context tells a
   * screen-reader user nothing about which line item or which column it is.
   */
  label: string;
  placeholder?: string;
}) {
  const [val, setVal] = useState(defaultValue);
  return (
    <Input
      aria-label={label}
      type="number"
      placeholder={placeholder}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={() => { if (val !== defaultValue) onCommit(val); }}
      className="h-7 text-right text-xs w-24"
    />
  );
}
