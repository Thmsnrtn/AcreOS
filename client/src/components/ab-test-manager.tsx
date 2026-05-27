import { useState, useId } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useOptimisticUpdate } from "@/lib/optimistic-mutation";
import type { AbTest, AbTestVariant, Campaign } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusKind } from "@/components/StatusBadge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const statusKind: Record<string, StatusKind> = {
  draft: 'draft',
  running: 'active',
  completed: 'success',
};

const statusIcons: Record<string, any> = {
  draft: Clock,
  running: Play,
  completed: CheckCircle,
};

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-transparent",
  running: "bg-acr-brand-soft text-acr-brand border-transparent",
  completed: "bg-acr-pos-soft text-acr-pos border-transparent",
};

const testTypeLabels: Record<string, string> = {
  subject: 'Subject line',
  content: 'Content',
  offer: 'Offer amount',
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
  const testNameId = useId();
  const testTypeId = useId();
  const variantASubjectId = useId();
  const variantAContentId = useId();
  const variantBSubjectId = useId();
  const variantBContentId = useId();

  const { data: abTestsRaw, isLoading } = useQuery<AbTestWithVariants[] | { tests: AbTestWithVariants[] }>({
    queryKey: ['/api/ab-tests'],
  });

  // r4 Wyatt STR-R4-002: campaign detail threw "d?.filter is not a function"
  // because the server returns { tests: [...] } (see server/routes-ab-tests.ts
  // line 28) but the client treated the response as a plain array. Unwrap
  // defensively: handle array OR { tests } OR undefined.
  const abTests: AbTestWithVariants[] = Array.isArray(abTestsRaw)
    ? abTestsRaw
    : Array.isArray((abTestsRaw as { tests?: AbTestWithVariants[] } | undefined)?.tests)
    ? (abTestsRaw as { tests: AbTestWithVariants[] }).tests
    : [];

  const campaignTests = campaign
    ? abTests.filter(t => t.campaignId === campaign.id)
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
      toast({
        title: "Couldn't create A/B test",
        description: `${err.message} — no test was created. Check your input and try again.`,
        variant: "destructive",
      });
    },
  });

  // Optimistic A/B test lifecycle flips — start moves draft→running and
  // complete moves running→completed. The badge + buttons reflect the
  // new state instantly with rollback if the server rejects.
  const startTestMutation = useOptimisticUpdate<{ id: number }>({
    mutationFn: async ({ id }) => {
      const res = await apiRequest("PATCH", `/api/ab-tests/${id}/start`);
      return res.json();
    },
    listKeys: [['/api/ab-tests']],
    getId: ({ id }) => id,
    buildPatch: () => ({ status: "running" }),
    successToast: { title: "A/B test started" },
  });

  const completeTestMutation = useOptimisticUpdate<{ id: number }>({
    mutationFn: async ({ id }) => {
      const res = await apiRequest("PATCH", `/api/ab-tests/${id}/complete`);
      return res.json();
    },
    listKeys: [['/api/ab-tests']],
    getId: ({ id }) => id,
    buildPatch: () => ({ status: "completed" }),
    successToast: { title: "A/B test completed", description: "Winner has been determined." },
  });

  const applyWinnerMutation = useMutation({
    mutationFn: async (testId: number) => {
      const res = await apiRequest("POST", `/api/ab-tests/${testId}/apply-winner`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ab-tests'] });
      queryClient.invalidateQueries({ queryKey: ['/api/campaigns'] });
      toast({ title: "Winning variant applied to campaign." });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't apply winner",
        description: `${err.message} — the campaign still uses its original variant.`,
        variant: "destructive",
      });
    },
  });

  const deleteTestMutation = useMutation({
    mutationFn: async (testId: number) => {
      await apiRequest("DELETE", `/api/ab-tests/${testId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ab-tests'] });
      setSelectedTestId(null);
      toast({ title: "A/B test deleted." });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't delete A/B test",
        description: `${err.message} — the test still exists.`,
        variant: "destructive",
      });
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
      <div className="flex items-center justify-center p-8" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading A/B tests…</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {showCreateButton && campaign && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TestTube className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
            <h3 className="font-semibold">A/B testing</h3>
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
                title={activeTest ? "Complete the active test before creating a new one" : undefined}
              >
                <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                Create A/B test
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create A/B test</DialogTitle>
                <DialogDescription>
                  Test different variations of your campaign to find what works best.
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4 py-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (createTestMutation.isPending) return;
                  handleCreateTest();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor={testNameId}>Test name</Label>
                  <Input
                    id={testNameId}
                    data-testid="input-test-name"
                    placeholder="e.g., Subject line test Q1"
                    value={newTestName}
                    onChange={(e) => setNewTestName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={testTypeId}>Test type</Label>
                  <Select value={newTestType} onValueChange={(v: any) => setNewTestType(v)}>
                    <SelectTrigger id={testTypeId} data-testid="select-test-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="subject">Subject line — the email subject users see first</SelectItem>
                      <SelectItem value="content">Content — body copy of the message</SelectItem>
                      <SelectItem value="offer">Offer amount — the price or discount offered</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <Badge variant="secondary" aria-label="Variant A">A</Badge>
                      Control
                    </h4>
                    <div className="space-y-1">
                      <Label htmlFor={variantASubjectId} className="sr-only">Variant A subject line</Label>
                      <Input
                        id={variantASubjectId}
                        data-testid="input-variant-a-subject"
                        placeholder="Subject line"
                        value={variantASubject}
                        onChange={(e) => setVariantASubject(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={variantAContentId} className="sr-only">Variant A content</Label>
                      <Textarea
                        id={variantAContentId}
                        data-testid="input-variant-a-content"
                        placeholder="Content"
                        value={variantAContent}
                        onChange={(e) => setVariantAContent(e.target.value)}
                        className="min-h-[100px]"
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm flex items-center gap-2">
                      <Badge variant="secondary" aria-label="Variant B">B</Badge>
                      Variant
                    </h4>
                    <div className="space-y-1">
                      <Label htmlFor={variantBSubjectId} className="sr-only">Variant B subject line</Label>
                      <Input
                        id={variantBSubjectId}
                        data-testid="input-variant-b-subject"
                        placeholder="Subject line"
                        value={variantBSubject}
                        onChange={(e) => setVariantBSubject(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={variantBContentId} className="sr-only">Variant B content</Label>
                      <Textarea
                        id={variantBContentId}
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
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    data-testid="button-submit-ab-test"
                    disabled={createTestMutation.isPending}
                    className="min-h-11"
                  >
                    {createTestMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />}
                    Create test
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {activeTest && (
        <Card className="border-blue-200 dark:border-blue-800">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Play className="w-4 h-4 text-blue-500" aria-hidden="true" />
                <CardTitle className="text-base">Active test</CardTitle>
              </div>
              <Badge className={statusColors.running}>Running</Badge>
            </div>
            <CardDescription>{activeTest.name}</CardDescription>
          </CardHeader>
          <CardContent>
            <AbTestCard
              test={activeTest}
              onComplete={() => completeTestMutation.mutate({ id: activeTest.id })}
              isCompletePending={completeTestMutation.isPending}
            />
          </CardContent>
        </Card>
      )}

      {campaignTests && campaignTests.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-medium text-sm text-muted-foreground flex items-center gap-2">
            <BarChart3 className="w-4 h-4" aria-hidden="true" />
            Test history
          </h4>
          <ul className="space-y-3" aria-label="A/B test history">
            {campaignTests
              .filter(t => t.status !== 'running')
              .map((test) => {
                const isExpanded = selectedTestId === test.id;
                const toggle = () => setSelectedTestId(isExpanded ? null : test.id);
                const Icon = statusIcons[test.status] || Clock;
                return (
                  <li key={test.id}>
                    <Card
                      data-testid={`card-ab-test-${test.id}`}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      aria-label={`${test.name}, ${test.status}, ${testTypeLabels[test.testType]} test`}
                      className="cursor-pointer hover-elevate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={toggle}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggle();
                        }
                      }}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Icon className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                            <CardTitle className="text-base">{test.name}</CardTitle>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusBadge status={statusKind[test.status] || test.status} label={test.status} />
                            <Badge variant="outline">{testTypeLabels[test.testType]}</Badge>
                            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} aria-hidden="true" />
                          </div>
                        </div>
                        {test.completedAt && (
                          <CardDescription className="tabular-nums">
                            Completed {format(new Date(test.completedAt), 'MMM d, yyyy')}
                          </CardDescription>
                        )}
                      </CardHeader>
                      {isExpanded && (
                        <CardContent>
                          <AbTestCard
                            test={test}
                            onApplyWinner={() => applyWinnerMutation.mutate(test.id)}
                            onDelete={() => deleteTestMutation.mutate(test.id)}
                            onStart={() => startTestMutation.mutate({ id: test.id })}
                            isApplyPending={applyWinnerMutation.isPending}
                            isDeletePending={deleteTestMutation.isPending}
                            isStartPending={startTestMutation.isPending}
                          />
                        </CardContent>
                      )}
                    </Card>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {(!campaignTests || campaignTests.length === 0) && !showCreateButton && (
        <div className="text-center py-8 text-muted-foreground">
          <TestTube className="w-12 h-12 mx-auto mb-4 opacity-50" aria-hidden="true" />
          <p>No A/B tests found.</p>
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
      <ul className="grid gap-4" aria-label="Test variants">
        {test.variants.map((variant, index) => {
          const isWinner = variant.id === test.winnerId;
          const sent = variant.sent || 0;
          const responded = variant.responded || 0;
          const responseRate = sent > 0 ? (responded / sent) * 100 : 0;
          const confidence = parseFloat(variant.confidenceLevel || "0");
          const confidenceInfo = confidenceBadge(confidence);

          return (
            <li
              key={variant.id}
              data-testid={`variant-card-${variant.id}`}
              className={`p-4 rounded-card border ${isWinner ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10' : 'border-border'}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" aria-label={`Variant ${String.fromCharCode(65 + index)}`}>
                    {String.fromCharCode(65 + index)}
                  </Badge>
                  <span className="font-medium">{variant.name}</span>
                  {variant.isControl && (
                    <Badge variant="outline" className="text-xs">Control</Badge>
                  )}
                  {isWinner && (
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                      <Trophy className="w-3 h-3 mr-1" aria-hidden="true" />
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

              <dl className="grid grid-cols-5 gap-3 mt-3">
                <div className="text-center">
                  <dd className="text-2xl font-semibold tabular-nums" data-testid={`text-sent-${variant.id}`}>{sent}</dd>
                  <dt className="text-xs text-muted-foreground">Sent</dt>
                </div>
                <div className="text-center">
                  <dd className="text-2xl font-semibold tabular-nums" data-testid={`text-delivered-${variant.id}`}>{variant.delivered || 0}</dd>
                  <dt className="text-xs text-muted-foreground">Delivered</dt>
                </div>
                <div className="text-center">
                  <dd className="text-2xl font-semibold tabular-nums" data-testid={`text-opened-${variant.id}`}>{variant.opened || 0}</dd>
                  <dt className="text-xs text-muted-foreground">Opened</dt>
                </div>
                <div className="text-center">
                  <dd className="text-2xl font-semibold tabular-nums" data-testid={`text-clicked-${variant.id}`}>{variant.clicked || 0}</dd>
                  <dt className="text-xs text-muted-foreground">Clicked</dt>
                </div>
                <div className="text-center">
                  <dd className="text-2xl font-semibold tabular-nums" data-testid={`text-responded-${variant.id}`}>{responded}</dd>
                  <dt className="text-xs text-muted-foreground">Responded</dt>
                </div>
              </dl>

              <div className="mt-3">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">Response rate</span>
                  <span className="font-medium tabular-nums" data-testid={`text-response-rate-${variant.id}`}>
                    {responseRate.toFixed(1)}%
                  </span>
                </div>
                <Progress
                  value={responseRate}
                  className="h-2"
                  aria-label={`${variant.name} response rate: ${responseRate.toFixed(1)}%`}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        {test.status === 'draft' && onStart && (
          <Button
            data-testid="button-start-test"
            onClick={(e) => { e.stopPropagation(); onStart(); }}
            disabled={isStartPending}
            className="min-h-11"
          >
            {isStartPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Play className="w-4 h-4 mr-2" aria-hidden="true" />}
            Start test
          </Button>
        )}

        {test.status === 'running' && onComplete && (
          <Button
            data-testid="button-complete-test"
            onClick={(e) => { e.stopPropagation(); onComplete(); }}
            disabled={isCompletePending}
            className="min-h-11"
          >
            {isCompletePending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Square className="w-4 h-4 mr-2" aria-hidden="true" />}
            Complete test
          </Button>
        )}

        {test.status === 'completed' && winner && onApplyWinner && (
          <Button
            data-testid="button-apply-winner"
            onClick={(e) => { e.stopPropagation(); onApplyWinner(); }}
            disabled={isApplyPending}
            className="min-h-11"
          >
            {isApplyPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Trophy className="w-4 h-4 mr-2" aria-hidden="true" />}
            Apply winner to campaign
          </Button>
        )}

        {test.status !== 'running' && onDelete && (
          <Button
            variant="outline"
            size="icon"
            aria-label={`Delete A/B test: ${test.name}`}
            data-testid="button-delete-test"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            disabled={isDeletePending}
            className="min-h-11 min-w-11"
          >
            {isDeletePending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
          </Button>
        )}
      </div>
    </div>
  );
}

export function AbTestHistoryList() {
  const { data: abTestsRaw, isLoading } = useQuery<AbTestWithVariants[] | { tests: AbTestWithVariants[] }>({
    queryKey: ['/api/ab-tests'],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8" role="status" aria-live="polite">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading A/B test results…</span>
      </div>
    );
  }

  // Server returns { tests: [...] }; normalize to array. See the same
  // unwrap in AbTestManager above.
  const abTests: AbTestWithVariants[] = Array.isArray(abTestsRaw)
    ? abTestsRaw
    : Array.isArray((abTestsRaw as { tests?: AbTestWithVariants[] } | undefined)?.tests)
    ? (abTestsRaw as { tests: AbTestWithVariants[] }).tests
    : [];

  const completedTests = abTests.filter(t => t.status === 'completed');
  const runningTests = abTests.filter(t => t.status === 'running');

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 mb-4">
        <Beaker className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-xl font-semibold">A/B test results</h2>
      </div>

      {runningTests.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Running tests</h3>
          <ul className="space-y-3" aria-label="Running A/B tests">
            {runningTests.map(test => (
              <li key={test.id}>
                <Card data-testid={`card-running-test-${test.id}`}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{test.name}</CardTitle>
                      <Badge className={statusColors.running}>Running</Badge>
                    </div>
                    <CardDescription>
                      {testTypeLabels[test.testType]} test — <span className="tabular-nums">{test.variants.length}</span> variants
                    </CardDescription>
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}

      {completedTests.length > 0 ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Completed tests</h3>
          <ul className="space-y-3" aria-label="Completed A/B tests">
            {completedTests.map(test => {
              const winner = test.variants.find(v => v.id === test.winnerId);
              return (
                <li key={test.id}>
                  <Card data-testid={`card-completed-test-${test.id}`}>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{test.name}</CardTitle>
                        <Badge className={statusColors.completed}>Completed</Badge>
                      </div>
                      <CardDescription className="tabular-nums">
                        {testTypeLabels[test.testType]} test — Completed {test.completedAt ? format(new Date(test.completedAt), 'MMM d, yyyy') : ''}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2 mb-2">
                        <Trophy className="w-4 h-4 text-amber-500" aria-hidden="true" />
                        <span className="font-medium">Winner: {winner?.name || '—'}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        {test.variants.map(v => {
                          const sent = v.sent || 0;
                          const responseRate = sent > 0 ? ((v.responded || 0) / sent * 100).toFixed(1) : '0';
                          return (
                            <div key={v.id} className="flex items-center justify-between p-2 rounded bg-muted/50">
                              <span className="flex items-center gap-2">
                                {v.name}
                                {v.id === test.winnerId && <Trophy className="w-3 h-3 text-amber-500" aria-hidden="true" />}
                              </span>
                              <span className="text-muted-foreground tabular-nums">{responseRate}% response</span>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" aria-hidden="true" />
          <p>No completed A/B tests yet.</p>
          <p className="text-sm mt-1">Create a test on any campaign to get started.</p>
        </div>
      )}
    </div>
  );
}
