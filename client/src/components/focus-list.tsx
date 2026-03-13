import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Flame, Sun, Snowflake, Skull, Phone, Mail, MessageSquare, Target, Loader2, CheckCircle, ArrowRight, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Lead } from "@shared/schema";

type LeadWithScore = Lead & {
  score: number;
  nurturingStage: string;
  scoreFactors?: Record<string, number>;
};

function getStageIcon(stage: string) {
  switch (stage) {
    case "hot":
      return <Flame className="w-3 h-3" />;
    case "warm":
      return <Sun className="w-3 h-3" />;
    case "cold":
      return <Snowflake className="w-3 h-3" />;
    default:
      return <Skull className="w-3 h-3" />;
  }
}

function getStageStyle(stage: string) {
  switch (stage) {
    case "hot":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
    case "warm":
      return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "cold":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    default:
      return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
  }
}

// Determine the recommended next action based on lead data
interface NextAction {
  type: "call" | "email" | "sms" | "research";
  label: string;
  reason: string;
  priority: "high" | "medium" | "low";
}

function getNextAction(lead: LeadWithScore): NextAction {
  const hasPhone = !!lead.phone;
  const hasEmail = !!lead.email;
  const neverContacted = !lead.lastContactedAt;
  const stage = lead.nurturingStage;
  const status = lead.status;
  
  // Hot leads: prioritize direct contact
  if (stage === "hot") {
    if (hasPhone) {
      return {
        type: "call",
        label: "Call now",
        reason: neverContacted ? "Hot lead, never contacted" : "Hot lead, ready to engage",
        priority: "high",
      };
    }
    if (hasEmail) {
      return {
        type: "email",
        label: "Send email",
        reason: "Hot lead, no phone - email urgently",
        priority: "high",
      };
    }
    return {
      type: "research",
      label: "Find contact",
      reason: "Hot lead but missing contact info",
      priority: "high",
    };
  }
  
  // Warm leads: balanced approach
  if (stage === "warm") {
    if (status === "contacting" && hasPhone) {
      return {
        type: "call",
        label: "Follow up call",
        reason: "Continue conversation",
        priority: "medium",
      };
    }
    if (hasEmail) {
      return {
        type: "email",
        label: "Send email",
        reason: neverContacted ? "Introduce yourself" : "Check in with email",
        priority: "medium",
      };
    }
    if (hasPhone) {
      return {
        type: "sms",
        label: "Send SMS",
        reason: "Quick text to re-engage",
        priority: "medium",
      };
    }
    return {
      type: "research",
      label: "Research lead",
      reason: "Gather more info before outreach",
      priority: "low",
    };
  }
  
  // Cold leads: gentle nurturing
  if (hasEmail) {
    return {
      type: "email",
      label: "Nurture email",
      reason: "Keep relationship warm",
      priority: "low",
    };
  }
  if (hasPhone) {
    return {
      type: "sms",
      label: "Check-in text",
      reason: "Light touch to stay top of mind",
      priority: "low",
    };
  }
  return {
    type: "research",
    label: "Update info",
    reason: "Missing contact details",
    priority: "low",
  };
}

function getActionIcon(type: NextAction["type"]) {
  switch (type) {
    case "call":
      return <Phone className="w-3 h-3" />;
    case "email":
      return <Mail className="w-3 h-3" />;
    case "sms":
      return <MessageSquare className="w-3 h-3" />;
    case "research":
      return <Target className="w-3 h-3" />;
  }
}

function getPriorityStyle(priority: NextAction["priority"]) {
  switch (priority) {
    case "high":
      return "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800";
    case "medium":
      return "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-300 dark:border-yellow-800";
    case "low":
      return "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700";
  }
}

