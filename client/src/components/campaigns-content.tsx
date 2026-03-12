import { useCampaigns, useCreateCampaign, useUpdateCampaign, useDirectMailStatus, useUpdateMailMode, useSendDirectMail, useMailEstimate, useCampaignOptimizations, useOptimizeCampaign, useMarkOptimizationImplemented, useCampaignResponseTrend } from "@/hooks/use-campaigns";
import { useLeads } from "@/hooks/use-leads";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertCampaignSchema, type Campaign, type CampaignOptimization } from "@shared/schema";
import { z } from "zod";
import { CampaignAnalytics } from "@/components/campaign-analytics";
import { AbTestManager } from "@/components/ab-test-manager";

const campaignFormSchema = insertCampaignSchema.omit({ organizationId: true });
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Mail, MessageSquare, Send, Calendar, BarChart3, Users, Clock, Play, Pause, CheckCircle, FileText, Target, TrendingUp, Eye, TestTube, Zap, AlertTriangle, DollarSign, Loader2, Lightbulb, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/list-skeleton";
import { CampaignsEmptyState } from "@/components/empty-states";
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
  scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  completed: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
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
      <svg width={width} height={height} className="text-emerald-500 shrink-0">
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
      </svg>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {totalThisWeek} responses (7d)
      </span>
    </div>
  );
}

// ─── AI Optimizer Suggestions Panel ──────────────────────────────────────────

