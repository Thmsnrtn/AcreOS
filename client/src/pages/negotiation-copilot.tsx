/**
 * Negotiation copilot — /negotiation
 *
 * Objection detection, counter-offer suggestions, and strategy
 * recommendations for every deal. The page owns the active-session
 * workflow; the satellite panels live in components/negotiation/:
 *   - meta.ts                    strategy vocabulary + result types
 *   - strategy-panels.tsx        sentiment / explainability / learning loop
 *   - pressure-gauge.tsx         seller-motivation gauge
 *   - batna-calculator.tsx       local BATNA math
 *   - session-history.tsx        deal-history tab (skeleton/empty/error)
 *   - strategy-analytics.tsx     analytics tab (skeleton/empty/error)
 *   - session-replay-panel.tsx   move-history timeline
 */

import { useId, useState } from 'react';
import { RequiredDisclaimer } from '@/components/required-disclaimer';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { ReadAloudButton } from '@/components/ReadAloudButton';
import {
  Zap,
  Brain,
  TrendingUp,
  Target,
  AlertCircle,
  ChevronRight,
  Check,
  X,
  History,
} from 'lucide-react';
import {
  STRATEGY_INFO,
  OBJECTION_COLORS,
  formatDollar,
  type NegotiationSession,
  type StrategyResult,
  type ObjectionResult,
  type SentimentResult,
  type CounterOfferResult,
  type EffectivenessRow,
} from '@/components/negotiation/meta';
import { SessionReplayPanel } from '@/components/negotiation/session-replay-panel';
import { SentimentIndicator, StrategyExplainabilityPanel, LearningLoopIndicator } from '@/components/negotiation/strategy-panels';
import { PsychologicalPressureGauge } from '@/components/negotiation/pressure-gauge';
import { BATNACalculator } from '@/components/negotiation/batna-calculator';
import { SessionHistory } from '@/components/negotiation/session-history';
import { StrategyAnalytics } from '@/components/negotiation/strategy-analytics';

