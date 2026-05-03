import { useId, useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useDocumentTitle } from '@/hooks/use-document-title';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Users,
  CheckCircle,
  Clock,
  TrendingUp,
  List,
  Calendar,
  GitBranch,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';

const PIE_COLORS = ['#d97541', '#4f8ef7', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];

const TASK_CATEGORIES = [
  'research',
  'outreach',
  'data_entry',
  'document_prep',
  'follow_up',
  'marketing',
  'admin',
  'other',
];

const reassurance = "Your workflow draft is still in the form — try again.";

function MetricCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="text-2xl font-bold mt-0.5 tabular-nums">{value}</dd>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="text-muted-foreground" aria-hidden="true">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function GaugeRing({ value }: { value: number }) {
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (value / 100) * circumference;
  const color =
    value >= 80 ? '#10b981' : value >= 60 ? '#f59e0b' : '#ef4444';
  const tier = value >= 80 ? 'strong' : value >= 60 ? 'moderate' : 'needs improvement';

  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        width="120"
        height="120"
        viewBox="0 0 120 120"
        role="img"
        aria-label={`Success rate: ${value} percent (${tier})`}
      >
        <circle cx="60" cy="60" r="45" fill="none" stroke="currentColor" strokeWidth="12" className="text-muted/30" />
        <circle
          cx="60"
          cy="60"
          r="45"
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 60 60)"
        />
        <text x="60" y="65" textAnchor="middle" fontSize="22" fontWeight="bold" fill={color}>
          {value}%
        </text>
      </svg>
      <p className="text-xs text-muted-foreground">Success rate</p>
    </div>
  );
}

interface WorkflowStep {
  title: string;
  category: string;
  description: string;
  estimatedMinutes: number;
}

