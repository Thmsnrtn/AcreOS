import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Link } from "wouter";
import { 
  CheckCircle2, Circle, ChevronDown, ChevronRight, Clock, 
  MapPin, FileSpreadsheet, Search, Mail, MessageSquare, FileSearch, DollarSign, Handshake,
  UserCheck, FileText, Receipt, Ruler, Leaf, Building, Route, Plug,
  Image, TrendingUp, Share2, Users, MessageCircle, ClipboardCheck, Calculator, FileSignature
} from "lucide-react";
import type { PlaybookTemplate, PlaybookStep, PlaybookInstance } from "@shared/schema";

const iconMap: Record<string, any> = {
  MapPin, FileSpreadsheet, Search, Mail, MessageSquare, FileSearch, DollarSign, Handshake,
  UserCheck, FileText, Receipt, Ruler, Leaf, Building, Route, Plug,
  Image, TrendingUp, Share2, Users, MessageCircle, ClipboardCheck, Calculator, FileSignature,
  CheckCircle2, Circle,
};

interface PlaybookStepsProps {
  template: PlaybookTemplate;
  instance: PlaybookInstance;
  onCompleteStep: (stepId: string) => void;
  onUncompleteStep?: (stepId: string) => void;
}

export function PlaybookSteps({ template, instance, onCompleteStep, onUncompleteStep }: PlaybookStepsProps) {
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  
  const completedSteps = new Set((instance.completedSteps as string[]) || []);
  const totalSteps = template.steps.length;
  const completedCount = completedSteps.size;
  const progressPercent = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;
  
  const toggleExpand = (stepId: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };
  
  const getStepStatus = (stepId: string, index: number): "completed" | "current" | "pending" => {
    if (completedSteps.has(stepId)) return "completed";
    
    const previousSteps = template.steps.slice(0, index);
    const allPreviousCompleted = previousSteps.every(s => completedSteps.has(s.id));
    
    if (allPreviousCompleted) return "current";
    return "pending";
  };
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-500 border-green-500";
      case "current":
        return "bg-primary border-primary";
      case "pending":
      default:
        return "bg-muted border-muted-foreground/30";
    }
  };
  
  const getLineColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-500";
      default:
        return "bg-muted-foreground/20";
    }
  };
  
  const StepIcon = ({ iconName, status }: { iconName: string; status: string }) => {
    if (status === "completed") {
      return <CheckCircle2 className="w-5 h-5 text-white" aria-hidden="true" />;
    }
    const Icon = iconMap[iconName] || Circle;
    return <Icon className={`w-5 h-5 ${status === "current" ? "text-white" : "text-muted-foreground"}`} aria-hidden="true" />;
  };

  return (
    <Card data-testid="playbook-steps-container">
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle>{template.name}</CardTitle>
            <CardDescription>{template.description}</CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0 tabular-nums" aria-label={`${completedCount} of ${totalSteps} steps completed`}>
            <span className="tabular-nums">{completedCount}</span>/<span className="tabular-nums">{totalSteps}</span> completed
          </Badge>
        </div>
        <Progress
          value={progressPercent}
          className="mt-4"
          aria-label={`Playbook progress: ${completedCount} of ${totalSteps} steps complete`}
          aria-valuenow={Math.round(progressPercent)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </CardHeader>
      <CardContent>
        <ol aria-label="Playbook steps" className="relative list-none p-0 m-0">
          {template.steps.map((step, index) => {
            const status = getStepStatus(step.id, index);
            const isExpanded = expandedSteps.has(step.id);
            const isLast = index === template.steps.length - 1;
            
            const statusLabel = status === "completed" ? "completed" : status === "current" ? "in progress" : "pending";

            return (
              <li
                key={step.id}
                className="relative list-none"
                data-testid={`playbook-step-${step.id}`}
                aria-label={`Step ${index + 1} of ${totalSteps}: ${step.title} — ${statusLabel}`}
              >
                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div
                      aria-hidden="true"
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${getStatusColor(status)}`}
                    >
                      <StepIcon iconName={step.icon} status={status} />
                    </div>
                    {!isLast && (
                      <div aria-hidden="true" className={`w-0.5 flex-1 min-h-[24px] ${getLineColor(status)}`} />
                    )}
                  </div>

                  <div className="flex-1 pb-6">
                    <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(step.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <CollapsibleTrigger
                          className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                          aria-label={`${isExpanded ? "Collapse" : "Expand"} step: ${step.title}`}
                        >
                          <div>
                            <h4 className={`font-medium ${status === "completed" ? "line-through text-muted-foreground" : ""}`}>
                              {step.title}
                            </h4>
                            {step.estimatedMinutes && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5" aria-label={`Estimated ${step.estimatedMinutes} minutes`}>
                                <Clock className="w-3 h-3" aria-hidden="true" />
                                <span>~<span className="tabular-nums">{step.estimatedMinutes}</span> min</span>
                              </div>
                            )}
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                          )}
                        </CollapsibleTrigger>

                        {status === "completed" && onUncompleteStep && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onUncompleteStep(step.id)}
                            className="text-muted-foreground"
                            aria-label={`Undo completion of ${step.title}`}
                          >
                            Undo
                          </Button>
                        )}
                      </div>
                      
                      <CollapsibleContent className="pt-3">
                        <p className="text-sm text-muted-foreground mb-4">
                          {step.description}
                        </p>
                        
                        <div className="flex gap-2 flex-wrap">
                          {status !== "completed" && (
                            <>
                              {step.actionUrl ? (
                                <Button
                                  asChild
                                  size="sm"
                                  data-testid={`button-action-${step.id}`}
                                >
                                  <Link href={step.actionUrl} aria-label={`${step.actionLabel}: ${step.title}`}>
                                    {step.actionLabel}
                                  </Link>
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onCompleteStep(step.id)}
                                  data-testid={`button-complete-${step.id}`}
                                  aria-label={`${step.actionLabel}: ${step.title}`}
                                >
                                  <CheckCircle2 className="w-4 h-4 mr-1" aria-hidden="true" />
                                  {step.actionLabel}
                                </Button>
                              )}

                              {step.actionUrl && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() => onCompleteStep(step.id)}
                                  data-testid={`button-mark-complete-${step.id}`}
                                  aria-label={`Mark complete: ${step.title}`}
                                >
                                  <CheckCircle2 className="w-4 h-4 mr-1" aria-hidden="true" />
                                  Mark complete
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
