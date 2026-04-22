/**
 * FounderExperimentsPage — decision-level A/B testing surface.
 *
 * Founder creates experiments that split how agents decide across
 * variants for different orgs. Running experiments show live stats;
 * completed ones show the winner + founder notes.
 *
 * This is the empirical learning layer — different from prompt
 * evolution (gradient) because it deliberately tries two ways to see
 * which wins, rather than tweaking based on past outcomes.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FlaskConical, Play, Pause, CheckCircle2, XCircle, Plus } from "lucide-react";
import { relative } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";

interface Experiment {
  id: number;
  name: string;
  description: string;
  category: string;
  itemType: string | null;
  variants: Array<{ key: string; label: string; weight: number; config: any }>;
  successMetric: string;
  status: "draft" | "running" | "paused" | "completed" | "aborted";
  winningVariant: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

interface ExperimentAnalysis {
  experimentId: number;
  experimentName: string;
  status: string;
  totalAssignments: number;
  totalOutcomes: number;
  variants: Array<{
    key: string;
    label: string;
    n: number;
    outcomesRecorded: number;
    meanOutcome: number | null;
    positiveCount: number;
    positiveRate: number | null;
  }>;
  leader: string | null;
  commentary: string;
}

const STATUS_COLOR: Record<Experiment["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  running: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  aborted: "bg-muted text-muted-foreground",
};

export default function FounderExperimentsPage() {
  const { data, isLoading, isError } = useQuery<{ experiments: Experiment[] }>({
    queryKey: ["/api/founder/intelligence/experiments"],
    staleTime: 30_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const op = (path: string, invalidate = true) =>
    useMutation({
      mutationFn: async (args: { id: number; body?: any }) => {
        const res = await apiRequest("POST", `/api/founder/intelligence/experiments/${args.id}/${path}`, args.body ?? {});
        return res.json();
      },
      onSuccess: () => {
        if (invalidate) qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/experiments"] });
        toast({ title: "Updated" });
      },
      onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
    });

  const startExp = op("start");
  const pauseExp = op("pause");
  const abortExp = op("abort");
  const completeExp = op("complete");

  const experiments = data?.experiments ?? [];

  return (
    <PageShell label="Experiments">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Decision experiments"
          icon={<FlaskConical className="h-5 w-5 text-muted-foreground" />}
          description="A/B test how agents decide. Each experiment hooks into a specific item type and deterministically assigns variants per org. When outcomes get graded, they roll up per variant so you can see which playbook works."
          actions={
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  New experiment
                </Button>
              </DialogTrigger>
              <CreateExperimentDialog onClose={() => setCreateOpen(false)} />
            </Dialog>
          }
        />

        {isLoading ? (
          <Card>
            <CardContent className="p-8">
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-red-600">Could not load experiments.</CardContent>
          </Card>
        ) : experiments.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="No experiments yet"
            description="Create your first experiment to split a decision playbook across variants. Example: half of past-due customers get 7-day dunning, half get 10-day — which recovers more?"
          />
        ) : (
          experiments.map((e) => (
            <ExperimentCard
              key={e.id}
              experiment={e}
              onStart={() => startExp.mutate({ id: e.id })}
              onPause={() => pauseExp.mutate({ id: e.id })}
              onAbort={() => abortExp.mutate({ id: e.id })}
              onComplete={(winningVariant, notes) =>
                completeExp.mutate({ id: e.id, body: { winningVariant, notes } })
              }
              busy={startExp.isPending || pauseExp.isPending || abortExp.isPending || completeExp.isPending}
            />
          ))
        )}
      </div>
    </PageShell>
  );
}

function ExperimentCard({
  experiment,
  onStart,
  onPause,
  onAbort,
  onComplete,
  busy,
}: {
  experiment: Experiment;
  onStart: () => void;
  onPause: () => void;
  onAbort: () => void;
  onComplete: (winner: string, notes?: string) => void;
  busy: boolean;
}) {
  const { data: analysis } = useQuery<ExperimentAnalysis>({
    queryKey: [`/api/founder/intelligence/experiments/${experiment.id}`],
    enabled: experiment.status === "running" || experiment.status === "paused" || experiment.status === "completed",
    staleTime: 30_000,
  });
  const [notes, setNotes] = useState("");

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <Badge className={`text-[10px] ${STATUS_COLOR[experiment.status]}`}>{experiment.status}</Badge>
              <Badge variant="outline" className="text-[10px]">{experiment.category}</Badge>
              {experiment.itemType && (
                <Badge variant="outline" className="text-[10px]">
                  {experiment.itemType}
                </Badge>
              )}
              {experiment.winningVariant && (
                <Badge variant="secondary" className="text-[10px]">
                  Winner: {experiment.winningVariant}
                </Badge>
              )}
              <span className="text-[10px] text-muted-foreground">
                {relative(experiment.createdAt)}
              </span>
            </div>
            <CardTitle className="text-base">{experiment.name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{experiment.description}</p>
          </div>
          <div className="flex items-center gap-2">
            {experiment.status === "draft" && (
              <Button size="sm" onClick={onStart} disabled={busy}>
                <Play className="h-4 w-4 mr-1" />
                Start
              </Button>
            )}
            {experiment.status === "running" && (
              <>
                <Button size="sm" variant="outline" onClick={onPause} disabled={busy}>
                  <Pause className="h-4 w-4 mr-1" />
                  Pause
                </Button>
              </>
            )}
            {experiment.status === "paused" && (
              <Button size="sm" onClick={onStart} disabled={busy}>
                <Play className="h-4 w-4 mr-1" />
                Resume
              </Button>
            )}
            {(experiment.status === "running" || experiment.status === "paused") && (
              <Button size="sm" variant="ghost" onClick={onAbort} disabled={busy}>
                <XCircle className="h-4 w-4 mr-1" />
                Abort
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2">
          {experiment.variants.map((v) => {
            const stat = analysis?.variants.find((x) => x.key === v.key);
            const isLeader = analysis?.leader === v.key;
            return (
              <div
                key={v.key}
                className={`border rounded p-3 ${isLeader ? "border-emerald-400 dark:border-emerald-700 bg-emerald-50/40 dark:bg-emerald-950/20" : "border-border"}`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-medium">
                      {v.label}{" "}
                      <span className="text-[11px] text-muted-foreground font-mono">({v.key})</span>
                      {isLeader && <span className="text-[10px] text-emerald-600 ml-2">leader</span>}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Weight: {v.weight}%
                    </p>
                  </div>
                  {stat && (
                    <div className="text-right text-[11px] text-muted-foreground">
                      <div>n = {stat.n}, graded = {stat.outcomesRecorded}</div>
                      {stat.meanOutcome != null && <div>mean {stat.meanOutcome}</div>}
                      {stat.positiveRate != null && <div>+ rate {stat.positiveRate}%</div>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {analysis && (
          <p className="text-xs text-muted-foreground italic">{analysis.commentary}</p>
        )}
        {experiment.status === "running" && analysis?.leader && (
          <div className="flex items-end gap-2">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Founder notes on the winner (optional)"
              className="text-xs h-14 flex-1"
            />
            <Button size="sm" onClick={() => onComplete(analysis.leader!, notes || undefined)} disabled={busy}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Complete, promote leader
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CreateExperimentDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "dunning",
    itemType: "dunning_recovery",
    variantLabels: "Variant A|Variant B",
    successMetric: "outcome_score_positive",
  });

  const create = useMutation({
    mutationFn: async () => {
      const labels = form.variantLabels.split("|").map((s) => s.trim()).filter(Boolean);
      if (labels.length < 2) throw new Error("Need at least 2 variant labels separated by |");
      const weight = Math.floor(100 / labels.length);
      const variants = labels.map((label, i) => ({
        key: label.toLowerCase().replace(/\s+/g, "_"),
        label,
        weight: i === labels.length - 1 ? 100 - weight * (labels.length - 1) : weight,
        config: {},
      }));
      const res = await apiRequest("POST", "/api/founder/intelligence/experiments", {
        name: form.name,
        description: form.description,
        category: form.category,
        itemType: form.itemType,
        variants,
        successMetric: form.successMetric,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/experiments"] });
      toast({ title: "Experiment created", description: "It's in draft — press Start to begin." });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>New experiment</DialogTitle>
        <DialogDescription>
          Define a test that splits how agents decide for different orgs. Even weights across
          variants; fine-tune after.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-muted-foreground">Name</label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Description</label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="h-20"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Category</label>
            <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Item type hook</label>
            <Input value={form.itemType} onChange={(e) => setForm({ ...form, itemType: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Variants (pipe-separated labels)</label>
          <Input
            value={form.variantLabels}
            onChange={(e) => setForm({ ...form, variantLabels: e.target.value })}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => create.mutate()} disabled={create.isPending || !form.name}>
          {create.isPending ? "Creating…" : "Create"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
