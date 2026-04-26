import * as React from "react";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import {
  Sparkles,
  Upload,
  Mail,
  Target,
  PartyPopper,
  Loader2,
  SkipForward,
  X,
  Plus,
  Map,
  FileText,
  Building2,
  Check,
  Settings,
  Home,
  Hammer,
  Key,
  Landmark,
  Palmtree,
  Lightbulb,
  Receipt,
  Warehouse,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import "./onboarding.css";

type BusinessType =
  | "land_flipper"
  | "note_investor"
  | "hybrid"
  | "residential_wholesaler"
  | "fix_and_flip"
  | "buy_and_hold"
  | "commercial"
  | "short_term_rental"
  | "creative_finance"
  | "developer"
  | "tax_lien_deed"
  | "multifamily"
  | "mobile_home"
  | "agent_investor";

const INVESTOR_TYPES: { value: BusinessType; label: string; icon: LucideIcon; description: string }[] = [
  { value: "land_flipper", label: "Land Flipper", icon: Map, description: "Buy raw land at wholesale and resell for profit." },
  { value: "residential_wholesaler", label: "Residential Wholesaler", icon: Home, description: "Find distressed homes and assign contracts to cash buyers." },
  { value: "fix_and_flip", label: "Fix & Flip", icon: Hammer, description: "Acquire, renovate, and resell properties for profit." },
  { value: "buy_and_hold", label: "Buy & Hold", icon: Key, description: "Build a long-term rental portfolio for passive income." },
  { value: "short_term_rental", label: "Short-Term Rental", icon: Palmtree, description: "Acquire and manage Airbnb, VRBO, and vacation rentals." },
  { value: "multifamily", label: "Multifamily", icon: Building2, description: "Invest in apartment buildings and 5+ unit properties." },
  { value: "commercial", label: "Commercial", icon: Landmark, description: "Office, retail, industrial, and mixed-use investments." },
  { value: "creative_finance", label: "Creative Finance", icon: Lightbulb, description: "Subject-to, seller financing, wraps, and lease options." },
  { value: "note_investor", label: "Note Investor", icon: FileText, description: "Buy, sell, and service mortgage notes and seller-financed paper." },
  { value: "developer", label: "Developer / Subdivider", icon: Warehouse, description: "Land development, entitlements, subdivisions, and new construction." },
  { value: "tax_lien_deed", label: "Tax Lien / Tax Deed", icon: Receipt, description: "Purchase tax liens and tax deeds at county auctions." },
  { value: "mobile_home", label: "Mobile Home / MHP", icon: Truck, description: "Mobile home parks and manufactured housing investments." },
  { value: "agent_investor", label: "Agent-Investor", icon: Users, description: "Licensed agent who also invests — manage clients and your own deals." },
  { value: "hybrid", label: "Hybrid / Multi-Strategy", icon: Sparkles, description: "Combine multiple strategies — land, notes, rentals, and more." },
];

type OnboardingStatus = {
  completed: boolean;
  currentStep: number;
  data: {
    businessType?: BusinessType;
    organizationName?: string;
    dataImported?: boolean;
    emailConnected?: boolean;
    campaignCreated?: boolean;
    completedSteps?: number[];
    skippedSteps?: number[];
  };
  totalSteps: number;
};

const STORAGE_KEY = "acreos_onboarding_v3";

const WIZARD_STEPS = [
  {
    id: 0,
    name: "welcome",
    title: "Welcome to AcreOS",
    description: "The operating system for land investors",
    icon: Sparkles,
  },
  {
    id: 1,
    name: "import_leads",
    title: "Add Your First Leads",
    description: "Import from CSV or add a lead manually",
    icon: Upload,
  },
  {
    id: 2,
    name: "connect_email",
    title: "Connect Your Email",
    description: "Send campaigns directly from your inbox",
    icon: Mail,
  },
  {
    id: 3,
    name: "create_campaign",
    title: "Create Your First Campaign",
    description: "Start reaching out to motivated sellers",
    icon: Target,
  },
  {
    id: 4,
    name: "done",
    title: "You're All Set!",
    description: "Your AcreOS workspace is ready to go",
    icon: PartyPopper,
  },
];

function getLocalState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error("Error reading onboarding state:", error);
  }
  return null;
}