export default function NegotiationCopilotPage() {
  useDocumentTitle('Negotiation copilot');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dealIdInputId = useId();
  const messageTextId = useId();

  const [activeTab, setActiveTab] = useState('session');
  const [dealId, setDealId] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messageText, setMessageText] = useState('');
  const [pendingEndSession, setPendingEndSession] = useState(false);
  const [counterResult, setCounterResult] = useState<CounterOfferResult | null>(null);
  const [strategyResult, setStrategyResult] = useState<StrategyResult | null>(null);
  const [objectionResult, setObjectionResult] = useState<ObjectionResult | null>(null);
  const [responseResult, setResponseResult] = useState<string | { response: string } | null>(null);
  const [sentimentResult, setSentimentResult] = useState<SentimentResult | null>(null);

  // Sessions for current deal
  const {
    data: sessionsData,
    isLoading: sessionsLoading,
    error: sessionsError,
    refetch: refetchSessions,
    isRefetching: sessionsRefetching,
  } = useQuery({
    queryKey: ['negotiation', 'deal', dealId],
    queryFn: async () => {
      const res = await fetch(`/api/negotiation/deal/${dealId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch sessions');
      return res.json();
    },
    enabled: !!dealId,
  });

  // Effectiveness analytics
  const {
    data: effectivenessData,
    isLoading: effectivenessLoading,
    error: effectivenessError,
    refetch: refetchEffectiveness,
    isRefetching: effectivenessRefetching,
  } = useQuery({
    queryKey: ['negotiation', 'effectiveness'],
    queryFn: async () => {
      const res = await fetch('/api/negotiation/effectiveness', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch effectiveness');
      return res.json();
    },
  });

  const startSessionMutation = useMutation({
    mutationFn: async (params: { dealId: number; leadId: number; propertyId: number }) => {
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
      toast({
        title: "Couldn't start session",
        description: `${err.message} — your deal ID is preserved. Try again.`,
        variant: 'destructive',
      });
    },
  });

  const analyzeMutation = useMutation({
    mutationFn: async ({ action, body }: { action: string; body: Record<string, unknown> }) => {
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
    onSuccess: () => {
      // Analysis actions record moves against the active session server-side —
      // refresh the session list so history/replay reflect them immediately.
      queryClient.invalidateQueries({ queryKey: ['negotiation', 'deal', dealId] });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't run analysis",
        description: `${err.message} — your message and prior results are preserved. Try again.`,
        variant: 'destructive',
      });
    },
  });

  const sessions: NegotiationSession[] = sessionsData?.sessions ?? [];
  const effectiveness: EffectivenessRow[] = effectivenessData?.effectiveness ?? [];

  /** EmptyState CTA target: jump the user to the Active session tab so the
   *  "Start a negotiation" promise lands on the form that actually starts one. */
  const goToStartNegotiation = () => setActiveTab('session');

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
    try {
      const result = await fetch(`/api/negotiation/sessions/${activeSessionId}/strategy`, { credentials: 'include' });
      if (!result.ok) {
        const err = await result.json().catch(() => ({}));
        throw new Error(err.error || 'Strategy fetch failed');
      }
      const data = await result.json();
      setStrategyResult(data.strategy);
    } catch (err) {
      toast({
        title: "Couldn't fetch strategy",
        description: `${err instanceof Error ? err.message : 'Network error'} — prior recommendations are preserved.`,
        variant: 'destructive',
      });
    }
  };

  const handleGenerateResponse = async (objectionId: string, strategy: string) => {
    if (!activeSessionId) return;
    const result = await analyzeMutation.mutateAsync({
      action: 'generate-response',
      body: { objectionId, strategy },
    });
    setResponseResult(result.response);
  };

  const responseText = responseResult
    ? (typeof responseResult === 'string' ? responseResult : responseResult.response)
    : '';

  return (
    <div className="container mx-auto p-6 space-y-6">
      <RequiredDisclaimer type="ai" />
      <RequiredDisclaimer type="legal" />
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Brain className="w-8 h-8 text-primary" aria-hidden="true" />
          Negotiation copilot
        </h1>
        <p className="text-muted-foreground mt-1">
          Objection detection, counter-offer suggestions, and strategy recommendations for every deal.
        </p>
      </div>

      <LearningLoopIndicator />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="session" className="min-h-11 pointer-fine:sm:min-h-9">Active session</TabsTrigger>
          <TabsTrigger value="batna" className="min-h-11 pointer-fine:sm:min-h-9">BATNA calculator</TabsTrigger>
          <TabsTrigger value="sessions" className="min-h-11 pointer-fine:sm:min-h-9">Deal history</TabsTrigger>
          <TabsTrigger value="analytics" className="min-h-11 pointer-fine:sm:min-h-9">Strategy analytics</TabsTrigger>
          <TabsTrigger value="replay" className="min-h-11 pointer-fine:sm:min-h-9">Session replay</TabsTrigger>
        </TabsList>

        {/* ── ACTIVE SESSION ── */}
        <TabsContent value="session" className="space-y-6">
          {/* Start or load session */}
          {!activeSessionId ? (
            <Card>
              <CardHeader>
                <CardTitle>Start negotiation session</CardTitle>
                <CardDescription>Enter your deal ID to begin AI-assisted negotiation tracking.</CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  className="flex gap-3 flex-wrap items-end"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (dealId && !startSessionMutation.isPending) {
                      startSessionMutation.mutate({ dealId: parseInt(dealId), leadId: 0, propertyId: 0 });
                    }
                  }}
                >
                  <div className="space-y-1">
                    <Label htmlFor={dealIdInputId}>Deal ID</Label>
                    <Input
                      id={dealIdInputId}
                      placeholder="numeric"
                      value={dealId}
                      onChange={(e) => setDealId(e.target.value)}
                      className="w-40 tabular-nums"
                      type="number"
                      inputMode="numeric"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={!dealId || startSessionMutation.isPending}
                  >
                    <Zap className="w-4 h-4 mr-2" aria-hidden="true" />
                    {startSessionMutation.isPending ? 'Starting…' : 'Start session'}
                  </Button>
                  {sessions.length > 0 && (
                    <Button type="button" variant="outline" onClick={() => setActiveSessionId(sessions[0].id)}>
                      Resume latest session
                    </Button>
                  )}
                </form>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center gap-3" role="status" aria-live="polite">
              <Badge className="bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos" aria-label={`Session ${activeSessionId} is active`}>
                Session #<span className="tabular-nums">{activeSessionId}</span> active
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => setPendingEndSession(true)} aria-label={`End negotiation session ${activeSessionId}`}>
                <X className="w-3 h-3 mr-1" aria-hidden="true" /> End session
              </Button>
            </div>
          )}

          {activeSessionId && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Message analysis */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Analyze seller message</CardTitle>
                  <CardDescription>Paste the seller's latest message for AI analysis.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Label htmlFor={messageTextId} className="sr-only">Seller message</Label>
                  <Textarea
                    id={messageTextId}
                    placeholder="Paste seller message here…"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    rows={4}
                    autoCapitalize="sentences"
                  />
                  <div className="flex gap-3 flex-wrap" role="group" aria-label="Analysis actions for seller message">
                    <Button
                      variant="outline"
                      onClick={handleDetectObjection}
                      disabled={!messageText.trim() || analyzeMutation.isPending}
                    >
                      <AlertCircle className="w-4 h-4 mr-2" aria-hidden="true" />
                      Detect objection
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleAnalyzeSentiment}
                      disabled={!messageText.trim() || analyzeMutation.isPending}
                    >
                      <Target className="w-4 h-4 mr-2" aria-hidden="true" />
                      Analyze sentiment
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleGetStrategy}
                      disabled={analyzeMutation.isPending}
                    >
                      <Brain className="w-4 h-4 mr-2" aria-hidden="true" />
                      Recommend strategy
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleCounterOffer}
                      disabled={analyzeMutation.isPending}
                    >
                      <TrendingUp className="w-4 h-4 mr-2" aria-hidden="true" />
                      Suggest counter
                    </Button>
                  </div>
                  {analyzeMutation.isPending && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5" role="status" aria-live="polite">
                      <Brain className="w-3.5 h-3.5 animate-pulse text-primary" aria-hidden="true" />
                      Pax is analyzing — results land below in a few seconds.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Psychological Pressure Gauge — always show when message present */}
              {messageText.trim() && (
                <PsychologicalPressureGauge
                  sellerMessage={messageText}
                  sentiment={sentimentResult}
                  objection={objectionResult}
                />
              )}

              {/* Sentiment */}
              {sentimentResult && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Sentiment analysis</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SentimentIndicator score={sentimentResult.score} />
                    {sentimentResult.indicators && sentimentResult.indicators.length > 0 && (
                      <ul className="mt-3 space-y-1 list-none p-0" aria-label="Sentiment indicators detected in message">
                        {sentimentResult.indicators.map((ind, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex items-center gap-1">
                            <ChevronRight className="w-3 h-3" aria-hidden="true" /> {ind}
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
                    <CardTitle className="text-sm">Detected objection</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Badge className={OBJECTION_COLORS[objectionResult.category] || 'bg-muted'} aria-label={`${objectionResult.category} objection`}>
                      {objectionResult.category?.toUpperCase()} objection
                    </Badge>
                    <p className="text-sm">{objectionResult.text}</p>

                    <div className="space-y-2 pt-2">
                      <p className="text-xs text-muted-foreground font-medium">Suggested responses:</p>
                      <ul className="space-y-2 list-none p-0 m-0" role="group" aria-label="Generate response with strategy">
                        {['empathy', 'logic', 'urgency'].map((strategy) => (
                          <li key={strategy}>
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full justify-start min-h-11 pointer-fine:sm:min-h-9"
                              onClick={() => handleGenerateResponse(objectionResult.id, strategy)}
                              disabled={analyzeMutation.isPending}
                              aria-label={`Generate ${STRATEGY_INFO[strategy]?.label || strategy} response to ${objectionResult.category} objection`}
                            >
                              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs mr-2 ${STRATEGY_INFO[strategy]?.color}`}>
                                {STRATEGY_INFO[strategy]?.label}
                              </span>
                              Generate response
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Strategy Recommendation */}
              {strategyResult && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Recommended strategy</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge className={STRATEGY_INFO[strategyResult.strategy]?.color || ''}>
                        {STRATEGY_INFO[strategyResult.strategy]?.label || strategyResult.strategy}
                      </Badge>
                      <span className="text-sm text-muted-foreground tabular-nums">{strategyResult.confidence}% confidence</span>
                    </div>
                    <p className="text-sm">{strategyResult.reasoning}</p>
                    {strategyResult.suggestedActions && strategyResult.suggestedActions.length > 0 && (
                      <ul className="space-y-1 list-none p-0 m-0" aria-label="Suggested actions">
                        {strategyResult.suggestedActions.map((a, i) => (
                          <li key={i} className="text-xs flex items-start gap-1">
                            <Check className="w-3 h-3 mt-0.5 text-acr-pos shrink-0" aria-hidden="true" /> {a}
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
                    <CardTitle className="text-sm">Suggested counter offer</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="text-3xl font-bold tabular-nums text-primary" aria-label={`Suggested counter offer: ${formatDollar(counterResult.suggestedAmount)}`}>
                      {formatDollar(counterResult.suggestedAmount)}
                    </div>
                    <p className="text-sm">{counterResult.reasoning}</p>
                    <div className="text-sm text-muted-foreground tabular-nums">
                      Confidence: {counterResult.confidence}%
                    </div>
                    {counterResult.alternativeAmounts && counterResult.alternativeAmounts.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Alternatives:</p>
                        <ul className="flex gap-2 flex-wrap list-none p-0 m-0" aria-label="Alternative counter offers">
                          {counterResult.alternativeAmounts.map((a, i) => (
                            <li key={i}><Badge variant="outline" className="tabular-nums">{formatDollar(a)}</Badge></li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Generated Response */}
              {responseResult && (
                <Card className="lg:col-span-2">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-sm">Generated response</CardTitle>
                    <ReadAloudButton
                      text={responseText}
                      data-testid="negotiation-copilot-read-aloud"
                    />
                  </CardHeader>
                  <CardContent>
                    <div className="p-4 bg-muted/50 rounded-card text-sm leading-relaxed" aria-label="AI-generated response draft">
                      {responseText}
                    </div>
                    <Button
                      className="mt-3 min-h-11 pointer-fine:sm:min-h-9"
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(responseText);
                          toast({ title: "Copied to clipboard" });
                        } catch {
                          toast({ variant: "destructive", title: "Couldn't copy", description: "Your browser blocked clipboard access. Select the text and copy manually." });
                        }
                      }}
                      aria-label="Copy AI-generated response to clipboard"
                    >
                      Copy to clipboard
                    </Button>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── BATNA CALCULATOR ── */}
        <TabsContent value="batna" className="space-y-4">
          <BATNACalculator />
        </TabsContent>

        {/* ── DEAL HISTORY ── */}
        <TabsContent value="sessions" className="space-y-4">
          <SessionHistory
            dealId={dealId}
            setDealId={setDealId}
            sessions={sessions}
            isLoading={sessionsLoading}
            error={sessionsError as Error | null}
            isRefetching={sessionsRefetching}
            onRetry={() => refetchSessions()}
            onOpenSession={(id) => {
              setActiveSessionId(id);
              setActiveTab('session');
            }}
            onStartNegotiation={goToStartNegotiation}
          />
        </TabsContent>

        {/* ── SESSION REPLAY ── */}
        <TabsContent value="replay" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <History className="w-4 h-4 text-primary" aria-hidden="true" /> Session replay
              </CardTitle>
              <CardDescription>Full move history with AI reasoning for the current session.</CardDescription>
            </CardHeader>
            <CardContent>
              {activeSessionId ? (
                <SessionReplayPanel session={sessions.find((s) => s.id === activeSessionId)} />
              ) : sessions.length > 0 ? (
                <SessionReplayPanel session={sessions[0]} />
              ) : (
                <div className="text-center py-8" role="status">
                  <History className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-40" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground mb-4">Start a session and make moves to see the replay timeline here.</p>
                  <Button variant="outline" onClick={goToStartNegotiation} className="min-h-11 pointer-fine:sm:min-h-9">
                    Start a negotiation
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── ANALYTICS ── */}
        <TabsContent value="analytics" className="space-y-6">
          <StrategyAnalytics
            effectiveness={effectiveness}
            isLoading={effectivenessLoading}
            error={effectivenessError as Error | null}
            isRefetching={effectivenessRefetching}
            onRetry={() => refetchEffectiveness()}
            onStartNegotiation={goToStartNegotiation}
          />
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={pendingEndSession}
        onOpenChange={(open) => { if (!open) setPendingEndSession(false); }}
        title={`End negotiation session #${activeSessionId}?`}
        description="Move history and analysis are preserved on the session record — you can resume it later from Deal history. The session itself stays open until you explicitly close it on the deal."
        confirmLabel="End session"
        onConfirm={() => {
          setActiveSessionId(null);
          setPendingEndSession(false);
        }}
      />
    </div>
  );
}
