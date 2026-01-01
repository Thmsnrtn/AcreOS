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
import { Sparkles, Map, Users, Handshake, Bell, ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const onboardingSteps = [
  {
    icon: Sparkles,
    title: "Welcome to AcreOS",
    description: "Your complete land investment management platform. Let's get you set up for success.",
    highlight: "We'll guide you through the key features to help you get started quickly.",
  },
  {
    icon: Users,
    title: "Manage Your Leads",
    description: "Track sellers and buyers in one place. Import leads from tax lists, referrals, or manual entry.",
    highlight: "Add your first lead to start building your pipeline.",
  },
  {
    icon: Map,
    title: "Track Your Properties",
    description: "Manage your entire inventory from prospect to sold. Track due diligence, listings, and closings.",
    highlight: "Create property listings with all the details buyers need.",
  },
  {
    icon: Handshake,
    title: "Close Deals",
    description: "Manage acquisitions and dispositions. Track offers, contracts, and closings in one workflow.",
    highlight: "Set up your first deal when you have a property under contract.",
  },
  {
    icon: Bell,
    title: "Stay Notified",
    description: "Configure notifications to stay on top of payments, lead responses, and important deadlines.",
    highlight: "Customize your notification preferences in settings.",
  },
];

export function OnboardingModal() {
  const { data: organization, isLoading } = useOrganization();
  const updateOrg = useUpdateOrganization();
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
                <StepIcon className="w-8 h-8 text-primary" />
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

        <div className="flex justify-center gap-1.5 py-2">
          {onboardingSteps.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentStep(index)}
              className={`w-2 h-2 rounded-full transition-all ${
                index === currentStep
                  ? "bg-primary w-6"
                  : index < currentStep
                  ? "bg-primary/50"
                  : "bg-muted-foreground/30"
              }`}
              data-testid={`button-step-${index}`}
            />
          ))}
        </div>

        <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            onClick={handleSkip}
            disabled={updateOrg.isPending}
            data-testid="button-skip-onboarding"
          >
            Skip
          </Button>
          <Button
            onClick={handleNext}
            disabled={updateOrg.isPending}
            data-testid="button-next-onboarding"
          >
            {isLastStep ? "Get Started" : "Next"}
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
