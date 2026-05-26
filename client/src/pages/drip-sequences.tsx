import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Mail, MessageSquare, Phone, Plus, Play, Pause, Users, BarChart3, Loader2, ChevronRight } from "lucide-react";
import { SkeletonList } from "@/components/ui/skeleton-list";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";

interface Sequence {
  id: number;
  name: string;
  description?: string;
  stepCount: number;
  enrolledCount: number;
  completedCount: number;
  unsubscribedCount: number;
  avgDaysDuration: number;
  status: "active" | "draft" | "paused";
  createdAt: string;
  channels: string[];
}

const CHANNEL_ICONS: Record<string, React.ElementType> = {
  email: Mail,
  sms: MessageSquare,
  call: Phone,
};

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  call: "Call",
};

export default function DripSequencesPage() {
  useDocumentTitle("Drip sequences");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const searchId = useId();

  const { data, isLoading, error, refetch } = useQuery<{ sequences: Sequence[] }>({
    queryKey: ["/api/sequences"],
    queryFn: async () => {
      const res = await fetch("/api/sequences", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load sequences (${res.status})`);
      const j = await res.json();
      if (Array.isArray(j)) return { sequences: j as Sequence[] };
      if (Array.isArray(j?.sequences)) return j as { sequences: Sequence[] };
      if (Array.isArray(j?.data)) return { sequences: j.data as Sequence[] };
      return { sequences: [] };
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/sequences/${id}/pause`),
    onSuccess: () => {
      toast({ title: "Sequence paused." });
      qc.invalidateQueries({ queryKey: ["/api/sequences"] });
    },
    onError: () =>
      toast({
        title: "Couldn't pause sequence",
        description: "The sequence is still active and enrolled leads will continue to receive messages.",
        variant: "destructive",
      }),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/sequences/${id}/resume`),
    onSuccess: () => {
      toast({ title: "Sequence resumed." });
      qc.invalidateQueries({ queryKey: ["/api/sequences"] });
    },
    onError: () =>
      toast({
        title: "Couldn't resume sequence",
        description: "The sequence is still paused and no messages will be sent.",
        variant: "destructive",
      }),
  });

  const sequences = (data?.sequences ?? []).filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalEnrolled = sequences.reduce((s, seq) => s + seq.enrolledCount, 0);
  const totalCompleted = sequences.reduce((s, seq) => s + seq.completedCount, 0);

  return (
    <PageShell>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-drip-sequences-title">
            Drip sequences
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Automated multi-step outreach sequences for leads and prospects.
          </p>
        </div>
        <Button asChild className="min-h-11">
          <Link href="/sequences/new">
            <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> New sequence
          </Link>
        </Button>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Total enrolled</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">{totalEnrolled.toLocaleString()}</dd>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <dt className="flex items-center gap-2 text-muted-foreground mb-1">
              <BarChart3 className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs">Avg completion</span>
            </dt>
            <dd className="text-2xl font-bold tabular-nums">
              {totalEnrolled > 0
                ? `${Math.round((totalCompleted / totalEnrolled) * 100)}%`
                : "—"}
            </dd>
          </CardContent>
        </Card>
      </dl>

      <div>
        <Label htmlFor={searchId} className="sr-only">Search sequences</Label>
        <Input
          id={searchId}
          type="search"
          placeholder="Search sequences…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-xs"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {isLoading ? (
        <div aria-busy="true" aria-label="Loading sequences">
          <SkeletonList items={4} showAvatar={false} showBadge />
        </div>
      ) : error ? (
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Couldn't load sequences"
        />
      ) : sequences.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={search ? "No matching sequences" : "No drip sequences yet"}
          description={
            search
              ? "No sequences match your search. Try a broader term, or clear the filter."
              : "Drip sequences send a series of emails, texts, or call tasks on a schedule — perfect for warming cold leads or onboarding new buyers."
          }
          actionLabel={search ? undefined : "Create your first sequence"}
          onAction={search ? undefined : () => { window.location.assign("/drip-sequences/new"); }}
          tips={search ? undefined : [
            "Three steps over two weeks works well for cold lead nurture.",
            "Mix channels — email + SMS lifts response rates 30%+.",
          ]}
          testId="drip-sequences-empty"
        />
      ) : (
        <ul className="space-y-2" aria-label="Drip sequences">
          {sequences.map(seq => {
            const completionRate = seq.enrolledCount > 0
              ? Math.round((seq.completedCount / seq.enrolledCount) * 100)
              : 0;

            return (
              <li key={seq.id}>
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="space-y-2 flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{seq.name}</span>
                          <Badge
                            variant={seq.status === "active" ? "default" : seq.status === "paused" ? "secondary" : "outline"}
                            className="text-xs capitalize"
                          >
                            {seq.status}
                          </Badge>
                          <span className="text-xs text-muted-foreground tabular-nums">{seq.stepCount} steps</span>
                        </div>

                        {seq.channels.length > 0 && (
                          <ul className="flex items-center gap-2" aria-label="Channels used">
                            {seq.channels.map(ch => {
                              const Icon = CHANNEL_ICONS[ch] ?? Mail;
                              return (
                                <li key={ch}>
                                  <Icon
                                    className="w-3.5 h-3.5 text-muted-foreground"
                                    aria-label={CHANNEL_LABELS[ch] ?? ch}
                                  />
                                </li>
                              );
                            })}
                          </ul>
                        )}

                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span><Users className="w-3 h-3 inline mr-0.5" aria-hidden="true" /><span className="tabular-nums">{seq.enrolledCount}</span> enrolled</span>
                          <span><span className="tabular-nums">{seq.completedCount}</span> completed</span>
                          <span><span className="tabular-nums">{seq.unsubscribedCount}</span> unsubscribed</span>
                          <span>~<span className="tabular-nums">{seq.avgDaysDuration}</span>d avg</span>
                        </div>

                        <div>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground">Completion rate</span>
                            <span className="tabular-nums">{completionRate}%</span>
                          </div>
                          <Progress
                            value={completionRate}
                            className="h-1"
                            aria-label={`${seq.name} completion rate: ${completionRate}%`}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {seq.status === "active" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => pauseMutation.mutate(seq.id)}
                            disabled={pauseMutation.isPending}
                            className="min-h-9 min-w-9"
                            aria-label={`Pause ${seq.name}`}
                          >
                            <Pause className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        ) : seq.status === "paused" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => resumeMutation.mutate(seq.id)}
                            disabled={resumeMutation.isPending}
                            className="min-h-9 min-w-9"
                            aria-label={`Resume ${seq.name}`}
                          >
                            <Play className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          asChild
                          className="min-h-9 min-w-9"
                        >
                          <a
                            href={`/sequences/${seq.id}`}
                            aria-label={`Open ${seq.name} sequence details`}
                          >
                            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                          </a>
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PageShell>
  );
}
