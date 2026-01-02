import { Sidebar } from "@/components/layout-sidebar";
import { useCampaigns, useCreateCampaign, useUpdateCampaign, useDirectMailStatus, useUpdateMailMode, useSendDirectMail, useMailEstimate } from "@/hooks/use-campaigns";
import { useLeads } from "@/hooks/use-leads";
import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertCampaignSchema, type Campaign } from "@shared/schema";
import { z } from "zod";

// Client-side form schema that omits organizationId (added by server)
const campaignFormSchema = insertCampaignSchema.omit({ organizationId: true });
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Mail, MessageSquare, Send, Calendar, BarChart3, Users, Clock, Play, Pause, CheckCircle, FileText, Target, TrendingUp, Eye, TestTube, Zap, AlertTriangle, DollarSign, Loader2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
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
  
  // Fetch estimate on mount and when pieceType or selection changes
  const fetchEstimate = () => {
    if (selectedLeadIds.length > 0) {
      estimateMutation.mutate({
        pieceType,
        recipientCount: selectedLeadIds.length,
      });
    }
  };

  // Fetch estimate on initial load
  useEffect(() => {
    fetchEstimate();
  }, []);

  // Refetch when piece type changes
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
  const estimatedCost = selectedPiece ? selectedPiece.cost * selectedLeadIds.length : 0;

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-[500px] floating-window">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Send Direct Mail
          </DialogTitle>
          <DialogDescription>
            Configure and send mail pieces for "{campaign.name}"
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Card className={`${isTestMode ? 'border-blue-200 dark:border-blue-800' : 'border-emerald-200 dark:border-emerald-800'}`}>
            <CardContent className="p-3">
              <div className="flex items-center gap-2">
                {isTestMode ? (
                  <TestTube className="w-4 h-4 text-blue-500" />
                ) : (
                  <Zap className="w-4 h-4 text-emerald-500" />
                )}
                <span className="text-sm font-medium">
                  {isTestMode ? 'Test Mode - No real mail will be sent' : 'Live Mode - Real mail will be sent'}
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <label className="text-sm font-medium">Mail Piece Type</label>
            <Select value={pieceType} onValueChange={handlePieceTypeChange}>
              <SelectTrigger data-testid="select-piece-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pieceTypes.map(type => (
                  <SelectItem key={type.value} value={type.value}>
                    <div className="flex items-center justify-between gap-4">
                      <span>{type.label}</span>
                      <span className="text-muted-foreground">${type.cost.toFixed(2)}/piece</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Recipients</label>
            <p className="text-sm text-muted-foreground">
              {selectedLeadIds.length} of {availableLeads.length} leads with valid addresses selected
            </p>
          </div>

          <Card className="bg-muted/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Estimated Cost</p>
                  <p className="text-2xl font-bold flex items-center gap-1">
                    <DollarSign className="w-5 h-5" />
                    {estimatedCost.toFixed(2)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">
                    {selectedLeadIds.length} pieces
                  </p>
                  <p className="text-sm">
                    @ ${selectedPiece?.cost.toFixed(2)}/each
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
