import { useId, useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { PropertyMap } from "@/components/property-map-lazy";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Filter,
  MapPin,
  SlidersHorizontal,
  X,
  ExternalLink,
  Layers,
  TrendingUp,
  TrendingDown,
  Users,
  Zap,
  Sun,
  Droplets,
  TreePine,
  Phone,
  MessageSquare,
  FileText,
  DollarSign,
  BarChart3,
  Navigation,
  Ruler,
  Mountain,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Info,
  Sparkles,
  Activity,
  Star,
  Loader2,
  HelpCircle,
  Flame,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Property } from "@shared/schema";
import { PersonaMapStrip } from "@/components/maps/PersonaMapStrip";
import { SampleParcelPreview } from "@/components/maps/SampleParcelPreview";
import { DataProvenanceChip } from "@/components/data-provenance-chip";
import { deriveIntel, type PropertyIntelligence } from "@/pages/maps-intel";
import { findStateWarning, isUplBlocked } from "@/lib/upl-gating";
import { StateUplBanner } from "@/components/upl-gating-banner";
import { usePaxRail } from "@/contexts/pax-rail-context";
import { QueryErrorState } from "@/components/query-error-state";
import { okOrThrow, listFrom } from "@/lib/fetch-honesty";
import { usePersona } from "@/hooks/use-persona";
import { useIsMobile } from "@/hooks/use-mobile";
import { RequestCountyCTA } from "@/components/maps/RequestCountyCTA";
import { MarketHeatPanel } from "@/components/maps/MarketHeatPanel";
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
} from "recharts";

// ── Slope Aspect Helper ────────────────────────────────────────────────────────
function getSlopeAspectLabel(azimuth: number): { label: string; full: string; icon: string } {
  const dirs = [
    { label: "N", full: "North-facing", icon: "↑" },
    { label: "NE", full: "Northeast-facing", icon: "↗" },
    { label: "E", full: "East-facing", icon: "→" },
    { label: "SE", full: "Southeast-facing", icon: "↘" },
    { label: "S", full: "South-facing", icon: "↓" },
    { label: "SW", full: "Southwest-facing", icon: "↙" },
    { label: "W", full: "West-facing", icon: "←" },
    { label: "NW", full: "Northwest-facing", icon: "↖" },
  ];
  const idx = Math.round(((azimuth % 360) / 360) * 8) % 8;
  return dirs[idx];
}

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "prospect", label: "Prospect" },
  { value: "due_diligence", label: "Due diligence" },
  { value: "offer_sent", label: "Offer sent" },
  { value: "under_contract", label: "Under contract" },
  { value: "owned", label: "Owned" },
  { value: "listed", label: "Listed" },
  { value: "sold", label: "Sold" },
];

// Deal-status colors — now resolved at render time from CSS vars so they
// respond to theme + dark-mode switches. Cannot use Tailwind here because
// PropertyMap consumes these as inline style / SVG fill strings.
function getDealStatusColor(status: string): string {
  const style = getComputedStyle(document.documentElement);
  const get = (v: string) => style.getPropertyValue(v).trim();
  const map: Record<string, string> = {
    negotiating: get("--acr-heat-warm"),   // building negotiation = warm heat
    offer_sent:  get("--acr-brand"),        // brand accent — active outreach
    countered:   get("--acr-accent"),       // secondary accent
    accepted:    get("--acr-pos"),          // positive outcome
    in_escrow:   get("--acr-pos"),          // positive outcome (in progress)
    closed:      get("--acr-pos"),          // positive final
    cancelled:   get("--acr-heat-cold"),   // cold/quiet — deal gone cold
    dead:        get("--acr-heat-hot"),    // hot-neg — dead = high-signal loss
  };
  return map[status] ?? get("--acr-ink-3");
}

interface DealWithProperty {
  id: number;
  status: string;
  propertyId: number;
  acceptedAmount?: number | null;
}

// ─── Property Intelligence Panel ───────────────────────────────────────────────

/**
 * Takes `undefined`, and that is the point.
 *
 * The call site read `getRiskColor(intel.slopeRisk ?? "low")`, so a parcel whose
 * slope GRADE is known but whose RISK classification is missing had its number
 * painted `text-acr-pos` — green, the visual claim "low risk" — on a panel whose
 * own header two lines above says *"Every value is real-or-honest: a missing
 * field renders 'Not yet pulled · Check now', never a fabricated number or a
 * default flood zone."* The component already knew the risk was unknown: it hides
 * the `(low|moderate|high)` label when the field is absent, and coloured it
 * favourably anyway.
 *
 * Unknown renders neutral. A customer deciding whether to buy a parcel should not
 * read "we have not classified this slope" as "this slope is fine".
 */
function getRiskColor(risk: "low" | "moderate" | "high" | undefined): string {
  if (!risk) return "text-muted-foreground";
  const map = { low: "text-acr-pos", moderate: "text-acr-warn", high: "text-acr-neg" };
  return map[risk] ?? "text-muted-foreground";
}

/** Same rule as getRiskColor: unknown is neutral, never the favourable band. */
function getRiskBg(risk: "low" | "moderate" | "high" | undefined): string {
  if (!risk) return "bg-muted";
  const map = { low: "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos", moderate: "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn", high: "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg" };
  return map[risk] ?? "bg-muted";
}

/**
 * Honest "we haven't looked this up" affordance. Renders in place of a
 * fabricated number. Never shows a value — only an invitation to pull real data.
 */
function UnknownValue({
  onCheck,
  checking,
  compact,
}: {
  onCheck?: () => void;
  checking?: boolean;
  compact?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className={cn("text-micro", compact && "sr-only")}>Not yet pulled</span>
      {!compact && <span aria-hidden="true" className="text-muted-foreground/60">·</span>}
      {onCheck ? (
        <button
          type="button"
          onClick={onCheck}
          disabled={checking}
          className="inline-flex items-center gap-1 text-micro font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-0.5 disabled:opacity-60"
        >
          {checking ? (
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="w-3 h-3" aria-hidden="true" />
          )}
          {checking ? "Checking…" : "Check now"}
        </button>
      ) : (
        <span className="text-micro" aria-hidden="true">—</span>
      )}
    </span>
  );
}

function IntelligenceRow({ label, value, icon: Icon, iconClass }: { label: string; value: React.ReactNode; icon?: React.ElementType; iconClass?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className={cn("w-3.5 h-3.5", iconClass)} />}
        {label}
      </div>
      <div className="text-xs font-medium">{value}</div>
    </div>
  );
}

