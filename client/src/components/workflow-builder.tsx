import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Plus, 
  Trash2, 
  ChevronDown, 
  ChevronUp, 
  Zap, 
  Mail, 
  ListTodo, 
  Database, 
  Brain, 
  Bell, 
  Clock,
  Loader2,
  ArrowDown,
  GripVertical
} from "lucide-react";
import type { 
  Workflow, 
  WorkflowTrigger, 
  WorkflowAction, 
  WorkflowTriggerEvent, 
  WorkflowActionType 
} from "@shared/schema";

const TRIGGER_OPTIONS: { value: WorkflowTriggerEvent; label: string; description: string }[] = [
  { value: "lead.created", label: "Lead Created", description: "When a new lead is added to the system" },
  { value: "lead.updated", label: "Lead Updated", description: "When any lead field is modified" },
  { value: "lead.status_changed", label: "Lead Status Changed", description: "When a lead's status changes" },
  { value: "property.created", label: "Property Created", description: "When a new property is added" },
  { value: "property.updated", label: "Property Updated", description: "When property details change" },
  { value: "property.status_changed", label: "Property Status Changed", description: "When property status changes" },
  { value: "deal.created", label: "Deal Created", description: "When a new deal is started" },
  { value: "deal.updated", label: "Deal Updated", description: "When deal information is updated" },
  { value: "deal.stage_changed", label: "Deal Stage Changed", description: "When deal moves to a new stage" },
  { value: "payment.received", label: "Payment Received", description: "When a payment is recorded" },
  { value: "payment.missed", label: "Payment Missed", description: "When a payment becomes overdue" },
];

const ACTION_OPTIONS: { value: WorkflowActionType; label: string; icon: React.ElementType; description: string }[] = [
  { value: "send_email", label: "Send Email", icon: Mail, description: "Send an automated email" },
  { value: "create_task", label: "Create Task", icon: ListTodo, description: "Create a task for your team" },
  { value: "update_record", label: "Update Record", icon: Database, description: "Update a lead, property, or deal" },
  { value: "run_agent_skill", label: "Run Agent Skill", icon: Brain, description: "Execute an AI agent skill" },
  { value: "send_notification", label: "Send Notification", icon: Bell, description: "Send an in-app notification" },
  { value: "delay", label: "Delay", icon: Clock, description: "Wait before the next action" },
];

const CONDITION_OPERATORS = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does not equal" },
  { value: "contains", label: "Contains" },
  { value: "greater_than", label: "Greater than" },
  { value: "less_than", label: "Less than" },
  { value: "in", label: "Is in" },
  { value: "not_in", label: "Is not in" },
];

type Condition = {
  field: string;
  operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "in" | "not_in";
  value: any;
};

interface WorkflowBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow?: Workflow | null;
  onSave: (data: { name: string; description: string; trigger: WorkflowTrigger; actions: WorkflowAction[] }) => void;
  isSaving?: boolean;
}

