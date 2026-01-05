import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

const STORAGE_KEY = "acreos_onboarding";

export type OnboardingStep = 
  | "welcome"
  | "import_leads"
  | "add_property"
  | "connect_integrations"
  | "create_campaign"
  | "complete";

export type BusinessType = "land_flipper" | "note_investor" | "hybrid";

export interface LocalOnboardingState {
  currentStep: number;
  completedSteps: number[];
  skippedSteps: number[];
  businessType?: BusinessType;
  dismissed: boolean;
  dontShowAgain: boolean;
}

export interface OnboardingStatus {
  completed: boolean;
  currentStep: number;
  data: {
    businessType?: BusinessType;
    organizationName?: string;
    communicationChannels?: string[];
    dataImported?: boolean;
    propertyAdded?: boolean;
    integrationsConnected?: boolean;
    campaignCreated?: boolean;
    completedSteps?: number[];
    skippedSteps?: number[];
  };
  totalSteps: number;
}

const DEFAULT_STATE: LocalOnboardingState = {
  currentStep: 0,
  completedSteps: [],
  skippedSteps: [],
  dismissed: false,
  dontShowAgain: false,
};

export const ONBOARDING_STEPS = [
  { id: 0, name: "welcome", title: "Welcome" },
  { id: 1, name: "import_leads", title: "Import Leads" },
  { id: 2, name: "add_property", title: "Add Property" },
  { id: 3, name: "connect_integrations", title: "Connect Integrations" },
  { id: 4, name: "create_campaign", title: "Create Campaign" },
  { id: 5, name: "complete", title: "Complete" },
];

function getLocalState(): LocalOnboardingState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...DEFAULT_STATE, ...JSON.parse(stored) };
    }
  } catch (error) {
    console.error("Error reading onboarding state from localStorage:", error);
  }
  return DEFAULT_STATE;
}

function setLocalState(state: Partial<LocalOnboardingState>): void {
  try {
    const current = getLocalState();
    const updated = { ...current, ...state };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (error) {
    console.error("Error saving onboarding state to localStorage:", error);
  }
}

export function useOnboarding() {
  const [localState, setLocalStateInternal] = useState<LocalOnboardingState>(getLocalState);

  const { data: serverStatus, isLoading, refetch } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
  });

  const completeOnboardingMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/complete", {});
      if (!res.ok) throw new Error("Failed to complete onboarding");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: async ({ step, data, skipped }: { step: number; data?: any; skipped?: boolean }) => {
      const res = await apiRequest("PUT", "/api/onboarding/step", { step, data, skipped });
      if (!res.ok) throw new Error("Failed to update step");
      return res.json();
    },
    onSuccess: () => {
      refetch();
    },
  });

  useEffect(() => {
    if (serverStatus) {
      const newState: Partial<LocalOnboardingState> = {
        currentStep: serverStatus.currentStep,
        completedSteps: serverStatus.data.completedSteps || [],
        skippedSteps: serverStatus.data.skippedSteps || [],
        businessType: serverStatus.data.businessType,
      };
      setLocalState(newState);
      setLocalStateInternal(prev => ({ ...prev, ...newState }));
    }
  }, [serverStatus]);

  const isComplete = serverStatus?.completed ?? false;
  const currentStep = localState.currentStep;
  const totalSteps = ONBOARDING_STEPS.length;

  const completeStep = useCallback(async (step: number, data?: any) => {
    const newCompletedSteps = [...localState.completedSteps];
    if (!newCompletedSteps.includes(step)) {
      newCompletedSteps.push(step);
    }
    
    const newStep = Math.min(step + 1, totalSteps - 1);
    
    setLocalState({
      currentStep: newStep,
      completedSteps: newCompletedSteps,
    });
    setLocalStateInternal(prev => ({
      ...prev,
      currentStep: newStep,
      completedSteps: newCompletedSteps,
    }));

    await updateStepMutation.mutateAsync({ step, data });
  }, [localState.completedSteps, totalSteps, updateStepMutation]);

  const skipStep = useCallback(async (step: number) => {
    const newSkippedSteps = [...localState.skippedSteps];
    if (!newSkippedSteps.includes(step)) {
      newSkippedSteps.push(step);
    }
    
    const newStep = Math.min(step + 1, totalSteps - 1);
    
    setLocalState({
      currentStep: newStep,
      skippedSteps: newSkippedSteps,
    });
    setLocalStateInternal(prev => ({
      ...prev,
      currentStep: newStep,
      skippedSteps: newSkippedSteps,
    }));

    await updateStepMutation.mutateAsync({ step, skipped: true });
  }, [localState.skippedSteps, totalSteps, updateStepMutation]);

  const goToStep = useCallback((step: number) => {
    if (step >= 0 && step < totalSteps) {
      setLocalState({ currentStep: step });
      setLocalStateInternal(prev => ({ ...prev, currentStep: step }));
    }
  }, [totalSteps]);

  const skipOnboarding = useCallback(async (dontShowAgain: boolean = false) => {
    setLocalState({ dismissed: true, dontShowAgain });
    setLocalStateInternal(prev => ({ ...prev, dismissed: true, dontShowAgain }));
    
    if (dontShowAgain) {
      await completeOnboardingMutation.mutateAsync();
    }
  }, [completeOnboardingMutation]);

  const finishOnboarding = useCallback(async () => {
    await completeOnboardingMutation.mutateAsync();
    setLocalState({ dismissed: true });
    setLocalStateInternal(prev => ({ ...prev, dismissed: true }));
  }, [completeOnboardingMutation]);

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setLocalStateInternal(DEFAULT_STATE);
  }, []);

  const shouldShowWizard = !isLoading && !isComplete && !localState.dismissed && !localState.dontShowAgain;

  return {
    isComplete,
    isLoading,
    currentStep,
    totalSteps,
    completedSteps: localState.completedSteps,
    skippedSteps: localState.skippedSteps,
    businessType: localState.businessType,
    shouldShowWizard,
    serverStatus,
    completeStep,
    skipStep,
    goToStep,
    skipOnboarding,
    finishOnboarding,
    resetOnboarding,
    refetch,
    isPending: updateStepMutation.isPending || completeOnboardingMutation.isPending,
  };
}
