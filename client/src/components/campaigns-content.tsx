import { useCampaigns, useCreateCampaign, useUpdateCampaign, useDirectMailStatus, useUpdateMailMode, useSendDirectMail, useMailEstimate, useCampaignOptimizations, useOptimizeCampaign, useMarkOptimizationImplemented, useCampaignResponseTrend, useMailAttribution, useTestSendCampaign } from "@/hooks/use-campaigns";
import { usd } from "@/lib/format";
import { useLeads } from "@/hooks/use-leads";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertCampaignSchema, type Campaign, type CampaignOptimization } from "@shared/schema";
import { z } from "zod";
import { CampaignAnalytics } from "@/components/campaign-analytics";
import { AbTestManager } from "@/components/ab-test-manager";
import { CampaignVariantsPanel } from "@/components/campaign-variants-panel";

const campaignFormSchema = insertCampaignSchema.omit({ organizationId: true });
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Mail, MessageSquare, Send, Calendar, BarChart3, Users, Clock, Play, Pause, CheckCircle, FileText, Target, TrendingUp, Eye, TestTube, Zap, AlertTriangle, DollarSign, Loader2, Lightbulb, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ErrorBoundary } from "@/components/error-boundary";
import { ListSkeleton } from "@/components/list-skeleton";
import { FirstHelloEmpty } from "@/components/empty-states";
import { QueryErrorState } from "@/components/query-error-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

const campaignTypes = [
  { value: 'direct_mail', label: 'Direct Mail', icon: Mail },
  { value: 'email', label: 'Email', icon: Send },
  { value: 'sms', label: 'SMS', icon: MessageSquare },
] as const;

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  scheduled: 'bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent',
  active: 'bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos',
  paused: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn',
  completed: 'bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand',
};

const pieceTypes = [
  { value: 'postcard_4x6', label: 'Postcard 4x6', cost: 0.75 },
  { value: 'postcard_6x9', label: 'Postcard 6x9', cost: 0.95 },
  { value: 'postcard_6x11', label: 'Postcard 6x11', cost: 1.15 },
  { value: 'letter_1_page', label: 'Letter (1 page)', cost: 1.25 },
] as const;

const campaignTemplates = {
  direct_mail: [
    {
      id: 'dm_neutral',
      name: 'Neutral Offer',
      description: 'Professional inquiry without stating a specific price',
      subject: 'Interested in Your Property',
      content: `Dear {{firstName}} {{lastName}},

My name is [Your Name] and I am a land investor interested in purchasing property in {{county}} County, {{state}}.

I recently came across your parcel (APN: {{apn}}) and wanted to reach out to see if you might be interested in selling.

I purchase land for cash and can close quickly with no fees or commissions on your end. If you're open to discussing a sale, please give me a call or text at [Your Phone] or email me at [Your Email].

I look forward to hearing from you.

Best regards,
[Your Name]
[Your Company]`,
    },
    {
      id: 'dm_blind',
      name: 'Blind Offer',
      description: 'Specific cash offer without revealing how you found them',
      subject: 'Cash Offer for Your {{county}} County Land',
      content: `Dear {{firstName}} {{lastName}},

I am writing to make you a cash offer of \${{offerAmount}} for your property located in {{county}} County, {{state}} (APN: {{apn}}).

This is a no-obligation offer. If you accept:
- I pay all closing costs
- No realtor commissions
- Close in as little as 14 days
- Payment by cashier's check or wire transfer

If you're interested, simply sign the enclosed Purchase Agreement and return it in the prepaid envelope provided.

Questions? Call me directly at [Your Phone].

Sincerely,
[Your Name]
[Your Company]`,
    },
    {
      id: 'dm_followup',
      name: 'Follow-Up Mailer',
      description: 'Second touch for non-responders',
      subject: 'Second Notice: Offer for Your Land',
      content: `Dear {{firstName}} {{lastName}},

I recently sent you a letter expressing my interest in purchasing your property in {{county}} County, {{state}}.

I wanted to follow up in case my first letter didn't reach you or got lost in the mail. My offer still stands, and I remain very interested in your parcel.

If you've been thinking about selling, I'd love to chat. Even if you're not ready to sell right now, feel free to reach out - I'm always happy to answer questions.

Call or text: [Your Phone]
Email: [Your Email]

Best regards,
[Your Name]`,
    },
  ],
  email: [
    {
      id: 'email_neutral',
      name: 'Neutral Inquiry',
      description: 'Professional email inquiry about selling',
      subject: 'Quick Question About Your {{county}} County Property',
      content: `Hi {{firstName}},

I came across your property in {{county}} County and wanted to reach out to see if you might be interested in selling.

I'm a land investor and I purchase properties for cash with quick, hassle-free closings.

Would you be open to a brief conversation? I'd be happy to answer any questions you might have.

Best,
[Your Name]
[Your Phone]`,
    },
    {
      id: 'email_blind',
      name: 'Blind Offer Email',
      description: 'Direct cash offer via email',
      subject: 'Cash Offer: $' + '{{offerAmount}} for Your Land',
      content: `Hi {{firstName}},

I'd like to make you a cash offer of \${{offerAmount}} for your property in {{county}} County, {{state}}.

Here's what I offer:
- All cash, no financing contingencies
- I cover closing costs
- Close in 2-3 weeks
- No realtor fees

If this interests you, just reply to this email or call me at [Your Phone].

No pressure either way - just let me know!

[Your Name]
[Your Company]`,
    },
    {
      id: 'email_nurture',
      name: 'Nurture Sequence',
      description: 'Relationship-building email for warm leads',
      subject: 'Checking In - {{county}} County Property',
      content: `Hi {{firstName}},

I wanted to check in and see how things are going. I know selling land is a big decision, and I'm here whenever you're ready to talk.

In the meantime, if you have any questions about the process, property values in your area, or anything else - feel free to reach out. I'm happy to help with no obligation.

Have a great week!

[Your Name]
[Your Phone]`,
    },
  ],
  sms: [
    {
      id: 'sms_neutral',
      name: 'Neutral Text',
      description: 'Simple inquiry text message',
      subject: '',
      content: `Hi {{firstName}}, this is [Your Name]. I'm interested in buying land in {{county}} County and came across your property. Would you consider selling? No pressure - just reply YES if you'd like to chat.`,
    },
    {
      id: 'sms_blind',
      name: 'Blind Offer Text',
      description: 'Direct offer via text',
      subject: '',
      content: `Hi {{firstName}}, I'd like to offer \${{offerAmount}} cash for your {{county}} County property. I pay all closing costs & can close in 2 weeks. Interested? Reply YES or call [Your Phone].`,
    },
    {
      id: 'sms_followup',
      name: 'Follow-Up Text',
      description: 'Quick follow-up for non-responders',
      subject: '',
      content: `Hi {{firstName}}, just following up on my offer for your {{county}} County land. Still interested in selling? Let me know - [Your Name]`,
    },
  ],
} as const;

