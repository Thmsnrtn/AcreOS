import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import { 
  Sparkles, 
  ArrowRight, 
  ArrowLeft,
  Map, 
  FileText, 
  Upload,
  CreditCard,
  Mail,
  CheckCircle2,
  PartyPopper,
  Lightbulb,
  Loader2,
  SkipForward,
  Building2,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type BusinessType = "land_flipper" | "note_investor" | "hybrid";

type OnboardingStatus = {
  completed: boolean;
  currentStep: number;
  data: {
    businessType?: BusinessType;
    dataImported?: boolean;
    stripeConnected?: boolean;
    campaignCreated?: boolean;
    completedSteps?: number[];
    skippedSteps?: number[];
    aiTips?: string[];
  };
  totalSteps: number;
};

const WIZARD_STEPS = [
  {
    id: 0,
    name: "welcome",
    title: "Welcome to AcreOS",
    description: "Let's set up your land investment business. First, tell us about your focus.",
    icon: Sparkles,
  },
  {
    id: 1,
    name: "import",
    title: "Import Your Data",
    description: "Bring in your existing leads and properties to hit the ground running.",
    icon: Upload,
  },
  {
    id: 2,
    name: "connect",
    title: "Connect Services",
    description: "Link payment processing for seller-financed notes.",
    icon: CreditCard,
  },
  {
    id: 3,
    name: "campaign",
    title: "Your First Campaign",
    description: "Review the campaign templates we've created based on your business type.",
    icon: Mail,
  },
  {
    id: 4,
    name: "review",
    title: "You're All Set!",
    description: "Review your setup and launch your land investment business.",
    icon: CheckCircle2,
  },
];

export function OnboardingWizard() {
  const { data: organization, isLoading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [businessType, setBusinessType] = useState<BusinessType>("land_flipper");
  const [tips, setTips] = useState<string[]>([]);
  const [showTips, setShowTips] = useState(false);

  const { data: onboardingStatus, refetch: refetchStatus } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
    enabled: !!organization && !orgLoading,
  });

  useEffect(() => {
    if (!orgLoading && organization && onboardingStatus) {
      if (!onboardingStatus.completed) {
        setOpen(true);
        setCurrentStep(onboardingStatus.currentStep);
        if (onboardingStatus.data.businessType) {
          setBusinessType(onboardingStatus.data.businessType);
        }
      }
    }
  }, [organization, orgLoading, onboardingStatus]);

  const tipsMutation = useMutation({
    mutationFn: async (step: number) => {
      const res = await apiRequest("POST", "/api/onboarding/tips", { step });
      if (!res.ok) throw new Error("Failed to get tips");
      return res.json();
    },
    onSuccess: (data) => {
      setTips(data.tips || []);
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: async ({ step, data, skipped }: { step: number; data?: any; skipped?: boolean }) => {
      const res = await apiRequest("PUT", "/api/onboarding/step", { step, data, skipped });
      if (!res.ok) throw new Error("Failed to update step");
      return res.json();
    },
    onSuccess: () => {
      refetchStatus();
    },
  });

  const provisionMutation = useMutation({
    mutationFn: async (businessType: BusinessType) => {
      const res = await apiRequest("POST", "/api/onboarding/provision", { businessType });
      if (!res.ok) throw new Error("Failed to provision templates");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Templates created!",
        description: `Created ${data.provisioned.campaigns} campaign templates and default tags.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/complete", {});
      if (!res.ok) throw new Error("Failed to complete onboarding");
      return res.json();
    },
    onSuccess: () => {
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      toast({
        title: "Welcome aboard!",
        description: "Your account is set up and ready to go.",
      });
    },
  });

  const handleNext = async () => {
    if (currentStep === 0 && businessType) {
      await provisionMutation.mutateAsync(businessType);
      await updateStepMutation.mutateAsync({ 
        step: currentStep, 
        data: { businessType } 
      });
    } else {
      await updateStepMutation.mutateAsync({ step: currentStep });
    }
    
    if (currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
      tipsMutation.mutate(currentStep + 1);
    } else {
      await completeMutation.mutateAsync();
    }
  };

  const handleSkip = async () => {
    await updateStepMutation.mutateAsync({ step: currentStep, skipped: true });
    
    if (currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
      tipsMutation.mutate(currentStep + 1);
    } else {
      await completeMutation.mutateAsync();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      tipsMutation.mutate(currentStep - 1);
    }
  };

  const handleDismiss = async () => {
    await completeMutation.mutateAsync();
  };

  const isPending = updateStepMutation.isPending || provisionMutation.isPending || completeMutation.isPending;
  const step = WIZARD_STEPS[currentStep];
  const StepIcon = step.icon;
  const isLastStep = currentStep === WIZARD_STEPS.length - 1;
  const progress = ((currentStep + 1) / WIZARD_STEPS.length) * 100;

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              What type of land investing are you focused on?
            </p>
            <RadioGroup
              value={businessType}
              onValueChange={(value) => setBusinessType(value as BusinessType)}
              className="grid gap-3"
            >
              <Label
                htmlFor="land_flipper"
                className={`flex items-start gap-4 p-4 rounded-md border cursor-pointer hover-elevate transition-colors ${
                  businessType === "land_flipper" ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <RadioGroupItem value="land_flipper" id="land_flipper" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Map className="w-4 h-4 text-primary" />
                    <span className="font-medium">Land Flipper</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Buy land at wholesale prices and resell for cash or with terms. Focus on acquisitions, due diligence, and marketing.
                  </p>
                </div>
              </Label>
              
              <Label
                htmlFor="note_investor"
                className={`flex items-start gap-4 p-4 rounded-md border cursor-pointer hover-elevate transition-colors ${
                  businessType === "note_investor" ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <RadioGroupItem value="note_investor" id="note_investor" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-primary" />
                    <span className="font-medium">Note Investor</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Seller-finance land sales and manage payment collection. Focus on notes, amortization, and borrower communication.
                  </p>
                </div>
              </Label>
              
              <Label
                htmlFor="hybrid"
                className={`flex items-start gap-4 p-4 rounded-md border cursor-pointer hover-elevate transition-colors ${
                  businessType === "hybrid" ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <RadioGroupItem value="hybrid" id="hybrid" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 className="w-4 h-4 text-primary" />
                    <span className="font-medium">Hybrid</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Both cash flips and seller-financed deals. Get all the tools for complete land investment operations.
                  </p>
                </div>
              </Label>
            </RadioGroup>
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              Have existing leads or properties? Import them now to get started faster.
            </p>
            <div className="grid gap-3">
              <Card className="hover-elevate cursor-pointer" onClick={() => window.open("/leads?import=true", "_blank")}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <Upload className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Import Leads</p>
                    <p className="text-sm text-muted-foreground">Upload a CSV of your seller or buyer leads</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </CardContent>
              </Card>
              
              <Card className="hover-elevate cursor-pointer" onClick={() => window.open("/properties?import=true", "_blank")}>
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                    <Map className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">Import Properties</p>
                    <p className="text-sm text-muted-foreground">Upload a CSV of your property inventory</p>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </div>
            <p className="text-xs text-center text-muted-foreground">
              You can always import data later from the Leads or Properties pages.
            </p>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              Connect payment processing to collect payments on seller-financed notes.
            </p>
            <Card className="hover-elevate cursor-pointer" onClick={() => window.open("/settings#stripe", "_blank")}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                  <CreditCard className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Connect Stripe</p>
                  <p className="text-sm text-muted-foreground">Accept credit card and ACH payments</p>
                </div>
                <Badge variant="outline">Recommended</Badge>
              </CardContent>
            </Card>
            <p className="text-xs text-center text-muted-foreground">
              Skip this step if you only do cash flips. You can connect later from Settings.
            </p>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              We've created campaign templates based on your business type. Review and customize them.
            </p>
            <Card className="hover-elevate cursor-pointer" onClick={() => window.open("/campaigns", "_blank")}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                  <Mail className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">View Campaigns</p>
                  <p className="text-sm text-muted-foreground">
                    {businessType === "land_flipper" && "Acquisition mailer and follow-up sequence ready"}
                    {businessType === "note_investor" && "Payment reminder templates configured"}
                    {businessType === "hybrid" && "Full campaign suite created for you"}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
            <div className="flex flex-wrap gap-2 justify-center">
              <Badge variant="secondary">Direct Mail</Badge>
              <Badge variant="secondary">Email Sequences</Badge>
              <Badge variant="secondary">Follow-ups</Badge>
            </div>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center"
            >
              <PartyPopper className="w-10 h-10 text-primary" />
            </motion.div>
            <div>
              <h3 className="text-xl font-semibold mb-2">Congratulations!</h3>
              <p className="text-muted-foreground">
                Your AcreOS account is configured and ready for action.
              </p>
            </div>
            <div className="grid gap-2 text-left">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>Business type: <strong className="capitalize">{businessType?.replace("_", " ")}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>Campaign templates created</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>Default settings configured</span>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  if (orgLoading || !organization) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-onboarding-wizard">
        <DialogHeader>
          <div className="flex items-center justify-between mb-2">
            <Badge variant="outline" className="text-xs">
              Step {currentStep + 1} of {WIZARD_STEPS.length}
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowTips(!showTips)}
              className="toggle-elevate"
              data-testid="button-toggle-tips"
            >
              <Lightbulb className={`w-4 h-4 ${showTips ? "text-yellow-500" : "text-muted-foreground"}`} />
            </Button>
          </div>
          
          <Progress value={progress} className="h-1.5 mb-4" />
          
          <div className="flex items-center justify-center mb-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center"
              >
                <StepIcon className="w-7 h-7 text-primary" />
              </motion.div>
            </AnimatePresence>
          </div>
          
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <DialogTitle className="text-center text-xl" data-testid="text-wizard-title">
                {step.title}
              </DialogTitle>
              <DialogDescription className="text-center mt-1">
                {step.description}
              </DialogDescription>
            </motion.div>
          </AnimatePresence>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {showTips && tips.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-yellow-500/10 border border-yellow-500/20 rounded-md p-3 mb-4"
            >
              <div className="flex items-start gap-2">
                <Sparkles className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="space-y-1.5">
                  {tips.map((tip, i) => (
                    <p key={i} className="text-sm text-muted-foreground">{tip}</p>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ duration: 0.2, delay: 0.1 }}
            className="py-2"
          >
            {renderStepContent()}
          </motion.div>
        </AnimatePresence>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between mt-4 pb-4 sm:pb-0">
          <div className="flex gap-2">
            {currentStep > 0 && (
              <Button
                variant="outline"
                onClick={handleBack}
                disabled={isPending}
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
            {currentStep > 0 && currentStep < WIZARD_STEPS.length - 1 && (
              <Button
                variant="ghost"
                onClick={handleSkip}
                disabled={isPending}
                data-testid="button-skip"
              >
                <SkipForward className="w-4 h-4 mr-2" />
                Skip
              </Button>
            )}
          </div>
          
          <div className="flex gap-2">
            {currentStep === 0 && (
              <Button
                variant="ghost"
                onClick={handleDismiss}
                disabled={isPending}
                data-testid="button-dismiss"
              >
                <X className="w-4 h-4 mr-2" />
                Skip Setup
              </Button>
            )}
            <Button
              onClick={handleNext}
              disabled={isPending || (currentStep === 0 && !businessType)}
              data-testid="button-next"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              {isLastStep ? "Launch Dashboard" : "Continue"}
              {!isLastStep && <ArrowRight className="w-4 h-4 ml-2" />}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
