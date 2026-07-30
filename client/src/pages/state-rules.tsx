/**
 * /state-rules — directory of per-state tax-sale + redemption rules.
 * /state-rules/:state — single-state detail page.
 *
 * Marcus's review §3: "I want a /state-rules/AL page that says: redemption
 * period 3 years, super-priority lien on year 4, foreclosure procedure
 * under §40-10-180 et seq, sample notice-to-redeem template, sample
 * quiet-title petition. That single resource is a real product."
 *
 * ── Wave D (2026-07-30): the 51-jurisdiction library, rendered ──────────
 * `/api/tax-rules` used to merge two sources and this page typed the payload
 * as if every row were computational: `defaultRateBps: number`,
 * `interestModel: string`, `redemptionPeriodMonths: number`. The endpoint now
 * returns THREE coverage tiers and nulls the fields it cannot honestly fill,
 * so the old rendering would have printed a reference-only state's absent
 * interest rate as "0.00%" — a fabricated rate on the surface an operator
 * quotes to a county clerk.
 *
 * Rules this page obeys:
 *   1. NULL IS "NOT ENCODED", NEVER ZERO. Every nullable field renders the
 *      words "Not encoded"; there is no numeric fallback anywhere below.
 *   2. NOTHING HERE IS ATTORNEY-REVIEWED. The caveat the API ships with the
 *      payload is rendered verbatim, on the index, on every detail page, and
 *      in the sticky banner that survives a screenshot.
 *   3. A DERIVED DEADLINE IS LABELLED PRELIMINARY, WITH ITS BASIS. This page
 *      does not compute deadlines (the server does, and hands back the basis
 *      string with the certificate); it states the derivation the encoded rule
 *      implies and marks it preliminary.
 *   4. A JURISDICTION WITH NO RULE SAYS SO. The lookup box and the detail
 *      route both render the refusal — never a median-state default.
 */

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ArrowLeft, BookOpen, Search, ShieldAlert, ShieldCheck } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { formatDate } from "@/lib/format";
import { staggerContainer, staggerItem } from "@/lib/animations";

/** The one word this page uses for an absent value. Never a number. */
const NOT_ENCODED = "Not encoded";

type CoverageTier = "computational" | "reference_only" | "not_encoded";

interface RuleRow {
  state: string;
  source: "db" | "computational_fallback" | "reference_only";
  coverage: CoverageTier;
  /** False for reference-only rows — the interest model is not encoded. */
  redemptionMathEncoded: boolean;
  /** `lien` | `deed` | `redeemable_deed`, or the reference module's spelling. */
  saleType: string;
  interestModel: string | null;
  redemptionPeriodMonths: number | null;
  redemptionPeriodMonthsOwnerOccupied: number | null;
  /** NULL means "not encoded". It never means zero percent. */
  defaultRateBps: number | null;
  firstPeriodMonths: number | null;
  firstPeriodRateBps: number | null;
  secondPeriodRateBps: number | null;
  yearlyAddOnBps: number | null;
  deadlineAnchor: string | null;
  citation: string | null;
  noticeRequirements: string | null;
  quietTitleProcedure: string | null;
  foreclosureProcedure: string | null;
  attorneyReviewedAt: string | null;
  attorneyReviewedBy: string | null;
  attorneyReviewed: boolean;
  notes: string | null;
  updatedAt: string | null;
  caveat: string;
}

interface ListResponse {
  rules: RuleRow[];
  totalStates: number;
  reviewedCount: number;
  computationalCount: number;
  referenceOnlyCount: number;
  jurisdictionsNotEncoded: number;
  attorneyReviewed: boolean;
  caveat: string;
}

type DetailResponse =
  | { notEncoded: false; source: RuleRow["source"]; coverage: CoverageTier; rule: RuleRow; caveat: string }
  /** The endpoint 404s for an unencoded jurisdiction. That is an ANSWER. */
  | { notEncoded: true; message: string };

const SALE_TYPE_LABELS: Record<string, string> = {
  lien: "Lien",
  deed: "Deed",
  redeemable_deed: "Redeemable deed",
  // The 51-state reference module's own spellings, for reference-only rows.
  tax_lien_certificate: "Lien",
  tax_deed: "Deed",
  hybrid: "Redeemable deed",
};

function saleTypeLabel(saleType: string): string {
  return SALE_TYPE_LABELS[saleType] ?? saleType.replace(/_/g, " ");
}

const COVERAGE_LABELS: Record<CoverageTier, string> = {
  computational: "Redemption math encoded",
  reference_only: "Reference only — math not encoded",
  not_encoded: NOT_ENCODED,
};

