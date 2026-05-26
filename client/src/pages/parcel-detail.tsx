/**
 * /parcels/:id — composed parcel detail surface (v1)
 *
 * JUDGMENT-CALL-RECOMMENDATIONS #1: Land Investors live in parcels.
 * Pre-port the same data was scattered across /properties (list view),
 * /property-enrichment (enrichment), /avm (valuation), /market-data
 * (comps), /property-tax (tax records). Daily friction was chasing the
 * same APN across four surfaces.
 *
 * v1 scope: compose existing widgets — property overview, valuation
 * snapshot, due-diligence checklist, neighbors. Skips the prototype's
 * full Atlas Run integration (separate feature project per JC #1).
 *
 * Auth: gated via App.tsx ProtectedRoute wrapper.
 */

import { useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useTerm } from "@/hooks/use-persona";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { usd } from "@/lib/format";
import {
  ArrowLeft,
  MapPin,
  Ruler,
  DollarSign,
  Building2,
  Trees,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import type { Property, LandStatus } from "@shared/schema";
import { SubdivisionTab } from "@/components/parcels/subdivision-tab";
import { ArvCalculator } from "@/components/parcels/arv-calculator";

const STATUS_LABELS: Record<string, string> = {
  prospect: "Prospect",
  due_diligence: "Due diligence",
  offer_sent: "Offer sent",
  under_contract: "Under contract",
  owned: "Owned",
  listed: "Listed",
  sold: "Sold",
};

// Aniyah §2 — Indian-Country / federal trust land status. Display labels
// for the seven landStatus values defined in shared/schema.ts.
const LAND_STATUS_LABELS: Record<LandStatus, string> = {
  fee: "Fee simple",
  tribal_trust: "Tribal trust",
  individual_trust: "Individual trust (allotment)",
  restricted_fee: "Restricted fee",
  fee_within_reservation: "Fee within reservation",
  off_reservation_trust: "Off-reservation trust",
  unknown: "Not yet verified",
};

const LAND_STATUS_OPTIONS: LandStatus[] = [
  "fee",
  "tribal_trust",
  "individual_trust",
  "restricted_fee",
  "fee_within_reservation",
  "off_reservation_trust",
  "unknown",
];

const STATUS_TONES: Record<string, string> = {
  prospect: "bg-muted text-muted-foreground",
  due_diligence: "bg-acr-warn-soft text-acr-warn",
  offer_sent: "bg-primary/10 text-primary",
  under_contract: "bg-primary/10 text-primary",
  owned: "bg-acr-pos-soft text-acr-pos",
  listed: "bg-acr-pos-soft text-acr-pos",
  sold: "bg-muted text-muted-foreground",
};

interface DueDiligenceData {
  titleClear?: boolean;
  noLiens?: boolean;
  noEnvironmentalIssues?: boolean;
  accessVerified?: boolean;
  taxesCurrent?: boolean;
  checklistCompleted?: boolean;
  notes?: string;
}

const DD_LABELS: Array<{ key: keyof DueDiligenceData; label: string }> = [
  { key: "titleClear", label: "Title clear" },
  { key: "noLiens", label: "No liens" },
  { key: "noEnvironmentalIssues", label: "No environmental issues" },
  { key: "accessVerified", label: "Access verified" },
  { key: "taxesCurrent", label: "Taxes current" },
];

function formatNumber(n: string | number | null | undefined, fallback = "—"): string {
  if (n == null || n === "") return fallback;
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(num)) return fallback;
  return num.toLocaleString();
}

function formatUsd(n: string | number | null | undefined, fallback = "—"): string {
  if (n == null || n === "") return fallback;
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (Number.isNaN(num)) return fallback;
  return usd(num, { noCents: true });
}

