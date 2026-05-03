import { useId, useState } from 'react';
import { RequiredDisclaimer } from '@/components/required-disclaimer';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { usd } from '@/lib/format';
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
import { ReadAloudButton } from '@/components/ReadAloudButton';
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
  Shield,
  DollarSign,
  Gauge,
  ArrowLeftRight,
  Lightbulb,
  Clock,
} from 'lucide-react';

const STRATEGY_INFO: Record<string, { label: string; color: string; description: string }> = {
  empathy: { label: 'Empathy', color: 'bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent', description: 'Validate feelings and build connection' },
  logic: { label: 'Logic', color: 'bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand', description: 'Use facts and market data' },
  urgency: { label: 'Urgency', color: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn', description: 'Time-limited framing' },
  anchor: { label: 'Anchor', color: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn', description: 'Reinforce original offer as fair' },
  silence: { label: 'Silence', color: 'bg-muted text-foreground dark:bg-acr-bg-sunken dark:text-muted-foreground', description: 'Give space and wait' },
};

const OBJECTION_COLORS: Record<string, string> = {
  price: 'bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg',
  timing: 'bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent',
  trust: 'bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn',
  emotional: 'bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand',
  competitive: 'bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand',
};

// P1 money-precision: K/M compact bands intentionally kept for the copilot's hero
// numbers (counter-offer amounts, BATNA outputs — readability over cents at scale).
// Sub-$1K fall-through swapped to canonical usd(noCents).
function formatDollar(n: number) {
  if (!n || isNaN(n)) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return usd(n, { noCents: true });
}

function SentimentIndicator({ score }: { score: number }) {
  if (score > 0.3) return <span className="flex items-center gap-1 text-acr-pos text-sm"><TrendingUp className="w-3 h-3" /> Positive ({(score * 100).toFixed(0)}%)</span>;
  if (score < -0.3) return <span className="flex items-center gap-1 text-acr-neg text-sm"><TrendingDown className="w-3 h-3" /> Negative ({(Math.abs(score) * 100).toFixed(0)}%)</span>;
  return <span className="flex items-center gap-1 text-muted-foreground text-sm">Neutral</span>;
}

// ─── Session Replay Component ─────────────────────────────────────────────────

function SessionReplayPanel({ session }: { session: any }) {
  const moves = session?.moves ?? session?.moveHistory ?? [];
  if (!moves || moves.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground text-sm" role="status">
        <History className="w-6 h-6 mx-auto mb-2 opacity-40" aria-hidden="true" />
        No move history recorded for this session.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Move history</p>
      <ol className="relative pl-4 border-l-2 border-muted space-y-4 list-none p-0 m-0" aria-label={`${moves.length} move${moves.length === 1 ? "" : "s"} in chronological order`}>
        {moves.map((move: any, i: number) => (
          <li key={i} className="relative pl-4">
            <span className="absolute -left-[1.125rem] top-1 w-3 h-3 rounded-full bg-primary/30 border-2 border-primary" aria-hidden="true" />
            <div className="text-xs text-muted-foreground mb-0.5">
              {move.timestamp ? <time dateTime={new Date(move.timestamp).toISOString()}>{new Date(move.timestamp).toLocaleString()}</time> : `Move ${i + 1}`}
            </div>
            <div className="flex items-center gap-2 mb-1">
              {move.strategy && (
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${STRATEGY_INFO[move.strategy]?.color ?? 'bg-muted text-foreground'}`} aria-label={`Strategy: ${STRATEGY_INFO[move.strategy]?.label ?? move.strategy}`}>
                  {STRATEGY_INFO[move.strategy]?.label ?? move.strategy}
                </span>
              )}
              {move.type && <span className="text-xs text-muted-foreground capitalize">{move.type.replace(/_/g, ' ')}</span>}
            </div>
            {move.content && <p className="text-sm bg-muted/50 rounded p-2">{move.content}</p>}
            {move.aiReasoning && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
                <Brain className="w-3 h-3 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span className="italic">{move.aiReasoning}</span>
              </div>
            )}
          </li>
        ))}
      </ol>
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
          <Info className="w-4 h-4 text-primary" aria-hidden="true" /> Why Pax recommends this approach
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
            <TrendingUp className="w-3 h-3 text-acr-pos" />
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
    <div className="flex items-center gap-2 px-3 py-2 bg-acr-pos-soft dark:bg-acr-pos-soft/20 rounded-md text-xs text-acr-pos dark:text-acr-pos border border-acr-pos-soft dark:border-acr-pos-soft" role="status" aria-live="polite">
      <Activity className="w-3.5 h-3.5 animate-pulse" aria-hidden="true" />
      <span><strong>Learning loop active</strong> — strategy effectiveness is being tracked and will improve recommendations over time.</span>
    </div>
  );
}

// ─── BATNA Calculator ─────────────────────────────────────────────────────────

function BATNACalculator() {
  const [askingPrice, setAskingPrice] = useState('');
  const [yourOffer, setYourOffer] = useState('');
  const [marketComps, setMarketComps] = useState('');
  const [renovationCost, setRenovationCost] = useState('');
  const [holdingCost, setHoldingCost] = useState('');
  const [desiredProfit, setDesiredProfit] = useState('20');

  const asking = parseFloat(askingPrice.replace(/[^0-9.]/g, '')) || 0;
  const offer = parseFloat(yourOffer.replace(/[^0-9.]/g, '')) || 0;
  const comps = parseFloat(marketComps.replace(/[^0-9.]/g, '')) || 0;
  const reno = parseFloat(renovationCost.replace(/[^0-9.]/g, '')) || 0;
  const holding = parseFloat(holdingCost.replace(/[^0-9.]/g, '')) || 0;
  const profitPct = parseFloat(desiredProfit) / 100;

  const maxAllowable = comps > 0 ? Math.round(comps * (1 - profitPct) - reno - holding) : 0;
  const walkawayPrice = maxAllowable;
  const negotiationZone = asking > 0 && offer > 0 ? {
    mid: Math.round((asking + offer) / 2),
    zopa: asking > walkawayPrice ? null : { low: offer, high: asking },
  } : null;

  const sellerFlexibility = asking > 0 && offer > 0
    ? Math.max(0, Math.min(100, Math.round(((asking - offer) / asking) * 100)))
    : 0;

  const dealViability = maxAllowable > 0 && offer > 0
    ? offer <= maxAllowable ? "viable" : offer <= maxAllowable * 1.1 ? "tight" : "unfavorable"
    : "unknown";

  const viabilityColor = dealViability === "viable" ? "text-acr-pos bg-acr-pos-soft border-acr-pos-soft" :
                         dealViability === "tight" ? "text-acr-warn bg-acr-warn-soft border-acr-warn-soft" :
                         dealViability === "unfavorable" ? "text-acr-neg bg-acr-neg-soft border-acr-neg-soft" :
                         "text-muted-foreground bg-muted/50 border-border";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Shield className="w-4 h-4 text-primary" aria-hidden="true" />
          BATNA calculator
          <span className="text-xs font-normal text-muted-foreground ml-1">— Best Alternative to Negotiated Agreement</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="border-0 p-0 m-0">
          <legend className="sr-only">BATNA inputs</legend>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: "batna-asking", label: "Seller asking price", value: askingPrice, set: setAskingPrice, prefix: "$" },
              { id: "batna-offer", label: "Your offer", value: yourOffer, set: setYourOffer, prefix: "$" },
              { id: "batna-comps", label: "Market comps (ARV)", value: marketComps, set: setMarketComps, prefix: "$" },
              { id: "batna-reno", label: "Renovation cost", value: renovationCost, set: setRenovationCost, prefix: "$" },
              { id: "batna-holding", label: "Holding/closing cost", value: holdingCost, set: setHoldingCost, prefix: "$" },
              { id: "batna-profit", label: "Desired profit %", value: desiredProfit, set: setDesiredProfit, prefix: "%" },
            ].map(({ id, label, value, set, prefix }) => (
              <div key={id}>
                <Label htmlFor={id} className="text-xs text-muted-foreground">{label}</Label>
                <div className="relative mt-1">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">{prefix}</span>
                  <input
                    id={id}
                    type="number"
                    inputMode="decimal"
                    className="w-full border rounded-md pl-6 pr-2 py-1.5 text-sm tabular-nums bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    placeholder={prefix === "$" ? "0" : "20"}
                  />
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        {(asking > 0 || offer > 0 || comps > 0) && (
          <div className="space-y-3 pt-2 border-t" aria-live="polite">
            {/* Deal Viability */}
            <div className={`rounded-lg border p-3 ${viabilityColor}`} role="status">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide">Deal viability</span>
                <Badge className={`text-xs ${viabilityColor} border`} aria-label={`Deal viability: ${dealViability}`}>{dealViability}</Badge>
              </div>
            </div>

            {/* Key outputs */}
            <dl className="grid grid-cols-2 gap-2 m-0">
              {maxAllowable > 0 && (
                <div className="rounded-lg border p-3 bg-muted/30">
                  <dt className="text-[10px] text-muted-foreground uppercase tracking-wide">Max allowable offer</dt>
                  <dd className="text-xl font-bold tabular-nums text-primary mt-0.5 m-0">{formatDollar(maxAllowable)}</dd>
                  <p className="text-[10px] text-muted-foreground">your BATNA walkaway</p>
                </div>
              )}
              {negotiationZone !== null && negotiationZone.mid > 0 && (
                <div className="rounded-lg border p-3 bg-muted/30">
                  <dt className="text-[10px] text-muted-foreground uppercase tracking-wide">Midpoint</dt>
                  <dd className="text-xl font-bold tabular-nums mt-0.5 m-0">{formatDollar(negotiationZone.mid)}</dd>
                  <p className="text-[10px] text-muted-foreground">split-the-difference</p>
                </div>
              )}
            </dl>

            {/* Seller flexibility gauge */}
            {sellerFlexibility > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <ArrowLeftRight className="w-3 h-3" aria-hidden="true" /> Negotiation range
                  </span>
                  <span className="font-semibold tabular-nums">{sellerFlexibility}% gap</span>
                </div>
                <div
                  className="w-full bg-muted rounded-full h-2 overflow-hidden"
                  role="progressbar"
                  aria-label="Negotiation gap between asking and offer"
                  aria-valuenow={sellerFlexibility}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className={`h-full rounded-full ${sellerFlexibility > 30 ? "bg-acr-pos" : sellerFlexibility > 15 ? "bg-acr-warn" : "bg-acr-neg"}`}
                    style={{ width: `${Math.min(sellerFlexibility, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {sellerFlexibility > 30 ? "Wide gap — room to negotiate aggressively." :
                   sellerFlexibility > 15 ? "Moderate gap — fair negotiation zone." :
                   "Narrow gap — close to agreement."}
                </p>
              </div>
            )}

            {/* Strategy hint */}
            {dealViability !== "unknown" && (
              <div className="flex items-start gap-2 text-xs bg-primary/5 rounded-md p-2.5 border border-primary/10">
                <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {dealViability === "viable"
                    ? "Your offer is within your BATNA range. Hold firm or offer a small concession to close faster."
                    : dealViability === "tight"
                    ? "You're slightly above your max allowable. Look for seller concessions (repairs, closing costs) to compensate."
                    : "This deal doesn't pencil at current pricing. Consider walking away or counter significantly lower."}
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Psychological Pressure Gauge ─────────────────────────────────────────────

function PsychologicalPressureGauge({
  sellerMessage,
  sentiment,
  objection,
}: {
  sellerMessage: string;
  sentiment: any;
  objection: any;
}) {
  // Calculate pressure score from signals
  const urgencySignals = ["must", "need", "deadline", "quick", "fast", "asap", "soon", "urgent"].filter(
    (w) => sellerMessage.toLowerCase().includes(w)
  ).length;
  const motivationSignals = ["sell", "move", "estate", "divorce", "taxes", "behind", "foreclos"].filter(
    (w) => sellerMessage.toLowerCase().includes(w)
  ).length;
  const hesitationSignals = ["think", "maybe", "not sure", "consider", "wait", "discuss", "talk"].filter(
    (w) => sellerMessage.toLowerCase().includes(w)
  ).length;

  const sentimentBoost = sentiment ? (sentiment.score > 0.3 ? 15 : sentiment.score < -0.3 ? -10 : 0) : 0;
  const rawPressure = Math.min(100, Math.max(0,
    20 + urgencySignals * 15 + motivationSignals * 20 - hesitationSignals * 10 + sentimentBoost
  ));

  const pressureLabel = rawPressure >= 70 ? "High Motivation" : rawPressure >= 40 ? "Moderate" : "Low Urgency";
  const pressureColor = rawPressure >= 70 ? "#22c55e" : rawPressure >= 40 ? "#f59e0b" : "#94a3b8";

  if (!sellerMessage.trim()) return null;

  const r = 45;
  const circ = Math.PI * r; // semicircle
  const dash = (rawPressure / 100) * circ;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Gauge className="w-4 h-4 text-primary" aria-hidden="true" />
          Seller motivation gauge
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center">
          {/* SVG semicircle gauge */}
          <div
            className="relative w-32 h-16 overflow-hidden"
            role="progressbar"
            aria-label={`Seller motivation: ${pressureLabel}`}
            aria-valuenow={Math.round(rawPressure)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${Math.round(rawPressure)} out of 100, ${pressureLabel}`}
          >
            <svg viewBox="0 0 100 50" className="w-full h-full" aria-hidden="true">
              {/* Background arc */}
              <path
                d="M 5 50 A 45 45 0 0 1 95 50"
                fill="none"
                stroke="hsl(var(--muted))"
                strokeWidth="8"
                strokeLinecap="round"
              />
              {/* Value arc */}
              <path
                d="M 5 50 A 45 45 0 0 1 95 50"
                fill="none"
                stroke={pressureColor}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circ}`}
              />
            </svg>
            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
              <span className="text-2xl font-bold tabular-nums" style={{ color: pressureColor }}>{Math.round(rawPressure)}</span>
            </div>
          </div>
          <p className="text-sm font-semibold mt-1" style={{ color: pressureColor }}>{pressureLabel}</p>
          <dl className="grid grid-cols-3 gap-2 mt-3 w-full text-center m-0">
            <div>
              <dd className="text-lg font-bold tabular-nums text-acr-warn m-0">{urgencySignals}</dd>
              <dt className="text-[10px] text-muted-foreground">Urgency signals</dt>
            </div>
            <div>
              <dd className="text-lg font-bold tabular-nums text-acr-pos m-0">{motivationSignals}</dd>
              <dt className="text-[10px] text-muted-foreground">Motivation cues</dt>
            </div>
            <div>
              <dd className="text-lg font-bold tabular-nums text-muted-foreground m-0">{hesitationSignals}</dd>
              <dt className="text-[10px] text-muted-foreground">Hesitation signs</dt>
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

export default function NegotiationCopilotPage() {
  useDocumentTitle('Negotiation copilot');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dealIdInputId = useId();
  const messageTextId = useId();
  const dealHistoryFilterId = useId();

  const [dealId, setDealId] = useState('');
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [messageText, setMessageText] = useState('');
  const [pendingEndSession, setPendingEndSession] = useState(false);
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
      toast({
        title: "Couldn't start session",
        description: `${err.message} — your deal ID is preserved. Try again.`,
        variant: 'destructive',
      });
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
      toast({
        title: "Couldn't run analysis",
        description: `${err.message} — your message and prior results are preserved. Try again.`,
        variant: 'destructive',
      });
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
    try {
      const result = await fetch(`/api/negotiation/sessions/${activeSessionId}/strategy`, { credentials: 'include' });
      if (!result.ok) {
        const err = await result.json().catch(() => ({}));
        throw new Error(err.error || 'Strategy fetch failed');
      }
      const data = await result.json();
      setStrategyResult(data.strategy);
    } catch (err: any) {
      toast({
        title: "Couldn't fetch strategy",
        description: `${err.message || 'Network error'} — prior recommendations are preserved.`,
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

      <Tabs defaultValue="session">
        <TabsList className="flex-wrap">
          <TabsTrigger value="session">Active session</TabsTrigger>
          <TabsTrigger value="batna">BATNA calculator</TabsTrigger>
          <TabsTrigger value="sessions">Deal history</TabsTrigger>
          <TabsTrigger value="analytics">Strategy analytics</TabsTrigger>
          <TabsTrigger value="replay">Session replay</TabsTrigger>
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
                    Start session
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
                    {sentimentResult.indicators?.length > 0 && (
                      <ul className="mt-3 space-y-1 list-none p-0" aria-label="Sentiment indicators detected in message">
                        {sentimentResult.indicators.map((ind: string, i: number) => (
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
                              className="w-full justify-start"
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
                    {strategyResult.suggestedActions?.length > 0 && (
                      <ul className="space-y-1 list-none p-0 m-0" aria-label="Suggested actions">
                        {strategyResult.suggestedActions.map((a: string, i: number) => (
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
                    {counterResult.alternativeAmounts?.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs font-medium text-muted-foreground">Alternatives:</p>
                        <ul className="flex gap-2 flex-wrap list-none p-0 m-0" aria-label="Alternative counter offers">
                          {counterResult.alternativeAmounts.map((a: number, i: number) => (
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
                      text={responseResult.response || responseResult}
                      data-testid="negotiation-copilot-read-aloud"
                    />
                  </CardHeader>
                  <CardContent>
                    <div className="p-4 bg-muted/50 rounded-lg text-sm leading-relaxed" aria-label="AI-generated response draft">
                      {responseResult.response || responseResult}
                    </div>
                    <Button
                      className="mt-3"
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(responseResult.response || responseResult);
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
          <div className="flex items-center gap-3">
            <Label htmlFor={dealHistoryFilterId} className="sr-only">Deal ID</Label>
            <Input
              id={dealHistoryFilterId}
              placeholder="Deal ID"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              className="w-32 tabular-nums"
              type="number"
              inputMode="numeric"
              aria-label="Deal ID to filter sessions"
            />
          </div>

          {sessionsLoading && <div className="text-center py-12 text-muted-foreground" role="status" aria-live="polite">Loading sessions…</div>}

          {sessions.length > 0 ? (
            <ul className="space-y-3 list-none p-0 m-0" aria-label={`${sessions.length} negotiation session${sessions.length === 1 ? "" : "s"} for deal ${dealId}`}>
              {sessions.map((s: any) => (
                <li key={s.id}>
                  <Card
                    className="cursor-pointer hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open session ${s.id}, started ${new Date(s.createdAt).toLocaleDateString()}${s.outcome ? `, outcome ${s.outcome}` : ", active"}`}
                    onClick={() => setActiveSessionId(s.id)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveSessionId(s.id); } }}
                  >
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">Session #<span className="tabular-nums">{s.id}</span></p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Started <time dateTime={new Date(s.createdAt).toISOString()}>{new Date(s.createdAt).toLocaleDateString()}</time>
                            {s.outcome && ` · Outcome: ${s.outcome}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {s.outcome ? (
                            <Badge className={s.outcome === 'accepted' ? 'bg-acr-pos-soft text-acr-pos' : 'bg-muted text-foreground'} aria-label={`Outcome: ${s.outcome}`}>
                              {s.outcome}
                            </Badge>
                          ) : (
                            <Badge className="bg-acr-accent text-acr-accent">Active</Badge>
                          )}
                          <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          ) : dealId ? (
            <div className="text-center py-16 text-muted-foreground" role="status">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
              <p>No sessions found for deal #<span className="tabular-nums">{dealId}</span>.</p>
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground" role="status">
              <MessageSquare className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
              <p>Enter a deal ID to see negotiation history.</p>
            </div>
          )}
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
                    <FlaskConical className="w-4 h-4 text-primary" aria-hidden="true" /> A/B strategy win-rate comparison
                  </CardTitle>
                  <CardDescription>Strategy effectiveness comparison across all sessions.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto" role="region" aria-label="Strategy win rates" tabIndex={0}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th scope="col" className="text-left py-2 text-xs text-muted-foreground">Strategy</th>
                          <th scope="col" className="text-left py-2 text-xs text-muted-foreground">vs. objection</th>
                          <th scope="col" className="text-right py-2 text-xs text-muted-foreground">Used</th>
                          <th scope="col" className="text-right py-2 text-xs text-muted-foreground">Win rate</th>
                          <th scope="col" className="py-2 pl-4 text-xs text-muted-foreground">Bar</th>
                        </tr>
                      </thead>
                      <tbody>
                        {effectiveness.map((e: any, i: number) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-2">
                              <Badge className={`${STRATEGY_INFO[e.strategy]?.color || ''} text-xs`} aria-label={`Strategy: ${STRATEGY_INFO[e.strategy]?.label || e.strategy}`}>
                                {STRATEGY_INFO[e.strategy]?.label || e.strategy}
                              </Badge>
                            </td>
                            <td className="py-2">
                              <Badge className={`${OBJECTION_COLORS[e.category] || ''} text-xs`} aria-label={`Objection: ${e.category}`}>
                                {e.category}
                              </Badge>
                            </td>
                            <td className="py-2 text-right text-muted-foreground tabular-nums">{e.timesUsed}×</td>
                            <td className="py-2 text-right font-semibold tabular-nums">{(e.successRate * 100).toFixed(0)}%</td>
                            <td className="py-2 pl-4 w-32">
                              <div
                                className="w-full bg-muted rounded-full h-1.5"
                                role="progressbar"
                                aria-label={`${STRATEGY_INFO[e.strategy]?.label || e.strategy} vs ${e.category} win rate`}
                                aria-valuenow={Math.round(e.successRate * 100)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                              >
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
                  <CardTitle>Strategy effectiveness by objection type</CardTitle>
                  <CardDescription>Success rate analysis across all closed negotiation sessions.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-4 list-none p-0 m-0" aria-label="Strategy effectiveness rows">
                    {effectiveness.map((e: any, i: number) => (
                      <li key={i} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <Badge className={OBJECTION_COLORS[e.category] || ''} aria-label={`Objection: ${e.category}`}>
                              {e.category}
                            </Badge>
                            <span className="text-muted-foreground" aria-hidden="true">→</span>
                            <Badge className={STRATEGY_INFO[e.strategy]?.color || ''}>
                              {STRATEGY_INFO[e.strategy]?.label || e.strategy}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-muted-foreground tabular-nums">{e.timesUsed}× used</span>
                            <span className="font-semibold tabular-nums">{(e.successRate * 100).toFixed(0)}% success</span>
                          </div>
                        </div>
                        <div
                          className="w-full bg-muted rounded-full h-2"
                          role="progressbar"
                          aria-label={`${STRATEGY_INFO[e.strategy]?.label || e.strategy} vs ${e.category} success rate`}
                          aria-valuenow={Math.round(e.successRate * 100)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="bg-primary h-2 rounded-full transition-all"
                            style={{ width: `${e.successRate * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground" role="status">
              <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" aria-hidden="true" />
              <p>No effectiveness data yet — complete negotiation sessions to see analytics.</p>
            </div>
          )}
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