export default function VADashboardPage() {
  useDocumentTitle("VA dashboard");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [wfName, setWfName] = useState('');
  const [wfDescription, setWfDescription] = useState('');
  const [wfSteps, setWfSteps] = useState<WorkflowStep[]>([
    { title: '', category: 'research', description: '', estimatedMinutes: 30 },
  ]);
  const wfNameId = useId();
  const wfDescId = useId();

  const { data: metricsData } = useQuery({
    queryKey: ['va', 'metrics', 'week'],
    queryFn: async () => {
      const res = await fetch('/api/va/metrics?period=week', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch VA metrics');
      return res.json();
    },
  });

  const { data: metricsToday } = useQuery({
    queryKey: ['va', 'metrics', 'today'],
    queryFn: async () => {
      const res = await fetch('/api/va/metrics?period=today', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch VA metrics today');
      return res.json();
    },
  });

  const { data: metricsMonth } = useQuery({
    queryKey: ['va', 'metrics', 'month'],
    queryFn: async () => {
      const res = await fetch('/api/va/metrics?period=month', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch VA metrics month');
      return res.json();
    },
  });

  const { data: auditData } = useQuery({
    queryKey: ['va', 'audit-trail'],
    queryFn: async () => {
      const res = await fetch('/api/va/audit-trail?limit=20', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch audit trail');
      return res.json();
    },
  });

  const { data: scheduledData } = useQuery({
    queryKey: ['va', 'scheduled'],
    queryFn: async () => {
      const res = await fetch('/api/va/scheduled', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch scheduled tasks');
      return res.json();
    },
  });

  const { data: workflowsData } = useQuery({
    queryKey: ['va', 'workflows'],
    queryFn: async () => {
      const res = await fetch('/api/va/workflows', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch workflows');
      return res.json();
    },
  });

  const createWorkflowMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/va/workflows', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: wfName, description: wfDescription, steps: wfSteps }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to create workflow');
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Workflow created', description: `"${wfName}" is now active.` });
      setWfName('');
      setWfDescription('');
      setWfSteps([{ title: '', category: 'research', description: '', estimatedMinutes: 30 }]);
      queryClient.invalidateQueries({ queryKey: ['va', 'workflows'] });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't create workflow", description: `${err.message}. ${reassurance}`, variant: 'destructive' });
    },
  });

  const metrics = metricsData;
  const auditEntries: any[] = auditData?.auditTrail ?? [];
  const scheduledTasks: any[] = scheduledData?.scheduledTasks ?? [];
  const workflows: any[] = workflowsData?.workflows ?? [];

  const typeChartData =
    metrics?.tasksByType?.map((t: any) => ({ name: t.type, value: t.count })) ?? [];

  function addStep() {
    setWfSteps(s => [
      ...s,
      { title: '', category: 'research', description: '', estimatedMinutes: 30 },
    ]);
  }

  function removeStep(i: number) {
    setWfSteps(s => s.filter((_, idx) => idx !== i));
  }

  function moveStep(i: number, dir: 'up' | 'down') {
    setWfSteps(s => {
      const arr = [...s];
      const j = dir === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= arr.length) return arr;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  }

  function updateStep(i: number, field: keyof WorkflowStep, value: string | number) {
    setWfSteps(s => s.map((step, idx) => (idx === i ? { ...step, [field]: value } : step)));
  }

  function handleCreateWorkflow(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!wfName || wfSteps.some(s => !s.title) || createWorkflowMutation.isPending) return;
    createWorkflowMutation.mutate();
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Users className="w-8 h-8 text-primary" aria-hidden="true" />
          VA dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Virtual assistant performance, audit logs, and workflow management.
        </p>
      </div>

      <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Tasks completed today"
          value={metricsToday?.tasksCompleted ?? 0}
          sub={`of ${metricsToday?.tasksAssigned ?? 0} assigned`}
          icon={<CheckCircle className="w-5 h-5" />}
        />
        <MetricCard
          label="Tasks this week"
          value={metrics?.tasksCompleted ?? 0}
          sub={`${metrics?.successRate ?? 0}% success rate`}
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <MetricCard
          label="Tasks this month"
          value={metricsMonth?.tasksCompleted ?? 0}
          sub={`of ${metricsMonth?.tasksAssigned ?? 0} assigned`}
          icon={<List className="w-5 h-5" />}
        />
        <MetricCard
          label="Time saved this week"
          value={`${metrics?.timeSavedHours ?? 0}h`}
          sub="Estimated hours saved"
          icon={<Clock className="w-5 h-5" />}
        />
      </dl>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Success rate</CardTitle>
            <CardDescription>This week&apos;s task completion rate</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center py-4">
            <GaugeRing value={metrics?.successRate ?? 0} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tasks by type</CardTitle>
            <CardDescription>Distribution of completed task categories</CardDescription>
          </CardHeader>
          <CardContent>
            {typeChartData.length > 0 ? (
              <div
                role="img"
                aria-label={`Task category breakdown: ${typeChartData.map((t: any) => `${t.name.replace(/_/g, " ")} ${t.value}`).join(", ")}`}
              >
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={typeChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      label={({ name, value }: any) => `${name}: ${value}`}
                    >
                      {typeChartData.map((_: any, i: number) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                <List className="w-8 h-8 mb-2 opacity-30" aria-hidden="true" />
                <p className="text-sm">No completed tasks yet.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled tasks</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="builder">Workflow builder</TabsTrigger>
        </TabsList>

        {/* Audit Trail */}
        <TabsContent value="audit" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Action audit trail</CardTitle>
              <CardDescription>Who did what, when, and the result</CardDescription>
            </CardHeader>
            <CardContent>
              {auditEntries.length > 0 ? (
                <div className="overflow-x-auto" role="region" aria-label="VA action audit trail" tabIndex={0}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="text-left py-2 pr-4 font-medium text-muted-foreground">Task</th>
                        <th scope="col" className="text-left py-2 pr-4 font-medium text-muted-foreground">Category</th>
                        <th scope="col" className="text-left py-2 pr-4 font-medium text-muted-foreground">Status</th>
                        <th scope="col" className="text-left py-2 pr-4 font-medium text-muted-foreground">Completed</th>
                        <th scope="col" className="text-left py-2 font-medium text-muted-foreground">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEntries.map((entry, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td scope="row" className="py-2 pr-4 max-w-[200px] truncate font-medium">
                            {entry.title}
                          </td>
                          <td className="py-2 pr-4">
                            <Badge
                              variant="outline"
                              className="capitalize text-xs"
                              aria-label={`Category: ${entry.category?.replace(/_/g, ' ')}`}
                            >
                              {entry.category?.replace(/_/g, ' ')}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4">
                            <Badge
                              className={
                                entry.status === 'completed'
                                  ? 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos'
                                  : entry.status === 'cancelled'
                                  ? 'bg-acr-neg-soft text-acr-neg'
                                  : 'bg-acr-warn-soft text-acr-warn'
                              }
                              aria-label={`Status: ${entry.status}`}
                            >
                              {entry.status}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground text-xs">
                            {entry.completedAt
                              ? <time dateTime={entry.completedAt}>{new Date(entry.completedAt).toLocaleDateString()}</time>
                              : '—'}
                          </td>
                          <td className="py-2 text-muted-foreground text-xs max-w-[200px] truncate">
                            {entry.completionNotes || entry.reasoning || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center py-12 text-muted-foreground">
                  <CheckCircle className="w-10 h-10 mb-3 opacity-30" aria-hidden="true" />
                  <p>No audit trail entries yet. Complete VA tasks to see them here.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scheduled Tasks */}
        <TabsContent value="scheduled" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-4 h-4" aria-hidden="true" />
                Scheduled tasks
              </CardTitle>
              <CardDescription>Recurring tasks with next run times</CardDescription>
            </CardHeader>
            <CardContent>
              {scheduledTasks.length > 0 ? (
                <ul className="space-y-3 list-none p-0 m-0" aria-label="Recurring scheduled tasks">
                  {scheduledTasks.map((task: any, i: number) => (
                    <li key={i} className="flex items-center justify-between p-3 border rounded-lg gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{task.title}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{task.cronExpression}</span> · {task.category?.replace(/_/g, ' ')}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-muted-foreground">Next run</p>
                        <p className="text-sm font-medium tabular-nums">
                          {task.nextRunAt
                            ? <time dateTime={task.nextRunAt}>{new Date(task.nextRunAt).toLocaleDateString()}</time>
                            : '—'}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex flex-col items-center py-12 text-muted-foreground">
                  <Calendar className="w-10 h-10 mb-3 opacity-30" aria-hidden="true" />
                  <p>No scheduled tasks configured yet.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Workflow List */}
        <TabsContent value="workflows" className="space-y-3">
          {workflows.length === 0 ? (
            <div className="flex flex-col items-center py-16 text-muted-foreground">
              <GitBranch className="w-12 h-12 mb-3 opacity-30" aria-hidden="true" />
              <p>No workflows created yet. Use the workflow builder tab to create one.</p>
            </div>
          ) : (
            <ul className="space-y-4 list-none p-0 m-0" aria-label="VA workflows">
              {workflows.map((wf: any) => (
                <li key={wf.id}>
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{wf.name}</CardTitle>
                        <Badge variant="outline" className="capitalize" aria-label={`Status: ${wf.status}`}>
                          {wf.status}
                        </Badge>
                      </div>
                      {wf.description && (
                        <CardDescription>{wf.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <ol className="space-y-2 list-none p-0 m-0" aria-label={`Steps for ${wf.name}`}>
                        {wf.steps?.map((step: any, i: number) => (
                          <li key={i} className="flex items-center gap-3 text-sm">
                            <div
                              className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary tabular-nums shrink-0"
                              aria-hidden="true"
                            >
                              {step.stepNumber}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="font-medium">{step.title}</span>
                              <Badge
                                variant="outline"
                                className="ml-2 text-xs capitalize"
                                aria-label={`Category: ${step.category?.replace(/_/g, ' ')}`}
                              >
                                {step.category?.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                            <span className="text-xs text-muted-foreground tabular-nums">
                              ~{step.estimatedMinutes}m
                            </span>
                          </li>
                        ))}
                      </ol>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        {/* Workflow Builder */}
        <TabsContent value="builder" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="w-4 h-4" aria-hidden="true" />
                Workflow builder
              </CardTitle>
              <CardDescription>Create a multi-step VA workflow with ordered tasks</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateWorkflow} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor={wfNameId}>Workflow name</Label>
                    <Input
                      id={wfNameId}
                      placeholder="e.g. New lead onboarding"
                      value={wfName}
                      onChange={e => setWfName(e.target.value)}
                      autoCapitalize="words"
                    />
                  </div>
                  <div>
                    <Label htmlFor={wfDescId}>Description (optional)</Label>
                    <Input
                      id={wfDescId}
                      placeholder="What this workflow accomplishes"
                      value={wfDescription}
                      onChange={e => setWfDescription(e.target.value)}
                      autoCapitalize="sentences"
                    />
                  </div>
                </div>

                <fieldset className="space-y-3">
                  <div className="flex items-center justify-between">
                    <legend className="text-sm font-semibold">Steps (in order)</legend>
                    <Button type="button" size="sm" variant="outline" onClick={addStep}>
                      <Plus className="w-4 h-4 mr-1" aria-hidden="true" /> Add step
                    </Button>
                  </div>

                  <ol className="space-y-3 list-none p-0 m-0" aria-label="Workflow steps">
                    {wfSteps.map((step, i) => {
                      const stepTitleId = `wf-step-${i}-title`;
                      const stepCatId = `wf-step-${i}-cat`;
                      const stepMinsId = `wf-step-${i}-mins`;
                      const stepDescId = `wf-step-${i}-desc`;
                      return (
                        <li key={i} className="p-3 border rounded-lg space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-muted-foreground tabular-nums">
                              Step {i + 1}
                            </span>
                            <div className="flex gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => moveStep(i, 'up')}
                                disabled={i === 0}
                                aria-label={`Move step ${i + 1} up`}
                              >
                                <ArrowUp className="w-3 h-3" aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => moveStep(i, 'down')}
                                disabled={i === wfSteps.length - 1}
                                aria-label={`Move step ${i + 1} down`}
                              >
                                <ArrowDown className="w-3 h-3" aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => removeStep(i)}
                                disabled={wfSteps.length === 1}
                                aria-label={`Remove step ${i + 1}${step.title ? `: ${step.title}` : ""}`}
                              >
                                <Trash2 className="w-3 h-3 text-acr-neg" aria-hidden="true" />
                              </Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div>
                              <Label htmlFor={stepTitleId} className="text-xs">Title</Label>
                              <Input
                                id={stepTitleId}
                                placeholder="Step title"
                                value={step.title}
                                onChange={e => updateStep(i, 'title', e.target.value)}
                                autoCapitalize="sentences"
                              />
                            </div>
                            <div>
                              <Label htmlFor={stepCatId} className="text-xs">Category</Label>
                              <Select
                                value={step.category}
                                onValueChange={v => updateStep(i, 'category', v)}
                              >
                                <SelectTrigger id={stepCatId}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TASK_CATEGORIES.map(c => (
                                    <SelectItem key={c} value={c}>
                                      {c.replace(/_/g, ' ')}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label htmlFor={stepMinsId} className="text-xs">Estimated minutes</Label>
                              <Input
                                id={stepMinsId}
                                type="number"
                                inputMode="numeric"
                                min={5}
                                value={step.estimatedMinutes}
                                onChange={e => updateStep(i, 'estimatedMinutes', parseInt(e.target.value) || 30)}
                              />
                            </div>
                          </div>
                          <div>
                            <Label htmlFor={stepDescId} className="text-xs">Description</Label>
                            <Textarea
                              id={stepDescId}
                              placeholder="What should the VA do in this step?"
                              value={step.description}
                              onChange={e => updateStep(i, 'description', e.target.value)}
                              rows={2}
                              autoCapitalize="sentences"
                            />
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                </fieldset>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={!wfName || wfSteps.some(s => !s.title) || createWorkflowMutation.isPending}
                >
                  <GitBranch className="w-4 h-4 mr-2" aria-hidden="true" />
                  {createWorkflowMutation.isPending ? 'Creating…' : 'Create workflow'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
