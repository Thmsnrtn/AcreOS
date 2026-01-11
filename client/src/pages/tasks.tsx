import { Sidebar } from "@/components/layout-sidebar";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  ListTodo, 
  Plus, 
  CheckCircle2, 
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
  low: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  medium: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  high: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
};

const statusIcons = {
  pending: Clock,
  in_progress: Loader2,
  completed: CheckCircle2,
  cancelled: AlertCircle,
};

type FilterTab = "all" | "my" | "overdue" | "today" | "week";

export default function TasksPage() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [filters, setFilters] = useState<{ status?: string; priority?: string }>({});

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
    resolver: zodResolver(taskFormSchema),
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
    resolver: zodResolver(taskFormSchema),
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
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setIsCreateOpen(false);
      createForm.reset();
      toast({ title: "Task created", description: "Your task has been created successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TaskFormValues> }) => {
      const response = await apiRequest("PUT", `/api/tasks/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setIsEditOpen(false);
      setSelectedTask(null);
      toast({ title: "Task updated", description: "Your task has been updated successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("POST", `/api/tasks/${id}/complete`);
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      if (data.nextTask) {
        toast({ 
          title: "Task completed", 
          description: "A new recurring task has been created." 
        });
      } else {
        toast({ title: "Task completed", description: "Great job!" });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Task deleted", description: "The task has been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
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
                <Input placeholder="Task title..." {...field} data-testid="input-task-title" />
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
                <Textarea placeholder="Task description..." {...field} data-testid="input-task-description" />
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
                <FormLabel>Due Date</FormLabel>
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
                <FormLabel className="!mt-0">Recurring Task</FormLabel>
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

        <DialogFooter>
          <Button type="submit" disabled={isPending} data-testid="button-submit-task">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Task
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto w-full space-y-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary rounded-xl text-primary-foreground">
                <ListTodo className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold" data-testid="text-page-title">Tasks</h1>
                <p className="text-muted-foreground">Manage your to-dos and follow-ups.</p>
              </div>
            </div>

            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-task">
                  <Plus className="w-4 h-4 mr-2" />
                  New Task
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Task</DialogTitle>
                </DialogHeader>
                <TaskFormContent 
                  form={createForm} 
                  onSubmit={onCreateSubmit} 
                  isPending={createMutation.isPending} 
                />
              </DialogContent>
            </Dialog>
          </div>

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FilterTab)} className="w-full">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
              <TabsList>
                <TabsTrigger value="all" data-testid="tab-all-tasks">
                  <ListTodo className="w-4 h-4 mr-2" />
                  All Tasks
                </TabsTrigger>
                <TabsTrigger value="my" data-testid="tab-my-tasks">
                  <UserCircle2 className="w-4 h-4 mr-2" />
                  My Tasks
                </TabsTrigger>
                <TabsTrigger value="overdue" data-testid="tab-overdue-tasks">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Overdue
                </TabsTrigger>
                <TabsTrigger value="today" data-testid="tab-today-tasks">
                  <Calendar className="w-4 h-4 mr-2" />
                  Today
                </TabsTrigger>
                <TabsTrigger value="week" data-testid="tab-week-tasks">
                  <CalendarDays className="w-4 h-4 mr-2" />
                  This Week
                </TabsTrigger>
              </TabsList>
            </div>
          </Tabs>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 flex-wrap border-b">
              <CardTitle className="flex items-center gap-2">
                <Filter className="w-4 h-4" />
                Filters
              </CardTitle>
              <div className="flex items-center gap-4 flex-wrap">
                <Select
                  value={filters.status || "all"}
                  onValueChange={(v) => setFilters((f) => ({ ...f, status: v === "all" ? undefined : v }))}
                >
                  <SelectTrigger className="w-[150px]" data-testid="select-filter-status">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>

                <Select
                  value={filters.priority || "all"}
                  onValueChange={(v) => setFilters((f) => ({ ...f, priority: v === "all" ? undefined : v }))}
                >
                  <SelectTrigger className="w-[150px]" data-testid="select-filter-priority">
                    <SelectValue placeholder="Priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priorities</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { setFilters({}); setActiveTab("all"); }}
                  data-testid="button-clear-filters"
                >
                  Clear Filters
                </Button>
              </div>
            </CardHeader>
          </Card>

          <Card>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : !tasks?.length ? (
                <div className="text-center py-20 text-muted-foreground">
                  <ListTodo className="w-12 h-12 mx-auto mb-4 opacity-30" />
                  <p>No tasks found. Create your first task!</p>
                </div>
              ) : (
                <div className="divide-y">
                  {tasks.map((task) => {
                    const StatusIcon = statusIcons[task.status as keyof typeof statusIcons] || Clock;
                    const isCompleted = task.status === "completed";
                    
                    return (
                      <div 
                        key={task.id} 
                        className="p-4 flex items-start gap-4 hover-elevate"
                        data-testid={`task-row-${task.id}`}
                      >
                        <Button
                          variant="ghost"
                          size="icon"
                          className={isCompleted ? "text-green-600" : "text-muted-foreground"}
                          onClick={() => !isCompleted && completeMutation.mutate(task.id)}
                          disabled={isCompleted || completeMutation.isPending}
                          data-testid={`button-complete-task-${task.id}`}
                        >
                          <CheckCircle2 className="w-5 h-5" />
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
                            >
                              {task.priority}
                            </Badge>
                            {task.isRecurring && (
                              <Badge variant="outline" className="gap-1">
                                <RefreshCw className="w-3 h-3" />
                                {task.recurrenceRule}
                              </Badge>
                            )}
                          </div>

                          {task.description && (
                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                              {task.description}
                            </p>
                          )}

                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                            {task.dueDate && (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {format(new Date(task.dueDate), "MMM d, yyyy")}
                              </span>
                            )}
                            {task.entityType && task.entityType !== "none" && (
                              <span className="flex items-center gap-1">
                                <LinkIcon className="w-3 h-3" />
                                {task.entityType} #{task.entityId}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <StatusIcon className="w-3 h-3" />
                              {task.status.replace("_", " ")}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(task)}
                            data-testid={`button-edit-task-${task.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteMutation.mutate(task.id)}
                            disabled={deleteMutation.isPending}
                            data-testid={`button-delete-task-${task.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Task</DialogTitle>
          </DialogHeader>
          <TaskFormContent 
            form={editForm} 
            onSubmit={onEditSubmit} 
            isPending={updateMutation.isPending} 
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
