/**
 * /wholesaler-state-rules — directory of per-state assignment-legality
 *   data. /wholesaler-state-rules/:state — single-state detail.
 *
 * Trey: "I'll never sign a SaaS contract that doesn't at minimum *try*
 * to keep me in compliance, because every minute I spend defending a
 * complaint is a minute I'm not closing deals."
 *
 * Same shape as the tax-delinquent /state-rules page (TD-3) so the
 * platform feels consistent across compliance lookups.
 */

import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  ArrowLeft,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ShieldQuestion,
  Scale,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { useDocumentTitle } from "@/hooks/use-document-title";

type Status = "unrestricted" | "license_required" | "advertising_restricted" | "pending_legislation";

interface Rule {
  state: string;
  status: Status;
  licenseRequired: boolean;
  advertisingRestricted: boolean;
  recommendation: string;
  citation: string | null;
  summary: string | null;
  detail: string | null;
  attorneyReviewedAt: string | null;
  attorneyReviewedBy: string | null;
  updatedAt: string | null;
}

interface ListResponse {
  rules: Rule[];
  totalStates: number;
  reviewedCount: number;
  restrictedCount: number;
}

const STATUS_META: Record<Status, { label: string; tone: string; Icon: typeof ShieldCheck }> = {
  unrestricted:           { label: "Unrestricted",        tone: "text-acr-pos",     Icon: ShieldCheck },
  license_required:       { label: "License required",    tone: "text-acr-neg",     Icon: ShieldX },
  advertising_restricted: { label: "Advertising restricted", tone: "text-acr-warning", Icon: ShieldAlert },
  pending_legislation:    { label: "Pending legislation",  tone: "text-acr-warning", Icon: ShieldQuestion },
};

export default function WholesalerStateRulesPage() {
  const [matchDetail, params] = useRoute<{ state: string }>("/wholesaler-state-rules/:state");
  if (matchDetail && params?.state) return <RuleDetail state={params.state.toUpperCase()} />;
  return <RulesIndex />;
}

function RulesIndex() {
  useDocumentTitle("Assignment legality by state — AcreOS");

  const { data, isLoading } = useQuery<ListResponse>({
    queryKey: ["/api/wholesaler-rules"],
    queryFn: async () => {
      const res = await fetch("/api/wholesaler-rules", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return res.json();
    },
  });

  return (
    <PageShell label="Assignment legality">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Scale className="w-6 h-6 text-primary" aria-hidden="true" />
          Assignment legality by state
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Per-state wholesale-licensing + advertising rules. Drives the
          assignment-template compliance gate — license-required states
          block template generation; restricted states warn before proceed.
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
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">States covered</div>
              <div className="text-2xl font-semibold tracking-tight mt-1">{data.totalStates}</div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Restricted</div>
              <div className={`text-2xl font-semibold tracking-tight mt-1 ${data.restrictedCount > 0 ? "text-acr-warning" : "text-acr-pos"}`}>
                {data.restrictedCount} / {data.totalStates}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-xs text-muted-foreground">Attorney-reviewed</div>
              <div className={`text-2xl font-semibold tracking-tight mt-1 ${data.reviewedCount === 0 ? "text-acr-warning" : "text-acr-pos"}`}>
                {data.reviewedCount} / {data.totalStates}
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
                    paralegal-quality caveat. The compliance gate still blocks
                    license-required states based on the data here, so verify
                    your state directly before relying on the assignment template.
                  </p>
                </div>
              </div>
            </Card>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.rules.map((r) => {
              const meta = STATUS_META[r.status];
              const Icon = meta.Icon;
              return (
                <Link key={r.state} href={`/wholesaler-state-rules/${r.state}`}>
                  <Card className="p-4 hover:bg-accent/50 transition-colors cursor-pointer">
                    <div className="flex items-start justify-between mb-2">
                      <span className="text-2xl font-bold">{r.state}</span>
                      <Icon className={`w-5 h-5 ${meta.tone}`} aria-hidden="true" />
                    </div>
                    <div className={`text-xs font-medium mb-1 ${meta.tone}`}>{meta.label}</div>
                    {r.summary && (
                      <p className="text-xs text-muted-foreground line-clamp-3">{r.summary}</p>
                    )}
                  </Card>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </PageShell>
  );
}

function RuleDetail({ state }: { state: string }) {
  useDocumentTitle(`${state} assignment legality — AcreOS`);
  const { data, isLoading } = useQuery<{ rule: Rule; preliminary: boolean }>({
    queryKey: ["/api/wholesaler-rules", state],
    queryFn: async () => {
      const res = await fetch(`/api/wholesaler-rules/${state}`, { credentials: "include" });
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
  if (!data) {
    return (
      <PageShell>
        <Link href="/wholesaler-state-rules">
          <Button variant="ghost" size="sm" className="mb-3 -ml-2">
            <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" /> Back
          </Button>
        </Link>
        <Card><div className="p-6">No rule on file for {state}.</div></Card>
      </PageShell>
    );
  }

  const r = data.rule;
  const meta = STATUS_META[r.status];
  const Icon = meta.Icon;
  const reviewed = !!r.attorneyReviewedAt;

  return (
    <PageShell>
      <Link href="/wholesaler-state-rules">
        <Button variant="ghost" size="sm" className="mb-3 -ml-2">
          <ArrowLeft className="w-4 h-4 mr-1.5" aria-hidden="true" /> Back to states
        </Button>
      </Link>

      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-3">
          <Icon className={`w-7 h-7 ${meta.tone}`} aria-hidden="true" />
          <h1 className="text-3xl font-bold">{r.state}</h1>
          <span className={`text-sm font-medium ${meta.tone}`}>{meta.label}</span>
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${
            reviewed ? "bg-acr-pos/10 text-acr-pos" : "bg-acr-warning/10 text-acr-warning"
          }`}
        >
          {reviewed
            ? `Reviewed ${new Date(r.attorneyReviewedAt!).toLocaleDateString()}`
            : "Preliminary"}
        </span>
      </div>
      {r.citation && (
        <p className="text-sm text-muted-foreground mb-6 italic">{r.citation}</p>
      )}

      {r.summary && (
        <Card className="mb-6">
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-2">Summary</h2>
            <Separator className="mb-3" />
            <p className="text-sm">{r.summary}</p>
          </div>
        </Card>
      )}

      <Card className="mb-6">
        <div className="p-5">
          <h2 className="text-sm font-semibold mb-3">Recommendation</h2>
          <Separator className="mb-3" />
          <p className="text-sm">
            <span className="capitalize font-semibold">{r.recommendation.replace(/_/g, " ")}</span>
            {r.recommendation === "double_close_only" && (
              <> — use the double-close path at <Link href="/double-close" className="text-primary hover:underline">/double-close</Link> instead of an assignment-for-fee.</>
            )}
            {r.recommendation === "consult_counsel" && (
              <> — confirm with state counsel before using the assignment template.</>
            )}
          </p>
        </div>
      </Card>

      {r.detail && (
        <Card>
          <div className="p-5">
            <h2 className="text-sm font-semibold mb-2">Detail</h2>
            <Separator className="mb-3" />
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{r.detail}</p>
          </div>
        </Card>
      )}
    </PageShell>
  );
}
