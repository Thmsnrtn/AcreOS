import { PageShell } from "@/components/page-shell";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Zap, 
  Plus, 
  Play,
  Pause,
  Trash2,
  Edit,
  Clock,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Workflow,
  Settings2,
  History
} from "lucide-react";
import { format } from "date-fns";
import type { AutomationRule, AutomationExecution } from "@shared/schema";

const TRIGGERS = [
  { value: "lead_created", label: "Lead Created", description: "When a new lead is added" },
  { value: "lead_status_changed", label: "Lead Status Changed", description: "When lead status updates" },
  { value: "deal_stage_changed", label: "Deal Stage Changed", description: "When deal moves to new stage" },
  { value: "payment_received", label: "Payment Received", description: "When a payment is recorded" },
  { value: "payment_missed", label: "Payment Missed", description: "When payment is overdue" },
  { value: "task_completed", label: "Task Completed", description: "When a task is marked done" },
  { value: "note_created", label: "Note Created", description: "When a note is added" },
  { value: "property_added", label: "Property Added", description: "When property is created" },
];

const CONDITIONS = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Not Equals" },
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Does Not Contain" },
  { value: "greater_than", label: "Greater Than" },
  { value: "less_than", label: "Less Than" },
  { value: "is_empty", label: "Is Empty" },
  { value: "is_not_empty", label: "Is Not Empty" },
];

const ACTIONS = [
  { value: "send_email", label: "Send Email", icon: "mail" },
  { value: "send_sms", label: "Send SMS", icon: "message" },
  { value: "create_task", label: "Create Task", icon: "check" },
  { value: "add_tag", label: "Add Tag", icon: "tag" },
  { value: "remove_tag", label: "Remove Tag", icon: "tag" },
  { value: "change_lead_status", label: "Change Lead Status", icon: "user" },
  { value: "change_deal_stage", label: "Change Deal Stage", icon: "git-branch" },
  { value: "notify_team", label: "Notify Team", icon: "bell" },
  { value: "assign_to", label: "Assign To", icon: "user-plus" },
  { value: "add_note", label: "Add Note", icon: "file-text" },
];

type Condition = {
  field: string;
  operator: string;
  value: string;
  logicalOperator?: "and" | "or";
};

type Action = {
  type: string;
  config: Record<string, any>;
};

