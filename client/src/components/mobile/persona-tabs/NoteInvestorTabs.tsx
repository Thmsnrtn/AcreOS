/**
 * Note Investor persona — Today + Portfolio mobile tabs.
 *
 * Per the 12-agent audit: borrower texts "wire sent" → tap in-app link
 * → record payment with auto-fill is the leapfrog. These tabs surface:
 *
 *   Today:    today's payments received + delinquencies + 1099 prep
 *             reminders
 *   Portfolio: total notes, performing vs delinquent, MTD interest
 *             received, year-end 1099 readiness
 *
 * Data sources:
 *   /api/notes — note inventory + status + payment ledger
 */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  FileCheck,
  ArrowRight,
  DollarSign,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchJsonArray } from "@/lib/queryClient";

interface Note {
  id: number;
  borrowerName?: string | null;
  status: string;
  monthlyPayment?: string | number | null;
  nextPaymentDate?: string | null;
  lastPaymentDate?: string | null;
  daysSincePayment?: number | null;
  currentBalance?: string | number | null;
  state?: string | null;
}

function fmtMoney(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * Keyboard handler for Card-as-button surfaces. Enter and Space both
 * activate, matching native <button>. Mirrors the helper in
 * UniversalTabs so non-pointer users can reach the entity behind the tile.
 */
function activateOnKey(fn: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

function daysAgo(iso?: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

export function NoteInvestorToday() {
  const [, setLocation] = useLocation();
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["/api/notes"],
    queryFn: () => fetchJsonArray<Note>("/api/notes"),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  // Brand-new account: zero notes in the inventory. Skip the per-section
  // empty cards and show a single CTA — there's nothing to triage yet.
  if (notes.length === 0) {
    return (
      <div className="space-y-4">
        <Card className="p-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-muted-foreground mx-auto mb-3" aria-hidden />
          <h2 className="text-base font-semibold">No notes yet</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
            Add a note to start tracking payments, delinquencies, and 1099
            readiness from your phone.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => setLocation("/notes")}
          >
            Open Notes
          </Button>
        </Card>
      </div>
    );
  }

  // "Received recently" = note with lastPaymentDate within the last 24h
  const recentPayments = notes
    .filter((n) => {
      const d = daysAgo(n.lastPaymentDate);
      return d != null && d <= 1;
    })
    .slice(0, 4);

  // Delinquent = active note with daysSincePayment > 30
  const delinquent = notes
    .filter((n) => (n.daysSincePayment ?? 0) > 30 && n.status !== "paid_off")
    .sort((a, b) => (b.daysSincePayment ?? 0) - (a.daysSincePayment ?? 0))
    .slice(0, 5);

  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-caption uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
          Payments — last 24h
        </h2>
        {recentPayments.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground py-6 px-4 text-center">
              No payments logged in the last 24 hours.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentPayments.map((n) => (
              <Card
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => setLocation(`/notes/${n.id}`)}
                onKeyDown={activateOnKey(() => setLocation(`/notes/${n.id}`))}
                aria-label={`Open note ${n.borrowerName ?? n.id}`}
                className="p-4 cursor-pointer active:bg-muted/50"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {n.borrowerName ?? `Note #${n.id}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Paid {n.lastPaymentDate ? new Date(n.lastPaymentDate).toLocaleDateString() : "—"}
                    </div>
                  </div>
                  <div className="text-emerald-600 dark:text-emerald-400 font-semibold tabular-nums">
                    {fmtMoney(n.monthlyPayment)}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      {delinquent.length > 0 && (
        <section>
          <h2 className="text-caption uppercase tracking-wide text-muted-foreground mb-2 px-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            Delinquencies
          </h2>
          <div className="space-y-2">
            {delinquent.map((n) => (
              <Card
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => setLocation(`/notes/${n.id}`)}
                onKeyDown={activateOnKey(() => setLocation(`/notes/${n.id}`))}
                aria-label={`Open delinquent note ${n.borrowerName ?? n.id}`}
                className={cn(
                  "p-4 cursor-pointer active:bg-muted/50",
                  (n.daysSincePayment ?? 0) > 60 && "border-rose-400/60",
                  (n.daysSincePayment ?? 0) > 30 && (n.daysSincePayment ?? 0) <= 60 && "border-amber-400/60",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {n.borrowerName ?? `Note #${n.id}`}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {fmtMoney(n.monthlyPayment)}/mo · {n.state ?? ""}
                    </div>
                  </div>
                  <div
                    className={cn(
                      "text-sm tabular-nums shrink-0",
                      (n.daysSincePayment ?? 0) > 60
                        ? "text-rose-600 dark:text-rose-400 font-semibold"
                        : "text-amber-600 dark:text-amber-400",
                    )}
                  >
                    {n.daysSincePayment}d late
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <Button
        variant="outline"
        className="w-full h-12 justify-between"
        onClick={() => setLocation("/notes")}
      >
        <span>Open all notes</span>
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function NoteInvestorPortfolio() {
  const [, setLocation] = useLocation();
  const { data: notes = [], isLoading } = useQuery<Note[]>({
    queryKey: ["/api/notes"],
    queryFn: () => fetchJsonArray<Note>("/api/notes"),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)}
      </div>
    );
  }

  const active = notes.filter((n) => n.status !== "paid_off" && n.status !== "default");
  const performing = active.filter((n) => (n.daysSincePayment ?? 0) <= 30);
  const delinquent = active.filter((n) => (n.daysSincePayment ?? 0) > 30);
  const totalBalance = active.reduce(
    (s, n) => s + Number(n.currentBalance ?? 0),
    0,
  );
  // MTD interest received — rough approximation: monthlyPayment for notes
  // that paid this month (lastPaymentDate within current month).
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const mtdInterest = notes
    .filter((n) => {
      if (!n.lastPaymentDate) return false;
      const d = new Date(n.lastPaymentDate);
      return d >= monthStart;
    })
    .reduce((s, n) => s + Number(n.monthlyPayment ?? 0), 0);

  return (
    <div className="space-y-3">
      <section className="grid grid-cols-2 gap-3">
        <StatTile
          label="Active notes"
          value={String(active.length)}
          sub={`${performing.length} performing`}
          onClick={() => setLocation("/notes")}
        />
        <StatTile
          label="Delinquent"
          value={String(delinquent.length)}
          sub={delinquent.length > 0 ? "needs attention" : "all current"}
          tone={delinquent.length > 0 ? "amber" : "neutral"}
          onClick={() => setLocation("/notes?filter=delinquent")}
        />
        <StatTile
          label="Total balance"
          value={fmtMoney(totalBalance)}
          sub="outstanding principal"
          onClick={() => setLocation("/notes")}
        />
        <StatTile
          label="MTD received"
          value={fmtMoney(mtdInterest)}
          sub="this month's payments"
          onClick={() => setLocation("/finance")}
        />
      </section>
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setLocation("/notes/tax-readiness")}
        onKeyDown={activateOnKey(() => setLocation("/notes/tax-readiness"))}
        aria-label="Open 1099-INT readiness"
        className="p-4 cursor-pointer active:bg-muted/50"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium flex items-center gap-2">
              <FileCheck className="h-4 w-4 text-muted-foreground" />
              1099-INT readiness
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Year-end tax prep dashboard
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Card>
      <Card
        role="button"
        tabIndex={0}
        onClick={() => setLocation("/finance")}
        onKeyDown={activateOnKey(() => setLocation("/finance"))}
        aria-label="Open cash flow and forecasting"
        className="p-4 cursor-pointer active:bg-muted/50"
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Cash flow & forecasting
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Projected interest + amortization preview
            </div>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Card>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "amber" | "rose";
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
        tone === "amber" && "border-amber-400/40",
        tone === "rose" && "border-rose-400/40",
        interactive && "cursor-pointer active:bg-muted/50",
      )}
    >
      <div className="text-micro uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums mt-1",
          tone === "amber" && "text-amber-600 dark:text-amber-400",
          tone === "rose" && "text-rose-600 dark:text-rose-400",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-caption text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}
