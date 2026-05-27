/**
 * Per-note payoff calculator. Linnea: "Borrower calls Tuesday. 'What's
 * my payoff if I close Friday at 2 PM?' I need a payoff calculator. One
 * button." This is the one-button — pick a date, see the breakdown.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface PayoffResponse {
  asOf: string;
  principalCents: number;
  accruedInterestCents: number;
  unappliedCreditCents: number;
  lateFeesAppliedToDateCents: number;
  totalPayoffCents: number;
  daysAccrued: number;
  accrualStart: string;
  dailyInterestCents: number;
}

function fmtUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function NotePayoffCalculator({ noteId }: { noteId: string }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  const { data, isFetching, isError } = useQuery<PayoffResponse>({
    queryKey: ["/api/notes", noteId, "payoff", date],
    queryFn: async () => {
      const res = await fetch(`/api/notes/${noteId}/payoff?date=${encodeURIComponent(date)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Payoff calc failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <Card>
      <div className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Calculator className="w-4 h-4 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Payoff calculator</h2>
        </div>

        <div className="space-y-1.5 mb-4">
          <Label htmlFor="payoff-date">As of</Label>
          <Input
            id="payoff-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            data-testid="payoff-date"
          />
        </div>

        {isFetching && !data ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-3 w-full mt-3" />
            <Skeleton className="h-3 w-full" />
          </div>
        ) : isError ? (
          <p className="text-sm text-muted-foreground">Couldn't compute payoff. Try again.</p>
        ) : data ? (
          <>
            <div className="text-xs text-muted-foreground">Total payoff</div>
            <div
              className="text-3xl font-semibold tracking-tight mt-1"
              data-testid="payoff-total"
            >
              {fmtUsd(data.totalPayoffCents)}
            </div>
            <div className="mt-4 space-y-1 text-xs">
              <Line label="Principal" value={fmtUsd(data.principalCents)} />
              <Line
                label={`Interest (${data.daysAccrued} days @ ${fmtUsd(data.dailyInterestCents)}/day)`}
                value={fmtUsd(data.accruedInterestCents)}
              />
              {data.unappliedCreditCents > 0 && (
                <Line
                  label="− Unapplied credit"
                  value={`(${fmtUsd(data.unappliedCreditCents)})`}
                  tone="muted"
                />
              )}
            </div>
            <p className="text-caption text-muted-foreground mt-3">
              Accrual from {data.accrualStart}. Per-diem reflects current
              balance; recompute if you accept a partial payment between
              now and close.
            </p>
          </>
        ) : null}
      </div>
    </Card>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: "muted" }) {
  return (
    <div className={`flex items-center justify-between ${tone === "muted" ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
