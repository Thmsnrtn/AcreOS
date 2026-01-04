import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { AbTest, AbTestVariant, Campaign } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  TestTube, Play, Square, Trophy, TrendingUp, Mail, Users, 
  CheckCircle, Clock, AlertCircle, Beaker, Target, BarChart3,
  Loader2, Plus, Trash2, ChevronRight
} from "lucide-react";
import { format } from "date-fns";

type AbTestWithVariants = AbTest & { variants: AbTestVariant[] };

interface AbTestManagerProps {
  campaign?: Campaign;
  showCreateButton?: boolean;
  onTestCreated?: () => void;
}

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
};

const statusIcons: Record<string, any> = {
  draft: Clock,
  running: Play,
  completed: CheckCircle,
};

const testTypeLabels: Record<string, string> = {
  subject: 'Subject Line',
  content: 'Content',
  offer: 'Offer Amount',
};

const confidenceBadge = (level: number) => {
  if (level >= 99) return { label: '99%', variant: 'default' as const, color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' };
  if (level >= 95) return { label: '95%', variant: 'secondary' as const, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' };
  if (level >= 90) return { label: '90%', variant: 'outline' as const, color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' };
  return { label: 'Not significant', variant: 'outline' as const, color: 'bg-muted text-muted-foreground' };
};

export function AbTestManager({ campaign, showCreateButton = true, onTestCreated }: AbTestManagerProps) {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedTestId, setSelectedTestId] = useState<number | null>(null);
  const [newTestName, setNewTestName] = useState("");
  const [newTestType, setNewTestType] = useState<"subject" | "content" | "offer">("subject");
  const [variantASubject, setVariantASubject] = useState("");
  const [variantAContent, setVariantAContent] = useState("");
  const [variantBSubject, setVariantBSubject] = useState("");
  const [variantBContent, setVariantBContent] = useState("");

  const { data: abTests, isLoading } = useQuery<AbTestWithVariants[]>({
    queryKey: ['/api/ab-tests'],
  });

  const campaignTests = campaign 
    ? abTests?.filter(t => t.campaignId === campaign.id) 
    : abTests;

  const activeTest = campaignTests?.find(t => t.status === 'running');

  const createTestMutation = useMutation({
    mutationFn: async (data: { campaignId: number; name: string; testType: string; variants: any[] }) => {
      const res = await apiRequest("POST", `/api/campaigns/${data.campaignId}/ab-test`, {
        name: data.name,
        testType: data.testType,
        variants: data.variants,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ab-tests'] });
      setIsCreateDialogOpen(false);
      resetForm();
      toast({ title: "A/B test created successfully" });
      onTestCreated?.();
    },
    onError: (err: any) => {
      toast({ title: "Failed to create test", description: err.message, variant: "destructive" });
    },
  });

  const startTestMutation = useMutation({
    mutationFn: async (testId: number) => {
      const res = await apiRequest("PATCH", `/api/ab-tests/${testId}/start`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ab-tests'] });
      toast({ title: "A/B test started" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to start test", description: err.message, variant: "destructive" });
    },
  });

  const completeTestMutation = useMutation({
    mutationFn: async (testId: number) => {
      const res = await apiRequest("PATCH", `/api/ab-tests/${testId}/complete`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ab-tests'] });
      toast({ title: "A/B test completed", description: "Winner has been determined" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to complete test", description: err.message, variant: "destructive" });
    },
  });

  const applyWinnerMutation = useMutation({
    mutationFn: async (testId: number) => {
      const res = await apiRequest("POST", `/api/ab-tests/${testId}/apply-winner`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ab-tests'] });
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
      toast({ title: "Winning variant applied to campaign" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to apply winner", description: err.message, variant: "destructive" });
    },
  });

  const deleteTestMutation = useMutation({
    mutationFn: async (testId: number) => {
      await apiRequest("DELETE", `/api/ab-tests/${testId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ab-tests'] });
      setSelectedTestId(null);
      toast({ title: "A/B test deleted" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete test", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setNewTestName("");
    setNewTestType("subject");
    setVariantASubject(campaign?.subject || "");
    setVariantAContent(campaign?.content || "");
    setVariantBSubject("");
    setVariantBContent("");
  };

  const handleCreateTest = () => {
    if (!campaign) return;
    
    createTestMutation.mutate({
      campaignId: campaign.id,
      name: newTestName || `A/B Test for ${campaign.name}`,
      testType: newTestType,
      variants: [
        { name: "Control (A)", isControl: true, subject: variantASubject, content: variantAContent },
        { name: "Variant B", isControl: false, subject: variantBSubject, content: variantBContent },
      ],
    });
  };

  const getWinningVariant = (test: AbTestWithVariants) => {
    return test.variants.find(v => v.id === test.winnerId);
  };

  const getMetricValue = (variant: AbTestVariant, metric: string): number => {
    const sent = variant.sent || 0;
    if (sent === 0) return 0;
    
    switch (metric) {
      case 'open_rate': return ((variant.opened || 0) / sent) * 100;
      case 'click_rate': return ((variant.clicked || 0) / sent) * 100;
      case 'response_rate': 
      default: return ((variant.responded || 0) / sent) * 100;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {showCreateButton && campaign && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TestTube className="w-5 h-5 text-muted-foreground" />
            <h3 className="font-semibold">A/B Testing</h3>
          </div>
          <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
            setIsCreateDialogOpen(open);
            if (open) {
              setVariantASubject(campaign?.subject || "");
              setVariantAContent(campaign?.content || "");
            }
          }}>
            <DialogTrigger asChild>
              <Button 
                data-testid="button-create-ab-test"
                disabled={!!activeTest}
              >
                <Plus className="w-4 h-4 mr-2" />
                Create A/B Test
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create A/B Test</DialogTitle>
                <DialogDescription>
                  Test different variations of your campaign to find what works best.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Test Name</label>
                  <Input
                    data-testid="input-test-name"
                    placeholder="e.g., Subject Line Test Q1"
                    value={newTestName}
                    onChange={(e) => setNewTestName(e.target.value)}
                  />
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Test Type</label>
                  <Select value={newTestType} onValueChange={(v: any) => setNewTestType(v)}>
                    <SelectTrigger data-testid="select-test-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="subject">Subject Line</SelectItem>
                      <SelectItem value="content">Content</SelectItem>
                      <SelectItem value="offer">Offer Amount</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <Badge variant="secondary">A</Badge>
                      Control
                    </h4>
                    <Input
                      data-testid="input-variant-a-subject"
                      placeholder="Subject line"
                      value={variantASubject}
                      onChange={(e) => setVariantASubject(e.target.value)}
                    />
                    <Textarea
                      data-testid="input-variant-a-content"
                      placeholder="Content"
                      value={variantAContent}
                      onChange={(e) => setVariantAContent(e.target.value)}
                      className="min-h-[100px]"
                    />
                  </div>
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <Badge variant="secondary">B</Badge>
                      Variant
                    </h4>
                    <Input
                      data-testid="input-variant-b-subject"
                      placeholder="Subject line"
                      value={variantBSubject}
                      onChange={(e) => setVariantBSubject(e.target.value)}
                    />
                    <Textarea
                      data-testid="input-variant-b-content"
                      placeholder="Content"
                      value={variantBContent}
                      onChange={(e) => setVariantBContent(e.target.value)}
                      className="min-h-[100px]"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button 
                  data-testid="button-submit-ab-test"
                  onClick={handleCreateTest}
                  disabled={createTestMutation.isPending}
                >
                  {createTestMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Create Test
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {activeTest && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-blue-500" />
                <CardTitle className="text-base">Active Test</CardTitle>
              </div>
              <Badge className={statusColors.running}>Running</Badge>
            </div>
            <CardDescription>{activeTest.name}</CardDescription>
          </CardHeader>
          <CardContent>
            <AbTestCard 
              test={activeTest} 
              onComplete={() => completeTestMutation.mutate(activeTest.id)}
              isCompletePending={completeTestMutation.isPending}
            />
          </CardContent>
        </Card>
      )}

      {campaignTests && campaignTests.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Test History
          </h4>
          <div className="space-y-3">
            {campaignTests
              .filter(t => t.status !== 'running')
              .map((test) => (
                <Card 
                  key={test.id} 
                  data-testid={`card-ab-test-${test.id}`}
                  className="cursor-pointer hover-elevate"
                  onClick={() => setSelectedTestId(selectedTestId === test.id ? null : test.id)}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {(() => {
                          const Icon = statusIcons[test.status] || Clock;
                          return <Icon className="w-4 h-4 text-muted-foreground" />;
                        })()}
                        <CardTitle className="text-base">{test.name}</CardTitle>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={statusColors[test.status]}>{test.status}</Badge>
                        <Badge variant="outline">{testTypeLabels[test.testType]}</Badge>
                        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${selectedTestId === test.id ? 'rotate-90' : ''}`} />
                      </div>
                    </div>
                    {test.completedAt && (
                      <CardDescription>
                        Completed {format(new Date(test.completedAt), 'MMM d, yyyy')}
                      </CardDescription>
                    )}
                  </CardHeader>
                  {selectedTestId === test.id && (
                    <CardContent>
                      <AbTestCard 
                        test={test} 
                        onApplyWinner={() => applyWinnerMutation.mutate(test.id)}
                        onDelete={() => deleteTestMutation.mutate(test.id)}
                        onStart={() => startTestMutation.mutate(test.id)}
                        isApplyPending={applyWinnerMutation.isPending}
                        isDeletePending={deleteTestMutation.isPending}
                        isStartPending={startTestMutation.isPending}
                      />
                    </CardContent>
                  )}
                </Card>
              ))}
          </div>
        </div>
      )}

      {(!campaignTests || campaignTests.length === 0) && !showCreateButton && (
        <div className="text-center py-8 text-muted-foreground">
          <TestTube className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No A/B tests found</p>
        </div>
      )}
    </div>
  );
}

interface AbTestCardProps {
  test: AbTestWithVariants;
  onStart?: () => void;
  onComplete?: () => void;
  onApplyWinner?: () => void;
  onDelete?: () => void;
  isStartPending?: boolean;
  isCompletePending?: boolean;
  isApplyPending?: boolean;
  isDeletePending?: boolean;
}

function AbTestCard({ 
  test, 
  onStart,
  onComplete, 
  onApplyWinner,
  onDelete,
  isStartPending,
  isCompletePending,
  isApplyPending,
  isDeletePending,
}: AbTestCardProps) {
  const winner = test.variants.find(v => v.id === test.winnerId);
  const control = test.variants.find(v => v.isControl);

  return (
    <div className="space-y-4">
      <div className="grid gap-4">
        {test.variants.map((variant, index) => {
          const isWinner = variant.id === test.winnerId;
          const sent = variant.sent || 0;
          const responded = variant.responded || 0;
          const responseRate = sent > 0 ? (responded / sent) * 100 : 0;
          const confidence = parseFloat(variant.confidenceLevel || "0");
          const confidenceInfo = confidenceBadge(confidence);

          return (
            <div 
              key={variant.id}
              data-testid={`variant-card-${variant.id}`}
              className={`p-4 rounded-lg border ${isWinner ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10' : 'border-border'}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">
                    {String.fromCharCode(65 + index)}
                  </Badge>
                  <span className="font-medium">{variant.name}</span>
                  {variant.isControl && (
                    <Badge variant="outline" className="text-xs">Control</Badge>
                  )}
                  {isWinner && (
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                      <Trophy className="w-3 h-3 mr-1" />
                      Winner
                    </Badge>
                  )}
                </div>
                {!variant.isControl && confidence > 0 && (
                  <Badge className={confidenceInfo.color}>
                    {confidenceInfo.label} confidence
                  </Badge>
                )}
              </div>

              {variant.subject && (
                <div className="mb-2">
                  <span className="text-xs text-muted-foreground">Subject:</span>
                  <p className="text-sm truncate">{variant.subject}</p>
                </div>
              )}

              <div className="grid grid-cols-5 gap-3 mt-3">
                <div className="text-center">
                  <p className="text-2xl font-semibold" data-testid={`text-sent-${variant.id}`}>{sent}</p>
                  <p className="text-xs text-muted-foreground">Sent</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold" data-testid={`text-delivered-${variant.id}`}>{variant.delivered || 0}</p>
                  <p className="text-xs text-muted-foreground">Delivered</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold" data-testid={`text-opened-${variant.id}`}>{variant.opened || 0}</p>
                  <p className="text-xs text-muted-foreground">Opened</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold" data-testid={`text-clicked-${variant.id}`}>{variant.clicked || 0}</p>
                  <p className="text-xs text-muted-foreground">Clicked</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-semibold" data-testid={`text-responded-${variant.id}`}>{responded}</p>
                  <p className="text-xs text-muted-foreground">Responded</p>
                </div>
              </div>

              <div className="mt-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Response Rate</span>
                  <span className="font-medium" data-testid={`text-response-rate-${variant.id}`}>
                    {responseRate.toFixed(1)}%
                  </span>
                </div>
                <Progress value={responseRate} className="h-2" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        {test.status === 'draft' && onStart && (
          <Button
            data-testid="button-start-test"
            onClick={(e) => { e.stopPropagation(); onStart(); }}
            disabled={isStartPending}
          >
            {isStartPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
            Start Test
          </Button>
        )}
        
        {test.status === 'running' && onComplete && (
          <Button
            data-testid="button-complete-test"
            onClick={(e) => { e.stopPropagation(); onComplete(); }}
            disabled={isCompletePending}
          >
            {isCompletePending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Square className="w-4 h-4 mr-2" />}
            Complete Test
          </Button>
        )}

        {test.status === 'completed' && winner && onApplyWinner && (
          <Button
            data-testid="button-apply-winner"
            onClick={(e) => { e.stopPropagation(); onApplyWinner(); }}
            disabled={isApplyPending}
          >
            {isApplyPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trophy className="w-4 h-4 mr-2" />}
            Apply Winner to Campaign
          </Button>
        )}

        {test.status !== 'running' && onDelete && (
          <Button
            variant="outline"
            size="icon"
            data-testid="button-delete-test"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            disabled={isDeletePending}
          >
            {isDeletePending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          </Button>
        )}
      </div>
    </div>
  );
}

export function AbTestHistoryList() {
  const { data: abTests, isLoading } = useQuery<AbTestWithVariants[]>({
    queryKey: ['/api/ab-tests'],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const completedTests = abTests?.filter(t => t.status === 'completed') || [];
  const runningTests = abTests?.filter(t => t.status === 'running') || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Beaker className="w-5 h-5 text-muted-foreground" />
        <h2 className="text-xl font-semibold">A/B Test Results</h2>
      </div>

      {runningTests.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Running Tests</h3>
          {runningTests.map(test => (
            <Card key={test.id} data-testid={`card-running-test-${test.id}`}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{test.name}</CardTitle>
                  <Badge className={statusColors.running}>Running</Badge>
                </div>
                <CardDescription>
                  {testTypeLabels[test.testType]} test - {test.variants.length} variants
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {completedTests.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Completed Tests</h3>
          {completedTests.map(test => {
            const winner = test.variants.find(v => v.id === test.winnerId);
            return (
              <Card key={test.id} data-testid={`card-completed-test-${test.id}`}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{test.name}</CardTitle>
                    <Badge className={statusColors.completed}>Completed</Badge>
                  </div>
                  <CardDescription>
                    {testTypeLabels[test.testType]} test - Completed {test.completedAt ? format(new Date(test.completedAt), 'MMM d, yyyy') : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mb-2">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    <span className="font-medium">Winner: {winner?.name || 'N/A'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {test.variants.map(v => {
                      const sent = v.sent || 0;
                      const responseRate = sent > 0 ? ((v.responded || 0) / sent * 100).toFixed(1) : '0';
                      return (
                        <div key={v.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                          <span className="flex items-center gap-2">
                            {v.name}
                            {v.id === test.winnerId && <Trophy className="w-3 h-3 text-amber-500" />}
                          </span>
                          <span className="text-muted-foreground">{responseRate}% response</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No completed A/B tests yet</p>
          <p className="text-sm mt-1">Create a test on any campaign to get started</p>
        </div>
      )}
    </div>
  );
}
