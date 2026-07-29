import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import { PageShell } from "@/components/page-shell";
import { WorkflowBuilder } from "@/components/workflow-builder";
import { Card, CardContent } from "@/components/ui/card";
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
  Loader2,
  Workflow,
  Sparkles,
  Users,
  Banknote,
  Handshake,
} from "lucide-react";
import { format } from "date-fns";
import type { Workflow as WorkflowType, WorkflowRun, WorkflowTrigger, WorkflowAction } from "@shared/schema";
import {
  isLiveWorkflowTriggerEvent,
  TRIGGER_NOT_LIVE_MESSAGE,
} from "@shared/workflow-live-triggers";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";

type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  category: "leads" | "notes" | "deals";
  trigger: WorkflowTrigger;
  actions: WorkflowAction[];
};

const TEMPLATE_CATEGORY_ICONS: Record<string, React.ReactNode> = {
  leads: <Users className="w-4 h-4" aria-hidden="true" />,
  notes: <Banknote className="w-4 h-4" aria-hidden="true" />,
  deals: <Handshake className="w-4 h-4" aria-hidden="true" />,
};

const TRIGGER_LABELS: Record<string, string> = {
  "lead.created": "Lead created",
  "lead.updated": "Lead updated",
  "lead.status_changed": "Lead status changed",
  "property.created": "Property created",
  "property.updated": "Property updated",
  "property.status_changed": "Property status changed",
  "deal.created": "Deal created",
  "deal.updated": "Deal updated",
  "deal.stage_changed": "Deal stage changed",
  "payment.received": "Payment received",
  "payment.missed": "Payment missed",
};

function getTriggerLabel(trigger: WorkflowTrigger | null | undefined): string {
  if (!trigger) return "Unknown trigger";
  return TRIGGER_LABELS[trigger.event] || trigger.event;
}

const reassurance = "The workflow is unchanged — try again.";

