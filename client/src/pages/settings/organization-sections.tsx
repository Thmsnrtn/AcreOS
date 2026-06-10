/**
 * Settings → Organization sections (Business goals) — extracted from the
 * settings.tsx monolith (T3 census W1-2). Behavior and test ids preserved;
 * the ad-hoc empty div upgraded to the EmptyState primitive with a
 * purposeful CTA, and query failures now render QueryErrorState with retry.
 */
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { usd } from "@/lib/format";
import { Target, Calendar, Plus, X, Loader2 } from "lucide-react";

interface GoalPayload {
  label: string;
  goalType: "deals_closed" | "notes_deployed" | "revenue_earned" | "leads_contacted";
  targetValue: string;
  periodStart: string;
  periodEnd: string;
}

const GOAL_TYPE_LABELS: Record<GoalPayload["goalType"], string> = {
  deals_closed: "Deals closed",
  notes_deployed: "Notes deployed",
  revenue_earned: "Revenue earned ($)",
  leads_contacted: "Leads contacted",
};

export function GoalsSettings() {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<GoalPayload>({
    label: "",
    goalType: "deals_closed",
    targetValue: "",
    periodStart: new Date().toISOString().slice(0, 10),
    periodEnd: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });

  const { data: goals = [], isLoading, isError, error, refetch, isRefetching } = useQuery<any[]>({
    queryKey: ["/api/goals"],
    queryFn: () => apiRequest("GET", "/api/goals").then(r => r.json()),
  });

  const createGoal = useMutation({
    mutationFn: (payload: GoalPayload) => apiRequest("POST", "/api/goals", payload).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      setShowForm(false);
      setForm({ label: "", goalType: "deals_closed", targetValue: "", periodStart: new Date().toISOString().slice(0, 10), periodEnd: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) });
      toast({ title: "Goal created", description: "Your new goal has been saved." });
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't create goal",
        description: err?.message || "Check your connection and try again — no goal was created.",
        variant: "destructive",
      }),
  });

  const deleteGoal = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/goals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: "Goal deleted" });
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't delete goal",
        description: err?.message || "Check your connection and try again — the goal still exists.",
        variant: "destructive",
      }),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5" aria-hidden="true" />
                Business goals
              </CardTitle>
              <CardDescription>Track progress toward deals, revenue, and activity targets.</CardDescription>
            </div>
            <Button
              size="sm"
              className="min-h-11 sm:min-h-9"
              onClick={() => setShowForm(v => !v)}
              variant={showForm ? "outline" : "default"}
              data-testid="button-toggle-new-goal"
            >
              {showForm ? <X className="w-4 h-4 mr-2" aria-hidden="true" /> : <Plus className="w-4 h-4 mr-2" aria-hidden="true" />}
              {showForm ? "Cancel" : "New goal"}
            </Button>
          </div>
        </CardHeader>

        {showForm && (
          <CardContent className="border-t pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2 space-y-1">
                <Label htmlFor="input-goal-label">
                  Goal label <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id="input-goal-label"
                  placeholder="e.g. Q2 deal target"
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="select-goal-type">Type</Label>
                <Select value={form.goalType} onValueChange={v => setForm(f => ({ ...f, goalType: v as GoalPayload["goalType"] }))}>
                  <SelectTrigger id="select-goal-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.entries(GOAL_TYPE_LABELS) as [GoalPayload["goalType"], string][]).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="input-goal-target">
                  Target <span className="text-destructive" aria-label="required">*</span>
                </Label>
                <Input
                  id="input-goal-target"
                  type="number"
                  min="0"
                  inputMode="decimal"
                  placeholder="e.g. 10"
                  value={form.targetValue}
                  onChange={e => setForm(f => ({ ...f, targetValue: e.target.value }))}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="input-goal-start" className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" aria-hidden="true" />Start date
                </Label>
                <Input
                  id="input-goal-start"
                  type="date"
                  value={form.periodStart}
                  onChange={e => setForm(f => ({ ...f, periodStart: e.target.value }))}
                  className="tabular-nums"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="input-goal-end" className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" aria-hidden="true" />End date
                </Label>
                <Input
                  id="input-goal-end"
                  type="date"
                  value={form.periodEnd}
                  onChange={e => setForm(f => ({ ...f, periodEnd: e.target.value }))}
                  className="tabular-nums"
                />
              </div>
              <div className="sm:col-span-2">
                <Button
                  onClick={() => createGoal.mutate(form)}
                  disabled={!form.label || !form.targetValue || createGoal.isPending}
                  className="min-h-11 sm:min-h-9"
                  data-testid="button-save-goal"
                >
                  {createGoal.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                  Save goal
                </Button>
              </div>
            </div>
          </CardContent>
        )}

        <CardContent className={showForm ? "pt-4 border-t" : ""}>
          {isLoading ? (
            <div className="space-y-3" aria-busy="true">
              {[1, 2, 3].map(i => (
                <Skeleton
                  key={i}
                  className="h-16 w-full"
                  announce={i === 1}
                  announceText="Loading your goals"
                />
              ))}
            </div>
          ) : isError ? (
            <QueryErrorState
              error={error as Error}
              onRetry={() => refetch()}
              isRetrying={isRefetching}
              compact
              title="Couldn't load your goals"
              description="Your goals are intact — this is just a display issue."
              testId="error-goals"
            />
          ) : goals.length === 0 ? (
            <EmptyState
              icon={Target}
              headline="No goals yet"
              subtitle="Set a target — deals closed, revenue earned, leads contacted — and AcreOS tracks progress automatically as you work."
              cta={{
                label: "New goal",
                onClick: () => setShowForm(true),
                "data-testid": "empty-new-goal",
              }}
              className="py-6"
              testId="empty-goals"
            />
          ) : (
            <div className="space-y-4">
              {goals.map((goal: any) => {
                const current = Number(goal.currentValue ?? 0);
                const target = Number(goal.targetValue);
                const pct = Math.min(100, Math.round((current / target) * 100));
                const isComplete = pct >= 100;
                const isRevenue = goal.goalType === "revenue_earned";
                const valueFormat = (n: number) =>
                  isRevenue ? usd(n, { noCents: true }) : n.toLocaleString();
                return (
                  <div key={goal.id} className="rounded-card border p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{goal.label}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {GOAL_TYPE_LABELS[goal.goalType as GoalPayload["goalType"]] ?? goal.goalType}
                          {" · "}
                          {new Date(goal.periodStart).toLocaleDateString()} &ndash; {new Date(goal.periodEnd).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isComplete && (
                          <Badge variant="default" className="bg-acr-pos text-white text-xs">Complete</Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 sm:h-7 sm:w-7 text-muted-foreground hover:text-destructive active:text-destructive"
                          onClick={() => deleteGoal.mutate(goal.id)}
                          disabled={deleteGoal.isPending}
                          aria-label={`Delete goal: ${goal.label}`}
                        >
                          <X className="w-3.5 h-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Progress
                        value={pct}
                        className="h-2"
                        aria-label={`${goal.label}: ${pct}% complete (${valueFormat(current)} of ${valueFormat(target)})`}
                      />
                      <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                        <span>{valueFormat(current)} / {valueFormat(target)}</span>
                        <span className={isComplete ? "text-acr-pos font-semibold" : ""}>{pct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
