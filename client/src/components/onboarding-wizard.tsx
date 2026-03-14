import { useState, useEffect, type ElementType } from "react";
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
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Map,
  FileText,
  Database,
  Users,
  Mail,
  MessageSquare,
  Phone,
  CheckCircle2,
  PartyPopper,
  Lightbulb,
  Loader2,
  SkipForward,
  Building2,
  Building,
  X,
  Upload,
  Home,
  Plus,
  Settings,
  Link2,
  Megaphone,
  Check,
  Circle,
  ExternalLink,
  Hammer,
  TrendingUp,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "wouter";

type BusinessType =
  | "land_flipper"
  | "note_investor"
  | "hybrid"
  | "residential_wholesaler"
  | "fix_and_flip"
  | "buy_and_hold"
  | "commercial";

type OnboardingStatus = {
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
};

const STORAGE_KEY = "acreos_onboarding";

// Investor type definitions for the card grid in step 0
const INVESTOR_TYPES: {
  value: BusinessType;
  label: string;
  description: string;
  icon: ElementType;
}[] = [
  { value: "land_flipper",          label: "Land Flipper",            icon: Map,       description: "Buy raw land at wholesale and resell for profit." },
  { value: "residential_wholesaler",label: "Residential Wholesaler",  icon: Home,      description: "Find distressed homes and assign contracts to cash buyers." },
  { value: "fix_and_flip",          label: "Fix & Flip",              icon: Hammer,    description: "Acquire distressed properties, renovate, and resell." },
  { value: "buy_and_hold",          label: "Buy & Hold / Rental",     icon: TrendingUp,description: "Build a rental portfolio for long-term cash flow." },
  { value: "commercial",            label: "Commercial Investor",     icon: Building,  description: "Office, retail, multi-family, and industrial acquisitions." },
  { value: "note_investor",         label: "Note Investor",           icon: FileText,  description: "Seller-finance real estate sales and collect payments." },
  { value: "hybrid",                label: "Land + Notes (Hybrid)",   icon: Layers,    description: "Cash flips and seller-financed deals — both strategies." },
];

// Role-specific next steps shown after the welcome/role-selection step
const ROLE_NEXT_STEPS: Record<BusinessType, { icon: ElementType; label: string; description: string; href: string }[]> = {
  note_investor: [
    { icon: Link2,     label: "Set Up ACH Payments",      description: "Connect your bank to collect note payments automatically.",     href: "/settings?tab=integrations" },
    { icon: Upload,    label: "Import Existing Notes",     description: "Bring in your current seller-financed portfolio.",              href: "/leads?action=import" },
    { icon: Users,     label: "Add First Borrower",        description: "Create a borrower profile for your first active note.",         href: "/leads?action=add" },
  ],
  land_flipper: [
    { icon: Upload,    label: "Import Leads",              description: "Upload your CSV list of motivated seller leads.",               href: "/leads?action=import" },
    { icon: Megaphone, label: "Set Up Campaign",           description: "Launch your first direct mail or email campaign.",             href: "/campaigns" },
    { icon: Settings,  label: "Configure Deal Criteria",   description: "Define your buy box: target counties, lot size, and price range.", href: "/settings?tab=deal-criteria" },
  ],
  hybrid: [
    { icon: Upload,    label: "Import Leads",              description: "Start by loading your existing lead list.",                     href: "/leads?action=import" },
    { icon: Link2,     label: "Set Up ACH Payments",       description: "Enable automatic payment collection for seller-financed deals.", href: "/settings?tab=integrations" },
    { icon: Megaphone, label: "Set Up Campaign",           description: "Launch your first outreach campaign.",                          href: "/campaigns" },
  ],
  residential_wholesaler: [
    { icon: Upload,    label: "Build Your Buyer List",     description: "Import your cash buyers — this is your most valuable asset.",  href: "/leads?action=import" },
    { icon: Megaphone, label: "Set Up Seller Outreach",    description: "Launch your SMS + email motivated seller campaign.",           href: "/campaigns" },
    { icon: Settings,  label: "Define Your Buy Box",       description: "Set your target neighborhoods, price range, and deal criteria.", href: "/settings?tab=deal-criteria" },
  ],
  fix_and_flip: [
    { icon: Plus,      label: "Add Your First Deal",       description: "Create a deal and track your acquisition and rehab plan.",     href: "/pipeline" },
    { icon: Upload,    label: "Import Leads",              description: "Upload your list of distressed property leads.",               href: "/leads?action=import" },
    { icon: Megaphone, label: "Set Up Outreach Campaign",  description: "Launch direct mail or SMS to find your next deal.",           href: "/campaigns" },
  ],
  buy_and_hold: [
    { icon: Upload,    label: "Add a Rental Property",     description: "Track your existing portfolio or add your first target.",      href: "/properties" },
    { icon: Megaphone, label: "Set Up Off-Market Outreach",description: "Find sellers before they list with targeted campaigns.",       href: "/campaigns" },
    { icon: Link2,     label: "Set Up Payment Collection", description: "If you seller-finance, connect ACH for automated payments.",  href: "/settings?tab=integrations" },
  ],
  commercial: [
    { icon: Plus,      label: "Add a Property or Deal",    description: "Start tracking your pipeline — properties and active deals.",  href: "/pipeline" },
    { icon: Megaphone, label: "Set Up Outreach Campaign",  description: "Reach off-market owners with targeted email campaigns.",       href: "/campaigns" },
    { icon: Upload,    label: "Import Your Contacts",      description: "Load your existing owner and broker contact list.",            href: "/leads?action=import" },
  ],
};

