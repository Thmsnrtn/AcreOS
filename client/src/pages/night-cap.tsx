/**
 * Evening Review Dashboard — Passive Income Command Center
 *
 * Epic A: End-of-day review of passive income progress.
 * Dark/dusk glassmorphism theme for end-of-day reflection.
 */

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Moon, DollarSign, Mail, Trophy, Lightbulb, Quote,
  ArrowRight, Flame, Target, Activity,
} from "lucide-react";
import { format } from "date-fns";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { usd } from "@/lib/format";

interface NightCapSnapshot {
  generatedAt: string;
  tonightIncome: {
    totalDollars: number;
    paymentCount: number;
  };
  freedomMeter: {
    monthlyPassiveIncome: number;
    monthlyExpenses: number;
    freedomPercent: number;
    activeNotes: number;
    distanceToFreedom: number;
  };
  pipelineHeat: {
    byStage: Record<string, number>;
    totalDeals: number;
  };
  campaignPulse: {
    responsesToday: number;
    sentToday: number;
    responseRate: number;
  };
  acreScoreToday: {
    leadsScored: number;
    topLeads: { leadId: number; score: number; scoredAt: string }[];
  };
  winOfDay: {
    dealId: number;
    title: string;
    salePrice: number;
    closedAt: string;
  } | null;
  tomorrowOneThing: {
    action: string;
    reason: string;
    priority: "high" | "medium" | "low";
  };
  nitecapWisdom: {
    quote: string;
    author: string;
  };
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm shadow-xl p-5 ${className}`}>
      {children}
    </div>
  );
}

function CardSkeleton() {
  return <Skeleton className="h-32 w-full rounded-2xl bg-white/10" />;
}

export default function NightCapPage() {
  useDocumentTitle("Evening review");
  const { data, isLoading, error } = useQuery<NightCapSnapshot>({
    queryKey: ["/api/night-cap/snapshot"],
    staleTime: 5 * 60 * 1000,
  });

  const hour = new Date().getHours();
  const greeting = hour < 20 ? "Winding down" : "Evening review";

  return (
    <div className="min-h-screen bg-gradient-to-br from-muted via-acr-accent to-muted text-white">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <div className="p-2 rounded-xl bg-acr-accent/20 border border-acr-accent/30">
            <Moon className="w-6 h-6 text-acr-accent" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{greeting}</h1>
            <p className="text-muted-foreground text-sm tabular-nums">
              {format(new Date(), "EEEE, MMMM d, yyyy")} — your passive income snapshot.
            </p>
          </div>
          <div className="ml-auto">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-white gap-1">
              <Link href="/dashboard" aria-label="Open main dashboard">
                Dashboard <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        {error && (
          <GlassCard>
            <p className="text-acr-neg text-sm" role="alert">
              Couldn't load Evening Review data. Your numbers are unchanged — refresh to retry.
            </p>
          </GlassCard>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <dl>
                <dt className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                  <span className="text-sm font-semibold text-acr-pos uppercase tracking-wide">Tonight's income</span>
                </dt>
                <dd className="text-4xl font-bold text-acr-pos tabular-nums">
                  {usd(data?.tonightIncome.totalDollars ?? 0)}
                </dd>
              </dl>
              <p className="text-muted-foreground text-sm mt-1">
                <span className="tabular-nums">{data?.tonightIncome.paymentCount ?? 0}</span> note payment{data?.tonightIncome.paymentCount !== 1 ? "s" : ""} received today.
              </p>
            </GlassCard>
          )}

          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-acr-brand" aria-hidden="true" />
                <span className="text-sm font-semibold text-acr-brand uppercase tracking-wide">Freedom meter</span>
                <Badge className="ml-auto bg-acr-brand/20 text-acr-brand border-acr-brand/30 text-xs tabular-nums">
                  {data?.freedomMeter.freedomPercent ?? 0}%
                </Badge>
              </div>
              <Progress
                value={data?.freedomMeter.freedomPercent ?? 0}
                className="h-3 mb-3 [&>div]:bg-gradient-to-r [&>div]:from-acr-brand [&>div]:to-acr-accent"
                aria-label={`Financial freedom: ${data?.freedomMeter.freedomPercent ?? 0}% of monthly expenses covered by passive income`}
              />
              <div className="flex justify-between text-sm flex-wrap gap-1">
                <span className="text-muted-foreground tabular-nums">
                  {usd(data?.freedomMeter.monthlyPassiveIncome ?? 0, { noCents: true })}/mo passive
                </span>
                <span className="text-muted-foreground tabular-nums">
                  Goal: {usd(data?.freedomMeter.monthlyExpenses ?? 0, { noCents: true })}/mo
                </span>
              </div>
              {(data?.freedomMeter.distanceToFreedom ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                  {usd(data?.freedomMeter.distanceToFreedom ?? 0, { noCents: true })} to financial freedom.
                </p>
              )}
              {(data?.freedomMeter.distanceToFreedom ?? 1) <= 0 && (
                <p className="text-xs text-acr-pos mt-1 font-semibold" role="status">
                  Freedom achieved — passive income covers expenses.
                </p>
              )}
            </GlassCard>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Flame className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                <span className="text-sm font-semibold text-acr-warn uppercase tracking-wide">Pipeline heat</span>
                <Badge className="ml-auto bg-acr-warn/20 text-acr-warn border-acr-warn/30 text-xs tabular-nums">
                  {data?.pipelineHeat.totalDeals ?? 0} deals
                </Badge>
              </div>
              <ul className="space-y-2" aria-label="Active deals by pipeline stage">
                {Object.entries(data?.pipelineHeat.byStage ?? {}).slice(0, 5).map(([stage, count]) => {
                  const total = data?.pipelineHeat.totalDeals || 1;
                  const pct = Math.min(100, (count / total) * 100);
                  const stageLabel = stage.replace(/_/g, " ");
                  return (
                    <li key={stage} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground capitalize">{stageLabel}</span>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-16 h-1.5 rounded-full bg-white/10"
                          role="progressbar"
                          aria-valuenow={Math.round(pct)}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`${stageLabel}: ${count} of ${total} deals`}
                        >
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-acr-warn to-acr-warn"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-acr-warn font-mono w-4 text-right tabular-nums">{count}</span>
                      </div>
                    </li>
                  );
                })}
                {Object.keys(data?.pipelineHeat.byStage ?? {}).length === 0 && (
                  <li className="text-muted-foreground text-sm list-none">No active deals in pipeline.</li>
                )}
              </ul>
            </GlassCard>
          )}

          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Mail className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                <span className="text-sm font-semibold text-acr-accent uppercase tracking-wide">Campaign pulse</span>
              </div>
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dd className="text-2xl font-bold text-acr-accent tabular-nums">{data?.campaignPulse.responsesToday ?? 0}</dd>
                  <dt className="text-muted-foreground text-xs">responses today</dt>
                </div>
                <div>
                  <dd className="text-2xl font-bold text-muted-foreground tabular-nums">{data?.campaignPulse.responseRate ?? 0}%</dd>
                  <dt className="text-muted-foreground text-xs">response rate</dt>
                </div>
              </dl>
              {(data?.campaignPulse.responsesToday ?? 0) === 0 && (
                <p className="text-muted-foreground text-xs mt-2">No campaign activity today — consider sending tomorrow.</p>
              )}
            </GlassCard>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Activity className="w-4 h-4 text-acr-accent" aria-hidden="true" />
                <span className="text-sm font-semibold text-acr-accent uppercase tracking-wide">AcreScore™ today</span>
                <Badge className="ml-auto bg-acr-accent/20 text-acr-accent border-acr-accent/30 text-xs tabular-nums">
                  {data?.acreScoreToday.leadsScored ?? 0} scored
                </Badge>
              </div>
              <ul className="space-y-2" aria-label="Top scored leads today">
                {(data?.acreScoreToday.topLeads ?? []).slice(0, 3).map((lead) => (
                  <li key={lead.leadId} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Lead #<span className="tabular-nums">{lead.leadId}</span></span>
                    <Badge className={`text-xs font-mono tabular-nums ${lead.score >= 100 ? "bg-acr-pos/20 text-acr-pos border-acr-pos/30" : lead.score >= 0 ? "bg-acr-warn/20 text-acr-warn border-acr-warn/30" : "bg-muted/20 text-muted-foreground"}`}>
                      {lead.score > 0 ? "+" : ""}{lead.score}
                    </Badge>
                  </li>
                ))}
                {(data?.acreScoreToday.topLeads ?? []).length === 0 && (
                  <li className="text-muted-foreground text-sm list-none">No leads scored today yet.</li>
                )}
              </ul>
              <Button asChild variant="ghost" size="sm" className="mt-3 text-xs text-acr-accent hover:text-acr-accent p-0 h-auto">
                <Link href="/leads" aria-label="View all leads">
                  View all leads <ArrowRight className="w-3 h-3 ml-1" aria-hidden="true" />
                </Link>
              </Button>
            </GlassCard>
          )}

          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-acr-warn" aria-hidden="true" />
                <span className="text-sm font-semibold text-acr-warn uppercase tracking-wide">Win of the day</span>
              </div>
              {data?.winOfDay ? (
                <div>
                  <div className="text-lg font-bold text-acr-warn mb-1">{data.winOfDay.title}</div>
                  <div className="text-2xl font-bold text-acr-pos tabular-nums">
                    {usd(data.winOfDay.salePrice, { noCents: true })}
                  </div>
                  <p className="text-muted-foreground text-xs mt-1 tabular-nums">
                    Closed {format(new Date(data.winOfDay.closedAt), "h:mm a")} today.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-muted-foreground text-sm">No deals closed today — yet.</p>
                  <p className="text-muted-foreground text-xs mt-1">Keep the pipeline moving. Tomorrow could be the day.</p>
                </div>
              )}
            </GlassCard>
          )}
        </div>

        {isLoading ? <CardSkeleton /> : (
          <GlassCard className="border-acr-warn/20 bg-acr-warn/5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-acr-warn/20 shrink-0">
                <Lightbulb className="w-4 h-4 text-acr-warn" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-semibold text-acr-warn uppercase tracking-wide">Tomorrow's one thing</span>
                  <Badge
                    className={`text-xs capitalize ${data?.tomorrowOneThing.priority === "high" ? "bg-acr-neg/20 text-acr-neg border-acr-neg/30" : "bg-acr-warn/20 text-acr-warn border-acr-warn/30"}`}
                    aria-label={`Priority: ${data?.tomorrowOneThing.priority}`}
                  >
                    {data?.tomorrowOneThing.priority}
                  </Badge>
                </div>
                <p className="text-white font-medium">{data?.tomorrowOneThing.action}</p>
                <p className="text-muted-foreground text-xs mt-1">{data?.tomorrowOneThing.reason}</p>
              </div>
            </div>
          </GlassCard>
        )}

        {isLoading ? <CardSkeleton /> : (
          <GlassCard className="border-border/30">
            <blockquote className="flex items-start gap-3">
              <Quote className="w-5 h-5 text-muted-foreground shrink-0 mt-1" aria-hidden="true" />
              <div>
                <p className="text-muted-foreground italic text-base leading-relaxed">
                  {data?.nitecapWisdom.quote ? `"${data.nitecapWisdom.quote}"` : ""}
                </p>
                <footer className="text-muted-foreground text-sm mt-2">— {data?.nitecapWisdom.author}</footer>
              </div>
            </blockquote>
          </GlassCard>
        )}

        <div className="text-center text-muted-foreground text-xs pb-4 tabular-nums">
          Evening Review by AcreOS · {data?.generatedAt ? format(new Date(data.generatedAt), "h:mm a") : ""}
        </div>
      </div>
    </div>
  );
}
