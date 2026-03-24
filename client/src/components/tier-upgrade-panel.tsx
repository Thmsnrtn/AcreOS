/**
 * Tier Upgrade Panel — Apple-style product comparison
 *
 * Philosophy: Every tier upgrade should feel like gaining superpowers,
 * not like being released from chains. Users at lower tiers should feel
 * valued and capable, with a clear, exciting vision of what they can unlock.
 *
 * Design principles:
 * - Apple-style product comparison with prominent "killer feature" per tier
 * - Highlight current plan with clear visual distinction
 * - Mobile-first with animated tier switching (swipe / tab)
 * - Show WHAT you gain (superpowers), not what you're missing
 * - Preview locked features with ghosted UI, not hard errors
 * - Celebrate current tier's strengths before showing next tier
 * - Use aspirational language: "Unlock", "Gain", "Activate" not "Upgrade required"
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Zap, Lock, Crown, Star, ArrowRight, Check, ChevronRight,
  Sparkles, TrendingUp, Target, Brain, Globe, Users, BarChart3,
  Shield, Rocket, Infinity, ChevronLeft, Database, Bot, Search
} from "lucide-react";

// -----------------------------------------------------------------------
// TIER DEFINITIONS -- Aspirational framing
// -----------------------------------------------------------------------

export const TIER_SUPERPOWERS = {
  free: {
    name: "Explorer",
    tier: "free",
    price: 0,
    tagline: "Explore the platform",
    color: "from-slate-500 to-slate-600",
    accentColor: "slate",
    icon: Star,
    killerFeature: {
      icon: Star,
      label: "Free Forever",
      desc: "Get started with zero commitment",
    },
    currentPowers: [
      "50 leads to build your first pipeline",
      "10 properties in your inventory",
      "10 enrichments/mo (open data)",
      "Basic deal calculator",
      "Platform exploration mode",
    ],
    nextTierPreview: "sprout",
  },
  sprout: {
    name: "Sprout",
    tier: "sprout",
    price: 29,
    tagline: "Plant your first seeds",
    badge: "Best to start",
    color: "from-green-500 to-emerald-600",
    accentColor: "emerald",
    icon: Rocket,
    killerFeature: {
      icon: Brain,
      label: "AI Due Diligence",
      desc: "Atlas analyzes every parcel automatically",
    },
    currentPowers: [
      "250 leads with AcreScore ranking",
      "50 properties with full enrichment",
      "50 enrichments/mo (basic data tier)",
      "AI due diligence on every parcel",
      "Tax delinquent list import",
      "Night Cap passive income dashboard",
      "Blind offer calculation wizard",
      "Direct mail campaign builder",
    ],
    nextTierPreview: "starter",
    unlockHighlights: [
      { icon: Brain, label: "AI Due Diligence", desc: "Atlas analyzes every parcel for you" },
      { icon: Target, label: "Tax Delinquent Import", desc: "Upload and process county lists" },
      { icon: TrendingUp, label: "Night Cap Dashboard", desc: "Track your passive income nightly" },
    ],
  },
  starter: {
    name: "Starter",
    tier: "starter",
    price: 59,
    tagline: "Build momentum",
    badge: "Most popular solo",
    color: "from-blue-500 to-blue-600",
    accentColor: "blue",
    icon: TrendingUp,
    killerFeature: {
      icon: Search,
      label: "50 Skip Traces/mo",
      desc: "Find owner contact info with assisted AI",
    },
    currentPowers: [
      "500 leads with full AcreScore",
      "100 properties with AI enrichment",
      "50 skip traces/mo + 200 enrichments/mo",
      "Standard data tier access",
      "Atlas AI assistant (assisted mode)",
      "Seller intent prediction engine",
      "Automated comps analysis",
      "AVM (Automated Valuation Model)",
      "Email drip sequences",
      "2 team member seats",
    ],
    nextTierPreview: "pro",
    unlockHighlights: [
      { icon: Search, label: "Skip Tracing", desc: "Find owner phone & email from any parcel" },
      { icon: Brain, label: "Atlas AI Assistant", desc: "Your land investing executive AI" },
      { icon: BarChart3, label: "Comps Analysis", desc: "Automated comparable sales research" },
    ],
  },
  pro: {
    name: "Pro",
    tier: "pro",
    price: 179,
    tagline: "Scale your operation",
    badge: "Best value for growth",
    color: "from-purple-500 to-purple-700",
    accentColor: "purple",
    icon: Crown,
    killerFeature: {
      icon: Bot,
      label: "Supervised AI Autonomy",
      desc: "Deal Hunter AI finds opportunities while you sleep",
    },
    currentPowers: [
      "5,000 leads -- serious deal flow",
      "1,000 properties -- real portfolio scale",
      "200 skip traces/mo + 1,000 enrichments/mo",
      "Premium data tier access",
      "AI supervised autonomy -- Deal Hunter runs automatically",
      "Negotiation Copilot",
      "Owner financing management & note portfolio",
      "Buyer network access",
      "Portfolio health monitoring",
      "Market intelligence reports",
      "Acquisition Radar -- proactive deal alerts",
      "SMS campaigns",
      "10 team members",
    ],
    nextTierPreview: "scale",
    unlockHighlights: [
      { icon: Bot, label: "Deal Hunter AI", desc: "AI proactively identifies opportunities for you" },
      { icon: Database, label: "Premium Data", desc: "Access the highest-quality property & owner data" },
      { icon: Users, label: "Buyer Network", desc: "Access to qualified land buyers" },
    ],
  },
  scale: {
    name: "Scale",
    tier: "scale",
    price: 449,
    tagline: "Operate like a fund",
    badge: "For serious operators",
    color: "from-orange-500 to-orange-600",
    accentColor: "orange",
    icon: Infinity,
    killerFeature: {
      icon: Shield,
      label: "Autonomous AI + Sentinel",
      desc: "Fully autonomous portfolio management & protection",
    },
    currentPowers: [
      "Unlimited leads, properties & notes",
      "1,000 skip traces/mo + 5,000 enrichments/mo",
      "Premium data tier -- full access",
      "Fully autonomous AI -- Portfolio Optimizer",
      "Portfolio Sentinel -- 24/7 autonomous monitoring",
      "Capital markets access",
      "VA management system",
      "Voice AI for calls",
      "Vision AI for parcel analysis",
      "1031 Exchange tracker",
      "Tax optimization engine",
      "Full API access & webhooks",
      "25 team members",
    ],
    nextTierPreview: "enterprise",
    unlockHighlights: [
      { icon: Shield, label: "Portfolio Sentinel", desc: "24/7 autonomous portfolio protection" },
      { icon: Globe, label: "Unlimited Scale", desc: "No limits on leads, properties, or notes" },
      { icon: Bot, label: "Autonomous AI", desc: "Machine learning manages your portfolio automatically" },
    ],
  },
  enterprise: {
    name: "Enterprise",
    tier: "enterprise",
    price: 899,
    tagline: "White-label your empire",
    badge: "For funds & teams",
    color: "from-rose-500 to-rose-700",
    accentColor: "rose",
    icon: Crown,
    killerFeature: {
      icon: Globe,
      label: "White-Label Platform",
      desc: "Rebrand the entire platform as your own",
    },
    currentPowers: [
      "Everything in Scale, plus:",
      "Unlimited skip traces & enrichments",
      "White-label portal for your brand",
      "Multi-organization management",
      "SSO & enterprise authentication",
      "Dedicated account support",
      "Full compliance export suite",
      "Custom integrations",
      "Reseller dashboard",
      "Unlimited team members",
    ],
    unlockHighlights: [
      { icon: Globe, label: "White Label Portal", desc: "Rebrand the entire platform as your own" },
      { icon: Users, label: "Unlimited Teams", desc: "No seat limits -- grow without friction" },
      { icon: Shield, label: "Enterprise Security", desc: "SSO, audit logs, compliance exports" },
    ],
  },
} as const;

export type TierKey = keyof typeof TIER_SUPERPOWERS;

// -----------------------------------------------------------------------
// SUPERPOWER UNLOCK BADGE -- inline, shown on locked features
// -----------------------------------------------------------------------

interface SuperpowerBadgeProps {
  requiredTier: TierKey;
  featureName: string;
  onUpgradeClick?: () => void;
  className?: string;
}

export function SuperpowerBadge({ requiredTier, featureName, onUpgradeClick, className }: SuperpowerBadgeProps) {
  const tierInfo = TIER_SUPERPOWERS[requiredTier];
  const TierIcon = tierInfo.icon;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-gradient-to-r ${tierInfo.color} text-white text-xs font-medium cursor-pointer hover:opacity-90 transition-opacity ${className || ""}`}
      onClick={onUpgradeClick}
      title={`Unlock with ${tierInfo.name}`}
    >
      <Zap className="w-3 h-3" />
      <span>{tierInfo.name}</span>
    </motion.div>
  );
}

// -----------------------------------------------------------------------
// LOCKED FEATURE OVERLAY -- wraps any component with a superpower unlock CTA
// -----------------------------------------------------------------------

interface LockedFeatureProps {
  requiredTier: TierKey;
  featureName: string;
  featureDescription?: string;
  children: React.ReactNode;
  blurContent?: boolean;
  onUpgradeClick?: () => void;
}

export function LockedFeature({ requiredTier, featureName, featureDescription, children, blurContent = true, onUpgradeClick }: LockedFeatureProps) {
  const tierInfo = TIER_SUPERPOWERS[requiredTier];

  return (
    <div className="relative group">
      {/* Blurred content preview */}
      <div className={blurContent ? "pointer-events-none select-none blur-[2px] opacity-60 transition-all group-hover:blur-[3px]" : "pointer-events-none select-none opacity-60"}>
        {children}
      </div>

      {/* Overlay */}
      <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-[1px] rounded-lg opacity-0 group-hover:opacity-100 transition-all duration-200">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="text-center p-6 max-w-xs"
        >
          <div className={`inline-flex items-center justify-center w-12 h-12 rounded-full bg-gradient-to-br ${tierInfo.color} text-white mb-3 mx-auto`}>
            <Zap className="w-6 h-6" />
          </div>
          <h3 className="font-semibold text-foreground mb-1">{featureName}</h3>
          {featureDescription && (
            <p className="text-sm text-muted-foreground mb-3">{featureDescription}</p>
          )}
          <Button
            size="sm"
            className={`bg-gradient-to-r ${tierInfo.color} text-white border-0 hover:opacity-90`}
            onClick={onUpgradeClick}
          >
            <Zap className="w-3.5 h-3.5 mr-1.5" />
            Unlock with {tierInfo.name}
          </Button>
        </motion.div>
      </div>

      {/* Always-visible corner badge */}
      <div className="absolute top-2 right-2">
        <SuperpowerBadge requiredTier={requiredTier} featureName={featureName} onUpgradeClick={onUpgradeClick} />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------