export default function ParcelDetailPage() {
  const [, params] = useRoute<{ id: string }>("/parcels/:id");
  const id = params?.id ? parseInt(params.id, 10) : null;
  // Persona-aware title — "Parcel #5" for land_investor; "Note #5" for
  // note_investor; "Subject property #5" for wholesaler; etc. URL stays
  // /parcels/:id (route compat); the visible noun adapts.
  const propertyLabel = useTerm("entity.property");
  useDocumentTitle(id ? `${propertyLabel} #${id}` : propertyLabel);

  const {
    data: property,
    isLoading,
    error,
    refetch,
  } = useQuery<Property>({
    queryKey: [`/api/properties/${id}`],
    enabled: id != null && !Number.isNaN(id),
  });

  if (id == null || Number.isNaN(id)) {
    return (
      <PageShell>
        <EmptyState
          icon={MapPin}
          title="Parcel not found"
          description="The URL is missing a valid parcel ID."
          actionLabel="Back to properties"
          actionIcon={null}
          onAction={() => {
            window.location.href = "/properties";
          }}
        />
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <div className="space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </PageShell>
    );
  }

  if (error || !property) {
    return (
      <PageShell>
        <QueryErrorState
          error={error}
          onRetry={() => refetch()}
          title="Couldn't load this parcel"
          description="The parcel may have been removed or you may not have access. Try again, or return to the properties list."
        />
      </PageShell>
    );
  }

  const statusKey = property.status ?? "prospect";
  const statusToneCss = STATUS_TONES[statusKey] ?? STATUS_TONES.prospect;
  const statusLabel = STATUS_LABELS[statusKey] ?? statusKey;
  const dd = (property.dueDiligenceData ?? {}) as DueDiligenceData;
  const ddCompleted = DD_LABELS.filter((l) => dd[l.key] === true).length;

  return (
    <PageShell>
      <div className="space-y-6">
        {/* Breadcrumb / back */}
        <div>
          <Link
            href="/properties"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            Properties
          </Link>
        </div>

        {/* Aniyah §2 — Indian-Country / federal trust land status banner.
            Red when verified-trust; yellow when unverified. Auto-AVM,
            auto-offer, auto-contract are blocked unless landStatus === 'fee'. */}
        <LandStatusBanner property={property} />

        {/* Header — APN + status + acreage + actions */}
        <header className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                APN {property.apn}
              </p>
              <h1 className="text-2xl md:text-3xl font-bold mt-1">
                {property.address ?? `${property.county} County, ${property.state}`}
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                {property.county} County, {property.state}
                {property.subdivision ? ` · ${property.subdivision}` : null}
                {property.lotNumber ? ` · Lot ${property.lotNumber}` : null}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className={statusToneCss}>
                {statusLabel}
              </Badge>
            </div>
          </div>
        </header>

        {/* Quick metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            icon={Ruler}
            label="Size"
            value={`${formatNumber(property.sizeAcres)} ac`}
          />
          <MetricCard
            icon={DollarSign}
            label="Assessed value"
            value={formatUsd(property.assessedValue)}
          />
          <MetricCard
            icon={Sparkles}
            label="Market value"
            value={formatUsd(property.marketValue)}
            tone={property.marketValue ? "positive" : undefined}
          />
          <MetricCard
            icon={CheckCircle2}
            label="Due diligence"
            value={`${ddCompleted}/${DD_LABELS.length}`}
            tone={ddCompleted === DD_LABELS.length ? "positive" : ddCompleted > 0 ? "warning" : undefined}
          />
        </div>

        {/* Tabbed sections */}
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="diligence">Due diligence</TabsTrigger>
            <TabsTrigger value="financial">Financial</TabsTrigger>
            <TabsTrigger value="land-status">Land status</TabsTrigger>
            <TabsTrigger value="subdivision">Subdivision</TabsTrigger>
            <TabsTrigger value="arv">ARV</TabsTrigger>
            <TabsTrigger value="actions">Actions</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Trees className="w-4 h-4" aria-hidden="true" />
                  Land characteristics
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <DetailRow label="Zoning" value={property.zoning ?? "—"} />
                <DetailRow label="Terrain" value={property.terrain ?? "—"} />
                <DetailRow label="Road access" value={property.roadAccess ?? "—"} />
                <DetailRow label="Electric" value={property.utilities?.electric ? "Yes" : "—"} />
                <DetailRow label="Water" value={property.utilities?.water ? "Yes" : "—"} />
                <DetailRow label="Sewer" value={property.utilities?.sewer ? "Yes" : "—"} />
              </CardContent>
            </Card>

            {property.legalDescription ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Legal description</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{property.legalDescription}</p>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="diligence" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  Checklist
                </CardTitle>
                <CardDescription>
                  {ddCompleted === DD_LABELS.length
                    ? "All items verified."
                    : `${ddCompleted} of ${DD_LABELS.length} verified.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {DD_LABELS.map(({ key, label }) => {
                    const passed = dd[key] === true;
                    return (
                      <li key={key} className="flex items-center gap-3 text-sm">
                        {passed ? (
                          <CheckCircle2 className="w-4 h-4 text-acr-pos shrink-0" aria-hidden="true" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-acr-warn shrink-0" aria-hidden="true" />
                        )}
                        <span className={passed ? "text-foreground" : "text-muted-foreground"}>{label}</span>
                      </li>
                    );
                  })}
                </ul>
                {dd.notes ? (
                  <p className="mt-4 pt-4 border-t border-border text-xs text-muted-foreground">{dd.notes}</p>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="financial" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Financials</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <DetailRow label="Assessed value" value={formatUsd(property.assessedValue)} />
                <DetailRow label="Market value" value={formatUsd(property.marketValue)} />
                <DetailRow label="Purchase price" value={formatUsd(property.purchasePrice)} />
                <DetailRow label="List price" value={formatUsd(property.listPrice)} />
                <DetailRow label="Sold price" value={formatUsd(property.soldPrice)} />
                <DetailRow
                  label="Purchase date"
                  value={property.purchaseDate ? new Date(property.purchaseDate).toLocaleDateString() : "—"}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="land-status" className="space-y-4">
            <LandStatusVerificationCard property={property} />
          </TabsContent>

          <TabsContent value="subdivision" className="space-y-4">
            <SubdivisionTab parentParcelId={property.id} />
          </TabsContent>

          <TabsContent value="arv" className="space-y-4">
            <ArvCalculator propertyId={property.id} />
          </TabsContent>

          <TabsContent value="actions" className="space-y-3">
            {/* Cross-links to existing surfaces — Land Investors get one
               place that bridges the four surfaces this v1 composes. */}
            <ActionLink
              href={`/property-enrichment?id=${property.id}`}
              icon={Building2}
              title="Enrich this parcel"
              description="Pull the latest county data, owner info, and characteristics."
            />
            <ActionLink
              href={`/avm?id=${property.id}`}
              icon={DollarSign}
              title="Run valuation"
              description="Get an automated value estimate from the AVM."
            />
            <ActionLink
              href={`/market-data?county=${encodeURIComponent(property.county)}&state=${encodeURIComponent(property.state)}`}
              icon={Trees}
              title="View comps"
              description={`Recent sales in ${property.county} County, ${property.state}.`}
            />
            <ActionLink
              href={`/blind-offer-wizard?propertyId=${property.id}`}
              icon={Sparkles}
              title="Generate offer"
              description="Calculate a blind offer based on current valuation + your strategy."
            />
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "positive" | "warning";
}) {
  const valueClass =
    tone === "positive" ? "text-acr-pos" : tone === "warning" ? "text-acr-warn" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="w-3.5 h-3.5" aria-hidden="true" />
          {label}
        </div>
        <div className={`mt-1 text-xl font-bold tabular-nums ${valueClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function ActionLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <Link href={href}>
      <Card className="hover:border-primary/40 transition-colors cursor-pointer">
        <CardContent className="p-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="w-5 h-5 text-primary" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium">{title}</div>
            <div className="text-xs text-muted-foreground">{description}</div>
          </div>
          <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── Aniyah §2 — Land Status Banner ─────────────────────────────────────────
// Red banner for verified-trust parcels; yellow banner for unverified parcels.
// Hidden entirely for fee-simple parcels (the happy path).
function LandStatusBanner({ property }: { property: Property }) {
  const status = (property.landStatus ?? "unknown") as LandStatus;
  if (status === "fee") return null;

  if (status === "unknown") {
    return (
      <div
        role="alert"
        className="flex items-start gap-3 rounded-md border border-acr-warn/40 bg-acr-warn-soft p-4"
        data-testid="land-status-banner-unknown"
      >
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-acr-warn" aria-hidden="true" />
        <div className="flex-1 text-sm">
          <p className="font-semibold text-acr-warn">
            Land status not yet verified.
          </p>
          <p className="mt-1 text-acr-warn/90">
            Auto-actions blocked until verified. Confirm whether this parcel is fee simple,
            tribal trust, individual trust, or restricted-fee land before running auto-valuation,
            auto-offer, or auto-contract. Use the Land status tab below to record your finding.
          </p>
        </div>
      </div>
    );
  }

  // Any of the trust / restricted-fee variants — red banner.
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4"
      data-testid="land-status-banner-trust"
    >
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="flex-1 text-sm">
        <p className="font-semibold text-destructive">
          Indian Country land status: {LAND_STATUS_LABELS[status]}.
        </p>
        <p className="mt-1 text-destructive/90">
          Federal trust property — title transfers require BIA approval (25 CFR §152).
          Auto-valuation, auto-offer, and auto-contract are blocked on this parcel.
        </p>
      </div>
    </div>
  );
}

// ─── Aniyah §2 — Land Status Verification Card ──────────────────────────────
// Manual-verify dropdown + confirmation dialog. POSTs PATCH
// /api/properties/:id/land-status with audit logging on the server.
// TODO(LAR-overlay): Phase B will pre-fill this from the BIA Land Area
// Representations shapefile. Phase A is manual only.
function LandStatusVerificationCard({ property }: { property: Property }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const currentStatus = (property.landStatus ?? "unknown") as LandStatus;
  const [pending, setPending] = useState<LandStatus | null>(null);
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: async (next: { landStatus: LandStatus; verificationNotes?: string }) => {
      const res = await apiRequest("PATCH", `/api/properties/${property.id}/land-status`, next);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${property.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      toast({
        title: "Land status updated",
        description: "Audit log entry recorded.",
      });
      setPending(null);
      setNotes("");
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't update land status",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          Land status verification
        </CardTitle>
        <CardDescription>
          Required before auto-valuation, auto-offer, or auto-contract will run on this parcel.
          Tribal trust and restricted-fee parcels (25 USC §177, 25 CFR §152) require BIA approval
          for any title transfer. When in doubt, leave as &quot;Not yet verified&quot; — automation
          stays blocked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-1.5">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Current status
          </Label>
          <div className="text-sm font-medium">{LAND_STATUS_LABELS[currentStatus]}</div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="land-status-select" className="text-sm font-medium">
            Set verified land status
          </Label>
          <Select
            value={pending ?? currentStatus}
            onValueChange={(v) => setPending(v as LandStatus)}
          >
            <SelectTrigger id="land-status-select" data-testid="land-status-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LAND_STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {LAND_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {pending && pending !== currentStatus ? (
          <div className="grid gap-1.5">
            <Label htmlFor="land-status-notes" className="text-sm font-medium">
              Verification notes (optional, recorded in audit log)
            </Label>
            <Textarea
              id="land-status-notes"
              data-testid="land-status-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Confirmed via BIA realty office records 2026-04-30 — fee patent recorded 1956."
              rows={3}
            />
          </div>
        ) : null}
      </CardContent>

      <AlertDialog
        open={pending !== null && pending !== currentStatus}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm land status change</AlertDialogTitle>
            <AlertDialogDescription>
              You are setting parcel #{property.id} to{" "}
              <strong>{pending ? LAND_STATUS_LABELS[pending] : ""}</strong>. This is a regulated
              decision and will be recorded in the audit log. Auto-valuation, auto-offer, and
              auto-contract will{" "}
              {pending === "fee" ? "BE ENABLED" : "remain BLOCKED"} for this parcel.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="px-0 pb-2 text-xs text-muted-foreground">
            Regulatory basis: 25 USC §177, 25 CFR §152, applicable tribal law.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="land-status-confirm"
              disabled={mutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (pending) {
                  mutation.mutate({
                    landStatus: pending,
                    verificationNotes: notes.trim() || undefined,
                  });
                }
              }}
            >
              {mutation.isPending ? "Saving…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Phase A ships manual verification. Phase B will auto-resolve from
        the BIA Land Area Representations shapefile overlay; tracked in
        docs/exhaustive-completion/founder-dashboard-extraction-queue.md.
        Removed customer-facing "TODO" footer 2026-05-26 — internal-only
        note now lives here as a code comment.
      */}
    </Card>
  );
}
