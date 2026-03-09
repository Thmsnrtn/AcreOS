/**
 * T112 — Onboarding Checklist Component
 *
 * Shown on the Dashboard for new users (< 14 days old or < 5 leads).
 * Tracks setup milestones: profile, first lead, first campaign, etc.
 * Persists progress to localStorage (no server round-trip needed).
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Link } from "wouter";
import { CheckCircle2, Circle, X, Rocket, ChevronRight } from "lucide-react";

interface ChecklistStep {
  id: string;
  label: string;
  description: string;
  href: string;
  checkFn?: (data: any) => boolean;
}

const STEPS: ChecklistStep[] = [
  {
    id: "profile",
    label: "Complete your profile",
    description: "Add your name, company, and contact info",
    href: "/settings",
  },
  {
    id: "first_lead",
    label: "Import or add your first lead",
    description: "Add a landowner you want to contact",
    href: "/leads",
    checkFn: (data) => (data?.totalLeads ?? 0) >= 1,
  },
  {
    id: "first_campaign",
    label: "Create a campaign",
    description: "Set up a direct mail or email sequence",
    href: "/campaigns",
    checkFn: (data) => (data?.totalCampaigns ?? 0) >= 1,
  },
  {
    id: "first_property",
    label: "Add a property",
    description: "Add a parcel to your inventory",
    href: "/properties",
    checkFn: (data) => (data?.totalProperties ?? 0) >= 1,
  },
  {
    id: "explore_atlas",
    label: "Chat with Atlas AI",
    description: "Your AI assistant for deal analysis and research",
    href: "/atlas",
  },
  {
    id: "setup_integrations",
    label: "Connect integrations",
    description: "Add Stripe, Twilio, SendGrid for full functionality",
    href: "/settings#integrations",
  },
  {
    id: "explore_avm",
    label: "Run a valuation",
    description: "Get an AcreOS Market Value™ estimate on a property",
    href: "/avm",
  },
];

const LS_KEY = "acreos_onboarding_dismissed";
const LS_CHECKED_KEY = "acreos_onboarding_checked";

export function OnboardingChecklist() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(LS_KEY) === "true");
  const [manualChecked, setManualChecked] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(LS_CHECKED_KEY);
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const { data: dashData } = useQuery({
    queryKey: ["/api/dashboard/stats"],
    enabled: !dismissed,
  });

  const toggleManualCheck = (id: string) => {
    setManualChecked(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem(LS_CHECKED_KEY, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const isChecked = (step: ChecklistStep): boolean => {
    if (manualChecked.has(step.id)) return true;
    if (step.checkFn && dashData) return step.checkFn(dashData);
    return false;
  };

  const completedCount = STEPS.filter(s => isChecked(s)).length;
  const pct = Math.round((completedCount / STEPS.length) * 100);

  if (dismissed || completedCount === STEPS.length) return null;

  return (
    <Card className="border-primary/30 bg-primary/5 dark:bg-primary/10">
      <CardHeader className="pb-3 flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Rocket className="w-4 h-4 text-primary" /> Getting Started
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            {completedCount}/{STEPS.length} steps complete
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground"
          onClick={() => {
            setDismissed(true);
            localStorage.setItem(LS_KEY, "true");
          }}
        >
          <X className="w-4 h-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={pct} className="h-1.5" />
        <div className="space-y-1.5">
          {STEPS.map(step => {
            const done = isChecked(step);
            return (
              <div
                key={step.id}
                className={`flex items-center gap-2.5 rounded-lg p-2 transition-colors ${done ? "opacity-50" : "hover:bg-background/50"}`}
              >
                <button
                  onClick={() => toggleManualCheck(step.id)}
                  className="shrink-0"
                  aria-label={done ? "Mark incomplete" : "Mark complete"}
                >
                  {done ? (
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                  ) : (
                    <Circle className="w-4 h-4 text-muted-foreground/50" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-medium ${done ? "line-through text-muted-foreground" : ""}`}>
                    {step.label}
                  </div>
                  <div className="text-xs text-muted-foreground">{step.description}</div>
                </div>
                {!done && (
                  <Link href={step.href}>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0">
                      Go <ChevronRight className="w-3 h-3 ml-0.5" />
                    </Button>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
