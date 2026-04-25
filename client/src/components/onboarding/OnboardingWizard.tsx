import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Upload,
  Mail,
  Target,
  PartyPopper,
  Loader2,
  SkipForward,
  X,
  Plus,
  ExternalLink,
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
            className="space-y-6"
            data-testid="onboarding-step-0"
          >
            <div className="text-center mb-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4"
              >
                <Sparkles className="w-10 h-10 text-primary" />
              </motion.div>
              <h2 className="text-2xl font-bold mb-2">Welcome to AcreOS</h2>
              <p className="text-muted-foreground">The operating system for land investors — track leads, run campaigns, and close more deals.</p>
            </div>

            <div className="grid grid-cols-1 gap-3 mb-4">
              {[
                { icon: Map, label: "Manage leads & properties in one place" },
                { icon: Mail, label: "Run direct mail, email & SMS campaigns" },
                { icon: Target, label: "Close deals faster with AI-powered insights" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-3 p-3 rounded-md bg-muted/50">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <span className="text-sm">{label}</span>
                </div>
              ))}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="e.g. Apex Real Estate Group"
                data-testid="input-org-name"
              />
            </div>
            
            <div className="space-y-3">
              <Label>What type of investing do you do?</Label>
              <div className="max-h-[280px] overflow-y-auto pr-1 -mr-1">
                <RadioGroup
                  value={businessType}
                  onValueChange={(value) => setBusinessType(value as BusinessType)}
                  className="grid grid-cols-2 gap-2"
                >
                  {INVESTOR_TYPES.map(({ value, label, icon: Icon, description }) => (
                    <Label
                      key={value}
                      htmlFor={value}
                      className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                        businessType === value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30"
                      }`}
                      data-testid={`option-${value}`}
                    >
                      <RadioGroupItem value={value} id={value} className="mt-0.5 sr-only" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <Icon className="w-4 h-4 text-primary flex-shrink-0" />
                          <span className="font-medium text-sm truncate">{label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {description}
                        </p>
                      </div>
                    </Label>
                  ))}
                </RadioGroup>
              </div>
            </div>
          </motion.div>
        );

      case 1:
        return (
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
            data-testid="onboarding-step-1"
          >
            <div className="text-center mb-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4"
              >
                <Upload className="w-10 h-10 text-primary" />
              </motion.div>
              <h2 className="text-2xl font-bold mb-2">Get Started with Data</h2>
              <p className="text-muted-foreground">Load sample data to explore or import your own</p>
            </div>
            
            <Card 
              className="cursor-pointer hover-elevate border-2 border-green-500/30 bg-green-500/5"
              onClick={() => loadSampleDataMutation.mutate()}
              data-testid="card-load-sample-data"
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-md bg-green-500/10 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-6 h-6 text-green-500" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Load Sample Data</p>
                  <p className="text-sm text-muted-foreground">
                    Explore with realistic leads, properties & deals
                  </p>
                </div>
                {loadSampleDataMutation.isPending ? (
                  <Loader2 className="w-4 h-4 text-green-500 animate-spin flex-shrink-0" />
                ) : (
                  <ArrowRight className="w-4 h-4 text-green-500 flex-shrink-0" />
                )}
              </CardContent>
            </Card>

            <div className="text-center text-sm text-muted-foreground">or</div>

            <Card 
              className="cursor-pointer hover-elevate"
              onClick={() => window.open("/leads?action=import", "_blank")}
              data-testid="card-import-csv"
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Upload className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Import CSV File</p>
                  <p className="text-sm text-muted-foreground">
                    Upload leads from a spreadsheet
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>

            <div className="text-center text-sm text-muted-foreground">or</div>

            <Card 
              className="cursor-pointer hover-elevate"
              onClick={() => window.open("/leads?action=new", "_blank")}
              data-testid="card-add-lead"
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                  <Plus className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Create Lead Manually</p>
                  <p className="text-sm text-muted-foreground">
                    Add a new lead one at a time
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </motion.div>
        );

      case 2:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
            data-testid="onboarding-step-2"
          >
            <div className="text-center mb-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4"
              >
                <Mail className="w-10 h-10 text-primary" />
              </motion.div>
              <h2 className="text-2xl font-bold mb-2">Connect Your Email</h2>
              <p className="text-muted-foreground">Send campaigns directly from your own inbox for better deliverability</p>
            </div>

            <Card
              className="cursor-pointer hover-elevate border-2 border-primary/20 bg-primary/5"
              onClick={() => window.open("/settings?tab=email", "_blank")}
              data-testid="card-connect-email"
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Settings className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Go to Email Settings</p>
                  <p className="text-sm text-muted-foreground">
                    Connect Gmail, Outlook, or custom SMTP
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </CardContent>
            </Card>

            <div className="space-y-2">
              {[
                { icon: Check, label: "Emails sent from your own address" },
                { icon: Check, label: "Better inbox placement and open rates" },
                { icon: Check, label: "Replies land in your inbox automatically" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <p className="text-sm text-center text-muted-foreground">
              This step is optional — you can set it up later in Settings &rsaquo; Email.
            </p>
          </motion.div>
        );

      case 3:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
            data-testid="onboarding-step-3"
          >
            <div className="text-center mb-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center mb-4"
              >
                <Target className="w-10 h-10 text-primary" />
              </motion.div>
              <h2 className="text-2xl font-bold mb-2">Create Your First Campaign</h2>
              <p className="text-muted-foreground">Start reaching out to motivated sellers</p>
            </div>

            <Card
              className="cursor-pointer hover-elevate border-2 border-primary/20 bg-primary/5"
              onClick={() => window.open("/campaigns", "_blank")}
              data-testid="card-create-campaign"
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Target className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Go to Marketing Hub</p>
                  <p className="text-sm text-muted-foreground">
                    Create a direct mail, email, or SMS campaign
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </CardContent>
            </Card>

            <div className="space-y-2">
              {[
                { icon: Check, label: "Pre-built templates for land investors" },
                { icon: Check, label: "Target leads by score, stage, or location" },
                { icon: Check, label: "Track open rates and responses" },
              ].map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Icon className="w-4 h-4 text-green-500 flex-shrink-0" />
                  <span>{label}</span>
                </div>
              ))}
            </div>

            <p className="text-sm text-center text-muted-foreground">
              You can create your first campaign now or skip and do it later.
            </p>
          </motion.div>
        );

      case 4:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
            data-testid="onboarding-step-4"
          >
            <div className="text-center mb-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
                className="w-20 h-20 mx-auto rounded-full bg-green-500/10 flex items-center justify-center mb-4"
              >
                <PartyPopper className="w-10 h-10 text-green-500" />
              </motion.div>
              <h2 className="text-2xl font-bold mb-2">You're All Set!</h2>
              <p className="text-muted-foreground">Your AcreOS workspace is ready. Head to the dashboard to get started.</p>
            </div>

            <div className="space-y-3">
              {[
                { icon: Upload, label: "Import leads", done: true },
                { icon: Mail, label: "Email connected", done: false, optional: true },
                { icon: Target, label: "First campaign", done: false, optional: true },
              ].map(({ icon: Icon, label, done, optional }) => (
                <div
                  key={label}
                  className={`flex items-center gap-3 p-3 rounded-md ${done ? "bg-green-500/10" : "bg-muted/50"}`}
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${done ? "bg-green-500/20" : "bg-muted"}`}>
                    {done
                      ? <Check className="w-4 h-4 text-green-500" />
                      : <Icon className="w-4 h-4 text-muted-foreground" />
                    }
                  </div>
                  <span className={`text-sm flex-1 ${done ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
                  {optional && !done && (
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">optional</span>
                  )}
                </div>
              ))}
            </div>

            <p className="text-sm text-center text-muted-foreground pt-2">
              You can complete the optional steps any time from the dashboard checklist.
            </p>
          </motion.div>
        );

      default:
        return null;
    }
  };

  if (orgLoading) return null;

  return (
    <Dialog open={open} onOpenChange={() => handleDismiss(false)}>
      <DialogContent 
        className="sm:max-w-lg max-h-[90vh] overflow-y-auto"
        data-testid="onboarding-wizard"
      >
        <VisuallyHidden>
          <DialogTitle>Onboarding Wizard</DialogTitle>
        </VisuallyHidden>
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-4 right-4"
          onClick={() => handleDismiss(false)}
          aria-label="Close wizard"
          data-testid="button-close-wizard"
        >
          <X className="w-4 h-4" />
        </Button>
        
        <div className="space-y-6 pt-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Step {currentStep + 1} of {WIZARD_STEPS.length}</span>
              <span>{Math.round(progress)}% complete</span>
            </div>
            <Progress value={progress} className="h-2" data-testid="progress-onboarding" />
            
            <div className="flex items-center justify-center gap-2 pt-1">
              {WIZARD_STEPS.map((s, idx) => (
                <div
                  key={s.id}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    idx === currentStep 
                      ? "bg-primary" 
                      : idx < currentStep 
                        ? "bg-primary/60" 
                        : "bg-muted"
                  }`}
                />
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {renderStepContent()}
          </AnimatePresence>

          <div className="flex items-center justify-between pt-4 border-t">
            <div>
              {currentStep > 0 ? (
                <Button 
                  variant="ghost" 
                  onClick={handleBack}
                  disabled={isPending}
                  data-testid="button-back"
                >
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              ) : (
                <Button 
                  variant="ghost" 
                  onClick={() => handleDismiss(true)}
                  disabled={isPending}
                  data-testid="button-complete-later"
                >
                  Complete Later
                </Button>
              )}
            </div>
            
            <div className="flex items-center gap-2">
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
              <Button 
                onClick={isLastStep ? handleGoToDashboard : handleNext}
                disabled={isPending || !canContinue()}
                data-testid="button-continue"
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : isLastStep ? (
                  <>
                    Go to Dashboard
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                ) : (
                  <>
                    Continue
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
