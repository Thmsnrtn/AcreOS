/**
 * Founder unified feed.
 *
 * One timeline view that merges the three sources the founder currently
 * has to check separately:
 *   - feedback_submissions (public + in-app support / feedback)
 *   - decisions_inbox_items with itemType='agent_event' (planner /
 *     telemetry / budget warnings)
 *   - agent_tasks filtered to Rosy-River agents (code-change proposals)
 *
 * No new endpoints — calls the three existing GETs and merges client-side.
 * Items are sorted by createdAt desc and rendered with source-specific
 * chips so the founder can scan or filter visually.
 *
 * Closes the "unified founder feed" gap from the original master prompt.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { CanonicalSurfacesBanner } from "@/components/founder/CanonicalSurfacesBanner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Link } from "wouter";
import { Bot, MessageSquare, Zap, Activity } from "lucide-react";

type SourceKey = "feedback" | "agent_event" | "agent_proposal";

interface UnifiedItem {
  source: SourceKey;
  id: number;
  title: string;
  description: string;
  badge: string;
  createdAt: string;
  href?: string;
}

interface FeedbackResponse {
  submissions: Array<{
    id: number;
    category: string;
    name: string | null;
    email: string | null;
    message: string;
    status: string;
    createdAt: string;
  }>;
}

interface AgentNotifResponse {
  notifications: Array<{
    id: number;
    itemType: string;
    riskLevel: string;
    sophieAnalysis: string;
    ownerAgentCodename: string | null;
    status: string;
    createdAt: string;
  }>;
}

interface ProposalsResponse {
  proposals: Array<{
    id: number;
    agentType: string;
    status: string;
    requiresReview: boolean | null;
    output: { title?: string; rationale?: string; riskTier?: string } | null;
    createdAt: string;
  }>;
}

function formatDate(s: string): string {
  return new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SOURCE_LABEL: Record<SourceKey, string> = {
  feedback: "Feedback",
  agent_event: "Agent event",
  agent_proposal: "Code proposal",
};

const SOURCE_ICON: Record<SourceKey, typeof Bot> = {
  feedback: MessageSquare,
  agent_event: Zap,
  agent_proposal: Bot,
};

export default function FounderFeedPage() {
  useDocumentTitle("Founder feed");
  const [filter, setFilter] = useState<SourceKey | "all">("all");

  const { data: feedback, isLoading: l1 } = useQuery<FeedbackResponse>({
    queryKey: ["/api/founder/feedback"],
  });
  const { data: events, isLoading: l2 } = useQuery<AgentNotifResponse>({
    queryKey: ["/api/founder/agent-notifications"],
  });
  const { data: proposals, isLoading: l3 } = useQuery<ProposalsResponse>({
    queryKey: ["/api/founder/proposed-changes"],
  });

  const items = useMemo<UnifiedItem[]>(() => {
    const out: UnifiedItem[] = [];
    for (const f of feedback?.submissions ?? []) {
      out.push({
        source: "feedback",
        id: f.id,
        title: `${f.category} · ${f.name || "anonymous"}${f.email ? ` (${f.email})` : ""}`,
        description: f.message.slice(0, 240),
        badge: f.status,
        createdAt: f.createdAt,
        href: "/founder/feedback",
      });
    }
    for (const e of events?.notifications ?? []) {
      out.push({
        source: "agent_event",
        id: e.id,
        title: `${e.ownerAgentCodename ?? "agent"} · ${e.riskLevel}`,
        description: e.sophieAnalysis.slice(0, 240),
        badge: e.status,
        createdAt: e.createdAt,
        href: "/founder/agent-queue",
      });
    }
    for (const p of proposals?.proposals ?? []) {
      const output = p.output ?? {};
      out.push({
        source: "agent_proposal",
        id: p.id,
        title: `${p.agentType} · ${output.title ?? "(untitled)"}`,
        description: (output.rationale ?? "").slice(0, 240),
        badge: p.status,
        createdAt: p.createdAt,
        href: "/founder/agent-queue",
      });
    }
    out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return filter === "all" ? out : out.filter((i) => i.source === filter);
  }, [feedback, events, proposals, filter]);

  const isLoading = l1 || l2 || l3;

  return (
    <PageShell>
      <div className="max-w-5xl mx-auto py-6 space-y-6">
        <CanonicalSurfacesBanner variant="compact" />
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Activity className="h-6 w-6" aria-hidden="true" />
              Founder feed
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Everything that wants your attention — public feedback,
              agent events, code-change proposals — in one timeline.
            </p>
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as SourceKey | "all")}>
            <SelectTrigger className="w-44" data-testid="filter-source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              <SelectItem value="feedback">Feedback</SelectItem>
              <SelectItem value="agent_event">Agent events</SelectItem>
              <SelectItem value="agent_proposal">Code proposals</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading && (
          <div className="space-y-3" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <Card>
            <CardContent className="pt-10 pb-10 text-center text-muted-foreground space-y-2">
              <Activity className="h-10 w-10 mx-auto opacity-40" aria-hidden="true" />
              <div className="text-sm">No items in your feed.</div>
              <div className="text-xs">
                Feedback submissions, weekly agent digests, and code-change
                proposals will appear here as they arrive.
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {items.map((item) => {
            const Icon = SOURCE_ICON[item.source];
            const inner = (
              <Card data-testid={`feed-${item.source}-${item.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-md bg-muted/60 mt-0.5" aria-hidden="true">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {SOURCE_LABEL[item.source]}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {item.badge}
                        </Badge>
                        <span className="text-sm font-normal text-muted-foreground">
                          {formatDate(item.createdAt)}
                        </span>
                      </CardTitle>
                      <CardDescription className="text-sm font-medium text-foreground">
                        {item.title}
                      </CardDescription>
                      {item.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>
            );
            return item.href ? (
              <Link key={`${item.source}-${item.id}`} href={item.href} className="block hover:opacity-90 transition-opacity">
                {inner}
              </Link>
            ) : (
              <div key={`${item.source}-${item.id}`}>{inner}</div>
            );
          })}
        </div>
      </div>
    </PageShell>
  );
}
