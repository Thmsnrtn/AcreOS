import { Sidebar } from "@/components/layout-sidebar";
import { useCampaigns, useCreateCampaign, useUpdateCampaign } from "@/hooks/use-campaigns";
import { useLeads } from "@/hooks/use-leads";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertCampaignSchema, type Campaign } from "@shared/schema";
import { z } from "zod";

// Client-side form schema that omits organizationId (added by server)
const campaignFormSchema = insertCampaignSchema.omit({ organizationId: true });
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Mail, MessageSquare, Send, Calendar, BarChart3, Users, Clock, Play, Pause, CheckCircle, FileText, Target, TrendingUp, Eye } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";

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

export default function CampaignsPage() {
  const { data: campaigns, isLoading } = useCampaigns();
  const { data: leads } = useLeads();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);

  const activeCampaigns = campaigns?.filter(c => c.status === 'active') || [];
  const totalSent = campaigns?.reduce((sum, c) => sum + (c.totalSent || 0), 0) || 0;
  const totalResponded = campaigns?.reduce((sum, c) => sum + (c.totalResponded || 0), 0) || 0;
  const responseRate = totalSent > 0 ? ((totalResponded / totalSent) * 100).toFixed(1) : '0';

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-8">
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold" data-testid="text-page-title">Marketing Campaigns</h1>
              <p className="text-muted-foreground">Manage direct mail, email, and SMS campaigns like LgPass.</p>
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
        </div>
      </main>

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
    return (
      <div className="text-center py-12 text-muted-foreground">
        Loading campaigns...
      </div>
    );
  }

  if (campaigns.length === 0) {
    return (
      <EmptyState
        icon={Target}
        title="No marketing campaigns"
        description="Launch your first campaign to start reaching leads with direct mail, email, or SMS outreach."
        actionLabel="Launch Your First Campaign"
        onAction={onCreateNew}
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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function CampaignDetailDrawer({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const { mutate: updateCampaign, isPending } = useUpdateCampaign();
  
  const toggleStatus = () => {
    const newStatus = campaign.status === 'active' ? 'paused' : 'active';
    updateCampaign({ id: campaign.id, status: newStatus });
  };

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
            <div className="flex gap-2">
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
        </div>
      </div>
    </div>
  );
}

function CampaignForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate, isPending } = useCreateCampaign();
  
  const form = useForm<z.infer<typeof campaignFormSchema>>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: {
      status: "draft",
      type: "direct_mail",
    }
  });

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
            onValueChange={(val) => form.setValue("type", val)}
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
        <label className="text-sm font-medium">Subject (for email/mail)</label>
        <Input 
          {...form.register("subject")} 
          placeholder="We want to buy your land!" 
          data-testid="input-subject"
        />
      </div>

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

      <div className="pt-2">
        <Button type="submit" className="w-full" disabled={isPending} data-testid="button-create-campaign-submit">
          {isPending ? "Creating..." : "Create Campaign"}
        </Button>
      </div>
    </form>
  );
}
