/**
 * Night Cap Dashboard — Passive Income Command Center
 *
 * Epic A: End-of-day review of passive income progress.
 * Dark/dusk glassmorphism theme inspired by Mark Podolsky's Nite Cap series.
 */

import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Moon, DollarSign, TrendingUp, Mail, Star, Trophy, Lightbulb, Quote,
  ArrowRight, Flame, Target, Activity,
} from "lucide-react";
import { format } from "date-fns";

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
  const { data, isLoading, error } = useQuery<NightCapSnapshot>({
    queryKey: ["/api/night-cap/snapshot"],
    staleTime: 5 * 60 * 1000,
  });

  const hour = new Date().getHours();
  const greeting = hour < 20 ? "Winding Down" : "Nite Cap";

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white">
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 rounded-xl bg-indigo-500/20 border border-indigo-400/30">
            <Moon className="w-6 h-6 text-indigo-300" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{greeting}</h1>
            <p className="text-slate-400 text-sm">
              {format(new Date(), "EEEE, MMMM d, yyyy")} — your passive income snapshot
            </p>
          </div>
          <div className="ml-auto">
            <Link href="/dashboard">
              <Button variant="ghost" size="sm" className="text-slate-400 hover:text-white gap-1">
                Dashboard <ArrowRight className="w-3 h-3" />
              </Button>
            </Link>
          </div>
        </div>

        {error && (
          <GlassCard>
            <p className="text-red-400 text-sm">Failed to load Night Cap data. Please try again.</p>
          </GlassCard>
        )}

        {/* Row 1: Tonight's Income + Freedom Meter */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Tonight's Income */}
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <DollarSign className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-semibold text-emerald-300 uppercase tracking-wide">Tonight's Income</span>
              </div>
              <div className="text-4xl font-bold text-emerald-400">
                ${(data?.tonightIncome.totalDollars ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-slate-400 text-sm mt-1">
                {data?.tonightIncome.paymentCount ?? 0} note payment{data?.tonightIncome.paymentCount !== 1 ? "s" : ""} received today
              </p>
            </GlassCard>
          )}

          {/* Freedom Meter */}
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-semibold text-violet-300 uppercase tracking-wide">Freedom Meter</span>
                <Badge className="ml-auto bg-violet-500/20 text-violet-300 border-violet-400/30 text-xs">
                  {data?.freedomMeter.freedomPercent ?? 0}%
                </Badge>
              </div>
              <Progress
                value={data?.freedomMeter.freedomPercent ?? 0}
                className="h-3 mb-3 [&>div]:bg-gradient-to-r [&>div]:from-violet-500 [&>div]:to-indigo-500"
              />
              <div className="flex justify-between text-sm">
                <span className="text-slate-300">
                  ${(data?.freedomMeter.monthlyPassiveIncome ?? 0).toLocaleString()}/mo passive
                </span>
                <span className="text-slate-400">
                  Goal: ${(data?.freedomMeter.monthlyExpenses ?? 0).toLocaleString()}/mo
                </span>
              </div>
              {(data?.freedomMeter.distanceToFreedom ?? 0) > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  ${(data?.freedomMeter.distanceToFreedom ?? 0).toLocaleString()} to financial freedom
                </p>
              )}
              {(data?.freedomMeter.distanceToFreedom ?? 1) <= 0 && (
                <p className="text-xs text-emerald-400 mt-1 font-semibold">
                  Freedom achieved! Passive income covers expenses.
                </p>
              )}
            </GlassCard>
          )}
        </div>

        {/* Row 2: Pipeline Heat + Campaign Pulse */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* Pipeline Heat */}
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Flame className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-semibold text-orange-300 uppercase tracking-wide">Pipeline Heat</span>
                <Badge className="ml-auto bg-orange-500/20 text-orange-300 border-orange-400/30 text-xs">
                  {data?.pipelineHeat.totalDeals ?? 0} deals
                </Badge>
              </div>
              <div className="space-y-2">
                {Object.entries(data?.pipelineHeat.byStage ?? {}).slice(0, 5).map(([stage, count]) => (
                  <div key={stage} className="flex items-center justify-between text-sm">
                    <span className="text-slate-300 capitalize">{stage.replace(/_/g, " ")}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400"
                          style={{ width: `${Math.min(100, (count / (data?.pipelineHeat.totalDeals || 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-orange-300 font-mono w-4 text-right">{count}</span>
                    </div>
                  </div>
                ))}
                {Object.keys(data?.pipelineHeat.byStage ?? {}).length === 0 && (
                  <p className="text-slate-500 text-sm">No active deals in pipeline</p>
                )}
              </div>
            </GlassCard>
          )}

          {/* Campaign Pulse */}
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Mail className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-semibold text-cyan-300 uppercase tracking-wide">Campaign Pulse</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-2xl font-bold text-cyan-400">{data?.campaignPulse.responsesToday ?? 0}</div>
                  <p className="text-slate-400 text-xs">responses today</p>
                </div>
                <div>
                  <div className="text-2xl font-bold text-slate-300">{data?.campaignPulse.responseRate ?? 0}%</div>
                  <p className="text-slate-400 text-xs">response rate</p>
                </div>
              </div>
              {(data?.campaignPulse.responsesToday ?? 0) === 0 && (
                <p className="text-slate-500 text-xs mt-2">No campaign activity today — consider sending tomorrow</p>
              )}
            </GlassCard>
          )}
        </div>

        {/* Row 3: AcreScore Today + Win of Day */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          {/* AcreScore Today */}
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Activity className="w-4 h-4 text-indigo-400" />
                <span className="text-sm font-semibold text-indigo-300 uppercase tracking-wide">AcreScore™ Today</span>
                <Badge className="ml-auto bg-indigo-500/20 text-indigo-300 border-indigo-400/30 text-xs">
                  {data?.acreScoreToday.leadsScored ?? 0} scored
                </Badge>
              </div>
              <div className="space-y-2">
                {(data?.acreScoreToday.topLeads ?? []).slice(0, 3).map((lead, i) => (
                  <div key={lead.leadId} className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Lead #{lead.leadId}</span>
                    <Badge className={`text-xs font-mono ${lead.score >= 100 ? "bg-emerald-500/20 text-emerald-300 border-emerald-400/30" : lead.score >= 0 ? "bg-amber-500/20 text-amber-300 border-amber-400/30" : "bg-slate-500/20 text-slate-400"}`}>
                      {lead.score > 0 ? "+" : ""}{lead.score}
                    </Badge>
                  </div>
                ))}
                {(data?.acreScoreToday.topLeads ?? []).length === 0 && (
                  <p className="text-slate-500 text-sm">No leads scored today yet</p>
                )}
              </div>
              <Link href="/leads">
                <Button variant="ghost" size="sm" className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 p-0 h-auto">
                  View all leads <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </Link>
            </GlassCard>
          )}

          {/* Win of the Day */}
          {isLoading ? <CardSkeleton /> : (
            <GlassCard>
              <div className="flex items-center gap-2 mb-3">
                <Trophy className="w-4 h-4 text-yellow-400" />
                <span className="text-sm font-semibold text-yellow-300 uppercase tracking-wide">Win of the Day</span>
              </div>
              {data?.winOfDay ? (
                <div>
                  <div className="text-lg font-bold text-yellow-300 mb-1">{data.winOfDay.title}</div>
                  <div className="text-2xl font-bold text-emerald-400">
                    ${data.winOfDay.salePrice.toLocaleString()}
                  </div>
                  <p className="text-slate-400 text-xs mt-1">
                    Closed {format(new Date(data.winOfDay.closedAt), "h:mm a")} today
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

        {/* Tomorrow's One Thing */}
        {isLoading ? <CardSkeleton /> : (
          <GlassCard className="border-amber-400/20 bg-amber-500/5">
            <div className="flex items-start gap-3">
              <div className="p-2 rounded-lg bg-amber-500/20 shrink-0">
                <Lightbulb className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-amber-300 uppercase tracking-wide">Tomorrow's One Thing</span>
                  <Badge className={`text-xs ${data?.tomorrowOneThing.priority === "high" ? "bg-red-500/20 text-red-300 border-red-400/30" : "bg-amber-500/20 text-amber-300 border-amber-400/30"}`}>
                    {data?.tomorrowOneThing.priority}
                  </Badge>
                </div>
                <p className="text-white font-medium">{data?.tomorrowOneThing.action}</p>
                <p className="text-slate-400 text-xs mt-1">{data?.tomorrowOneThing.reason}</p>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Nite Cap Wisdom */}
        {isLoading ? <CardSkeleton /> : (
          <GlassCard className="border-slate-600/30">
            <div className="flex items-start gap-3">
              <Quote className="w-5 h-5 text-slate-500 shrink-0 mt-1" />
              <div>
                <p className="text-slate-200 italic text-base leading-relaxed">
                  "{data?.nitecapWisdom.quote}"
                </p>
                <p className="text-slate-500 text-sm mt-2">— {data?.nitecapWisdom.author}</p>
              </div>
            </div>
          </GlassCard>
        )}

        {/* Footer */}
        <div className="text-center text-slate-600 text-xs pb-4">
          Night Cap by AcreOS · {data?.generatedAt ? format(new Date(data.generatedAt), "h:mm a") : ""}
        </div>
      </div>
    </div>
  );
}