function ScoreRing({ score, label, color }: { score: number; label: string; color: string }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score));
  const dash = (pct / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-14 h-14">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted/30" />
          <circle
            cx="26" cy="26" r={r}
            fill="none"
            stroke={color}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold">{Math.round(pct)}</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Inline Blind-Offer Composer (T3-3B) ───────────────────────────────────────
//
// The signature interaction: parcel → Pax-drafted blind offer → witnessed Send,
// without ever leaving the Map slide-over. This is a WIRING of existing
// primitives — it reuses the SAME engine (POST /api/data-intel/blind-offer, with
// propertyId so the server federal-trust gate fires), the SAME UPL gate
// (lib/upl-gating + StateUplBanner, shared with the full wizard), and the SAME
// witnessed-send kernel (usePaxRail().openWithContext → Pax composes a
// send_email tool call → frozen pending_actions row → the user taps the existing
// "Approve & send" in pax-copilot-rail.tsx). There is NO send code here.

/** Subset of the wizard's OfferReport we render inline. */
interface InlineOfferReport {
  state: string;
  county: string;
  recommendedTier: "aggressive" | "standard" | "competitive";
  recommendedOfferTotal: number;
  recommendationReason: string;
  compAnalysis: { compCount: number };
  letterVariables: { offerAmount: number; offerAmountWords: string };
  marketContext: { usdaLandValuePerAcre: number | null };
  warnings: string[];
}

function InlineBlindOfferComposer({ property }: { property: Property }) {
  const [expanded, setExpanded] = useState(false);
  const { openWithContext } = usePaxRail();

  const state = property.state ?? "";
  const county = property.county ?? "";
  const acres = parseFloat(String(property.sizeAcres || "0"));
  const uplWarning = findStateWarning(state);
  const uplBlocked = isUplBlocked(state);
  const parcelLabel = property.address || `${county}, ${state}`;

  // The engine. KEEP propertyId in the body so the server's
  // assertFeeSimpleOrThrow federal-trust gate runs (Indian-Country / federal
  // trust parcels are blocked server-side). Only fires once expanded.
  const {
    data: report,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<InlineOfferReport>({
    queryKey: ["/api/data-intel/blind-offer", property.id],
    enabled: expanded,
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/data-intel/blind-offer", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // propertyId is REQUIRED here — it's what arms the federal-trust gate.
        body: JSON.stringify({ state, county, targetAcres: acres, propertyId: property.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || body?.error || `Couldn't draft an offer (${res.status})`);
      }
      return res.json();
    },
  });

  // Honesty: comps depend on paywalled ATTOM. When the engine returns zero
  // comps it falls back to USDA land-value benchmarks — say so plainly, never
  // imply comp-backed precision.
  const noComps = !!report && report.compAnalysis.compCount === 0;

  // P3 — the witnessed-send HANDOFF. Hands Pax the parcel context + an offer-
  // amount-bearing starter prompt. Pax composes the send_email tool call, freezes
  // it as a pending_actions row, and the user approves it via the existing
  // "Approve & send" button. This function NEVER sends anything itself.
  function handToPax() {
    if (uplBlocked || !report) return;
    const offer = usd(report.recommendedOfferTotal, { noCents: true });
    openWithContext({
      entityType: "property",
      entityId: property.id,
      entityName: parcelLabel,
      starterPrompt:
        `Draft a blind-offer email to the owner of ${parcelLabel} ` +
        `(${county} County, ${state}) at ${offer} and prepare it for my approval. ` +
        (noComps
          ? `Note: this offer is modeled from USDA land values — no recent comps were available — so keep the language honest about that. `
          : ``) +
        (uplWarning?.severity === "warn"
          ? `Include the assignment-disclosure paragraph required in ${state}. `
          : ``) +
        `Do not send it — freeze it for my review so I can approve and send.`,
    });
  }

  if (!expanded) {
    return (
      <Button
        size="sm"
        className="h-8 text-xs"
        onClick={() => setExpanded(true)}
        data-testid="inline-blind-offer-open"
      >
        <DollarSign className="w-3 h-3 mr-1" aria-hidden="true" />
        Make Offer
      </Button>
    );
  }

  return (
    <div className="col-span-2 rounded-card border bg-muted/20 p-3 space-y-3" data-testid="inline-blind-offer">
      <div className="flex items-center justify-between gap-2">
        <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <DollarSign className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          Blind offer
        </p>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="Collapse blind offer composer"
          className="min-h-11 min-w-11 pointer-fine:sm:min-h-7 pointer-fine:sm:min-w-7 -my-1 flex items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      {/* UPL gate — same banner + severity rule as the full wizard. */}
      <StateUplBanner state={state} />

      {uplBlocked ? (
        // Block-severity state: no draft, no handoff. The banner above explains
        // why; we only offer the licensed-path off-ramp (the full wizard's
        // double-close flow).
        <div className="text-xs text-muted-foreground">
          For-fee assignment is blocked in {state}. Use the double-close flow in the{" "}
          <Link href={`/blind-offer-wizard?propertyId=${property.id}`} className="text-primary underline">
            full wizard
          </Link>
          .
        </div>
      ) : isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-7 w-32" announceText="Modeling your offer" />
          <Skeleton className="h-3 w-full" announce={false} />
          <Skeleton className="h-3 w-3/4" announce={false} />
        </div>
      ) : isError || !report ? (
        <QueryErrorState
          error={error instanceof Error ? error : null}
          onRetry={() => refetch()}
          isRetrying={isFetching}
          title="Couldn't draft the offer"
          description="The parcel, county and acreage are preserved. Most retries succeed."
          testId="inline-blind-offer-error"
        />
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-end gap-2">
            <span className="text-xl font-bold text-acr-pos tabular-nums">
              {usd(report.recommendedOfferTotal, { noCents: true })}
            </span>
            <Badge variant="outline" className="text-[9px] capitalize mb-0.5">
              {report.recommendedTier}
            </Badge>
          </div>
          {/* Honest precision framing. */}
          {noComps ? (
            <p className="text-micro text-acr-warn flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
              {report.marketContext.usdaLandValuePerAcre === null ? (
                <>
                  No recent comps available and no USDA land value on file for this
                  county — this offer is not anchored to a measured land value.
                </>
              ) : (
                <>
                  Offer modeled from USDA land values (
                  {usd(report.marketContext.usdaLandValuePerAcre, { noCents: true })}/ac); no
                  recent comps available.
                </>
              )}
            </p>
          ) : (
            <p className="text-micro text-muted-foreground">
              Anchored on {report.compAnalysis.compCount} recent comp{report.compAnalysis.compCount === 1 ? "" : "s"} + USDA land values.
            </p>
          )}
          <p className="text-xs text-muted-foreground leading-snug">{report.recommendationReason}</p>

          {/* P3 — witnessed-send handoff. Disabled in block-severity states
              (already short-circuited above; defensive guard kept). */}
          <Button
            size="sm"
            className="w-full h-8 text-xs"
            onClick={handToPax}
            disabled={uplBlocked}
            data-testid="inline-blind-offer-hand-to-pax"
          >
            <Sparkles className="w-3 h-3 mr-1" aria-hidden="true" />
            Hand to Pax to send
          </Button>
          <p className="text-[10px] text-muted-foreground text-center">
            Pax drafts it and freezes it for your approval — nothing sends until you tap “Approve &amp; send.”
          </p>
        </div>
      )}

      <Button asChild size="sm" variant="outline" className="w-full h-7 text-xs">
        <Link href={`/blind-offer-wizard?propertyId=${property.id}`}>
          Open full wizard
        </Link>
      </Button>
    </div>
  );
}

