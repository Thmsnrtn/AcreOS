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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
  X,
  UserPlus
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type BusinessType = "land_flipper" | "note_investor" | "hybrid";

type OnboardingStatus = {
  completed: boolean;
  currentStep: number;
  data: {
    businessType?: BusinessType;
    organizationName?: string;
    communicationChannels?: string[];
    dataImported?: boolean;
    stripeConnected?: boolean;
    campaignCreated?: boolean;
    teamInvites?: string[];
    sampleDataLoaded?: boolean;
    completedSteps?: number[];
    skippedSteps?: number[];
    aiTips?: string[];
  };
  totalSteps: number;
};

const WIZARD_STEPS = [
  {
    id: 0,
    name: "organization",
    title: "Organization Setup",
    description: "Let's set up your organization and business type.",
    icon: Building2,
  },
  {
    id: 1,
    name: "communication",
    title: "Communication Preferences",
    description: "Choose how you'll reach your leads and clients.",
    icon: MessageSquare,
  },
  {
    id: 2,
    name: "campaign",
    title: "Your First Campaign",
    description: "Set up your first marketing campaign (optional).",
    icon: Mail,
  },
  {
    id: 3,
    name: "team",
    title: "Invite Your Team",
    description: "Add team members to collaborate (optional).",
    icon: Users,
  },
  {
    id: 4,
    name: "review",
    title: "You're All Set!",
    description: "Review your setup and launch your land investment business.",
    icon: CheckCircle2,
  },
];

const COMMUNICATION_CHANNELS = [
  { id: "email", label: "Email", description: "Send personalized emails to leads", icon: Mail },
  { id: "sms", label: "SMS", description: "Text message campaigns and reminders", icon: MessageSquare },
  { id: "direct_mail", label: "Direct Mail", description: "Physical mail campaigns", icon: FileText },
  { id: "phone", label: "Phone", description: "Track phone call interactions", icon: Phone },
];

