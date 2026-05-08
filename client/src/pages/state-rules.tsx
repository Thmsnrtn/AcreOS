/**
 * /state-rules — directory of per-state tax-sale + redemption rules.
 * /state-rules/:state — single-state detail page.
 *
 * Marcus's review §3: "I want a /state-rules/AL page that says: redemption
 * period 3 years, super-priority lien on year 4, foreclosure procedure
 * under §40-10-180 et seq, sample notice-to-redeem template, sample
 * quiet-title petition. That single resource is a real product."
 *
 * Ships the directory + per-state detail. Notice templates per state ride
 * TD-6; this is the read-only reference layer.
 */

import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ArrowLeft, BookOpen, ShieldAlert, ShieldCheck } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface RuleRow {
  state: string;
  source: "db" | "fallback";
  saleType: "lien" | "deed" | "redeemable_deed";
  interestModel: string;
  redemptionPeriodMonths: number;
  redemptionPeriodMonthsOwnerOccupied: number | null;
  defaultRateBps: number;
  firstPeriodMonths: number | null;
  firstPeriodRateBps: number | null;
  secondPeriodRateBps: number | null;
  yearlyAddOnBps: number | null;
  deadlineAnchor: string;
  citation: string | null;
  noticeRequirements: string | null;
  quietTitleProcedure: string | null;
  foreclosureProcedure: string | null;
  attorneyReviewedAt: string | null;
  attorneyReviewedBy: string | null;
  notes: string | null;
  updatedAt: string | null;
}

interface ListResponse {
  rules: RuleRow[];
  totalStates: number;
  reviewedCount: number;
  missingStates: number;
}

interface DetailResponse {
  source: "db" | "fallback";
  rule: RuleRow;
}

const SALE_TYPE_LABELS: Record<RuleRow["saleType"], string> = {
  lien: "Lien",
  deed: "Deed",
  redeemable_deed: "Redeemable deed",
};

