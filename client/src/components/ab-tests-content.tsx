import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, TestTube, Play, Square, Trophy, TrendingUp, 
  Loader2, Trash2, Eye, CheckCircle, Clock, BarChart3
} from "lucide-react";
import { format } from "date-fns";
import type { AbTest, AbTestVariant, Campaign } from "@shared/schema";

type AbTestWithVariants = AbTest & { variants: AbTestVariant[] };

const statusColors: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

const statusIcons: Record<string, any> = {
  draft: Clock,
  running: Play,
  completed: CheckCircle,
  cancelled: Square,
};

const testTypeLabels: Record<string, string> = {
  subject: 'Subject Line',
  content: 'Content',
  offer: 'Offer Amount',
  timing: 'Send Timing',
};

const winningMetricLabels: Record<string, string> = {
  response_rate: 'Response Rate',
  open_rate: 'Open Rate',
  click_rate: 'Click Rate',
  conversion_rate: 'Conversion Rate',
};

const confidenceBadge = (level: number) => {
  if (level >= 99) return { label: '99%', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' };
  if (level >= 95) return { label: '95%', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' };
  if (level >= 90) return { label: '90%', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' };
  return { label: 'Not significant', color: 'bg-muted text-muted-foreground' };
};

export function ABTestsContent() {
  const { toast } = useToast();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [selectedTest, setSelectedTest] = useState<AbTestWithVariants | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    campaignId: "",
    testType: "subject" as "subject" | "content" | "offer" | "timing",
    winningMetric: "response_rate" as "response_rate" | "open_rate" | "click_rate" | "conversion_rate",
    sampleSize: 25,
  });
  const [variants, setVariants] = useState<{ name: string; subject: string; content: string; isControl: boolean }[]>([
    { name: "Control (A)", subject: "", content: "", isControl: true },
    { name: "Variant B", subject: "", content: "", isControl: false },
  ]);

  const { data: abTests, isLoading } = useQuery<AbTestWithVariants[]>({
    queryKey: ["/api/ab-tests"],
  });

  const { data: campaigns } = useQuery<Campaign[]>({
    queryKey: ["/api/campaigns"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { test: typeof formData; variants: typeof variants }) => {
      const res = await apiRequest("POST", "/api/ab-tests", {
        name: data.test.name,
        campaignId: parseInt(data.test.campaignId),
        testType: data.test.testType,
        winningMetric: data.test.winningMetric,
        sampleSize: data.test.sampleSize,
      });
      const test = await res.json();
      for (const variant of data.variants) {
        await apiRequest("POST", `/api/ab-tests/${test.id}/variants`, variant);
      }
      return test;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests"] });
      setIsCreateDialogOpen(false);
      resetForm();
      toast({ title: "A/B test created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create A/B test", variant: "destructive" });
    },
  });

  const startMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/ab-tests/${id}/start`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests"] });
      toast({ title: "A/B test started" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/ab-tests/${id}/complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests"] });
      toast({ title: "A/B test completed" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/ab-tests/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ab-tests"] });
      setSelectedTest(null);
      toast({ title: "A/B test deleted" });
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      campaignId: "",
      testType: "subject",
      winningMetric: "response_rate",
      sampleSize: 25,
    });
    setVariants([
      { name: "Control (A)", subject: "", content: "", isControl: true },
      { name: "Variant B", subject: "", content: "", isControl: false },
    ]);
  };

  const handleCreateSubmit = () => {
    if (!formData.name || !formData.campaignId) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    if (variants.length < 2) {
      toast({ title: "Please add at least 2 variants", variant: "destructive" });
      return;
    }
    createMutation.mutate({ test: formData, variants });
  };

  const addVariant = () => {
    const nextLetter = String.fromCharCode(65 + variants.length);
    setVariants([...variants, { name: `Variant ${nextLetter}`, subject: "", content: "", isControl: false }]);
  };

  const updateVariant = (index: number, field: string, value: string | boolean) => {
    const updated = [...variants];
    (updated[index] as any)[field] = value;
    setVariants(updated);
  };

  const removeVariant = (index: number) => {
    if (variants.length > 2) {
      setVariants(variants.filter((_, i) => i !== index));
    }
  };

  const getCampaignName = (campaignId: number | null) => {
    if (!campaignId) return "No campaign";
    return campaigns?.find((c) => c.id === campaignId)?.name || "Unknown";
  };

  const runningTests = abTests?.filter((t) => t.status === "running") || [];
  const completedTests = abTests?.filter((t) => t.status === "completed") || [];
  const draftTests = abTests?.filter((t) => t.status === "draft") || [];

  return (
    <div className="space-y-8" data-testid="ab-tests-content">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold" data-testid="text-ab-tests-title">A/B Testing</h2>
          <p className="text-muted-foreground">
            Test different campaign variations to optimize performance
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-ab-test">
              <Plus className="w-4 h-4 mr-2" />
              Create A/B Test
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Create New A/B Test</DialogTitle>
              <DialogDescription>
                Set up a test to compare different versions of your campaign
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Test Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Q1 Subject Line Test"
                    data-testid="input-test-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Linked Campaign</Label>
                  <Select
                    value={formData.campaignId}
                    onValueChange={(value) => setFormData({ ...formData, campaignId: value })}
                  >
                    <SelectTrigger data-testid="select-campaign">
                      <SelectValue placeholder="Select a campaign" />
                    </SelectTrigger>
                    <SelectContent>
                      {campaigns?.map((campaign) => (
                        <SelectItem key={campaign.id} value={campaign.id.toString()}>
                          {campaign.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Test Type</Label>
                  <Select
                    value={formData.testType}
                    onValueChange={(value: any) => setFormData({ ...formData, testType: value })}
                  >
                    <SelectTrigger data-testid="select-test-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="subject">Subject Line</SelectItem>
                      <SelectItem value="content">Content</SelectItem>
                      <SelectItem value="offer">Offer Amount</SelectItem>
                      <SelectItem value="timing">Send Timing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Winning Metric</Label>
                  <Select
                    value={formData.winningMetric}
                    onValueChange={(value: any) => setFormData({ ...formData, winningMetric: value })}
                  >
                    <SelectTrigger data-testid="select-winning-metric">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="response_rate">Response Rate</SelectItem>
                      <SelectItem value="open_rate">Open Rate</SelectItem>
                      <SelectItem value="click_rate">Click Rate</SelectItem>
                      <SelectItem value="conversion_rate">Conversion Rate</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Sample Size: {formData.sampleSize}%</Label>
                <Slider
                  value={[formData.sampleSize]}
                  onValueChange={([value]) => setFormData({ ...formData, sampleSize: value })}
                  min={10}
                  max={50}
                  step={5}
                  data-testid="slider-sample-size"
                />
                <p className="text-xs text-muted-foreground">
                  Percentage of audience to use for testing before selecting a winner
                </p>
              </div>

              <div className="border-t pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium">Variants</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addVariant}
                    data-testid="button-add-variant"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Variant
                  </Button>
                </div>

                <div className="space-y-4">
                  {variants.map((variant, index) => (
                    <Card key={index} data-testid={`card-variant-${index}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary">
                              {String.fromCharCode(65 + index)}
                            </Badge>
                            <Input
                              value={variant.name}
                              onChange={(e) => updateVariant(index, "name", e.target.value)}
                              className="w-48"
                              data-testid={`input-variant-name-${index}`}
                            />
                            {variant.isControl && (
                              <Badge variant="outline">Control</Badge>
                            )}
                          </div>
                          {variants.length > 2 && !variant.isControl && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeVariant(index)}
                              data-testid={`button-remove-variant-${index}`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="space-y-2">
                          <Label>Subject</Label>
                          <Input
                            value={variant.subject}
                            onChange={(e) => updateVariant(index, "subject", e.target.value)}
                            placeholder="Enter subject line"
                            data-testid={`input-variant-subject-${index}`}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Content</Label>
                          <Textarea
                            value={variant.content}
                            onChange={(e) => updateVariant(index, "content", e.target.value)}
                            placeholder="Enter content"
                            rows={3}
                            data-testid={`input-variant-content-${index}`}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => { setIsCreateDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateSubmit}
                disabled={createMutation.isPending}
                data-testid="button-save-test"
              >
                {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Create Test
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Tests</CardTitle>
            <Play className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-running-count">
              {runningTests.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-completed-count">
              {completedTests.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Drafts</CardTitle>
            <Clock className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold" data-testid="text-draft-count">
              {draftTests.length}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all" data-testid="tab-all">All Tests</TabsTrigger>
          <TabsTrigger value="running" data-testid="tab-running">Running</TabsTrigger>
          <TabsTrigger value="completed" data-testid="tab-completed">Completed</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
          ) : abTests?.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <TestTube className="w-12 h-12 mb-4 opacity-50" />
                <p className="mb-4">No A/B tests created yet</p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Create Your First Test
                </Button>
              </CardContent>
            </Card>
          ) : (
            <TestTable
              tests={abTests || []}
              onView={setSelectedTest}
              onStart={(id) => startMutation.mutate(id)}
              onComplete={(id) => completeMutation.mutate(id)}
              onDelete={(id) => deleteMutation.mutate(id)}
              getCampaignName={getCampaignName}
              isPending={startMutation.isPending || completeMutation.isPending || deleteMutation.isPending}
            />
          )}
        </TabsContent>

        <TabsContent value="running" className="space-y-4">
          <TestTable
            tests={runningTests}
            onView={setSelectedTest}
            onComplete={(id) => completeMutation.mutate(id)}
            onDelete={(id) => deleteMutation.mutate(id)}
            getCampaignName={getCampaignName}
            isPending={completeMutation.isPending || deleteMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="completed" className="space-y-4">
          <TestTable
            tests={completedTests}
            onView={setSelectedTest}
            onDelete={(id) => deleteMutation.mutate(id)}
            getCampaignName={getCampaignName}
            isPending={deleteMutation.isPending}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={!!selectedTest} onOpenChange={() => setSelectedTest(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedTest?.name}</DialogTitle>
            <DialogDescription>
              {selectedTest && getCampaignName(selectedTest.campaignId)}
            </DialogDescription>
          </DialogHeader>
          {selectedTest && (
            <TestDetails
              test={selectedTest}
              onComplete={() => completeMutation.mutate(selectedTest.id)}
              isPending={completeMutation.isPending}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface TestTableProps {
  tests: AbTestWithVariants[];
  onView: (test: AbTestWithVariants) => void;
  onStart?: (id: number) => void;
  onComplete?: (id: number) => void;
  onDelete: (id: number) => void;
  getCampaignName: (id: number | null) => string;
  isPending: boolean;
}

function TestTable({ tests, onView, onStart, onComplete, onDelete, getCampaignName, isPending }: TestTableProps) {
  if (tests.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No tests in this category
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Campaign</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Winning Metric</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Winner</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tests.map((test) => {
            const StatusIcon = statusIcons[test.status] || Clock;
            const winner = test.variants?.find((v) => v.id === test.winnerId);
            return (
              <TableRow key={test.id} data-testid={`row-test-${test.id}`}>
                <TableCell className="font-medium">{test.name}</TableCell>
                <TableCell>{getCampaignName(test.campaignId)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{testTypeLabels[test.testType] || test.testType}</Badge>
                </TableCell>
                <TableCell>{winningMetricLabels[test.winningMetric] || test.winningMetric}</TableCell>
                <TableCell>
                  <Badge className={statusColors[test.status]}>
                    <StatusIcon className="w-3 h-3 mr-1" />
                    {test.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {winner ? (
                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                      <Trophy className="w-3 h-3 mr-1" />
                      {winner.name}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onView(test)}
                      data-testid={`button-view-test-${test.id}`}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                    {test.status === "draft" && onStart && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onStart(test.id)}
                        disabled={isPending}
                        data-testid={`button-start-test-${test.id}`}
                      >
                        <Play className="w-4 h-4" />
                      </Button>
                    )}
                    {test.status === "running" && onComplete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onComplete(test.id)}
                        disabled={isPending}
                        data-testid={`button-complete-test-${test.id}`}
                      >
                        <Square className="w-4 h-4" />
                      </Button>
                    )}
                    {test.status !== "running" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => onDelete(test.id)}
                        disabled={isPending}
                        data-testid={`button-delete-test-${test.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

interface TestDetailsProps {
  test: AbTestWithVariants;
  onComplete: () => void;
  isPending: boolean;
}

function TestDetails({ test, onComplete, isPending }: TestDetailsProps) {
  return (
    <div className="space-y-6 py-4">
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Test Type:</span>
          <p className="font-medium">{testTypeLabels[test.testType] || test.testType}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Winning Metric:</span>
          <p className="font-medium">{winningMetricLabels[test.winningMetric] || test.winningMetric}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Sample Size:</span>
          <p className="font-medium">{test.minSampleSize || 25}%</p>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="font-medium">Variants Performance</h4>
        {test.variants?.map((variant, index) => {
          const isWinner = variant.id === test.winnerId;
          const sent = variant.sent || 0;
          const responded = variant.responded || 0;
          const responseRate = sent > 0 ? (responded / sent) * 100 : 0;
          const confidence = parseFloat(variant.confidenceLevel || "0");
          const confidenceInfo = confidenceBadge(confidence);

          return (
            <Card
              key={variant.id}
              className={isWinner ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10" : ""}
              data-testid={`card-variant-detail-${variant.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{String.fromCharCode(65 + index)}</Badge>
                    <span className="font-medium">{variant.name}</span>
                    {variant.isControl && <Badge variant="outline">Control</Badge>}
                    {isWinner && (
                      <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                        <Trophy className="w-3 h-3 mr-1" />
                        Winner
                      </Badge>
                    )}
                  </div>
                  {!variant.isControl && confidence > 0 && (
                    <Badge className={confidenceInfo.color}>{confidenceInfo.label} confidence</Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {variant.subject && (
                  <div className="mb-3">
                    <span className="text-xs text-muted-foreground">Subject:</span>
                    <p className="text-sm">{variant.subject}</p>
                  </div>
                )}

                <div className="grid grid-cols-5 gap-3">
                  <div className="text-center">
                    <p className="text-xl font-semibold" data-testid={`text-sent-${variant.id}`}>{sent}</p>
                    <p className="text-xs text-muted-foreground">Sent</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-semibold" data-testid={`text-delivered-${variant.id}`}>{variant.delivered || 0}</p>
                    <p className="text-xs text-muted-foreground">Delivered</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-semibold" data-testid={`text-opened-${variant.id}`}>{variant.opened || 0}</p>
                    <p className="text-xs text-muted-foreground">Opened</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-semibold" data-testid={`text-clicked-${variant.id}`}>{variant.clicked || 0}</p>
                    <p className="text-xs text-muted-foreground">Clicked</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-semibold" data-testid={`text-responded-${variant.id}`}>{responded}</p>
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
              </CardContent>
            </Card>
          );
        })}
      </div>

      {test.status === "running" && (
        <div className="flex justify-end">
          <Button onClick={onComplete} disabled={isPending} data-testid="button-complete-test-dialog">
            {isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Square className="w-4 h-4 mr-2" />
            Complete Test
          </Button>
        </div>
      )}
    </div>
  );
}
