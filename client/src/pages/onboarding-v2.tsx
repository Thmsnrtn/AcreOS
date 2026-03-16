import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
  MapPin,
  TrendingUp,
  Users,
  Zap,
  Target,
  DollarSign,
  Star,
  ArrowRight,
  CheckCircle,
  Sparkles,
  Building,
  Home,
  Briefcase,
  BarChart3,
  Brain,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

// ---------------------------------------------------------------------------
// Onboarding flow — 3 paths, guided by Atlas
//
// Expert land investing principle: The first 10 minutes determine whether
// someone becomes a lifelong investor or abandons the platform.
// The "aha moment" must happen in minute 2 — real data, real opportunity.
// ---------------------------------------------------------------------------

type InvestorPath = "beginner" | "active" | "enterprise";

interface OnboardingStep {
  id: string;
  title: string;
  subtitle: string;
}

const STEPS_BY_PATH: Record<InvestorPath, OnboardingStep[]> = {
  beginner: [
    { id: "path", title: "Welcome to AcreOS", subtitle: "Let's personalize your experience" },
    { id: "target_county", title: "Where Do You Want to Invest?", subtitle: "Your first step: pick a county to explore" },
    { id: "instant_hunt", title: "🔥 AcreOS Found Real Opportunities", subtitle: "Here's what's available in your target area RIGHT NOW" },
    { id: "strategy", title: "What's Your Strategy?", subtitle: "How do you plan to make money with land?" },
    { id: "atlas_tour", title: "Meet Atlas, Your AI Deal Partner", subtitle: "Atlas works 24/7 so you don't have to" },
    { id: "complete", title: "You're Ready to Find Deals!", subtitle: "Your personalized dashboard is configured" },
  ],
  active: [
    { id: "path", title: "Welcome Back to AcreOS", subtitle: "Upgrade your investing operation" },
    { id: "portfolio_import", title: "Import Your Existing Portfolio", subtitle: "Connect what you've built so AcreOS can analyze it" },
    { id: "target_counties", title: "Set Your Target Counties", subtitle: "Configure Deal Hunter for your active markets" },
    { id: "instant_hunt", title: "🔥 Deals in Your Markets", subtitle: "Here's what AcreOS found in your target counties" },
    { id: "automation", title: "Configure Autonomous Deal Machine", subtitle: "Set it once — AcreOS finds deals every night" },
    { id: "complete", title: "Your Operation is Upgraded!", subtitle: "AcreOS is now working while you sleep" },
  ],
  enterprise: [
    { id: "path", title: "Enterprise Setup", subtitle: "Configure AcreOS for your team" },
    { id: "team", title: "Set Up Your Team", subtitle: "Invite deal analysts, VAs, and closing coordinators" },
    { id: "integrations", title: "Connect Your Tools", subtitle: "CRM, accounting, and communication stack" },
    { id: "instant_hunt", title: "🔥 Enterprise Market Scan", subtitle: "AcreOS scanning all your target markets simultaneously" },
    { id: "workflows", title: "Configure Deal Workflows", subtitle: "Custom pipeline stages and automation rules" },
    { id: "complete", title: "Enterprise Platform Ready!", subtitle: "Your team can now work deals at scale" },
  ],
};

interface DealOpportunity {
  county: string;
  state: string;
  ownerName: string;
  acreage: number;
  assessedValue: number;
  motivationScore: number;
  motivationGrade: string;
  topSignal: string;
  estimatedOfferPrice: number;
  estimatedResaleValue: number;
  potentialProfit: number;
}

// ---------------------------------------------------------------------------
// Instant Deal Hunt component
// The #1 "aha moment" — show real data within first 3 minutes
// ---------------------------------------------------------------------------

