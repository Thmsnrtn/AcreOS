import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { WorkflowBuilder } from "@/components/workflow-builder";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Zap,
  Clock,
  Play,
  Pause,
  Trash2,
  Edit,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Workflow,
  AlertCircle,
  Sparkles,
  Users,
  Banknote,
  Handshake,
} from "lucide-react";
import { format } from "date-fns";
import type { Workflow as WorkflowType, WorkflowRun, WorkflowTrigger, WorkflowAction } from "@shared/schema";
import { ConfirmDialog } from "@/components/confirm-dialog";

type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  category: "leads" | "notes" | "deals";
  trigger: WorkflowTrigger;
  actions: WorkflowAction[];
};

const TEMPLATE_CATEGORY_ICONS: Record<string, React.ReactNode> = {
  leads: <Users className="w-4 h-4" />,
  notes: <Banknote className="w-4 h-4" />,
  deals: <Handshake className="w-4 h-4" />,
};

const TRIGGER_LABELS: Record<string, string> = {
  "lead.created": "Lead Created",
  "lead.updated": "Lead Updated",
  "lead.status_changed": "Lead Status Changed",
  "property.created": "Property Created",
  "property.updated": "Property Updated",
  "property.status_changed": "Property Status Changed",
  "deal.created": "Deal Created",
  "deal.updated": "Deal Updated",
  "deal.stage_changed": "Deal Stage Changed",
  "payment.received": "Payment Received",
  "payment.missed": "Payment Missed",
};

function getTriggerLabel(trigger: WorkflowTrigger | null | undefined): string {
  if (!trigger) return "Unknown trigger";
  return TRIGGER_LABELS[trigger.event] || trigger.event;
}

