/**
 * Rosy River B7 — Parcel comparison page.
 *
 * /properties/compare?ids=1,2,3,4 — side-by-side data table for 2-4
 * selected properties. Pulls from the existing GET /api/properties/:id
 * endpoint per row. Read-only.
 *
 * Linked from /properties bulk actions (when 2+ rows selected).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Columns3, ArrowLeft, AlertCircle } from "lucide-react";

interface Property {
  id: number;
  apn: string;
  county: string;
  state: string;
  address: string | null;
  city: string | null;
  zip: string | null;
  sizeAcres: string | number | null;
  zoning: string | null;
  terrain: string | null;
  roadAccess: string | null;
  status: string;
  assessedValue: string | number | null;
  marketValue: string | number | null;
  purchasePrice: string | number | null;
  listPrice: string | number | null;
  legalDescription: string | null;
}

function money(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function acres(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ac`;
}

function PropertyColumn({ id }: { id: number }) {
  const { data: prop, isLoading, error } = useQuery<Property>({
    queryKey: [`/api/properties/${id}`],
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-3" aria-busy="true">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error || !prop) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          Couldn't load #{id}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid={`compare-column-${id}`}>
      <CardContent className="p-4 space-y-3">
        <div>
          <div className="font-medium truncate" title={prop.address || prop.apn}>
            {prop.address || `APN ${prop.apn}`}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {[prop.city, prop.county + " County", prop.state, prop.zip].filter(Boolean).join(" · ")}
          </div>
          <Badge variant="outline" className="mt-2 text-micro uppercase">
            {prop.status}
          </Badge>
        </div>

        <CompareRow label="APN" value={prop.apn} />
        <CompareRow label="Size" value={acres(prop.sizeAcres)} />
        <CompareRow label="Zoning" value={prop.zoning ?? "—"} />
        <CompareRow label="Terrain" value={prop.terrain ?? "—"} />
        <CompareRow label="Road access" value={prop.roadAccess ?? "—"} />
        <CompareRow label="Assessed value" value={money(prop.assessedValue)} />
        <CompareRow label="Market value" value={money(prop.marketValue)} />
        <CompareRow label="Purchase price" value={money(prop.purchasePrice)} />
        <CompareRow label="List price" value={money(prop.listPrice)} />
        {prop.legalDescription && (
          <div className="space-y-1 pt-2 border-t border-border">
            <div className="text-micro uppercase tracking-wide text-muted-foreground">Legal</div>
            <div className="text-xs text-foreground/80 whitespace-pre-wrap line-clamp-3">
              {prop.legalDescription}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CompareRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs">
      <span className="text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="font-medium text-foreground text-right truncate" title={value}>
        {value}
      </span>
    </div>
  );
}

export default function PropertiesComparePage() {
  useDocumentTitle("Compare properties");
  const [, navigate] = useLocation();

  const ids = useMemo(() => {
    if (typeof window === "undefined") return [];
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("ids") ?? "";
    const parsed = raw
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
    return parsed.slice(0, 4); // Cap at 4 for layout sanity.
  }, []);

  return (
    <PageShell>
      <div className="max-w-7xl mx-auto py-6 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Columns3 className="h-6 w-6" aria-hidden="true" />
              Compare properties
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Side-by-side view of {ids.length} selected propert{ids.length === 1 ? "y" : "ies"}.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/properties")} data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" aria-hidden="true" />
            Back to properties
          </Button>
        </div>

        {ids.length === 0 && (
          <Card>
            <CardContent className="pt-10 pb-10 text-center text-muted-foreground space-y-2">
              <Columns3 className="h-10 w-10 mx-auto opacity-40" aria-hidden="true" />
              <div className="text-sm">No properties selected.</div>
              <div className="text-xs">
                From /properties, select 2–4 rows and click Compare to land here.
              </div>
            </CardContent>
          </Card>
        )}

        {ids.length === 1 && (
          <Card>
            <CardContent className="pt-6 pb-6 text-sm text-muted-foreground">
              You only have one property selected. Compare needs at least two.
            </CardContent>
          </Card>
        )}

        {ids.length >= 2 && (
          <div className={`grid gap-4 ${ids.length === 2 ? "md:grid-cols-2" : ids.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-4"}`}>
            {ids.map((id) => (
              <PropertyColumn key={id} id={id} />
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
