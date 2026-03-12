/**
 * T39 — Interactive Product Tour for New Users
 *
 * 5-step guided tour that fires on first login:
 *   1. Add your first lead
 *   2. Enrich with property data
 *   3. Create a deal
 *   4. Ask Atlas a question
 *   5. See your pipeline
 *
 * Uses a lightweight custom implementation (no Shepherd.js dep needed).
 * Tour state is persisted to localStorage + server on completion.
 */

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { X, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

const TOUR_LS_KEY = "acreOS_tour_completed_v1";

export interface TourStep {
  id: string;
  title: string;
  description: string;
  targetSelector?: string; // CSS selector to highlight
  placement?: "top" | "bottom" | "left" | "right" | "center";
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
}

const DEFAULT_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome to AcreOS",
    description:
      "Let's take a quick tour so you can start finding and closing land deals faster. This will only take 2 minutes.",
    placement: "center",
  },
  {
    id: "add-lead",
    title: "Add Your First Lead",
    description:
      "Every deal starts with a lead. Click 'New Lead' to add a seller's name, contact info, and their property's APN. You can import lists of hundreds at once too.",
    targetSelector: "[data-tour='new-lead-btn']",
    placement: "bottom",
    action: { label: "Go to Leads", href: "/leads" },
  },
  {
    id: "enrich",
    title: "Enrich with Property Data",
    description:
      "Open any lead and click 'Enrich'. AcreOS pulls zoning, flood zone, soil data, comps, and AVM value automatically — in about 10 seconds.",
    targetSelector: "[data-tour='enrich-btn']",
    placement: "bottom",
  },
  {
    id: "create-deal",
    title: "Create a Deal",
    description:
      "When you're ready to make an offer, create a deal from the lead. Track offer amount, terms, seller financing, and the full due diligence checklist.",
    targetSelector: "[data-tour='new-deal-btn']",
    placement: "bottom",
    action: { label: "View Deals", href: "/deals" },
  },
  {
    id: "atlas",
    title: "Ask Atlas Anything",
    description:
      "Atlas is your AI deal partner. Ask it to analyze comps, draft an offer letter, calculate seller financing, or summarize your portfolio. It knows your active deals.",
    targetSelector: "[data-tour='atlas-btn']",
    placement: "top",
    action: { label: "Open Atlas", href: "/atlas" },
  },
  {
    id: "pipeline",
    title: "Watch Your Pipeline Fill",
    description:
      "Your dashboard shows pipeline velocity, offers expiring, leads going cold, and notes receivable — everything you need to run your business at a glance.",
    placement: "center",
    action: { label: "Go to Dashboard", href: "/" },
  },
];

interface TourTooltipProps {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  targetRect: DOMRect | null;
}

