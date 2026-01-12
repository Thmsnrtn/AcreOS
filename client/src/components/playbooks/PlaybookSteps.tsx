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
      return <CheckCircle2 className="w-5 h-5 text-white" />;
    }
    const Icon = iconMap[iconName] || Circle;
    return <Icon className={`w-5 h-5 ${status === "current" ? "text-white" : "text-muted-foreground"}`} />;
  };

  return (
    <Card data-testid="playbook-steps-container">
      <CardHeader>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <CardTitle>{template.name}</CardTitle>
            <CardDescription>{template.description}</CardDescription>
          </div>
          <Badge variant="outline" className="shrink-0">
            {completedCount}/{totalSteps} completed
          </Badge>
        </div>
        <Progress value={progressPercent} className="mt-4" />
      </CardHeader>
      <CardContent>
        <div className="relative">
          {template.steps.map((step, index) => {
            const status = getStepStatus(step.id, index);
            const isExpanded = expandedSteps.has(step.id);
            const isLast = index === template.steps.length - 1;
            
            return (
              <div 
                key={step.id} 
                className="relative"
                data-testid={`playbook-step-${step.id}`}
              >
                <div className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div 
                      className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${getStatusColor(status)}`}
                    >
                      <StepIcon iconName={step.icon} status={status} />
                    </div>
                    {!isLast && (
                      <div className={`w-0.5 flex-1 min-h-[24px] ${getLineColor(status)}`} />
                    )}
                  </div>
                  
                  <div className="flex-1 pb-6">
                    <Collapsible open={isExpanded} onOpenChange={() => toggleExpand(step.id)}>
                      <div className="flex items-start justify-between gap-2">
                        <CollapsibleTrigger className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity">
                          <div>
                            <h4 className={`font-medium ${status === "completed" ? "line-through text-muted-foreground" : ""}`}>
                              {step.title}
                            </h4>
                            {step.estimatedMinutes && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                <Clock className="w-3 h-3" />
                                <span>~{step.estimatedMinutes} min</span>
                              </div>
                            )}
                          </div>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                          )}
                        </CollapsibleTrigger>
                        
                        {status === "completed" && onUncompleteStep && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => onUncompleteStep(step.id)}
                            className="text-muted-foreground"
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
                                <Link href={step.actionUrl}>
                                  <Button 
                                    size="sm"
                                    data-testid={`button-action-${step.id}`}
                                  >
                                    {step.actionLabel}
                                  </Button>
                                </Link>
                              ) : (
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => onCompleteStep(step.id)}
                                  data-testid={`button-complete-${step.id}`}
                                >
                                  <CheckCircle2 className="w-4 h-4 mr-1" />
                                  {step.actionLabel}
                                </Button>
                              )}
                              
                              {step.actionUrl && (
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={() => onCompleteStep(step.id)}
                                  data-testid={`button-mark-complete-${step.id}`}
                                >
                                  <CheckCircle2 className="w-4 h-4 mr-1" />
                                  Mark Complete
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
