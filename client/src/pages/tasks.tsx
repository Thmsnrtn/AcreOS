import { PageShell } from "@/components/page-shell";
import { ListSkeleton } from "@/components/list-skeleton";
import { EmptyState } from "@/components/empty-state";
import { useId, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalTrigger,
} from "@/components/ui/responsive-modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ListTodo,
  Plus,
  CheckCircle2,
  CheckSquare,
  Clock, 
  AlertCircle, 
  Loader2, 
  Calendar,
  User,
  Link as LinkIcon,
  Trash2,
  Edit,
  Filter,
  RefreshCw,
  CalendarDays,
  UserCircle2
} from "lucide-react";
import { format } from "date-fns";
import type { Task } from "@shared/schema";

const taskFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  status: z.enum(["pending", "in_progress", "completed", "cancelled"]).default("pending"),
  assignedTo: z.number().optional().nullable(),
  entityType: z.enum(["lead", "property", "deal", "none"]).default("none"),
  entityId: z.number().optional().nullable(),
  isRecurring: z.boolean().default(false),
  recurrenceRule: z.enum(["daily", "weekly", "monthly", "yearly"]).optional().nullable(),
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

const priorityColors = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-acr-accent text-acr-accent dark:bg-acr-accent dark:text-acr-accent",
  high: "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft dark:text-acr-warn",
  urgent: "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft dark:text-acr-neg",
};

const statusIcons = {
  pending: Clock,
  in_progress: Loader2,
  completed: CheckCircle2,
  cancelled: AlertCircle,
};

type FilterTab = "all" | "my" | "overdue" | "today" | "week";

const reassurance = "Your task data is unchanged — try again.";

