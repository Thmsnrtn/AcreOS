import * as React from "react";
import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import { clientLogger } from "@/lib/clientLogger";
import {
  Sparkles,
  Upload,
  Mail,
  Send,
  Target,
  PartyPopper,
  Loader2,
  SkipForward,
  X,
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
  FileSignature,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Persona } from "@shared/models/auth";
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
  | "subdivider"
  | "tax_lien_deed"
  | "multifamily"
  | "mobile_home"
  | "agent_investor";

// Note Investor vertical fork (Phase 5 §5). Captured in step 0 alongside
// the granular businessType — this 3-way question controls sidebar
// modules, persona vocabulary, and which subsequent onboarding steps
// are skipped. 'land' is the default to preserve historical behavior.
type InvestorTypeChoice = "land" | "notes" | "both";

const INVESTOR_TYPE_CHOICES: { value: InvestorTypeChoice; label: string; description: string; icon: LucideIcon }[] = [
  { value: "land", label: "Buying land", description: "Raw parcels — flip, hold, or develop.", icon: Map },
  { value: "notes", label: "Buying notes", description: "Mortgage notes and seller-financed paper.", icon: FileText },
  { value: "both", label: "Both", description: "Mixed portfolio — land and notes.", icon: Sparkles },
];

// The CORE three verticals AcreOS was built for and ships production-quality
// support for today. Everything else is roadmap / beta — surfaced behind a
// "Show all investor types" toggle so the first impression of a Land
// Investors product isn't a 15-card icon avalanche.
const CORE_INVESTOR_TYPES: { value: BusinessType; label: string; icon: LucideIcon; description: string }[] = [
  { value: "land_flipper", label: "Land Flipper", icon: Map, description: "Buy raw land at wholesale and resell for profit." },
  { value: "note_investor", label: "Note Investor", icon: FileText, description: "Buy, sell, and service mortgage notes and seller-financed paper." },
  { value: "hybrid", label: "Hybrid / Multi-Strategy", icon: Sparkles, description: "Combine land, notes, and other strategies — built for mixed portfolios." },
];

// Secondary verticals — schemas + UX are in roadmap. We accept the selection
// (it's persisted on the org so we can prioritize roll-out by demand) but
// the experience for these is still maturing. The "Beta" badge sets honest
// expectations: pick this if it describes you, but expect rougher edges.
const SECONDARY_INVESTOR_TYPES: { value: BusinessType; label: string; icon: LucideIcon; description: string }[] = [
  { value: "residential_wholesaler", label: "Residential Wholesaler", icon: Home, description: "Find distressed homes and assign contracts to cash buyers." },
  { value: "fix_and_flip", label: "Fix & Flip", icon: Hammer, description: "Acquire, renovate, and resell properties for profit." },
  { value: "buy_and_hold", label: "Buy & Hold", icon: Key, description: "Build a long-term rental portfolio for passive income." },
  { value: "short_term_rental", label: "Short-Term Rental", icon: Palmtree, description: "Acquire and manage Airbnb, VRBO, and vacation rentals." },
  { value: "multifamily", label: "Multifamily", icon: Building2, description: "Invest in apartment buildings and 5+ unit properties." },
  { value: "commercial", label: "Commercial", icon: Landmark, description: "Office, retail, industrial, and mixed-use investments." },
  { value: "creative_finance", label: "Creative Finance", icon: Lightbulb, description: "Subject-to, seller financing, wraps, and lease options." },
  { value: "developer", label: "Developer / Entitlements", icon: Warehouse, description: "Land development, entitlements, and new construction." },
  { value: "subdivider", label: "Subdivider", icon: Warehouse, description: "Buy 40-200 acre parents, cut into 5-50 child lots, sell over 18-36 months." },
  { value: "tax_lien_deed", label: "Tax Lien / Tax Deed", icon: Receipt, description: "Purchase tax liens and tax deeds at county auctions." },
  { value: "mobile_home", label: "Mobile Home / MHP", icon: Truck, description: "Mobile home parks and manufactured housing investments." },
  { value: "agent_investor", label: "Agent-Investor", icon: Users, description: "Licensed agent who also invests — manage clients and your own deals." },
];

