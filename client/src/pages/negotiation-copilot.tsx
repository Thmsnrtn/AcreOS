import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  MessageSquare,
  Zap,
  Brain,
  TrendingUp,
  TrendingDown,
  Target,
  AlertCircle,
  ChevronRight,
  BarChart2,
  RefreshCw,
  Check,
  X,
} from 'lucide-react';

const STRATEGY_INFO: Record<string, { label: string; color: string; description: string }> = {
  empathy: { label: 'Empathy', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', description: 'Validate feelings and build connection' },
  logic: { label: 'Logic', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', description: 'Use facts and market data' },
  urgency: { label: 'Urgency', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', description: 'Time-limited framing' },
  anchor: { label: 'Anchor', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300', description: 'Reinforce original offer as fair' },
  silence: { label: 'Silence', color: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300', description: 'Give space and wait' },
};

const OBJECTION_COLORS: Record<string, string> = {
  price: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  timing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  trust: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  emotional: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
  competitive: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
};

function formatDollar(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function SentimentIndicator({ score }: { score: number }) {
  if (score > 0.3) return <span className="flex items-center gap-1 text-emerald-600 text-sm"><TrendingUp className="w-3 h-3" /> Positive ({(score * 100).toFixed(0)}%)</span>;
  if (score < -0.3) return <span className="flex items-center gap-1 text-red-500 text-sm"><TrendingDown className="w-3 h-3" /> Negative ({(Math.abs(score) * 100).toFixed(0)}%)</span>;
  return <span className="flex items-center gap-1 text-muted-foreground text-sm">Neutral</span>;
}

export default function NegotiationCopilotPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dealId, setDealId] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messageText, setMessageText] = useState('');
  const [counterResult, setCounterResult] = useState<any>(null);
  const [strategyResult, setStrategyResult] = useState<any>(null);
  const [objectionResult, setObjectionResult] = useState<any>(null);
  const [responseResult, setResponseResult] = useState<any>(null);
  const [sentimentResult, setSentimentResult] = useState<any>(null);

  // Sessions for current deal
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['negotiation', 'deal', dealId],
    queryFn: async () => {
      const res = await fetch(`/api/negotiation/deal/${dealId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.json();
    },
    enabled: !!dealId,
  });

  // Effectiveness analytics
  const { data: effectivenessData } = useQuery({
    queryKey: ['negotiation', 'effectiveness'],
    queryFn: async () => {
      const res = await fetch('/api/negotiation/effectiveness', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch effectiveness');
      return res.json();
    },
  });

  const startSessionMutation = useMutation({
    mutationFn: async (params: any) => {
      const res = await fetch('/api/negotiation/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start session');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setActiveSessionId(data.session.id);
      toast({ title: 'Session started', description: 'Negotiation copilot is ready.' });
      queryClient.invalidateQueries({ queryKey: ['negotiation', 'deal', dealId] });
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async ({ action, body }: { action: string; body: any }) => {
      const res = await fetch(`/api/negotiation/sessions/${activeSessionId}/${action}`, {
        method: action === 'strategy' ? 'GET' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: action === 'strategy' ? undefined : JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Failed to ${action}`);
      }
      return res.json();
    },
    onError: (err: Error) => {
      toast({ title: 'Analysis failed', description: err.message, variant: 'destructive' });
    },
  });

  const sessions = sessionsData?.sessions ?? [];
  const effectiveness = effectivenessData?.effectiveness ?? [];

  const handleDetectObjection = async () => {
    if (!messageText.trim() || !activeSessionId) return;
    const result = await analyzeMutation.mutateAsync({ action: 'detect-objection', body: { messageText } });
    setObjectionResult(result.objection);
  };

  const handleAnalyzeSentiment = async () => {
    if (!messageText.trim() || !activeSessionId) return;
    const result = await analyzeMutation.mutateAsync({ action: 'analyze-sentiment', body: { messageText } });
    setSentimentResult(result.sentiment);
  };

  const handleCounterOffer = async () => {
    if (!activeSessionId) return;
    const result = await analyzeMutation.mutateAsync({ action: 'counter-offer', body: {} });
    setCounterResult(result.suggestion);
  };

  const handleGetStrategy = async () => {
    if (!activeSessionId) return;
    const result = await fetch(`/api/negotiation/sessions/${activeSessionId}/strategy`, { credentials: 'include' });
    const data = await result.json();
    setStrategyResult(data.strategy);
  };

  const handleGenerateResponse = async (objectionId: string, strategy: string) => {
    if (!activeSessionId) return;
    const result = await analyzeMutation.mutateAsync({
      action: 'generate-response',
      body: { objectionId, strategy },
    });
    setResponseResult(result.response);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Brain className="w-8 h-8 text-primary" />
          Negotiation Copilot
        </h1>
        <p className="text-muted-foreground mt-1">
          AI-powered objection detection, counter-offer suggestions, and strategy recommendations for every deal.
        </p>
      </div>

      <Tabs defaultValue="session">
        <TabsList>
          <TabsTrigger value="session">Active Session</TabsTrigger>
          <TabsTrigger value="sessions">Deal History</TabsTrigger>
          <TabsTrigger value="analytics">Strategy Analytics</TabsTrigger>
        </TabsList>

        {/* ── ACTIVE SESSION ── */}
        <TabsContent value="session" className="space-y-6">
          {/* Start or load session */}
          {!activeSessionId ? (
            <Card>
              <CardHeader>
                <CardTitle>Start Negotiation Session</CardTitle>
                <CardDescription>Enter your deal ID to begin AI-assisted negotiation tracking</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Input
                    placeholder="Deal ID (numeric)"
                    value={dealId}
                    onChange={(e) => setDealId(e.target.value)}
                    className="w-40"
                    type="number"
                  />
                  <Button
                    onClick={() =>
                      startSessionMutation.mutate({
                        dealId: parseInt(dealId),
                        leadId: 0,
                        propertyId: 0,
                      })
                    }
                    disabled={!dealId || startSessionMutation.isPending}
                  >
                    <Zap className="w-4 h-4 mr-2" />
                    Start Session
                  </Button>
                  {sessions.length > 0 && (
                    <Button variant="outline" onClick={() => setActiveSessionId(sessions[0].id)}>
                      Resume Latest Session
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center gap-3">
              <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                Session #{activeSessionId} Active
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => setActiveSessionId(null)}>
                <X className="w-3 h-3 mr-1" /> End Session
              </Button>
            </div>
          )}

          {activeSessionId && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Message analysis */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Analyze Seller Message</CardTitle>
                  <CardDescription>Paste the seller's latest message for AI analysis</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Textarea
                    placeholder="Paste seller message here…"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    rows={4}
                  />
                  <div className="flex gap-3 flex-wrap">
                    <Button
                      variant="outline"
                      onClick={handleDetectObjection}
                      disabled={!messageText.trim() || analyzeMutation.isPending}
                    >
                      <AlertCircle className="w-4 h-4 mr-2" />
                      Detect Objection
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleAnalyzeSentiment}
                      disabled={!messageText.trim() || analyzeMutation.isPending}
                    >
                      <Target className="w-4 h-4 mr-2" />
                      Analyze Sentiment
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleGetStrategy}
                      disabled={analyzeMutation.isPending}
                    >
                      <Brain className="w-4 h-4 mr-2" />
                      Recommend Strategy
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleCounterOffer}
                      disabled={analyzeMutation.isPending}
                    >
                      <TrendingUp className="w-4 h-4 mr-2" />
                      Suggest Counter
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Sentiment */}
              {sentimentResult && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Sentiment Analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SentimentIndicator score={sentimentResult.score} />
                    {sentimentResult.indicators?.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {sentimentResult.indicators.map((ind: string, i: number) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                            <ChevronRight className="w-3 h-3" /> {ind}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Detected Objection */}
              {objectionResult && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Detected Objection</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Badge className={OBJECTION_COLORS[objectionResult.category] || 'bg-gray-100'}>
                      {objectionResult.category?.toUpperCase()} objection
                    </Badge>
                    <p className="text-sm">{objectionResult.text}</p>

                    <div className="space-y-2 pt-2">
                      <p className="text-xs text-muted-foreground font-medium">Suggested responses:</p>
                      {['empathy', 'logic', 'urgency'].map((strategy) => (
                        <Button
                          key={strategy}
                          variant="outline"
                          size="sm"
                          className="w-full justify-start"
                          onClick={() => handleGenerateResponse(objectionResult.id, strategy)}
                          disabled={analyzeMutation.isPending}
                        >
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs mr-2 ${STRATEGY_INFO[strategy]?.color}`}>
                            {STRATEGY_INFO[strategy]?.label}
                          </span>
                          Generate response
                        </Button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Strategy Recommendation */}
              {strategyResult && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Recommended Strategy</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge className={STRATEGY_INFO[strategyResult.strategy]?.color || ''}>
                        {STRATEGY_INFO[strategyResult.strategy]?.label || strategyResult.strategy}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{strategyResult.confidence}% confidence</span>
                    </div>
                    <p className="text-sm">{strategyResult.reasoning}</p>
                    {strategyResult.suggestedActions?.length > 0 && (
                      <ul className="space-y-1">
                        {strategyResult.suggestedActions.map((a: string, i: number) => (
                          <li key={i} className="text-xs flex items-start gap-1">
                            <Check className="w-3 h-3 mt-0.5 text-emerald-500 shrink-0" /> {a}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Counter Offer */}
              {counterResult && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Suggested Counter Offer</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-3xl font-bold text-primary">
                      {formatDollar(counterResult.suggestedAmount)}
                    </div>
                    <p className="text-sm">{counterResult.reasoning}</p>
                    <div className="text-sm text-muted-foreground">
                      Confidence: {counterResult.confidence}%
                    </div>
                    {counterResult.alternativeAmounts?.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Alternatives:</p>
                        <div className="flex gap-2 flex-wrap">
                          {counterResult.alternativeAmounts.map((a: number, i: number) => (
                            <Badge key={i} variant="outline">{formatDollar(a)}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Generated Response */}
              {responseResult && (
                <Card className="lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-sm">Generated Response</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="p-4 bg-muted/50 rounded-lg text-sm leading-relaxed">
                      {responseResult.response || responseResult}
                    </div>
                    <Button className="mt-3" size="sm" onClick={() => navigator.clipboard.writeText(responseResult.response || responseResult)}>
                      Copy to Clipboard
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── DEAL HISTORY ── */}
        <TabsContent value="sessions" className="space-y-4">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Deal ID"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              className="w-32"
              type="number"
            />
          </div>

          {sessionsLoading && <div className="text-center py-12 text-muted-foreground">Loading sessions…</div>}

          {sessions.length > 0 ? (
            <div className="space-y-3">
              {sessions.map((s: any) => (
                <Card key={s.id} className="cursor-pointer hover:shadow-md" onClick={() => setActiveSessionId(s.id)}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">Session #{s.id}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Started {new Date(s.createdAt).toLocaleDateString()}
                          {s.outcome && ` · Outcome: ${s.outcome}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.outcome ? (
                          <Badge className={s.outcome === 'accepted' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-800'}>
                            {s.outcome}
                          </Badge>
                        ) : (
                          <Badge className="bg-blue-100 text-blue-800">Active</Badge>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : dealId ? (
            <div className="text-center py-16 text-muted-foreground">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No sessions found for deal #{dealId}</p>
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Enter a deal ID to see negotiation history</p>
            </div>
          )}
        </TabsContent>

        {/* ── ANALYTICS ── */}
        <TabsContent value="analytics" className="space-y-6">
          {effectiveness.length > 0 ? (
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Strategy Effectiveness by Objection Type</CardTitle>
                  <CardDescription>Success rate analysis across all closed negotiation sessions</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {effectiveness.map((e: any, i: number) => (
                      <div key={i} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <Badge className={OBJECTION_COLORS[e.category] || ''}>
                              {e.category}
                            </Badge>
                            <span className="text-muted-foreground">→</span>
                            <Badge className={STRATEGY_INFO[e.strategy]?.color || ''}>
                              {STRATEGY_INFO[e.strategy]?.label || e.strategy}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-muted-foreground">{e.timesUsed}× used</span>
                            <span className="font-semibold">{(e.successRate * 100).toFixed(0)}% success</span>
                          </div>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div
                            className="bg-primary h-2 rounded-full transition-all"
                            style={{ width: `${e.successRate * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No effectiveness data yet — complete negotiation sessions to see analytics</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