function generateId() {
  return `action_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function WorkflowBuilder({ open, onOpenChange, workflow, onSave, isSaving }: WorkflowBuilderProps) {
  const [name, setName] = useState(workflow?.name || "");
  const [description, setDescription] = useState(workflow?.description || "");
  const [triggerEvent, setTriggerEvent] = useState<WorkflowTriggerEvent | "">(workflow?.trigger?.event || "");
  const [conditions, setConditions] = useState<Condition[]>(workflow?.trigger?.conditions || []);
  const [actions, setActions] = useState<WorkflowAction[]>(workflow?.actions || []);
  const [expandedAction, setExpandedAction] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setDescription("");
    setTriggerEvent("");
    setConditions([]);
    setActions([]);
    setExpandedAction(null);
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const handleSave = () => {
    if (!name || !triggerEvent || actions.length === 0) return;

    onSave({
      name,
      description,
      trigger: {
        event: triggerEvent,
        conditions: conditions.length > 0 ? conditions : undefined,
      },
      actions,
    });
  };

  const addCondition = () => {
    setConditions([...conditions, { field: "", operator: "equals", value: "" }]);
  };

  const updateCondition = (index: number, updates: Partial<Condition>) => {
    setConditions(conditions.map((c, i) => (i === index ? { ...c, ...updates } : c)));
  };

  const removeCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };

  const addAction = (type: WorkflowActionType) => {
    const newAction: WorkflowAction = {
      id: generateId(),
      type,
      config: {},
    };
    setActions([...actions, newAction]);
    setExpandedAction(newAction.id);
  };

  const updateAction = (id: string, updates: Partial<WorkflowAction>) => {
    setActions(actions.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  };

  const removeAction = (id: string) => {
    setActions(actions.filter((a) => a.id !== id));
    if (expandedAction === id) setExpandedAction(null);
  };

  const moveAction = (index: number, direction: "up" | "down") => {
    if (direction === "up" && index === 0) return;
    if (direction === "down" && index === actions.length - 1) return;

    const newActions = [...actions];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    [newActions[index], newActions[targetIndex]] = [newActions[targetIndex], newActions[index]];
    setActions(newActions);
  };

  const getActionIcon = (type: WorkflowActionType) => {
    const option = ACTION_OPTIONS.find((o) => o.value === type);
    return option?.icon || Zap;
  };

  const renderActionConfig = (action: WorkflowAction) => {
    switch (action.type) {
      case "send_email":
        return (
          <div className="space-y-3" data-testid={`action-config-${action.id}`}>
            <div>
              <Label>To (email or template variable)</Label>
              <Input
                placeholder="{{lead.email}} or user@example.com"
                value={action.config.to || ""}
                onChange={(e) => updateAction(action.id, { config: { ...action.config, to: e.target.value } })}
                data-testid={`input-email-to-${action.id}`}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Use {"{{lead.email}}"} for dynamic recipient
              </p>
            </div>
            <div>
              <Label>Subject</Label>
              <Input
                placeholder="Welcome {{lead.firstName}}!"
                value={action.config.subject || ""}
                onChange={(e) => updateAction(action.id, { config: { ...action.config, subject: e.target.value } })}
                data-testid={`input-email-subject-${action.id}`}
              />
            </div>
            <div>
              <Label>Body</Label>
              <Textarea
                placeholder="Hi {{lead.firstName}}, thank you for your interest..."
                value={action.config.body || ""}
                onChange={(e) => updateAction(action.id, { config: { ...action.config, body: e.target.value } })}
                rows={4}
                data-testid={`textarea-email-body-${action.id}`}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Available variables: {"{{lead.firstName}}"}, {"{{lead.lastName}}"}, {"{{lead.email}}"}, {"{{property.address}}"}, {"{{deal.amount}}"}
              </p>
            </div>
          </div>
        );

      case "create_task":
        return (
          <div className="space-y-3" data-testid={`action-config-${action.id}`}>
            <div>
              <Label>Task Title</Label>
              <Input
                placeholder="Follow up with {{lead.firstName}}"
                value={action.config.title || ""}
                onChange={(e) => updateAction(action.id, { config: { ...action.config, title: e.target.value } })}
                data-testid={`input-task-title-${action.id}`}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                placeholder="Task description..."
                value={action.config.description || ""}
                onChange={(e) => updateAction(action.id, { config: { ...action.config, description: e.target.value } })}
                rows={2}
                data-testid={`textarea-task-description-${action.id}`}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Due in (days)</Label>
                <Input
                  type="number"
                  min={0}
                  placeholder="3"
                  value={action.config.dueInDays || ""}
                  onChange={(e) => updateAction(action.id, { config: { ...action.config, dueInDays: parseInt(e.target.value) || 0 } })}
                  data-testid={`input-task-due-${action.id}`}
                />
              </div>
              <div>
                <Label>Priority</Label>
                <Select
                  value={action.config.priority || "medium"}
                  onValueChange={(v) => updateAction(action.id, { config: { ...action.config, priority: v as "low" | "medium" | "high" } })}
                >
                  <SelectTrigger data-testid={`select-task-priority-${action.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );

      case "update_record":
        return (
          <div className="space-y-3" data-testid={`action-config-${action.id}`}>
            <div>
              <Label>Record Type</Label>
              <Select
                value={action.config.entityType || ""}
                onValueChange={(v) => updateAction(action.id, { config: { ...action.config, entityType: v as "lead" | "property" | "deal" } })}
              >
                <SelectTrigger data-testid={`select-record-type-${action.id}`}>
                  <SelectValue placeholder="Select record type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="property">Property</SelectItem>
                  <SelectItem value="deal">Deal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Field to Update</Label>
              <Input
                placeholder="status"
                value={Object.keys(action.config.updates || {})[0] || ""}
                onChange={(e) => {
                  const oldKey = Object.keys(action.config.updates || {})[0];
                  const value = action.config.updates?.[oldKey] || "";
                  updateAction(action.id, {
                    config: {
                      ...action.config,
                      updates: { [e.target.value]: value },
                    },
                  });
                }}
                data-testid={`input-record-field-${action.id}`}
              />
            </div>
            <div>
              <Label>New Value</Label>
              <Input
                placeholder="qualified"
                value={Object.values(action.config.updates || {})[0] || ""}
                onChange={(e) => {
                  const key = Object.keys(action.config.updates || {})[0] || "field";
                  updateAction(action.id, {
                    config: {
                      ...action.config,
                      updates: { [key]: e.target.value },
                    },
                  });
                }}
                data-testid={`input-record-value-${action.id}`}
              />
            </div>
          </div>
        );

      case "run_agent_skill":
        return (
          <div className="space-y-3" data-testid={`action-config-${action.id}`}>
            <div>
              <Label>Agent Skill</Label>
              <Select
                value={action.config.skillId || ""}
                onValueChange={(v) => updateAction(action.id, { config: { ...action.config, skillId: v } })}
              >
                <SelectTrigger data-testid={`select-skill-${action.id}`}>
                  <SelectValue placeholder="Select an AI skill" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="analyze_lead">Analyze Lead</SelectItem>
                  <SelectItem value="score_property">Score Property</SelectItem>
                  <SelectItem value="generate_offer">Generate Offer</SelectItem>
                  <SelectItem value="summarize_deal">Summarize Deal</SelectItem>
                  <SelectItem value="draft_email">Draft Email</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Additional Parameters (JSON)</Label>
              <Textarea
                placeholder='{"maxResults": 5}'
                value={JSON.stringify(action.config.skillParams || {}, null, 2)}
                onChange={(e) => {
                  try {
                    const params = JSON.parse(e.target.value);
                    updateAction(action.id, { config: { ...action.config, skillParams: params } });
                  } catch {
                    // Invalid JSON, ignore
                  }
                }}
                rows={2}
                data-testid={`textarea-skill-params-${action.id}`}
              />
            </div>
          </div>
        );

      case "send_notification":
        return (
          <div className="space-y-3" data-testid={`action-config-${action.id}`}>
            <div>
              <Label>Title</Label>
              <Input
                placeholder="New Lead Alert"
                value={action.config.title || ""}
                onChange={(e) => updateAction(action.id, { config: { ...action.config, title: e.target.value } })}
                data-testid={`input-notification-title-${action.id}`}
              />
            </div>
            <div>
              <Label>Message</Label>
              <Textarea
                placeholder="A new lead {{lead.firstName}} has been created"
                value={action.config.message || ""}
                onChange={(e) => updateAction(action.id, { config: { ...action.config, message: e.target.value } })}
                rows={2}
                data-testid={`textarea-notification-message-${action.id}`}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select
                value={action.config.notificationType || "info"}
                onValueChange={(v) => updateAction(action.id, { config: { ...action.config, notificationType: v as "info" | "success" | "warning" } })}
              >
                <SelectTrigger data-testid={`select-notification-type-${action.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case "delay": {
        const currentMinutes = action.config.delayMinutes || 0;
        const displayValue = currentMinutes >= 1440 && currentMinutes % 1440 === 0
          ? currentMinutes / 1440
          : currentMinutes >= 60 && currentMinutes % 60 === 0
            ? currentMinutes / 60
            : currentMinutes;
        const displayUnit = currentMinutes >= 1440 && currentMinutes % 1440 === 0
          ? "days"
          : currentMinutes >= 60 && currentMinutes % 60 === 0
            ? "hours"
            : "minutes";
            
        return (
          <div className="space-y-3" data-testid={`action-config-${action.id}`}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Amount</Label>
                <Input
                  type="number"
                  min={1}
                  placeholder="30"
                  value={displayValue || ""}
                  onChange={(e) => {
                    const amount = parseInt(e.target.value) || 0;
                    const multipliers: Record<string, number> = { minutes: 1, hours: 60, days: 1440 };
                    updateAction(action.id, { config: { ...action.config, delayMinutes: amount * multipliers[displayUnit] } });
                  }}
                  data-testid={`input-delay-amount-${action.id}`}
                />
              </div>
              <div>
                <Label>Unit</Label>
                <Select
                  value={displayUnit}
                  onValueChange={(v) => {
                    const multipliers: Record<string, number> = { minutes: 1, hours: 60, days: 1440 };
                    updateAction(action.id, {
                      config: {
                        ...action.config,
                        delayMinutes: displayValue * multipliers[v],
                      },
                    });
                  }}
                >
                  <SelectTrigger data-testid={`select-delay-unit-${action.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Minutes</SelectItem>
                    <SelectItem value="hours">Hours</SelectItem>
                    <SelectItem value="days">Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  const isValid = name && triggerEvent && actions.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col" data-testid="dialog-workflow-builder">
        <DialogHeader>
          <DialogTitle data-testid="text-builder-title">
            {workflow ? "Edit Workflow" : "Create Workflow"}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4">
          <div className="space-y-6 pb-4">
            {/* Basic Info */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="workflow-name">Workflow Name</Label>
                <Input
                  id="workflow-name"
                  placeholder="e.g., Welcome New Leads"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="input-workflow-name"
                />
              </div>
              <div>
                <Label htmlFor="workflow-description">Description (optional)</Label>
                <Textarea
                  id="workflow-description"
                  placeholder="What does this workflow do?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  data-testid="textarea-workflow-description"
                />
              </div>
            </div>

            {/* Trigger Section */}
            <Card data-testid="card-trigger-section">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-500" />
                  Trigger
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>When this happens...</Label>
                  <Select value={triggerEvent} onValueChange={(v) => setTriggerEvent(v as WorkflowTriggerEvent)}>
                    <SelectTrigger data-testid="select-trigger-event">
                      <SelectValue placeholder="Select a trigger event" />
                    </SelectTrigger>
                    <SelectContent>
                      {TRIGGER_OPTIONS.map((trigger) => (
                        <SelectItem key={trigger.value} value={trigger.value}>
                          <div className="flex flex-col">
                            <span>{trigger.label}</span>
                            <span className="text-xs text-muted-foreground">{trigger.description}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Conditions */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Conditions (optional)</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addCondition} data-testid="button-add-condition">
                      <Plus className="w-3 h-3 mr-1" /> Add Condition
                    </Button>
                  </div>
                  {conditions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No conditions. Workflow will run for all matching events.</p>
                  ) : (
                    <div className="space-y-2">
                      {conditions.map((condition, index) => (
                        <div key={index} className="flex items-center gap-2 flex-wrap">
                          {index > 0 && <Badge variant="secondary">AND</Badge>}
                          <Input
                            placeholder="field"
                            value={condition.field}
                            onChange={(e) => updateCondition(index, { field: e.target.value })}
                            className="w-24 flex-shrink-0"
                            data-testid={`input-condition-field-${index}`}
                          />
                          <Select value={condition.operator} onValueChange={(v: any) => updateCondition(index, { operator: v })}>
                            <SelectTrigger className="w-32" data-testid={`select-condition-operator-${index}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CONDITION_OPERATORS.map((op) => (
                                <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            placeholder="value"
                            value={condition.value}
                            onChange={(e) => updateCondition(index, { value: e.target.value })}
                            className="flex-1 min-w-[100px]"
                            data-testid={`input-condition-value-${index}`}
                          />
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeCondition(index)} data-testid={`button-remove-condition-${index}`}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Timeline/Flow Arrow */}
            {triggerEvent && (
              <div className="flex justify-center">
                <ArrowDown className="w-6 h-6 text-muted-foreground" />
              </div>
            )}

            {/* Actions Section */}
            <Card data-testid="card-actions-section">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ListTodo className="w-4 h-4 text-blue-500" />
                  Actions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {actions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Add actions that will run when the trigger fires.</p>
                ) : (
                  <div className="space-y-3">
                    {actions.map((action, index) => {
                      const ActionIcon = getActionIcon(action.type);
                      const isExpanded = expandedAction === action.id;
                      const actionOption = ACTION_OPTIONS.find((o) => o.value === action.type);

                      return (
                        <div key={action.id}>
                          <Card className="border" data-testid={`card-action-${action.id}`}>
                            <div
                              className="flex items-center gap-2 p-3 cursor-pointer hover-elevate rounded-t-md"
                              onClick={() => setExpandedAction(isExpanded ? null : action.id)}
                              data-testid={`action-header-${action.id}`}
                            >
                              <GripVertical className="w-4 h-4 text-muted-foreground" />
                              <Badge variant="outline" className="text-xs">
                                {index + 1}
                              </Badge>
                              <ActionIcon className="w-4 h-4" />
                              <span className="font-medium flex-1">{actionOption?.label || action.type}</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => { e.stopPropagation(); moveAction(index, "up"); }}
                                  disabled={index === 0}
                                  data-testid={`button-move-up-${action.id}`}
                                >
                                  <ChevronUp className="w-4 h-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => { e.stopPropagation(); moveAction(index, "down"); }}
                                  disabled={index === actions.length - 1}
                                  data-testid={`button-move-down-${action.id}`}
                                >
                                  <ChevronDown className="w-4 h-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={(e) => { e.stopPropagation(); removeAction(action.id); }}
                                  data-testid={`button-remove-action-${action.id}`}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </div>
                            {isExpanded && (
                              <div className="p-3 pt-0 border-t">
                                {renderActionConfig(action)}
                              </div>
                            )}
                          </Card>
                          {index < actions.length - 1 && (
                            <div className="flex justify-center py-1">
                              <ArrowDown className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add Action Dropdown */}
                <div className="pt-2">
                  <Label className="mb-2 block">Add Action</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {ACTION_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        variant="outline"
                        className="justify-start gap-2"
                        onClick={() => addAction(option.value)}
                        data-testid={`button-add-action-${option.value}`}
                      >
                        <option.icon className="w-4 h-4" />
                        <span className="truncate">{option.label}</span>
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 pt-4 border-t">
          <Button type="button" variant="outline" onClick={handleClose} data-testid="button-cancel">
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={!isValid || isSaving} data-testid="button-save-workflow">
            {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {workflow ? "Update Workflow" : "Create Workflow"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