const INVESTOR_TYPES = [...CORE_INVESTOR_TYPES, ...SECONDARY_INVESTOR_TYPES];
const SECONDARY_BUSINESS_TYPES = new Set<BusinessType>(SECONDARY_INVESTOR_TYPES.map((t) => t.value));

/**
 * Persona ↔ data-model coupling.
 *
 * The Critic agent flagged that `users.persona` (the 9-value union that
 * drives every persona-specific mobile tab, sidebar item, and copy
 * vocabulary substitution) was NEVER written by the onboarding wizard
 * — every user was effectively defaulted to "land_investor", and the
 * wholesaler / tax-delinquent / note-originator / etc. surfaces were
 * silently inert. We capture two signals at step 0 (granular
 * businessType + 3-way investorType) and derive the canonical persona
 * from them. Server-side mirror lives in `routes-onboarding.ts`
 * /complete so the persona is always set even if this PUT fails.
 */
/**
 * Explicit businessType → canonical `Persona` map.
 *
 * The onboarding wizard captures a granular 15-value `businessType`
 * taxonomy, but every persona-specific surface (mobile tabs, sidebar
 * modules, copy vocabulary) keys off `users.persona`, which is the
 * 9-value union in `@shared/models/auth`. This map is the single
 * source of truth for collapsing the former into the latter. Every
 * BusinessType is covered explicitly via the Record type, and anything
 * land/flip-ish or otherwise unmapped resolves to "land_investor".
 */
const BUSINESS_TYPE_TO_PERSONA: Record<BusinessType, Persona> = {
  note_investor: "note_investor",
  residential_wholesaler: "wholesaler",
  fix_and_flip: "fix_flipper",
  buy_and_hold: "landlord",
  short_term_rental: "landlord",
  multifamily: "landlord",
  mobile_home: "landlord",
  subdivider: "subdivider",
  developer: "subdivider",
  tax_lien_deed: "tax_delinquent",
  land_flipper: "land_investor",
  hybrid: "land_investor",
  commercial: "land_investor",
  creative_finance: "land_investor",
  agent_investor: "land_investor",
};

export function businessTypeToPersona(bt: BusinessType): Persona {
  return BUSINESS_TYPE_TO_PERSONA[bt] ?? "land_investor";
}

// Note-role fork — the note vertical covers three distinct jobs, each its own
// persona. Without this, every note person resolved to "note_investor" and the
// originator + servicer surfaces (their actual jobs) were inert.
type NoteRole = "invest" | "originate" | "service";

const NOTE_ROLE_TO_PERSONA: Record<NoteRole, Persona> = {
  invest: "note_investor",
  originate: "note_originator",
  service: "note_servicer",
};

const NOTE_ROLE_CHOICES: { value: NoteRole; label: string; description: string; icon: LucideIcon }[] = [
  { value: "invest", label: "I buy notes", description: "Acquire existing notes for yield.", icon: FileText },
  { value: "originate", label: "I create notes", description: "Seller-finance sales into new paper.", icon: FileSignature },
  { value: "service", label: "I service notes", description: "Collect & service notes for others.", icon: ClipboardCheck },
];

function derivePersona(
  businessType: BusinessType,
  investorType: InvestorTypeChoice,
  noteRole: NoteRole = "invest",
): Persona {
  // Note vertical first — investorType is the authoritative fork for
  // 1099-INT batches and the lender/servicer modules. The note-role sub-fork
  // then selects which of the three note personas applies.
  if (investorType === "notes" || businessType === "note_investor") {
    return NOTE_ROLE_TO_PERSONA[noteRole];
  }
  return businessTypeToPersona(businessType);
}

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
    description: "The operating system for Land Investors",
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
    // The witnessed-send moment. After sample data is loaded, Pax drafts a
    // follow-up to the stalest lead and the user taps Send — the minimum
    // proof that Pax is an operator, not just an advisor. NOTHING sends
    // without this explicit human tap.
    id: 2,
    name: "first_follow_up",
    title: "Let Pax Take an Action",
    description: "Pax drafts your first follow-up — you tap Send",
    icon: Send,
  },
  {
    id: 3,
    name: "connect_email",
    title: "Connect Your Email",
    description: "Send campaigns directly from your inbox",
    icon: Mail,
  },
  {
    id: 4,
    name: "create_campaign",
    title: "Create Your First Campaign",
    description: "Start reaching out to motivated sellers",
    icon: Target,
  },
  // Tax-identity step was moved OUT of signup onboarding 2026-05-11.
  // It's now a lazy prompt (TaxIdentityPrompt) shown only when a user
  // attempts to create their first seller-financed note. A land flipper
  // without notes shouldn't have to surface an EIN at signup.
  {
    id: 5,
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
    clientLogger.error("Error reading onboarding state:", error);
  }
  return null;
}

