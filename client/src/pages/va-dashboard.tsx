import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
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
  AlertTriangle,
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
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold mt-0.5">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className="text-muted-foreground">{icon}</div>
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

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="120" height="120" viewBox="0 0 120 120">
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
      <p className="text-xs text-muted-foreground">Success Rate</p>
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Workflow builder state
  const [wfName, setWfName] = useState('');
  const [wfDescription, setWfDescription] = useState('');
  const [wfSteps, setWfSteps] = useState<WorkflowStep[]>([
    { title: '', category: 'research', description: '', estimatedMinutes: 30 },
  ]);

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
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const metrics = metricsData;
  const auditEntries: any[] = auditData?.auditTrail ?? [];
  const scheduledTasks: any[] = scheduledData?.scheduledTasks ?? [];
  const workflows: any[] = workflowsData?.workflows ?? [];

  const typeChartData =
    metrics?.tasksByType?.map((t: any) => ({ name: t.type, value: t.count })) ?? [];

  // Step management
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

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Users className="w-8 h-8 text-primary" />
          VA Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Virtual assistant performance, audit logs, and workflow management.
        </p>
      </div>

      {/* Performance Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Tasks Completed Today"
          value={metricsToday?.tasksCompleted ?? 0}
          sub={`of ${metricsToday?.tasksAssigned ?? 0} assigned`}
          icon={<CheckCircle className="w-5 h-5" />}
        />
        <MetricCard
          label="Tasks This Week"
          value={metrics?.tasksCompleted ?? 0}
          sub={`${metrics?.successRate ?? 0}% success rate`}
          icon={<TrendingUp className="w-5 h-5" />}
        />
        <MetricCard
          label="Tasks This Month"
          value={metricsMonth?.tasksCompleted ?? 0}
          sub={`of ${metricsMonth?.tasksAssigned ?? 0} assigned`}
          icon={<List className="w-5 h-5" />}
        />
        <MetricCard
          label="Time Saved (Week)"
          value={`${metrics?.timeSavedHours ?? 0}h`}
          sub="Estimated hours saved"
          icon={<Clock className="w-5 h-5" />}
        />
      </div>

      {/* Success Rate Gauge + Task Distribution */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Success Rate</CardTitle>
            <CardDescription>This week's task completion rate</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center py-4">
            <GaugeRing value={metrics?.successRate ?? 0} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tasks by Type</CardTitle>
            <CardDescription>Distribution of completed task categories</CardDescription>
          </CardHeader>
          <CardContent>
            {typeChartData.length > 0 ? (
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
            ) : (
              <div className="flex flex-col items-center justify-center h-[200px] text-muted-foreground">
                <List className="w-8 h-8 mb-2 opacity-30" />
                <p className="text-sm">No completed tasks yet.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">Audit Trail</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled Tasks</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
          <TabsTrigger value="builder">Workflow Builder</TabsTrigger>
        </TabsList>

        {/* Audit Trail */}
        <TabsContent value="audit" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Action Audit Trail</CardTitle>
              <CardDescription>Who did what, when, and the result</CardDescription>
            </CardHeader>
            <CardContent>
              {auditEntries.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Task</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Category</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Status</th>
                        <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Completed</th>
                        <th className="text-left py-2 font-medium text-muted-foreground">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditEntries.map((entry, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 pr-4 max-w-[200px] truncate font-medium">
                            {entry.title}
                          </td>
                          <td className="py-2 pr-4">
                            <Badge variant="outline" className="capitalize text-xs">
                              {entry.category?.replace(/_/g, ' ')}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4">
                            <Badge
                              className={
                                entry.status === 'completed'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                                  : entry.status === 'cancelled'
                                  ? 'bg-red-100 text-red-800'
                                  : 'bg-yellow-100 text-yellow-800'
                              }
                            >
                              {entry.status}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4 text-muted-foreground text-xs">
                            {entry.completedAt
                              ? new Date(entry.completedAt).toLocaleDateString()
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
                  <CheckCircle className="w-10 h-10 mb-3 opacity-30" />
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
                <Calendar className="w-4 h-4" />
                Scheduled Tasks
              </CardTitle>
              <CardDescription>Recurring tasks with next run times</CardDescription>
            </CardHeader>
            <CardContent>
              {scheduledTasks.length > 0 ? (
                <div className="space-y-3">
                  {scheduledTasks.map((task: any, i: number) => (
                    <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium text-sm">{task.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {task.cronExpression} · {task.category?.replace(/_/g, ' ')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">Next run</p>
                        <p className="text-sm font-medium">
                          {task.nextRunAt
                            ? new Date(task.nextRunAt).toLocaleDateString()
                            : '—'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center py-12 text-muted-foreground">
                  <Calendar className="w-10 h-10 mb-3 opacity-30" />
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
              <GitBranch className="w-12 h-12 mb-3 opacity-30" />
              <p>No workflows created yet. Use the Workflow Builder tab to create one.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {workflows.map((wf: any) => (
                <Card key={wf.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{wf.name}</CardTitle>
                      <Badge variant="outline" className="capitalize">
                        {wf.status}
                      </Badge>
                    </div>
                    {wf.description && (
                      <CardDescription>{wf.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {wf.steps?.map((step: any, i: number) => (
                        <div key={i} className="flex items-center gap-3 text-sm">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                            {step.stepNumber}
                          </div>
                          <div className="flex-1">
                            <span className="font-medium">{step.title}</span>
                            <Badge variant="outline" className="ml-2 text-xs capitalize">
                              {step.category?.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            ~{step.estimatedMinutes}m
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Workflow Builder */}
        <TabsContent value="builder" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="w-4 h-4" />
                Workflow Builder
              </CardTitle>
              <CardDescription>Create a multi-step VA workflow with ordered tasks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Workflow Name</Label>
                  <Input
                    placeholder="e.g. New Lead Onboarding"
                    value={wfName}
                    onChange={e => setWfName(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Description (optional)</Label>
                  <Input
                    placeholder="What this workflow accomplishes"
                    value={wfDescription}
                    onChange={e => setWfDescription(e.target.value)}
                  />
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Steps (in order)</Label>
                  <Button size="sm" variant="outline" onClick={addStep}>
                    <Plus className="w-4 h-4 mr-1" /> Add Step
                  </Button>
                </div>

                {wfSteps.map((step, i) => (
                  <div key={i} className="p-3 border rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground">
                        Step {i + 1}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => moveStep(i, 'up')}
                          disabled={i === 0}
                        >
                          <ArrowUp className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => moveStep(i, 'down')}
                          disabled={i === wfSteps.length - 1}
                        >
                          <ArrowDown className="w-3 h-3" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeStep(i)}
                          disabled={wfSteps.length === 1}
                        >
                          <Trash2 className="w-3 h-3 text-red-500" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <div>
                        <Label className="text-xs">Title</Label>
                        <Input
                          placeholder="Step title"
                          value={step.title}
                          onChange={e => updateStep(i, 'title', e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Category</Label>
                        <Select
                          value={step.category}
                          onValueChange={v => updateStep(i, 'category', v)}
                        >
                          <SelectTrigger>
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
                        <Label className="text-xs">Est. Minutes</Label>
                        <Input
                          type="number"
                          min={5}
                          value={step.estimatedMinutes}
                          onChange={e => updateStep(i, 'estimatedMinutes', parseInt(e.target.value) || 30)}
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Description</Label>
                      <Textarea
                        placeholder="What should the VA do in this step?"
                        value={step.description}
                        onChange={e => updateStep(i, 'description', e.target.value)}
                        rows={2}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <Button
                className="w-full"
                onClick={() => createWorkflowMutation.mutate()}
                disabled={!wfName || wfSteps.some(s => !s.title) || createWorkflowMutation.isPending}
              >
                <GitBranch className="w-4 h-4 mr-2" />
                {createWorkflowMutation.isPending ? 'Creating…' : 'Create Workflow'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
