import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useOrganization, useUpdateOrganization } from "@/hooks/use-organization";
import { useBrandName } from "@/hooks/use-white-label";
import { Sparkles, Map, Users, Handshake, Bell, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

function buildOnboardingSteps(brandName: string) {
  return [
  {
    icon: Sparkles,
    title: `Welcome to ${brandName}`,
    description: "The AI-powered platform for Land Investors. Let's get you set up for success.",
    highlight: "We'll guide you through the key features to help you get started quickly.",
  },
  {
    icon: Users,
    title: "Manage your leads",
    description: "Track sellers and buyers in one place. Import leads from tax lists, referrals, or manual entry.",
    highlight: "Add your first lead to start building your pipeline.",
  },
  {
    icon: Map,
    title: "Track your properties",
    description: "Manage your entire inventory from prospect to sold. Track due diligence, listings, and closings.",
    highlight: "Create property listings with all the details buyers need.",
  },
  {
    icon: Handshake,
    title: "Close deals",
    description: "Manage acquisitions and dispositions. Track offers, contracts, and closings in one workflow.",
    highlight: "Set up your first deal when you have a property under contract.",
  },
  {
    icon: Bell,
    title: "Stay notified",
    description: "Configure notifications to stay on top of payments, lead responses, and important deadlines.",
    highlight: "Customize your notification preferences in settings.",
  },
  ] as const;
}

export function OnboardingModal() {
  const { data: organization, isLoading } = useOrganization();
  const updateOrg = useUpdateOrganization();
  const brandName = useBrandName();
  const onboardingSteps = buildOnboardingSteps(brandName);
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!isLoading && organization) {
      const settings = organization.settings as Record<string, unknown> | null;
      const hasCompletedOnboarding = settings?.onboardingCompleted === true;
      if (!hasCompletedOnboarding) {
        setOpen(true);
      }
    }
  }, [organization, isLoading]);

  const handleNext = () => {
    if (currentStep < onboardingSteps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleSkip = async () => {
    await updateOrg.mutateAsync({
      settings: {
        ...(organization?.settings || {}),
        onboardingCompleted: true,
        showTips: true,
      },
    });
    setOpen(false);
  };

  const handleComplete = async () => {
    await updateOrg.mutateAsync({
      settings: {
        ...(organization?.settings || {}),
        onboardingCompleted: true,
        showTips: true,
      },
    });
    setOpen(false);
  };

  const step = onboardingSteps[currentStep];
  const StepIcon = step.icon;
  const isLastStep = currentStep === onboardingSteps.length - 1;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-onboarding">
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center"
              >
                <StepIcon className="w-8 h-8 text-primary" aria-hidden="true" />
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
              <DialogTitle className="text-center text-xl" data-testid="text-onboarding-title">
                {step.title}
              </DialogTitle>
              <DialogDescription className="text-center mt-2">
                {step.description}
              </DialogDescription>
            </motion.div>
          </AnimatePresence>
        </DialogHeader>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ duration: 0.2, delay: 0.1 }}
            className="py-4"
          >
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm text-muted-foreground text-center">{step.highlight}</p>
            </div>
          </motion.div>
        </AnimatePresence>

        <div role="tablist" aria-label="Onboarding steps" className="flex justify-center gap-1.5 py-2">
          {onboardingSteps.map((s, index) => (
            <button
              key={index}
              type="button"
              role="tab"
              aria-selected={index === currentStep}
              aria-label={`Step ${index + 1} of ${onboardingSteps.length}: ${s.title}`}
              onClick={() => setCurrentStep(index)}
              className={`h-2 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                index === currentStep
                  ? "bg-primary w-6"
                  : index < currentStep
                  ? "bg-primary/50 w-2"
                  : "bg-muted-foreground/30 w-2"
              }`}
              data-testid={`button-step-${index}`}
            />
          ))}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={handleSkip}
            disabled={updateOrg.isPending}
            aria-busy={updateOrg.isPending}
            data-testid="button-skip-onboarding"
          >
            Skip
          </Button>
          <Button
            type="button"
            onClick={handleNext}
            disabled={updateOrg.isPending}
            aria-busy={updateOrg.isPending}
            data-testid="button-next-onboarding"
          >
            {isLastStep ? "Get started" : "Next"}
            <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
