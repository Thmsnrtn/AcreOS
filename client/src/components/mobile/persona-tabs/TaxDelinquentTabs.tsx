/**
 * Tax-Delinquent persona — Today + Portfolio mobile tabs.
 *
 * The 12-agent audit named Tax-Delinquent the strongest leapfrog
 * target (weakest competitive field; RealAuction / AuctionZip / Bid4Assets
 * all have awful mobile UX). These tabs deliver the persona's three
 * critical surfaces from their phone:
 *
 *   Today:   urgent redemption clock + today's auction + quiet-title overdue
 *   Portfolio:  certificate count + total redemption exposure $$ + quiet-title pipeline depth
 *
 * Data sources:
 *   /api/tax-certificates           — all redemption-clock entries
 *   /api/tax-researcher/upcoming    — auction calendar
 *   /api/quiet-title/cases          — quiet-title workflow
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Clock, AlertTriangle, Gavel, FileText, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchJsonArray } from "@/lib/queryClient";

interface Certificate {
  id: number;
  state: string;
  county: string;
  apn?: string | null;
  redemptionDeadline?: string | null;
  daysRemaining?: number | null;
  currentRedemptionCents?: number | null;
  status?: string;
}

interface QuietTitleCase {
  id: number;
  caseRef: string;
  state: string;
  county: string;
  status: string;
  nextStepDueDate?: string | null;
  daysOverdue?: number | null;
}

interface AuctionListing {
  id: number;
  county: string;
  state: string;
  saleDate: string;
}

function activateOnKey(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

function fmtCents(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function urgencyTone(days: number | null | undefined): "red" | "amber" | "neutral" {
  if (days == null) return "neutral";
  if (days <= 7) return "red";
  if (days <= 30) return "amber";
  return "neutral";
}

export function TaxDelinquentToday() {
  const [, setLocation] = useLocation();

  const { data: certs = [], isLoading: cLoading } = useQuery<Certificate[]>({
    queryKey: ["/api/tax-certificates"],
    queryFn: () => fetchJsonArray<Certificate>("/api/tax-certificates"),
    staleTime: 60_000,
  });
  const { data: cases = [] } = useQuery<QuietTitleCase[]>({
    queryKey: ["/api/quiet-title/cases"],
    queryFn: () => fetchJsonArray<QuietTitleCase>("/api/quiet-title/cases"),
    staleTime: 5 * 60_000,
  });

  const urgentCerts = [...certs]
    .filter((c) => c.status !== "redeemed" && c.daysRemaining != null && c.daysRemaining <= 30)
    .sort((a, b) => (a.daysRemaining ?? 999) - (b.daysRemaining ?? 999))
    .slice(0, 5);

  const overdueCases = cases.filter((c) => (c.daysOverdue ?? 0) > 0).slice(0, 3);

  if (cLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Section: urgent redemptions */}
      <section>
        <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1">
          Redemption clock — urgent
        </h2>
        {urgentCerts.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground py-6 px-4 text-center">
              No certificates near their redemption deadline.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {urgentCerts.map((c) => {
              const tone = urgencyTone(c.daysRemaining);
              return (
                <Card
                  key={c.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setLocation(`/redemption-clock?certId=${c.id}`)}
                  onKeyDown={activateOnKey(() => setLocation(`/redemption-clock?certId=${c.id}`))}
                  aria-label={`Open certificate ${c.apn ?? c.id}`}
                  className={cn(
                    "p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    tone === "red" && "border-rose-400/60",
                    tone === "amber" && "border-amber-400/60",
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-base font-semibold truncate">
                        {c.apn ?? `Cert #${c.id}`}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {c.county}, {c.state}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={cn(
                          "text-base font-semibold tabular-nums",
                          tone === "red" && "text-rose-600 dark:text-rose-400",
                          tone === "amber" && "text-amber-600 dark:text-amber-400",
                        )}
                      >
                        {c.daysRemaining ?? "—"}d
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        to deadline
                      </div>
                    </div>
                  </div>
                  {c.currentRedemptionCents != null && (
                    <div className="text-xs text-muted-foreground mt-1.5">
                      Redemption amount: {fmtCents(c.currentRedemptionCents)}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Section: quiet-title cases needing attention */}
      {overdueCases.length > 0 && (
        <section>
          <h2 className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            Quiet-title cases overdue
          </h2>
          <div className="space-y-2">
            {overdueCases.map((c) => (
              <Card
                key={c.id}
                role="button"
                tabIndex={0}
                onClick={() => setLocation(`/quiet-title/${c.id}`)}
                onKeyDown={activateOnKey(() => setLocation(`/quiet-title/${c.id}`))}
                aria-label={`Open quiet-title case ${c.caseRef}`}
                className="p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{c.caseRef}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.county}, {c.state} · {c.status}
                    </div>
                  </div>
                  <div className="text-amber-600 dark:text-amber-400 text-sm tabular-nums">
                    {c.daysOverdue}d overdue
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Quick jumps */}
      <section className="grid grid-cols-2 gap-2">
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/redemption-clock")}
        >
          <span className="flex items-center gap-2">
            <Clock className="h-4 w-4" /> Redemption clock
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="outline"
          className="h-12 justify-between"
          onClick={() => setLocation("/auction-worksheet")}
        >
          <span className="flex items-center gap-2">
            <Gavel className="h-4 w-4" /> Auctions
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </section>
    </div>
  );
}

export function TaxDelinquentPortfolio() {
  const [, setLocation] = useLocation();
  const { data: certs = [], isLoading } = useQuery<Certificate[]>({
    queryKey: ["/api/tax-certificates"],
    queryFn: () => fetchJsonArray<Certificate>("/api/tax-certificates"),
    staleTime: 60_000,
  });
  const { data: cases = [] } = useQuery<QuietTitleCase[]>({
    queryKey: ["/api/quiet-title/cases"],
    queryFn: () => fetchJsonArray<QuietTitleCase>("/api/quiet-title/cases"),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  const activeCerts = certs.filter((c) => c.status !== "redeemed");
  const totalExposure = activeCerts.reduce(
    (s, c) => s + (c.currentRedemptionCents ?? 0),
    0,
  );
  const within30 = activeCerts.filter((c) => (c.daysRemaining ?? 999) <= 30).length;
  const activeQuietTitles = cases.filter((c) => c.status !== "closed");

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="Active certificates"
          value={String(activeCerts.length)}
          sub={`${within30} due within 30d`}
          onClick={() => setLocation("/redemption-clock")}
        />
        <StatTile
          label="Total redemption $"
          value={fmtCents(totalExposure)}
          sub="currently outstanding"
          onClick={() => setLocation("/redemption-clock")}
        />
      </section>
      <section>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setLocation("/quiet-title")}
          onKeyDown={activateOnKey(() => setLocation("/quiet-title"))}
          aria-label="Open quiet-title pipeline"
          className="p-4 cursor-pointer active:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Quiet-title pipeline
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {activeQuietTitles.length} active case{activeQuietTitles.length === 1 ? "" : "s"}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </Card>
      </section>
      <Button
        variant="outline"
        className="w-full h-12 justify-between"
        onClick={() => setLocation("/redemption-clock")}
      >
        <span>Open full redemption clock</span>
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  onClick?: () => void;
}) {
  const interactive = !!onClick;
  return (
    <Card
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={interactive && onClick ? activateOnKey(onClick) : undefined}
      aria-label={interactive ? `${label} ${value}`.trim() : undefined}
      className={cn(
        "p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        interactive && "cursor-pointer active:bg-muted/50",
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-2xl font-semibold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