function PropertyIntelligencePanel({
  property,
  onClose,
  variant = "desktop",
}: {
  property: Property;
  onClose: () => void;
  /**
   * "desktop" renders the fixed w-80 side panel.
   * "mobile" renders the same content body inside a bottom Sheet (the Sheet
   * shell, grabber, and Close button are owned by the parent — this variant
   * drops the side-panel chrome + the panel's own close button to avoid
   * duplicate close affordances). Driving-for-dollars is the #1 mobile path,
   * so the pin-tap detail must be a bottom sheet, never a 320px side panel.
   */
  variant?: "desktop" | "mobile";
}) {
  const acres = parseFloat(String(property.sizeAcres || "0"));
  const isMobile = variant === "mobile";

  // Fetch AI-powered property intelligence from AVM endpoint
  const { data: avmData, isLoading: avmLoading } = useQuery({
    queryKey: ["/api/avm", property.id],
    queryFn: async () => {
      const res = await fetch(`/api/avm/${property.id}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });


  // "Check now" — trigger a real enrichment lookup, then refresh the AVM query.
  // This pulls actual data (or honestly fails); it NEVER fabricates a value.
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const checkNow = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/broker/enrich-property", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: property.id, forceRefresh: true }),
      });
      if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/avm", property.id] });
    },
    onError: () => {
      toast({
        title: "Couldn't reach the data source",
        description: "The public records lookup didn't respond. Try again in a moment.",
        variant: "destructive",
      });
    },
  });
  const handleCheckNow = useCallback(() => checkNow.mutate(), [checkNow]);
  const checking = checkNow.isPending;

  const intel: PropertyIntelligence = useMemo(
    () => deriveIntel(avmData, property),
    [avmData, property],
  );

  const TrendIcon = intel.marketTrend === "up" ? ArrowUpRight : intel.marketTrend === "down" ? ArrowDownRight : Minus;
  const trendColor = intel.marketTrend === "up" ? "text-acr-pos" : intel.marketTrend === "down" ? "text-acr-neg" : "text-muted-foreground";

  return (
    <div
      className={cn(
        "bg-card flex flex-col",
        isMobile
          ? // Inside a bottom Sheet: fill its height, let the body scroll. The
            // Sheet owns its own elevation, so no shadow here.
            "h-full min-h-0 overflow-hidden"
          : // Bold Tahoe re-skin (Wave R, §2.1 L1 elevated card): the desktop
            // side rail is a solid content surface flanking the map, so it earns
            // Track-2 `shadow-acr-2` (theme-aware ink shadow) to read as an
            // elevated plane against the canvas. Solid card → never shadow-level-*.
            "w-80 border-l overflow-y-auto flex-shrink-0 shadow-acr-2",
      )}
      style={
        isMobile
          ? undefined
          : { maxHeight: "calc(100dvh - 130px - env(safe-area-inset-bottom, 0px))" }
      }
    >
      {/* Header */}
      {/* Bold Tahoe re-skin (Wave R, §4 depth): semantic `z-docked` (= the 10 it
          already had) for the sticky panel header instead of the raw z-docked. */}
      <div className="p-3 border-b bg-gradient-to-r from-primary/5 to-primary/10 flex items-start justify-between gap-2 sticky top-0 z-docked">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-micro capitalize">
              {property.status?.replace(/_/g, " ") || "Prospect"}
            </Badge>
            {intel.opportunityScore !== undefined && (
              <Badge className="text-micro bg-primary/10 text-primary border-primary/20">
                <Sparkles className="w-2.5 h-2.5 mr-0.5" aria-hidden="true" />
                {intel.opportunityScore} opp
              </Badge>
            )}
          </div>
          <h2 className="font-bold text-sm mt-1 truncate">
            {property.address || `${property.county}, ${property.state}`}
          </h2>
          <p className="text-xs text-muted-foreground truncate">
            {property.county}, {property.state}
            {property.apn && <> · APN: {property.apn}</>}
          </p>
          {/* Owner row (T3-3B) — honest-null. Only renders a name when the
              enrichment/assessor lookup actually returned one; otherwise the
              same "Not yet pulled · Check now" affordance every other intel
              field uses. We NEVER fabricate an owner-of-record. */}
          <div className="flex items-center gap-1.5 mt-1 min-w-0" data-testid="intel-owner-row">
            <Users className="w-3 h-3 text-muted-foreground shrink-0" aria-hidden="true" />
            {intel.ownerName ? (
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs font-medium truncate">{intel.ownerName}</span>
                {intel.ownerOccupied === false && (
                  <Badge variant="outline" className="text-[9px] shrink-0">Absentee</Badge>
                )}
                {intel.ownerSource && (
                  <DataProvenanceChip
                    source={intel.ownerSource}
                    sourceAsOf={intel.sourceAsOf}
                    classification="authoritative"
                  />
                )}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <span>Owner</span>
                <span aria-hidden="true" className="text-muted-foreground/60">·</span>
                <UnknownValue onCheck={handleCheckNow} checking={checking} compact />
              </span>
            )}
          </div>
        </div>
        {/* On mobile the Sheet shell owns the close affordance (top-right X +
            swipe-down + scrim tap), so we suppress the panel's own button to
            avoid a duplicate. Desktop keeps its 44px close target. */}
        {!isMobile && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close property intelligence panel"
            className="min-h-11 min-w-11 pointer-fine:sm:min-h-9 pointer-fine:sm:min-w-9 -mr-1 -mt-1 flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="overflow-y-auto flex-1">
        {/* AI Valuation Hero */}
        <div className="p-3 border-b bg-gradient-to-br from-card to-muted/30">
          {avmLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-8 bg-muted rounded w-3/4" />
              <div className="h-4 bg-muted rounded w-1/2" />
            </div>
          ) : intel.estimatedValue ? (
            <div>
              <div className="flex items-end gap-2">
                <span className="text-2xl font-bold text-primary tabular-nums">
                  {usd(intel.estimatedValue, { noCents: true })}
                </span>
                {intel.marketTrendPct !== undefined && (
                  <div className={cn("flex items-center gap-0.5 text-xs font-medium mb-0.5", trendColor)}>
                    <TrendIcon className="w-3.5 h-3.5" />
                    {intel.marketTrendPct.toFixed(1)}% YoY
                  </div>
                )}
              </div>
              {intel.estimatedValueIsListPrice && (
                <p className="text-micro text-muted-foreground mt-0.5">
                  Your list price · run an AVM for a modeled estimate
                </p>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                {intel.pricePerAcre && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {usd(intel.pricePerAcre, { noCents: true })}/ac
                  </span>
                )}
                {intel.valueConfidence !== undefined && (
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${intel.valueConfidence}%` }}
                      />
                    </div>
                    <span className="text-micro text-muted-foreground">{intel.valueConfidence}% conf</span>
                  </div>
                )}
              </div>
              {acres > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {acres.toLocaleString()} acres
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <Activity className="w-4 h-4" aria-hidden="true" />
                No valuation pulled yet
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs shrink-0"
                onClick={handleCheckNow}
                disabled={checking}
              >
                {checking ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" aria-hidden="true" />
                ) : (
                  <Search className="w-3 h-3 mr-1" aria-hidden="true" />
                )}
                {checking ? "Checking…" : "Look up"}
              </Button>
            </div>
          )}
        </div>

        {/* Intelligence Score Rings — only render scores we actually have. */}
        {(() => {
          const rings: { score: number; label: string; color: string }[] = [];
          if (intel.opportunityScore !== undefined)
            rings.push({ score: intel.opportunityScore, label: "Opportunity", color: "hsl(var(--primary))" });
          if (intel.solarScore !== undefined)
            rings.push({ score: intel.solarScore, label: "Solar", color: "var(--acr-heat-warm)" });
          if (intel.soilQuality !== undefined)
            rings.push({ score: intel.soilQuality, label: "Soil", color: "var(--acr-pos)" });
          if (intel.floodRisk)
            rings.push({
              score: intel.floodRisk === "minimal" ? 90 : intel.floodRisk === "moderate" ? 50 : 20,
              label: "Flood Safe",
              color:
                intel.floodRisk === "minimal"
                  ? "var(--acr-pos)"
                  : intel.floodRisk === "moderate"
                  ? "var(--acr-heat-warm)"
                  : "var(--acr-heat-hot)",
            });
          return (
            <div className="p-3 border-b" data-testid="intel-score-rings">
              <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-2">Property Intelligence</p>
              {rings.length > 0 ? (
                <div className="flex items-center justify-around">
                  {rings.map((r) => (
                    <ScoreRing key={r.label} score={r.score} label={r.label} color={r.color} />
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2 text-muted-foreground" data-testid="intel-scores-empty">
                  <span className="text-xs flex items-center gap-1.5">
                    <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                    Scores haven't been pulled for this parcel
                  </span>
                  <UnknownValue onCheck={handleCheckNow} checking={checking} />
                </div>
              )}
            </div>
          );
        })()}

        {/* Honesty: no fabricated price-history sparkline. The single honest
            estimated value + YoY figure is rendered above with its provenance;
            we never synthesize a per-month price curve. See the no-synthetic-series
            CI contract (scripts/check-no-synthetic-series.mjs). */}

        {/* Environmental Risk Radar — built only from dimensions we actually
            pulled. A radar of invented scores is the exact trust bomb we're
            killing, so we render it only when ≥3 real dimensions exist. */}
        {(() => {
          const radarData: { axis: string; value: number }[] = [];
          if (intel.floodRisk)
            radarData.push({ axis: "Flood Safe", value: intel.floodRisk === "minimal" ? 92 : intel.floodRisk === "moderate" ? 55 : 20 });
          if (intel.slopeRisk)
            radarData.push({ axis: "Slope Safe", value: intel.slopeRisk === "low" ? 90 : intel.slopeRisk === "moderate" ? 60 : 25 });
          if (intel.soilQuality !== undefined)
            radarData.push({ axis: "Soil Quality", value: intel.soilQuality });
          if (intel.solarScore !== undefined)
            radarData.push({ axis: "Solar Score", value: intel.solarScore });
          if (intel.opportunityScore !== undefined)
            radarData.push({ axis: "Opportunity", value: intel.opportunityScore });
          if (intel.roadAccess !== undefined)
            radarData.push({ axis: "Road Access", value: intel.roadAccess ? 95 : 20 });

          // A radar needs ≥3 axes to be a shape; below that, be honest.
          if (radarData.length < 3) return null;
          return (
            <div className="p-3 border-b">
              <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Environmental Risk Radar
              </p>
              <div role="img" aria-label={`Environmental risk radar across ${radarData.length} dimensions: ${radarData.map(d => `${d.axis} ${d.value}`).join(", ")}`}>
                <ResponsiveContainer width="100%" height={130}>
                  <RadarChart data={radarData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis
                      dataKey="axis"
                      tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
                    />
                    <Radar
                      name="Score"
                      dataKey="value"
                      stroke="hsl(var(--primary))"
                      fill="hsl(var(--primary))"
                      fillOpacity={0.2}
                      strokeWidth={1.5}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })()}

        {/* Terrain & Physical Attributes. Every value is real-or-honest:
            a missing field renders "Not yet pulled · Check now", never a
            fabricated number or a default flood zone. */}
        <div className="p-3 border-b">
          <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-2">Terrain & Physical</p>
          <div className="space-y-0">
            <IntelligenceRow
              label="Avg Slope Grade"
              icon={Mountain}
              iconClass="text-muted-foreground"
              value={
                intel.slopeGrade !== undefined ? (
                  <span className={getRiskColor(intel.slopeRisk)}>
                    {intel.slopeGrade.toFixed(1)}°
                    {intel.slopeRisk && (
                      <span className="ml-1 text-micro opacity-70">({intel.slopeRisk})</span>
                    )}
                  </span>
                ) : (
                  <UnknownValue onCheck={handleCheckNow} checking={checking} />
                )
              }
            />
            {/* Slope Aspect: ONLY shown when real terrain data carries a true
                azimuth. The old coordinate-hash fabrication is deleted. */}
            {intel.slopeAspect !== undefined && (
              <IntelligenceRow
                label="Slope Aspect"
                icon={Navigation}
                iconClass="text-acr-brand"
                value={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help font-mono text-micro bg-muted px-1.5 py-0.5 rounded">
                        {getSlopeAspectLabel(intel.slopeAspect).icon}{" "}
                        {getSlopeAspectLabel(intel.slopeAspect).label}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left" className="text-xs">
                      {getSlopeAspectLabel(intel.slopeAspect).full}
                      {" — affects solar exposure, drainage & microclimate"}
                    </TooltipContent>
                  </Tooltip>
                }
              />
            )}
            <IntelligenceRow
              label="Solar Irradiance"
              icon={Sun}
              iconClass="text-acr-warn"
              value={
                intel.solarScore !== undefined ? (
                  <span className="flex items-center gap-1">
                    {intel.solarScore}/100
                    {intel.solarScore >= 70 && (
                      <CheckCircle2 className="w-3 h-3 text-acr-pos" aria-hidden="true" />
                    )}
                  </span>
                ) : (
                  <UnknownValue onCheck={handleCheckNow} checking={checking} />
                )
              }
            />
            <div className="py-1.5 border-b border-border/50">
              <IntelligenceRow
                label="Flood Zone"
                icon={Droplets}
                iconClass="text-acr-accent"
                value={
                  intel.floodZone ? (
                    <span className={cn("font-mono text-micro px-1.5 py-0.5 rounded",
                      intel.floodRisk === "minimal" ? "bg-acr-pos-soft text-acr-pos" :
                      intel.floodRisk === "moderate" ? "bg-acr-warn-soft text-acr-warn" :
                      intel.floodRisk === "high" ? "bg-acr-neg-soft text-acr-neg" :
                      "bg-muted text-foreground"
                    )}>
                      FEMA {intel.floodZone}
                    </span>
                  ) : (
                    <UnknownValue onCheck={handleCheckNow} checking={checking} />
                  )
                }
              />
              {intel.floodZone && intel.source && (
                <div className="flex justify-end -mt-0.5">
                  <DataProvenanceChip
                    source={intel.source}
                    sourceAsOf={intel.sourceAsOf}
                    confidence={intel.valueConfidence}
                    classification={intel.classification}
                  />
                </div>
              )}
            </div>
            <div className="py-1.5">
              <IntelligenceRow
                label="Soil Quality"
                icon={TreePine}
                iconClass="text-acr-pos"
                value={
                  intel.soilQuality !== undefined ? (
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 w-14 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-acr-pos"
                          style={{ width: `${intel.soilQuality}%` }}
                        />
                      </div>
                      <span>{intel.soilQuality}</span>
                    </div>
                  ) : (
                    <UnknownValue onCheck={handleCheckNow} checking={checking} />
                  )
                }
              />
            </div>
          </div>
        </div>

        {/* Utilities & Access — tri-state. An UNPULLED flag reads "Unknown",
            never "None": we don't imply a parcel lacks road/water/power when
            we simply haven't looked it up. */}
        <div className="p-3 border-b">
          <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-2">Utilities & Access</p>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: "Road", icon: Navigation, ok: intel.roadAccess },
              { label: "Water", icon: Droplets, ok: intel.waterAccess },
              { label: "Power", icon: Zap, ok: intel.powerAccess },
            ].map(({ label, icon: Icon, ok }) => (
              <div
                key={label}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md p-2 text-center",
                  ok === true
                    ? "bg-acr-pos-soft dark:bg-acr-pos-soft/20 border border-acr-pos-soft dark:border-acr-pos-soft"
                    : "bg-muted/50 border border-border"
                )}
              >
                <Icon className={cn("w-4 h-4", ok === true ? "text-acr-pos" : "text-muted-foreground")} aria-hidden="true" />
                <span className="text-micro font-medium">{label}</span>
                <span className={cn("text-[9px]", ok === true ? "text-acr-pos" : "text-muted-foreground")}>
                  {ok === true ? "Available" : ok === false ? "None" : "Unknown"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Zoning & Regulatory */}
        {(intel.zoningCode || intel.annualTaxes || intel.lastAssessedValue) && (
          <div className="p-3 border-b">
            <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-2">Zoning & Financials</p>
            <div className="space-y-0">
              {intel.zoningCode && (
                <IntelligenceRow
                  label="Zoning"
                  icon={Info}
                  value={
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge variant="outline" className="text-micro font-mono cursor-help">
                          {intel.zoningCode}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        {intel.zoningDescription ?? intel.zoningCode}
                      </TooltipContent>
                    </Tooltip>
                  }
                />
              )}
              {intel.lastAssessedValue && (
                <IntelligenceRow
                  label="Assessed value"
                  icon={BarChart3}
                  iconClass="text-acr-accent"
                  value={usd(intel.lastAssessedValue, { noCents: true })}
                />
              )}
              {intel.annualTaxes && (
                <IntelligenceRow
                  label="Annual taxes"
                  icon={DollarSign}
                  iconClass="text-acr-warn"
                  value={`${usd(intel.annualTaxes, { noCents: true })}/yr`}
                />
              )}
            </div>
          </div>
        )}

        {/* No mini-comps panel: its query hit GET /api/comps/:id, a route
            that never existed, so it silently rendered nothing on every pin
            tap while firing a guaranteed 404. Comps are a metered lookup
            (POST /api/comps/search) — they belong behind a deliberate action
            on the property page, not a free-looking ambient panel here. */}

        {/* Quick Actions */}
        <div className="p-3 space-y-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-1">Quick Actions</p>
          <div className="grid grid-cols-2 gap-1.5">
            {/* T3-3B — the inline blind-offer composer replaces the old
                navigate-away "Make Offer" Link. Collapsed it's a button in
                this slot; expanded it spans both columns (col-span-2) with the
                drafted offer + the witnessed-send handoff to Pax. */}
            <InlineBlindOfferComposer property={property} />
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link href={`/negotiation?propertyId=${property.id}`}>
                <MessageSquare className="w-3 h-3 mr-1" />
                Negotiate
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link href={`/properties?id=${property.id}`}>
                <FileText className="w-3 h-3 mr-1" />
                Full Profile
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 text-xs">
              <Link href={`/properties?id=${property.id}&tab=analysis`}>
                <BarChart3 className="w-3 h-3 mr-1" />
                Run AVM
              </Link>
            </Button>
          </div>
          <Button asChild size="sm" variant="default" className="w-full h-8 text-xs">
            <Link href={`/properties?id=${property.id}`}>
              <ExternalLink className="w-3 h-3 mr-2" />
              Open Full Property View
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Deal Portfolio Stats ───────────────────────────────────────────────────

function PortfolioStatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border", color)}>
      <span className="text-muted-foreground">{label}:</span>
      <span>{value}</span>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function MapsPage() {
  useDocumentTitle("Map");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  // Persona controls the strip's variant + the default mapMode.
  // The dock label "Map" stays the same (five fixed doors); only
  // the content behind the door changes.
  const persona = usePersona();
  const { isMobile } = useIsMobile();
  // For the note roles the map is secondary — collateral, not parcels — so
  // they land on the deals/portfolio view rather than parcel discovery. Land
  // investors (and unmapped personas) keep parcel mode, where sourcing lives.
  const personaDefaultMode: "properties" | "deals" =
    persona === "note_investor" ||
    persona === "note_originator" ||
    persona === "note_servicer" ||
    persona === "fix_flipper" ||
    persona === "subdivider"
      ? "deals"
      : "properties";
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | undefined>();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minAcres, setMinAcres] = useState(0);
  const [maxAcres, setMaxAcres] = useState(10000);
  const [mapMode, setMapMode] = useState<"properties" | "deals">(personaDefaultMode);
  const [showBuyerDemandHeatmap, setShowBuyerDemandHeatmap] = useState(false);
  const [showPredictionHeatmap, setShowPredictionHeatmap] = useState(false);
  // Tier 3F — cross-org data co-op layer. Lives INSIDE the Map door (five
  // fixed doors): a panel of privacy-preserving county aggregates (k>=5
  // floor server-side; below the floor the panel shows progress, never heat).
  const [showMarketHeat, setShowMarketHeat] = useState(false);
  // RAFE (Tahoe Wave-2): "See a sample" — guarantees a first lookup never
  // returns empty by running a REAL enrichment on a curated data-rich parcel.
  const [samplePreviewOpen, setSamplePreviewOpen] = useState(false);
  const headerSearchId = useId();
  const mobileSearchId = useId();
  const sheetStatusId = useId();
  const minAcresId = useId();
  const maxAcresId = useId();

  const {
    data: propertiesRaw = [],
    isLoading,
    isError: propsError,
    error: propsErr,
    refetch: refetchProps,
  } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
    queryFn: async () => {
      const res = await okOrThrow(
        await fetch("/api/properties?page=1&pageSize=100", { credentials: "include" }),
      );
      return listFrom<Property>(await res.json());
    },
    retry: false,
  });
  const properties = Array.isArray(propertiesRaw) ? propertiesRaw : [];

  const { data: dealsRaw = [] } = useQuery<DealWithProperty[]>({
    queryKey: ["/api/deals"],
    queryFn: async () => {
      const res = await okOrThrow(
        await fetch("/api/deals?page=1&pageSize=100", { credentials: "include" }),
      );
      return listFrom<DealWithProperty>(await res.json());
    },
    retry: false,
  });
  const deals = Array.isArray(dealsRaw) ? dealsRaw : [];

  const dealByPropertyId = useMemo(() => {
    const map: Record<number, DealWithProperty> = {};
    for (const d of deals) {
      if (!map[d.propertyId] || d.id > map[d.propertyId].id) {
        map[d.propertyId] = d;
      }
    }
    return map;
  }, [deals]);

  const filteredProperties = useMemo(() => {
    return properties.filter((p) => {
      if (!p.latitude || !p.longitude) return false;

      const matchSearch =
        !searchQuery ||
        p.address?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.apn?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.county?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchStatus = statusFilter === "all" || p.status === statusFilter;

      const acres = parseFloat(String(p.sizeAcres || "0"));
      const matchAcres = acres >= minAcres && (maxAcres >= 10000 || acres <= maxAcres);

      if (mapMode === "deals") {
        return matchSearch && matchStatus && matchAcres && !!dealByPropertyId[p.id];
      }

      return matchSearch && matchStatus && matchAcres;
    });
  }, [properties, searchQuery, statusFilter, minAcres, maxAcres, mapMode, dealByPropertyId]);

  const mapProperties = filteredProperties.map((p) => {
    const lat = parseFloat(String(p.latitude));
    const lng = parseFloat(String(p.longitude));

    let status = p.status || "default";
    if (mapMode === "deals") {
      const deal = dealByPropertyId[p.id];
      status = deal?.status || status;
    }

    // Honesty: never fabricate an authoritative parcel outline. We only ever
    // hand the map a *real* surveyed boundary. When we don't have one, we omit
    // the polygon entirely (the map still locates the parcel via its centroid)
    // and flag it approximate, rather than drawing a synthetic square that
    // reads as a surveyed lot line. `isApproximate` is carried so the map layer
    // can style an estimated extent distinctly if/when it supports it.
    const realBoundary = (p.parcelBoundary as any) || undefined;
    return {
      id: p.id,
      apn: p.apn,
      name: `${p.county}, ${p.state}`,
      boundary: realBoundary,
      isApproximate: !realBoundary,
      centroid: (p.parcelCentroid as any) || { lat, lng },
      status,
    };
  });

  const selectedProperty = selectedPropertyId
    ? properties.find((p) => p.id === selectedPropertyId)
    : null;

  const propertiesWithCoords = properties.filter((p) => p.latitude && p.longitude).length;

  const dealStats = useMemo(() => {
    const active = deals.filter((d) => !["closed", "dead", "cancelled"].includes(d.status));
    const closed = deals.filter((d) => d.status === "closed");
    const totalVolume = closed.reduce((s, d) => s + Number(d.acceptedAmount || 0), 0);
    const pendingValue = active.reduce((s, d) => s + Number(d.acceptedAmount || 0), 0);
    return { active: active.length, closed: closed.length, totalVolume, pendingValue };
  }, [deals]);

  // Portfolio summary stats
  const portfolioStats = useMemo(() => {
    const owned = properties.filter((p) => p.status === "owned");
    const totalAcres = owned.reduce((s, p) => s + parseFloat(String(p.sizeAcres || "0")), 0);
    const totalValue = owned.reduce((s, p) => s + parseFloat(String(p.listPrice || p.purchasePrice || "0")), 0);
    return { ownedCount: owned.length, totalAcres, totalValue };
  }, [properties]);

  return (
    <PageShell label="Maps">
      <div className="-mx-4 -my-8 md:-mx-8 md:-my-8">
        {/* Header bar */}
        {/* Bold Tahoe re-skin (Wave R, §1.2 nested sticky chrome): this is the
            map's own control bar, nested under the global PageTopbar — so it
            takes the lighter `bg-surface-veil` (.80) translucency role so the
            two planes read as distinct, the bold `backdrop-blur-lg` depth read,
            and a softened `border-border/50` edge-of-light hairline. `z-docked`
            (10) keeps the semantic layer it already had (z-docked). No shadow — it
            sits under the primary topbar's shadow. Visual-only; layout/sizing
            unchanged. See docs/design/reskin-treatment.md. */}
        <div className="flex items-center gap-2 px-4 md:px-6 py-2.5 border-b border-border/50 bg-surface-veil backdrop-blur-lg sticky top-0 z-docked">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <MapPin className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
            <h1 className="text-section-h2 truncate">
              {mapMode === "deals" ? "Portfolio map" : "Property intelligence map"}
            </h1>
            <Badge variant="secondary" className="text-micro shrink-0 tabular-nums" aria-label={`${filteredProperties.length} of ${propertiesWithCoords} property pins shown`}>
              {filteredProperties.length}/{propertiesWithCoords}
            </Badge>
            {mapMode === "deals" && (
              <>
                <PortfolioStatPill
                  label="Active"
                  value={String(dealStats.active)}
                  color="border-acr-accent text-acr-accent dark:border-acr-accent dark:text-acr-accent"
                />
                <PortfolioStatPill
                  label="Closed"
                  value={`$${(dealStats.totalVolume / 1000).toFixed(0)}K`}
                  color="border-acr-pos-soft text-acr-pos dark:border-acr-pos-soft dark:text-acr-pos"
                />
              </>
            )}
            {mapMode === "properties" && portfolioStats.ownedCount > 0 && (
              <PortfolioStatPill
                label="Owned"
                value={`${portfolioStats.totalAcres.toFixed(0)} ac`}
                color="border-sage-200 text-sage-700 dark:border-sage-800"
              />
            )}
            {showBuyerDemandHeatmap && (
              <Badge className="text-micro shrink-0 bg-acr-accent text-acr-accent hidden md:flex">
                <Users className="w-2.5 h-2.5 mr-1" /> Demand
              </Badge>
            )}
            {showPredictionHeatmap && (
              <Badge className="text-micro shrink-0 bg-acr-brand-soft text-acr-brand hidden md:flex">
                <TrendingUp className="w-2.5 h-2.5 mr-1" /> Prediction
              </Badge>
            )}
            {showMarketHeat && (
              <Badge className="text-micro shrink-0 bg-acr-heat-warm-soft text-acr-heat-warm hidden md:flex">
                <Flame className="w-2.5 h-2.5 mr-1" /> Market heat
              </Badge>
            )}
          </div>

          {/* Mode toggle — shadcn Button group, design system §4.1 */}
          <div className="flex items-center rounded-md border overflow-hidden shrink-0" role="group" aria-label="Map mode">
            <Button
              type="button"
              size="sm"
              variant={mapMode === "properties" ? "default" : "ghost"}
              className="rounded-none h-7 text-xs px-2.5 border-0 focus-visible:ring-inset"
              onClick={() => setMapMode("properties")}
              aria-pressed={mapMode === "properties"}
            >
              Properties
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mapMode === "deals" ? "default" : "ghost"}
              className="rounded-none h-7 text-xs px-2.5 border-0 border-l focus-visible:ring-inset"
              onClick={() => setMapMode("deals")}
              aria-pressed={mapMode === "deals"}
            >
              Deals
            </Button>
          </div>

          {/* r6 Tasha WF-R6-001 mobile capture MVP: geolocate + reverse
              geocode + open Add Property on /properties with the lat/lng
              pre-filled. On a phone this is the driving-for-dollars
              "I'm standing next to a parcel — add it now" entry point. */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-testid="button-use-my-location"
            aria-label="Use my current location to add a property"
            onClick={async () => {
              if (!navigator.geolocation) {
                toast({
                  variant: "destructive",
                  title: "Geolocation not supported",
                  description: "Your browser doesn't expose location. Add the property manually from the Inventory page.",
                });
                return;
              }
              navigator.geolocation.getCurrentPosition(
                async (pos) => {
                  const { latitude, longitude } = pos.coords;
                  try {
                    const res = await fetch(`/api/geocode/reverse?lat=${latitude}&lng=${longitude}`, { credentials: "include" });
                    if (res.ok) {
                      const data = await res.json();
                      const county = data.county || "";
                      const state = data.state || "";
                      const qs = new URLSearchParams({
                        addAtLat: String(latitude),
                        addAtLng: String(longitude),
                        addCounty: county,
                        addState: state,
                      }).toString();
                      setLocation(`/properties?${qs}`);
                    } else {
                      const qs = new URLSearchParams({ addAtLat: String(latitude), addAtLng: String(longitude) }).toString();
                      setLocation(`/properties?${qs}`);
                    }
                  } catch {
                    const qs = new URLSearchParams({ addAtLat: String(latitude), addAtLng: String(longitude) }).toString();
                    setLocation(`/properties?${qs}`);
                  }
                },
                (err) => {
                  toast({
                    variant: "destructive",
                    title: "Couldn't get your location",
                    description: `${err.message}. Try enabling location in your browser, or add the property manually.`,
                  });
                }
              );
            }}
          >
            <Navigation className="w-3 h-3 mr-1" aria-hidden="true" />
            <span className="hidden md:inline">Use my location</span>
            <span className="md:hidden">Locate</span>
          </Button>

          {/* Search */}
          <div className="relative w-44 hidden sm:block">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            <Label htmlFor={headerSearchId} className="sr-only">Search properties</Label>
            <Input
              id={headerSearchId}
              type="search"
              inputMode="search"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-7 h-7 pointer-coarse:min-h-11 text-xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 -translate-y-1/2 min-h-11 min-w-11 pointer-fine:sm:min-h-9 pointer-fine:sm:min-w-9 flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            {/* h-7 keeps the toolbar dense for mouse users; pointer-coarse:min-h-11
                holds the 44px Apple-HIG floor on touch tablets (min-height beats
                height, so the floor wins on coarse pointers at any width). */}
            <SelectTrigger className="w-32 h-7 pointer-coarse:min-h-11 text-xs hidden md:flex" aria-label="Filter by property status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Filters drawer */}
          <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-label="Open map filters"
                className="gap-1.5 shrink-0 min-h-11 min-w-11 sm:min-w-0 pointer-fine:sm:min-h-9 pointer-fine:sm:h-7 text-xs px-2.5"
              >
                <SlidersHorizontal className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">Filters</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-sm">
                  <Filter className="w-4 h-4" aria-hidden="true" />
                  Map filters & layers
                </SheetTitle>
              </SheetHeader>
              <fieldset className="space-y-5 mt-5 border-0 p-0 m-0">
                <legend className="sr-only">Map filter controls</legend>
                {/* Search (mobile) */}
                <div className="sm:hidden">
                  <Label htmlFor={mobileSearchId} className="text-xs font-medium">Search</Label>
                  <div className="relative mt-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
                    <Input
                      id={mobileSearchId}
                      type="search"
                      inputMode="search"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder="Search…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 text-sm"
                    />
                  </div>
                </div>

                {/* Status */}
                <div>
                  <Label htmlFor={sheetStatusId} className="text-xs font-medium">Property status</Label>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger id={sheetStatusId} className="mt-1.5 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Acreage range */}
                <div>
                  <Label htmlFor={minAcresId} className="text-xs font-medium">
                    Min acres: <span className="text-primary tabular-nums">{minAcres.toLocaleString()}</span>
                  </Label>
                  <Slider
                    id={minAcresId}
                    min={0}
                    max={1000}
                    step={10}
                    value={[minAcres]}
                    onValueChange={([v]) => setMinAcres(v)}
                    className="mt-2"
                    aria-label="Minimum acres"
                    aria-valuetext={`${minAcres.toLocaleString()} acres minimum`}
                  />
                </div>
                <div>
                  <Label htmlFor={maxAcresId} className="text-xs font-medium">
                    Max acres: <span className="text-primary tabular-nums">{maxAcres >= 10000 ? "No limit" : maxAcres.toLocaleString()}</span>
                  </Label>
                  <Slider
                    id={maxAcresId}
                    min={100}
                    max={10000}
                    step={100}
                    value={[maxAcres]}
                    onValueChange={([v]) => setMaxAcres(v)}
                    className="mt-2"
                    aria-label="Maximum acres"
                    aria-valuetext={maxAcres >= 10000 ? "No upper limit" : `${maxAcres.toLocaleString()} acres maximum`}
                  />
                </div>

                {/* Data Layers */}
                <fieldset className="space-y-3 pt-2 border-t border-0 p-0 m-0">
                  <legend className="flex items-center gap-2 text-xs font-semibold">
                    <Layers className="w-3.5 h-3.5 text-primary" aria-hidden="true" /> Intelligence layers
                  </legend>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="w-3.5 h-3.5 text-acr-accent" aria-hidden="true" />
                      <div>
                        <Label htmlFor="layer-buyer-demand" className="text-xs cursor-pointer">Buyer-demand heatmap</Label>
                        <p className="text-micro text-muted-foreground">Inquiry density by area.</p>
                      </div>
                    </div>
                    <Switch id="layer-buyer-demand" checked={showBuyerDemandHeatmap} onCheckedChange={setShowBuyerDemandHeatmap} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="w-3.5 h-3.5 text-acr-brand" aria-hidden="true" />
                      <div>
                        <Label htmlFor="layer-ml-prediction" className="text-xs cursor-pointer">ML price prediction</Label>
                        <p className="text-micro text-muted-foreground">Green = above avg, red = below.</p>
                      </div>
                    </div>
                    <Switch id="layer-ml-prediction" checked={showPredictionHeatmap} onCheckedChange={setShowPredictionHeatmap} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Flame className="w-3.5 h-3.5 text-acr-heat-warm" aria-hidden="true" />
                      <div>
                        <Label htmlFor="layer-market-heat" className="text-xs cursor-pointer">County market heat</Label>
                        <p className="text-micro text-muted-foreground">Network aggregates per county.</p>
                      </div>
                    </div>
                    <Switch id="layer-market-heat" checked={showMarketHeat} onCheckedChange={setShowMarketHeat} />
                  </div>
                </fieldset>

                <Button variant="outline" className="w-full text-sm" onClick={() => {
                  setSearchQuery(""); setStatusFilter("all"); setMinAcres(0); setMaxAcres(10000);
                  setShowBuyerDemandHeatmap(false); setShowPredictionHeatmap(false);
                  setShowMarketHeat(false);
                }}>
                  Reset all filters
                </Button>
              </fieldset>
            </SheetContent>
          </Sheet>
        </div>

        {/* Persona-shaped overlay strip — re-flavors the same map
            canvas for who's using it. Renders nothing for the
            default land_investor persona so the existing parcel
            discovery UI stays the home page. */}
        <PersonaMapStrip
          properties={properties}
          hasAnyProperties={properties.length > 0}
        />

        {/* Map + side panel. 100dvh honors iOS Safari's dynamic toolbar so
            the map doesn't slide under the 72px mobile bottom nav; also
            subtract the safe-area inset so the bottom of the map clears
            the home indicator. Surfaced by the 2026-06-05 Krieger audit. */}
        <div
          className="flex"
          style={{ height: "calc(100dvh - 125px - env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="flex-1 relative min-w-0">
            {isLoading ? (
              <div className="h-full w-full p-3" aria-busy="true">
                {/* Shape-matched map skeleton: full-bleed basemap area with a
                    pin cluster + a side strip standing in for the legend. */}
                <Skeleton className="h-full w-full rounded-card relative overflow-hidden" announceText="Loading property intelligence map">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <MapPin className="w-10 h-10 text-muted-foreground/40" aria-hidden="true" />
                  </div>
                </Skeleton>
              </div>
            ) : propsError ? (
              <div className="h-full w-full p-6 flex items-center justify-center">
                <QueryErrorState
                  error={propsErr instanceof Error ? propsErr : new Error(String(propsErr))}
                  onRetry={() => void refetchProps()}
                  title="Couldn't load your parcels"
                  description="The map could not read your properties. This is not the same as having none on the map."
                  testId="maps-properties-error"
                />
              </div>
            ) : filteredProperties.length === 0 ? (
              // r6 Tasha WF-R6-001 + STR-R6-001: even with zero parcels
              // that have coordinates, render a real basemap so the user
              // sees geographic context (important for driving-for-dollars
              // personas). Also show a helpful overlay explaining how to
              // get coords on their existing parcels.
              <div className="relative w-full h-full">
                <PropertyMap
                  properties={[]}
                  height="100%"
                  showLabels={false}
                  interactive
                  enable3DTerrain={false}
                  showControls
                />
                {/* Bold Tahoe re-skin (Wave R, §1.4/§4): this empty-state wash
                    floats over the live basemap, so it takes the bold
                    `backdrop-blur-lg` depth read (up from -sm) over the existing
                    `bg-surface-sheer` scrim. Visual-only. */}
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center p-8 bg-surface-sheer backdrop-blur-lg" role="status">
                  <div className="pointer-events-auto flex flex-col items-center max-w-sm">
                    <MapPin className="w-12 h-12 text-muted-foreground mb-4" aria-hidden="true" />
                    {/* W2.3: note personas think in collateral, not parcels —
                        the zero-state speaks their language. */}
                    {persona === "note_investor" || persona === "note_originator" || persona === "note_servicer" ? (
                      <>
                        <h3 className="font-semibold text-lg">No collateral on the map yet</h3>
                        <p className="text-muted-foreground text-sm mt-2">
                          When a note's collateral property has coordinates it appears here — soils, flood, and elevation intel included. Click <strong>Fetch boundaries</strong> on the Inventory page to auto-geocode, or add lat/lng on the property's Overview tab.
                        </p>
                      </>
                    ) : (
                      <>
                        <h3 className="font-semibold text-lg">No parcel coordinates yet</h3>
                        <p className="text-muted-foreground text-sm mt-2">
                          Click <strong>Fetch boundaries</strong> on the Inventory page to auto-geocode your properties, or add lat/lng manually on a parcel's Overview tab. Basemap shown above.
                        </p>
                      </>
                    )}
                    {/* RAFE (Tahoe Wave-2): the data-aha is our differentiator,
                        but it shouldn't depend on the customer first having
                        geocoded parcels. "See a sample" runs a REAL free-data
                        lookup on a curated, data-rich parcel so the first
                        impression is the wow-moment, never an empty map. */}
                    <div className="flex flex-col sm:flex-row gap-2 mt-4 w-full sm:w-auto">
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => setSamplePreviewOpen(true)}
                        data-testid="button-see-sample"
                        aria-label="See a sample parcel with real soil, flood and elevation data"
                      >
                        <Sparkles className="w-4 h-4 mr-2" aria-hidden="true" />
                        See a sample
                      </Button>
                      <Button asChild variant="outline" size="sm">
                        <Link href="/properties">
                          <ExternalLink className="w-4 h-4 mr-2" aria-hidden="true" />
                          Go to inventory
                        </Link>
                      </Button>
                    </div>
                    {/* Krieger: turn a coverage dead-end into a coverage
                        signal. If the customer's county isn't covered yet,
                        let them request it (feeds the demand-weighted
                        discovery queue, Iyari #3). */}
                    <RequestCountyCTA className="mt-4 w-full text-left" />
                  </div>
                </div>
              </div>
            ) : (
              <PropertyMap
                properties={mapProperties}
                selectedPropertyId={selectedPropertyId}
                onPropertySelect={setSelectedPropertyId}
                height="100%"
                showLabels={filteredProperties.length < 50}
                interactive
                enable3DTerrain
                showControls
              />
            )}

            {/* Tier 3F — county market-heat layer panel. Overlays the map
                canvas inside the Map door; toggled from Intelligence layers. */}
            {showMarketHeat && (
              <MarketHeatPanel
                onClose={() => setShowMarketHeat(false)}
                // Bold Tahoe re-skin (Wave R, §4 depth): keep the semantic
                // stacking layer (`z-docked` = the 10 it already had) instead of
                // the raw z-docked; the panel's own canvas-overlay glass + shadow is
                // applied in MarketHeatPanel.tsx. Position/size unchanged.
                className="absolute top-2 left-2 z-docked w-80 max-w-[calc(100%-1rem)] max-h-[calc(100%-1rem)]"
              />
            )}
          </div>

          {/* Enhanced Property Intelligence Panel — desktop only.
              Driving-for-dollars is the #1 mobile path, so on phones the
              pin-tap detail renders in a bottom Sheet (below) instead of this
              320px side panel, which is unusable under ~700px. */}
          {!isMobile && selectedProperty && (
            <PropertyIntelligencePanel
              property={selectedProperty}
              onClose={() => setSelectedPropertyId(undefined)}
              variant="desktop"
            />
          )}
        </div>
      </div>

      {/* Mobile selected-pin experience — bottom Sheet (Krieger #3).
          Snaps to ~55dvh and drags up to full height; honors the home
          indicator + 72px bottom nav via env(safe-area-inset-bottom). */}
      {isMobile && (
        <Sheet
          open={Boolean(selectedProperty)}
          onOpenChange={(open) => {
            if (!open) setSelectedPropertyId(undefined);
          }}
        >
          <SheetContent
            side="bottom"
            // Snap height: ~55dvh, drag-to-expand up to 92dvh. Clears the
            // home indicator + bottom nav with safe-area padding.
            className="h-[55dvh] max-h-[92dvh] p-0 pt-0 rounded-t-2xl flex flex-col"
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Property intelligence</SheetTitle>
            </SheetHeader>
            {selectedProperty && (
              <div className="flex-1 min-h-0 overflow-hidden mt-2">
                <PropertyIntelligencePanel
                  property={selectedProperty}
                  onClose={() => setSelectedPropertyId(undefined)}
                  variant="mobile"
                />
              </div>
            )}
          </SheetContent>
        </Sheet>
      )}

      {/* RAFE (Tahoe Wave-2): "See a sample" preview — real free-data lookup on
          a curated, data-rich parcel so the parcel-data aha never lands empty. */}
      <SampleParcelPreview
        open={samplePreviewOpen}
        onOpenChange={setSamplePreviewOpen}
      />
    </PageShell>
  );
}
