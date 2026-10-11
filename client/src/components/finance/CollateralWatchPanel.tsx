/**
 * Collateral watch (W5a) — Finance door → Portfolio. For each note's
 * collateral parcel: what AcreOS watches, from which source, and plainly
 * what it does not ("Not watched: no source for <county>"). Alerts land on
 * Today. Renders nothing when no note has a collateral property.
 */
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { COLLATERAL_KIND_LABEL, type CollateralWatchCoverage } from "@shared/trust/collateralWatch";

interface CollateralRow {
  noteLabel: string;
  propertyId: number;
  apn: string;
  state: string;
  county: string;
  coverage: CollateralWatchCoverage[];
  lastTaxStatus: { value: string; reading: "delinquent" | "current" | "unknown"; source: string; observedAt: string } | null;
}

export function CollateralWatchPanel() {
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<{ collateral: CollateralRow[] }>({
    queryKey: ["/api/finance/collateral-watch"],
  });
  if (isError) return <QueryErrorState error={error as Error} onRetry={() => void refetch()} isRetrying={isRefetching} title="Collateral watch" compact className="mt-4" />;
  if (isLoading) {
    return (
      <div className="mt-4 space-y-2" aria-hidden="true">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  const rows = data?.collateral ?? [];
  if (rows.length === 0) return null;
  return (
    <Card className="mt-4" data-testid="card-collateral-watch">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Collateral watch</CardTitle>
        <CardDescription>What AcreOS watches on the land behind each note. Alerts appear on Today.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.propertyId} className="space-y-1 py-3 text-sm" data-testid={`collateral-${r.propertyId}`}>
              <p className="font-medium text-foreground">
                {r.noteLabel} · APN {r.apn}, {r.county} County, {r.state}
              </p>
              <ul className="space-y-0.5">
                {r.coverage.map((c) => (
                  <li key={c.kind} className="flex items-start gap-2 text-muted-foreground">
                    {c.watched ? <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                    <span>
                      {COLLATERAL_KIND_LABEL[c.kind]}: {c.text}
                    </span>
                  </li>
                ))}
              </ul>
              {r.lastTaxStatus ? (
                <p className="text-xs text-muted-foreground">
                  Last tax status on record: "{r.lastTaxStatus.value}" ({r.lastTaxStatus.source}, {r.lastTaxStatus.observedAt.slice(0, 10)})
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
