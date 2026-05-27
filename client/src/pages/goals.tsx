import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { usd } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Target,
  TrendingUp,
  DollarSign,
  Home,
  Users,
  Plus,
  Trash2,
  Clock,
  Trophy,
  Loader2,
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Verbs } from "@/lib/labels";
import { SkeletonCard } from "@/components/ui/skeleton-card";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";

interface Goal {
  id: number;
  name: string;
  category: string;
  targetValue: string;
  currentValue: string;
  unit: string;
  deadline?: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_CONFIG = {
  revenue: { label: "Revenue", icon: DollarSign, color: "text-acr-pos", bg: "bg-acr-pos-soft dark:bg-acr-pos-soft/20" },
  deals: { label: "Deals", icon: TrendingUp, color: "text-acr-accent", bg: "bg-acr-accent dark:bg-acr-accent/20" },
  leads: { label: "Leads", icon: Users, color: "text-acr-accent", bg: "bg-acr-accent dark:bg-acr-accent/20" },
  properties: { label: "Properties", icon: Home, color: "text-acr-warn", bg: "bg-acr-warn-soft dark:bg-acr-warn-soft/20" },
  custom: { label: "Custom", icon: Target, color: "text-muted-foreground", bg: "bg-muted dark:bg-acr-bg-sunken/20" },
};

function getGoalStatus(goal: Goal) {
  const current = parseFloat(goal.currentValue || "0");
  const target = parseFloat(goal.targetValue || "1");
  const pct = Math.min(100, (current / target) * 100);
  const now = new Date();
  const deadline = goal.deadline ? new Date(goal.deadline) : null;
  const daysLeft = deadline ? differenceInDays(deadline, now) : null;

  if (pct >= 100) return { status: "completed", label: "Completed", color: "text-acr-pos", badgeVariant: "default" as const };
  if (daysLeft !== null && daysLeft < 0) return { status: "overdue", label: "Overdue", color: "text-acr-neg", badgeVariant: "destructive" as const };
  if (daysLeft !== null && daysLeft <= 7) return { status: "urgent", label: `${daysLeft}d left`, color: "text-acr-warn", badgeVariant: "secondary" as const };
  return { status: "active", label: "In progress", color: "text-acr-accent", badgeVariant: "outline" as const };
}

function fmt(val: string | number, unit?: string): string {
  const n = parseFloat(val?.toString() || "0");
  if (unit === "dollars" || unit === "$") {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
    return usd(n, { noCents: Number.isInteger(n) });
  }
  return `${n.toLocaleString()} ${unit || ""}`.trim();
}

export default function GoalsPage() {
  useDocumentTitle("Goals & OKRs");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [goalToDelete, setGoalToDelete] = useState<Goal | null>(null);
  const [newGoal, setNewGoal] = useState({
    name: "",
    category: "revenue",
    targetValue: "",
    unit: "dollars",
    deadline: "",
  });
  const nameId = useId();
  const categoryId = useId();
  const unitId = useId();
  const targetId = useId();
  const deadlineId = useId();

  const { data, isLoading, error, refetch } = useQuery<{ goals: Goal[] }>({
    queryKey: ["/api/goals"],
    queryFn: async () => {
      const res = await fetch("/api/goals", { credentials: "include" });
      if (!res.ok) throw new Error(`Failed to load goals (${res.status})`);
      const j = await res.json();
      if (Array.isArray(j)) return { goals: j as Goal[] };
      if (Array.isArray(j?.goals)) return j as { goals: Goal[] };
      if (Array.isArray(j?.data)) return { goals: j.data as Goal[] };
      return { goals: [] };
    },
  });

  const createMutation = useMutation({
    mutationFn: (body: typeof newGoal) =>
      apiRequest("POST", "/api/goals", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      setCreateOpen(false);
      setNewGoal({ name: "", category: "revenue", targetValue: "", unit: "dollars", deadline: "" });
      toast({ title: "Goal created", description: "Your new goal is being tracked." });
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't create goal",
        description: `${err.message} — no goal was created. Check your input and try again.`,
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/goals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: "Goal removed." });
      setGoalToDelete(null);
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't remove goal",
        description: `${err.message} — the goal is still being tracked.`,
        variant: "destructive",
      }),
  });

  const goals = data?.goals || [];
  const completedCount = goals.filter(g => parseFloat(g.currentValue || "0") >= parseFloat(g.targetValue || "1")).length;
  const totalTargetRevenue = goals
    .filter(g => g.category === "revenue")
    .reduce((s, g) => s + parseFloat(g.targetValue || "0"), 0);
  const currentRevenue = goals
    .filter(g => g.category === "revenue")
    .reduce((s, g) => s + parseFloat(g.currentValue || "0"), 0);

  return (
    <PageShell>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Goals &amp; OKRs</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track your organizational objectives and key results.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="min-h-11">
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
          New goal
        </Button>
      </div>
      {/* Summary cards */}
      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-card bg-acr-accent dark:bg-acr-accent/20" aria-hidden="true">
                <Target className="h-5 w-5 text-acr-accent" />
              </div>
              <div>
                <dd className="text-2xl font-bold tabular-nums">{goals.length}</dd>
                <dt className="text-sm text-muted-foreground">Active goals</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-card bg-acr-pos-soft dark:bg-acr-pos-soft/20" aria-hidden="true">
                <Trophy className="h-5 w-5 text-acr-pos" />
              </div>
              <div>
                <dd className="text-2xl font-bold tabular-nums">{completedCount}</dd>
                <dt className="text-sm text-muted-foreground">Goals completed</dt>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-card bg-acr-warn-soft dark:bg-acr-warn-soft/20" aria-hidden="true">
                <DollarSign className="h-5 w-5 text-acr-warn" />
              </div>
              <div>
                <dd className="text-2xl font-bold tabular-nums">{totalTargetRevenue > 0 ? Math.round((currentRevenue / totalTargetRevenue) * 100) : 0}%</dd>
                <dt className="text-sm text-muted-foreground">Revenue on track</dt>
              </div>
            </div>
          </CardContent>
        </Card>
      </dl>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-busy="true" aria-label="Loading goals">
          <SkeletonCard lines={2} showFooter />
          <SkeletonCard lines={2} showFooter />
          <SkeletonCard lines={2} showFooter />
          <SkeletonCard lines={2} showFooter />
        </div>
      ) : error ? (
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Couldn't load goals"
        />
      ) : goals.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No goals yet"
          description="Set revenue targets, deal counts, and other KPIs to track your progress over time."
          actionLabel="Create your first goal"
          onAction={() => setCreateOpen(true)}
          tips={[
            "Tie revenue goals to a deadline to see weekly pace.",
            "Mix outcome goals (closed deals) with leading-indicator goals (offers sent).",
          ]}
          testId="goals-empty"
        />
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="Your goals">
          {goals.map(goal => {
            const cfg = CATEGORY_CONFIG[goal.category as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.custom;
            const Icon = cfg.icon;
            const current = parseFloat(goal.currentValue || "0");
            const target = parseFloat(goal.targetValue || "1");
            const pct = Math.min(100, Math.round((current / target) * 100));
            const { label, color, badgeVariant } = getGoalStatus(goal);

            return (
              <li key={goal.id}>
                <Card className="relative">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`p-2 rounded-card ${cfg.bg}`} aria-hidden="true">
                          <Icon className={`h-4 w-4 ${cfg.color}`} />
                        </div>
                        <div>
                          <CardTitle className="text-base">{goal.name}</CardTitle>
                          <CardDescription className="text-xs">{cfg.label}</CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={badgeVariant}>{label}</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 min-h-9 min-w-9"
                          onClick={() => setGoalToDelete(goal)}
                          aria-label={`Delete goal: ${goal.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="flex items-end justify-between">
                        <div>
                          <span className="text-2xl font-bold tabular-nums">{fmt(current, goal.unit)}</span>
                          <span className="text-muted-foreground text-sm ml-1 tabular-nums">/ {fmt(target, goal.unit)}</span>
                        </div>
                        <span className={`text-lg font-semibold tabular-nums ${color}`}>{pct}%</span>
                      </div>
                      <Progress
                        value={pct}
                        className="h-2"
                        aria-label={`${goal.name}: ${pct}% of ${fmt(target, goal.unit)} target`}
                      />
                      {goal.deadline && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" aria-hidden="true" />
                          <span className="tabular-nums">Deadline: {format(new Date(goal.deadline), "MMM d, yyyy")}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* Create Goal Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create new goal</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4 py-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (createMutation.isPending || !newGoal.name || !newGoal.targetValue) return;
              createMutation.mutate(newGoal);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor={nameId}>
                Goal name <span className="text-destructive" aria-label="required">*</span>
              </Label>
              <Input
                id={nameId}
                placeholder="e.g., Close 10 deals this quarter"
                value={newGoal.name}
                onChange={e => setNewGoal(g => ({ ...g, name: e.target.value }))}
                autoCapitalize="sentences"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={categoryId}>Category</Label>
                <Select value={newGoal.category} onValueChange={v => setNewGoal(g => ({ ...g, category: v }))}>
                  <SelectTrigger id={categoryId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_CONFIG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={unitId}>Unit</Label>
                <Select value={newGoal.unit} onValueChange={v => setNewGoal(g => ({ ...g, unit: v }))}>
                  <SelectTrigger id={unitId}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dollars">Dollars ($)</SelectItem>
                    <SelectItem value="deals">Deals</SelectItem>
                    <SelectItem value="leads">Leads</SelectItem>
                    <SelectItem value="properties">Properties</SelectItem>
                    <SelectItem value="units">Units</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor={targetId}>
                  Target value <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id={targetId}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  placeholder="100000"
                  value={newGoal.targetValue}
                  onChange={e => setNewGoal(g => ({ ...g, targetValue: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={deadlineId}>Deadline (optional)</Label>
                <Input
                  id={deadlineId}
                  type="date"
                  value={newGoal.deadline}
                  onChange={e => setNewGoal(g => ({ ...g, deadline: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setCreateOpen(false)}>{Verbs.CANCEL}</Button>
              <Button
                type="submit"
                className="min-h-11"
                disabled={!newGoal.name || !newGoal.targetValue || createMutation.isPending}
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : null}
                Create goal
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!goalToDelete}
        onOpenChange={(open) => !open && setGoalToDelete(null)}
        title={goalToDelete ? `Delete "${goalToDelete.name}"?` : "Delete goal?"}
        description="This removes the goal and its progress history. Your underlying data (leads, deals, revenue) is unchanged."
        confirmLabel="Delete goal"
        variant="destructive"
        onConfirm={() => {
          if (goalToDelete) deleteMutation.mutate(goalToDelete.id);
        }}
      />
    </PageShell>
  );
}