/** Basis-points → percent, or the words. A null rate is never a 0.00%. */
function fmtRateBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return NOT_ENCODED;
  return `${(bps / 100).toFixed(2)}%`;
}

function fmtMonths(m: number | null | undefined): string {
  if (m === null || m === undefined) return NOT_ENCODED;
  if (m === 0) return "No redemption period";
  if (m % 12 === 0) return `${m / 12} ${m === 12 ? "year" : "years"}`;
  return `${m} months`;
}

function fmtWords(v: string | null | undefined): string {
  if (!v) return NOT_ENCODED;
  return v.replace(/_/g, " ");
}

/** The refusal sentence for a jurisdiction we hold nothing for. */
function notEncodedSentence(state: string): string {
  return `AcreOS has no tax-sale rule encoded for '${state}'. Nothing is assumed on your behalf — there is no default rule behind this page.`;
}

export default function StateRulesPage() {
  const [matchDetail, params] = useRoute<{ state: string }>("/state-rules/:state");
  if (matchDetail && params?.state) {
    return <StateRuleDetail state={params.state.toUpperCase()} />;
  }
  return <StateRulesIndex />;
}

/**
 * Sticky, non-dismissable preliminary banner.
 *
 * Carla Mendoza (RE attorney lens, 2026-05-27): same rationale as the
 * wholesaler-state-rules page. State tax-sale rules are paralegal-
 * authored; the banner stays visible while the operator scrolls through
 * redemption math, statutory citations, and notice templates so a
 * screenshot from this surface always carries the "not legal advice"
 * caveat + the rule-data age.
 *
 * `caveat` is rendered verbatim from the API so the sentence the server
 * attaches to this data is the sentence the operator reads.
 */
function StickyPreliminaryBanner({
  rulesUpdatedAt,
  reviewedCount,
  totalStates,
  caveat,
}: {
  rulesUpdatedAt: string | null;
  reviewedCount: number;
  totalStates: number;
  caveat: string | null;
}) {
  const stamp = rulesUpdatedAt ? formatDate(rulesUpdatedAt) : "before launch";
  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid="state-rules-preliminary-banner"
      className="sticky top-0 z-overlay -mx-4 md:-mx-6 mb-4 px-4 md:px-6 py-2.5 border-b border-acr-warning/40 bg-acr-warning/10 backdrop-blur supports-[backdrop-filter]:bg-acr-warning/10"
    >
      <div className="flex items-start gap-2 max-w-5xl mx-auto">
        <ShieldAlert className="w-4 h-4 text-acr-warning shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs leading-snug text-acr-warning">
          <strong>Not attorney-reviewed. Not legal advice.</strong>{" "}
          {caveat ??
            "Preliminary — not attorney-reviewed. Confirm against the state code and the county clerk before relying on this."}{" "}
          {totalStates > 0 && (
            <>
              {reviewedCount}/{totalStates} jurisdictions are attorney-reviewed; the rest are
              preliminary.{" "}
            </>
          )}
          Rule data last updated <time dateTime={rulesUpdatedAt ?? ""}>{stamp}</time>.
        </p>
      </div>
    </div>
  );
}

