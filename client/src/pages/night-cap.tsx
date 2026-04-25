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
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-400/30">
            <Moon className="w-6 h-6 text-indigo-300" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{greeting}</h1>
            <p className="text-slate-400 text-sm tabular-nums">
              {format(new Date(), "EEEE, MMMM d, yyyy")} — your passive income snapshot.
            </p>
          </div>
          <div className="ml-auto">
            <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1">
              <Link href="/dashboard" aria-label="Open main dashboard">
                Dashboard <ArrowRight className="w-3 h-3" aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>

        {error && (
          <GlassCard>
            <p className="text-red-400 text-sm" role="alert">
              Couldn't load Evening Review data. Your numbers are unchanged — refresh to retry.
            </p>
          </GlassCard>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <dl>
                <dt className="flex items-center gap-2 mb-3">
                  <DollarSign className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  <span className="text-sm font-semibold text-emerald-300 uppercase tracking-wide">Tonight's income</span>
                </dt>
                <dd className="text-4xl font-bold text-emerald-400 tabular-nums">
                  {usd(data?.tonightIncome.totalDollars ?? 0)}
                </dd>
              </dl>
              <p className="text-slate-400 text-sm mt-1">
                <span className="tabular-nums">{data?.tonightIncome.paymentCount ?? 0}</span> note payment{data?.tonightIncome.paymentCount !== 1 ? "s" : ""} received today.
              </p>
            </GlassCard>
          )}

          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-violet-400" aria-hidden="true" />
                <span className="text-sm font-semibold text-violet-300 uppercase tracking-wide">Freedom meter</span>
                <Badge className="ml-auto bg-violet-500/20 text-violet-300 border-violet-400/30 text-xs tabular-nums">
                  {data?.freedomMeter.freedomPercent ?? 0}%
                </Badge>
              </div>
              <Progress
                value={data?.freedomMeter.freedomPercent ?? 0}
                className="h-3 mb-3 [&>div]:bg-gradient-to-r [&>div]:from-violet-500 [&>div]:to-indigo-500"
                aria-label={`Financial freedom: ${data?.freedomMeter.freedomPercent ?? 0}% of monthly expenses covered by passive income`}
              />
              <div className="flex justify-between text-sm flex-wrap gap-1">
                <span className="text-slate-300 tabular-nums">
                  {usd(data?.freedomMeter.monthlyPassiveIncome ?? 0, { noCents: true })}/mo passive
                </span>
                <span className="text-slate-400 tabular-nums">
                  Goal: {usd(data?.freedomMeter.monthlyExpenses ?? 0, { noCents: true })}/mo
                </span>
              </div>
              {(data?.freedomMeter.distanceToFreedom ?? 0) > 0 && (
                <p className="text-xs text-slate-500 mt-1 tabular-nums">
                  {usd(data?.freedomMeter.distanceToFreedom ?? 0, { noCents: true })} to financial freedom.
                </p>
              )}
              {(data?.freedomMeter.distanceToFreedom ?? 1) <= 0 && (
                <p className="text-xs text-emerald-400 mt-1 font-semibold" role="status">
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
                <Flame className="w-4 h-4 text-orange-400" aria-hidden="true" />
                <span className="text-sm font-semibold text-orange-300 uppercase tracking-wide">Pipeline heat</span>
                <Badge className="ml-auto bg-orange-500/20 text-orange-300 border-orange-400/30 text-xs tabular-nums">
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
                      <span className="text-slate-300 capitalize">{stageLabel}</span>
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
                            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-orange-300 font-mono w-4 text-right tabular-nums">{count}</span>
                      </div>
                    </li>
                  );
                })}
                {Object.keys(data?.pipelineHeat.byStage ?? {}).length === 0 && (
                  <li className="text-slate-500 text-sm list-none">No active deals in pipeline.</li>
                )}
              </ul>
            </GlassCard>
          )}

          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Mail className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                <span className="text-sm font-semibold text-cyan-300 uppercase tracking-wide">Campaign pulse</span>
              </div>
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dd className="text-2xl font-bold text-cyan-400 tabular-nums">{data?.campaignPulse.responsesToday ?? 0}</dd>
                  <dt className="text-slate-400 text-xs">responses today</dt>
                </div>
                <div>
                  <dd className="text-2xl font-bold text-slate-300 tabular-nums">{data?.campaignPulse.responseRate ?? 0}%</dd>
                  <dt className="text-slate-400 text-xs">response rate</dt>
                </div>
              </dl>
              {(data?.campaignPulse.responsesToday ?? 0) === 0 && (
                <p className="text-slate-500 text-xs mt-2">No campaign activity today — consider sending tomorrow.</p>
              )}
            </GlassCard>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                <Activity className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                <span className="text-sm font-semibold text-indigo-300 uppercase tracking-wide">AcreScore™ today</span>
                <Badge className="ml-auto bg-indigo-500/20 text-indigo-300 border-indigo-400/30 text-xs tabular-nums">
                  {data?.acreScoreToday.leadsScored ?? 0} scored
                </Badge>
              </div>
              <ul className="space-y-2" aria-label="Top scored leads today">
                {(data?.acreScoreToday.topLeads ?? []).slice(0, 3).map((lead) => (
                  <li key={lead.leadId} className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Lead #<span className="tabular-nums">{lead.leadId}</span></span>
                    <Badge className={`text-xs font-mono tabular-nums ${lead.score >= 100 ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/30" : lead.score >= 0 ? "bg-amber-500/20 text-amber-300 border-amber-400/30" : "bg-slate-500/20 text-slate-400"}`}>
                      {lead.score > 0 ? "+" : ""}{lead.score}
                    </Badge>
                  </li>
                ))}
                {(data?.acreScoreToday.topLeads ?? []).length === 0 && (
                  <li className="text-slate-500 text-sm list-none">No leads scored today yet.</li>
                )}
              </ul>
              <Button asChild variant="ghost" size="sm" className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 p-0 h-auto">
                <Link href="/leads" aria-label="View all leads">
                  View all leads <ArrowRight className="w-3 h-3 ml-1" aria-hidden="true" />
                </Link>
              </Button>
            </GlassCard>
          )}

          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-yellow-400" aria-hidden="true" />
                <span className="text-sm font-semibold text-yellow-300 uppercase tracking-wide">Win of the day</span>
              </div>
              {data?.winOfDay ? (
                <div>
                  <div className="text-lg font-bold text-yellow-300 mb-1">{data.winOfDay.title}</div>
                  <div className="text-2xl font-bold text-emerald-400 tabular-nums">
                    {usd(data.winOfDay.salePrice, { noCents: true })}
                  </div>
                  <p className="text-slate-400 text-xs mt-1 tabular-nums">
                    Closed {format(new Date(data.winOfDay.closedAt), "h:mm a")} today.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-slate-400 text-sm">No deals closed today — yet.</p>
                  <p className="text-slate-500 text-xs mt-1">Keep the pipeline moving. Tomorrow could be the day.</p>
                </div>
              )}
            </GlassCard>
          )}
        </div>

        {isLoading ? <CardSkeleton /> : (
          <GlassCard className="border-amber-400/20 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20 shrink-0">
                <Lightbulb className="w-4 h-4 text-amber-400" aria-hidden="true" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-semibold text-amber-300 uppercase tracking-wide">Tomorrow's one thing</span>
                  <Badge
                    className={`text-xs capitalize ${data?.tomorrowOneThing.priority === "high" ? "bg-red-500/20 text-red-300 border-red-400/30" : "bg-amber-500/20 text-amber-300 border-amber-400/30"}`}
                    aria-label={`Priority: ${data?.tomorrowOneThing.priority}`}
                  >
                    {data?.tomorrowOneThing.priority}
                  </Badge>
                </div>
                <p className="text-white font-medium">{data?.tomorrowOneThing.action}</p>
                <p className="text-slate-400 text-xs mt-1">{data?.tomorrowOneThing.reason}</p>
              </div>
            </div>
          </GlassCard>
        )}

        {isLoading ? <CardSkeleton /> : (
          <GlassCard className="border-slate-600/30">
            <blockquote className="flex items-start gap-3">
              <Quote className="w-5 h-5 text-slate-500 shrink-0 mt-1" aria-hidden="true" />
              <div>
                <p className="text-slate-200 italic text-base leading-relaxed">
                  {data?.nitecapWisdom.quote ? `"${data.nitecapWisdom.quote}"` : ""}
                </p>
                <footer className="text-slate-500 text-sm mt-2">— {data?.nitecapWisdom.author}</footer>
              </div>
            </blockquote>
          </GlassCard>
        )}

        <div className="text-center text-slate-600 text-xs pb-4 tabular-nums">
          Evening Review by AcreOS · {data?.generatedAt ? format(new Date(data.generatedAt), "h:mm a") : ""}
        </div>
      </div>
    </div>
  );
}
