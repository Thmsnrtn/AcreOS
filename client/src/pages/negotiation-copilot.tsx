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
  History,
  FlaskConical,
  Info,
  Activity,
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

// ─── Session Replay Component ─────────────────────────────────────────────────

function SessionReplayPanel({ session }: { session: any }) {
  const moves = session?.moves ?? session?.moveHistory ?? [];
  if (!moves || moves.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm">
        <History className="w-6 h-6 mx-auto mb-2 opacity-40" />
        No move history recorded for this session.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Move History</p>
      <div className="relative pl-4 border-l-2 border-muted space-y-4">
        {moves.map((move: any, i: number) => (
          <div key={i} className="relative">
            <div className="absolute -left-[1.125rem] top-1 w-3 h-3 rounded-full bg-primary/30 border-2 border-primary" />
            <div className="text-xs text-muted-foreground mb-0.5">
              {move.timestamp ? new Date(move.timestamp).toLocaleString() : `Move ${i + 1}`}
            </div>
            <div className="flex items-center gap-2 mb-1">
              {move.strategy && (
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STRATEGY_INFO[move.strategy]?.color ?? 'bg-gray-100 text-gray-800'}`}>
                  {STRATEGY_INFO[move.strategy]?.label ?? move.strategy}
                </span>
              )}
              {move.type && <span className="text-xs text-muted-foreground capitalize">{move.type.replace(/_/g, ' ')}</span>}
            </div>
            {move.content && <p className="text-sm bg-muted/50 rounded p-2">{move.content}</p>}
            {move.aiReasoning && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Brain className="w-3 h-3 mt-0.5 shrink-0 text-primary" />
                <span className="italic">{move.aiReasoning}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Strategy Explainability Panel ───────────────────────────────────────────

function StrategyExplainabilityPanel({ strategyResult }: { strategyResult: any }) {
  if (!strategyResult) return null;
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Info className="w-4 h-4 text-primary" /> Why Atlas Recommends This Approach
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <Badge className={STRATEGY_INFO[strategyResult.strategy]?.color || ''}>
            {STRATEGY_INFO[strategyResult.strategy]?.label || strategyResult.strategy}
          </Badge>
          <span className="text-muted-foreground text-xs">strategy · {strategyResult.confidence}% confidence</span>
        </div>
        <p className="text-muted-foreground">{strategyResult.reasoning}</p>
        {strategyResult.dataCitations?.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Data citations:</p>
            {strategyResult.dataCitations.map((cite: string, i: number) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <span className="text-primary font-mono">[{i + 1}]</span> {cite}
              </div>
            ))}
          </div>
        )}
        {strategyResult.successRate != null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TrendingUp className="w-3 h-3 text-emerald-500" />
            Historical success rate for this strategy: <strong className="text-foreground">{(strategyResult.successRate * 100).toFixed(0)}%</strong>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Learning Loop Indicator ──────────────────────────────────────────────────

function LearningLoopIndicator() {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-md text-xs text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
      <Activity className="w-3.5 h-3.5 animate-pulse" />
      <span><strong>Learning loop active</strong> — strategy effectiveness is being tracked and will improve recommendations over time.</span>
    </div>
  );
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

      <LearningLoopIndicator />

      <Tabs defaultValue="session">
        <TabsList>
          <TabsTrigger value="session">Active Session</TabsTrigger>
          <TabsTrigger value="sessions">Deal History</TabsTrigger>
          <TabsTrigger value="analytics">Strategy Analytics</TabsTrigger>
          <TabsTrigger value="replay">Session Replay</TabsTrigger>
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

              {/* Strategy Explainability */}
              {strategyResult && (
                <StrategyExplainabilityPanel strategyResult={strategyResult} />
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

        {/* ── SESSION REPLAY ── */}
        <TabsContent value="replay" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <History className="w-4 h-4 text-primary" /> Session Replay
              </CardTitle>
              <CardDescription>Full move history with AI reasoning for the current session</CardDescription>
            </CardHeader>
            <CardContent>
              {activeSessionId ? (
                <SessionReplayPanel session={sessions.find((s: any) => s.id === activeSessionId)} />
              ) : sessions.length > 0 ? (
                <SessionReplayPanel session={sessions[0]} />
              ) : (
                <p className="text-sm text-muted-foreground">Start a session and make moves to see replay here.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ANALYTICS ── */}
        <TabsContent value="analytics" className="space-y-6">
          {effectiveness.length > 0 ? (
            <div className="space-y-4">
              {/* A/B Test Analytics Panel */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-primary" /> A/B Strategy Win Rate Comparison
                  </CardTitle>
                  <CardDescription>Strategy effectiveness comparison across all sessions</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 text-xs text-muted-foreground">Strategy</th>
                          <th className="text-left py-2 text-xs text-muted-foreground">vs. Objection</th>
                          <th className="text-right py-2 text-xs text-muted-foreground">Used</th>
                          <th className="text-right py-2 text-xs text-muted-foreground">Win Rate</th>
                          <th className="py-2 pl-4 text-xs text-muted-foreground">Bar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {effectiveness.map((e: any, i: number) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2">
                              <Badge className={`${STRATEGY_INFO[e.strategy]?.color || ''} text-xs`}>
                                {STRATEGY_INFO[e.strategy]?.label || e.strategy}
                              </Badge>
                            </td>
                            <td className="py-2">
                              <Badge className={`${OBJECTION_COLORS[e.category] || ''} text-xs`}>
                                {e.category}
                              </Badge>
                            </td>
                            <td className="py-2 text-right text-muted-foreground">{e.timesUsed}×</td>
                            <td className="py-2 text-right font-semibold">{(e.successRate * 100).toFixed(0)}%</td>
                            <td className="py-2 pl-4 w-32">
                              <div className="w-full bg-muted rounded-full h-1.5">
                                <div className="bg-primary h-1.5 rounded-full" style={{ width: `${e.successRate * 100}%` }} />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

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
