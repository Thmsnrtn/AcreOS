import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Flame, Sun, Snowflake, Skull, Phone, Mail, MessageSquare, Target, Loader2, CheckCircle } from "lucide-react";
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

export function FocusList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: focusLeads, isLoading } = useQuery<LeadWithScore[]>({
    queryKey: ["/api/leads/focus"],
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
            <CheckCircle className="w-8 h-8 mx-auto mb-2 text-green-500" />
            <p className="text-sm text-muted-foreground">
              All caught up! No leads need attention.
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
          const isPending = recordContactMutation.isPending && 
            recordContactMutation.variables?.leadId === lead.id;
          
          return (
            <div
              key={lead.id}
              className={`flex items-start gap-3 p-2 rounded-md transition-all ${
                isPending ? "opacity-50" : "hover-elevate"
              }`}
              data-testid={`focus-lead-${lead.id}`}
            >
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
                        {lead.score}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span>Score: {lead.score}/100 ({lead.nurturingStage})</span>
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
                      className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-900/20"
                      onClick={() => handleMarkContacted(lead, "manual")}
                      disabled={isPending}
                      data-testid={`button-mark-contacted-${lead.id}`}
                    >
                      {isPending ? (
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
          );
        })}
      </CardContent>
    </Card>
  );
}
