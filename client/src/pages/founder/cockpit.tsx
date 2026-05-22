/**
 * /founder/cockpit — the monthly check-in surface.
 *
 * Sibling of /founder/now. Two-surface design:
 *   - /founder/now      = daily; what needs you today
 *   - /founder/cockpit  = monthly; what happened, what's the trend,
 *                         what one strategic move needs your call
 *
 * Composes /api/founder/cockpit which aggregates the 13 fragmented
 * founder-summary endpoints into one structured response. The cockpit
 * is intended to be read once a month in 5 minutes; the founder
 * decides on the one surfaced strategic move, then closes the tab.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  DollarSign,
  Users,
  Package,
  Cpu,
  AlertTriangle,
  Lightbulb,
  ArrowRight,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
// Founder Finance — Buckets / MRR+margin / Cost-mix / Scale-up history /
// Recovery transfer. Folded in here (above existing letter + strategy
// sections) per the founder-side integration map; no new top-level
// /founder/finance route. Section deliberately renders ABOVE the existing
// content so financial state is the first thing the founder sees on the
// steering surface.
import { FounderFinanceSteeringSections } from "@/components/founder/finance-steering-sections";

interface CockpitSection {
  title: string;
  headline: string;
  detail: Array<{ label: string; value: string; trend?: "up" | "down" | "flat" }>;
  actionUrl?: string;
}

interface CockpitResponse {
  generatedAt: string;
  windowDays: number;
  sections: {
    money: CockpitSection;
    customers: CockpitSection;
    product: CockpitSection;
    autonomy: CockpitSection;
    risks: CockpitSection;
    decision: {
      title: string;
      rationale: string;
      strategicProposalId: number | null;
      actionUrl: string;
    } | null;
  };
  letter: { month: string; body: string } | null;
}

const SECTION_ICONS = {
  money: DollarSign,
  customers: Users,
  product: Package,
  autonomy: Cpu,
  risks: AlertTriangle,
};

export default function FounderCockpitPage() {
  // F-D16: page is exposed at /founder/steering per Phase F; title kept in
  // sync with the new IA name. Keep file name as cockpit.tsx for now to
  // avoid a deleted-file noise commit; the route mapping in App.tsx is
  // what users see.
  useDocumentTitle("Steering — monthly check-in");
  const { data, isLoading, refetch, isError } = useQuery<CockpitResponse>({
    queryKey: ["/api/founder/cockpit"],
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });

  return (
    <PageShell label="Cockpit">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="space-y-1">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Cockpit</h1>
              <p className="text-sm text-muted-foreground">
                Read once a month. Decide one thing. Close the tab.
              </p>
            </div>
            {data?.generatedAt && (
              <div className="text-xs text-muted-foreground tabular-nums">
                {data.windowDays}-day window · generated {new Date(data.generatedAt).toLocaleString()}
              </div>
            )}
          </div>
        </header>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-acr-neg" role="alert">
              Couldn't load cockpit.{" "}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => refetch()}
              >
                try again
              </button>
            </CardContent>
          </Card>
        ) : data ? (
          <>
            {/* Founder Finance sections — buckets / MRR + margin / cost mix /
                scale-up history / recovery actions. Render ABOVE the existing
                letter + strategic-move sections so financial state is the
                first thing visible on the steering surface. */}
            <FounderFinanceSteeringSections />

            {/* The one decision — pinned at the top because it's the only thing the founder MUST act on */}
            {data.sections.decision ? (
              <Card className="border-acr-brand/30 bg-acr-brand-soft/40">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Lightbulb className="w-4 h-4 text-acr-brand" aria-hidden="true" />
                    Decide this month
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div>
                      <div className="font-semibold text-base">{data.sections.decision.title}</div>
                      <p className="text-sm text-muted-foreground mt-1">{data.sections.decision.rationale}</p>
                    </div>
                    <Button asChild size="sm">
                      <Link href={data.sections.decision.actionUrl}>
                        Approve, reject, or defer <ArrowRight className="w-3 h-3 ml-1" aria-hidden="true" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SectionCard section={data.sections.money} iconKey="money" />
              <SectionCard section={data.sections.customers} iconKey="customers" />
              <SectionCard section={data.sections.product} iconKey="product" />
              <SectionCard section={data.sections.autonomy} iconKey="autonomy" />
            </div>

            <SectionCard section={data.sections.risks} iconKey="risks" wide />

            {data.letter ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">
                    Founder letter — {data.letter.month}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-sm whitespace-pre-wrap font-serif leading-relaxed">{data.letter.body}</pre>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </PageShell>
  );
}

function SectionCard({
  section,
  iconKey,
  wide = false,
}: {
  section: CockpitSection;
  iconKey: keyof typeof SECTION_ICONS;
  wide?: boolean;
}) {
  const Icon = SECTION_ICONS[iconKey];
  return (
    <Card className={wide ? "md:col-span-2" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Icon className="w-4 h-4" aria-hidden="true" />
          {section.title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="text-base font-semibold">{section.headline}</div>
          {section.detail.length > 0 && (
            <ul className="space-y-1.5 text-sm" role="list">
              {section.detail.map((d, idx) => (
                <li key={idx} className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">{d.label}</span>
                  <span className="font-medium tabular-nums flex items-center gap-1">
                    {d.value}
                    {d.trend === "up" && <TrendingUp className="w-3 h-3 text-acr-pos" aria-hidden="true" />}
                    {d.trend === "down" && <TrendingDown className="w-3 h-3 text-acr-neg" aria-hidden="true" />}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {section.actionUrl && (
            <Button asChild size="sm" variant="outline" className="text-xs">
              <Link href={section.actionUrl}>
                Drill in <ArrowRight className="w-3 h-3 ml-1" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