const priorityConfig: Record<string, { label: string; className: string }> = {
  high: { label: "High", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  medium: { label: "Medium", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  low: { label: "Low", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

const typeIcons: Record<string, React.ReactNode> = {
  content: <FileText className="w-3.5 h-3.5" />,
  timing: <Clock className="w-3.5 h-3.5" />,
  audience: <Users className="w-3.5 h-3.5" />,
  budget: <DollarSign className="w-3.5 h-3.5" />,
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
        title: "AI Optimizer Complete",
        description: `Generated ${result.suggestionsGenerated} suggestions. Campaign score: ${result.score}/100.`,
      });
    } catch (err: any) {
      toast({ title: "Optimizer failed", description: err.message, variant: "destructive" });
    }
  };

  const handleImplement = async (suggestion: CampaignOptimization) => {
    try {
      await implementMutation.mutateAsync({ optimizationId: suggestion.id, campaignId: campaign.id });
      toast({ title: "Marked as implemented", description: suggestion.suggestion.slice(0, 80) });
    } catch (err: any) {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <Card className="glass-panel">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-amber-500" />
            AI Optimization Suggestions
            {pending.length > 0 && (
              <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 ml-1">
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
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 mr-1" />
              )}
              {optimizeMutation.isPending ? "Analyzing…" : "Run AI Analysis"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        {campaign.optimizationScore != null && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">Optimization score</span>
            <div className="flex-1 max-w-[120px]">
              <Progress value={campaign.optimizationScore} className="h-1.5" />
            </div>
            <span className="text-xs font-medium">{campaign.optimizationScore}/100</span>
          </div>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-3">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading suggestions…
            </div>
          )}

          {!isLoading && pending.length === 0 && done.length === 0 && (
            <p className="text-sm text-muted-foreground py-2">
              No suggestions yet. Click "Run AI Analysis" to generate recommendations.
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
                  <span className="text-muted-foreground">{typeIcons[s.type] ?? <Lightbulb className="w-3.5 h-3.5" />}</span>
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
                  <CheckCircle className="w-3 h-3 mr-1" />
                  Mark Implemented
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
                      <CheckCircle className="w-3 h-3 text-emerald-500" />
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
      <Card className="glass-panel border-amber-200 dark:border-amber-800">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            <div>
              <p className="font-medium">Direct Mail Not Configured</p>
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
        title: newMode === 'live' ? 'Live Mode Enabled' : 'Test Mode Enabled',
        description: newMode === 'live' 
          ? 'Mail will now be sent and billed.' 
          : 'Mail will not actually be sent.',
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
    <Card className={`glass-panel ${isTestMode ? 'border-blue-200 dark:border-blue-800' : 'border-emerald-200 dark:border-emerald-800'}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {isTestMode ? (
              <TestTube className="w-5 h-5 text-blue-500" />
            ) : (
              <Zap className="w-5 h-5 text-emerald-500" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <p className="font-medium">
                  {isTestMode ? 'Test Mode' : 'Live Mode'}
                </p>
                <Badge className={isTestMode ? 'bg-blue-100 text-blue-800' : 'bg-emerald-100 text-emerald-800'}>
                  {isTestMode ? 'Safe' : 'Active'}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {isTestMode 
                  ? 'Mail pieces are simulated - no actual mail is sent.' 
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
  const { data: campaigns, isLoading } = useCampaigns();
  const { data: leads } = useLeads();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  const activeCampaigns = campaigns?.filter(c => c.status === 'active') || [];
  const totalSent = campaigns?.reduce((sum, c) => sum + (c.totalSent || 0), 0) || 0;
  const totalResponded = campaigns?.reduce((sum, c) => sum + (c.totalResponded || 0), 0) || 0;
  const responseRate = totalSent > 0 ? ((totalResponded / totalSent) * 100).toFixed(1) : '0';

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
              <Plus className="w-4 h-4 mr-2" /> New Campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] floating-window">
            <DialogHeader>
              <DialogTitle>Create Campaign</DialogTitle>
              <DialogDescription>Set up a new marketing campaign for your leads</DialogDescription>
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
                <Target className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Campaigns</p>
                <p className="text-2xl font-bold" data-testid="text-active-campaigns">{activeCampaigns.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-blue-500/10">
                <Send className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Sent</p>
                <p className="text-2xl font-bold" data-testid="text-total-sent">{totalSent.toLocaleString()}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-emerald-500/10">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Response Rate</p>
                <p className="text-2xl font-bold text-emerald-600" data-testid="text-response-rate">{responseRate}%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="glass-panel">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-purple-500/10">
                <Users className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Available Leads</p>
                <p className="text-2xl font-bold" data-testid="text-available-leads">{leads?.length || 0}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All Campaigns</TabsTrigger>
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
        <CampaignDetailDrawer 
          campaign={selectedCampaign} 
          onClose={() => setSelectedCampaign(null)} 
        />
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
    return <CampaignsEmptyState onCreateCampaign={onCreateNew} />;
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
                    <TypeIcon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg">{campaign.name}</h3>
                    <p className="text-sm text-muted-foreground capitalize">{campaign.type?.replace('_', ' ')}</p>
                  </div>
                </div>
                <Badge className={statusColors[campaign.status] || statusColors.draft}>
                  {campaign.status}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Sent</p>
                  <p className="font-medium">{campaign.totalSent || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Delivered</p>
                  <p className="font-medium">{campaign.totalDelivered || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Opened</p>
                  <p className="font-medium">{campaign.totalOpened || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Responded</p>
                  <p className="font-medium text-emerald-600">{campaign.totalResponded || 0}</p>
                </div>
              </div>

              {campaign.totalSent ? (
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>Delivery Rate</span>
                    <span>{deliveryRate}%</span>
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
        title: result.isTestMode ? 'Test Mail Sent' : 'Mail Sent',
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
          <DialogTitle>Send Direct Mail</DialogTitle>
          <DialogDescription>
            Send mail pieces for campaign: {campaign.name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Mail Piece Type</label>
            <Select value={pieceType} onValueChange={handlePieceTypeChange}>
              <SelectTrigger data-testid="select-piece-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pieceTypes.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label} (${type.cost}/piece)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card className={isTestMode ? 'border-blue-200 dark:border-blue-800' : 'border-amber-200 dark:border-amber-800'}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                {isTestMode ? (
                  <TestTube className="w-5 h-5 text-blue-500" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                )}
                <div>
                  <p className="font-medium">
                    {isTestMode ? 'Test Mode Active' : 'Live Mode Active'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {isTestMode 
                      ? 'No actual mail will be sent or charged.' 
                      : `Real mail will be sent. Estimated cost: $${estimatedCost.toFixed(2)}`}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {estimateMutation.isPending && (
            <Card className="border-muted">
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">Checking credit balance...</span>
                </div>
              </CardContent>
            </Card>
          )}

          {estimateMutation.error && (
            <Card className="border-red-200 dark:border-red-800">
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  <span className="text-sm text-red-600 dark:text-red-400">
                    Failed to get estimate. Please try again.
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {estimateMutation.data && !estimateMutation.isPending && (
            <Card className={estimateMutation.data.hasEnoughCredits ? 'border-emerald-200 dark:border-emerald-800' : 'border-red-200 dark:border-red-800'}>
              <CardContent className="p-3">
                <div className="flex items-center gap-2">
                  {estimateMutation.data.hasEnoughCredits ? (
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-500" />
                  )}
                  <span className="text-sm">
                    {estimateMutation.data.hasEnoughCredits 
                      ? `You have enough credits ($${(estimateMutation.data.creditBalance / 100).toFixed(2)} available)`
                      : `Insufficient credits - need $${(estimateMutation.data.creditsNeeded / 100).toFixed(2)} more`}
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
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                {isTestMode ? 'Send Test Mail' : 'Send Mail'}
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
  const [showSendDialog, setShowSendDialog] = useState(false);
  
  const toggleStatus = () => {
    const newStatus = campaign.status === 'active' ? 'paused' : 'active';
    updateCampaign({ id: campaign.id, status: newStatus });
  };

  const isDirectMail = campaign.type === 'direct_mail';
  const availableLeads = leads?.filter(l => l.address && l.city && l.state && l.zip) || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="fixed right-0 top-0 h-full w-full max-w-xl bg-background shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">{campaign.name}</h2>
              <Badge className={statusColors[campaign.status] || statusColors.draft}>
                {campaign.status}
              </Badge>
            </div>
            <div className="flex gap-2 flex-wrap">
              {isDirectMail && mailStatus?.isConfigured && (
                <Button 
                  onClick={() => setShowSendDialog(true)}
                  data-testid="button-send-mail"
                >
                  <Mail className="w-4 h-4 mr-2" /> Send Mail
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
                      <Pause className="w-4 h-4 mr-2" /> Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" /> Activate
                    </>
                  )}
                </Button>
              )}
              <Button variant="ghost" onClick={onClose}>Close</Button>
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
                <p className="text-3xl font-bold">{campaign.totalSent || 0}</p>
                <p className="text-sm text-muted-foreground">Total Sent</p>
              </CardContent>
            </Card>
            <Card className="glass-panel">
              <CardContent className="p-4 text-center">
                <p className="text-3xl font-bold text-emerald-600">{campaign.totalResponded || 0}</p>
                <p className="text-sm text-muted-foreground">Responses</p>
              </CardContent>
            </Card>
          </div>

          <Card className="glass-panel">
            <CardHeader>
              <CardTitle className="text-base">Campaign Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Delivery Rate</span>
                    <span>{campaign.totalSent ? ((campaign.totalDelivered || 0) / campaign.totalSent * 100).toFixed(1) : 0}%</span>
                  </div>
                  <Progress value={campaign.totalSent ? ((campaign.totalDelivered || 0) / campaign.totalSent * 100) : 0} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Open Rate</span>
                    <span>{campaign.totalDelivered ? ((campaign.totalOpened || 0) / campaign.totalDelivered * 100).toFixed(1) : 0}%</span>
                  </div>
                  <Progress value={campaign.totalDelivered ? ((campaign.totalOpened || 0) / campaign.totalDelivered * 100) : 0} className="h-2" />
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Response Rate</span>
                    <span>{campaign.totalSent ? ((campaign.totalResponded || 0) / campaign.totalSent * 100).toFixed(1) : 0}%</span>
                  </div>
                  <Progress value={campaign.totalSent ? ((campaign.totalResponded || 0) / campaign.totalSent * 100) : 0} className="h-2" />
                </div>
              </div>
            </CardContent>
          </Card>

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
                  <Calendar className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Scheduled Date</p>
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
                  <span className="font-mono">${Number(campaign.spent || 0).toLocaleString()} / ${Number(campaign.budget).toLocaleString()}</span>
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
            <h3 className="text-lg font-semibold mb-4">Response Analytics</h3>
            <CampaignAnalytics campaignId={campaign.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function CampaignForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateCampaign();
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  
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
    mutate(data, { onSuccess });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Campaign Name</label>
        <Input 
          {...form.register("name")} 
          placeholder="Q1 Offer Mailer" 
          data-testid="input-campaign-name"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Type</label>
          <Select 
            value={form.watch("type")} 
            onValueChange={(val) => {
              form.setValue("type", val);
              setSelectedTemplate("");
            }}
          >
            <SelectTrigger data-testid="select-campaign-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {campaignTypes.map(type => (
                <SelectItem key={type.value} value={type.value}>
                  <div className="flex items-center gap-2">
                    <type.icon className="w-4 h-4" />
                    {type.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Schedule</label>
          <Input 
            type="date" 
            onChange={(e) => form.setValue("scheduledDate", new Date(e.target.value))} 
            data-testid="input-schedule-date"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Template</label>
        <div className="grid grid-cols-1 gap-2">
          {availableTemplates.map((template) => (
            <div
              key={template.id}
              onClick={() => handleTemplateSelect(template.id)}
              className={`p-3 rounded-lg border cursor-pointer transition-colors hover-elevate ${
                selectedTemplate === template.id
                  ? "border-primary bg-primary/5"
                  : "border-border"
              }`}
              data-testid={`template-${template.id}`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  selectedTemplate === template.id ? "border-primary" : "border-muted-foreground"
                }`}>
                  {selectedTemplate === template.id && (
                    <div className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{template.name}</p>
                  <p className="text-xs text-muted-foreground">{template.description}</p>
                </div>
              </div>
            </div>
          ))}
          <div
            onClick={() => {
              setSelectedTemplate("custom");
              form.setValue("subject", "");
              form.setValue("content", "");
            }}
            className={`p-3 rounded-lg border cursor-pointer transition-colors hover-elevate ${
              selectedTemplate === "custom"
                ? "border-primary bg-primary/5"
                : "border-border"
            }`}
            data-testid="template-custom"
          >
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                selectedTemplate === "custom" ? "border-primary" : "border-muted-foreground"
              }`}>
                {selectedTemplate === "custom" && (
                  <div className="w-2 h-2 rounded-full bg-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">Custom Message</p>
                <p className="text-xs text-muted-foreground">Write your own content from scratch</p>
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          {"Variables: {{firstName}}, {{lastName}}, {{county}}, {{state}}, {{apn}}, {{offerAmount}}"}
        </p>
      </div>

      {campaignType !== "sms" && (
        <div className="space-y-2">
          <label className="text-sm font-medium">Subject (for email/mail)</label>
          <Input 
            {...form.register("subject")} 
            placeholder="We want to buy your land!" 
            data-testid="input-subject"
          />
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium">Content</label>
        <Textarea 
          {...form.register("content")} 
          placeholder="Dear [Name], we are interested in purchasing your property..."
          rows={6}
          data-testid="input-content"
        />
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Budget ($)</label>
        <Input 
          {...form.register("budget")} 
          type="number" 
          placeholder="500" 
          data-testid="input-budget"
        />
      </div>

      <div className="pt-2 space-y-2">
        <Button type="submit" className="w-full" disabled={isPending} data-testid="button-create-campaign-submit">
          {isPending ? "Creating..." : "Create Campaign"}
        </Button>
        <div className="text-xs text-muted-foreground text-center space-y-1" data-testid="text-campaign-costs">
          <p>Sending costs: Email $0.01/each, SMS $0.03/each</p>
          <p>Direct mail: $0.75-$1.45 per piece (varies by type)</p>
        </div>
      </div>
    </form>
  );
}
