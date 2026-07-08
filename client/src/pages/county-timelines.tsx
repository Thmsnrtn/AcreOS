/**
 * /county-timelines — subdivision approval lead times by county (SD-6).
 *
 * Brigid §7: "Williamson is fourteen months end-to-end. Hickman is four.
 * Maury is six. Davidson is a different planet. I bid acquisitions on the
 * carry cost of those timelines."
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calendar, MapPin } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface Timeline {
  id: number;
  state: string;
  countyName: string;
  p50TotalDays: number | null;
  p90TotalDays: number | null;
  preApplicationLeadDays: number | null;
  preliminaryPlatLeadDays: number | null;
  percolationLeadDays: number | null;
  finalPlatLeadDays: number | null;
  recordingLeadDays: number | null;
  percolationSeasonNote: string | null;
  typicalRevisionRounds: number | null;
  source: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

function months(days: number | null): string {
  if (days === null) return "—";
  return `${(days / 30).toFixed(1)} mo`;
}

export default function CountyTimelinesPage() {
  useDocumentTitle("County subdivision timelines — AcreOS");
  const [filter, setFilter] = useState("");

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<{ timelines: Timeline[] }>({
    queryKey: ["/api/county-timelines"],
    queryFn: async () => {
      const res = await fetch("/api/county-timelines", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const filtered = (data?.timelines ?? []).filter((t) => {
    if (!filter) return true;
    const f = filter.toLowerCase();
    return t.state.toLowerCase().includes(f) || t.countyName.toLowerCase().includes(f);
  });

  return (
    <PageShell label="County timelines">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Calendar className="w-6 h-6 text-primary" aria-hidden="true" />
          County subdivision timelines
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Lead-time estimates for residential subdivision approval, county by
          county. Refined from planning-office inputs and operator historicals.
          Brigid bids acquisitions on these numbers.
        </p>
      </div>

      <div className="mb-4 max-w-sm">
        <Input
          placeholder="Filter by state or county…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="w-4 h-4" aria-hidden="true" /> {filtered.length} count{filtered.length === 1 ? "y" : "ies"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-32" />
          ) : isError ? (
            <QueryErrorState
              error={error instanceof Error ? error : null}
              onRetry={() => refetch()}
              isRetrying={isRefetching}
              compact
              title="Couldn't load county timelines"
              description="We hit a snag loading subdivision lead-time data. Your data is safe — try again."
              testId="county-timelines-query-error"
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="px-2 py-2 text-left font-medium">County</th>
                  <th className="px-2 py-2 text-right font-medium">p50 total</th>
                  <th className="px-2 py-2 text-right font-medium">p90 total</th>
                  <th className="px-2 py-2 text-right font-medium">Prelim plat</th>
                  <th className="px-2 py-2 text-right font-medium">Perc</th>
                  <th className="px-2 py-2 text-right font-medium">Final plat</th>
                  <th className="px-2 py-2 text-right font-medium">Revisions</th>
                  <th className="px-2 py-2 text-left font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr key={t.id} className="border-b border-border/40">
                    <td className="px-2 py-2 font-medium">
                      {t.countyName}, {t.state}
                      {t.source && <div className="text-xs text-muted-foreground font-normal">{t.source}</div>}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">{months(t.p50TotalDays)}</td>
                    <td className="px-2 py-2 text-right font-mono">{months(t.p90TotalDays)}</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{t.preliminaryPlatLeadDays ?? "—"}d</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{t.percolationLeadDays ?? "—"}d</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">{t.finalPlatLeadDays ?? "—"}d</td>
                    <td className="px-2 py-2 text-right text-muted-foreground">
                      {t.typicalRevisionRounds !== null ? <Badge variant="outline" className="text-xs">{t.typicalRevisionRounds}×</Badge> : "—"}
                    </td>
                    <td className="px-2 py-2 text-xs text-muted-foreground max-w-[24rem]">
                      {t.percolationSeasonNote ?? ""}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-2 py-6 text-center text-muted-foreground text-sm">No timelines match the filter.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