export default function TasksPage() {
  useDocumentTitle("Tasks");
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [filters, setFilters] = useState<{ status?: string; priority?: string }>({});
  const filterStatusId = useId();
  const filterPriorityId = useId();

  const queryParams = new URLSearchParams();
  if (filters.status) queryParams.set("status", filters.status);
  if (filters.priority) queryParams.set("priority", filters.priority);
  if (activeTab === "overdue") queryParams.set("overdue", "true");
  if (activeTab === "today") queryParams.set("due_date", "today");
  if (activeTab === "week") queryParams.set("due_date", "week");
  const queryString = queryParams.toString();

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: activeTab === "my" ? ["/api/tasks/my"] : ["/api/tasks", queryString],
  });

  const { data: teamMembers } = useQuery<{ id: number; userId: string; name: string }[]>({
    queryKey: ["/api/team"],
  });

  const createForm = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema) as any,
    defaultValues: {
      title: "",
      description: "",
      priority: "medium",
      status: "pending",
      entityType: "none",
      isRecurring: false,
    },
  });

  const editForm = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema) as any,
    defaultValues: {
      title: "",
      description: "",
      priority: "medium",
      status: "pending",
      entityType: "none",
      isRecurring: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: TaskFormValues) => {
      const response = await apiRequest("POST", "/api/tasks", data);
      return response.json();
    },
    onSuccess: () => {
      // /api/tasks invalidation matches the filtered tab via prefix, but the
      // "my" tab queries ["/api/tasks/my"] (distinct cache key — not a prefix
      // match) and the dashboard widget/today-priorities feeds also pull
      // their own keys. Invalidate the full fan-out so every surface refreshes.
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today-priorities"] });
      setIsCreateOpen(false);
      createForm.reset();
      toast({ title: "Task created", description: "Your task has been created successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't save task", description: `${error.message}. ${reassurance}`, variant: "destructive" });
    },
  });

  const updateMutation = useOptimisticUpdate<{ id: number; data: Partial<TaskFormValues> }>(
    {
      mutationFn: async ({ id, data }) => {
        const response = await apiRequest("PUT", `/api/tasks/${id}`, data);
        return response.json();
      },
      listKeys: [["/api/tasks"], ["/api/tasks/my"]],
      detailKey: ({ id }) => ["/api/tasks", id],
      getId: ({ id }) => id,
      // Variables shape is `{ id, data }` but the cached row is flat —
      // pull the patch out of `data`. Without this the factory would
      // splat `data` as a sub-key and produce `row.data = {...}` which
      // is meaningless.
      buildPatch: ({ data }) => data as Record<string, unknown>,
      extraInvalidateKeys: [
        ["/api/tasks/dashboard-summary"],
        ["/api/dashboard/today-priorities"],
      ],
      successToast: { title: "Task updated", description: "Your task has been updated successfully." },
    },
    {
      onSuccess: () => {
        setIsEditOpen(false);
        setSelectedTask(null);
      },
    },
  );

  // Optimistic task-complete — the row should strike through instantly
  // and disappear from "My tasks" / "Today" filters. Rollback restores
  // the prior status on server reject; for recurring tasks we still
  // need invalidations to surface the freshly-created next task.
  const completeMutation = useOptimisticUpdate<{ id: number }>({
    mutationFn: async ({ id }) => {
      const response = await apiRequest("POST", `/api/tasks/${id}/complete`);
      return response.json();
    },
    listKeys: [["/api/tasks"], ["/api/tasks/my"]],
    getId: ({ id }) => id,
    buildPatch: () => ({ status: "completed", completedAt: new Date().toISOString() }),
    extraInvalidateKeys: [["/api/tasks/dashboard-summary"], ["/api/dashboard/today-priorities"]],
    successToast: { title: "Task completed", description: "Great job!" },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/my"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks/dashboard-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/today-priorities"] });
      setTaskToDelete(null);
      toast({ title: "Task deleted", description: "The task has been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't delete task", description: `${error.message}. The task is still in your list — try again.`, variant: "destructive" });
    },
  });

  const onCreateSubmit = (data: TaskFormValues) => {
    createMutation.mutate(data);
  };

  const onEditSubmit = (data: TaskFormValues) => {
    if (selectedTask) {
      updateMutation.mutate({ id: selectedTask.id, data });
    }
  };

  const openEditDialog = (task: Task) => {
    setSelectedTask(task);
    editForm.reset({
      title: task.title,
      description: task.description || "",
      dueDate: task.dueDate ? format(new Date(task.dueDate), "yyyy-MM-dd") : "",
      priority: task.priority as "low" | "medium" | "high" | "urgent",
      status: task.status as "pending" | "in_progress" | "completed" | "cancelled",
      assignedTo: task.assignedTo,
      entityType: task.entityType as "lead" | "property" | "deal" | "none",
      entityId: task.entityId,
      isRecurring: task.isRecurring || false,
      recurrenceRule: task.recurrenceRule as "daily" | "weekly" | "monthly" | "yearly" | null,
    });
    setIsEditOpen(true);
  };

  const TaskFormContent = ({ form, onSubmit, isPending }: { 
    form: typeof createForm; 
    onSubmit: (data: TaskFormValues) => void;
    isPending: boolean;
  }) => (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="Task title…" {...field} data-testid="input-task-title" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea placeholder="Task description…" {...field} data-testid="input-task-description" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="dueDate"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Due date</FormLabel>
                <FormControl>
                  <Input type="date" {...field} data-testid="input-task-due-date" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Priority</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-task-priority">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="entityType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Link to</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-task-entity-type">
                      <SelectValue placeholder="Link to entity" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="lead">Lead</SelectItem>
                    <SelectItem value="property">Property</SelectItem>
                    <SelectItem value="deal">Deal</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="entityId"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Entity ID</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    inputMode="numeric"
                    placeholder="ID"
                    {...field}
                    value={field.value || ""}
                    onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : null)}
                    data-testid="input-task-entity-id"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="assignedTo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Assign to</FormLabel>
              <Select 
                onValueChange={(v) => field.onChange(v && v !== "unassigned" ? parseInt(v) : null)} 
                defaultValue={field.value?.toString() || "unassigned"}
              >
                <FormControl>
                  <SelectTrigger data-testid="select-task-assignee">
                    <SelectValue placeholder="Select team member" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {teamMembers?.map((member) => (
                    <SelectItem key={member.id} value={member.id.toString()}>
                      {member.name || member.userId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center space-x-4">
          <FormField
            control={form.control}
            name="isRecurring"
            render={({ field }) => (
              <FormItem className="flex items-center space-x-2">
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    data-testid="switch-task-recurring"
                  />
                </FormControl>
                <FormLabel className="!mt-0">Recurring task</FormLabel>
              </FormItem>
            )}
          />
        </div>

        {form.watch("isRecurring") && (
          <FormField
            control={form.control}
            name="recurrenceRule"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Repeat</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value || undefined}>
                  <FormControl>
                    <SelectTrigger data-testid="select-task-recurrence">
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <ResponsiveModalFooter>
          <Button type="submit" disabled={isPending} data-testid="button-submit-task">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
            Save task
          </Button>
        </ResponsiveModalFooter>
      </form>
    </Form>
  );

  return (
    <PageShell label="Tasks">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary rounded-xl text-primary-foreground" aria-hidden="true">
                <ListTodo className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold" data-testid="text-page-title">Tasks</h1>
                <p className="text-muted-foreground">Manage your to-dos and follow-ups.</p>
              </div>
            </div>

            <ResponsiveModal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <ResponsiveModalTrigger asChild>
                <Button data-testid="button-create-task">
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  New task
                </Button>
              </ResponsiveModalTrigger>
              <ResponsiveModalContent className="max-w-lg">
                <ResponsiveModalHeader>
                  <ResponsiveModalTitle>Create task</ResponsiveModalTitle>
                  <ResponsiveModalDescription>
                    Add a new task with title, priority, and optional due date.
                  </ResponsiveModalDescription>
                </ResponsiveModalHeader>
                <TaskFormContent
                  form={createForm}
                  onSubmit={onCreateSubmit}
                  isPending={createMutation.isPending}
                />
              </ResponsiveModalContent>
            </ResponsiveModal>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)} className="w-full">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
              <TabsList>
                <TabsTrigger value="all" data-testid="tab-all-tasks">
                  <ListTodo className="w-4 h-4 mr-2" aria-hidden="true" />
                  All tasks
                </TabsTrigger>
                <TabsTrigger value="my" data-testid="tab-my-tasks">
                  <UserCircle2 className="w-4 h-4 mr-2" aria-hidden="true" />
                  My tasks
                </TabsTrigger>
                <TabsTrigger value="overdue" data-testid="tab-overdue-tasks">
                  <AlertCircle className="w-4 h-4 mr-2" aria-hidden="true" />
                  Overdue
                </TabsTrigger>
                <TabsTrigger value="today" data-testid="tab-today-tasks">
                  <Calendar className="w-4 h-4 mr-2" aria-hidden="true" />
                  Today
                </TabsTrigger>
                <TabsTrigger value="week" data-testid="tab-week-tasks">
                  <CalendarDays className="w-4 h-4 mr-2" aria-hidden="true" />
                  This week
                </TabsTrigger>
              </TabsList>
            </div>
          </Tabs>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b">
              <CardTitle className="flex items-center gap-2">
                <Filter className="w-4 h-4" aria-hidden="true" />
                Filters
              </CardTitle>
              <div className="flex items-center gap-4 flex-wrap">
                <div>
                  <Label htmlFor={filterStatusId} className="sr-only">Filter by status</Label>
                  <Select
                    value={filters.status || "all"}
                    onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "all" ? undefined : v }))}
                  >
                    <SelectTrigger id={filterStatusId} className="w-[150px]" data-testid="select-filter-status">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor={filterPriorityId} className="sr-only">Filter by priority</Label>
                  <Select
                    value={filters.priority || "all"}
                    onValueChange={(v) => setFilters((f) => ({ ...f, priority: v === "all" ? undefined : v }))}
                  >
                    <SelectTrigger id={filterPriorityId} className="w-[150px]" data-testid="select-filter-priority">
                      <SelectValue placeholder="Priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All priorities</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setFilters({}); setActiveTab("all"); }}
                  data-testid="button-clear-filters"
                >
                  Clear filters
                </Button>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div role="status" aria-label="Loading tasks">
                  <ListSkeleton count={4} />
                </div>
              ) : !tasks?.length ? (
                <EmptyState
                  icon={CheckSquare}
                  headline="Nothing on your list yet"
                  subtitle="Add a task and link it to a lead, deal, or parcel — Pax slides follow-ups in automatically as deals age past 5 days."
                  cta={{
                    label: "Add a Task",
                    onClick: () => setIsCreateOpen(true),
                    "data-testid": "empty-state-tasks-action",
                  }}
                  tips={[
                    "Wire a task to a lead, deal, or parcel — Pax surfaces it on Today the morning it's due",
                    "Set a due date — Pax pings you the day before, not the day of",
                    "Pax adds follow-up tasks on its own when a seller goes quiet past 5 days",
                  ]}
                  testId="empty-state-tasks"
                />
              ) : (
                <ul className="divide-y list-none p-0 m-0" aria-label="Tasks">
                  {tasks.map((task) => {
                    const StatusIcon = statusIcons[task.status as keyof typeof statusIcons] || Clock;
                    const isCompleted = task.status === "completed";
                    const statusLabel = task.status.replace(/_/g, " ");

                    return (
                      <li
                        key={task.id}
                        className="p-4 flex items-start gap-4 hover-elevate"
                        data-testid={`task-row-${task.id}`}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className={isCompleted ? "text-acr-pos" : "text-muted-foreground"}
                          onClick={() => !isCompleted && completeMutation.mutate({ id: task.id })}
                          disabled={isCompleted || completeMutation.isPending}
                          aria-pressed={isCompleted}
                          aria-label={isCompleted ? `Completed: ${task.title}` : `Mark complete: ${task.title}`}
                          data-testid={`button-complete-task-${task.id}`}
                        >
                          <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                        </Button>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3
                              className={`font-medium ${isCompleted ? "line-through text-muted-foreground" : ""}`}
                              data-testid={`text-task-title-${task.id}`}
                            >
                              {task.title}
                            </h3>
                            <Badge
                              variant="secondary"
                              className={priorityColors[task.priority as keyof typeof priorityColors]}
                              data-testid={`badge-task-priority-${task.id}`}
                              aria-label={`Priority: ${task.priority}`}
                            >
                              {task.priority}
                            </Badge>
                            {task.isRecurring && (
                              <Badge variant="outline" className="gap-1" aria-label={`Recurs ${task.recurrenceRule}`}>
                                <RefreshCw className="w-3 h-3" aria-hidden="true" />
                                {task.recurrenceRule}
                              </Badge>
                            )}
                          </div>

                          {task.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {task.description}
                            </p>
                          )}

                          <dl className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                            {task.dueDate && (
                              <div className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" aria-hidden="true" />
                                <dt className="sr-only">Due date</dt>
                                <dd>
                                  <time dateTime={String(task.dueDate)}>
                                    {format(new Date(task.dueDate), "MMM d, yyyy")}
                                  </time>
                                </dd>
                              </div>
                            )}
                            {task.entityType && task.entityType !== "none" && (
                              <div className="flex items-center gap-1">
                                <LinkIcon className="w-3 h-3" aria-hidden="true" />
                                <dt className="sr-only">Linked to</dt>
                                <dd>
                                  {task.entityType} <span className="tabular-nums">#{task.entityId}</span>
                                </dd>
                              </div>
                            )}
                            <div className="flex items-center gap-1">
                              <StatusIcon className="w-3 h-3" aria-hidden="true" />
                              <dt className="sr-only">Status</dt>
                              <dd>{statusLabel}</dd>
                            </div>
                          </dl>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(task)}
                            aria-label={`Edit task: ${task.title}`}
                            data-testid={`button-edit-task-${task.id}`}
                          >
                            <Edit className="w-4 h-4" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setTaskToDelete(task)}
                            aria-label={`Delete task: ${task.title}`}
                            data-testid={`button-delete-task-${task.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

      <ResponsiveModal open={isEditOpen} onOpenChange={setIsEditOpen}>
        <ResponsiveModalContent className="max-w-lg">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Edit task</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Update the task details, status, or priority.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <TaskFormContent
            form={editForm}
            onSubmit={onEditSubmit}
            isPending={updateMutation.isPending}
          />
        </ResponsiveModalContent>
      </ResponsiveModal>

      <ConfirmDialog
        open={!!taskToDelete}
        onOpenChange={(open) => !open && setTaskToDelete(null)}
        title="Delete task"
        description={taskToDelete ? `Are you sure you want to delete "${taskToDelete.title}"? This cannot be undone.` : ""}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => taskToDelete && deleteMutation.mutate(taskToDelete.id)}
        isLoading={deleteMutation.isPending}
      />
    </PageShell>
  );
}
