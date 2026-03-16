import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Mail, MessageSquare, Phone, Plus, Play, Pause, Users, BarChart3, Loader2, ChevronRight } from "lucide-react";

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

export default function DripSequencesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ sequences: Sequence[] }>({
    queryKey: ["/api/sequences"],
    queryFn: () => fetch("/api/sequences").then(r => r.json()),
  });

  const pauseMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/sequences/${id}/pause`),
    onSuccess: () => {
      toast({ title: "Sequence paused" });
      qc.invalidateQueries({ queryKey: ["/api/sequences"] });
    },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/sequences/${id}/resume`),
    onSuccess: () => {
      toast({ title: "Sequence resumed" });
      qc.invalidateQueries({ queryKey: ["/api/sequences"] });
    },
    onError: () => toast({ title: "Failed", variant: "destructive" }),
  });

  const sequences = (data?.sequences ?? []).filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase())
  );

  const totalEnrolled = sequences.reduce((s, seq) => s + seq.enrolledCount, 0);
  const totalCompleted = sequences.reduce((s, seq) => s + seq.completedCount, 0);

  return (
    <PageShell>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-drip-sequences-title">
            Drip Sequences
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Automated multi-step outreach sequences for leads and prospects.
          </p>
        </div>
        <Button asChild>
          <a href="/sequences/new">
            <Plus className="w-4 h-4 mr-2" /> New Sequence
          </a>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="w-4 h-4" />
              <span className="text-xs">Total Enrolled</span>
            </div>
            <p className="text-2xl font-bold">{totalEnrolled.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <BarChart3 className="w-4 h-4" />
              <span className="text-xs">Avg Completion</span>
            </div>
            <p className="text-2xl font-bold">
              {totalEnrolled > 0
                ? `${Math.round((totalCompleted / totalEnrolled) * 100)}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Input
        placeholder="Search sequences..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="max-w-xs"
      />

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading sequences...
        </div>
      ) : sequences.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Mail className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">
              {search ? "No sequences match your search." : "No sequences yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sequences.map(seq => {
            const completionRate = seq.enrolledCount > 0
              ? Math.round((seq.completedCount / seq.enrolledCount) * 100)
              : 0;

            return (
              <Card key={seq.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{seq.name}</span>
                        <Badge
                          variant={seq.status === "active" ? "default" : seq.status === "paused" ? "secondary" : "outline"}
                          className="text-xs"
                        >
                          {seq.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{seq.stepCount} steps</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {seq.channels.map(ch => {
                          const Icon = CHANNEL_ICONS[ch] ?? Mail;
                          return <Icon key={ch} className="w-3.5 h-3.5 text-muted-foreground" />;
                        })}
                      </div>

                      <div className="flex gap-4 text-xs text-muted-foreground">
                        <span><Users className="w-3 h-3 inline mr-0.5" />{seq.enrolledCount} enrolled</span>
                        <span>{seq.completedCount} completed</span>
                        <span>{seq.unsubscribedCount} unsubscribed</span>
                        <span>~{seq.avgDaysDuration}d avg</span>
                      </div>

                      <div>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground">Completion Rate</span>
                          <span>{completionRate}%</span>
                        </div>
                        <Progress value={completionRate} className="h-1" />
                      </div>
                    </div>

                    <div className="flex items-center gap-1 ml-3">
                      {seq.status === "active" ? (
                        <Button size="sm" variant="outline" onClick={() => pauseMutation.mutate(seq.id)}>
                          <Pause className="w-3.5 h-3.5" />
                        </Button>
                      ) : seq.status === "paused" ? (
                        <Button size="sm" variant="outline" onClick={() => resumeMutation.mutate(seq.id)}>
                          <Play className="w-3.5 h-3.5" />
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" asChild>
                        <a href={`/sequences/${seq.id}`}>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </a>
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}
