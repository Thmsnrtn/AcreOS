import { useState, useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/queryClient";
import { CheckCircle2, ChevronRight, ChevronLeft, Building2, Users, Target, Zap, Loader2 } from "lucide-react";
import { useLocation } from "wouter";

interface Step {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
}

const STEPS: Step[] = [
  { id: "org", title: "Organization", description: "Name your organization", icon: Building2 },
  { id: "team", title: "Invite team", description: "Add your first team member", icon: Users },
  { id: "goals", title: "Investment goals", description: "Set your target acquisition strategy", icon: Target },
  { id: "integrations", title: "Integrations", description: "Connect your data sources", icon: Zap },
];

const INVESTMENT_GOALS = [
  "Wholesale land flipping",
  "Long-term land holds",
  "Subdivision development",
  "Agricultural land",
  "Recreational/hunting properties",
  "Commercial land",
];

export default function OnboardingWizardPage() {
  useDocumentTitle("Welcome to AcreOS");
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [targetAcreage, setTargetAcreage] = useState("");
  const [targetBudgetK, setTargetBudgetK] = useState("");

  const orgId = useId();
  const inviteId = useId();
  const acreageId = useId();
  const budgetId = useId();

  const completeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/onboarding/complete", {
      orgName,
      inviteEmails: inviteEmail ? [inviteEmail] : [],
      goals: selectedGoals,
      targetAcreage: parseInt(targetAcreage) || null,
      targetBudgetCents: parseInt(targetBudgetK) * 100000 || null,
    }),
    onSuccess: () => {
      toast({ title: "Setup complete!", description: "Welcome to AcreOS." });
      qc.invalidateQueries();
      setLocation("/dashboard");
    },
    onError: () =>
      toast({
        title: "Setup didn't finish",
        description: "Your inputs are still here — try again. Nothing about your account has changed yet.",
        variant: "destructive",
      }),
  });

  const progress = (step / STEPS.length) * 100;
  const currentStep = STEPS[step];

  const toggleGoal = (goal: string) => {
    setSelectedGoals(prev =>
      prev.includes(goal) ? prev.filter(g => g !== goal) : [...prev, goal]
    );
  };

  const canAdvance = () => {
    if (step === 0) return orgName.trim().length > 0;
    return true;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) {
      if (canAdvance()) setStep(s => s + 1);
    } else {
      completeMutation.mutate();
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to AcreOS</h1>
          <p className="text-muted-foreground text-sm mt-1">Let's get your account set up in a few steps.</p>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Step <span className="tabular-nums">{step + 1}</span> of <span className="tabular-nums">{STEPS.length}</span></span>
            <span className="tabular-nums">{Math.round(progress)}% complete</span>
          </div>
          <Progress
            value={progress}
            className="h-1.5"
            aria-label={`Onboarding progress: step ${step + 1} of ${STEPS.length}`}
          />
        </div>

        <ol className="flex gap-2 justify-center flex-wrap" aria-label="Onboarding steps">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const isCurrent = i === step;
            const isDone = i < step;
            return (
              <li
                key={s.id}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
                  isCurrent ? "bg-primary text-primary-foreground" :
                  isDone ? "bg-green-100 text-green-700" :
                  "bg-muted text-muted-foreground"
                }`}
              >
                {isDone
                  ? <CheckCircle2 className="w-3 h-3" aria-label="Completed" />
                  : <Icon className="w-3 h-3" aria-hidden="true" />}
                {s.title}
              </li>
            );
          })}
        </ol>

        <Card>
          <CardHeader>
            <CardTitle>{currentStep.title}</CardTitle>
            <CardDescription>{currentStep.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              {step === 0 && (
                <div>
                  <Label htmlFor={orgId}>Organization name</Label>
                  <Input
                    id={orgId}
                    placeholder="e.g. Lone Star Land Investments"
                    value={orgName}
                    onChange={e => setOrgName(e.target.value)}
                    className="mt-1"
                    autoCapitalize="words"
                    autoComplete="organization"
                    autoFocus
                    required
                  />
                </div>
              )}

              {step === 1 && (
                <div>
                  <Label htmlFor={inviteId}>Team member email <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    id={inviteId}
                    type="email"
                    placeholder="colleague@example.com"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    className="mt-1"
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect="off"
                    inputMode="email"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground mt-1">You can invite more team members later from Settings.</p>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-3">
                  <fieldset>
                    <legend className="text-xs font-medium">Investment strategy <span className="text-muted-foreground font-normal">(select all that apply)</span></legend>
                    <ul className="grid grid-cols-2 gap-2 mt-2" role="group" aria-label="Investment strategies">
                      {INVESTMENT_GOALS.map(goal => {
                        const selected = selectedGoals.includes(goal);
                        return (
                          <li key={goal}>
                            <button
                              type="button"
                              onClick={() => toggleGoal(goal)}
                              aria-pressed={selected}
                              className={`w-full text-left text-xs p-2 rounded border transition-colors min-h-9 ${
                                selected
                                  ? "border-primary bg-primary/10"
                                  : "border-border hover:border-primary/50"
                              }`}
                            >
                              {selected && <CheckCircle2 className="w-3 h-3 inline mr-1 text-primary" aria-hidden="true" />}
                              {goal}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </fieldset>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label htmlFor={acreageId} className="text-xs">Target acreage / deal</Label>
                      <Input
                        id={acreageId}
                        type="number"
                        placeholder="e.g. 40"
                        value={targetAcreage}
                        onChange={e => setTargetAcreage(e.target.value)}
                        className="mt-1 tabular-nums"
                        inputMode="numeric"
                        min={0}
                      />
                    </div>
                    <div>
                      <Label htmlFor={budgetId} className="text-xs">Budget per deal <span className="text-muted-foreground">($K, e.g. 50 = $50,000)</span></Label>
                      <Input
                        id={budgetId}
                        type="number"
                        placeholder="e.g. 50"
                        value={targetBudgetK}
                        onChange={e => setTargetBudgetK(e.target.value)}
                        className="mt-1 tabular-nums"
                        inputMode="numeric"
                        min={0}
                      />
                    </div>
                  </div>
                </div>
              )}

              {step === 3 && (
                <ul className="space-y-2" aria-label="Available integrations">
                  <li className="text-sm text-muted-foreground -mt-2">Connect integrations to supercharge your workflow.</li>
                  {["County records", "Google Maps", "MailGun email", "Twilio SMS"].map(integration => (
                    <li key={integration} className="flex items-center justify-between p-2 border rounded">
                      <span className="text-sm">{integration}</span>
                      <Badge variant="outline" className="text-xs">Configure in Settings</Badge>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex justify-between pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={step === 0}
                  onClick={() => setStep(s => s - 1)}
                  aria-label="Go back to previous step"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button type="submit" disabled={!canAdvance()} aria-label={`Continue to step ${step + 2}: ${STEPS[step + 1].title}`}>
                    Next <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
                  </Button>
                ) : (
                  <Button type="submit" disabled={completeMutation.isPending}>
                    {completeMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />Setting up…</>
                    ) : (
                      "Complete setup"
                    )}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