// ─── Sparkline: 7-day response trend ─────────────────────────────────────────

function SparklineTrend({ campaignId }: { campaignId: number }) {
  const { data: trend } = useCampaignResponseTrend(campaignId);

  if (!trend || trend.every((d) => d.count === 0)) return null;

  const max = Math.max(...trend.map((d) => d.count), 1);
  const width = 80;
  const height = 28;
  const gap = width / (trend.length - 1);

  const points = trend
    .map((d, i) => {
      const x = i * gap;
      const y = height - (d.count / max) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const totalThisWeek = trend.reduce((s, d) => s + d.count, 0);

  return (
    <div className="flex items-center gap-2 mt-3">
      <svg
        width={width}
        height={height}
        className="text-acr-pos shrink-0"
        role="img"
        aria-label={`7-day response trend: ${totalThisWeek} responses`}
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
      </svg>
      <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
        {totalThisWeek} responses (7d)
      </span>
    </div>
  );
}

// ─── AI Optimizer Suggestions Panel ──────────────────────────────────────────

const priorityConfig: Record<string, { label: string; className: string }> = {
  high: { label: "High", className: "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg" },
  medium: { label: "Medium", className: "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn" },
  low: { label: "Low", className: "bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent" },
};

const typeIcons: Record<string, React.ReactNode> = {
  content: <FileText className="w-3.5 h-3.5" aria-hidden="true" />,
  timing: <Clock className="w-3.5 h-3.5" aria-hidden="true" />,
  audience: <Users className="w-3.5 h-3.5" aria-hidden="true" />,
  budget: <DollarSign className="w-3.5 h-3.5" aria-hidden="true" />,
};

function OptimizerSuggestionsPanel({ campaign }: { campaign: Campaign }) {
  const { data: suggestions, isLoading } = useCampaignOptimizations(campaign.id);
  const optimizeMutation = useOptimizeCampaign();
  const implementMutation = useMarkOptimizationImplemented();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(true);

  const pending = suggestions?.filter((s) => !s.implemented) ?? [];
  const done = suggestions?.filter((s) => s.implemented) ?? [];

  const handleRunOptimizer = async () => {
    try {
      const result = await optimizeMutation.mutateAsync(campaign.id);
      toast({
        title: "AI analysis complete",
        description: `Generated ${result.suggestionsGenerated} suggestions. Campaign score: ${result.score}/100.`,
      });
    } catch (err: any) {
      toast({ title: "Couldn't run AI analysis", description: `${err.message} — your existing suggestions are unchanged.`, variant: "destructive" });
    }
  };

  const handleImplement = async (suggestion: CampaignOptimization) => {
    try {
      await implementMutation.mutateAsync({ optimizationId: suggestion.id, campaignId: campaign.id });
      toast({ title: "Marked as implemented", description: suggestion.suggestion.slice(0, 80) });
    } catch (err: any) {
      toast({ title: "Couldn't mark as implemented", description: `${err.message} — the suggestion's status is unchanged.`, variant: "destructive" });
    }
  };

  const suggestionsRegionId = `optimizer-suggestions-${campaign.id}`;

  return (
    <Card className="glass-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-acr-warn" aria-hidden="true" />
            AI optimization suggestions
            {pending.length > 0 && (
              <Badge className="bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn ml-1 tabular-nums">
                {pending.length}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunOptimizer}
              disabled={optimizeMutation.isPending}
              data-testid="button-run-optimizer"
            >
              {optimizeMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
              )}
              {optimizeMutation.isPending ? "Analyzing…" : "Run AI analysis"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "Collapse suggestions" : "Expand suggestions"}
              aria-expanded={expanded}
              aria-controls={suggestionsRegionId}
            >
              {expanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            </Button>
          </div>
        </div>
        {campaign.optimizationScore != null && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">Optimization score</span>
            <div className="flex-1 max-w-[120px]">
              <Progress value={campaign.optimizationScore} className="h-1.5" />
            </div>
            <span className="text-xs font-medium tabular-nums">{campaign.optimizationScore}/100</span>
          </div>
        )}
      </CardHeader>

      {expanded && (
        <CardContent id={suggestionsRegionId} className="pt-0 space-y-3">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Loading suggestions…
            </div>
          )}

          {!isLoading && pending.length === 0 && done.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              No suggestions yet. Run AI analysis to generate recommendations.
            </p>
          )}

          {pending.map((s) => {
            const pc = priorityConfig[s.priority] ?? priorityConfig.medium;
            return (
              <div
                key={s.id}
                className="rounded-lg border bg-muted/30 p-3 space-y-1.5"
                data-testid={`suggestion-${s.id}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-muted-foreground">{typeIcons[s.type] ?? <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />}</span>
                  <span className="text-xs capitalize font-medium text-muted-foreground">{s.type}</span>
                  <Badge className={`text-xs ${pc.className}`}>{pc.label} priority</Badge>
                </div>
                <p className="text-sm font-medium leading-snug">{s.suggestion}</p>
                <p className="text-xs text-muted-foreground leading-snug">{s.reasoning}</p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-1 h-7 text-xs"
                  onClick={() => handleImplement(s)}
                  disabled={implementMutation.isPending}
                  data-testid={`button-implement-${s.id}`}
                >
                  <CheckCircle className="w-3 h-3 mr-1" aria-hidden="true" />
                  Mark implemented
                </Button>
              </div>
            );
          })}

          {done.length > 0 && (
            <details className="text-xs text-muted-foreground cursor-pointer">
              <summary className="select-none hover:text-foreground transition-colors">
                {done.length} implemented suggestion{done.length !== 1 ? "s" : ""}
              </summary>
              <div className="mt-2 space-y-2">
                {done.map((s) => (
                  <div key={s.id} className="rounded-lg border border-dashed p-2 opacity-60">
                    <div className="flex items-center gap-1.5 mb-1">
                      <CheckCircle className="w-3 h-3 text-acr-pos" aria-hidden="true" />
                      <span className="capitalize">{s.type}</span>
                    </div>
                    <p className="leading-snug">{s.suggestion}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function MailModeIndicator() {
  const { data: mailStatus, isLoading } = useDirectMailStatus();
  const updateModeMutation = useUpdateMailMode();
  const { toast } = useToast();

  if (isLoading || !mailStatus) return null;

  if (!mailStatus.isConfigured) {
    return (
      <Card className="glass-panel border-acr-warn-soft dark:border-acr-warn-soft">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-acr-warn" aria-hidden="true" />
            <div>
              <p className="font-medium">Direct mail not configured</p>
              <p className="text-sm text-muted-foreground">Add your Lob API key in settings to enable direct mail.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isTestMode = mailStatus.currentMode === 'test';
  const canSwitchToLive = mailStatus.hasLiveMode;

  const handleModeChange = async (checked: boolean) => {
    const newMode = checked ? 'live' : 'test';
    try {
      await updateModeMutation.mutateAsync(newMode);
      toast({
        title: newMode === 'live' ? 'Live mode enabled' : 'Test mode enabled',
        description: newMode === 'live'
          ? 'Mail will now be sent and billed.'
          : 'Mail pieces are simulated — no actual mail is sent.',
      });
    } catch (error: any) {
      toast({
        title: 'Failed to switch mode',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className={`glass-panel ${isTestMode ? 'border-acr-accent dark:border-acr-accent' : 'border-acr-pos-soft dark:border-acr-pos-soft'}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {isTestMode ? (
              <TestTube className="w-5 h-5 text-acr-accent" aria-hidden="true" />
            ) : (
              <Zap className="w-5 h-5 text-acr-pos" aria-hidden="true" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">
                  {isTestMode ? 'Test mode' : 'Live mode'}
                </p>
                <Badge className={isTestMode ? 'bg-acr-accent text-acr-accent' : 'bg-acr-pos-soft text-acr-pos'}>
                  {isTestMode ? 'Safe' : 'Active'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {isTestMode
                  ? 'Mail pieces are simulated — no actual mail is sent.'
                  : 'Real mail will be sent and costs will be deducted.'}
              </p>
            </div>
          </div>
          {canSwitchToLive && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Test</span>
              <Switch
                checked={!isTestMode}
                onCheckedChange={handleModeChange}
                disabled={updateModeMutation.isPending}
                aria-label={`Switch to ${isTestMode ? 'live' : 'test'} mode`}
                data-testid="switch-mail-mode"
              />
              <span className="text-sm text-muted-foreground">Live</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function CampaignsContent() {
  const { data: campaigns, isLoading, error, refetch } = useCampaigns();
  const { data: leads } = useLeads();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  const activeCampaigns = campaigns?.filter(c => c.status === 'active') || [];
  const totalSent = campaigns?.reduce((sum, c) => sum + (c.totalSent || 0), 0) || 0;
  const totalResponded = campaigns?.reduce((sum, c) => sum + (c.totalResponded || 0), 0) || 0;
  const responseRate = totalSent > 0 ? ((totalResponded / totalSent) * 100).toFixed(1) : '0';

  if (error) {
    return (
      <QueryErrorState
        error={error as Error}
        onRetry={() => refetch()}
        title="Failed to load campaigns"
        testId="error-state-campaigns"
      />
    );
  }

  return (
    <div className="space-y-8" data-testid="campaigns-content">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-campaigns-title">Campaigns</h2>
          <p className="text-muted-foreground">Manage direct mail, email, and SMS campaigns.</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-campaign">
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> New campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] floating-window">
            <DialogHeader>
              <DialogTitle>New campaign</DialogTitle>
              <DialogDescription>Set up a direct mail, email, or SMS campaign for your leads.</DialogDescription>
            </DialogHeader>
            <CampaignForm onSuccess={() => setIsCreateOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      <MailModeIndicator />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="glass-panel">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-primary/10">
                <Target className="w-5 h-5 text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active campaigns</p>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-active-campaigns">{activeCampaigns.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-acr-accent/10">
                <Send className="w-5 h-5 text-acr-accent" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total sent</p>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-total-sent">{totalSent.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-acr-pos/10">
                <TrendingUp className="w-5 h-5 text-acr-pos" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Response rate</p>
                <p className="text-2xl font-bold text-acr-pos tabular-nums" data-testid="text-response-rate">{responseRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-acr-brand/10">
                <Users className="w-5 h-5 text-acr-brand" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Available leads</p>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-available-leads">{leads?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All campaigns</TabsTrigger>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
          <TabsTrigger value="completed">Completed</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <CampaignList 
            campaigns={campaigns || []} 
            isLoading={isLoading}
            onSelect={setSelectedCampaign}
            onCreateNew={() => setIsCreateOpen(true)}
          />
        </TabsContent>
        <TabsContent value="active" className="mt-4">
          <CampaignList 
            campaigns={campaigns?.filter(c => c.status === 'active') || []} 
            isLoading={isLoading}
            onSelect={setSelectedCampaign}
            onCreateNew={() => setIsCreateOpen(true)}
          />
        </TabsContent>
        <TabsContent value="scheduled" className="mt-4">
          <CampaignList 
            campaigns={campaigns?.filter(c => c.status === 'scheduled') || []} 
            isLoading={isLoading}
            onSelect={setSelectedCampaign}
            onCreateNew={() => setIsCreateOpen(true)}
          />
        </TabsContent>
        <TabsContent value="completed" className="mt-4">
          <CampaignList 
            campaigns={campaigns?.filter(c => c.status === 'completed') || []} 
            isLoading={isLoading}
            onSelect={setSelectedCampaign}
            onCreateNew={() => setIsCreateOpen(true)}
          />
        </TabsContent>
      </Tabs>

      {selectedCampaign && (
        // r4 Wyatt STR-R4-002 safety net: the detail drawer historically
        // threw a TypeError during mount that bubbled to the global error
        // boundary, nuking the whole /campaigns surface. Local boundary
        // isolates the drawer so a bad render becomes "can't open this
        // campaign" instead of "can't use the Campaigns tab."
        <ErrorBoundary
          fallback={
            <Dialog open={true} onOpenChange={() => setSelectedCampaign(null)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Couldn't open campaign</DialogTitle>
                  <DialogDescription>
                    Couldn't load this campaign's detail view. The campaigns list is still usable — pick a different campaign or try again.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button onClick={() => setSelectedCampaign(null)}>Close</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          }
        >
          <CampaignDetailDrawer
            campaign={selectedCampaign}
            onClose={() => setSelectedCampaign(null)}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

function CampaignList({ campaigns, isLoading, onSelect, onCreateNew }: { 
  campaigns: Campaign[]; 
  isLoading: boolean;
  onSelect: (campaign: Campaign) => void;
  onCreateNew: () => void;
}) {
  if (isLoading) {
    return <ListSkeleton count={3} />;
  }

  if (campaigns.length === 0) {
    return (
      <FirstHelloEmpty
        surface="campaigns"
        cta={{
          primary: { label: "Create your first campaign", onClick: onCreateNew },
        }}
      />
    );
  }

  return (
    <div className="grid gap-4">
      {campaigns.map((campaign) => {
        const TypeIcon = campaignTypes.find(t => t.value === campaign.type)?.icon || Mail;
        const deliveryRate = campaign.totalSent ? ((campaign.totalDelivered || 0) / campaign.totalSent * 100).toFixed(0) : '0';
        
        return (
          <Card 
            key={campaign.id} 
            className="floating-window cursor-pointer hover-elevate"
            onClick={() => onSelect(campaign)}
            data-testid={`card-campaign-${campaign.id}`}
          >
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-muted">
                    <TypeIcon className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{campaign.name}</h3>
                    <p className="text-sm text-muted-foreground capitalize">{campaign.type?.replace(/_/g, ' ')}</p>
                  </div>
                </div>
                <Badge className={`capitalize ${statusColors[campaign.status] || statusColors.draft}`}>
                  {campaign.status}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Sent</p>
                  <p className="font-medium tabular-nums">{campaign.totalSent || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Delivered</p>
                  <p className="font-medium tabular-nums">{campaign.totalDelivered || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Opened</p>
                  <p className="font-medium tabular-nums">{campaign.totalOpened || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Responded</p>
                  <p className="font-medium text-acr-pos tabular-nums">{campaign.totalResponded || 0}</p>
                </div>
              </div>

              {campaign.totalSent ? (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Delivery rate</span>
                    <span className="tabular-nums">{deliveryRate}%</span>
                  </div>
                  <Progress value={Number(deliveryRate)} className="h-1.5" />
                </div>
              ) : null}

              <SparklineTrend campaignId={campaign.id} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function SendMailDialog({ 
  campaign, 
  availableLeads, 
  mailStatus, 
  onClose 
}: { 
  campaign: Campaign; 
  availableLeads: any[]; 
  mailStatus: { isConfigured: boolean; currentMode: 'test' | 'live' };
  onClose: () => void;
}) {
  const { toast } = useToast();
  const sendMutation = useSendDirectMail();
  const estimateMutation = useMailEstimate();
  const [pieceType, setPieceType] = useState<string>('postcard_4x6');
  const [selectedLeadIds, setSelectedLeadIds] = useState<number[]>(availableLeads.map(l => l.id));
  
  const fetchEstimate = () => {
    if (selectedLeadIds.length > 0) {
      estimateMutation.mutate({
        pieceType,
        recipientCount: selectedLeadIds.length,
      });
    }
  };

  useEffect(() => {
    fetchEstimate();
  }, []);

  const handlePieceTypeChange = (newType: string) => {
    setPieceType(newType);
    if (selectedLeadIds.length > 0) {
      estimateMutation.mutate({
        pieceType: newType,
        recipientCount: selectedLeadIds.length,
      });
    }
  };

  const handleSend = async () => {
    try {
      const result = await sendMutation.mutateAsync({
        campaignId: campaign.id,
        pieceType,
        leadIds: selectedLeadIds,
      });

      toast({
        title: result.isTestMode ? 'Test mail sent' : 'Mail sent',
        description: result.message,
      });
      onClose();
    } catch (error: any) {
      toast({
        title: 'Failed to send mail',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const isTestMode = mailStatus.currentMode === 'test';
  const selectedPiece = pieceTypes.find(p => p.value === pieceType);
  const estimatedCost = selectedPiece ? selectedLeadIds.length * selectedPiece.cost : 0;

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Send direct mail</DialogTitle>
          <DialogDescription>
            Send mail pieces for campaign: {campaign.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="piece-type-trigger">Mail piece type</Label>
            <Select value={pieceType} onValueChange={handlePieceTypeChange}>
              <SelectTrigger id="piece-type-trigger" aria-label="Mail piece type" data-testid="select-piece-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pieceTypes.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label} (${type.cost.toFixed(2)} each)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card className={isTestMode ? 'border-acr-accent dark:border-acr-accent' : 'border-acr-warn-soft dark:border-acr-warn-soft'}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                {isTestMode ? (
                  <TestTube className="w-5 h-5 text-acr-accent" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-acr-warn" aria-hidden="true" />
                )}
                <div>
                  <p className="font-medium">
                    {isTestMode ? 'Test mode active' : 'Live mode active'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {isTestMode
                      ? 'No actual mail will be sent or charged.'
                      : <>Real mail will be sent. Estimated cost: <span className="tabular-nums font-medium">${estimatedCost.toFixed(2)}</span> ({selectedLeadIds.length.toLocaleString()} recipients).</>}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {estimateMutation.isPending && (
            <Card className="border-muted">
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm text-muted-foreground">Checking credit balance…</span>
                </div>
              </CardContent>
            </Card>
          )}

          {estimateMutation.error && (
            <Card className="border-acr-neg-soft dark:border-acr-neg-soft" role="alert">
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-acr-neg" aria-hidden="true" />
                  <span className="text-sm text-acr-neg dark:text-acr-neg">
                    Couldn't check your credit balance. Please try again.
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {estimateMutation.data && !estimateMutation.isPending && (
            <Card className={estimateMutation.data.hasEnoughCredits ? 'border-acr-pos-soft dark:border-acr-pos-soft' : 'border-acr-neg-soft dark:border-acr-neg-soft'}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  {estimateMutation.data.hasEnoughCredits ? (
                    <CheckCircle className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-acr-neg" aria-hidden="true" />
                  )}
                  <span className="text-sm">
                    {estimateMutation.data.hasEnoughCredits
                      ? <>You have enough credits — <span className="tabular-nums font-medium">${(estimateMutation.data.creditBalance / 100).toFixed(2)}</span> available.</>
                      : <>Insufficient credits — need <span className="tabular-nums font-medium">${(estimateMutation.data.creditsNeeded / 100).toFixed(2)}</span> more.</>}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel-send">
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={
              sendMutation.isPending ||
              selectedLeadIds.length === 0 ||
              estimateMutation.isPending ||
              !!estimateMutation.error ||
              (estimateMutation.data && !estimateMutation.data.hasEnoughCredits)
            }
            data-testid="button-confirm-send"
          >
            {sendMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Sending…
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" aria-hidden="true" />
                {isTestMode ? 'Send test mail' : 'Send mail'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignDetailDrawer({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const { mutate: updateCampaign, isPending } = useUpdateCampaign();
  const { data: leads } = useLeads();
  const { data: mailStatus } = useDirectMailStatus();
  const { data: mailAttribution } = useMailAttribution(campaign.id);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const { toast } = useToast();
  const testSend = useTestSendCampaign();

  // 6b: hand-rolled overlay a11y per 5l dialog-Esc rule — at minimum
  // role=dialog + aria-modal + aria-labelledby + Escape handler. Full
  // focus-trap + focus-restoration would require converting to Radix
  // Sheet, deferred as a larger refactor.
  const titleId = `campaign-detail-title-${campaign.id}`;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !showSendDialog) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, showSendDialog]);

  const toggleStatus = () => {
    const newStatus = campaign.status === 'active' ? 'paused' : 'active';
    updateCampaign(
      { id: campaign.id, status: newStatus },
      {
        onSuccess: () => {
          toast({
            title: newStatus === 'paused' ? 'Campaign paused' : 'Campaign activated',
          });
        },
        onError: (err: any) => {
          toast({
            title: `Couldn't ${newStatus === 'paused' ? 'pause' : 'activate'} campaign`,
            description: `${err?.message ?? 'Network error'} — the campaign status is unchanged.`,
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleTestSend = () => {
    testSend.mutate(campaign.id, {
      onSuccess: (data) => {
        toast({ title: "Test email sent", description: `Sent to ${data.to}` });
      },
      onError: (err: any) => {
        toast({ title: "Couldn't send test email", description: `${err.message} — no email was sent.`, variant: "destructive" });
      },
    });
  };

  const isDirectMail = campaign.type === 'direct_mail';
  const isEmail = campaign.type === 'email';
  const availableLeads = leads?.filter((l: any) => l.address && l.city && l.state && l.zip) || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed right-0 top-0 h-full w-full max-w-xl bg-background shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h2 id={titleId} className="text-xl font-bold">{campaign.name}</h2>
              <Badge className={`capitalize ${statusColors[campaign.status] || statusColors.draft}`}>
                {campaign.status}
              </Badge>
            </div>
            <div className="flex gap-2 flex-wrap">
              {isEmail && (
                <Button
                  variant="outline"
                  onClick={handleTestSend}
                  disabled={testSend.isPending}
                  data-testid="button-test-send-email"
                >
                  {testSend.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Sending…</>
                  ) : (
                    <><TestTube className="w-4 h-4 mr-2" aria-hidden="true" /> Send test email</>
                  )}
                </Button>
              )}
              {isDirectMail && mailStatus?.isConfigured && (
                <Button
                  onClick={() => setShowSendDialog(true)}
                  data-testid="button-send-mail"
                >
                  <Mail className="w-4 h-4 mr-2" aria-hidden="true" /> Send mail
                </Button>
              )}
              {campaign.status !== 'completed' && (
                <Button
                  variant="outline"
                  onClick={toggleStatus}
                  disabled={isPending}
                  data-testid="button-toggle-status"
                >
                  {campaign.status === 'active' ? (
                    <>
                      <Pause className="w-4 h-4 mr-2" aria-hidden="true" /> Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" aria-hidden="true" /> Activate
                    </>
                  )}
                </Button>
              )}
              <Button variant="ghost" onClick={onClose} aria-label="Close campaign detail">Close</Button>
            </div>
          </div>
        </div>

        {showSendDialog && (
          <SendMailDialog 
            campaign={campaign}
            availableLeads={availableLeads}
            mailStatus={mailStatus!}
            onClose={() => setShowSendDialog(false)}
          />
        )}

        <div className="p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <Card className="glass-panel">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold tabular-nums">{(campaign.totalSent || 0).toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Total sent</p>
              </CardContent>
            </Card>
            <Card className="glass-panel">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-acr-pos tabular-nums">{(campaign.totalResponded || 0).toLocaleString()}</p>
                <p className="text-sm text-muted-foreground">Responses</p>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="text-base">Campaign metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Delivery rate</span>
                    <span className="tabular-nums">{campaign.totalSent ? ((campaign.totalDelivered || 0) / campaign.totalSent * 100).toFixed(1) : 0}%</span>
                  </div>
                  <Progress value={campaign.totalSent ? ((campaign.totalDelivered || 0) / campaign.totalSent * 100) : 0} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Open rate</span>
                    <span className="tabular-nums">{campaign.totalDelivered ? ((campaign.totalOpened || 0) / campaign.totalDelivered * 100).toFixed(1) : 0}%</span>
                  </div>
                  <Progress value={campaign.totalDelivered ? ((campaign.totalOpened || 0) / campaign.totalDelivered * 100) : 0} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Response rate</span>
                    <span className="tabular-nums">{campaign.totalSent ? ((campaign.totalResponded || 0) / campaign.totalSent * 100).toFixed(1) : 0}%</span>
                  </div>
                  <Progress value={campaign.totalSent ? ((campaign.totalResponded || 0) / campaign.totalSent * 100) : 0} className="h-2" />
                </div>
              </div>
            </CardContent>
          </Card>

          {isDirectMail && mailAttribution && (
            <Card className="glass-panel border-acr-accent dark:border-acr-accent">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Mail className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                  Direct mail performance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold tabular-nums">{mailAttribution.totalSent.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Pieces sent</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-acr-pos tabular-nums">{mailAttribution.attributedResponses.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Responses attributed</p>
                  </div>
                </div>

                {mailAttribution.estimatedDeliveryDate && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4" aria-hidden="true" />
                    <span>Est. delivery: {format(new Date(mailAttribution.estimatedDeliveryDate), 'PPP')}</span>
                  </div>
                )}

                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Response rate</span>
                    <span className="font-medium tabular-nums">{mailAttribution.responseRate.toFixed(1)}%</span>
                  </div>
                  <Progress value={Math.min(mailAttribution.responseRate, 10)} max={10} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1">
                    Industry benchmark: <span className="tabular-nums">{mailAttribution.industryBenchmarkMin}–{mailAttribution.industryBenchmarkMax}%</span>
                    {mailAttribution.responseRate >= mailAttribution.industryBenchmarkMin && (
                      <span className="text-acr-pos ml-1">— above average</span>
                    )}
                  </p>
                </div>

                {mailAttribution.costPerResponse !== null && (
                  <div className="flex items-center justify-between text-sm border-t pt-3">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5" aria-hidden="true" />
                      Cost per response
                    </span>
                    <span className="font-mono font-medium tabular-nums">${mailAttribution.costPerResponse.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5" aria-hidden="true" />
                    Total spend
                  </span>
                  <span className="font-mono tabular-nums">${(mailAttribution.totalCostCents / 100).toFixed(2)}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {campaign.content && (
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="text-base">Content</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-muted/50 rounded-lg p-4 text-sm whitespace-pre-wrap">
                  {campaign.content}
                </div>
              </CardContent>
            </Card>
          )}

          {campaign.scheduledDate && (
            <Card className="glass-panel">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="text-sm text-muted-foreground">Scheduled date</p>
                    <p className="font-medium">{format(new Date(campaign.scheduledDate), 'PPP')}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {campaign.budget && (
            <Card className="glass-panel">
              <CardHeader>
                <CardTitle className="text-base">Budget</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Spent</span>
                  <span className="font-mono tabular-nums">{usd(campaign.spent, { noCents: true })} / {usd(campaign.budget, { noCents: true })}</span>
                </div>
                <Progress
                  value={Number(campaign.budget) > 0 ? (Number(campaign.spent || 0) / Number(campaign.budget) * 100) : 0}
                  className="h-2 mt-2"
                />
              </CardContent>
            </Card>
          )}

          <OptimizerSuggestionsPanel campaign={campaign} />

          <div className="pt-4 border-t">
            <AbTestManager campaign={campaign} />
          </div>

          <div className="pt-4 border-t">
            <CampaignVariantsPanel campaign={campaign} />
          </div>

          <div className="pt-4 border-t">
            <h3 className="text-lg font-semibold mb-4">Response analytics</h3>
            <CampaignAnalytics campaignId={campaign.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface HealthService {
  name: string;
  status: string;
  message?: string;
}

function CampaignForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateCampaign();
  const { toast } = useToast();
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const { data: healthData } = useQuery<{ services: HealthService[] }>({
    queryKey: ['/api/health/cached'],
  });
  // Cycle 5 r4 Ty: show the live lead count next to the recipient
  // selector so the user knows what list they're about to mail to.
  const { data: leads } = useLeads();
  const leadCount = Array.isArray(leads) ? leads.length : 0;

  // Determine which channels are configured
  const emailConfigured = healthData?.services?.find(s => s.name === 'email')?.status !== 'unconfigured';
  const smsConfigured = healthData?.services?.find(s => s.name === 'twilio')?.status !== 'unconfigured';
  const channelStatus: Record<string, boolean> = {
    direct_mail: true, // always available (uses Lob, checked separately)
    email: emailConfigured !== false,
    sms: smsConfigured !== false,
  };

  const form = useForm<z.infer<typeof campaignFormSchema>>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: {
      status: "draft",
      type: "direct_mail",
    }
  });

  const campaignType = form.watch("type") as keyof typeof campaignTemplates;
  const availableTemplates = campaignTemplates[campaignType] || [];

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);
    const template = availableTemplates.find(t => t.id === templateId);
    if (template) {
      form.setValue("subject", template.subject);
      form.setValue("content", template.content);
    }
  };

  const onSubmit = (data: z.infer<typeof campaignFormSchema>) => {
    mutate(data, {
      onSuccess,
      onError: (err: any) => {
        toast({
          title: "Couldn't create campaign",
          description: `${err?.message ?? "Network error"} — your draft is preserved. Try again or check the system status.`,
          variant: "destructive",
        });
      },
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
      <div className="space-y-2">
        <Label htmlFor="campaign-name">
          Campaign name <span className="text-destructive" aria-hidden="true">*</span>
        </Label>
        <Input
          id="campaign-name"
          {...form.register("name")}
          placeholder="Q1 offer mailer"
          autoCapitalize="words"
          required
          data-testid="input-campaign-name"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="campaign-type-trigger" className="text-sm font-medium">
            Type <span className="text-destructive" aria-hidden="true">*</span>
          </Label>
          <TooltipProvider>
            <Select
              value={form.watch("type")}
              onValueChange={(val) => {
                if (!channelStatus[val]) return;
                form.setValue("type", val);
                setSelectedTemplate("");
              }}
            >
              <SelectTrigger id="campaign-type-trigger" aria-label="Campaign type" data-testid="select-campaign-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {campaignTypes.map(type => {
                  const configured = channelStatus[type.value] !== false;
                  const item = (
                    <SelectItem
                      key={type.value}
                      value={type.value}
                      disabled={!configured}
                      className={!configured ? "opacity-50" : ""}
                    >
                      <div className="flex items-center gap-2">
                        <type.icon className="w-4 h-4" aria-hidden="true" />
                        {type.label}
                        {!configured && <span className="text-xs text-muted-foreground ml-1">(not configured)</span>}
                      </div>
                    </SelectItem>
                  );
                  if (!configured) {
                    return (
                      <Tooltip key={type.value}>
                        <TooltipTrigger asChild>{item}</TooltipTrigger>
                        <TooltipContent>Configure in Settings &rarr; Integrations</TooltipContent>
                      </Tooltip>
                    );
                  }
                  return item;
                })}
              </SelectContent>
            </Select>
          </TooltipProvider>
        </div>

        <div className="space-y-2">
          <Label htmlFor="schedule-date">Schedule</Label>
          <Input
            id="schedule-date"
            type="date"
            value={(() => {
              const d = form.watch("scheduledDate");
              return d instanceof Date && !isNaN(d.getTime()) ? format(d, 'yyyy-MM-dd') : '';
            })()}
            onChange={(e) => form.setValue("scheduledDate", e.target.value ? new Date(e.target.value) : undefined as any)}
            data-testid="input-schedule-date"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label id="template-group-label">Template</Label>
        <div
          role="radiogroup"
          aria-labelledby="template-group-label"
          className="grid grid-cols-1 gap-2"
        >
          {availableTemplates.map((template) => {
            const selected = selectedTemplate === template.id;
            return (
              <button
                key={template.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => handleTemplateSelect(template.id)}
                className={`text-left p-3 rounded-lg border transition-colors hover-elevate focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                  selected ? "border-primary bg-primary/5" : "border-border"
                }`}
                data-testid={`template-${template.id}`}
              >
                <div className="flex items-start gap-3">
                  <div
                    aria-hidden="true"
                    className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selected ? "border-primary" : "border-muted-foreground"
                    }`}
                  >
                    {selected && <div className="w-2 h-2 rounded-full bg-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{template.name}</p>
                    <p className="text-xs text-muted-foreground">{template.description}</p>
                  </div>
                </div>
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={selectedTemplate === "custom"}
            onClick={() => {
              setSelectedTemplate("custom");
              form.setValue("subject", "");
              form.setValue("content", "");
            }}
            className={`text-left p-3 rounded-lg border transition-colors hover-elevate focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              selectedTemplate === "custom" ? "border-primary bg-primary/5" : "border-border"
            }`}
            data-testid="template-custom"
          >
            <div className="flex items-start gap-3">
              <div
                aria-hidden="true"
                className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  selectedTemplate === "custom" ? "border-primary" : "border-muted-foreground"
                }`}
              >
                {selectedTemplate === "custom" && <div className="w-2 h-2 rounded-full bg-primary" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Custom message</p>
                <p className="text-xs text-muted-foreground">Write your own content from scratch.</p>
              </div>
            </div>
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {"Variables: {{firstName}}, {{lastName}}, {{county}}, {{state}}, {{apn}}, {{offerAmount}}, {{acreage}}, {{assessedValue}}, {{marketValue}}, {{landUseCode}}, {{lastSalePrice}}, {{ownerType}}"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Blind-offer example: set {"{{offerAmount}}"} = 25% × {"{{assessedValue}}"} at list-import time, then reference {"{{offerAmount}}"} in your template.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="offer-percent">
          Blind-offer formula <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-muted-foreground">{"{{offerAmount}}"} =</span>
          <Input
            id="offer-percent"
            {...form.register("offerPercent" as any)}
            type="number"
            inputMode="numeric"
            placeholder="25"
            step="1"
            min="1"
            max="100"
            className="w-24 text-right tabular-nums"
            aria-label="Offer percent"
            data-testid="input-offer-percent"
          />
          <span className="text-sm text-muted-foreground">% of</span>
          <select
            {...form.register("offerBase" as any)}
            defaultValue="assessedValue"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Offer base field"
            data-testid="select-offer-base"
          >
            <option value="assessedValue">{"{{assessedValue}}"}</option>
            <option value="marketValue">{"{{marketValue}}"}</option>
            <option value="lastSalePrice">{"{{lastSalePrice}}"}</option>
          </select>
        </div>
        <p className="text-xs text-muted-foreground">
          Leave blank to enter offers as a static amount in your CSV. When set, AcreOS computes per-row {"{{offerAmount}}"} at send time.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="recipient-filter">
          Recipients <span className="text-destructive" aria-hidden="true">*</span>
        </Label>
        <select
          id="recipient-filter"
          {...form.register("recipientFilter" as any)}
          defaultValue="all"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm w-full"
          data-testid="select-recipient-filter"
        >
          <option value="all">All current leads ({leadCount.toLocaleString()})</option>
          <option value="tax_delinquent">Tax-delinquent only</option>
          <option value="absentee">Absentee owners only</option>
          <option value="new">New (never contacted)</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Or upload a fresh CSV on the <Link href="/leads" className="underline hover:text-foreground">Leads</Link> page and come back here.
        </p>
      </div>

      {campaignType !== "sms" && (
        <div className="space-y-2">
          <Label htmlFor="campaign-subject">
            Subject <span className="text-muted-foreground font-normal">(email and direct mail)</span>
          </Label>
          <Input
            id="campaign-subject"
            {...form.register("subject")}
            autoCapitalize="sentences"
            placeholder="We'd like to buy your land"
            data-testid="input-subject"
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="campaign-content">
          Content <span className="text-destructive" aria-hidden="true">*</span>
        </Label>
        <Textarea
          id="campaign-content"
          {...form.register("content")}
          autoCapitalize="sentences"
          placeholder="Dear {{firstName}}, I'm interested in purchasing your property in {{county}} County…"
          rows={6}
          required
          data-testid="input-content"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="campaign-budget">Budget</Label>
        <div className="relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none text-sm"
            aria-hidden="true"
          >
            $
          </span>
          <Input
            id="campaign-budget"
            {...form.register("budget")}
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            placeholder="500"
            className="pl-7 text-right tabular-nums"
            aria-label="Budget in US dollars"
            data-testid="input-budget"
          />
        </div>
      </div>

      <div className="pt-2 space-y-2">
        <Button type="submit" className="w-full" disabled={isPending} data-testid="button-create-campaign-submit">
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
              Creating…
            </>
          ) : (
            "Create campaign"
          )}
        </Button>
        <div className="text-xs text-muted-foreground text-center space-y-1" data-testid="text-campaign-costs">
          <p>Sending costs: email $0.01 each, SMS $0.03 each.</p>
          <p>Direct mail: $0.75–$1.25 per piece (varies by size).</p>
        </div>
      </div>
    </form>
  );
}