// UPGRADE DIALOG -- Full tier comparison with aspirational messaging
// -----------------------------------------------------------------------

interface TierUpgradeDialogProps {
  open: boolean;
  onClose: () => void;
  currentTier: TierKey;
  targetTier?: TierKey;
  triggeredByFeature?: string;
  onUpgrade?: (tier: TierKey) => void;
}

export function TierUpgradeDialog({ open, onClose, currentTier, targetTier, triggeredByFeature, onUpgrade }: TierUpgradeDialogProps) {
  const [selectedTier, setSelectedTier] = useState<TierKey>(targetTier || getNextTier(currentTier));
  const currentTierInfo = TIER_SUPERPOWERS[currentTier];
  const selectedTierInfo = TIER_SUPERPOWERS[selectedTier];
  const SelectedIcon = selectedTierInfo.icon;

  const tiers = (["sprout", "starter", "pro", "scale", "enterprise"] as TierKey[]).filter(t => t !== currentTier && TIER_SUPERPOWERS[t].price > (TIER_SUPERPOWERS[currentTier]?.price || 0));

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">
            {triggeredByFeature ? (
              <span>Unlock <span className="text-primary">{triggeredByFeature}</span></span>
            ) : (
              <span>Upgrade Your Superpowers</span>
            )}
          </DialogTitle>
          <DialogDescription>
            Upgrading feels like gaining new abilities -- never losing old ones. Your data stays, your work continues.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          {/* Current tier acknowledgment */}
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">You're on {currentTierInfo.name}</span> -- and you've built a great foundation.
              Here's what you can unlock next:
            </p>
          </div>

          {/* Tier selector */}
          <div className="flex gap-2 flex-wrap">
            {tiers.map((tier) => {
              const info = TIER_SUPERPOWERS[tier];
              const Icon = info.icon;
              return (
                <button
                  key={tier}
                  onClick={() => setSelectedTier(tier)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    selectedTier === tier
                      ? `bg-gradient-to-r ${info.color} text-white shadow-md`
                      : "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {info.name} -- ${info.price}/mo
                  {(info as any).badge && (
                    <span className="text-xs opacity-80">({(info as any).badge})</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected tier detail */}
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedTier}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* Superpower highlights */}
              {(selectedTierInfo as any).unlockHighlights && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {((selectedTierInfo as any).unlockHighlights as Array<{ icon: any; label: string; desc: string }>).map((highlight, i) => {
                    const HIcon = highlight.icon;
                    return (
                      <div key={i} className={`p-4 rounded-xl bg-gradient-to-br ${selectedTierInfo.color} text-white`}>
                        <HIcon className="w-6 h-6 mb-2 opacity-90" />
                        <p className="font-semibold text-sm">{highlight.label}</p>
                        <p className="text-xs opacity-80 mt-0.5">{highlight.desc}</p>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Full feature list */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <SelectedIcon className="w-4 h-4" />
                    Everything in {selectedTierInfo.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {selectedTierInfo.currentPowers.map((power, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                        <span>{power}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              {/* CTA */}
              <div className="flex items-center gap-3">
                <Button
                  className={`flex-1 bg-gradient-to-r ${selectedTierInfo.color} text-white border-0 hover:opacity-90`}
                  size="lg"
                  onClick={() => onUpgrade?.(selectedTier)}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Activate {selectedTierInfo.name} -- ${selectedTierInfo.price}/mo
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
                <Button variant="outline" onClick={onClose}>
                  Not yet
                </Button>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                Cancel anytime. Your data stays. No migration headaches.
                Built by land investors, for land investors.
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------
// TIER PROGRESS INDICATOR -- shows growth path in UI
// -----------------------------------------------------------------------

interface TierProgressProps {
  currentTier: TierKey;
  onUpgradeClick?: () => void;
  compact?: boolean;
}

export function TierProgress({ currentTier, onUpgradeClick, compact }: TierProgressProps) {
  const tiers: TierKey[] = ["free", "sprout", "starter", "pro", "scale", "enterprise"];
  const currentIndex = tiers.indexOf(currentTier);
  const currentInfo = TIER_SUPERPOWERS[currentTier];
  const nextTier = currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;
  const nextInfo = nextTier ? TIER_SUPERPOWERS[nextTier] : null;

  if (compact && !nextInfo) return null;

  return (
    <div className={`flex items-center gap-2 ${compact ? "text-xs" : "text-sm"}`}>
      {/* Current tier badge */}
      <Badge
        className={`bg-gradient-to-r ${currentInfo.color} text-white border-0`}
      >
        {currentInfo.name}
      </Badge>

      {nextInfo && (
        <>
          <ChevronRight className="w-3 h-3 text-muted-foreground" />
          <button
            onClick={onUpgradeClick}
            className={`flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors group`}
          >
            <Lock className="w-3 h-3 group-hover:text-primary" />
            <span className="group-hover:text-primary">{nextInfo.name}</span>
            <span className="text-muted-foreground/60">${nextInfo.price}/mo</span>
            <Sparkles className="w-3 h-3 text-primary opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        </>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// PLAN COMPARISON MODAL -- Apple-style product comparison
// -----------------------------------------------------------------------

import { useQuery } from "@tanstack/react-query";
import { SUBSCRIPTION_TIERS } from "@shared/schema";
import type { StripeProduct } from "@/hooks/use-organization";
import { useCreateCheckoutSession } from "@/hooks/use-organization";
import { Loader2 } from "lucide-react";

interface PlanComparisonModalProps {
  open: boolean;
  onClose: () => void;
  currentTier: TierKey;
}

const PLAN_ORDER: TierKey[] = ["free", "sprout", "starter", "pro", "scale", "enterprise"];

function formatLimit(value: number | null | undefined): string {
  if (value === null || value === undefined || value === -1) return "Unlimited";
  return value.toLocaleString();
}

// Data rows for the comparison table
const AUTONOMY_LABELS: Record<string, string> = {
  none: "Manual",
  assisted: "Assisted",
  supervised: "Supervised",
  autonomous: "Autonomous",
};

const DATA_TIER_LABELS: Record<string, string> = {
  open: "Open",
  basic: "Basic",
  standard: "Standard",
  premium: "Premium",
};

// Tier-specific data for comparison rows
const TIER_DATA: Record<TierKey, {
  skipTraces: string;
  enrichments: string;
  autonomy: string;
  dataTier: string;
}> = {
  free:       { skipTraces: "--",        enrichments: "10",    autonomy: "Manual",     dataTier: "Open" },
  sprout:     { skipTraces: "--",        enrichments: "50",    autonomy: "Manual",     dataTier: "Basic" },
  starter:    { skipTraces: "50",        enrichments: "200",   autonomy: "Assisted",   dataTier: "Standard" },
  pro:        { skipTraces: "200",       enrichments: "1,000", autonomy: "Supervised", dataTier: "Premium" },
  scale:      { skipTraces: "1,000",     enrichments: "5,000", autonomy: "Autonomous", dataTier: "Premium" },
  enterprise: { skipTraces: "Unlimited", enrichments: "Unlimited", autonomy: "Autonomous", dataTier: "Premium" },
};

export function PlanComparisonModal({ open, onClose, currentTier }: PlanComparisonModalProps) {
  const { data: products } = useQuery<StripeProduct[]>({
    queryKey: ["/api/stripe/products"],
    enabled: open,
  });
  const checkout = useCreateCheckoutSession();
  const [activeMobileTier, setActiveMobileTier] = useState<number>(
    Math.max(PLAN_ORDER.indexOf(currentTier), 0)
  );
  const [swipeDirection, setSwipeDirection] = useState<"left" | "right">("right");

  const handleSubscribe = (tier: TierKey) => {
    const tierInfo = SUBSCRIPTION_TIERS[tier];
    const product = products?.find(p =>
      p.metadata?.tier === tier ||
      p.name?.toLowerCase().includes(tierInfo.name.toLowerCase())
    );
    const price = product?.prices?.find(p => p.active && p.recurring);
    if (price) {
      checkout.mutate(price.id, {
        onSuccess: (data) => { window.location.href = data.url; },
      });
    }
  };

  const navigateMobileTier = useCallback((direction: "left" | "right") => {
    setSwipeDirection(direction);
    setActiveMobileTier(prev => {
      if (direction === "left") return Math.max(0, prev - 1);
      return Math.min(PLAN_ORDER.length - 1, prev + 1);
    });
  }, []);

  const handleDragEnd = useCallback((_: any, info: PanInfo) => {
    const threshold = 50;
    if (info.offset.x > threshold) {
      navigateMobileTier("left");
    } else if (info.offset.x < -threshold) {
      navigateMobileTier("right");
    }
  }, [navigateMobileTier]);

  const mobileSlideVariants = {
    enter: (dir: "left" | "right") => ({
      x: dir === "right" ? 300 : -300,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: "left" | "right") => ({
      x: dir === "right" ? -300 : 300,
      opacity: 0,
    }),
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto p-0">
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle className="text-2xl font-semibold tracking-tight">
              Choose your plan
            </DialogTitle>
            <DialogDescription className="text-base">
              Every plan includes your existing data. Upgrade or downgrade anytime.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* ---- DESKTOP: Full grid comparison ---- */}
        <div className="hidden lg:block px-6 pb-6">
          <div className="grid grid-cols-6 gap-3 mt-6">
            {PLAN_ORDER.map((tier) => {
              const info = SUBSCRIPTION_TIERS[tier];
              const tierMeta = TIER_SUPERPOWERS[tier];
              const isCurrent = tier === currentTier;
              const Icon = tierMeta.icon;
              const KillerIcon = tierMeta.killerFeature.icon;
              const tierData = TIER_DATA[tier];

              return (
                <div
                  key={tier}
                  className={`relative flex flex-col rounded-2xl border-2 transition-all duration-300 ${
                    isCurrent
                      ? "border-primary bg-primary/[0.03] shadow-lg shadow-primary/10 scale-[1.02]"
                      : "border-border/50 hover:border-border hover:shadow-md"
                  }`}
                >
                  {/* Current plan indicator */}
                  {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                      <Badge className="bg-primary text-primary-foreground shadow-sm text-[11px] px-3">
                        Current plan
                      </Badge>
                    </div>
                  )}

                  {/* Tier badge (e.g. "Most popular") */}
                  {!isCurrent && (tierMeta as any).badge && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                      <Badge variant="secondary" className="text-[11px] px-2 whitespace-nowrap">
                        {(tierMeta as any).badge}
                      </Badge>
                    </div>
                  )}

                  {/* Header */}
                  <div className="p-4 pb-3 text-center pt-5">
                    <div className={`mx-auto w-10 h-10 rounded-xl bg-gradient-to-br ${tierMeta.color} text-white flex items-center justify-center mb-2.5`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="font-semibold text-base">{info.name}</h3>
                    <p className="text-muted-foreground text-xs mt-0.5">{tierMeta.tagline}</p>
                    <div className="mt-3">
                      <span className="text-3xl font-bold tracking-tight">
                        {info.price === 0 ? "Free" : `$${info.price}`}
                      </span>
                      {info.price > 0 && (
                        <span className="text-sm text-muted-foreground font-normal">/mo</span>
                      )}
                    </div>
                  </div>

                  {/* Killer Feature -- prominent highlight */}
                  <div className={`mx-3 p-3 rounded-xl bg-gradient-to-br ${tierMeta.color} text-white mb-3`}>
                    <KillerIcon className="w-5 h-5 mb-1.5 opacity-90" />
                    <p className="font-semibold text-xs leading-tight">{tierMeta.killerFeature.label}</p>
                    <p className="text-[11px] opacity-80 mt-0.5 leading-tight">{tierMeta.killerFeature.desc}</p>
                  </div>

                  {/* Comparison rows */}
                  <div className="px-3 pb-3 flex-1 space-y-2 text-xs">
                    <div className="flex justify-between items-center py-1 border-b border-border/30">
                      <span className="text-muted-foreground">Leads</span>
                      <span className="font-medium">{formatLimit(info.limits.leads)}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-border/30">
                      <span className="text-muted-foreground">Properties</span>
                      <span className="font-medium">{formatLimit(info.limits.properties)}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-border/30">
                      <span className="text-muted-foreground">Skip Traces</span>
                      <span className="font-medium">{tierData.skipTraces}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-border/30">
                      <span className="text-muted-foreground">Enrichments</span>
                      <span className="font-medium">{tierData.enrichments}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-border/30">
                      <span className="text-muted-foreground">AI Mode</span>
                      <span className="font-medium">{tierData.autonomy}</span>
                    </div>
                    <div className="flex justify-between items-center py-1 border-b border-border/30">
                      <span className="text-muted-foreground">Data Tier</span>
                      <span className="font-medium">{tierData.dataTier}</span>
                    </div>
                    <div className="flex justify-between items-center py-1">
                      <span className="text-muted-foreground">Seats</span>
                      <span className="font-medium">{formatLimit(info.limits.teamMembers)}</span>
                    </div>
                  </div>

                  {/* CTA */}
                  <div className="p-3 pt-0 mt-auto">
                    {isCurrent ? (
                      <Button size="sm" variant="outline" className="w-full text-xs" disabled>
                        Current Plan
                      </Button>
                    ) : info.price > 0 ? (
                      <Button
                        size="sm"
                        className={`w-full text-xs bg-gradient-to-r ${tierMeta.color} text-white border-0 hover:opacity-90 transition-opacity`}
                        onClick={() => handleSubscribe(tier)}
                        disabled={checkout.isPending}
                      >
                        {checkout.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <>Get {info.name}</>
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- MOBILE: Swipeable card carousel ---- */}
        <div className="lg:hidden px-4 pb-6">
          {/* Mobile tier tabs */}
          <div className="flex gap-1 overflow-x-auto py-3 scrollbar-hide -mx-1 px-1">
            {PLAN_ORDER.map((tier, idx) => {
              const tierMeta = TIER_SUPERPOWERS[tier];
              const isCurrent = tier === currentTier;
              const isActive = idx === activeMobileTier;
              return (
                <button
                  key={tier}
                  onClick={() => {
                    setSwipeDirection(idx > activeMobileTier ? "right" : "left");
                    setActiveMobileTier(idx);
                  }}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    isActive
                      ? `bg-gradient-to-r ${tierMeta.color} text-white shadow-sm`
                      : isCurrent
                        ? "bg-primary/10 text-primary border border-primary/30"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {tierMeta.name}
                  {isCurrent && !isActive && (
                    <span className="ml-1 text-[10px] opacity-70">(you)</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Swipeable card */}
          <div className="relative overflow-hidden min-h-[520px]">
            <AnimatePresence mode="wait" custom={swipeDirection}>
              {(() => {
                const tier = PLAN_ORDER[activeMobileTier];
                const info = SUBSCRIPTION_TIERS[tier];
                const tierMeta = TIER_SUPERPOWERS[tier];
                const isCurrent = tier === currentTier;
                const Icon = tierMeta.icon;
                const KillerIcon = tierMeta.killerFeature.icon;
                const tierData = TIER_DATA[tier];

                return (
                  <motion.div
                    key={tier}
                    custom={swipeDirection}
                    variants={mobileSlideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.2}
                    onDragEnd={handleDragEnd}
                    className={`rounded-2xl border-2 ${
                      isCurrent
                        ? "border-primary bg-primary/[0.03]"
                        : "border-border/50"
                    }`}
                  >
                    {/* Mobile card header */}
                    <div className="p-5 text-center">
                      {isCurrent && (
                        <Badge className="bg-primary text-primary-foreground mb-3 text-[11px]">
                          Current plan
                        </Badge>
                      )}
                      {!isCurrent && (tierMeta as any).badge && (
                        <Badge variant="secondary" className="mb-3 text-[11px]">
                          {(tierMeta as any).badge}
                        </Badge>
                      )}

                      <div className={`mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br ${tierMeta.color} text-white flex items-center justify-center mb-3`}>
                        <Icon className="w-7 h-7" />
                      </div>
                      <h3 className="text-xl font-semibold">{info.name}</h3>
                      <p className="text-muted-foreground text-sm">{tierMeta.tagline}</p>
                      <div className="mt-2">
                        <span className="text-4xl font-bold tracking-tight">
                          {info.price === 0 ? "Free" : `$${info.price}`}
                        </span>
                        {info.price > 0 && (
                          <span className="text-base text-muted-foreground">/mo</span>
                        )}
                      </div>
                    </div>

                    {/* Killer feature */}
                    <div className={`mx-4 p-4 rounded-xl bg-gradient-to-br ${tierMeta.color} text-white mb-4`}>
                      <div className="flex items-start gap-3">
                        <KillerIcon className="w-8 h-8 opacity-90 flex-shrink-0" />
                        <div>
                          <p className="font-semibold text-sm">{tierMeta.killerFeature.label}</p>
                          <p className="text-xs opacity-80 mt-0.5">{tierMeta.killerFeature.desc}</p>
                        </div>
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div className="mx-4 mb-4 grid grid-cols-2 gap-2">
                      {[
                        { label: "Leads", value: formatLimit(info.limits.leads) },
                        { label: "Properties", value: formatLimit(info.limits.properties) },
                        { label: "Skip Traces", value: tierData.skipTraces },
                        { label: "Enrichments", value: tierData.enrichments },
                        { label: "AI Mode", value: tierData.autonomy },
                        { label: "Data Tier", value: tierData.dataTier },
                      ].map((stat) => (
                        <div key={stat.label} className="bg-muted/50 rounded-lg p-2.5 text-center">
                          <p className="text-[11px] text-muted-foreground">{stat.label}</p>
                          <p className="font-semibold text-sm">{stat.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* CTA */}
                    <div className="px-4 pb-5">
                      {isCurrent ? (
                        <Button variant="outline" className="w-full" disabled>
                          Current Plan
                        </Button>
                      ) : info.price > 0 ? (
                        <Button
                          className={`w-full bg-gradient-to-r ${tierMeta.color} text-white border-0 hover:opacity-90`}
                          onClick={() => handleSubscribe(tier)}
                          disabled={checkout.isPending}
                        >
                          {checkout.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <>
                              Get {info.name}
                              <ArrowRight className="w-4 h-4 ml-2" />
                            </>
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </motion.div>
                );
              })()}
            </AnimatePresence>

            {/* Navigation arrows */}
            {activeMobileTier > 0 && (
              <button
                onClick={() => navigateMobileTier("left")}
                className="absolute left-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 backdrop-blur border shadow-sm flex items-center justify-center z-10"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            {activeMobileTier < PLAN_ORDER.length - 1 && (
              <button
                onClick={() => navigateMobileTier("right")}
                className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-background/80 backdrop-blur border shadow-sm flex items-center justify-center z-10"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Dot indicators */}
          <div className="flex justify-center gap-1.5 mt-3">
            {PLAN_ORDER.map((tier, idx) => (
              <button
                key={tier}
                onClick={() => {
                  setSwipeDirection(idx > activeMobileTier ? "right" : "left");
                  setActiveMobileTier(idx);
                }}
                className={`w-2 h-2 rounded-full transition-all ${
                  idx === activeMobileTier
                    ? `w-6 bg-gradient-to-r ${TIER_SUPERPOWERS[tier].color}`
                    : tier === currentTier
                      ? "bg-primary/40"
                      : "bg-muted-foreground/20"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="px-6 pb-4">
          <p className="text-xs text-center text-muted-foreground">
            All paid plans include a 7-day free trial. Cancel anytime. Your data always stays.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------
// UTILITY
// -----------------------------------------------------------------------

function getNextTier(current: TierKey): TierKey {
  const order: TierKey[] = ["free", "sprout", "starter", "pro", "scale", "enterprise"];
  const idx = order.indexOf(current);
  return idx < order.length - 1 ? order[idx + 1] : "enterprise";
}

export { getNextTier };