export default function WorkflowsPage() {
  useDocumentTitle("Workflows");
  const { toast } = useToast();
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowType | null>(null);
  const [workflowToDelete, setWorkflowToDelete] = useState<WorkflowType | null>(null);

  const { data: workflows, isLoading } = useQuery<WorkflowType[]>({
    queryKey: ["/api/workflows"],
  });

  useQuery<WorkflowRun[]>({
    queryKey: ["/api/workflow-runs"],
    enabled: false,
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
      toast({ title: "Couldn't create workflow", description: `${error.message}. ${reassurance}`, variant: "destructive" });
    },
  });

  const updateMutation = useOptimisticUpdate<{
    id: number;
    data: { name: string; description: string; trigger: WorkflowTrigger; actions: WorkflowAction[] };
  }>(
    {
      mutationFn: async ({ id, data }) => {
        const response = await apiRequest("PUT", `/api/workflows/${id}`, data);
        return response.json();
      },
      listKeys: [["/api/workflows"]],
      getId: ({ id }) => id,
      buildPatch: ({ data }) => data as Record<string, unknown>,
      successToast: { title: "Workflow updated", description: "Changes have been saved." },
    },
    {
      onSuccess: () => {
        setIsBuilderOpen(false);
        setSelectedWorkflow(null);
      },
    },
  );

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const response = await apiRequest("POST", `/api/workflows/${id}/toggle`, { isActive });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workflows"] });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't toggle workflow", description: `${error.message}. ${reassurance}`, variant: "destructive" });
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
      toast({ title: "Couldn't delete workflow", description: `${error.message}. ${reassurance}`, variant: "destructive" });
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
      toast({ title: "Couldn't install template", description: `${error.message}. ${reassurance}`, variant: "destructive" });
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
    <PageShell label="Workflows">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Workflows</h1>
          <p className="text-muted-foreground">
            Automate your business processes with event-driven workflows
          </p>
        </div>

        <Button onClick={handleCreate} data-testid="button-create-workflow">
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Create workflow
        </Button>
      </div>

      {/* Workflow List */}
      {isLoading ? (
        <div className="grid gap-4" role="status" aria-label="Loading workflows">
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
        <ul className="grid gap-4 list-none p-0 m-0" aria-label="Your workflows">
          {workflows.map((workflow) => {
            const actionCount = (workflow.actions as WorkflowAction[])?.length || 0;
            return (
              <li key={workflow.id}>
                <Card
                  className="hover-elevate cursor-pointer"
                  onClick={() => handleEdit(workflow)}
                  data-testid={`card-workflow-${workflow.id}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4 flex-1">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          workflow.isActive ? "bg-acr-pos-soft dark:bg-acr-pos-soft/30" : "bg-muted"
                        }`}>
                          <Workflow
                            className={`w-5 h-5 ${
                              workflow.isActive ? "text-acr-pos dark:text-acr-pos" : "text-muted-foreground"
                            }`}
                            aria-hidden="true"
                          />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <h3 className="font-semibold" data-testid={`text-workflow-name-${workflow.id}`}>
                              {workflow.name}
                            </h3>
                            <Badge
                              variant={workflow.isActive ? "default" : "secondary"}
                              data-testid={`badge-status-${workflow.id}`}
                              aria-label={workflow.isActive ? "Status: active" : "Status: inactive"}
                            >
                              {workflow.isActive ? (
                                <>
                                  <Play className="w-3 h-3 mr-1" aria-hidden="true" /> Active
                                </>
                              ) : (
                                <>
                                  <Pause className="w-3 h-3 mr-1" aria-hidden="true" /> Inactive
                                </>
                              )}
                            </Badge>
                            {workflow.trigger?.event && !isLiveWorkflowTriggerEvent(workflow.trigger.event) && (
                              <Badge
                                variant="outline"
                                className="text-xs"
                                title={TRIGGER_NOT_LIVE_MESSAGE}
                                aria-label={`Trigger not yet live: ${TRIGGER_NOT_LIVE_MESSAGE}`}
                                data-testid={`badge-trigger-not-live-${workflow.id}`}
                              >
                                Trigger not yet live
                              </Badge>
                            )}
                          </div>

                          {workflow.description && (
                            <p className="text-sm text-muted-foreground mb-2">{workflow.description}</p>
                          )}

                          <dl className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                            <div className="flex items-center gap-1">
                              <Zap className="w-4 h-4" aria-hidden="true" />
                              <dt className="sr-only">Trigger</dt>
                              <dd>{getTriggerLabel(workflow.trigger)}</dd>
                            </div>
                            <div className="flex items-center gap-1">
                              <ChevronRight className="w-4 h-4" aria-hidden="true" />
                              <dt className="sr-only">Actions</dt>
                              <dd className="tabular-nums">
                                {actionCount} action{actionCount === 1 ? "" : "s"}
                              </dd>
                            </div>
                            {workflow.updatedAt && (
                              <div className="flex items-center gap-1">
                                <Clock className="w-4 h-4" aria-hidden="true" />
                                <dt className="sr-only">Last updated</dt>
                                <dd>Updated {format(new Date(workflow.updatedAt), "MMM d, yyyy")}</dd>
                              </div>
                            )}
                          </dl>
                        </div>
                      </div>

                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={workflow.isActive}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: workflow.id, isActive: checked })}
                          data-testid={`switch-workflow-${workflow.id}`}
                          aria-label={`${workflow.isActive ? "Deactivate" : "Activate"} workflow: ${workflow.name}`}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); handleEdit(workflow); }}
                          aria-label={`Edit workflow: ${workflow.name}`}
                          data-testid={`button-edit-${workflow.id}`}
                        >
                          <Edit className="w-4 h-4" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => { e.stopPropagation(); handleDelete(workflow); }}
                          aria-label={`Delete workflow: ${workflow.name}`}
                          data-testid={`button-delete-${workflow.id}`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <Card data-testid="card-empty-state">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <Workflow className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No workflows yet</h3>
            <p className="text-muted-foreground mb-4 max-w-md">
              Create your first workflow to automate repetitive tasks like sending emails,
              creating tasks, or updating records when specific events occur.
            </p>
            <Button onClick={handleCreate} data-testid="button-create-first-workflow">
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Create your first workflow
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Pre-built Templates */}
      {templates && templates.length > 0 && (
        <section
          className="mt-4"
          aria-labelledby="templates-heading"
          data-testid="section-workflow-templates"
        >
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary" aria-hidden="true" />
            <h2 id="templates-heading" className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
              Pre-built templates for land investing
            </h2>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3 list-none p-0 m-0">
            {templates.map((template) => {
              const alreadyInstalled = workflows?.some(
                (w) => w.name === template.name
              );
              return (
                <li key={template.id}>
                  <Card
                    className="hover-elevate h-full"
                    data-testid={`card-template-${template.id}`}
                  >
                    <CardContent className="p-4 flex flex-col gap-3 h-full">
                      <div className="flex items-start gap-2">
                        <div className="p-2 rounded-card bg-primary/10 text-primary shrink-0">
                          {TEMPLATE_CATEGORY_ICONS[template.category]}
                        </div>
                        <div>
                          <p className="font-semibold text-sm leading-tight">
                            {template.name}
                          </p>
                          <div className="flex items-center gap-1 flex-wrap mt-0.5">
                            <Badge variant="secondary" className="text-xs capitalize" aria-label={`Category: ${template.category}`}>
                              {template.category}
                            </Badge>
                            {!isLiveWorkflowTriggerEvent(template.trigger.event) && (
                              <Badge
                                variant="outline"
                                className="text-xs"
                                title={TRIGGER_NOT_LIVE_MESSAGE}
                                aria-label={`Trigger not yet live: ${TRIGGER_NOT_LIVE_MESSAGE}`}
                                data-testid={`badge-template-not-live-${template.id}`}
                              >
                                Not yet live
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground flex-1">
                        {template.description}
                        {!isLiveWorkflowTriggerEvent(template.trigger.event) && (
                          <span className="block mt-1 text-acr-warn">
                            {TRIGGER_NOT_LIVE_MESSAGE}
                          </span>
                        )}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {template.actions.length} action{template.actions.length !== 1 ? "s" : ""}
                        </span>
                        {alreadyInstalled ? (
                          <Badge variant="secondary" className="text-xs flex items-center gap-1" aria-label={`Template already installed: ${template.name}`}>
                            <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Installed
                          </Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleInstallTemplate(template.id)}
                            disabled={installingTemplateId === template.id}
                            aria-label={`Install template: ${template.name}`}
                            data-testid={`button-install-template-${template.id}`}
                          >
                            {installingTemplateId === template.id ? (
                              <Loader2 className="w-3 h-3 animate-spin mr-1" aria-hidden="true" />
                            ) : (
                              <Plus className="w-3 h-3 mr-1" aria-hidden="true" />
                            )}
                            Install
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </section>
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
        title="Delete workflow"
        description={`Are you sure you want to delete "${workflowToDelete?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={deleteMutation.isPending}
      />
    </PageShell>
  );
}
