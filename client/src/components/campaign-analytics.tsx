import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  TrendingUp, 
  DollarSign, 
  Users, 
  Mail, 
  Phone, 
  MessageSquare, 
  Globe, 
  ArrowRight,
  Target
} from "lucide-react";
import { format } from "date-fns";

interface CampaignAnalyticsProps {
  campaignId: number;
}

interface AnalyticsData {
  campaign: {
    id: number;
    name: string;
    type: string;
    trackingCode: string | null;
    totalSent: number;
    totalDelivered: number;
    totalOpened: number;
    totalClicked: number;
    totalResponded: number;
    spent: string;
  };
  metrics: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    responded: number;
    responsesCount: number;
    dealCount: number;
    responseRate: string;
    costPerResponse: string;
    costPerAcquisition: string;
    spent: number;
  };
  funnel: Array<{
    stage: string;
    count: number;
  }>;
  responses: Array<{
    id: number;
    channel: string;
    responseDate: string;
    content: string | null;
    isAttributed: boolean;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  }>;
}

const channelIcons: Record<string, typeof Phone> = {
  call: Phone,
  text: MessageSquare,
  email: Mail,
  webform: Globe,
};

export function CampaignAnalytics({ campaignId }: CampaignAnalyticsProps) {
  const { data, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ['/api/campaigns', campaignId, 'analytics'],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground">Failed to load analytics data</p>
        </CardContent>
      </Card>
    );
  }

  const { metrics, funnel, responses, campaign } = data;

  const maxFunnelValue = Math.max(...funnel.map(f => f.count), 1);

  return (
    <div className="space-y-6" data-testid="campaign-analytics">
      {campaign.trackingCode && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tracking Code</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <code 
                className="bg-muted px-2 py-1 rounded text-sm font-mono"
                data-testid="text-tracking-code"
              >
                {campaign.trackingCode}
              </code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Use this code in your marketing materials to track responses
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Response Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div 
              className="text-2xl font-bold" 
              data-testid="text-response-rate"
            >
              {metrics.responseRate}%
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics.responsesCount} responses from {metrics.sent} sent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cost per Response</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div 
              className="text-2xl font-bold" 
              data-testid="text-cost-per-response"
            >
              ${metrics.costPerResponse}
            </div>
            <p className="text-xs text-muted-foreground">
              ${(metrics.spent / 100).toFixed(2)} total spent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cost per Acquisition</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div 
              className="text-2xl font-bold" 
              data-testid="text-cost-per-acquisition"
            >
              ${metrics.costPerAcquisition}
            </div>
            <p className="text-xs text-muted-foreground">
              {metrics.dealCount} deal{metrics.dealCount !== 1 ? 's' : ''} from campaign
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversion Funnel</CardTitle>
          <CardDescription>
            Track how recipients move through each stage
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4" data-testid="conversion-funnel">
            {funnel.map((stage, index) => (
              <div key={stage.stage} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{stage.stage}</span>
                    {index < funnel.length - 1 && (
                      <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    )}
                  </div>
                  <span 
                    className="text-sm text-muted-foreground"
                    data-testid={`text-funnel-${stage.stage.toLowerCase()}`}
                  >
                    {stage.count.toLocaleString()}
                    {index > 0 && funnel[index - 1].count > 0 && (
                      <span className="ml-1 text-xs">
                        ({((stage.count / funnel[index - 1].count) * 100).toFixed(1)}%)
                      </span>
                    )}
                  </span>
                </div>
                <Progress 
                  value={(stage.count / maxFunnelValue) * 100} 
                  className="h-2"
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent Responses</CardTitle>
          <CardDescription>
            Inbound responses attributed to this campaign
          </CardDescription>
        </CardHeader>
        <CardContent>
          {responses.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No responses recorded yet
            </p>
          ) : (
            <div className="space-y-3" data-testid="responses-list">
              {responses.slice(0, 10).map((response) => {
                const IconComponent = channelIcons[response.channel] || MessageSquare;
                return (
                  <div 
                    key={response.id} 
                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/50"
                    data-testid={`response-item-${response.id}`}
                  >
                    <div className="p-2 rounded-full bg-background">
                      <IconComponent className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {response.channel}
                        </Badge>
                        {response.isAttributed && (
                          <Badge variant="secondary" className="text-xs">
                            Attributed
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(response.responseDate), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      <div className="mt-1">
                        {response.contactName && (
                          <p className="text-sm font-medium">{response.contactName}</p>
                        )}
                        {response.content && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {response.content}
                          </p>
                        )}
                        {(response.contactEmail || response.contactPhone) && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {response.contactEmail} {response.contactPhone && `• ${response.contactPhone}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default CampaignAnalytics;
