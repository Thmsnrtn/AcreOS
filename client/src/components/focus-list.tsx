import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Flame, Sun, Snowflake, Skull, Phone, Mail, MessageSquare, Target, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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
  const { data: focusLeads, isLoading } = useQuery<LeadWithScore[]>({
    queryKey: ["/api/leads/focus"],
  });

  const handleCall = (lead: LeadWithScore) => {
    if (lead.phone) {
      window.open(`tel:${lead.phone}`, "_self");
    }
  };

  const handleEmail = (lead: LeadWithScore) => {
    if (lead.email) {
      window.open(`mailto:${lead.email}`, "_blank");
    }
  };

  const handleSMS = (lead: LeadWithScore) => {
    if (lead.phone) {
      window.open(`sms:${lead.phone}`, "_self");
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
          <p className="text-sm text-muted-foreground text-center py-4">
            No leads need attention today
          </p>
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
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Top leads not contacted in 24h
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {focusLeads.map((lead) => (
          <div
            key={lead.id}
            className="flex items-start gap-3 p-2 rounded-md hover-elevate"
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
            <div className="flex items-center gap-1">
              {lead.phone && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleCall(lead)}
                        data-testid={`button-call-${lead.id}`}
                      >
                        <Phone className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Call</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleSMS(lead)}
                        data-testid={`button-sms-${lead.id}`}
                      >
                        <MessageSquare className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>SMS</TooltipContent>
                  </Tooltip>
                </>
              )}
              {lead.email && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleEmail(lead)}
                      data-testid={`button-email-${lead.id}`}
                    >
                      <Mail className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Email</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