function fmtPct(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function fmtMonths(m: number): string {
  if (m === 0) return "No redemption";
  if (m % 12 === 0) return `${m / 12} ${m === 12 ? "year" : "years"}`;
  return `${m} months`;
}

export default function StateRulesPage() {
  const [matchDetail, params] = useRoute<{ state: string }>("/state-rules/:state");
  if (matchDetail && params?.state) {
    return <StateRuleDetail state={params.state.toUpperCase()} />;
  }
  return <StateRulesIndex />;
}

function StateRulesIndex() {
  useDocumentTitle("State rules — AcreOS");

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["/api/tax-rules"],
    queryFn: async () => {
      const res = await fetch("/api/tax-rules", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <PageShell label="State rules">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">State rules</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Per-state redemption math, statutory citations, notice
          requirements, and quiet-title procedure. Click a state for the
          detail page. Rates here drive the running redemption-amount math
          on every certificate.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : !data || data.rules.length === 0 ? (
        <Card><div className="p-6 text-sm text-muted-foreground">No rules loaded yet.</div></Card>
      ) : (
        <>
          {/* Coverage summary */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">States covered</div>
              <div className="text-2xl font-semibold tracking-tight mt-1">{data.totalStates}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Attorney-reviewed</div>
              <div className={`text-2xl font-semibold tracking-tight mt-1 ${data.reviewedCount === 0 ? "text-acr-warning" : "text-acr-pos"}`}>
                {data.reviewedCount} / {data.totalStates}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Remaining</div>
              <div className="text-2xl font-semibold tracking-tight mt-1 text-muted-foreground">
                ~{data.missingStates}
              </div>
            </Card>
          </div>

          {data.reviewedCount === 0 && (
            <Card className="mb-5 border-acr-warning/30 bg-acr-warning/5">
              <div className="p-4 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-acr-warning shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">All entries are preliminary.</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Counsel review is in progress. Cite these rules with the
                    paralegal-quality caveat — confirm the citation directly
                    before relying on a quote in front of a county clerk or
                    judge.
                  </p>
                </div>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.rules.map((r) => (
              <Link key={r.state} href={`/state-rules/${r.state}`}>
                <Card className="p-4 hover:bg-accent/50 transition-colors cursor-pointer">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-bold">{r.state}</span>
                      <span className="text-xs text-muted-foreground capitalize">{SALE_TYPE_LABELS[r.saleType]}</span>
                    </div>
                    {r.attorneyReviewedAt ? (
                      <span title="Attorney-reviewed"><ShieldCheck className="w-4 h-4 text-acr-pos" aria-hidden="true" /></span>
                    ) : (
                      <span title="Preliminary — not yet attorney-reviewed"><ShieldAlert className="w-4 h-4 text-acr-warning" aria-hidden="true" /></span>
                    )}
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Redemption</span>
                      <span className="font-medium">{fmtMonths(r.redemptionPeriodMonths)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Default rate</span>
                      <span className="font-mono">{fmtPct(r.defaultRateBps)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Model</span>
                      <span className="capitalize text-xs">{r.interestModel.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </PageShell>
  );
}

function StateRuleDetail({ state }: { state: string }) {
  useDocumentTitle(`${state} tax-sale rules — AcreOS`);
  const { data, isLoading, isError } = useQuery<DetailResponse>({
    queryKey: ["/api/tax-rules", state],
    queryFn: async () => {
      const res = await fetch(`/api/tax-rules/${state}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <PageShell>
        <Skeleton className="h-12 w-72 mb-4" />
        <Skeleton className="h-40" />
      </PageShell>
    );
  }
  if (isError || !data) {
    return (
      <PageShell>
        <Link href="/state-rules">
          <Button variant="ghost" size="sm" className="mb-3 -ml-2">
            <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" /> Back
          </Button>
        </Link>
        <Card><div className="p-6">No rules on file for {state}.</div></Card>
      </PageShell>
    );
  }

  const r = data.rule;
  const reviewed = !!r.attorneyReviewedAt;

  return (
    <PageShell>
      <Link href="/state-rules">
        <Button variant="ghost" size="sm" className="mb-3 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" /> Back to states
        </Button>
      </Link>

      <div className="flex items-start justify-between mb-2 gap-3">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-primary" aria-hidden="true" />
          <h1 className="text-3xl font-bold">{r.state}</h1>
          <span className="text-sm text-muted-foreground capitalize">{SALE_TYPE_LABELS[r.saleType]} sale state</span>
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
            reviewed
              ? "bg-acr-pos/10 text-acr-pos"
              : "bg-acr-warning/10 text-acr-warning"
          }`}
        >
          {reviewed ? <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> : <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />}
          {reviewed
            ? `Reviewed ${new Date(r.attorneyReviewedAt!).toLocaleDateString()}`
            : "Preliminary — not attorney-reviewed"}
        </span>
      </div>
      {r.citation && (
        <p className="text-sm text-muted-foreground mb-6 italic">{r.citation}</p>
      )}

      <Card className="mb-6">
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-3">Redemption math</h2>
          <Separator className="mb-3" />
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <KV label="Redemption period" value={fmtMonths(r.redemptionPeriodMonths)} />
            {r.redemptionPeriodMonthsOwnerOccupied != null && (
              <KV label="Owner-occupied" value={fmtMonths(r.redemptionPeriodMonthsOwnerOccupied)} />
            )}
            <KV label="Default rate" value={fmtPct(r.defaultRateBps)} mono />
            <KV label="Interest model" value={r.interestModel.replace(/_/g, " ")} />
            {r.firstPeriodMonths && (
              <KV label="First-period months" value={String(r.firstPeriodMonths)} />
            )}
            {r.firstPeriodRateBps != null && (
              <KV label="First-period rate" value={fmtPct(r.firstPeriodRateBps)} mono />
            )}
            {r.secondPeriodRateBps != null && (
              <KV label="Second-period rate" value={fmtPct(r.secondPeriodRateBps)} mono />
            )}
            {r.yearlyAddOnBps != null && (
              <KV label="Yearly add-on" value={fmtPct(r.yearlyAddOnBps)} mono />
            )}
            <KV label="Deadline anchor" value={r.deadlineAnchor.replace(/_/g, " ")} />
          </dl>
        </div>
      </Card>

      {r.noticeRequirements && (
        <Card className="mb-6">
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-3">Notice requirements</h2>
            <Separator className="mb-3" />
            <p className="text-sm whitespace-pre-wrap">{r.noticeRequirements}</p>
          </div>
        </Card>
      )}

      {r.quietTitleProcedure && (
        <Card className="mb-6">
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-3">Quiet-title procedure</h2>
            <Separator className="mb-3" />
            <p className="text-sm whitespace-pre-wrap">{r.quietTitleProcedure}</p>
          </div>
        </Card>
      )}

      {r.foreclosureProcedure && (
        <Card className="mb-6">
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-3">Foreclosure / deed procedure</h2>
            <Separator className="mb-3" />
            <p className="text-sm whitespace-pre-wrap">{r.foreclosureProcedure}</p>
          </div>
        </Card>
      )}

      {r.notes && (
        <Card>
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-3">Notes</h2>
            <Separator className="mb-3" />
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{r.notes}</p>
          </div>
        </Card>
      )}
    </PageShell>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 ${mono ? "font-mono" : "capitalize"}`}>{value}</dd>
    </div>
  );
}