export function OnboardingWizard() {
  const { data: organization, isLoading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [businessType, setBusinessType] = useState<BusinessType>("land_flipper");
  const [organizationName, setOrganizationName] = useState("");
  const [communicationChannels, setCommunicationChannels] = useState<string[]>(["email", "direct_mail"]);
  const [teamEmails, setTeamEmails] = useState("");
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
        if (onboardingStatus.data.organizationName) {
          setOrganizationName(onboardingStatus.data.organizationName);
        } else if (organization.name) {
          setOrganizationName(organization.name);
        }
        if (onboardingStatus.data.communicationChannels) {
          setCommunicationChannels(onboardingStatus.data.communicationChannels);
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

  const sampleDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/sample-data", {});
      if (!res.ok) throw new Error("Failed to load sample data");
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Sample data loaded!",
        description: `Added ${data.counts.leads} leads, ${data.counts.properties} properties, and ${data.counts.notes} notes.`,
      });
      queryClient.invalidateQueries();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to load sample data",
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
    } else if (currentStep === 1) {
      await updateStepMutation.mutateAsync({ 
        step: currentStep, 
        data: { communicationChannels } 
      });
    } else if (currentStep === 3 && teamEmails.trim()) {
      const emails = teamEmails.split(",").map(e => e.trim()).filter(Boolean);
      await updateStepMutation.mutateAsync({ 
        step: currentStep, 
        data: { teamInvites: emails } 
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

  const handleLoadSampleData = async () => {
    await sampleDataMutation.mutateAsync();
  };

  const toggleChannel = (channelId: string) => {
    setCommunicationChannels(prev => 
      prev.includes(channelId) 
        ? prev.filter(c => c !== channelId)
        : [...prev, channelId]
    );
  };

  const isPending = updateStepMutation.isPending || provisionMutation.isPending || completeMutation.isPending || sampleDataMutation.isPending || updateOrgMutation.isPending;
  const step = WIZARD_STEPS[currentStep];
  const StepIcon = step.icon;
  const isLastStep = currentStep === WIZARD_STEPS.length - 1;
  const progress = ((currentStep + 1) / WIZARD_STEPS.length) * 100;

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization Name</Label>
              <Input
                id="org-name"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="My Land Company"
                data-testid="input-org-name"
              />
            </div>
            
            <div className="space-y-2">
              <Label>Business Type</Label>
              <p className="text-sm text-muted-foreground">
                What type of land investing are you focused on?
              </p>
            </div>
            
            <RadioGroup
              value={businessType}
              onValueChange={(value) => setBusinessType(value as BusinessType)}
              className="grid gap-3"
            >
              <Label
                htmlFor="land_flipper"
                className={`flex items-start gap-4 p-4 rounded-md border cursor-pointer transition-colors ${
                  businessType === "land_flipper" ? "border-primary bg-primary/5" : "border-border"
                }`}
                data-testid="option-land-flipper"
              >
                <RadioGroupItem value="land_flipper" id="land_flipper" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Map className="w-4 h-4 text-primary" />
                    <span className="font-medium">Land Flipper</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Buy land at wholesale prices and resell for cash or with terms.
                  </p>
                </div>
              </Label>
              
              <Label
                htmlFor="note_investor"
                className={`flex items-start gap-4 p-4 rounded-md border cursor-pointer transition-colors ${
                  businessType === "note_investor" ? "border-primary bg-primary/5" : "border-border"
                }`}
                data-testid="option-note-investor"
              >
                <RadioGroupItem value="note_investor" id="note_investor" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-primary" />
                    <span className="font-medium">Note Investor</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Seller-finance land sales and manage payment collection.
                  </p>
                </div>
              </Label>
              
              <Label
                htmlFor="hybrid"
                className={`flex items-start gap-4 p-4 rounded-md border cursor-pointer transition-colors ${
                  businessType === "hybrid" ? "border-primary bg-primary/5" : "border-border"
                }`}
                data-testid="option-hybrid"
              >
                <RadioGroupItem value="hybrid" id="hybrid" className="mt-1" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Building2 className="w-4 h-4 text-primary" />
                    <span className="font-medium">Hybrid</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Both cash flips and seller-financed deals.
                  </p>
                </div>
              </Label>
            </RadioGroup>
            
            <div className="pt-4 border-t">
              <Button
                variant="outline"
                onClick={handleLoadSampleData}
                disabled={sampleDataMutation.isPending}
                className="w-full"
                data-testid="button-load-sample-data"
              >
                {sampleDataMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Database className="w-4 h-4 mr-2" />
                )}
                Load Sample Data
              </Button>
              <p className="text-xs text-center text-muted-foreground mt-2">
                Get started quickly with sample leads, properties, and notes
              </p>
            </div>
          </div>
        );

      case 1:
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              Select the communication channels you plan to use.
            </p>
            <div className="grid gap-3">
              {COMMUNICATION_CHANNELS.map((channel) => {
                const IconComponent = channel.icon;
                const isSelected = communicationChannels.includes(channel.id);
                return (
                  <div
                    key={channel.id}
                    className={`flex items-center gap-4 p-4 rounded-md border cursor-pointer transition-colors ${
                      isSelected ? "border-primary bg-primary/5" : "border-border"
                    }`}
                    onClick={() => toggleChannel(channel.id)}
                    data-testid={`channel-${channel.id}`}
                  >
                    <Checkbox 
                      checked={isSelected}
                      onCheckedChange={() => toggleChannel(channel.id)}
                    />
                    <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                      <IconComponent className="w-5 h-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{channel.label}</p>
                      <p className="text-sm text-muted-foreground">{channel.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-center text-muted-foreground">
              You can configure these channels later in Settings.
            </p>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              We've created campaign templates based on your business type. Review and customize them.
            </p>
            <Card className="cursor-pointer" onClick={() => window.open("/campaigns", "_blank")}>
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

      case 3:
        return (
          <div className="space-y-4">
            <p className="text-muted-foreground text-center">
              Invite team members to collaborate on your land deals.
            </p>
            <div className="space-y-2">
              <Label htmlFor="team-emails">Email Addresses</Label>
              <Input
                id="team-emails"
                value={teamEmails}
                onChange={(e) => setTeamEmails(e.target.value)}
                placeholder="john@example.com, jane@example.com"
                data-testid="input-team-emails"
              />
              <p className="text-xs text-muted-foreground">
                Enter email addresses separated by commas
              </p>
            </div>
            <Card>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                  <UserPlus className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">Team Benefits</p>
                  <ul className="text-sm text-muted-foreground space-y-1 mt-1">
                    <li>Assign leads to team members</li>
                    <li>Track individual performance</li>
                    <li>Collaborate on deals</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
            <p className="text-xs text-center text-muted-foreground">
              You can invite team members later from Settings.
            </p>
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
                <span>Organization: <strong>{organizationName || organization?.name}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>Business type: <strong className="capitalize">{businessType?.replace("_", " ")}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>Channels: <strong>{communicationChannels.join(", ")}</strong></span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span>Campaign templates created</span>
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
            <Badge variant="outline" className="text-xs" data-testid="badge-step-indicator">
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
          
          <Progress value={progress} className="h-1.5 mb-4" data-testid="progress-onboarding" />
          
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
