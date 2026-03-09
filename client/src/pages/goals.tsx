import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
  CheckCircle2,
  Clock,
  AlertCircle,
  Trophy,
  Loader2,
} from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  revenue: { label: "Revenue", icon: DollarSign, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-900/20" },
  deals: { label: "Deals", icon: TrendingUp, color: "text-blue-600", bg: "bg-blue-50 dark:bg-blue-900/20" },
  leads: { label: "Leads", icon: Users, color: "text-violet-600", bg: "bg-violet-50 dark:bg-violet-900/20" },
  properties: { label: "Properties", icon: Home, color: "text-amber-600", bg: "bg-amber-50 dark:bg-amber-900/20" },
  custom: { label: "Custom", icon: Target, color: "text-gray-600", bg: "bg-gray-50 dark:bg-gray-900/20" },
};

function getGoalStatus(goal: Goal) {
  const current = parseFloat(goal.currentValue || "0");
  const target = parseFloat(goal.targetValue || "1");
  const pct = Math.min(100, (current / target) * 100);
  const now = new Date();
  const deadline = goal.deadline ? new Date(goal.deadline) : null;
  const daysLeft = deadline ? differenceInDays(deadline, now) : null;

  if (pct >= 100) return { status: "completed", label: "Completed", color: "text-emerald-600", badgeVariant: "default" as const };
  if (daysLeft !== null && daysLeft < 0) return { status: "overdue", label: "Overdue", color: "text-red-600", badgeVariant: "destructive" as const };
  if (daysLeft !== null && daysLeft <= 7) return { status: "urgent", label: `${daysLeft}d left`, color: "text-amber-600", badgeVariant: "secondary" as const };
  return { status: "active", label: "In Progress", color: "text-blue-600", badgeVariant: "outline" as const };
}

function fmt(val: string | number, unit?: string): string {
  const n = parseFloat(val?.toString() || "0");
  if (unit === "dollars" || unit === "$") {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
    return `$${n.toLocaleString()}`;
  }
  return `${n.toLocaleString()} ${unit || ""}`.trim();
}

export default function GoalsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newGoal, setNewGoal] = useState({
    name: "",
    category: "revenue",
    targetValue: "",
    unit: "dollars",
    deadline: "",
  });

  const { data, isLoading } = useQuery<{ goals: Goal[] }>({
    queryKey: ["/api/goals"],
    queryFn: () => fetch("/api/goals").then(r => r.json()),
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
    onError: (err: any) => toast({ title: "Failed to create goal", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/goals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: "Goal removed" });
    },
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Goals & OKRs</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Track your organizational objectives and key results</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Goal
        </Button>
      </div>
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
                <Target className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{goals.length}</p>
                <p className="text-sm text-muted-foreground">Active Goals</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
                <Trophy className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{completedCount}</p>
                <p className="text-sm text-muted-foreground">Goals Completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
                <DollarSign className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalTargetRevenue > 0 ? Math.round((currentRevenue / totalTargetRevenue) * 100) : 0}%</p>
                <p className="text-sm text-muted-foreground">Revenue on Track</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : goals.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No goals yet</h3>
            <p className="text-muted-foreground mb-4">Set revenue targets, deal counts, and other KPIs to track your progress.</p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Goal
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map(goal => {
            const cfg = CATEGORY_CONFIG[goal.category as keyof typeof CATEGORY_CONFIG] || CATEGORY_CONFIG.custom;
            const Icon = cfg.icon;
            const current = parseFloat(goal.currentValue || "0");
            const target = parseFloat(goal.targetValue || "1");
            const pct = Math.min(100, Math.round((current / target) * 100));
            const { status, label, color, badgeVariant } = getGoalStatus(goal);

            return (
              <Card key={goal.id} className="relative">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`p-2 rounded-lg ${cfg.bg}`}>
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
                        className="h-7 w-7"
                        onClick={() => deleteMutation.mutate(goal.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-end justify-between">
                      <div>
                        <span className="text-2xl font-bold">{fmt(current, goal.unit)}</span>
                        <span className="text-muted-foreground text-sm ml-1">/ {fmt(target, goal.unit)}</span>
                      </div>
                      <span className={`text-lg font-semibold ${color}`}>{pct}%</span>
                    </div>
                    <Progress value={pct} className="h-2" />
                    {goal.deadline && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>Deadline: {format(new Date(goal.deadline), "MMM d, yyyy")}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Goal Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Goal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Goal Name</Label>
              <Input
                placeholder="e.g., Close 10 deals this quarter"
                value={newGoal.name}
                onChange={e => setNewGoal(g => ({ ...g, name: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={newGoal.category} onValueChange={v => setNewGoal(g => ({ ...g, category: v }))}>
                  <SelectTrigger>
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
                <Label>Unit</Label>
                <Select value={newGoal.unit} onValueChange={v => setNewGoal(g => ({ ...g, unit: v }))}>
                  <SelectTrigger>
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
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Target Value</Label>
                <Input
                  type="number"
                  placeholder="100000"
                  value={newGoal.targetValue}
                  onChange={e => setNewGoal(g => ({ ...g, targetValue: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Deadline (optional)</Label>
                <Input
                  type="date"
                  value={newGoal.deadline}
                  onChange={e => setNewGoal(g => ({ ...g, deadline: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(newGoal)}
              disabled={!newGoal.name || !newGoal.targetValue || createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
