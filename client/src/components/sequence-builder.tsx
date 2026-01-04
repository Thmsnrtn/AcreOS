import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, GripVertical, Mail, MessageSquare, FileText, Clock, ArrowDown } from "lucide-react";
import type { SequenceStep, InsertSequenceStep } from "@shared/schema";

export interface SequenceStepData {
  id?: number;
  stepNumber: number;
  delayDays: number;
  channel: "direct_mail" | "email" | "sms";
  templateId?: string;
  subject?: string;
  content: string;
  conditionType: "always" | "no_response" | "responded";
  conditionDays?: number;
}

interface SequenceBuilderProps {
  steps: SequenceStepData[];
  onStepsChange: (steps: SequenceStepData[]) => void;
  readOnly?: boolean;
}

const channelIcons: Record<string, any> = {
  email: Mail,
  sms: MessageSquare,
  direct_mail: FileText,
};

const channelLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  direct_mail: "Direct Mail",
};

const conditionLabels: Record<string, string> = {
  always: "Always send",
  no_response: "If no response",
  responded: "If responded",
};

function StepCard({
  step,
  index,
  onUpdate,
  onDelete,
  isFirst,
  isLast,
  readOnly,
}: {
  step: SequenceStepData;
  index: number;
  onUpdate: (step: SequenceStepData) => void;
  onDelete: () => void;
  isFirst: boolean;
  isLast: boolean;
  readOnly?: boolean;
}) {
  const ChannelIcon = channelIcons[step.channel] || Mail;

  return (
    <div className="relative">
      {!isFirst && (
        <div className="flex flex-col items-center py-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            <span>Wait {step.delayDays} day{step.delayDays !== 1 ? "s" : ""}</span>
          </div>
          <ArrowDown className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
      
      <Card data-testid={`card-sequence-step-${index}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {!readOnly && <GripVertical className="w-4 h-4 text-muted-foreground cursor-grab" />}
              <Badge variant="outline" className="gap-1">
                <ChannelIcon className="w-3 h-3" />
                {channelLabels[step.channel]}
              </Badge>
              <Badge variant="secondary">Step {step.stepNumber}</Badge>
            </div>
            {!readOnly && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onDelete}
                data-testid={`button-delete-step-${index}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Channel</Label>
              <Select
                value={step.channel}
                onValueChange={(value) => onUpdate({ ...step, channel: value as any })}
                disabled={readOnly}
              >
                <SelectTrigger data-testid={`select-channel-${index}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                  <SelectItem value="direct_mail">Direct Mail</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Delay (days)</Label>
              <Input
                type="number"
                min={0}
                value={step.delayDays}
                onChange={(e) => onUpdate({ ...step, delayDays: parseInt(e.target.value) || 0 })}
                disabled={readOnly}
                data-testid={`input-delay-${index}`}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Condition</Label>
              <Select
                value={step.conditionType}
                onValueChange={(value) => onUpdate({ ...step, conditionType: value as any })}
                disabled={readOnly}
              >
                <SelectTrigger data-testid={`select-condition-${index}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="always">Always send</SelectItem>
                  <SelectItem value="no_response">If no response within X days</SelectItem>
                  <SelectItem value="responded">If responded</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {step.conditionType === "no_response" && (
              <div className="space-y-2">
                <Label>Check after (days)</Label>
                <Input
                  type="number"
                  min={1}
                  value={step.conditionDays || 3}
                  onChange={(e) => onUpdate({ ...step, conditionDays: parseInt(e.target.value) || 3 })}
                  disabled={readOnly}
                  data-testid={`input-condition-days-${index}`}
                />
              </div>
            )}
          </div>

          {(step.channel === "email" || step.channel === "direct_mail") && (
            <div className="space-y-2">
              <Label>Subject</Label>
              <Input
                value={step.subject || ""}
                onChange={(e) => onUpdate({ ...step, subject: e.target.value })}
                placeholder="Enter subject line..."
                disabled={readOnly}
                data-testid={`input-subject-${index}`}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label>Content</Label>
            <Textarea
              value={step.content}
              onChange={(e) => onUpdate({ ...step, content: e.target.value })}
              placeholder="Enter message content..."
              rows={4}
              disabled={readOnly}
              data-testid={`textarea-content-${index}`}
            />
            <p className="text-xs text-muted-foreground">
              Use placeholders: {"{{firstName}}"}, {"{{lastName}}"}, {"{{propertyAddress}}"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function SequenceBuilder({ steps, onStepsChange, readOnly }: SequenceBuilderProps) {
  const addStep = () => {
    const newStep: SequenceStepData = {
      stepNumber: steps.length + 1,
      delayDays: steps.length === 0 ? 0 : 3,
      channel: "email",
      content: "",
      conditionType: "always",
    };
    onStepsChange([...steps, newStep]);
  };

  const updateStep = (index: number, updatedStep: SequenceStepData) => {
    const newSteps = [...steps];
    newSteps[index] = updatedStep;
    onStepsChange(newSteps);
  };

  const deleteStep = (index: number) => {
    const newSteps = steps.filter((_, i) => i !== index);
    newSteps.forEach((step, i) => {
      step.stepNumber = i + 1;
    });
    onStepsChange(newSteps);
  };

  return (
    <div className="space-y-4" data-testid="container-sequence-builder">
      {steps.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <p className="mb-4">No steps yet. Add your first step to start building the sequence.</p>
            {!readOnly && (
              <Button onClick={addStep} data-testid="button-add-first-step">
                <Plus className="w-4 h-4 mr-2" />
                Add First Step
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          {steps.map((step, index) => (
            <StepCard
              key={step.id || index}
              step={step}
              index={index}
              onUpdate={(updated) => updateStep(index, updated)}
              onDelete={() => deleteStep(index)}
              isFirst={index === 0}
              isLast={index === steps.length - 1}
              readOnly={readOnly}
            />
          ))}
          
          {!readOnly && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={addStep} data-testid="button-add-step">
                <Plus className="w-4 h-4 mr-2" />
                Add Step
              </Button>
            </div>
          )}
        </>
      )}
      
      {steps.length > 0 && (
        <div className="mt-6 p-4 bg-muted rounded-md">
          <h4 className="font-medium mb-2">Sequence Timeline Preview</h4>
          <div className="text-sm text-muted-foreground">
            {steps.map((step, index) => {
              const totalDays = steps.slice(0, index + 1).reduce((acc, s) => acc + s.delayDays, 0);
              return (
                <div key={index} className="flex items-center gap-2 py-1">
                  <Badge variant="outline" className="w-20 justify-center">Day {totalDays}</Badge>
                  <span>
                    {channelLabels[step.channel]} 
                    {step.conditionType !== "always" && ` (${conditionLabels[step.conditionType]})`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
