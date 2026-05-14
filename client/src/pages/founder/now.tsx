/**
 * Pillar S — `/founder/now`
 *
 * The single canonical founder inbox. Replaces cross-checking the 7
 * legacy surfaces (agent-queue, strategy, decisions, notifications,
 * feed, todo, daily-digest). Three sections, strict daily attention cap.
 *
 * The legacy surfaces still exist as filtered views of the same
 * /api/founder/now aggregator; this page is the canonical one.
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
  AlertOctagon,
  Clock,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface InboxItem {
  id: string;
  section: "red" | "amber" | "running_fine";
  kind: string;
  title: string;
  body: string;
  priority: number;
  actionUrl: string;
  deferUntil?: string;
  ownerAgentCodename?: string;
}

interface FounderNowResponse {
  generatedAt: string;
  tomorrowResetsAt: string;
  dailyCap: number;
  visible: InboxItem[];
  deferred: InboxItem[];
  counts: { red: number; amber: number; runningFine: number };
  totalCandidates: number;
  overflowApplied: boolean;
}

export default function FounderNowPage() {
  useDocumentTitle("Now — founder inbox");
  const { data, isLoading, refetch, isError } = useQuery<FounderNowResponse>({
    queryKey: ["/api/founder/now"],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const red = data?.visible.filter((i) => i.section === "red") ?? [];
  const amber = data?.visible.filter((i) => i.section === "amber") ?? [];
  const runningFine = data?.visible.filter((i) => i.section === "running_fine") ?? [];

  return (
    <PageShell label="Now">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="space-y-1">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Now</h1>
              <p className="text-sm text-muted-foreground">
                Everything that needs you, in one place.
              </p>
            </div>
            <div className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              Daily attention cap: <strong>{data?.dailyCap ?? 5}</strong>
              {data?.overflowApplied && (
                <span className="ml-2 text-acr-warn">
                  · {data.deferred.length} deferred to tomorrow
                </span>
              )}
            </div>
          </div>
        </header>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-acr-neg" role="alert">
              Couldn't load the inbox.{" "}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => refetch()}
              >
                try again
              </button>
            </CardContent>
          </Card>
        ) : (
          <>
            <InboxSection
              title="Needs you in the next hour"
              tone="red"
              icon={<AlertOctagon className="w-4 h-4 text-acr-neg" aria-hidden="true" />}
              items={red}
              emptyText="Nothing on fire."
            />
            <InboxSection
              title="Needs you this week"
              tone="amber"
              icon={<Clock className="w-4 h-4 text-acr-warn" aria-hidden="true" />}
              items={amber}
              emptyText={
                data?.overflowApplied
                  ? `Today's slate is clear. ${data.deferred.length} item${data.deferred.length === 1 ? "" : "s"} held for tomorrow.`
                  : "Nothing in the week's queue."
              }
            />
            <RunningFineSection items={runningFine} />

            {data?.overflowApplied && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Deferred to tomorrow ({data.deferred.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  Agents proposed more work than today's attention cap of {data.dailyCap}.
                  These will surface tomorrow morning. Adjust the cap in settings if you
                  want more (or fewer) items per day.
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}

function InboxSection({
  title,
  tone,
  icon,
  items,
  emptyText,
}: {
  title: string;
  tone: "red" | "amber";
  icon: React.ReactNode;
  items: InboxItem[];
  emptyText: string;
}) {
  return (
    <section aria-label={title}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <Badge
          variant="secondary"
          className={cn(
            "text-xs tabular-nums border-transparent",
            tone === "red" ? "bg-acr-neg-soft text-acr-neg" : "bg-acr-warn-soft text-acr-warn",
          )}
        >
          {items.length}
        </Badge>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2 px-1">{emptyText}</p>
      ) : (
        <ul className="space-y-2" role="list">
          {items.map((item) => (
            <li key={item.id}>
              <Card
                className={cn(
                  "rounded-card hover:shadow-md transition-shadow",
                  tone === "red" ? "border-acr-neg/30" : "border-acr-warn/30",
                )}
              >
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="font-medium text-sm">{item.title}</span>
                      {item.ownerAgentCodename && (
                        <Badge variant="secondary" className="text-xs bg-acr-brand-soft text-acr-brand border-transparent">
                          {item.ownerAgentCodename}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">{item.body}</p>
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0 text-xs">
                    <Link href={item.actionUrl}>
                      Open <ArrowRight className="w-3 h-3 ml-1" aria-hidden="true" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RunningFineSection({ items }: { items: InboxItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section aria-label="Running fine">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
      >
        <CheckCircle2 className="w-4 h-4 text-acr-pos" aria-hidden="true" />
        <span className="font-semibold tracking-tight">Running fine</span>
        <Badge variant="secondary" className="text-xs tabular-nums bg-acr-pos-soft text-acr-pos border-transparent">
          {items.length}
        </Badge>
        <ChevronDown
          className={cn("w-3 h-3 transition-transform", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {open && (
        <ul className="space-y-1 mt-2 pl-6" role="list">
          {items.length === 0 ? (
            <li className="text-sm text-muted-foreground">No status surfaces.</li>
          ) : (
            items.map((item) => (
              <li key={item.id} className="text-xs text-muted-foreground flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-acr-pos" aria-hidden="true" />
                <span className="font-medium text-foreground">{item.title}</span>
                <span>· {item.body}</span>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