function InstantDealHunt({
  targetCounty,
  targetState,
  onContinue,
}: {
  targetCounty: string;
  targetState: string;
  onContinue: () => void;
}) {
  const { data, isLoading } = useQuery<{ opportunities: DealOpportunity[]; totalScanned: number }>({
    queryKey: ["/api/onboarding/instant-deal-hunt", targetCounty, targetState],
    queryFn: async () => {
      const resp = await apiRequest(
        "GET",
        `/api/onboarding/instant-deal-hunt?county=${encodeURIComponent(targetCounty)}&state=${encodeURIComponent(targetState)}`
      );
      return resp.json();
    },
    enabled: !!targetCounty && !!targetState,
  });

  const opportunities = data?.opportunities || [];
  const totalScanned = data?.totalScanned || 0;

  return (
    <div className="space-y-6">
      <div className="text-center">
        {isLoading ? (
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin mx-auto" />
            <p className="text-gray-400">
              Scanning {targetCounty} County, {targetState} for motivated sellers...
            </p>
            <p className="text-xs text-gray-600">
              Checking tax delinquency records · Scoring seller motivation · Finding opportunities
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-2xl font-bold text-white">
              Found {opportunities.length} opportunities
              {totalScanned > 0 && (
                <span className="text-gray-400 text-base font-normal ml-2">
                  ({totalScanned.toLocaleString()} properties scanned)
                </span>
              )}
            </div>
            <p className="text-gray-400 text-sm">
              in {targetCounty} County, {targetState} — ranked by seller motivation
            </p>
          </div>
        )}
      </div>

      {!isLoading && opportunities.length > 0 && (
        <div className="space-y-3">
          {opportunities.slice(0, 3).map((opp, i) => (
            <div
              key={i}
              className={cn(
                "rounded-xl border p-4 relative overflow-hidden",
                i === 0
                  ? "border-red-500/50 bg-red-950/20"
                  : i === 1
                  ? "border-yellow-500/30 bg-yellow-950/10"
                  : "border-gray-700 bg-gray-900/50"
              )}
            >
              {i === 0 && (
                <div className="absolute top-2 right-2">
                  <Badge className="bg-red-600 text-white text-xs">🔥 Hot Deal</Badge>
                </div>
              )}
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold text-white">{opp.ownerName}</div>
                  <div className="text-xs text-gray-400">
                    {opp.acreage} acres · {opp.county}, {opp.state}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={cn(
                      "text-lg font-bold",
                      opp.motivationScore >= 80
                        ? "text-red-400"
                        : opp.motivationScore >= 65
                        ? "text-yellow-400"
                        : "text-gray-400"
                    )}
                  >
                    {opp.motivationGrade} · {opp.motivationScore}
                  </div>
                  <div className="text-xs text-gray-500">Motivation Score</div>
                </div>
              </div>

              <div className="text-xs text-gray-400 mb-3">
                📍 Top Signal: <span className="text-gray-300">{opp.topSignal}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-800/60 rounded-lg p-2">
                  <div className="text-sm font-semibold text-white">
                    ${opp.estimatedOfferPrice.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">Offer Price</div>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-2">
                  <div className="text-sm font-semibold text-white">
                    ${opp.estimatedResaleValue.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">Resale Value</div>
                </div>
                <div className="bg-emerald-900/40 rounded-lg p-2">
                  <div className="text-sm font-semibold text-emerald-400">
                    ${opp.potentialProfit.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">Potential Profit</div>
                </div>
              </div>
            </div>
          ))}

          <p className="text-xs text-gray-600 text-center">
            These are real data points from public records in {targetCounty} County.
            AcreOS finds new opportunities like these every night automatically.
          </p>
        </div>
      )}

      {!isLoading && opportunities.length === 0 && (
        <div className="text-center py-6">
          <div className="text-gray-500 mb-2">No high-motivation leads found in this county yet.</div>
          <div className="text-sm text-gray-600">
            AcreOS will monitor {targetCounty} County and alert you when opportunities emerge.
          </div>
        </div>
      )}

      <Button
        onClick={onContinue}
        disabled={isLoading}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3"
      >
        {isLoading ? "Scanning..." : "Continue to Dashboard"}
        <ArrowRight className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main onboarding wizard
// ---------------------------------------------------------------------------

export default function OnboardingV2() {
  const [, navigate] = useLocation();
  const [selectedPath, setSelectedPath] = useState<InvestorPath | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isAnimating, setIsAnimating] = useState(false);

  const steps = selectedPath ? STEPS_BY_PATH[selectedPath] : STEPS_BY_PATH.beginner;
  const currentStep = steps[currentStepIndex];
  const progress = selectedPath ? ((currentStepIndex + 1) / steps.length) * 100 : 0;

  const updateOnboardingMutation = useMutation({
    mutationFn: async (data: any) => {
      const resp = await apiRequest("PATCH", "/api/onboarding/progress", data);
      return resp.json();
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest("POST", "/api/onboarding/complete", { formData, path: selectedPath });
      return resp.json();
    },
    onSuccess: () => navigate("/dashboard"),
  });

  const advance = (data?: Record<string, any>) => {
    if (data) setFormData((prev) => ({ ...prev, ...data }));
    setIsAnimating(true);
    setTimeout(() => {
      if (currentStepIndex < steps.length - 1) {
        setCurrentStepIndex((i) => i + 1);
      }
      setIsAnimating(false);
    }, 300);
    updateOnboardingMutation.mutate({ step: currentStepIndex + 1, ...data });
  };

  // PATH SELECTION screen (before step flow starts)
  if (!selectedPath) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full space-y-8">
          {/* Logo + headline */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 bg-emerald-900/40 border border-emerald-700/50 rounded-full px-4 py-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-300 text-sm font-medium">The Most Intelligent Land Investing Platform</span>
            </div>
            <h1 className="text-4xl font-bold text-white">Welcome to AcreOS</h1>
            <p className="text-gray-400 text-lg">
              Tell us where you are in your land investing journey — we'll configure everything for you.
            </p>
          </div>

          {/* Path selection */}
          <div className="grid gap-4">
            {[
              {
                path: "beginner" as InvestorPath,
                icon: Home,
                title: "Just Getting Started",
                subtitle: "I'm new to land investing and want to learn the ropes",
                benefits: ["Guided first deal walkthrough", "Expert strategy explanations", "Sample deal pre-loaded", "Daily Atlas coaching tips"],
                color: "emerald",
              },
              {
                path: "active" as InvestorPath,
                icon: Building,
                title: "Active Land Investor",
                subtitle: "I'm already doing deals and need better tools",
                benefits: ["Import existing portfolio", "Configure Deal Hunter for your markets", "Activate Autonomous Deal Machine", "Advanced analytics"],
                color: "blue",
              },
              {
                path: "enterprise" as InvestorPath,
                icon: Briefcase,
                title: "Team or Enterprise",
                subtitle: "I run a land investing operation with a team",
                benefits: ["Multi-user deal pipeline", "VA and team management", "White-label options", "API access for integrations"],
                color: "purple",
              },
            ].map(({ path, icon: Icon, title, subtitle, benefits, color }) => (
              <button
                key={path}
                onClick={() => {
                  setSelectedPath(path);
                  setCurrentStepIndex(0);
                }}
                className={cn(
                  "text-left p-6 rounded-2xl border-2 transition-all hover:scale-[1.01]",
                  `border-${color}-700/40 bg-${color}-950/20 hover:border-${color}-500`
                )}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-${color}-900/60 flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-6 h-6 text-${color}-400`} />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-white text-lg">{title}</div>
                    <div className="text-gray-400 text-sm mb-3">{subtitle}</div>
                    <div className="flex flex-wrap gap-2">
                      {benefits.map((b) => (
                        <span key={b} className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-full">
                          ✓ {b}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ArrowRight className={`w-5 h-5 text-${color}-400 flex-shrink-0 mt-1`} />
                </div>
              </button>
            ))}
          </div>

          <p className="text-center text-xs text-gray-600">
            You can change your path at any time in Settings · No credit card required to start
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Progress bar */}
      <div className="h-1 bg-gray-900">
        <div
          className="h-1 bg-emerald-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-900">
        <div className="text-sm font-medium text-emerald-400">AcreOS</div>
        <div className="text-xs text-gray-600">
          Step {currentStepIndex + 1} of {steps.length}
        </div>
        {currentStepIndex > 0 && (
          <button
            onClick={() => navigate("/dashboard")}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            Skip setup →
          </button>
        )}
      </div>

      {/* Main content */}
      <div
        className={cn(
          "flex-1 flex items-center justify-center p-6 transition-opacity duration-300",
          isAnimating ? "opacity-0" : "opacity-100"
        )}
      >
        <div className="max-w-xl w-full space-y-8">
          {/* Step header */}
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold text-white">{currentStep.title}</h2>
            <p className="text-gray-400">{currentStep.subtitle}</p>
          </div>

          {/* Step content */}
          {currentStep.id === "path" && selectedPath && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-900/20 border border-emerald-700/30 rounded-xl">
                <div className="flex items-center gap-3 mb-3">
                  <Brain className="w-5 h-5 text-emerald-400" />
                  <span className="font-medium text-white">Atlas AI is ready to help</span>
                </div>
                <p className="text-sm text-gray-400">
                  {selectedPath === "beginner"
                    ? "I'll guide you through finding your first land deal step by step. Land investing is simpler than most real estate — no tenants, no repairs, just buying cheap and selling for a profit."
                    : selectedPath === "active"
                    ? "Let's upgrade your operation. I'll analyze your existing deals, identify your best counties, and configure the Autonomous Deal Machine to find new opportunities every night."
                    : "I'll help configure AcreOS for your full team operation — deal routing, VA workflows, and enterprise analytics."}
                </p>
              </div>
              <Button
                onClick={() => advance()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 py-3"
              >
                Let's Get Started <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {currentStep.id === "target_county" && (
            <div className="space-y-4">
              <div>
                <Label className="text-gray-300 mb-2 block">Target State</Label>
                <Input
                  placeholder="e.g., TX"
                  maxLength={2}
                  value={formData.targetState || ""}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, targetState: e.target.value.toUpperCase() }))
                  }
                  className="bg-gray-900 border-gray-700 text-white text-lg py-3"
                />
              </div>
              <div>
                <Label className="text-gray-300 mb-2 block">Target County</Label>
                <Input
                  placeholder="e.g., Hudspeth"
                  value={formData.targetCounty || ""}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, targetCounty: e.target.value }))
                  }
                  className="bg-gray-900 border-gray-700 text-white text-lg py-3"
                />
              </div>
              <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg">
                <div className="text-xs text-gray-500 mb-2">💡 Not sure which county to pick?</div>
                <div className="text-xs text-gray-400">
                  Expert tip: Start with rural counties in TX, AZ, NM, or CO. Look for counties with
                  low competition (few investors mailing) and active land sales. The Deal Hunter will
                  show you opportunity scores for any county you choose.
                </div>
              </div>
              <Button
                onClick={() => advance({ targetCounty: formData.targetCounty, targetState: formData.targetState })}
                disabled={!formData.targetCounty || !formData.targetState}
                className="w-full bg-emerald-600 hover:bg-emerald-700 py-3"
              >
                Scan This County <Zap className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {currentStep.id === "instant_hunt" && (
            <InstantDealHunt
              targetCounty={formData.targetCounty || "Hudspeth"}
              targetState={formData.targetState || "TX"}
              onContinue={() => advance()}
            />
          )}

          {currentStep.id === "strategy" && (
            <div className="space-y-3">
              {[
                {
                  value: "flip_cash",
                  icon: DollarSign,
                  title: "Cash Flip",
                  desc: "Buy at 25-35% of market, sell for cash at 70-80%. Fast profit, repeat.",
                  roi: "~200-400% ROI, 60-120 day cycle",
                },
                {
                  value: "owner_finance",
                  icon: TrendingUp,
                  title: "Owner Financing",
                  desc: "Buy cheap, sell on 5-year terms with monthly payments. Passive income.",
                  roi: "~400-800% total ROI, $200-500/month per note",
                },
                {
                  value: "hybrid",
                  icon: BarChart3,
                  title: "Hybrid (Recommended)",
                  desc: "Some flips for cash flow, some notes for passive income. Best of both.",
                  roi: "Balanced cash flow + wealth building",
                },
              ].map(({ value, icon: Icon, title, desc, roi }) => (
                <button
                  key={value}
                  onClick={() => advance({ strategy: value })}
                  className={cn(
                    "w-full text-left p-4 rounded-xl border-2 transition-all",
                    formData.strategy === value
                      ? "border-emerald-500 bg-emerald-900/20"
                      : "border-gray-700 bg-gray-900 hover:border-gray-600"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                    <div>
                      <div className="font-semibold text-white">{title}</div>
                      <div className="text-sm text-gray-400">{desc}</div>
                      <div className="text-xs text-emerald-400 mt-1">{roi}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {currentStep.id === "atlas_tour" && (
            <div className="space-y-4">
              <div className="p-5 bg-purple-950/30 border border-purple-700/30 rounded-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-700/50 rounded-full flex items-center justify-center">
                    <Brain className="w-5 h-5 text-purple-300" />
                  </div>
                  <div>
                    <div className="font-bold text-white">Atlas AI</div>
                    <div className="text-xs text-gray-500">Your autonomous deal partner</div>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { icon: Target, text: "Finds deals every night while you sleep" },
                    { icon: Star, text: "Scores every lead with Seller Motivation AI" },
                    { icon: Phone, text: "Schedules follow-ups automatically (5-touch system)" },
                    { icon: Zap, text: "Sends your Morning Briefing at 7 AM daily" },
                  ].map(({ icon: Icon, text }) => (
                    <div key={text} className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      <span className="text-sm text-gray-300">{text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Button
                onClick={() => advance()}
                className="w-full bg-purple-600 hover:bg-purple-700 py-3"
              >
                Activate Atlas <Sparkles className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {currentStep.id === "complete" && (
            <div className="space-y-6 text-center">
              <div className="w-20 h-20 bg-emerald-900/50 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle className="w-10 h-10 text-emerald-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">You're all set!</h3>
                <p className="text-gray-400">
                  {selectedPath === "beginner"
                    ? "Your first target county is configured. AcreOS found opportunities while we talked — let's look at them."
                    : selectedPath === "active"
                    ? "Your operation is upgraded. The Autonomous Deal Machine will start tonight."
                    : "Your enterprise platform is configured. Invite your team to get started."}
                </p>
              </div>

              {/* Preview of what's waiting */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Target Counties", value: "1", sub: "configured" },
                  { label: "Deals Found", value: "3+", sub: "overnight" },
                  { label: "Deal Machine", value: "Active", sub: "tonight" },
                ].map(({ label, value, sub }) => (
                  <div key={label} className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-emerald-400">{value}</div>
                    <div className="text-xs text-white">{label}</div>
                    <div className="text-xs text-gray-600">{sub}</div>
                  </div>
                ))}
              </div>

              <Button
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
                className="w-full bg-emerald-600 hover:bg-emerald-700 py-4 text-lg font-semibold"
              >
                {completeMutation.isPending ? "Setting up..." : "Go to My Dashboard"}
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>

              <p className="text-xs text-gray-600">
                AcreOS will run its first deal scan tonight. Check your email at 7 AM for your Morning Briefing.
              </p>
            </div>
          )}

          {/* Generic continue for enterprise/active steps not fully built */}
          {!["path", "target_county", "instant_hunt", "strategy", "atlas_tour", "complete"].includes(
            currentStep.id
          ) && (
            <div className="space-y-4">
              <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl text-gray-400 text-sm">
                This step configures: <strong className="text-white">{currentStep.title}</strong>
                <br />
                Complete setup in Settings after launch to customize further.
              </div>
              <Button
                onClick={() => advance()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 py-3"
              >
                Continue <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex justify-center gap-2 py-4">
        {steps.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i < currentStepIndex
                ? "w-6 bg-emerald-500"
                : i === currentStepIndex
                ? "w-8 bg-emerald-400"
                : "w-2 bg-gray-800"
            )}
          />
        ))}
      </div>
    </div>
  );
}
