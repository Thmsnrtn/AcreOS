// @ts-nocheck
/**
 * Onboarding Walkthrough — Sovereign Company Protocol v4
 *
 * A 4-step onboarding overlay shown once (tracked in localStorage).
 * Explains what the AI agent team is and how to interact with them.
 *
 * Steps:
 * 1. Meet your team — avatar row of all 10 agents with one-line roles
 * 2. How decisions work — swipe demo
 * 3. Set your priorities — connects to Strategic Compass
 * 4. You're in control — explains trust, quiet hours, undo
 */

import { useState, useEffect } from "react";
import { X, ChevronRight, ChevronLeft, Users, Zap, Target, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const STORAGE_KEY = "acreos_onboarding_v4_complete";

const AGENTS = [
  { name: "Atlas", role: "CTO", color: "#8B5CF6", emoji: "🏛️" },
  { name: "Sophie", role: "Customer Success", color: "#E879A8", emoji: "💜" },
  { name: "Forge", role: "Revenue Lead", color: "#F59E0B", emoji: "🔥" },
  { name: "Beacon", role: "Marketing", color: "#10B981", emoji: "🏮" },
  { name: "Sentinel", role: "Infrastructure", color: "#3B82F6", emoji: "🛡️" },
  { name: "Ledger", role: "Finance", color: "#6366F1", emoji: "📒" },
  { name: "Shield", role: "Compliance", color: "#F97316", emoji: "⚖️" },
  { name: "Oracle", role: "Analytics", color: "#EC4899", emoji: "🔮" },
  { name: "Compass", role: "Product", color: "#14B8A6", emoji: "🧭" },
  { name: "Crucible", role: "Quality", color: "#EF4444", emoji: "🧪" },
];

const STEPS = [
  {
    icon: Users,
    title: "Meet your AI team",
    description: "You have 10 AI agents working for you around the clock. Each specializes in a different area of your business.",
    content: "team",
  },
  {
    icon: Zap,
    title: "How decisions work",
    description: "When an agent needs your input, you'll see a swipe card. Swipe right to approve, left to reject. They learn from your choices.",
    content: "decisions",
  },
  {
    icon: Target,
    title: "Set your priorities",
    description: "Tell your team what matters most right now. Say something like 'focus on keeping customers happy' and every agent will adjust their behavior.",
    content: "priorities",
  },
  {
    icon: Shield,
    title: "You're in control",
    description: "Your team earns your trust over time. You can undo actions, set quiet hours for notifications, and see everything they did in the activity timeline.",
    content: "control",
  },
];

export default function OnboardingWalkthrough() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed) {
      // Show after a short delay so the dashboard loads first
      const timer = setTimeout(() => setIsOpen(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleComplete = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    setIsOpen(false);
  };

  const handleSkip = () => {
    localStorage.setItem(STORAGE_KEY, "skipped");
    setIsOpen(false);
  };

  // Esc-to-dismiss for keyboard users
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleSkip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  const currentStep = STEPS[step];
  const StepIcon = currentStep.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-floating flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Founder onboarding walkthrough"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md bg-acr-bg-sunken rounded-2xl border border-border/50 overflow-hidden shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1 rounded-full transition-all ${
                  i === step ? "w-8 bg-acr-accent" : i < step ? "w-4 bg-acr-accent/50" : "w-4 bg-acr-bg-sunken"
                }`}
              />
            ))}
          </div>
          <button type="button" onClick={handleSkip} aria-label="Skip onboarding walkthrough" className="p-1 text-muted-foreground hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="p-6"
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-card bg-acr-accent/10">
                <StepIcon className="w-6 h-6 text-acr-accent" />
              </div>
              <h2 className="text-lg font-semibold text-muted-foreground">{currentStep.title}</h2>
            </div>

            <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
              {currentStep.description}
            </p>

            {/* Step-specific content */}
            {currentStep.content === "team" && (
              <div className="grid grid-cols-5 gap-3 mb-4">
                {AGENTS.map(agent => (
                  <div key={agent.name} className="text-center">
                    <div
                      className="w-10 h-10 mx-auto rounded-full flex items-center justify-center text-lg mb-1"
                      style={{ backgroundColor: `${agent.color}20`, border: `1px solid ${agent.color}40` }}
                    >
                      {agent.emoji}
                    </div>
                    <p className="text-xs text-muted-foreground font-medium">{agent.name}</p>
                    <p className="text-micro text-muted-foreground">{agent.role}</p>
                  </div>
                ))}
              </div>
            )}

            {currentStep.content === "decisions" && (
              <div className="relative mx-auto w-64 h-32 mb-4">
                <div className="absolute inset-0 bg-acr-bg-sunken rounded-xl border border-border p-3">
                  <p className="text-xs text-muted-foreground mb-1">Sophie recommends</p>
                  <p className="text-sm text-muted-foreground">Send retention email to Acme Corp</p>
                  <div className="flex justify-between mt-4">
                    <div className="text-xs text-acr-neg/60">← Reject</div>
                    <div className="text-xs text-acr-pos/60">Approve →</div>
                  </div>
                </div>
              </div>
            )}

            {currentStep.content === "priorities" && (
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-acr-bg-sunken/60 border border-border/40">
                  <span className="text-sm text-muted-foreground">Keep customers happy</span>
                  <span className="ml-auto text-xs text-acr-warn">★★★★★</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-card bg-acr-bg-sunken/60 border border-border/40">
                  <span className="text-sm text-muted-foreground">Grow revenue</span>
                  <span className="ml-auto text-xs text-acr-warn">★★★</span>
                </div>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  You can set these via chat: "focus on retention"
                </p>
              </div>
            )}

            {currentStep.content === "control" && (
              <div className="space-y-3 mb-4">
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded-card bg-acr-pos/10 flex items-center justify-center">
                    <span className="text-acr-pos text-xs">↩</span>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-medium">Undo actions</p>
                    <p className="text-xs text-muted-foreground">Reverse agent decisions you disagree with</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded-card bg-acr-accent/10 flex items-center justify-center">
                    <span className="text-acr-accent text-xs">🌙</span>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-medium">Quiet hours</p>
                    <p className="text-xs text-muted-foreground">No notifications between 10pm - 7am</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded-card bg-acr-brand/10 flex items-center justify-center">
                    <span className="text-acr-brand text-xs">📈</span>
                  </div>
                  <div>
                    <p className="text-muted-foreground font-medium">Trust builds over time</p>
                    <p className="text-xs text-muted-foreground">Agents earn autonomy by proving themselves</p>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 pb-6">
          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep(s => s - 1)}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" /> Back
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSkip}
              className="text-sm text-muted-foreground hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              Skip
            </button>
          )}

          <button
            type="button"
            onClick={isLast ? handleComplete : () => setStep(s => s + 1)}
            className="flex items-center gap-1 px-4 py-2 rounded-card bg-acr-accent hover:bg-acr-accent text-sm font-medium text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {isLast ? "Get started" : "Next"}
            {!isLast && <ChevronRight className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
