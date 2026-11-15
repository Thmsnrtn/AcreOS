/**
 * The wholesaler's buy box and candidate triage (Leg 2). Behind the Wholesale
 * module, not a new door.
 *
 * Saving makes a NEW version; earlier versions are kept and listed. Triage
 * scores the org's own prospects against the current version, naming every
 * pass, failure and unknown, and retires stale candidates with the reason.
 * Nothing here pulls a list or contacts anyone.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageShell } from "@/components/page-shell";
import { QueryErrorState } from "@/components/query-error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BuyBoxCriteria, TriageRow } from "@shared/wholesale/buyBox";

interface BuyBoxRow { version: number; criteria: BuyBoxCriteria; createdAt: string }

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const dollarsToCents = (s: string) => (s.trim() === "" ? undefined : Math.round(Number(s.replace(/[$,\s]/g, "")) * 100));

/** The criteria the form describes, or null while it cannot be saved. */
export function criteriaFromForm(f: { states: string; counties: string; zips: string; maxPrice: string; minFee: string; staleDays: string }): BuyBoxCriteria | null {
  const states = list(f.states).map((s) => s.toUpperCase());
  const staleAfterDays = Number(f.staleDays);
  if (states.length === 0 || !Number.isInteger(staleAfterDays) || staleAfterDays < 1) return null;
  const counties = list(f.counties).map((c) => {
    const [county, state] = c.split(/\s+(?=[A-Za-z]{2}$)/);
    return { county: (county ?? "").trim(), state: (state ?? "").toUpperCase() };
  });
  const maxPurchasePriceCents = dollarsToCents(f.maxPrice);
  const minAssignmentFeeCents = dollarsToCents(f.minFee);
  return {
    states,
    ...(counties.length ? { counties } : {}),
    ...(list(f.zips).length ? { zips: list(f.zips) } : {}),
    ...(maxPurchasePriceCents !== undefined ? { maxPurchasePriceCents } : {}),
    ...(minAssignmentFeeCents !== undefined ? { minAssignmentFeeCents } : {}),
    staleAfterDays,
  };
}

const VERDICT: Record<TriageRow["verdict"], string> = { fits: "Fits", fails: "Doesn't fit", undetermined: "Not enough recorded", retired: "Retired" };

export default function WholesaleBuyBoxPage() {
  useDocumentTitle("Buy box");
  const box = useQuery<{ current: BuyBoxRow | null; versions: BuyBoxRow[] }>({ queryKey: ["/api/wholesale/buy-box"] });
  const triage = useQuery<{ rows: TriageRow[]; buyBoxVersion: number; capped: boolean }>({
    queryKey: ["/api/wholesale/candidates/triage"],
    enabled: !!box.data?.current,
  });
  const [f, setF] = useState({ states: "", counties: "", zips: "", maxPrice: "", minFee: "", staleDays: "30" });
  const criteria = criteriaFromForm(f);
  const save = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/wholesale/buy-box", { criteria })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/buy-box"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/candidates/triage"] });
    },
  });
  const field = (key: keyof typeof f, label: string, hint?: string) => (
    <div>
      <Label htmlFor={`bb-${key}`}>{label}</Label>
      <Input id={`bb-${key}`} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );

  return (
    <PageShell label="Buy box">
      <div className="mx-auto max-w-3xl space-y-6 p-4">
        <h1 className="text-xl font-semibold">Buy box</h1>
        {box.isLoading ? <Skeleton className="h-24" /> : box.isError ? <QueryErrorState error={box.error} onRetry={() => box.refetch()} /> : (
          <p className="text-sm text-muted-foreground" data-testid="buy-box-current">
            {box.data?.current ? `Version ${box.data.current.version} is current (${box.data.versions.length} saved).` : "No buy box saved yet."}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("states", "States", "Comma-separated, e.g. TX, FL")}
          {field("counties", "Counties (optional)", "e.g. Harris TX, Dallas TX")}
          {field("zips", "ZIPs (optional)")}
          {field("maxPrice", "Max contract price ($, optional)")}
          {field("minFee", "Min assignment fee ($, optional)")}
          {field("staleDays", "Retire after (days without activity)")}
        </div>
        <Button onClick={() => save.mutate()} disabled={!criteria || save.isPending} data-testid="buy-box-save">
          Save as a new version
        </Button>

        {triage.data ? (
          <ul className="space-y-2" data-testid="buy-box-triage">
            {triage.data.rows.map((r) => (
              <li key={r.propertyId} className="rounded-md border border-border p-3 text-sm" data-testid={`triage-${r.propertyId}`}>
                <div className="font-medium">
                  {r.label} — {VERDICT[r.verdict]}
                  {r.score !== null ? ` (${Math.round(r.score * 100)}%)` : ""}
                </div>
                {[r.retiredBecause, ...r.failures, ...r.unknowns].filter(Boolean).map((t) => (
                  <div key={t} className="text-muted-foreground">{t}</div>
                ))}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </PageShell>
  );
}
