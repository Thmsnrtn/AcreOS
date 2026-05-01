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

import { useRoute, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useTerm } from "@/hooks/use-persona";
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
  ExternalLink,
  Sparkles,
} from "lucide-react";
import type { Property } from "@shared/schema";

const STATUS_LABELS: Record<string, string> = {
  prospect: "Prospect",
  due_diligence: "Due diligence",
  offer_sent: "Offer sent",
  under_contract: "Under contract",
  owned: "Owned",
  listed: "Listed",
  sold: "Sold",
};

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