function CoverageBadge({ coverage }: { coverage: CoverageTier }) {
  const tone =
    coverage === "computational"
      ? "bg-primary/10 text-primary"
      : coverage === "reference_only"
        ? "bg-acr-warning/10 text-acr-warning"
        : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-block rounded-md px-1.5 py-0.5 text-micro uppercase tracking-wide ${tone}`}>
      {coverage === "computational" ? "Computational" : coverage === "reference_only" ? "Reference only" : NOT_ENCODED}
    </span>
  );
}

function StateRulesIndex() {
  useDocumentTitle("State rules — AcreOS");
  const [lookup, setLookup] = useState("");

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<ListResponse>({
    queryKey: ["/api/tax-rules"],
    queryFn: async () => {
      const res = await fetch("/api/tax-rules", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  const rules = data?.rules ?? [];
  const lookupCode = lookup.trim().toUpperCase();
  const lookupHit = useMemo(
    () => (lookupCode.length === 2 ? rules.find((r) => r.state === lookupCode) ?? null : null),
    [rules, lookupCode],
  );
  const lookupMiss = lookupCode.length === 2 && !lookupHit && rules.length > 0;

  return (
    <PageShell label="State rules">
      <StickyPreliminaryBanner
        rulesUpdatedAt={rules.find((r) => r.updatedAt)?.updatedAt ?? null}
        reviewedCount={data?.reviewedCount ?? 0}
        totalStates={data?.totalStates ?? 0}
        caveat={data?.caveat ?? null}
      />
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">State rules</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Per-state redemption math, statutory citations, notice requirements, and quiet-title
          procedure. Each jurisdiction says which tier it came from: whether AcreOS can{" "}
          <strong>compute</strong> its redemption math, whether it holds <strong>reference data
          only</strong>, or whether the rule is <strong>not encoded</strong> at all. Nothing on this
          page falls back to a generic default.
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : isError ? (
        <QueryErrorState
          error={error instanceof Error ? error : null}
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          title="Couldn't load the state-rule library"
          description="The rule library didn't load. Nothing has changed — try again."
          testId="state-rules-query-error"
        />
      ) : rules.length === 0 ? (
        <Card>
          <div className="p-6 text-sm text-muted-foreground">
            No jurisdiction rules are loaded. AcreOS will not fall back to a generic rule — until the
            library loads, treat every deadline and rate as unknown.
          </div>
        </Card>
      ) : (
        <>
          {/* Coverage summary — each tile is a real count from the payload. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Jurisdictions on file</div>
              <div className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">
                {data!.totalStates}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Redemption math encoded</div>
              <div className="text-2xl font-semibold tracking-tight mt-1 tabular-nums text-primary">
                {data!.computationalCount}
              </div>
              <div className="text-micro text-muted-foreground mt-0.5">
                {data!.referenceOnlyCount} reference-only
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Attorney-reviewed</div>
              <div
                className={`text-2xl font-semibold tracking-tight mt-1 tabular-nums ${
                  data!.reviewedCount === 0 ? "text-acr-warning" : "text-acr-pos"
                }`}
              >
                {data!.reviewedCount} / {data!.totalStates}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Not encoded</div>
              <div className="text-2xl font-semibold tracking-tight mt-1 tabular-nums text-muted-foreground">
                {data!.jurisdictionsNotEncoded}
              </div>
              <div className="text-micro text-muted-foreground mt-0.5">
                AcreOS refuses rather than guessing
              </div>
            </Card>
          </div>

          {data!.reviewedCount === 0 && (
            <Card className="mb-5 border-acr-warning/30 bg-acr-warning/5">
              <div className="p-4 flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-acr-warning shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold">
                    Every entry is preliminary — none is attorney-reviewed.
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5" data-testid="state-rules-caveat">
                    {data!.caveat}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Jurisdiction lookup — a miss is an explicit refusal, not a blank. */}
          <Card className="mb-5">
            <div className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="space-y-1 sm:w-64">
                  <Label htmlFor="state-lookup" className="text-xs">
                    Look up a jurisdiction (2-letter code)
                  </Label>
                  <div className="relative">
                    <Search
                      className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Input
                      id="state-lookup"
                      value={lookup}
                      maxLength={2}
                      autoComplete="off"
                      placeholder="TN"
                      onChange={(e) => setLookup(e.target.value.toUpperCase())}
                      className="h-9 pl-8 uppercase"
                      data-testid="input-state-lookup"
                    />
                  </div>
                </div>
                {lookupHit && (
                  <Link href={`/state-rules/${lookupHit.state}`}>
                    <Button size="sm" variant="outline" data-testid="button-lookup-open">
                      Open {lookupHit.state} — {saleTypeLabel(lookupHit.saleType)},{" "}
                      {COVERAGE_LABELS[lookupHit.coverage]}
                    </Button>
                  </Link>
                )}
              </div>
              {lookupMiss && (
                <p
                  className="text-xs text-acr-warning mt-3"
                  role="status"
                  data-testid="text-state-not-encoded"
                >
                  <strong>{NOT_ENCODED}.</strong> {notEncodedSentence(lookupCode)}
                </p>
              )}
            </div>
          </Card>

          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
            data-testid="list-state-rules"
          >
            {rules.map((r) => (
              <motion.div key={r.state} variants={staggerItem}>
                <Link href={`/state-rules/${r.state}`}>
                  <Card
                    className="p-4 hover:bg-accent/50 transition-colors cursor-pointer h-full focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`card-state-${r.state}`}
                  >
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-2xl font-bold">{r.state}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {saleTypeLabel(r.saleType)}
                        </span>
                      </div>
                      {r.attorneyReviewed ? (
                        <span title="Attorney-reviewed">
                          <ShieldCheck className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                          <span className="sr-only">Attorney-reviewed</span>
                        </span>
                      ) : (
                        <span title="Preliminary — not attorney-reviewed">
                          <ShieldAlert className="w-4 h-4 text-acr-warning" aria-hidden="true" />
                          <span className="sr-only">Preliminary — not attorney-reviewed</span>
                        </span>
                      )}
                    </div>
                    <div className="mb-2">
                      <CoverageBadge coverage={r.coverage} />
                    </div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Redemption</span>
                        <span className="font-medium text-right">
                          {fmtMonths(r.redemptionPeriodMonths)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Interest rate</span>
                        <span
                          className={`text-right ${
                            r.defaultRateBps === null ? "text-muted-foreground italic" : "font-mono"
                          }`}
                        >
                          {fmtRateBps(r.defaultRateBps)}
                        </span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Model</span>
                        <span
                          className={`text-right ${
                            r.interestModel === null ? "text-muted-foreground italic" : ""
                          }`}
                        >
                          {fmtWords(r.interestModel)}
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </>
      )}
    </PageShell>
  );
}

function StateRuleDetail({ state }: { state: string }) {
  useDocumentTitle(`${state} tax-sale rules — AcreOS`);
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery<DetailResponse>({
    queryKey: ["/api/tax-rules", state],
    queryFn: async () => {
      const res = await fetch(`/api/tax-rules/${state}`, { credentials: "include" });
      // A 404 here is the endpoint REFUSING to invent a rule. Render that
      // answer; do not surface it as a loading failure.
      if (res.status === 404) {
        const body = await res.json().catch(() => null);
        const message =
          body && typeof body.message === "string" && body.message.length > 0
            ? body.message
            : notEncodedSentence(state);
        return { notEncoded: true, message } satisfies DetailResponse;
      }
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const body = await res.json();
      return { notEncoded: false, ...body } as DetailResponse;
    },
  });

  const backLink = (
    <Link href="/state-rules">
      <Button variant="ghost" size="sm" className="mb-3 -ml-2">
        <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" /> Back to jurisdictions
      </Button>
    </Link>
  );

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
        {backLink}
        <QueryErrorState
          error={error instanceof Error ? error : null}
          onRetry={() => refetch()}
          isRetrying={isRefetching}
          title={`Couldn't load ${state} rules`}
          description="The jurisdiction detail didn't load. Nothing has changed — try again."
          testId="state-rule-detail-query-error"
        />
      </PageShell>
    );
  }

  // ── Not encoded: the honest answer, with no rule fields at all ──────────
  if (data.notEncoded) {
    return (
      <PageShell>
        {backLink}
        <div className="flex items-center gap-3 mb-3">
          <BookOpen className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-3xl font-bold">{state}</h1>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-muted text-muted-foreground">
            {NOT_ENCODED}
          </span>
        </div>
        <Card className="border-acr-warning/30 bg-acr-warning/5" data-testid="card-state-not-encoded">
          <div className="p-5 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-acr-warning shrink-0 mt-0.5" aria-hidden="true" />
            <div className="space-y-2">
              <p className="text-sm font-semibold">
                {state} tax-sale rules are {NOT_ENCODED.toLowerCase()} in AcreOS.
              </p>
              <p className="text-sm text-muted-foreground" data-testid="text-not-encoded-message">
                {data.message}
              </p>
              <p className="text-xs text-muted-foreground">
                No redemption period, interest rate or deadline is shown above, because AcreOS holds
                none for {state}. Confirm the rule with the state code and the county clerk, and
                calendar any deadline yourself.
              </p>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  const r = data.rule;
  const reviewed = r.attorneyReviewed;
  const computational = r.coverage === "computational";

  return (
    <PageShell>
      <StickyPreliminaryBanner
        rulesUpdatedAt={r.updatedAt}
        reviewedCount={reviewed ? 1 : 0}
        totalStates={1}
        caveat={data.caveat ?? r.caveat}
      />
      {backLink}

      <div className="flex items-start justify-between mb-2 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-primary" aria-hidden="true" />
          <h1 className="text-3xl font-bold">{r.state}</h1>
          <span className="text-sm text-muted-foreground">{saleTypeLabel(r.saleType)} sale state</span>
        </div>
        <div className="flex items-center gap-2">
          <CoverageBadge coverage={r.coverage} />
          <span
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
              reviewed ? "bg-acr-pos/10 text-acr-pos" : "bg-acr-warning/10 text-acr-warning"
            }`}
          >
            {reviewed ? (
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {reviewed && r.attorneyReviewedAt
              ? `Reviewed ${formatDate(r.attorneyReviewedAt)}`
              : "Preliminary — not attorney-reviewed"}
          </span>
        </div>
      </div>
      {r.citation && <p className="text-sm text-muted-foreground mb-4 italic">{r.citation}</p>}

      <Card className="mb-6 border-acr-warning/30 bg-acr-warning/5">
        <div className="p-4 text-xs text-muted-foreground" data-testid="text-detail-caveat">
          {data.caveat ?? r.caveat}
        </div>
      </Card>

      {!computational && (
        <Card className="mb-6">
          <div className="p-5 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-acr-warning shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold">
                Redemption math for {r.state} is {NOT_ENCODED.toLowerCase()}.
              </p>
              <p className="text-xs text-muted-foreground mt-1" data-testid="text-math-not-encoded">
                AcreOS holds this jurisdiction's sale type, redemption period and statutory citation
                as reference data, but not its interest model or deadline anchor. It will not compute
                a redemption amount or a redemption deadline for {r.state}, and it will not
                substitute another state's rule. Enter the deadline yourself when you record a
                certificate.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-3">Redemption rule</h2>
          <Separator className="mb-3" />
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <KV label="Redemption period" value={fmtMonths(r.redemptionPeriodMonths)} />
            {r.redemptionPeriodMonthsOwnerOccupied != null && (
              <KV
                label="Owner-occupied period"
                value={fmtMonths(r.redemptionPeriodMonthsOwnerOccupied)}
              />
            )}
            <KV label="Interest rate" value={fmtRateBps(r.defaultRateBps)} mono />
            <KV label="Interest model" value={fmtWords(r.interestModel)} />
            {r.firstPeriodMonths != null && (
              <KV label="First-period months" value={String(r.firstPeriodMonths)} />
            )}
            {r.firstPeriodRateBps != null && (
              <KV label="First-period rate" value={fmtRateBps(r.firstPeriodRateBps)} mono />
            )}
            {r.secondPeriodRateBps != null && (
              <KV label="Second-period rate" value={fmtRateBps(r.secondPeriodRateBps)} mono />
            )}
            {r.yearlyAddOnBps != null && (
              <KV label="Yearly add-on" value={fmtRateBps(r.yearlyAddOnBps)} mono />
            )}
            <KV label="Deadline anchor" value={fmtWords(r.deadlineAnchor)} />
          </dl>
        </div>
      </Card>

      {/* How a deadline gets derived — stated, and stated as preliminary. */}
      <Card className="mb-6">
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-3">Deadline derivation</h2>
          <Separator className="mb-3" />
          {computational && r.deadlineAnchor === "deed_recordation" ? (
            <p className="text-sm text-acr-warning" data-testid="text-deadline-derivation">
              <strong>Preliminary — and not derivable from a sale date.</strong> {r.state} anchors
              redemption on <em>deed recordation</em>, not the sale date. AcreOS needs the
              recordation date before it will compute this deadline, and will ask you for it rather
              than assume the two are the same day.
            </p>
          ) : computational && r.redemptionPeriodMonths ? (
            <p className="text-sm" data-testid="text-deadline-derivation">
              <strong className="text-acr-warning">Preliminary.</strong> When you record a{" "}
              {r.state} certificate, AcreOS derives the redemption deadline as{" "}
              <span className="font-mono">
                {fmtWords(r.deadlineAnchor)} + {r.redemptionPeriodMonths} months
              </span>
              {r.redemptionPeriodMonthsOwnerOccupied != null && (
                <>
                  {" "}
                  (
                  <span className="font-mono">
                    {r.redemptionPeriodMonthsOwnerOccupied} months
                  </span>{" "}
                  where the parcel was owner-occupied at sale)
                </>
              )}
              , per AcreOS's encoded {r.state} rule
              {r.citation ? <> ({r.citation})</> : null}. Each certificate carries this basis
              sentence with it. The date is <strong>preliminary and not attorney-reviewed</strong> —
              confirm it with the county before you rely on it.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="text-deadline-derivation">
              AcreOS will <strong>not</strong> derive a redemption deadline for {r.state}: its
              deadline anchor is {NOT_ENCODED.toLowerCase()}, and a redemption period without an
              anchor is not enough to know the date. Certificates for this jurisdiction require the
              deadline to be entered by you, and are recorded as operator-supplied.
            </p>
          )}
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
            <h2 className="text-sm font-semibold mb-3">Research notes</h2>
            <Separator className="mb-3" />
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{r.notes}</p>
          </div>
        </Card>
      )}
    </PageShell>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const absent = value === NOT_ENCODED;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 ${absent ? "text-muted-foreground italic" : mono ? "font-mono" : "capitalize"}`}
      >
        {value}
      </dd>
    </div>
  );
}
