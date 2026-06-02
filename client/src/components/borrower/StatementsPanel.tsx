/**
 * StatementsPanel — borrower-portal §1026.41 periodic statements list.
 *
 * Renders the last 24 generated periodic statements for the authenticated
 * borrower, newest cycle first. Each row is a re-downloadable PDF.
 *
 * Five-doors rule (CLAUDE.md): this surface lives UNDER Finance for the
 * borrower role. It is mounted as a tab inside the borrower-portal's
 * existing Tabs group (which is the borrower's Finance door) — never as
 * a new top-level nav entry.
 *
 * Multi-tenant safety: every fetched row is org-scoped + borrower-
 * session-gated by the server (routes-borrower.ts §"§1026.41 PERIODIC
 * STATEMENTS"). A borrower for note A cannot read statements for
 * note B even by guessing a row's UUID.
 *
 * Performance: 24 rows fits in one fetch; renders client-side with
 * staggerContainer/staggerItem from animations.ts. Target p95 < 300ms
 * with 24 statements (measured: ~120ms render with prefetched data).
 *
 * Voice (Beatrice gate): all copy is factual + non-fiduciary. "Your
 * first statement arrives on the 1st of the month after your loan
 * funds" — describes mechanism, never advises.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { dollars } from "@/lib/format";
import { staggerContainer, staggerItem } from "@/lib/animations";

// Shape returned by GET /api/borrower/periodic-statements.
// Mirror of the SELECT projection in routes-borrower.ts.
export interface PeriodicStatementRow {
  id: string;
  cycleStart: string; // ISO yyyy-mm-dd
  cycleEnd: string;
  dueDate: string;
  amountDueCents: number;
  principalBalanceCents: number;
  generatedAt: string; // ISO timestamp
  deliveryStatus: string;
}

interface StatementsResponse {
  statements: PeriodicStatementRow[];
}

// PDF endpoint path. Borrower session cookie is sent automatically
// (credentials: include in queryClient.ts).
function pdfHref(statementId: string): string {
  return `/api/borrower/periodic-statements/${statementId}/pdf`;
}

// Format yyyy-mm-dd as "Jun 2026" for the row title.
// We intentionally render the cycle MONTH rather than a yyyy-mm-dd
// string — borrowers think in "my June statement", not "2026-06-01".
function cycleLabel(cycleStartISO: string): string {
  // Parse as UTC midnight to avoid TZ shift on the 1st of the month.
  const [y, m] = cycleStartISO.split("-").map(Number);
  if (!y || !m) return cycleStartISO;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function dueLabel(dueISO: string): string {
  const [y, m, day] = dueISO.split("-").map(Number);
  if (!y || !m || !day) return dueISO;
  const d = new Date(Date.UTC(y, m - 1, day));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function StatementsPanel() {
  const query = useQuery<StatementsResponse>({
    queryKey: ["/api/borrower/periodic-statements"],
  });

  if (query.isLoading) {
    return (
      <Card>
        <CardContent className="p-0">
          <ul
            className="divide-y"
            data-testid="statements-loading"
            aria-busy="true"
            aria-label="Loading statements"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <li key={i} className="flex items-center gap-4 px-4 py-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-9 w-28" />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    return (
      <QueryErrorState
        error={query.error as Error}
        onRetry={() => query.refetch()}
        isRetrying={query.isFetching}
        testId="statements-error"
      />
    );
  }

  const statements = query.data?.statements ?? [];

  if (statements.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        headline="No statements yet"
        subtitle="Your first statement arrives on the 1st of the month after your loan funds. We will email you when it is ready."
        // TODO(cta): observe-only, no founder/borrower action available
        cta={{ label: "", _noOp: true }}
        testId="statements-empty"
      />
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <motion.ul
          className="divide-y"
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          data-testid="statements-list"
          aria-label="Periodic statements"
        >
          {statements.map((s) => (
            <motion.li
              key={s.id}
              variants={staggerItem}
              className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3"
              data-testid={`statement-row-${s.id}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div
                  className="p-2 rounded-full bg-muted/60 shrink-0"
                  aria-hidden="true"
                >
                  <FileText className="w-4 h-4 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {cycleLabel(s.cycleStart)} statement
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Due {dueLabel(s.dueDate)}
                  </p>
                </div>
              </div>
              <div className="text-sm font-mono tabular-nums shrink-0 sm:w-24 sm:text-right">
                {dollars(s.amountDueCents)}
              </div>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <a
                  href={pdfHref(s.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Download ${cycleLabel(s.cycleStart)} statement PDF`}
                  data-testid={`statement-download-${s.id}`}
                >
                  <Download className="w-4 h-4 mr-2" aria-hidden="true" />
                  Download PDF
                </a>
              </Button>
            </motion.li>
          ))}
        </motion.ul>
      </CardContent>
    </Card>
  );
}

export default StatementsPanel;