export default function AutomationPage() {
  const { toast } = useToast();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedRule, setSelectedRule] = useState<AutomationRule | null>(null);
  const [wizardStep, setWizardStep] = useState(1);
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    trigger: "",
    conditions: [] as Condition[],
    actions: [] as Action[],
    isEnabled: true,
  });

  const { data: rules, isLoading } = useQuery<AutomationRule[]>({
    queryKey: ["/api/automation-rules"],
  });

  const { data: executions } = useQuery<AutomationExecution[]>({
    queryKey: ["/api/automation-executions"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const response = await apiRequest("POST", "/api/automation-rules", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      setIsCreateOpen(false);
      resetForm();
      toast({ title: "Rule created", description: "Automation rule has been created successfully." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<typeof formData> }) => {
      const response = await apiRequest("PUT", `/api/automation-rules/${id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      setIsEditOpen(false);
      setSelectedRule(null);
      resetForm();
      toast({ title: "Rule updated", description: "Automation rule has been updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      const response = await apiRequest("POST", `/api/automation-rules/${id}/toggle`, { enabled });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      toast({ title: "Rule updated", description: "Rule status has been changed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/automation-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/automation-rules"] });
      toast({ title: "Rule deleted", description: "Automation rule has been removed." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      trigger: "",
      conditions: [],
      actions: [],
      isEnabled: true,
    });
    setWizardStep(1);
  };

  const openEditDialog = (rule: AutomationRule) => {
    setSelectedRule(rule);
    setFormData({
      name: rule.name,
      description: rule.description || "",
      trigger: rule.trigger,
      conditions: (rule.conditions as Condition[]) || [],
      actions: (rule.actions as Action[]) || [],
      isEnabled: rule.isEnabled ?? true,
    });
    setWizardStep(1);
    setIsEditOpen(true);
  };

  const addCondition = () => {
    setFormData(prev => ({
      ...prev,
      conditions: [...prev.conditions, { field: "", operator: "equals", value: "", logicalOperator: "and" }],
    }));
  };

  const removeCondition = (index: number) => {
    setFormData(prev => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index),
    }));
  };

  const updateCondition = (index: number, updates: Partial<Condition>) => {
    setFormData(prev => ({
      ...prev,
      conditions: prev.conditions.map((c, i) => i === index ? { ...c, ...updates } : c),
    }));
  };

  const addAction = () => {
    setFormData(prev => ({
      ...prev,
      actions: [...prev.actions, { type: "", config: {} }],
    }));
  };

  const removeAction = (index: number) => {
    setFormData(prev => ({
      ...prev,
      actions: prev.actions.filter((_, i) => i !== index),
    }));
  };

  const updateAction = (index: number, updates: Partial<Action>) => {
    setFormData(prev => ({
      ...prev,
      actions: prev.actions.map((a, i) => i === index ? { ...a, ...updates } : a),
    }));
  };

  const handleSubmit = () => {
    if (selectedRule) {
      updateMutation.mutate({ id: selectedRule.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const RuleWizard = ({ onClose }: { onClose: () => void }) => (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        {[1, 2, 3].map((step) => (
          <div key={step} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              wizardStep >= step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}>
              {step}
            </div>
            {step < 3 && <ChevronRight className="w-4 h-4 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {wizardStep === 1 && (
        <div className="space-y-4">
          <div>
            <Label>Rule Name</Label>
            <Input
              placeholder="e.g., Welcome new leads"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              data-testid="input-rule-name"
            />
          </div>
          <div>
            <Label>Description (optional)</Label>
            <Textarea
              placeholder="Describe what this rule does..."
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              data-testid="input-rule-description"
            />
          </div>
          <div>
            <Label>Trigger Event</Label>
            <Select value={formData.trigger} onValueChange={(v) => setFormData(prev => ({ ...prev, trigger: v }))}>
              <SelectTrigger data-testid="select-trigger">
                <SelectValue placeholder="Select trigger..." />
              </SelectTrigger>
              <SelectContent>
                {TRIGGERS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex flex-col">
                      <span>{t.label}</span>
                      <span className="text-xs text-muted-foreground">{t.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {wizardStep === 2 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Conditions (Optional)</Label>
            <Button type="button" variant="outline" size="sm" onClick={addCondition} data-testid="button-add-condition">
              <Plus className="w-4 h-4 mr-1" /> Add Condition
            </Button>
          </div>
          
          {formData.conditions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No conditions set. Rule will trigger for all matching events.</p>
          ) : (
            <div className="space-y-3">
              {formData.conditions.map((condition, index) => (
                <div key={index} className="flex items-center gap-2 p-3 border rounded-lg">
                  {index > 0 && (
                    <Select 
                      value={condition.logicalOperator || "and"} 
                      onValueChange={(v) => updateCondition(index, { logicalOperator: v as "and" | "or" })}
                    >
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="and">AND</SelectItem>
                        <SelectItem value="or">OR</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                  <Input
                    placeholder="Field name"
                    value={condition.field}
                    onChange={(e) => updateCondition(index, { field: e.target.value })}
                    className="flex-1"
                  />
                  <Select value={condition.operator} onValueChange={(v) => updateCondition(index, { operator: v })}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    placeholder="Value"
                    value={condition.value}
                    onChange={(e) => updateCondition(index, { value: e.target.value })}
                    className="flex-1"
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeCondition(index)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {wizardStep === 3 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>Actions</Label>
            <Button type="button" variant="outline" size="sm" onClick={addAction} data-testid="button-add-action">
              <Plus className="w-4 h-4 mr-1" /> Add Action
            </Button>
          </div>
          
          {formData.actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add at least one action for this rule.</p>
          ) : (
            <div className="space-y-3">
              {formData.actions.map((action, index) => (
                <div key={index} className="p-3 border rounded-lg space-y-3">
                  <div className="flex items-center gap-2">
                    <Select value={action.type} onValueChange={(v) => updateAction(index, { type: v })}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select action..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ACTIONS.map((a) => (
                          <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeAction(index)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  {action.type === "send_email" && (
                    <div className="grid gap-2">
                      <Input
                        placeholder="Email subject"
                        value={action.config.subject || ""}
                        onChange={(e) => updateAction(index, { config: { ...action.config, subject: e.target.value } })}
                      />
                      <Textarea
                        placeholder="Email body"
                        value={action.config.body || ""}
                        onChange={(e) => updateAction(index, { config: { ...action.config, body: e.target.value } })}
                      />
                    </div>
                  )}
                  
                  {action.type === "create_task" && (
                    <div className="grid gap-2">
                      <Input
                        placeholder="Task title"
                        value={action.config.title || ""}
                        onChange={(e) => updateAction(index, { config: { ...action.config, title: e.target.value } })}
                      />
                      <Select 
                        value={action.config.priority || "medium"} 
                        onValueChange={(v) => updateAction(index, { config: { ...action.config, priority: v } })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Priority" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low</SelectItem>
                          <SelectItem value="medium">Medium</SelectItem>
                          <SelectItem value="high">High</SelectItem>
                          <SelectItem value="urgent">Urgent</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  
                  {action.type === "notify_team" && (
                    <Textarea
                      placeholder="Notification message"
                      value={action.config.message || ""}
                      onChange={(e) => updateAction(index, { config: { ...action.config, message: e.target.value } })}
                    />
                  )}
                  
                  {action.type === "add_tag" && (
                    <Input
                      placeholder="Tag name"
                      value={action.config.tag || ""}
                      onChange={(e) => updateAction(index, { config: { ...action.config, tag: e.target.value } })}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <DialogFooter className="gap-2">
        {wizardStep > 1 && (
          <Button type="button" variant="outline" onClick={() => setWizardStep(s => s - 1)}>
            Back
          </Button>
        )}
        {wizardStep < 3 ? (
          <Button 
            type="button" 
            onClick={() => setWizardStep(s => s + 1)}
            disabled={wizardStep === 1 && (!formData.name || !formData.trigger)}
          >
            Next
          </Button>
        ) : (
          <Button 
            type="button" 
            onClick={handleSubmit}
            disabled={formData.actions.length === 0 || createMutation.isPending || updateMutation.isPending}
            data-testid="button-save-rule"
          >
            {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {selectedRule ? "Update Rule" : "Create Rule"}
          </Button>
        )}
      </DialogFooter>
    </div>
  );

  return (
    <PageShell>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">Automation Rules</h1>
            <p className="text-muted-foreground">Automate workflows based on triggers and conditions</p>
          </div>
          
          <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} data-testid="button-create-rule">
            <Plus className="w-4 h-4 mr-2" /> Create Rule
          </Button>
        </div>

        <Tabs defaultValue="rules" className="space-y-4">
          <TabsList>
            <TabsTrigger value="rules" className="gap-2">
              <Workflow className="w-4 h-4" /> Rules
            </TabsTrigger>
            <TabsTrigger value="executions" className="gap-2">
              <History className="w-4 h-4" /> Execution Log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="rules" className="space-y-4">
            {isLoading ? (
              <Card>
                <CardContent className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : rules && rules.length > 0 ? (
              <div className="grid gap-4">
                {rules.map((rule) => (
                  <Card key={rule.id} data-testid={`card-rule-${rule.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold">{rule.name}</h3>
                            <Badge variant={rule.isEnabled ? "default" : "secondary"}>
                              {rule.isEnabled ? "Active" : "Paused"}
                            </Badge>
                          </div>
                          
                          {rule.description && (
                            <p className="text-sm text-muted-foreground">{rule.description}</p>
                          )}
                          
                          <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                            <span className="flex items-center gap-1">
                              <Zap className="w-4 h-4" />
                              {TRIGGERS.find(t => t.value === rule.trigger)?.label || rule.trigger}
                            </span>
                            <span className="flex items-center gap-1">
                              <Settings2 className="w-4 h-4" />
                              {(rule.actions as Action[])?.length || 0} action(s)
                            </span>
                            {rule.executionCount !== null && rule.executionCount > 0 && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                {rule.executionCount} runs
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={rule.isEnabled ?? true}
                            onCheckedChange={(checked) => toggleMutation.mutate({ id: rule.id, enabled: checked })}
                            data-testid={`switch-rule-${rule.id}`}
                          />
                          <Button variant="ghost" size="icon" onClick={() => openEditDialog(rule)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => deleteMutation.mutate(rule.id)}
                            disabled={deleteMutation.isPending}
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
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <Workflow className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No automation rules yet</h3>
                  <p className="text-muted-foreground mb-4">Create your first rule to automate your workflows</p>
                  <Button onClick={() => { resetForm(); setIsCreateOpen(true); }}>
                    <Plus className="w-4 h-4 mr-2" /> Create Rule
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="executions" className="space-y-4">
            {executions && executions.length > 0 ? (
              <div className="space-y-2">
                {executions.map((exec) => (
                  <Card key={exec.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          {exec.status === "completed" ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          ) : exec.status === "failed" ? (
                            <AlertCircle className="w-5 h-5 text-red-500" />
                          ) : (
                            <Clock className="w-5 h-5 text-amber-500" />
                          )}
                          <div>
                            <p className="font-medium">Rule #{exec.ruleId}</p>
                            <p className="text-sm text-muted-foreground">
                              {TRIGGERS.find(t => t.value === exec.trigger)?.label || exec.trigger}
                            </p>
                          </div>
                        </div>
                        <div className="text-right text-sm text-muted-foreground">
                          {exec.executedAt && format(new Date(exec.executedAt), "MMM d, yyyy h:mm a")}
                        </div>
                      </div>
                      {exec.error && (
                        <p className="text-sm text-red-500 mt-2">{exec.error}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                  <History className="w-12 h-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No executions yet</h3>
                  <p className="text-muted-foreground">Automation executions will appear here when rules are triggered</p>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Automation Rule</DialogTitle>
            </DialogHeader>
            <RuleWizard onClose={() => setIsCreateOpen(false)} />
          </DialogContent>
        </Dialog>

        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Automation Rule</DialogTitle>
            </DialogHeader>
            <RuleWizard onClose={() => setIsEditOpen(false)} />
          </DialogContent>
        </Dialog>
    </PageShell>
  );
}