function setLocalState(state: any) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    clientLogger.error("Error saving onboarding state:", error);
  }
}

export function OnboardingWizard() {
  const { data: organization, isLoading: orgLoading } = useOrganization();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [businessType, setBusinessType] = useState<BusinessType>("land_flipper");
  // Step 0 archetype picker — secondary verticals are collapsed by default
  // so the first impression of "Land Investors" isn't a 15-card avalanche.
  const [showAllInvestorTypes, setShowAllInvestorTypes] = useState(false);
  // Note Investor vertical (Phase 5 §5) — separate from businessType so
  // mixed-strategy orgs (Hybrid + buying notes) can still get the note
  // sidebar / vocabulary while their businessType remains 'hybrid'.
  const [investorType, setInvestorType] = useState<InvestorTypeChoice>("land");
  // Note-role sub-fork — only meaningful when investorType === "notes".
  // Selects which of the three note personas (invest/originate/service) we
  // persist so the originator + servicer surfaces aren't inert.
  const [noteRole, setNoteRole] = useState<NoteRole>("invest");
  const [organizationName, setOrganizationName] = useState("");

  // Tax-identity capture was moved out of the signup wizard 2026-05-11.
  // See TaxIdentityPrompt — surfaced lazily on first seller-financed note.

  const { data: onboardingStatus, refetch: refetchStatus } = useQuery<OnboardingStatus>({
    queryKey: ["/api/onboarding/status"],
    enabled: !!organization && !orgLoading,
  });

  useEffect(() => {
    if (!orgLoading && organization && onboardingStatus) {
      const localState = getLocalState();
      
      if (!onboardingStatus.completed) {
        // Permanent dismiss (Complete Later button) — persisted to localStorage.
        if (localState?.dismissed && localState?.dontShowAgain) {
          return;
        }
        // Session-scope dismiss (X button) — suppress re-opening across in-app
        // navigations within the same tab session. F-D04: without this the
        // wizard re-mounted on every page nav even after the user explicitly
        // closed it, which felt like a bug to a real stranger.
        try {
          if (sessionStorage.getItem("acreos:onboarding-session-dismissed") === "1") {
            return;
          }
        } catch { /* sessionStorage unavailable (private mode etc) — fall through */ }

        setOpen(true);
        setCurrentStep(localState?.currentStep ?? onboardingStatus.currentStep);
        
        if (onboardingStatus.data.businessType) {
          setBusinessType(onboardingStatus.data.businessType);
        }
        // Note Investor vertical — restore the investor-type fork from the
        // org row so a wizard re-open keeps the user's prior selection.
        const orgInvestorType = (organization as any)?.investorType;
        if (orgInvestorType === "land" || orgInvestorType === "notes" || orgInvestorType === "both") {
          setInvestorType(orgInvestorType);
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

  // ── Witnessed first-follow-up send (the "Pax acted" proof) ─────────────────
  // Pax drafts a follow-up to the stalest emailable lead; the user taps Send.
  // NOTHING sends without that tap — the draft endpoint only reads + drafts.
  const [followUpSent, setFollowUpSent] = useState(false);
  const followUpDraftQuery = useQuery<{
    available: boolean;
    autonomyLevel?: string;
    lead?: { id: number; name: string; email: string };
    // 2026-06-10 (T0-6): the draft is persisted server-side; approval is by
    // draftId + contentHash so the tap is bound to exactly what Pax wrote.
    draftId?: number;
    contentHash?: string;
    draft?: { subject: string; message: string };
  }>({
    queryKey: ["/api/pax/first-follow-up/draft"],
    enabled: open && currentStep === 2,
  });

  const approveSendMutation = useMutation({
    mutationFn: async (payload: { draftId: number; contentHash: string }) => {
      const res = await apiRequest("POST", "/api/pax/first-follow-up/approve-and-send", payload);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message || "Pax couldn't send the follow-up");
      }
      return res.json();
    },
    onSuccess: () => {
      setFollowUpSent(true);
      toast({
        title: "Pax sent it",
        description: "Your first follow-up is on its way — and Pax logged the action.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      completeStepMutation.mutate({
        stepId: currentStep,
        data: { firstFollowUpSent: true },
      });
    },
    onError: (error) => {
      toast({
        title: "Couldn't send that follow-up",
        description: `${error.message} — nothing was sent.`,
        variant: "destructive",
      });
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

  // Note Investor vertical (Phase 5 §5). When the org self-identifies as
  // a pure note investor we skip steps that don't apply:
  //   • step 1 — Add Your First Leads (notes don't have leads in the
  //     same sense; notes are imported via CSV in a dedicated step that
  //     we surface from /notes after onboarding completes).
  //   • step 2 — Let Pax Take an Action (the witnessed follow-up rides on
  //     the sample-lead motion that pure-notes orgs skip).
  //   • step 4 — Create Your First Campaign (notes don't run direct
  //     mail to landowners; outreach is an entirely different motion).
  // Mixed-strategy orgs ('both') keep every step.
  const stepsToSkipForInvestorType = (t: InvestorTypeChoice): Set<number> =>
    t === "notes" ? new Set([1, 2, 4]) : new Set();

  const handleNext = async () => {
    try {
      if (currentStep === 0) {
        if (organizationName && organizationName !== organization?.name) {
          await updateOrgMutation.mutateAsync(organizationName);
        }
        if (businessType) {
          await provisionMutation.mutateAsync(businessType);
        }
        // Persist the investor-type fork onto the org. This is what the
        // sidebar + persona vocabulary + 1099-INT batch read on every
        // request — onboardingData.businessType is granular UX state but
        // organizations.investorType is the canonical fork.
        if (investorType !== "land") {
          try {
            await apiRequest("PATCH", "/api/organization", { investorType });
            queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
          } catch (err) {
            clientLogger.error("Couldn't persist investorType", err);
          }
        }

        // Persist the derived persona on users.persona. Without this,
        // every user defaults to "land_investor" and the wholesaler /
        // note-investor / tax-delinquent / landlord persona-specific
        // surfaces are inert — which is exactly the systemic bug the
        // multi-persona thesis depended on NOT having. The PUT is
        // best-effort; the server-side /onboarding/complete derives
        // the same persona as a safety net so step-0 latency doesn't
        // strand a user without the persona set.
        const persona = derivePersona(businessType, investorType, noteRole);
        try {
          await apiRequest("PUT", "/api/me/persona", { persona });
          queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
          queryClient.invalidateQueries({ queryKey: ["/api/me/persona"] });
        } catch (err) {
          clientLogger.error("Couldn't persist persona (server will derive)", err);
        }
        await completeStepMutation.mutateAsync({
          stepId: currentStep,
          data: { businessType, organizationName, investorType }
        });
      } else {
        await completeStepMutation.mutateAsync({ stepId: currentStep });
      }

      if (currentStep < WIZARD_STEPS.length - 1) {
        // Skip steps that don't apply to the selected investor type.
        const skipSet = stepsToSkipForInvestorType(investorType);
        let nextStep = currentStep + 1;
        while (nextStep < WIZARD_STEPS.length - 1 && skipSet.has(nextStep)) {
          // Mark as skipped server-side so the dashboard checklist
          // doesn't nag the user later about a step we deliberately
          // routed around.
          try {
            await completeStepMutation.mutateAsync({ stepId: nextStep, data: { skipped: true, reason: "investor_type_notes" } });
          } catch (err) {
            clientLogger.error("Error skipping step for investor type", err);
          }
          nextStep += 1;
        }
        setCurrentStep(nextStep);
      } else {
        await completeMutation.mutateAsync();
      }
    } catch (error) {
      clientLogger.error("Error in handleNext:", error);
      // F-D03: surface the failure so the user isn't left clicking Continue
      // forever on a silent 401. The session-touch retry inside apiRequest
      // handles most refresh-window cases; if we still end up here, it's
      // a genuine error worth showing.
      toast({
        variant: "destructive",
        title: "Couldn't save that step",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong saving your progress. Refresh and try again.",
      });
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
      clientLogger.error("Error in handleSkip:", error);
      toast({
        variant: "destructive",
        title: "Couldn't skip that step",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong. Refresh and try again.",
      });
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
    // F-D04: even a soft-dismiss (X button) should suppress wizard re-open
    // for the rest of this tab session so the stranger isn't repeatedly
    // interrupted on every page nav. Re-opens cleanly on next session.
    try { sessionStorage.setItem("acreos:onboarding-session-dismissed", "1"); } catch {}

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
              <span className="ob-label">Which best describes you?</span>
              <RadioGroup
                value={investorType}
                onValueChange={(value) => setInvestorType(value as InvestorTypeChoice)}
                className="ob-cards"
              >
                {INVESTOR_TYPE_CHOICES.map(({ value, label, description, icon: Icon }) => (
                  <label
                    key={value}
                    htmlFor={`investor-type-${value}`}
                    className={`ob-card ${investorType === value ? "is-on" : ""}`}
                    data-testid={`option-investor-type-${value}`}
                  >
                    <RadioGroupItem value={value} id={`investor-type-${value}`} className="sr-only" />
                    <span className="ob-card-glyph">
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </span>
                    <span className="ob-card-title">{label}</span>
                    <span className="ob-card-desc">{description}</span>
                  </label>
                ))}
              </RadioGroup>
              <p className="ob-hint">
                You can change this later in Settings. Pure note investors get a
                streamlined setup that skips lead-import and campaign steps.
              </p>
            </div>

            {/* Note-role sub-fork — the three note jobs each map to their own
                persona. Only shown when the user is working with notes. */}
            {(investorType === "notes" || investorType === "both") && (
              <div className="ob-field" data-testid="note-role-fork">
                <span className="ob-label">How do you work with notes?</span>
                <RadioGroup
                  value={noteRole}
                  onValueChange={(value) => setNoteRole(value as NoteRole)}
                  className="ob-cards"
                >
                  {NOTE_ROLE_CHOICES.map(({ value, label, description, icon: Icon }) => (
                    <label
                      key={value}
                      htmlFor={`note-role-${value}`}
                      className={`ob-card ${noteRole === value ? "is-on" : ""}`}
                      data-testid={`option-note-role-${value}`}
                    >
                      <RadioGroupItem value={value} id={`note-role-${value}`} className="sr-only" />
                      <span className="ob-card-glyph">
                        <Icon className="w-4 h-4" aria-hidden="true" />
                      </span>
                      <span className="ob-card-title">{label}</span>
                      <span className="ob-card-desc">{description}</span>
                    </label>
                  ))}
                </RadioGroup>
                <p className="ob-hint">
                  Buyers import a portfolio, originators set rate &amp; term
                  defaults, servicers set fee &amp; escrow. Changeable later in
                  Settings.
                </p>
              </div>
            )}

            <div className="ob-field">
              <span className="ob-label">What kind of investing do you do?</span>
              <p className="ob-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                Land is the primary vertical AcreOS was built for. Note
                investing is fully supported. Other verticals are on the
                roadmap — pick what fits and we'll prioritize accordingly.
              </p>
              <RadioGroup
                value={businessType}
                onValueChange={(value) => setBusinessType(value as BusinessType)}
                className="ob-cards"
              >
                {CORE_INVESTOR_TYPES.map(({ value, label, icon: Icon, description }) => (
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

              {/* Secondary verticals — collapsed by default so the first
                  impression isn't a 15-card avalanche. Auto-expanded if
                  the user previously selected one (e.g. coming back to
                  edit) so their current selection is always visible. */}
              <details
                style={{ marginTop: 16 }}
                open={SECONDARY_BUSINESS_TYPES.has(businessType) || showAllInvestorTypes}
                onToggle={(e) => setShowAllInvestorTypes((e.target as HTMLDetailsElement).open)}
                data-testid="details-show-all-investor-types"
              >
                <summary
                  className="ob-hint"
                  style={{ cursor: "pointer", userSelect: "none", marginBottom: 8 }}
                  data-testid="summary-show-all-investor-types"
                >
                  Show all investor types (beta verticals)
                </summary>
                <RadioGroup
                  value={businessType}
                  onValueChange={(value) => setBusinessType(value as BusinessType)}
                  className="ob-cards"
                >
                  {SECONDARY_INVESTOR_TYPES.map(({ value, label, icon: Icon, description }) => (
                    <label
                      key={value}
                      htmlFor={value}
                      className={`ob-card ${businessType === value ? "is-on" : ""}`}
                      data-testid={`option-${value}`}
                      style={{ position: "relative" }}
                    >
                      <RadioGroupItem value={value} id={value} className="sr-only" />
                      <span
                        aria-label="Beta vertical"
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          font: "600 9px/1 var(--font-sans)",
                          letterSpacing: "0.04em",
                          textTransform: "uppercase",
                          padding: "3px 6px",
                          borderRadius: 4,
                          background: "var(--acr-surface-2)",
                          color: "var(--acr-ink-3)",
                          border: "0.5px solid var(--acr-line)",
                        }}
                      >
                        Beta
                      </span>
                      <span className="ob-card-glyph">
                        <Icon className="w-4 h-4" aria-hidden="true" />
                      </span>
                      <span className="ob-card-title">{label}</span>
                      <span className="ob-card-desc">{description}</span>
                    </label>
                  ))}
                </RadioGroup>
              </details>
            </div>
          </motion.div>
        );

      case 1:
        // Note Investor vertical (Phase 5 §5): for orgs that selected
        // "Buying notes" only, this step is removed entirely from the
        // flow by stepsToSkipForInvestorType. For 'both' we still show
        // the lead-import surface — they'll import notes from /notes after
        // onboarding completes. Pure-notes orgs never reach this branch.
        if (investorType === "both") {
          return (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              data-testid="onboarding-step-1-notes-import"
            >
              <div className="ob-eyebrow">
                <span className="ob-eyebrow-dot" aria-hidden="true" />
                Step 1 · Bring in your existing portfolio
              </div>
              <h1 className="ob-title">
                Import <span className="ob-title-italic">your notes.</span>
              </h1>
              <p className="ob-sub">
                Upload a CSV of your acquired notes — payer, balance, rate,
                payment, and acquisition details. We'll map your columns to
                AcreOS's schema. You can also add leads in the same flow.
              </p>

              {/* No window.open — navigate inline. Notes CSV and leads CSV
                  are both in-app pages; the tab-open pattern was iOS Safari
                  unsafe. Secondary text links follow the single-primary-action
                  rule from SYSTEM-V1.md §4. */}
              <div className="ob-cards">
                <button
                  type="button"
                  className="ob-card"
                  onClick={() => loadSampleDataMutation.mutate()}
                  data-testid="card-import-notes-csv"
                >
                  <span className="ob-card-glyph">
                    {loadSampleDataMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Sparkles className="w-4 h-4" aria-hidden="true" />
                    )}
                  </span>
                  <span className="ob-card-title">Try with sample data</span>
                  <span className="ob-card-desc">
                    Pax loads realistic notes and leads so Today is alive
                    immediately. Wipe them when you're ready.
                  </span>
                </button>
              </div>

              {/* Secondary paths — inline navigation, no new tabs */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
                <a
                  href="/notes?action=import"
                  className="ob-hint"
                  style={{ color: "var(--acr-ink-3)", textDecoration: "underline", cursor: "pointer", minHeight: 44, display: "inline-flex", alignItems: "center" }}
                  data-testid="link-import-notes"
                >
                  Import notes CSV
                </a>
                <span style={{ color: "var(--acr-ink-4)", fontSize: 13 }} aria-hidden="true">·</span>
                <a
                  href="/leads?action=import"
                  className="ob-hint"
                  style={{ color: "var(--acr-ink-3)", textDecoration: "underline", cursor: "pointer", minHeight: 44, display: "inline-flex", alignItems: "center" }}
                  data-testid="link-import-leads"
                >
                  Import leads CSV
                </a>
              </div>

              <p className="ob-hint" style={{ marginTop: 16 }}>
                You can do both. Notes and leads live side-by-side for
                mixed-strategy operators.
              </p>
            </motion.div>
          );
        }
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

            {/* Primary path: sample data — one calm CTA.
                Manual import and CSV are demoted to secondary text links
                so there is one primary action per step. No window.open —
                everything stays inline per SYSTEM-V1.md §4. */}
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
                <span className="ob-card-title">Try with sample data</span>
                <span className="ob-card-desc">
                  Pax loads 50 realistic leads so Today is alive from the
                  start. Wipe them when you're ready for real data.
                </span>
              </button>
            </div>

            {/* Secondary paths — inline navigation, no new tabs */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
              <a
                href="/leads?action=import"
                className="ob-hint"
                style={{
                  color: "var(--acr-ink-3)",
                  textDecoration: "underline",
                  textDecorationColor: "transparent",
                  cursor: "pointer",
                  minHeight: 44,
                  display: "inline-flex",
                  alignItems: "center",
                  transition: "color 0.15s, text-decoration-color 0.15s",
                }}
                data-testid="link-import-csv"
              >
                Import a CSV instead
              </a>
              <span style={{ color: "var(--acr-ink-4)", fontSize: 13 }} aria-hidden="true">·</span>
              <a
                href="/leads?action=new"
                className="ob-hint"
                style={{
                  color: "var(--acr-ink-3)",
                  textDecoration: "underline",
                  textDecorationColor: "transparent",
                  cursor: "pointer",
                  minHeight: 44,
                  display: "inline-flex",
                  alignItems: "center",
                  transition: "color 0.15s, text-decoration-color 0.15s",
                }}
                data-testid="link-add-manual"
              >
                Add one lead manually
              </a>
            </div>
          </motion.div>
        );

      case 2: {
        const fu = followUpDraftQuery.data;
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            data-testid="onboarding-step-2"
          >
            <div className="ob-eyebrow">
              <span className="ob-eyebrow-dot" aria-hidden="true" />
              Step 2 · Watch Pax take an action
            </div>
            <h1 className="ob-title">
              Pax drafts. <span className="ob-title-italic">You send.</span>
            </h1>
            <p className="ob-sub">
              Pax found a lead that&rsquo;s gone cold and wrote the follow-up for
              you. Read it, then tap Send. Pax never sends on its own — you tap
              Send every time.
            </p>

            {followUpDraftQuery.isLoading ? (
              <div className="ob-cards" data-testid="follow-up-loading">
                <div className="ob-card">
                  <span className="ob-card-glyph">
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  </span>
                  <span className="ob-card-title">Pax is drafting&hellip;</span>
                  <span className="ob-card-desc">
                    Reviewing your leads to find the best one to re-engage.
                  </span>
                </div>
              </div>
            ) : !fu?.available || !fu.draft || !fu.lead || !fu.draftId || !fu.contentHash ? (
              <div
                className="ob-card"
                data-testid="follow-up-empty"
                style={{ cursor: "default" }}
              >
                <span className="ob-card-glyph">
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="ob-card-title">No stale leads yet</span>
                <span className="ob-card-desc">
                  Load sample data on the previous step (or import your own) and
                  Pax will have a lead to follow up with. You can skip this for
                  now.
                </span>
              </div>
            ) : followUpSent ? (
              <div
                className="ob-card"
                data-testid="follow-up-sent"
                style={{ cursor: "default" }}
              >
                <span className="ob-card-glyph">
                  <Check className="w-4 h-4" style={{ color: "var(--acr-pos)" }} aria-hidden="true" />
                </span>
                <span className="ob-card-title">Sent to {fu.lead.name}</span>
                <span className="ob-card-desc">
                  Pax sent the follow-up and logged the action. That&rsquo;s Pax
                  as an operator, not just an advisor.
                </span>
              </div>
            ) : (
              <div
                style={{
                  marginTop: 16,
                  border: "0.5px solid var(--acr-line)",
                  borderRadius: 12,
                  overflow: "hidden",
                  background: "var(--acr-surface-1)",
                }}
                data-testid="follow-up-draft"
              >
                <div
                  style={{
                    padding: "12px 16px",
                    borderBottom: "0.5px solid var(--acr-line)",
                    font: "400 13px/1.4 var(--font-sans)",
                    color: "var(--acr-ink-3)",
                  }}
                >
                  <div>
                    <strong style={{ color: "var(--acr-ink-2)" }}>To:</strong>{" "}
                    {fu.lead.name} &lt;{fu.lead.email}&gt;
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <strong style={{ color: "var(--acr-ink-2)" }}>Subject:</strong>{" "}
                    {fu.draft.subject}
                  </div>
                </div>
                <p
                  style={{
                    padding: "16px",
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    font: "400 14px/1.6 var(--font-sans)",
                    color: "var(--acr-ink-1)",
                  }}
                >
                  {fu.draft.message}
                </p>
                <div
                  style={{
                    padding: "12px 16px",
                    borderTop: "0.5px solid var(--acr-line)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <span className="ob-hint" style={{ margin: 0 }}>
                    Drafted by Pax · sends only when you tap
                  </span>
                  <button
                    type="button"
                    className="ob-btn ob-btn-primary"
                    onClick={() =>
                      approveSendMutation.mutate({
                        draftId: fu.draftId!,
                        contentHash: fu.contentHash!,
                      })
                    }
                    disabled={approveSendMutation.isPending}
                    aria-label={`Send the follow-up to ${fu.lead.name}`}
                    data-testid="button-approve-send-follow-up"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                  >
                    {approveSendMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="w-4 h-4" aria-hidden="true" />
                    )}
                    {approveSendMutation.isPending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            )}

            <p className="ob-hint" style={{ marginTop: 16 }}>
              Pax operates at the assisted level by default — it drafts, you
              approve. Nothing is sent autonomously.
            </p>
          </motion.div>
        );
      }

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
              Step 3 · Send from your own inbox
            </div>
            <h1 className="ob-title">
              Connect <span className="ob-title-italic">your email.</span>
            </h1>
            <p className="ob-sub">
              Outreach lands in better shape when it leaves from your real
              address. Connect Gmail, Outlook, or any SMTP — replies come
              back to your inbox.
            </p>

            {/* No window.open — navigate inline to email settings.
                Email connect is optional, so Skip (in footer) is
                the expected primary path. The link below is a
                secondary in-app navigation. */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
              <a
                href="/settings?tab=email"
                className="ob-hint"
                style={{ color: "var(--acr-ink-3)", textDecoration: "underline", cursor: "pointer", minHeight: 44, display: "inline-flex", alignItems: "center" }}
                data-testid="link-email-settings"
              >
                Open email settings
              </a>
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

      case 4:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            data-testid="onboarding-step-4"
          >
            <div className="ob-eyebrow">
              <span className="ob-eyebrow-dot" aria-hidden="true" />
              Step 4 · Reach the right sellers
            </div>
            <h1 className="ob-title">
              Your first <span className="ob-title-italic">campaign.</span>
            </h1>
            <p className="ob-sub">
              Pick a template, target leads by score, stage or location, and
              send. Direct mail, email, or SMS — Pax handles the orchestration.
            </p>

            {/* No window.open — navigate inline. Campaign creation is
                optional at this stage; Skip in the footer is the
                expected primary path. */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
              <a
                href="/campaigns"
                className="ob-hint"
                style={{ color: "var(--acr-ink-3)", textDecoration: "underline", cursor: "pointer", minHeight: 44, display: "inline-flex", alignItems: "center" }}
                data-testid="link-open-campaigns"
              >
                Open Marketing Hub
              </a>
            </div>

            <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "grid", gap: 6 }}>
              {[
                "Pre-built templates for every investor type",
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

      case 5:
        return (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            data-testid="onboarding-step-5"
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
