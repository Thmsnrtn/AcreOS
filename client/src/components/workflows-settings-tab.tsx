// WorkflowsSettingsTab — Automations tab for Settings page
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { WorkflowBuilder } from "@/components/workflow-builder";
import { Plus, Zap, Trash2, ChevronRight, Edit2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Workflow } from "@shared/schema";

const TRIGGER_LABELS: Record<string, string> = {
  "lead.created": "New Lead Created",
  "lead.updated": "Lead Updated",
  "lead.status_changed": "Lead Status Changed",
  "property.created": "New Property Added",
  "property.updated": "Property Updated",
  "property.status_changed": "Property Status Changed",
  "deal.created": "New Deal Created",
  "deal.updated": "Deal Updated",
  "deal.stage_changed": "Deal Stage Changed",
  "payment.received": "Payment Received",
  "payment.missed": "Payment Missed",
};

export function WorkflowsSettingsTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);

  const { data: workflows = [], isLoading } = useQuery<Workflow[]>({
    queryKey: ["/api/workflows"],
    staleTime: 30_000,
  });

  const createMut = useMutation({
    mutationFn: async (data: any) => {
      const r = await fetch("/api/workflows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed to create");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/workflows"] });
      setBuilderOpen(false);
      toast({ title: "Workflow created" });
    },
    onError: () => toast({ title: "Failed to save workflow", variant: "destructive" }),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const r = await fetch(`/api/workflows/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed to update");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/workflows"] });
      setBuilderOpen(false);
      setEditingWorkflow(null);
      toast({ title: "Workflow updated" });
    },
    onError: () => toast({ title: "Failed to update workflow", variant: "destructive" }),
  });

  const toggleMut = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/workflows/${id}/toggle`, { method: "POST", credentials: "include" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/workflows"] }),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: number) => {
      await fetch(`/api/workflows/${id}`, { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/workflows"] });
      toast({ title: "Workflow deleted" });
    },
  });

  const handleSave = (data: any) => {
    if (editingWorkflow) {
      updateMut.mutate({ id: editingWorkflow.id, data });
    } else {
      createMut.mutate(data);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold">Automations</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automatically trigger actions when events happen in your business.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => { setEditingWorkflow(null); setBuilderOpen(true); }}
          className="gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" /> New Workflow
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      ) : workflows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <Zap className="w-8 h-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No automations yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Create your first workflow to automate tasks, emails, and notifications.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-4"
              onClick={() => { setEditingWorkflow(null); setBuilderOpen(true); }}
            >
              Create first workflow
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {workflows.map((wf) => (
            <Card key={wf.id} className={wf.isActive ? "" : "opacity-60"}>
              <CardContent className="py-3 px-4">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{wf.name}</span>
                      {!wf.isActive && (
                        <Badge variant="secondary" className="text-[10px] h-4">Paused</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                      <span>{TRIGGER_LABELS[wf.trigger?.event] ?? wf.trigger?.event}</span>
                      <ChevronRight className="w-3 h-3" />
                      <span>{wf.actions?.length ?? 0} action{(wf.actions?.length ?? 0) !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Switch
                      checked={wf.isActive ?? true}
                      onCheckedChange={() => toggleMut.mutate(wf.id)}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => { setEditingWorkflow(wf); setBuilderOpen(true); }}
                      aria-label="Edit workflow"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteMut.mutate(wf.id)}
                      aria-label="Delete workflow"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <WorkflowBuilder
        open={builderOpen}
        onOpenChange={(v) => { setBuilderOpen(v); if (!v) setEditingWorkflow(null); }}
        workflow={editingWorkflow}
        onSave={handleSave}
        isSaving={createMut.isPending || updateMut.isPending}
      />
    </div>
  );
}