export default function WorkflowsPage() {
  const { toast } = useToast();
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowType | null>(null);
  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowType | null>(null);

  const { data: workflows, isLoading } = useQuery<WorkflowType[]>({
    queryKey: ["/api/workflows"],
  });

  const { data: workflowRuns } = useQuery<WorkflowRun[]>({
    queryKey: ["/api/workflow-runs"],
    enabled: false, // We'll fetch runs per workflow as needed
  });

  const { data: templates } = useQuery<WorkflowTemplate[]>({
    queryKey: ["/api/workflow-templates"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; trigger: WorkflowTrigger; actions: WorkflowAction[] }) => {
      const response = await apiRequest("POST", "/api/workflows", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      setIsBuilderOpen(false);
      setSelectedWorkflow(null);
      toast({ title: "Workflow created", description: "Your workflow is now active." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name: string; description: string; trigger: WorkflowTrigger; actions: WorkflowAction[] } }) => {
      const response = await apiRequest("PUT", `/api/workflows/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      setIsBuilderOpen(false);
      setSelectedWorkflow(null);
      toast({ title: "Workflow updated", description: "Changes have been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const response = await apiRequest("POST", `/api/workflows/${id}/toggle`, { isActive });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/workflows/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      setWorkflowToDelete(null);
      toast({ title: "Workflow deleted", description: "The workflow has been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const [installingTemplateId, setInstallingTemplateId] = useState<string | null>(null);

  const installTemplateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const response = await apiRequest("POST", `/api/workflow-templates/${templateId}/install`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
      setInstallingTemplateId(null);
      toast({ title: "Template installed", description: "The workflow is now active." });
    },
    onError: (error: Error) => {
      setInstallingTemplateId(null);
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleInstallTemplate = (templateId: string) => {
    setInstallingTemplateId(templateId);
    installTemplateMutation.mutate(templateId);
  };

  const handleSave = (data: { name: string; description: string; trigger: WorkflowTrigger; actions: WorkflowAction[] }) => {
    if (selectedWorkflow) {
      updateMutation.mutate({ id: selectedWorkflow.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (workflow: WorkflowType) => {
    setSelectedWorkflow(workflow);
    setIsBuilderOpen(true);
  };

  const handleCreate = () => {
    setSelectedWorkflow(null);
    setIsBuilderOpen(true);
  };

  const handleDelete = (workflow: WorkflowType) => {
    setWorkflowToDelete(workflow);
  };

  const confirmDelete = () => {
    if (workflowToDelete) {
      deleteMutation.mutate(workflowToDelete.id);
    }
  };

  return (
    <PageShell>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">Workflows</h1>
            <p className="text-muted-foreground">
              Automate your business processes with event-driven workflows
            </p>
          </div>

          <Button onClick={handleCreate} data-testid="button-create-workflow">
            <Plus className="w-4 h-4 mr-2" /> Create Workflow
          </Button>
        </div>

        {/* Workflow List */}
        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-6 w-16" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : workflows && workflows.length > 0 ? (
          <div className="grid gap-4">
            {workflows.map((workflow) => (
              <Card 
                key={workflow.id} 
                className="hover-elevate cursor-pointer"
                onClick={() => handleEdit(workflow)}
                data-testid={`card-workflow-${workflow.id}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        workflow.isActive ? "bg-green-100 dark:bg-green-900/30" : "bg-muted"
                      }`}>
                        <Workflow className={`w-5 h-5 ${
                          workflow.isActive ? "text-green-600 dark:text-green-400" : "text-muted-foreground"
                        }`} />
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold" data-testid={`text-workflow-name-${workflow.id}`}>
                            {workflow.name}
                          </h3>
                          <Badge 
                            variant={workflow.isActive ? "default" : "secondary"}
                            data-testid={`badge-status-${workflow.id}`}
                          >
                            {workflow.isActive ? (
                              <>
                                <Play className="w-3 h-3 mr-1" /> Active
                              </>
                            ) : (
                              <>
                                <Pause className="w-3 h-3 mr-1" /> Inactive
                              </>
                            )}
                          </Badge>
                        </div>

                        {workflow.description && (
                          <p className="text-sm text-muted-foreground mb-2">{workflow.description}</p>
                        )}

                        <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <Zap className="w-4 h-4" />
                            {getTriggerLabel(workflow.trigger)}
                          </span>
                          <span className="flex items-center gap-1">
                            <ChevronRight className="w-4 h-4" />
                            {(workflow.actions as WorkflowAction[])?.length || 0} action(s)
                          </span>
                          {workflow.updatedAt && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-4 h-4" />
                              Updated {format(new Date(workflow.updatedAt), "MMM d, yyyy")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={workflow.isActive}
                        onCheckedChange={(checked) => toggleMutation.mutate({ id: workflow.id, isActive: checked })}
                        data-testid={`switch-workflow-${workflow.id}`}
                      />
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={(e) => { e.stopPropagation(); handleEdit(workflow); }}
                        data-testid={`button-edit-${workflow.id}`}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={(e) => { e.stopPropagation(); handleDelete(workflow); }}
                        data-testid={`button-delete-${workflow.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card data-testid="card-empty-state">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <Workflow className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">No workflows yet</h3>
              <p className="text-muted-foreground mb-4 max-w-md">
                Create your first workflow to automate repetitive tasks like sending emails, 
                creating tasks, or updating records when specific events occur.
              </p>
              <Button onClick={handleCreate} data-testid="button-create-first-workflow">
                <Plus className="w-4 h-4 mr-2" /> Create Your First Workflow
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Pre-built Templates */}
        {templates && templates.length > 0 && (
          <div className="mt-4" data-testid="section-workflow-templates">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
                Pre-built Templates for Land Investing
              </h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {templates.map((template) => {
                const alreadyInstalled = workflows?.some(
                  (w) => w.name === template.name
                );
                return (
                  <Card
                    key={template.id}
                    className="hover-elevate"
                    data-testid={`card-template-${template.id}`}
                  >
                    <CardContent className="p-4 flex flex-col gap-3 h-full">
                      <div className="flex items-start gap-2">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
                          {TEMPLATE_CATEGORY_ICONS[template.category]}
                        </div>
                        <div>
                          <p className="font-semibold text-sm leading-tight">
                            {template.name}
                          </p>
                          <Badge variant="secondary" className="text-xs mt-0.5 capitalize">
                            {template.category}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground flex-1">
                        {template.description}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {template.actions.length} action{template.actions.length !== 1 ? "s" : ""}
                        </span>
                        {alreadyInstalled ? (
                          <Badge variant="secondary" className="text-xs flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Installed
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleInstallTemplate(template.id)}
                            disabled={installingTemplateId === template.id}
                            data-testid={`button-install-template-${template.id}`}
                          >
                            {installingTemplateId === template.id ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" />
                            ) : (
                              <Plus className="w-3 h-3 mr-1" />
                            )}
                            Install
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Builder Dialog */}
        <WorkflowBuilder
          open={isBuilderOpen}
          onOpenChange={(open) => {
            setIsBuilderOpen(open);
            if (!open) setSelectedWorkflow(null);
          }}
          workflow={selectedWorkflow}
          onSave={handleSave}
          isSaving={createMutation.isPending || updateMutation.isPending}
        />

        {/* Delete Confirmation */}
        <ConfirmDialog
          open={!!workflowToDelete}
          onOpenChange={(open) => !open && setWorkflowToDelete(null)}
          title="Delete Workflow"
          description={`Are you sure you want to delete "${workflowToDelete?.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={confirmDelete}
          isLoading={deleteMutation.isPending}
        />
    </PageShell>
  );
}