const WIZARD_STEPS = [
  {
    id: 0,
    name: "welcome",
    title: "Welcome",
    description: "Tell us about your business so we can customize your experience.",
    icon: Sparkles,
  },
  {
    id: 1,
    name: "role_first_steps",
    title: "Your First Steps",
    description: "Personalized actions based on your business type.",
    icon: Lightbulb,
  },
  {
    id: 2,
    name: "add_property",
    title: "Add Property",
    description: "Add your first property to track.",
    icon: Home,
  },
  {
    id: 3,
    name: "connect_integrations",
    title: "Connect Integrations",
    description: "Set up your communication channels.",
    icon: Link2,
  },
  {
    id: 4,
    name: "create_campaign",
    title: "Create Campaign",
    description: "Set up your first marketing campaign.",
    icon: Megaphone,
  },
  {
    id: 5,
    name: "complete",
    title: "Complete",
    description: "You're all set to start growing your real estate business!",
    icon: PartyPopper,
  },
];

const INTEGRATION_CHANNELS = [
  { 
    id: "email", 
    label: "Email", 
    description: "Send personalized emails to leads", 
    icon: Mail,
    settingsPath: "/settings?tab=email",
    status: "not_configured"
  },
  { 
    id: "sms", 
    label: "SMS", 
    description: "Text message campaigns and reminders", 
    icon: MessageSquare,
    settingsPath: "/settings?tab=phone",
    status: "not_configured"
  },
  { 
    id: "direct_mail", 
    label: "Direct Mail", 
    description: "Physical mail campaigns via Lob", 
    icon: FileText,
    settingsPath: "/settings?tab=integrations",
    status: "not_configured"
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
  const [propertyAddress, setPropertyAddress] = useState("");
  const [propertyAcres, setPropertyAcres] = useState("");
  const [propertyCounty, setPropertyCounty] = useState("");
  const [propertyState, setPropertyState] = useState("");

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
        description: `Created ${data.provisioned.campaigns} campaign templates based on your business type.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/campaigns"] });
    },
  });

  const createPropertyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/properties", {
        address: propertyAddress,
        sizeAcres: propertyAcres,
        county: propertyCounty,
        state: propertyState,
        status: "prospect",
      });
      if (!res.ok) throw new Error("Failed to create property");
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Property added!",
        description: "Your first property has been created.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
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
    if (currentStep === 0 && businessType) {
      if (organizationName && organizationName !== organization?.name) {
        await updateOrgMutation.mutateAsync(organizationName);
      }
      await provisionMutation.mutateAsync(businessType);
      await updateStepMutation.mutateAsync({ 
        step: currentStep, 
        data: { businessType, organizationName } 
      });
    } else if (currentStep === 2 && propertyAddress) {
      await createPropertyMutation.mutateAsync();
      await updateStepMutation.mutateAsync({ 
        step: currentStep, 
        data: { propertyAdded: true } 
      });
    } else {
      await updateStepMutation.mutateAsync({ step: currentStep });
    }
    
    if (currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      await completeMutation.mutateAsync();
    }
  };

  const handleSkip = async () => {
    await updateStepMutation.mutateAsync({ step: currentStep, skipped: true });
    
    if (currentStep < WIZARD_STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      await completeMutation.mutateAsync();
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleDismiss = (dontShowAgain: boolean = false) => {
    setOpen(false);
    setLocalState({ dismissed: true, dontShowAgain });
    
    if (dontShowAgain) {
      completeMutation.mutate();
    }
  };

  const handleGoToDashboard = async () => {
    await completeMutation.mutateAsync();
  };

  const isPending = updateStepMutation.isPending || provisionMutation.isPending || 
    completeMutation.isPending || createPropertyMutation.isPending || updateOrgMutation.isPending;
  const step = WIZARD_STEPS[currentStep];
  const StepIcon = step.icon;
  const isLastStep = currentStep === WIZARD_STEPS.length - 1;
  const progress = ((currentStep + 1) / WIZARD_STEPS.length) * 100;

  const canContinue = () => {
    switch (currentStep) {
      case 0:
        return !!businessType;
      case 2:
        return true;
      default:
        return true;
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="My Real Estate Company"
                data-testid="input-org-name"
              />
            </div>

            <div className="space-y-2">
              <Label>What type of investing do you do?</Label>
              <p className="text-xs text-muted-foreground">
                We'll customize your workspace, templates, and campaigns to match your strategy.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {INVESTOR_TYPES.map((type) => {
                const TypeIcon = type.icon;
                const selected = businessType === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => setBusinessType(type.value)}
                    data-testid={`option-${type.value}`}
                    className={`flex flex-col items-start gap-2 p-3 rounded-md border text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40 hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center gap-2 w-full">
                      <TypeIcon className={`w-4 h-4 flex-shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                      <span className={`font-medium text-sm ${selected ? "text-primary" : ""}`}>{type.label}</span>
                      {selected && <CheckCircle2 className="w-3.5 h-3.5 text-primary ml-auto flex-shrink-0" />}
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">{type.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        );

      case 1: {
        const roleSteps = ROLE_NEXT_STEPS[businessType] ?? ROLE_NEXT_STEPS.land_flipper;
        const roleLabel = INVESTOR_TYPES.find((t) => t.value === businessType)?.label ?? "investor";
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              Here are the 3 best first steps for a <strong>{roleLabel}</strong>. Complete them now or come back later.
            </p>

            <div className="space-y-3">
              {roleSteps.map((step, idx) => {
                const StepActionIcon = step.icon;
                return (
                  <Card
                    key={idx}
                    className="cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => window.open(step.href, "_blank")}
                    data-testid={`role-step-${idx}`}
                  >
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <StepActionIcon className="w-5 h-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm">{step.label}</p>
                        <p className="text-xs text-muted-foreground">{step.description}</p>
                      </div>
                      <ExternalLink className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={handleSkip}
              data-testid="button-add-manually-later"
            >
              <SkipForward className="w-4 h-4 mr-2" />
              Do this later
            </Button>
          </div>
        );
      }

      case 2:
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              Add your first property to start tracking your deals.
            </p>
            
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="property-address">Property Address</Label>
                <Input
                  id="property-address"
                  value={propertyAddress}
                  onChange={(e) => setPropertyAddress(e.target.value)}
                  placeholder="123 Main St or Tract 5 FM 2222"
                  data-testid="input-property-address"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="property-county">County</Label>
                  <Input
                    id="property-county"
                    value={propertyCounty}
                    onChange={(e) => setPropertyCounty(e.target.value)}
                    placeholder="Travis"
                    data-testid="input-property-county"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="property-state">State</Label>
                  <Input
                    id="property-state"
                    value={propertyState}
                    onChange={(e) => setPropertyState(e.target.value)}
                    placeholder="TX"
                    maxLength={2}
                    data-testid="input-property-state"
                  />
                </div>
              </div>
              
              {(businessType === "land_flipper" || businessType === "note_investor" || businessType === "hybrid") && (
                <div className="space-y-2">
                  <Label htmlFor="property-acres">Acres</Label>
                  <Input
                    id="property-acres"
                    type="number"
                    step="0.01"
                    value={propertyAcres}
                    onChange={(e) => setPropertyAcres(e.target.value)}
                    placeholder="5.25"
                    data-testid="input-property-acres"
                  />
                </div>
              )}
            </div>

            <div className="pt-2">
              <Button 
                variant="ghost" 
                className="w-full text-muted-foreground"
                onClick={handleSkip}
                data-testid="button-skip-property"
              >
                <SkipForward className="w-4 h-4 mr-2" />
                Skip for now
              </Button>
            </div>
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              Connect your communication channels to reach leads effectively.
            </p>
            
            <div className="space-y-3">
              {INTEGRATION_CHANNELS.map((channel) => {
                const IconComponent = channel.icon;
                return (
                  <Card
                    key={channel.id}
                    className="cursor-pointer"
                    onClick={() => window.open(channel.settingsPath, "_blank")}
                    data-testid={`integration-${channel.id}`}
                  >
                    <CardContent className="p-4 flex items-center gap-4">
                      <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
                        <IconComponent className="w-5 h-5 text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{channel.label}</p>
                        <p className="text-sm text-muted-foreground">{channel.description}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        Set up
                      </Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            
            <p className="text-xs text-center text-muted-foreground">
              You can configure these later in Settings.
            </p>
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              We've created campaign templates based on your business type.
            </p>
            
            <Card 
              className="cursor-pointer"
              onClick={() => window.open("/campaigns", "_blank")}
              data-testid="card-view-campaigns"
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center">
                  <Megaphone className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">View Campaigns</p>
                  <p className="text-sm text-muted-foreground">
                    {businessType === "land_flipper" && "Acquisition mailer templates ready"}
                    {businessType === "note_investor" && "Payment reminder templates ready"}
                    {businessType === "hybrid" && "Full campaign suite created"}
                    {businessType === "residential_wholesaler" && "Motivated seller & buyer campaigns ready"}
                    {businessType === "fix_and_flip" && "Distressed property outreach templates ready"}
                    {businessType === "buy_and_hold" && "Off-market acquisition campaigns ready"}
                    {businessType === "commercial" && "Commercial outreach templates ready"}
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>

            <Card 
              className="cursor-pointer"
              onClick={() => window.open("/sequences", "_blank")}
              data-testid="card-view-sequences"
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center">
                  <Mail className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Create Sequence</p>
                  <p className="text-sm text-muted-foreground">
                    Set up automated follow-up sequences
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </div>
        );

      case 5:
        return (
          <div className="space-y-6 text-center">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15 }}
              className="w-20 h-20 mx-auto rounded-full bg-green-500/10 flex items-center justify-center"
            >
              <PartyPopper className="w-10 h-10 text-green-500" />
            </motion.div>
            
            <div>
              <h3 className="text-xl font-semibold mb-2">You're All Set!</h3>
              <p className="text-muted-foreground">
                Your AcreOS account is ready. Start finding and closing deals.
                {" "}Your workspace has been tailored for{" "}
                <strong>{INVESTOR_TYPES.find((t) => t.value === businessType)?.label ?? "your strategy"}</strong>.
              </p>
            </div>
            
            <div className="grid gap-2 text-left max-w-xs mx-auto">
              <div className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>Organization: <strong>{organizationName || organization?.name}</strong></span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>Business type: <strong className="capitalize">{businessType?.replace("_", " ")}</strong></span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                <span>Campaign templates created</span>
              </div>
            </div>
            
            <Button 
              size="lg" 
              onClick={handleGoToDashboard}
              disabled={isPending}
              className="w-full"
              data-testid="button-go-to-dashboard"
            >
              {isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Go to Dashboard
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  const renderStepIndicators = () => {
    return (
      <div className="flex items-center justify-center gap-1 mb-4">
        {WIZARD_STEPS.map((s, index) => {
          const isCompleted = index < currentStep;
          const isCurrent = index === currentStep;
          
          return (
            <button
              key={s.id}
              onClick={() => index <= currentStep && setCurrentStep(index)}
              disabled={index > currentStep}
              className={`w-2 h-2 rounded-full transition-all ${
                isCompleted 
                  ? "bg-primary" 
                  : isCurrent 
                    ? "bg-primary w-6" 
                    : "bg-muted"
              }`}
              data-testid={`step-indicator-${index}`}
            />
          );
        })}
      </div>
    );
  };

  if (orgLoading || !organization) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => {
      if (!isOpen) {
        handleDismiss(false);
      }
    }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-onboarding-wizard">
        <DialogHeader>
          <div className="flex items-center justify-between mb-2">
            <Badge variant="outline" className="text-xs" data-testid="badge-step-indicator">
              Step {currentStep + 1} of {WIZARD_STEPS.length}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDismiss(true)}
              className="text-xs text-muted-foreground"
              data-testid="button-dont-show-again"
            >
              Don't show again
            </Button>
          </div>
          
          <Progress value={progress} className="h-1.5 mb-4" data-testid="progress-onboarding" />
          
          {renderStepIndicators()}
          
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
          
          <DialogTitle className="text-center text-xl" data-testid="text-step-title">
            {step.title}
          </DialogTitle>
          <DialogDescription className="text-center" data-testid="text-step-description">
            {step.description}
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="py-4"
          >
            {renderStepContent()}
          </motion.div>
        </AnimatePresence>

        {!isLastStep && (
          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-0">
            {currentStep > 0 && (
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={isPending}
                className="sm:mr-auto"
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            )}
            
            <div className="flex gap-2 flex-wrap justify-end">
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
                onClick={handleNext}
                disabled={isPending || !canContinue()}
                data-testid="button-next"
              >
                {isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : null}
                {currentStep === WIZARD_STEPS.length - 2 ? "Finish" : "Continue"}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
