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
import { formatRelative } from "@/lib/format";

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
        <CardContent className="p-6" role="alert">
          <p className="text-muted-foreground">
            Couldn't load campaign analytics. Check your connection and reload — campaign data itself is unchanged.
          </p>
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
            <CardTitle className="text-base">Tracking code</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <code
                className="bg-muted px-2 py-1 rounded text-sm font-mono"
                data-testid="text-tracking-code"
              >
                {campaign.trackingCode}
              </code>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Use this code in your marketing materials to track responses.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Response rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold tabular-nums"
              data-testid="text-response-rate"
            >
              {metrics.responseRate}%
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums">{metrics.responsesCount}</span> response{metrics.responsesCount === 1 ? "" : "s"} from <span className="tabular-nums">{metrics.sent}</span> sent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cost per response</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold tabular-nums"
              data-testid="text-cost-per-response"
            >
              ${metrics.costPerResponse}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums">${(metrics.spent / 100).toFixed(2)}</span> total spent
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cost per acquisition</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <div
              className="text-2xl font-bold tabular-nums"
              data-testid="text-cost-per-acquisition"
            >
              ${metrics.costPerAcquisition}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="tabular-nums">{metrics.dealCount}</span> deal{metrics.dealCount !== 1 ? 's' : ''} from campaign
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversion funnel</CardTitle>
          <CardDescription>
            Track how recipients move through each stage.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4" data-testid="conversion-funnel">
            {funnel.map((stage, index) => {
              const conversionPct = index > 0 && funnel[index - 1].count > 0
                ? ((stage.count / funnel[index - 1].count) * 100).toFixed(1)
                : null;
              return (
                <div key={stage.stage} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium capitalize">{stage.stage}</span>
                      {index < funnel.length - 1 && (
                        <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
                      )}
                    </div>
                    <span
                      className="text-sm text-muted-foreground tabular-nums"
                      data-testid={`text-funnel-${stage.stage.toLowerCase()}`}
                    >
                      {stage.count.toLocaleString()}
                      {conversionPct && (
                        <span className="ml-1 text-xs">
                          ({conversionPct}%)
                        </span>
                      )}
                    </span>
                  </div>
                  <Progress
                    value={(stage.count / maxFunnelValue) * 100}
                    className="h-2"
                    aria-label={`${stage.stage}: ${stage.count.toLocaleString()}${conversionPct ? ` (${conversionPct}% conversion from previous stage)` : ""}`}
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent responses</CardTitle>
          <CardDescription>
            Inbound responses attributed to this campaign.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {responses.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No responses recorded yet.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="responses-list" aria-label="Recent responses">
              {responses.slice(0, 10).map((response) => {
                const IconComponent = channelIcons[response.channel] || MessageSquare;
                return (
                  <li
                    key={response.id}
                    className="flex items-start gap-3 p-3 rounded-card bg-muted/50"
                    data-testid={`response-item-${response.id}`}
                  >
                    <div className="p-2 rounded-full bg-background" aria-hidden="true">
                      <IconComponent className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs capitalize">
                          {response.channel}
                        </Badge>
                        {response.isAttributed && (
                          <Badge variant="secondary" className="text-xs">
                            Attributed
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground tabular-nums">
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
                            {response.contactEmail && <a href={`mailto:${response.contactEmail}`} className="underline-offset-2 hover:underline">{response.contactEmail}</a>}
                            {response.contactPhone && <> • <a href={`tel:${response.contactPhone.replace(/[^\d+]/g, '')}`} className="tabular-nums underline-offset-2 hover:underline">{response.contactPhone}</a></>}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* C2 receipts (experience-legibility.md): the rows behind the Sent
          number — same table the count reads, so they can never disagree. */}
      <DeliveryReceipts campaignId={campaignId} />
    </div>
  );
}

const SEND_CHANNEL_WORD: Record<string, string> = {
  direct_mail: "Letter",
  sms: "Text",
  email: "Email",
};

function DeliveryReceipts({ campaignId }: { campaignId: number }) {
  const { data, isLoading, error } = useQuery<{
    rows: Array<{ at: string | null; channel: string; status: string; leadName: string | null }>;
  }>({
    queryKey: ['/api/campaigns', campaignId, 'delivery-events'],
    staleTime: 30_000,
  });
  return (
    <Card data-testid="campaign-delivery-receipts">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Every send</CardTitle>
        <CardDescription>
          Each piece this campaign has sent, newest first — the rows the Sent number is made of.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : error ? (
          <p className="text-sm text-muted-foreground">
            Couldn't load the send list right now — the counts above still come from the same records.
          </p>
        ) : !data || data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="delivery-receipts-empty">
            No sends yet. When this campaign sends its first piece, every one will be listed here.
          </p>
        ) : (
          <ul className="space-y-2" role="list">
            {data.rows.map((r, i) => (
              <li key={i} className="flex items-baseline gap-2 text-sm">
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground w-20">
                  {r.at ? formatRelative(r.at) : "—"}
                </span>
                <span className="min-w-0">
                  {SEND_CHANNEL_WORD[r.channel] ?? r.channel} to {r.leadName ?? "a lead"}
                  <span className="text-muted-foreground"> — {r.status}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default CampaignAnalytics;