function setLocalState(state: any) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Error saving onboarding state:", error);
  }
}

export function OnboardingWizard() {
  const { data: organization, isLoading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [businessType, setBusinessType] = useState<BusinessType>("land_flipper");
  const [organizationName, setOrganizationName] = useState("");

  const { data: onboardingStatus, refetch: refetchStatus } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
    enabled: !!organization && !orgLoading,
  });

  useEffect(() => {
    if (!orgLoading && organization && onboardingStatus) {
      const localState = getLocalState();
      
      if (!onboardingStatus.completed) {
        if (localState?.dismissed && localState?.dontShowAgain) {
          return;
        }
        
        setOpen(true);
        setCurrentStep(localState?.currentStep ?? onboardingStatus.currentStep);
        
        if (onboardingStatus.data.businessType) {
          setBusinessType(onboardingStatus.data.businessType);
        }
        if (onboardingStatus.data.organizationName) {
          setOrganizationName(onboardingStatus.data.organizationName);
        } else if (organization.name) {
          setOrganizationName(organization.name);
        }
      }
    }
  }, [organization, orgLoading, onboardingStatus]);

  useEffect(() => {
    if (open) {
      setLocalState({ currentStep, dismissed: false });
    }
  }, [currentStep, open]);

  const completeStepMutation = useMutation({
    mutationFn: async ({ stepId, data }: { stepId: number; data?: any }) => {
      const res = await apiRequest("POST", "/api/onboarding/complete-step", { stepId, data });
      if (!res.ok) throw new Error("Failed to complete step");
      return res.json();
    },
    onSuccess: () => {
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
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
        description: `Created ${data.provisioned.campaigns} campaign templates based on your business type.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
    },
  });

  const loadSampleDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/sample-data", {});
      if (!res.ok) throw new Error("Failed to load sample data");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sample data loaded!",
        description: `Created ${data.counts.leads} leads, ${data.counts.properties} properties, and ${data.counts.deals} deals.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      completeStepMutation.mutate({ 
        stepId: currentStep, 
        data: { dataImported: true, sampleDataLoaded: true } 
      });
    },
    onError: (error) => {
      toast({
        title: "Couldn't load sample data",
        description: `${error.message || "No sample data was added"} — your workspace is unchanged.`,
        variant: "destructive",
      });
    },
  });

  const updateOrgMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("PATCH", "/api/organization", { name });
      if (!res.ok) throw new Error("Failed to update organization");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
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
      setLocalState({ dismissed: true, dontShowAgain: true });
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      toast({
        title: "Welcome aboard!",
        description: "Your account is set up and ready to go.",
      });
    },
  });

  const handleNext = async () => {
    try {
      if (currentStep === 0) {
        if (organizationName && organizationName !== organization?.name) {
          await updateOrgMutation.mutateAsync(organizationName);
        }
        if (businessType) {
          await provisionMutation.mutateAsync(businessType);
        }
        await completeStepMutation.mutateAsync({
          stepId: currentStep,
          data: { businessType, organizationName }
        });
      } else {
        await completeStepMutation.mutateAsync({ stepId: currentStep });
      }

      if (currentStep < WIZARD_STEPS.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        await completeMutation.mutateAsync();
      }
    } catch (error) {
      console.error("Error in handleNext:", error);
    }
  };

  const handleSkip = async () => {
    try {
      await completeStepMutation.mutateAsync({ stepId: currentStep, data: { skipped: true } });
      
      if (currentStep < WIZARD_STEPS.length - 1) {
        setCurrentStep(currentStep + 1);
      } else {
        await completeMutation.mutateAsync();
      }
    } catch (error) {
      console.error("Error in handleSkip:", error);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleDismiss = (dontShowAgain: boolean = false) => {
    setOpen(false);
    setLocalState({ dismissed: true, dontShowAgain, currentStep });
    
    if (dontShowAgain) {
      completeMutation.mutate();
    }
  };

  const handleGoToDashboard = async () => {
    await completeMutation.mutateAsync();
  };

  const isPending = completeStepMutation.isPending || provisionMutation.isPending ||
    completeMutation.isPending || updateOrgMutation.isPending ||
    loadSampleDataMutation.isPending;
  
  const step = WIZARD_STEPS[currentStep];
  const StepIcon = step.icon;
  const isLastStep = currentStep === WIZARD_STEPS.length - 1;
  const progress = ((currentStep + 1) / WIZARD_STEPS.length) * 100;

  const canContinue = () => {
    if (currentStep === 0) {
      return !!businessType && organizationName.trim().length > 0;
    }
    return true;
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            data-testid="onboarding-step-0"
          >
            <div className="ob-welcome">
              <div className="ob-eyebrow">
                <span className="ob-eyebrow-dot" aria-hidden="true" />
                Welcome to AcreOS
              </div>
              <h1 className="ob-welcome-title">
                <span className="ob-welcome-line">Glad you&rsquo;re here.</span>
                <span className="ob-welcome-line ob-welcome-line-2">
                  Let&rsquo;s get you set up.
                </span>
              </h1>
              <p className="ob-letter">
                Setup takes about a minute. We&rsquo;ll ask what you&rsquo;re
                building and what kind of investing you do — defaults are
                sensible, and everything is editable later.
              </p>
              <p className="ob-letter">
                When we&rsquo;re done, your workspace will be ready and the
                agents will know how to help.
              </p>
            </div>

            <div className="ob-field" style={{ marginTop: 32 }}>
              <label htmlFor="org-name" className="ob-label">
                Workspace name
              </label>
              <input
                id="org-name"
                className="ob-input"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="e.g. Apex Land Group"
                data-testid="input-org-name"
              />
              <p className="ob-hint">You can rename this anytime in Settings.</p>
            </div>

            <div className="ob-field">
              <span className="ob-label">What kind of investing do you do?</span>
              <RadioGroup
                value={businessType}
                onValueChange={(value) => setBusinessType(value as BusinessType)}
                className="ob-cards"
              >
                {INVESTOR_TYPES.map(({ value, label, icon: Icon, description }) => (
                  <label
                    key={value}
                    htmlFor={value}
                    className={`ob-card ${businessType === value ? "is-on" : ""}`}
                    data-testid={`option-${value}`}
                  >
                    <RadioGroupItem value={value} id={value} className="sr-only" />
                    <span className="ob-card-glyph">
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="ob-card-title">{label}</span>
                    <span className="ob-card-desc">{description}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          </motion.div>
        );

      case 1:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            data-testid="onboarding-step-1"
          >
            <div className="ob-eyebrow">
              <span className="ob-eyebrow-dot" aria-hidden="true" />
              Step 1 · Your first leads
            </div>
            <h1 className="ob-title">
              Bring something <span className="ob-title-italic">to look at.</span>
            </h1>
            <p className="ob-sub">
              Load a realistic sample dataset, import your own list, or add a
              single lead by hand. You can switch approaches anytime.
            </p>

            <div className="ob-cards">
              <button
                type="button"
                className="ob-card"
                onClick={() => loadSampleDataMutation.mutate()}
                data-testid="card-load-sample-data"
              >
                <span className="ob-card-glyph">
                  {loadSampleDataMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="w-4 h-4" aria-hidden="true" />
                  )}
                </span>
                <span className="ob-card-title">Load sample data</span>
                <span className="ob-card-desc">
                  Realistic leads, properties &amp; deals so you can explore
                  immediately.
                </span>
              </button>

              <button
                type="button"
                className="ob-card"
                onClick={() => window.open("/leads?action=import", "_blank")}
                data-testid="card-import-csv"
              >
                <span className="ob-card-glyph">
                  <Upload className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="ob-card-title">Import CSV</span>
                <span className="ob-card-desc">
                  Upload leads from a spreadsheet — opens in a new tab.
                </span>
              </button>

              <button
                type="button"
                className="ob-card"
                onClick={() => window.open("/leads?action=new", "_blank")}
                data-testid="card-add-lead"
              >
                <span className="ob-card-glyph">
                  <Plus className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="ob-card-title">Add one manually</span>
                <span className="ob-card-desc">
                  Type in a single lead — opens in a new tab.
                </span>
              </button>
            </div>
          </motion.div>
        );

      case 2:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            data-testid="onboarding-step-2"
          >
            <div className="ob-eyebrow">
              <span className="ob-eyebrow-dot" aria-hidden="true" />
              Step 2 · Send from your own inbox
            </div>
            <h1 className="ob-title">
              Connect <span className="ob-title-italic">your email.</span>
            </h1>
            <p className="ob-sub">
              Outreach lands in better shape when it leaves from your real
              address. Connect Gmail, Outlook, or any SMTP — replies come
              back to your inbox.
            </p>

            <div className="ob-cards">
              <button
                type="button"
                className="ob-card"
                onClick={() => window.open("/settings?tab=email", "_blank")}
                data-testid="card-connect-email"
              >
                <span className="ob-card-glyph">
                  <Settings className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="ob-card-title">Open email settings</span>
                <span className="ob-card-desc">
                  Gmail, Outlook, or custom SMTP — opens in a new tab.
                </span>
              </button>
            </div>

            <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 6 }}>
              {[
                "Emails sent from your own address",
                "Better inbox placement and open rates",
                "Replies land in your inbox automatically",
              ].map((label) => (
                <li
                  key={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    font: "400 13px/1.5 var(--font-sans)",
                    color: "var(--acr-ink-2)",
                  }}
                >
                  <Check className="w-4 h-4" style={{ color: "var(--acr-pos)" }} aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>

            <p className="ob-hint" style={{ marginTop: 16 }}>
              Optional — you can set this up later in Settings &rsaquo; Email.
            </p>
          </motion.div>
        );

      case 3:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            data-testid="onboarding-step-3"
          >
            <div className="ob-eyebrow">
              <span className="ob-eyebrow-dot" aria-hidden="true" />
              Step 3 · Reach the right sellers
            </div>
            <h1 className="ob-title">
              Your first <span className="ob-title-italic">campaign.</span>
            </h1>
            <p className="ob-sub">
              Pick a template, target leads by score, stage or location, and
              send. Direct mail, email, or SMS — Pax handles the orchestration.
            </p>

            <div className="ob-cards">
              <button
                type="button"
                className="ob-card"
                onClick={() => window.open("/campaigns", "_blank")}
                data-testid="card-create-campaign"
              >
                <span className="ob-card-glyph">
                  <Target className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="ob-card-title">Open Marketing Hub</span>
                <span className="ob-card-desc">
                  Build a direct mail, email, or SMS campaign — opens in a new tab.
                </span>
              </button>
            </div>

            <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 6 }}>
              {[
                "Pre-built templates for land investors",
                "Target leads by score, stage, or location",
                "Track open rates and responses",
              ].map((label) => (
                <li
                  key={label}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    font: "400 13px/1.5 var(--font-sans)",
                    color: "var(--acr-ink-2)",
                  }}
                >
                  <Check className="w-4 h-4" style={{ color: "var(--acr-pos)" }} aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>

            <p className="ob-hint" style={{ marginTop: 16 }}>
              You can build your first campaign now or skip and do it later.
            </p>
          </motion.div>
        );

      case 4:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            data-testid="onboarding-step-4"
          >
            <div className="ob-reveal">
              <div className="ob-reveal-icon">
                <PartyPopper className="w-8 h-8" aria-hidden="true" />
              </div>
              <h1 className="ob-reveal-title">You&rsquo;re all set.</h1>
              <p className="ob-reveal-sub">
                Your workspace is ready. Head to the dashboard — Pax and the
                agents already know how to help.
              </p>

              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: "0 auto",
                  maxWidth: 420,
                  display: "grid",
                  gap: 8,
                  textAlign: "left",
                }}
              >
                {[
                  { icon: Upload, label: "Leads added", done: true, optional: false },
                  { icon: Mail, label: "Email connected", done: false, optional: true },
                  { icon: Target, label: "First campaign", done: false, optional: true },
                ].map(({ icon: Icon, label, done, optional }) => (
                  <li
                    key={label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: done ? "var(--acr-pos-soft)" : "var(--acr-surface)",
                      border: "0.5px solid var(--acr-line)",
                    }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: done ? "var(--acr-pos)" : "var(--acr-bg-raised)",
                        color: done ? "var(--acr-brand-ink)" : "var(--acr-ink-3)",
                        flexShrink: 0,
                      }}
                    >
                      {done ? (
                        <Check className="w-4 h-4" aria-hidden="true" />
                      ) : (
                        <Icon className="w-4 h-4" aria-hidden="true" />
                      )}
                    </span>
                    <span
                      style={{
                        flex: 1,
                        font: `${done ? 600 : 400} 14px/1.4 var(--font-sans)`,
                        color: done ? "var(--acr-ink)" : "var(--acr-ink-2)",
                      }}
                    >
                      {label}
                    </span>
                    {optional && !done && (
                      <span
                        style={{
                          font: "500 11px/1 var(--font-sans)",
                          color: "var(--acr-ink-3)",
                          background: "var(--acr-surface-2)",
                          padding: "4px 8px",
                          borderRadius: 4,
                        }}
                      >
                        optional
                      </span>
                    )}
                  </li>
                ))}
              </ul>

              <p className="ob-hint" style={{ marginTop: 24, textAlign: "center" }}>
                You can complete the optional steps any time from the
                dashboard checklist.
              </p>
            </div>
          </motion.div>
        );

      default:
        return null;
    }
  };

  // Focus the close button when the wizard opens so keyboard users
  // can dismiss without tabbing through the whole flow.
  const closeBtnRef = React.useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open && closeBtnRef.current) {
      // Small delay so the dialog mounts + transitions complete before
      // focus moves — otherwise screen readers can miss the change.
      const t = setTimeout(() => closeBtnRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (orgLoading) return null;
  if (!open) return null;

  return (
    <div
      className="ob fixed inset-0 z-50 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="AcreOS onboarding"
      data-testid="onboarding-wizard"
    >
      <header className="ob-header">
        <div className="ob-logo">
          <span className="ob-logo-mark" aria-hidden="true">A</span>
          AcreOS
        </div>
        <button
          ref={closeBtnRef}
          type="button"
          className="ob-skip"
          onClick={() => handleDismiss(false)}
          aria-label="Close onboarding"
          data-testid="button-close-wizard"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>

      <div className="ob-progress" aria-label={`Step ${currentStep + 1} of ${WIZARD_STEPS.length}`}>
        {WIZARD_STEPS.map((s, idx) => (
          <div
            key={s.id}
            className={`ob-progress-step ${
              idx === currentStep ? "is-active" : idx < currentStep ? "is-done" : ""
            }`}
            data-testid={`progress-step-${idx}`}
          >
            {idx === currentStep && <span className="ob-step-label">{s.name}</span>}
          </div>
        ))}
      </div>

      <main className="ob-stage">
        <div className="ob-screen">
          <AnimatePresence mode="wait">
            {renderStepContent()}
          </AnimatePresence>
        </div>
      </main>

      <footer className="ob-footer">
        <div className="ob-actions">
          {currentStep > 0 ? (
            <button
              type="button"
              className="ob-btn ob-btn-ghost ob-btn-arrow-back"
              onClick={handleBack}
              disabled={isPending}
              data-testid="button-back"
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              className="ob-btn ob-btn-ghost"
              onClick={() => handleDismiss(true)}
              disabled={isPending}
              data-testid="button-complete-later"
            >
              Complete Later
            </button>
          )}

          <div className="flex items-center gap-4">
            <span className="ob-meta">
              Step {currentStep + 1} of {WIZARD_STEPS.length} · {Math.round(progress)}%
            </span>
            {currentStep > 0 && currentStep < WIZARD_STEPS.length - 1 && (
              <button
                type="button"
                className="ob-btn ob-btn-ghost"
                onClick={handleSkip}
                disabled={isPending}
                data-testid="button-skip"
              >
                <SkipForward className="w-4 h-4 mr-1" aria-hidden="true" />
                Skip
              </button>
            )}
            <button
              type="button"
              className="ob-btn ob-btn-primary ob-btn-arrow"
              onClick={isLastStep ? handleGoToDashboard : handleNext}
              disabled={isPending || !canContinue()}
              data-testid="button-continue"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : isLastStep ? (
                "Go to Dashboard"
              ) : (
                "Continue"
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
