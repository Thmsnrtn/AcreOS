import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
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
  { id: "team", title: "Invite Team", description: "Add your first team member", icon: Users },
  { id: "goals", title: "Investment Goals", description: "Set your target acquisition strategy", icon: Target },
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
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [step, setStep] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [selectedGoals, setSelectedGoals] = useState<string[]>([]);
  const [targetAcreage, setTargetAcreage] = useState("");
  const [targetBudgetK, setTargetBudgetK] = useState("");

  const completeMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/onboarding/complete", {
      orgName,
      inviteEmails: inviteEmail ? [inviteEmail] : [],
      goals: selectedGoals,
      targetAcreage: parseInt(targetAcreage) || null,
      targetBudgetCents: parseInt(targetBudgetK) * 100000 || null,
    }),
    onSuccess: () => {
      toast({ title: "Setup complete! Welcome to AcreOS." });
      qc.invalidateQueries();
      setLocation("/dashboard");
    },
    onError: () => toast({ title: "Setup failed. Please try again.", variant: "destructive" }),
  });

  const progress = ((step) / STEPS.length) * 100;
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Welcome to AcreOS</h1>
          <p className="text-muted-foreground text-sm mt-1">Let's get your account set up in a few steps.</p>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Step {step + 1} of {STEPS.length}</span>
            <span>{Math.round(progress)}% complete</span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        <div className="flex gap-2 justify-center">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={s.id}
                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
                  i === step ? "bg-primary text-primary-foreground" :
                  i < step ? "bg-green-100 text-green-700" :
                  "bg-muted text-muted-foreground"
                }`}
              >
                {i < step ? <CheckCircle2 className="w-3 h-3" /> : <Icon className="w-3 h-3" />}
                {s.title}
              </div>
            );
          })}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{currentStep.title}</CardTitle>
            <CardDescription>{currentStep.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {step === 0 && (
              <div>
                <Label>Organization Name</Label>
                <Input
                  placeholder="e.g. Lone Star Land Investments"
                  value={orgName}
                  onChange={e => setOrgName(e.target.value)}
                  className="mt-1"
                />
              </div>
            )}

            {step === 1 && (
              <div>
                <Label>Team Member Email (optional)</Label>
                <Input
                  type="email"
                  placeholder="colleague@example.com"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">You can invite more team members later from Settings.</p>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs">Investment Strategy (select all that apply)</Label>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    {INVESTMENT_GOALS.map(goal => (
                      <button
                        key={goal}
                        onClick={() => toggleGoal(goal)}
                        className={`text-left text-xs p-2 rounded border transition-colors ${
                          selectedGoals.includes(goal)
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/50"
                        }`}
                      >
                        {selectedGoals.includes(goal) && <CheckCircle2 className="w-3 h-3 inline mr-1 text-primary" />}
                        {goal}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Target Acreage / Deal</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 40"
                      value={targetAcreage}
                      onChange={e => setTargetAcreage(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Budget per Deal ($K)</Label>
                    <Input
                      type="number"
                      placeholder="e.g. 50"
                      value={targetBudgetK}
                      onChange={e => setTargetBudgetK(e.target.value)}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Connect integrations to supercharge your workflow.</p>
                {["County Records", "Google Maps", "MailGun Email", "Twilio SMS"].map(integration => (
                  <div key={integration} className="flex items-center justify-between p-2 border rounded">
                    <span className="text-sm">{integration}</span>
                    <Badge variant="outline" className="text-xs">Configure in Settings</Badge>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                disabled={step === 0}
                onClick={() => setStep(s => s - 1)}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button disabled={!canAdvance()} onClick={() => setStep(s => s + 1)}>
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              ) : (
                <Button
                  disabled={completeMutation.isPending}
                  onClick={() => completeMutation.mutate()}
                >
                  {completeMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin mr-2" />Setting up...</>
                  ) : (
                    "Complete Setup"
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
