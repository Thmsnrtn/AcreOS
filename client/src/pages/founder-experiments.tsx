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

import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
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
import { useDocumentTitle } from "@/hooks/use-document-title";
import { FlaskConical, Play, Pause, CheckCircle2, XCircle, Plus } from "lucide-react";
import { relative } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Verbs } from "@/lib/labels";

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

// Experiment status → semantic --acr-* tone (Tier 1 pattern).
const STATUS_COLOR: Record<Experiment["status"], string> = {
  draft: "bg-acr-surface-2 text-acr-ink-3 border-transparent",
  running: "bg-acr-pos-soft text-acr-pos-soft-ink border-transparent",
  paused: "bg-acr-warn-soft text-acr-warn-soft-ink border-transparent",
  completed: "bg-acr-brand-soft text-acr-brand-soft-ink border-transparent",
  aborted: "bg-acr-surface-2 text-acr-ink-3 border-transparent",
};

const ACTION_REASSURANCE: Record<string, string> = {
  start: "The experiment is still in draft — try again.",
  pause: "The experiment is still running — try again.",
  abort: "The experiment is still running — try again.",
  complete: "The experiment is unchanged — try again.",
};

export default function FounderExperimentsPage() {
  useDocumentTitle("Decision experiments");
  const { data, isLoading, isError, refetch } = useQuery<{ experiments: Experiment[] }>({
    queryKey: ["/api/founder/intelligence/experiments"],
    staleTime: 30_000,
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingAbort, setPendingAbort] = useState<Experiment | null>(null);

  // Single useMutation handler that knows which path was used. Lifts the
  // mutation out of a per-render call site to obey Rules of Hooks.
  const opMutation = useMutation({
    mutationFn: async (args: { id: number; path: string; body?: any }) => {
      const res = await apiRequest("POST", `/api/founder/intelligence/experiments/${args.id}/${args.path}`, args.body ?? {});
      return res.json();
    },
    onSuccess: (_, args) => {
      qc.invalidateQueries({ queryKey: ["/api/founder/intelligence/experiments"] });
      toast({ title: `Experiment ${args.path}d` });
    },
    onError: (e: Error, args) =>
      toast({
        title: `Couldn't ${args.path} experiment`,
        description: `${e.message}. ${ACTION_REASSURANCE[args.path] ?? "Try again."}`,
        variant: "destructive",
      }),
  });

  const experiments = data?.experiments ?? [];
  const isBusy = opMutation.isPending;

  return (
    <PageShell label="Experiments">
      <div className="space-y-6 max-w-5xl mx-auto">
        <PageHeader
          title="Decision experiments"
          icon={<FlaskConical className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
          description="A/B test how agents decide. Each experiment hooks into a specific item type and deterministically assigns variants per org. When outcomes get graded, they roll up per variant so you can see which playbook works."
          actions={
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm" aria-label="Create new experiment">
                  <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
                  New experiment
                </Button>
              </DialogTrigger>
              <CreateExperimentDialog onClose={() => setCreateOpen(false)} />
            </Dialog>
          }
        />

        {isLoading ? (
          <Card>
            <CardContent className="p-8" role="status" aria-live="polite">
              <span className="sr-only">Loading experiments…</span>
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ) : isError ? (
          <Card>
            <CardContent className="p-6 text-sm text-acr-neg" role="alert">
              Couldn't load experiments. The experiment list is unchanged —{" "}
              <button
                type="button"
                className="underline hover:no-underline"
                onClick={() => refetch()}
              >
                try again
              </button>.
            </CardContent>
          </Card>
        ) : experiments.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            headline="No experiments yet"
            subtitle="Create your first experiment to split a decision playbook across variants. Example: half of past-due customers get 7-day dunning, half get 10-day — which recovers more?"
            // TODO(cta): experiments are created from the agent chat or the founder config panel — no inline create here yet
            cta={{ label: "", _noOp: true }}
          />
        ) : (
          <ul className="space-y-4" aria-label="Decision experiments">
            {experiments.map((e) => (
              <li key={e.id}>
                <ExperimentCard
                  experiment={e}
                  onStart={() => opMutation.mutate({ id: e.id, path: "start" })}
                  onPause={() => opMutation.mutate({ id: e.id, path: "pause" })}
                  onAbort={() => setPendingAbort(e)}
                  onComplete={(winningVariant, notes) =>
                    opMutation.mutate({ id: e.id, path: "complete", body: { winningVariant, notes } })
                  }
                  busy={isBusy}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!pendingAbort}
        onOpenChange={(open) => { if (!open) setPendingAbort(null); }}
        title={`Abort experiment "${pendingAbort?.name ?? ""}"?`}
        description={
          pendingAbort
            ? `Stops collecting outcomes for "${pendingAbort.name}" immediately. The data already collected is kept in the audit log, but no winner is promoted. You can't resume an aborted experiment — you'd need to clone it as a new draft.`
            : ""
        }
        confirmLabel="Yes, abort"
        variant="destructive"
        isLoading={opMutation.isPending}
        onConfirm={() => {
          if (pendingAbort) {
            opMutation.mutate({ id: pendingAbort.id, path: "abort" });
            setPendingAbort(null);
          }
        }}
      />
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
  const notesId = useId();
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
              <Badge className={`text-micro capitalize ${STATUS_COLOR[experiment.status]}`}>{experiment.status}</Badge>
              <Badge variant="outline" className="text-micro">{experiment.category}</Badge>
              {experiment.itemType && (
                <Badge variant="outline" className="text-micro">
                  {experiment.itemType}
                </Badge>
              )}
              {experiment.winningVariant && (
                <Badge variant="secondary" className="text-micro">
                  Winner: {experiment.winningVariant}
                </Badge>
              )}
              <span className="text-micro text-muted-foreground tabular-nums">
                {relative(experiment.createdAt)}
              </span>
            </div>
            <CardTitle className="text-base">{experiment.name}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{experiment.description}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {experiment.status === "draft" && (
              <Button size="sm" onClick={onStart} disabled={busy} aria-label={`Start experiment "${experiment.name}"`}>
                <Play className="h-4 w-4 mr-1" aria-hidden="true" />
                Start
              </Button>
            )}
            {experiment.status === "running" && (
              <Button size="sm" variant="outline" onClick={onPause} disabled={busy} aria-label={`Pause experiment "${experiment.name}"`}>
                <Pause className="h-4 w-4 mr-1" aria-hidden="true" />
                Pause
              </Button>
            )}
            {experiment.status === "paused" && (
              <Button size="sm" onClick={onStart} disabled={busy} aria-label={`Resume experiment "${experiment.name}"`}>
                <Play className="h-4 w-4 mr-1" aria-hidden="true" />
                Resume
              </Button>
            )}
            {(experiment.status === "running" || experiment.status === "paused") && (
              <Button size="sm" variant="ghost" onClick={onAbort} disabled={busy} aria-label={`Abort experiment "${experiment.name}"`}>
                <XCircle className="h-4 w-4 mr-1" aria-hidden="true" />
                Abort
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="grid gap-2" aria-label="Experiment variants">
          {experiment.variants.map((v) => {
            const stat = analysis?.variants.find((x) => x.key === v.key);
            const isLeader = analysis?.leader === v.key;
            return (
              <li
                key={v.key}
                className={`border rounded p-3 ${isLeader ? "border-acr-pos/30 bg-acr-pos-soft" : "border-border"}`}
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-sm font-medium">
                      {v.label}{" "}
                      <span className="text-caption text-muted-foreground font-mono">({v.key})</span>
                      {isLeader && <span className="text-micro text-acr-pos ml-2" aria-label="Leading variant">leader</span>}
                    </p>
                    <p className="text-caption text-muted-foreground tabular-nums">
                      Weight: {v.weight}%
                    </p>
                  </div>
                  {stat && (
                    <dl className="text-right text-caption text-muted-foreground">
                      <div className="tabular-nums">n = {stat.n}, graded = {stat.outcomesRecorded}</div>
                      {stat.meanOutcome != null && <div className="tabular-nums">mean {stat.meanOutcome}</div>}
                      {stat.positiveRate != null && <div className="tabular-nums">+ rate {stat.positiveRate}%</div>}
                    </dl>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {analysis && (
          <p className="text-xs text-muted-foreground italic">{analysis.commentary}</p>
        )}
        {experiment.status === "running" && analysis?.leader && (
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <Label htmlFor={notesId} className="sr-only">Founder notes on the winner</Label>
              <Textarea
                id={notesId}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Founder notes on the winner (optional)"
                className="text-xs h-14"
              />
            </div>
            <Button
              size="sm"
              onClick={() => onComplete(analysis.leader!, notes || undefined)}
              disabled={busy}
              aria-label={`Complete experiment "${experiment.name}" and promote ${analysis.leader} as winner`}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" aria-hidden="true" />
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
  const nameId = useId();
  const descId = useId();
  const categoryId = useId();
  const itemTypeId = useId();
  const variantsId = useId();
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
    onError: (e: Error) =>
      toast({
        title: "Couldn't create experiment",
        description: `${e.message}. Your inputs are unchanged — try again.`,
        variant: "destructive",
      }),
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
      <form
        onSubmit={(e) => { e.preventDefault(); if (form.name) create.mutate(); }}
        className="space-y-3"
      >
        <div>
          <Label htmlFor={nameId}>Name</Label>
          <Input id={nameId} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoCapitalize="sentences" />
        </div>
        <div>
          <Label htmlFor={descId}>Description</Label>
          <Textarea
            id={descId}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="h-20"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor={categoryId}>Category</Label>
            <Input id={categoryId} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={itemTypeId}>Item type hook</Label>
            <Input id={itemTypeId} value={form.itemType} onChange={(e) => setForm({ ...form, itemType: e.target.value })} />
          </div>
        </div>
        <div>
          <Label htmlFor={variantsId}>Variants <span className="text-muted-foreground font-normal">(pipe-separated labels)</span></Label>
          <Input
            id={variantsId}
            value={form.variantLabels}
            onChange={(e) => setForm({ ...form, variantLabels: e.target.value })}
            placeholder="Variant A|Variant B"
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{Verbs.CANCEL}</Button>
          <Button type="submit" disabled={create.isPending || !form.name}>
            {create.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
