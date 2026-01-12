import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Clock, PlayCircle, CheckCircle2, ListTodo, RefreshCw } from "lucide-react";
import { useStartPlaybook } from "@/hooks/use-playbooks";
import { useToast } from "@/hooks/use-toast";
import { Link, useLocation } from "wouter";
import type { PlaybookInstance } from "@shared/schema";

interface PlaybookTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  estimatedDuration: string;
  steps: Array<{
    id: string;
    title: string;
    description: string;
    actionType: string;
    actionLabel: string;
    actionUrl?: string;
    icon: string;
    estimatedMinutes: number;
  }>;
}

interface PlaybookCardProps {
  template: PlaybookTemplate;
  activeInstance?: PlaybookInstance | null;
  onStart?: (templateId: string) => void;
  onContinue?: (instanceId: number) => void;
}

export function PlaybookCard({ template, activeInstance, onStart, onContinue }: PlaybookCardProps) {
  const startPlaybook = useStartPlaybook();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const isInProgress = activeInstance && activeInstance.status === "in_progress";
  const isCompleted = activeInstance && activeInstance.status === "completed";
  
  const completedSteps = (activeInstance?.completedSteps as string[]) || [];
  const totalSteps = template.steps.length;
  const completedCount = completedSteps.length;
  const progressPercent = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;
  
  const getCategoryColor = (category: string) => {
    switch (category) {
      case "acquisition":
        return "bg-primary/10 text-primary border-primary/20";
      case "due_diligence":
        return "bg-accent/10 text-accent border-accent/20";
      case "disposition":
        return "bg-secondary text-secondary-foreground border-border";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };
  
  const getCategoryLabel = (category: string) => {
    switch (category) {
      case "acquisition":
        return "Acquisition";
      case "due_diligence":
        return "Due Diligence";
      case "disposition":
        return "Disposition";
      default:
        return category;
    }
  };
  
  const handleStart = async () => {
    if (onStart) {
      onStart(template.id);
    } else {
      try {
        await startPlaybook.mutateAsync({ templateId: template.id });
        toast({
          title: "Playbook Started",
          description: `"${template.name}" has been started. Good luck!`,
        });
        setLocation(`/playbooks/${template.id}`);
      } catch (error) {
        console.error("Failed to start playbook:", error);
        toast({
          title: "Error",
          description: "Failed to start playbook. Please try again.",
          variant: "destructive",
        });
      }
    }
  };
  
  const handleContinue = () => {
    if (onContinue && activeInstance) {
      onContinue(activeInstance.id);
    } else if (activeInstance) {
      setLocation(`/playbooks/${template.id}`);
    }
  };

  return (
    <Card 
      className="hover-elevate transition-all duration-200" 
      data-testid={`playbook-card-${template.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <Badge 
            variant="outline" 
            className={getCategoryColor(template.category)}
          >
            {getCategoryLabel(template.category)}
          </Badge>
          {isCompleted && (
            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              Completed
            </Badge>
          )}
          {isInProgress && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/20">
              In Progress
            </Badge>
          )}
        </div>
        <CardTitle className="text-lg mt-2">{template.name}</CardTitle>
        <CardDescription className="line-clamp-2">
          {template.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            <span>{template.estimatedDuration}</span>
          </div>
          <div className="flex items-center gap-1">
            <ListTodo className="w-4 h-4" />
            <span>{totalSteps} steps</span>
          </div>
        </div>
        
        {isInProgress && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{completedCount}/{totalSteps}</span>
            </div>
            <Progress value={progressPercent} className="h-2" />
          </div>
        )}
        
        <div className="flex gap-2">
          {isInProgress ? (
            <Button 
              className="flex-1" 
              onClick={handleContinue}
              data-testid={`button-continue-playbook-${template.id}`}
            >
              <PlayCircle className="w-4 h-4 mr-2" />
              Continue
            </Button>
          ) : !isCompleted ? (
            <Button 
              className="flex-1" 
              onClick={handleStart}
              disabled={startPlaybook.isPending}
              data-testid={`button-start-playbook-${template.id}`}
            >
              <PlayCircle className="w-4 h-4 mr-2" />
              {startPlaybook.isPending ? "Starting..." : "Start Playbook"}
            </Button>
          ) : (
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={handleStart}
              disabled={startPlaybook.isPending}
              data-testid={`button-restart-playbook-${template.id}`}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {startPlaybook.isPending ? "Starting..." : "Restart Playbook"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
