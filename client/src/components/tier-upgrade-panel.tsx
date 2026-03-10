/**
 * Tier Upgrade Panel — Aspirational, not punitive
 *
 * Philosophy: Every tier upgrade should feel like gaining superpowers,
 * not like being released from chains. Users at lower tiers should feel
 * valued and capable, with a clear, exciting vision of what they can unlock.
 *
 * Design principles:
 * - Show WHAT you gain (superpowers), not what you're missing
 * - Preview locked features with ghosted UI, not hard errors
 * - Celebrate current tier's strengths before showing next tier
 * - Use aspirational language: "Unlock", "Gain", "Activate" not "Upgrade required"
 * - Show the founder's vision: "Built by investors, for investors"
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Zap, Lock, Crown, Star, ArrowRight, Check, ChevronRight,
  Sparkles, TrendingUp, Target, Brain, Globe, Users, BarChart3,
  Shield, Rocket, Infinity
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TIER DEFINITIONS — Aspirational framing
// ─────────────────────────────────────────────────────────────────────────────

export const TIER_SUPERPOWERS = {
  free: {
    name: "Explorer",
    tier: "free",
    price: 0,
    tagline: "Explore the platform",
    color: "from-slate-500 to-slate-600",
    icon: Star,
    currentPowers: [
      "50 leads to build your first pipeline",
      "10 properties in your inventory",
      "Basic deal calculator",
      "Platform exploration mode",
    ],
    nextTierPreview: "sprout",
  },
  sprout: {
    name: "Sprout",
    tier: "sprout",
    price: 20,
    tagline: "Plant your first seeds",
    badge: "Best to start",
    color: "from-green-500 to-emerald-600",
    icon: Rocket,
    currentPowers: [
      "250 leads with AcreScore ranking",
      "50 properties with full enrichment",
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
    price: 49,
    tagline: "Build momentum",
    badge: "Most popular solo",
    color: "from-blue-500 to-blue-600",
    icon: TrendingUp,
    currentPowers: [
      "500 leads with full AcreScore",
      "100 properties with AI enrichment",
      "Atlas AI executive assistant",
      "Seller intent prediction engine",
      "Automated comps analysis",
      "Basic skip tracing",
      "AVM (Automated Valuation Model)",
      "Email drip sequences",
      "2 team member seats",
    ],
    nextTierPreview: "pro",
    unlockHighlights: [
      { icon: Brain, label: "Atlas AI Assistant", desc: "Your land investing executive AI" },
      { icon: Target, label: "Seller Intent Prediction", desc: "Know who wants to sell before they call" },
      { icon: BarChart3, label: "Comps Analysis", desc: "Automated comparable sales research" },
    ],
  },
  pro: {
    name: "Pro",
    tier: "pro",
    price: 149,
    tagline: "Scale your operation",
    badge: "Best value for growth",
    color: "from-purple-500 to-purple-700",
    icon: Crown,
    currentPowers: [
      "5,000 leads — serious deal flow",
      "1,000 properties — real portfolio scale",
      "Full skip tracing suite",
      "Deal Hunter AI — finds deals automatically",
      "Negotiation Copilot",
      "Owner financing management & note portfolio",
      "Buyer network access",
      "Portfolio health monitoring",
      "Market intelligence reports",
      "Acquisition Radar — proactive deal alerts",
      "SMS campaigns",
      "10 team members",
    ],
    nextTierPreview: "scale",
    unlockHighlights: [
      { icon: Brain, label: "Deal Hunter AI", desc: "AI proactively identifies opportunities for you" },
      { icon: Target, label: "Note Portfolio Manager", desc: "Full owner financing & passive income tracking" },
      { icon: Users, label: "Buyer Network", desc: "Access to qualified land buyers" },
    ],
  },
  scale: {
    name: "Scale",
    tier: "scale",
    price: 399,
    tagline: "Operate like a fund",
    badge: "For serious operators",
    color: "from-orange-500 to-orange-600",
    icon: Infinity,
    currentPowers: [
      "Unlimited leads, properties & notes",
      "Portfolio Optimizer AI — ML-managed portfolio",
      "Portfolio Sentinel — autonomous monitoring",
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
      { icon: Brain, label: "Portfolio AI", desc: "Machine learning manages your portfolio automatically" },
      { icon: Globe, label: "Unlimited Scale", desc: "No limits on leads, properties, or notes" },
      { icon: Shield, label: "Sentinel Monitoring", desc: "24/7 autonomous portfolio protection" },
    ],
  },
  enterprise: {
    name: "Enterprise",
    tier: "enterprise",
    price: 799,
    tagline: "White-label your empire",
    badge: "For funds & teams",
    color: "from-rose-500 to-rose-700",
    icon: Crown,
    currentPowers: [
      "Everything in Scale, plus:",
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
      { icon: Users, label: "Unlimited Teams", desc: "No seat limits — grow without friction" },
      { icon: Shield, label: "Enterprise Security", desc: "SSO, audit logs, compliance exports" },
    ],
  },
} as const;

export type TierKey = keyof typeof TIER_SUPERPOWERS;

// ─────────────────────────────────────────────────────────────────────────────
// SUPERPOWER UNLOCK BADGE — inline, shown on locked features
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// LOCKED FEATURE OVERLAY — wraps any component with a superpower unlock CTA
// ─────────────────────────────────────────────────────────────────────────────

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
  const TierIcon = tierInfo.icon;

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

// ─────────────────────────────────────────────────────────────────────────────
// UPGRADE DIALOG — Full tier comparison with aspirational messaging
// ─────────────────────────────────────────────────────────────────────────────

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
            Upgrading feels like gaining new abilities — never losing old ones. Your data stays, your work continues.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          {/* Current tier acknowledgment */}
          <div className="p-3 rounded-lg bg-muted/50 border">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">You're on {currentTierInfo.name}</span> — and you've built a great foundation.
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
                  {info.name} — ${info.price}/mo
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
                  Activate {selectedTierInfo.name} — ${selectedTierInfo.price}/mo
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

// ─────────────────────────────────────────────────────────────────────────────
// TIER PROGRESS INDICATOR — shows growth path in UI
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────────────────────

function getNextTier(current: TierKey): TierKey {
  const order: TierKey[] = ["free", "sprout", "starter", "pro", "scale", "enterprise"];
  const idx = order.indexOf(current);
  return idx < order.length - 1 ? order[idx + 1] : "enterprise";
}

export { getNextTier };