function TourTooltip({ step, stepIndex, totalSteps, onNext, onPrev, onSkip, targetRect }: TourTooltipProps) {
  const isCenter = step.placement === "center" || !targetRect;
  const isLast = stepIndex === totalSteps - 1;

  let tooltipStyle: React.CSSProperties = {};

  if (!isCenter && targetRect) {
    const OFFSET = 12;
    const TOOLTIP_W = 320;

    if (step.placement === "bottom") {
      tooltipStyle = {
        position: "fixed",
        top: targetRect.bottom + OFFSET,
        left: Math.max(12, Math.min(targetRect.left + targetRect.width / 2 - TOOLTIP_W / 2, window.innerWidth - TOOLTIP_W - 12)),
        width: TOOLTIP_W,
      };
    } else if (step.placement === "top") {
      tooltipStyle = {
        position: "fixed",
        bottom: window.innerHeight - targetRect.top + OFFSET,
        left: Math.max(12, Math.min(targetRect.left + targetRect.width / 2 - TOOLTIP_W / 2, window.innerWidth - TOOLTIP_W - 12)),
        width: TOOLTIP_W,
      };
    } else if (step.placement === "right") {
      tooltipStyle = {
        position: "fixed",
        top: targetRect.top + targetRect.height / 2 - 80,
        left: targetRect.right + OFFSET,
        width: TOOLTIP_W,
      };
    } else if (step.placement === "left") {
      tooltipStyle = {
        position: "fixed",
        top: targetRect.top + targetRect.height / 2 - 80,
        right: window.innerWidth - targetRect.left + OFFSET,
        width: TOOLTIP_W,
      };
    }
  }

  const content = (
    <div
      className={`z-[9999] bg-background border border-border rounded-xl shadow-xl p-5 ${isCenter ? "w-[380px]" : "w-[320px]"}`}
      style={!isCenter ? tooltipStyle : undefined}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-green-600 flex-shrink-0" />
          <h3 className="font-semibold text-sm">{step.title}</h3>
        </div>
        <button onClick={onSkip} className="text-muted-foreground hover:text-foreground transition-colors ml-2">
          <X className="h-4 w-4" />
        </button>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed mb-4">{step.description}</p>

      {step.action && (
        <div className="mb-3">
          {step.action.href ? (
            <a href={step.action.href}>
              <Button variant="outline" size="sm" className="w-full">
                {step.action.label}
              </Button>
            </a>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={step.action.onClick}>
              {step.action.label}
            </Button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-200 ${
                i === stepIndex ? "w-4 bg-green-600" : "w-1.5 bg-muted-foreground/30"
              }`}
            />
          ))}
        </div>

        <div className="flex gap-2">
          {stepIndex > 0 && (
            <Button variant="ghost" size="sm" onClick={onPrev} className="h-8 px-3">
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}
          <Button
            size="sm"
            className="h-8 px-4 bg-green-700 hover:bg-green-800 text-white"
            onClick={onNext}
          >
            {isLast ? "Done" : "Next"}
            {!isLast && <ChevronRight className="h-4 w-4 ml-1" />}
          </Button>
        </div>
      </div>
    </div>
  );

  if (isCenter) {
    return createPortal(
      <div className="fixed inset-0 z-[9998] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/30" onClick={onSkip} />
        <div className="relative">{content}</div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[9998] pointer-events-none">
      {/* Highlight box around target */}
      {targetRect && (
        <div
          className="absolute rounded-lg ring-2 ring-green-500 ring-offset-0 bg-green-500/10"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            pointerEvents: "none",
          }}
        />
      )}
      <div className="pointer-events-auto absolute" style={tooltipStyle}>
        {content}
      </div>
    </div>,
    document.body
  );
}

// ─── Main ProductTour component ───────────────────────────────────────────────

interface Props {
  steps?: TourStep[];
  autoStart?: boolean; // start automatically if tour not completed
  onComplete?: () => void;
}

export default function ProductTour({ steps = DEFAULT_STEPS, autoStart = true, onComplete }: Props) {
  const [isRunning, setIsRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const completeMutation = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", "/api/organizations/me", { tourCompleted: true }),
  });

  // Auto-start on first render if tour not completed
  useEffect(() => {
    if (!autoStart) return;
    const completed = localStorage.getItem(TOUR_LS_KEY);
    if (!completed) {
      setTimeout(() => setIsRunning(true), 1000); // small delay for page render
    }
  }, [autoStart]);

  // Update target rect when step changes
  useEffect(() => {
    if (!isRunning) return;
    const step = steps[stepIndex];
    if (!step.targetSelector) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(step.targetSelector);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setTargetRect(null);
    }
  }, [isRunning, stepIndex, steps]);

  const handleNext = () => {
    if (stepIndex >= steps.length - 1) {
      handleComplete();
    } else {
      setStepIndex(i => i + 1);
    }
  };

  const handlePrev = () => {
    setStepIndex(i => Math.max(0, i - 1));
  };

  const handleComplete = () => {
    setIsRunning(false);
    localStorage.setItem(TOUR_LS_KEY, "1");
    completeMutation.mutate();
    onComplete?.();
  };

  const handleSkip = () => {
    setIsRunning(false);
    localStorage.setItem(TOUR_LS_KEY, "1");
    completeMutation.mutate();
  };

  if (!isRunning) return null;

  return (
    <TourTooltip
      step={steps[stepIndex]}
      stepIndex={stepIndex}
      totalSteps={steps.length}
      onNext={handleNext}
      onPrev={handlePrev}
      onSkip={handleSkip}
      targetRect={targetRect}
    />
  );
}

export { DEFAULT_STEPS };
export type { TourStep as TourStepDef };