export function FocusList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: focusLeads, isLoading } = useQuery<LeadWithScore[]>({
    queryKey: ["/api/leads/focus"],
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const markContactedMutation = useMutation({
    mutationFn: async (leadId: number) => {
      const res = await fetch(`/api/leads/${leadId}/mark-contacted`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to mark as contacted");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads/focus"] });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({
        title: "Lead updated",
        description: "Marked as contacted - great follow-up!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update lead",
        variant: "destructive",
      });
    },
  });

  // Mutation for marking lead as contacted
  const recordContactMutation = useMutation({
    mutationFn: async ({ leadId, method }: { leadId: number; method: string }) => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/record-contact`, { method });
      if (!res.ok) {
        throw new Error("Failed to record contact");
      }
      return res.json();
    },
    onMutate: async ({ leadId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["/api/leads/focus"] });
      
      // Snapshot previous value
      const previousLeads = queryClient.getQueryData<LeadWithScore[]>(["/api/leads/focus"]);
      
      // Optimistically remove the lead from the focus list
      queryClient.setQueryData<LeadWithScore[]>(["/api/leads/focus"], (old) => 
        old?.filter((lead) => lead.id !== leadId) ?? []
      );
      
      return { previousLeads };
    },
    onSuccess: () => {
      // Invalidate leads list to reflect the updated lastContactedAt
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      
      toast({
        title: "Contact recorded",
        description: "Lead marked as contacted.",
      });
    },
    onError: (error, _, context) => {
      // Roll back on error
      if (context?.previousLeads) {
        queryClient.setQueryData(["/api/leads/focus"], context.previousLeads);
      }
      toast({
        title: "Error",
        description: "Failed to record contact. Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ["/api/leads/focus"] });
    },
  });

  const handleMarkContacted = (lead: LeadWithScore, method: string = "manual") => {
    recordContactMutation.mutate({ leadId: lead.id, method });
  };

  const handleCall = (lead: LeadWithScore) => {
    if (lead.phone) {
      window.open(`tel:${lead.phone}`, "_self");
      // Auto-mark as contacted when calling
      handleMarkContacted(lead, "call");
    }
  };

  const handleEmail = (lead: LeadWithScore) => {
    if (lead.email) {
      window.open(`mailto:${lead.email}`, "_blank");
      // Auto-mark as contacted when emailing
      handleMarkContacted(lead, "email");
    }
  };

  const handleSMS = (lead: LeadWithScore) => {
    if (lead.phone) {
      window.open(`sms:${lead.phone}`, "_self");
      // Auto-mark as contacted when texting
      handleMarkContacted(lead, "sms");
    }
  };

  const executeAction = (lead: LeadWithScore, action: NextAction) => {
    switch (action.type) {
      case "call":
        handleCall(lead);
        break;
      case "email":
        handleEmail(lead);
        break;
      case "sms":
        handleSMS(lead);
        break;
      case "research":
        // Could navigate to lead detail in future
        break;
    }
  };

  if (isLoading) {
    return (
      <Card data-testid="focus-list-loading">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" />
            Daily Focus
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!focusLeads || focusLeads.length === 0) {
    return (
      <Card data-testid="focus-list-empty">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" />
            Daily Focus
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mx-auto mb-3">
              <Sparkles className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              All caught up!
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              No leads need follow-up today
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="focus-list">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Target className="w-4 h-4" />
          Daily Focus
          <Badge variant="secondary" className="ml-auto text-xs">
            {focusLeads.length}
          </Badge>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Top leads not contacted in 24h
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {focusLeads.map((lead) => {
          const nextAction = getNextAction(lead);
          const isPending = recordContactMutation?.isPending &&
            recordContactMutation.variables?.leadId === lead.id;

          return (
            <div
              key={lead.id}
              className={`p-3 rounded-lg border bg-card transition-shadow ${
                isPending ? "opacity-50" : "hover:shadow-sm"
              }`}
              data-testid={`focus-lead-${lead.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">
                      {lead.firstName} {lead.lastName}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className={`text-xs border-0 flex items-center gap-1 ${getStageStyle(lead.nurturingStage)}`}
                          data-testid={`badge-score-${lead.id}`}
                        >
                          {getStageIcon(lead.nurturingStage)}
                          {lead.nurturingStage}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <span>Score: {lead.score}/100</span>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {lead.lastContactedAt ? (
                      <>Last contact: {formatDistanceToNow(new Date(lead.lastContactedAt), { addSuffix: true })}</>
                    ) : (
                      <>Never contacted</>
                    )}
                  </div>
                </div>
              <div className="flex items-center gap-1 shrink-0">
                {lead.phone && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleCall(lead)}
                          disabled={isPending}
                          data-testid={`button-call-${lead.id}`}
                        >
                          <Phone className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Call & mark contacted</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => handleSMS(lead)}
                          disabled={isPending}
                          data-testid={`button-sms-${lead.id}`}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>SMS & mark contacted</TooltipContent>
                    </Tooltip>
                  </>
                )}
                {lead.email && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => handleEmail(lead)}
                        disabled={isPending}
                        data-testid={`button-email-${lead.id}`}
                      >
                        <Mail className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Email & mark contacted</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30"
                      onClick={() => handleMarkContacted ? handleMarkContacted(lead, "manual") : markContactedMutation.mutate(lead.id)}
                      disabled={isPending || markContactedMutation?.isPending}
                      data-testid={`button-mark-contacted-${lead.id}`}
                    >
                      {isPending || markContactedMutation?.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Mark as contacted</TooltipContent>
                </Tooltip>
              </div>
              </div>

              {/* Next Action Guidance */}
              <div className="mt-2 pt-2 border-t border-dashed">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => executeAction(lead, nextAction)}
                      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs font-medium border transition-colors hover:opacity-90 ${getPriorityStyle(nextAction.priority)}`}
                      data-testid={`button-next-action-${lead.id}`}
                    >
                      <span className="flex items-center gap-1.5">
                        {getActionIcon(nextAction.type)}
                        {nextAction.label}
                      </span>
                      <ArrowRight className="w-3 h-3 opacity-60" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <span>{nextAction.reason}</span>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
