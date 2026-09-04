/**
 * onboarding-v2.tsx — Signup-to-first-value in < 90 seconds.
 *
 * Constitution §7 AI-disclosure gate (commit 6cd48aee) fires first and blocks
 * all interaction until accepted. After that:
 *
 *   Step 1 — Workspace + business type (two inputs, one screen)
 *   Step 2 — Sample data (one big calm primary CTA; manual paths demoted to
 *             secondary text links, all inline — no window.open anywhere)
 *   Step 3 — Reveal ("Pax loaded 50 sample leads") → navigate to the
 *             vertical's finishing destination
 *
 * Founder ruling #12(b) — tailored / skippable / re-runnable:
 *   - TAILORED: every one of the 15 registry verticals gets its own data-step
 *     copy + finishing destination, data-driven from a single per-type map in
 *     client/src/lib/onboarding-verticals.ts (no 15-way component fork).
 *   - SKIPPABLE: a "Skip for now" affordance is visible in the header on
 *     every step → POST /api/onboarding/skip (marks complete with
 *     skipped:true, seeds nothing) → lands on /today. No fake progress.
 *   - RE-RUNNABLE: Settings → "Re-run onboarding" calls POST
 *     /api/onboarding/reset (which PRESERVES businessType/noteRole) and
 *     routes back here; the wizard prefills from the stored onboardingData so
 *     a re-run never silently flips the org back to the land_flipper default.
 *
 * Target: 3 taps + ~45-60 seconds from signup-complete to Today with realistic
 * state (Decision Queue, MorningBrief, Cash Strip). Hank-the-operator approved.
 *
 * SYSTEM-V1.md compliance:
 *   - text-hero on wizard title, text-section-h2 on step headings
 *   - DURATIONS.normal / DURATIONS.slower for step transitions
 *   - staggerContainer + staggerItem on step entry
 *   - --acr-* tokens throughout, no hardcoded colors
 *   - useRespectfulTransition wraps every spatial movement
 *   - One primary action per step
 *   - Mobile-first, one-thumb-operable
 *
 * AI-disclosure: AiDisclosureDialog gate PRESERVED. Any Pax-touching state
 * (sample-data endpoint, provision, persona write) is gated behind
 * disclosureRequired === false. See the guard comment at the render boundary.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  AiDisclosureDialog,
  AI_DISCLOSURE_VERSION,
} from "@/components/onboarding/AiDisclosureDialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Sparkles,
  Upload,
  Map,
  FileText,
  Loader2,
  CheckCircle,
  Home,
  Hammer,
  Key,
  Palmtree,
  Building2,
  Landmark,
  Lightbulb,
  Warehouse,
  Receipt,
  Truck,
  Users,
  TrendingUp,
  FileSignature,
  ClipboardCheck,
  Scissors,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  DURATIONS,
  EASINGS,
  useReducedMotionPreference,
} from "@/lib/motion-tokens";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { clientLogger } from "@/lib/clientLogger";
import type { Persona } from "@shared/models/auth";
import { derivePersona, type BusinessType, type NoteRole } from "@shared/models/persona-mapping";
import {
  getVerticalOnboarding,
  getDataStepCopy,
  resolveWizardPrefill,
} from "@/lib/onboarding-verticals";
import "./styles/onboarding-v2.css";

// ---------------------------------------------------------------------------
// Business type taxonomy — three primary choices surfaced in Step 1.
// Mirrors CORE_INVESTOR_TYPES from OnboardingWizard.tsx so both surfaces
// agree on the canonical three. Secondary verticals are accessible from
// Settings after onboarding completes — we don't avalanche the first screen.
// ---------------------------------------------------------------------------

// BusinessType / NoteRole / persona derivation now come from the shared
// source of truth (@shared/models/persona-mapping) — see import above. The UI
// choice arrays below stay local (they carry labels + icons).

const CORE_CHOICES = [
  {
    value: "land_flipper" as BusinessType,
    label: "Land Flipper",
    description: "Buy raw land at wholesale and resell for profit.",
    icon: Map,
  },
  {
    value: "note_investor" as BusinessType,
    label: "Note Investor",
    description: "Buy, sell, and service mortgage notes and seller-financed paper.",
    icon: FileText,
  },
  {
    value: "hybrid" as BusinessType,
    label: "Hybrid / Multi-Strategy",
    description: "Combine land, notes, and other strategies.",
    icon: Sparkles,
  },
];

// Secondary verticals — collapsed by default. Surfaced via "Show all
// investor types" disclosure so the first impression isn't a 15-card
// avalanche. Without this list, wholesalers / fix-and-flippers /
// landlords / etc were silently mapped to land_investor at signup —
// flagged by the 2026-06-05 customer audit. Pattern ported from the
// legacy OnboardingWizard.tsx (no-longer-mounted but kept as the
// single source of truth for vertical metadata).
const SECONDARY_CHOICES: { value: BusinessType; label: string; description: string; icon: typeof Map }[] = [
  { value: "residential_wholesaler", label: "Residential Wholesaler", icon: Home, description: "Find distressed homes and assign contracts to cash buyers." },
  // The "(waitlist)" tag and the "comps run on land data" description were
  // STALE, and stale in the direction that matters. They described the
  // 2026-07-11 demotion long after the registry recorded its root cause FIXED
  // (residential comps route through the ATTOM provider seam, 2026-07-29) and
  // promoted the vertical to `core` (2026-08). Corrected 2026-08-17.
  //
  // It was a live contradiction across three customer-facing surfaces at once:
  // the public landing rendered fix_and_flip under "full workflow support",
  // /pricing sold the Fix-and-flip pack at $150/mo, and onboarding told the
  // customer who had just paid for it that it was waitlisted and running on
  // land data — which had itself been false for three weeks.
  //
  // Pinned by tests/unit/customerPersonas.test.ts, which now scans this file
  // for "(waitlist)"/"(beta)" tags and checks them against the registry.
  { value: "fix_and_flip", label: "Fix & Flip", icon: Hammer, description: "Renovate-and-resell: rehab budgets and milestones, contractor tracking, and 70%-rule underwriting, on residential comps and valuations." },
  { value: "buy_and_hold", label: "Buy & Hold", icon: Key, description: "Build a long-term rental portfolio for passive income." },
  // STR is core (Wave 5): AcreOS models nightly stays end-to-end — reservations
  // ledger + channel-CSV import, occupancy/ADR/RevPAR, per-stay P&L, turnover
  // scheduling, and operator-set nightly pricing. Honest about what stays out of
  // scope: OTA channel sync (Airbnb, VRBO) and dynamic/market nightly pricing.
  { value: "short_term_rental", label: "Short-Term Rental", icon: Palmtree, description: "Nightly-stay bookings, channel-CSV import, occupancy/ADR/RevPAR, per-stay P&L, turnovers, and your own nightly pricing. OTA channel sync (Airbnb, VRBO) and dynamic market pricing aren't built." },
  { value: "multifamily", label: "Multifamily", icon: Building2, description: "Invest in apartment buildings and 5+ unit properties." },
  { value: "commercial", label: "Commercial", icon: Landmark, description: "Office, retail, industrial, and mixed-use investments." },
  { value: "creative_finance", label: "Creative Finance", icon: Lightbulb, description: "Subject-to, seller financing, wraps, and lease options." },
  { value: "developer", label: "Developer / Entitlements", icon: Warehouse, description: "Land development and entitlements." },
  // W2.5: the Subdivision module (sidebar, businessTypeOnly:["subdivider"])
  // was orphaned — gated on a businessType no onboarding path could set.
  { value: "subdivider", label: "Subdivider", icon: Scissors, description: "Buy acreage, split it into parcels, and sell the pieces." },
  { value: "tax_lien_deed", label: "Tax Lien / Tax Deed", icon: Receipt, description: "Purchase tax liens and tax deeds at county auctions." },
  { value: "mobile_home", label: "Mobile Home / MHP", icon: Truck, description: "Mobile home parks and manufactured housing investments." },
  { value: "agent_investor", label: "Agent-Investor", icon: Users, description: "Licensed agent who also invests — manage clients and your own deals." },
];

const SECONDARY_BUSINESS_TYPES = new Set<BusinessType>(SECONDARY_CHOICES.map((c) => c.value));

// The "Note Investor" businessType covers THREE distinct jobs, each its own
// persona (drives every persona-gated surface). Surfaced only when
// businessType === "note_investor"; persisted via PUT /api/me/persona. The
// role→persona mapping + derivation live in @shared/models/persona-mapping;
// only the UI choice array (labels + icons) is local.
const NOTE_ROLE_CHOICES: { value: NoteRole; label: string; description: string; icon: typeof Map }[] = [
  { value: "invest", label: "I buy notes", description: "Acquire existing notes for yield.", icon: TrendingUp },
  { value: "originate", label: "I create notes", description: "Seller-finance sales into new paper.", icon: FileSignature },
  { value: "service", label: "I service notes", description: "Collect & service notes for others.", icon: ClipboardCheck },
];

/** Canonical persona from businessType (+ note role). Shared with the server. */
function resolvePersona(bt: BusinessType, noteRole: NoteRole): Persona {
  return derivePersona(bt, undefined, noteRole);
}

// ---------------------------------------------------------------------------
// Step definitions — 3 steps post-disclosure. Deliberate minimalism.
// ---------------------------------------------------------------------------

type StepId = "workspace" | "data" | "ready";

const STEPS: StepId[] = ["workspace", "data", "ready"];

// ---------------------------------------------------------------------------
// Inline CSV drop-zone (replaces the window.open → /leads?action=import)
// One-tap drag-and-drop inside the wizard; no new tabs.
// ---------------------------------------------------------------------------

function InlineCsvDropZone({
  onFileSelected,
}: {
  onFileSelected: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const f = e.dataTransfer.files[0];
      if (f && (f.name.endsWith(".csv") || f.name.endsWith(".xlsx"))) {
        onFileSelected(f);
      }
    },
    [onFileSelected],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Select or drop a CSV or XLSX file to import leads"
      onDragEnter={() => setIsDragging(true)}
      onDragLeave={() => setIsDragging(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={cn(
        "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acr-brand",
        isDragging
          ? "border-acr-brand bg-acr-brand-soft/30"
          : "border-acr-line hover:border-acr-brand/50",
      )}
    >
      <Upload
        className="w-8 h-8 text-acr-ink-3 mx-auto mb-2"
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-acr-ink">
        Drop your CSV or XLSX file here
      </p>
      <p className="text-xs text-acr-ink-3 mt-1">or click to browse</p>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx"
        className="hidden"
        aria-label="Lead import file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFileSelected(f);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function OnboardingV2() {
  useDocumentTitle("Welcome to AcreOS");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const reduced = useReducedMotionPreference();

  // Step state
  const [stepIndex, setStepIndex] = useState(0);
  const currentStep = STEPS[stepIndex];

  // Form data
  const [workspaceName, setWorkspaceName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("land_flipper");
  const [showAllInvestorTypes, setShowAllInvestorTypes] = useState(false);
  // Note-role fork — only meaningful when businessType === "note_investor".
  // Drives which persona we persist (invest/originate/service) and how the
  // data step is framed for that role's actual job.
  const [noteRole, setNoteRole] = useState<NoteRole>("invest");
  // Once the user touches the type/role pickers, server prefill must never
  // overwrite their in-progress selection.
  const typeTouchedRef = useRef(false);
  const isNoteBusiness = businessType === "note_investor";
  const resolvedPersona = resolvePersona(businessType, noteRole);
  const vertical = getVerticalOnboarding(businessType);

  // Data-path state (Step 2)
  const [dataPath, setDataPath] = useState<"sample" | "csv" | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<string[][]>([]);
  const [csvImportDone, setCsvImportDone] = useState(false);
  const [sampleDataLoaded, setSampleDataLoaded] = useState(false);

  // ── AI-disclosure gate ────────────────────────────────────────────────────
  // Constitution §7 + Colorado SB 24-205. Must clear before ANY Pax-touching
  // state renders (sample data, provision, persona write). This query runs on
  // mount; while loading we show a content-shaped skeleton.
  const {
    data: disclosureStatus,
    isLoading: disclosureLoading,
    refetch: refetchDisclosure,
  } = useQuery<{ disclosed: boolean; version: string | null; at: string | null }>({
    queryKey: ["/api/me/ai-disclosure/status"],
    queryFn: async () => {
      const resp = await apiRequest("GET", "/api/me/ai-disclosure/status");
      return resp.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  const disclosureRequired =
    !disclosureLoading &&
    disclosureStatus !== undefined &&
    (!disclosureStatus.disclosed ||
      disclosureStatus.version !== AI_DISCLOSURE_VERSION);
  // ── /AI-disclosure gate ───────────────────────────────────────────────────

  // Pre-fill workspace name from org data if available
  const { data: orgData } = useQuery<{ name?: string }>({
    queryKey: ["/api/organization"],
    queryFn: async () => {
      const resp = await apiRequest("GET", "/api/organization");
      return resp.json();
    },
    enabled: !disclosureRequired,
  });

  useEffect(() => {
    if (orgData?.name && !workspaceName) {
      setWorkspaceName(orgData.name);
    }
  }, [orgData, workspaceName]);

  // ── Re-run prefill ────────────────────────────────────────────────────────
  // POST /api/onboarding/reset preserves businessType/noteRole in the org's
  // onboardingData, so a re-run must start from the org's CURRENT type — not
  // the land_flipper default. resolveWizardPrefill only yields values the
  // registry recognizes; anything else leaves the wizard's defaults alone.
  const { data: onboardingStatus } = useQuery<{
    completed: boolean;
    data?: Record<string, unknown>;
  }>({
    queryKey: ["/api/onboarding/status"],
    enabled: !disclosureRequired,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (typeTouchedRef.current) return;
    const prefill = resolveWizardPrefill(onboardingStatus?.data);
    if (prefill.businessType) setBusinessType(prefill.businessType);
    if (prefill.noteRole) setNoteRole(prefill.noteRole);
  }, [onboardingStatus]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  const updateOrgMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("PATCH", "/api/organization", { name });
      if (!res.ok) throw new Error("Failed to update workspace name");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
    },
  });

  // allow-no-invalidation: provisions templates before any app queries exist in the cache — /today fetches fresh after navigate
  const provisionMutation = useMutation({
    mutationFn: async (bt: BusinessType) => {
      const res = await apiRequest("POST", "/api/onboarding/provision", {
        businessType: bt,
      });
      if (!res.ok) throw new Error("Failed to provision templates");
      return res.json();
    },
  });

  const personaMutation = useMutation({
    // Sends BOTH the resolved persona (note-role fork already applied) and the
    // EXACT businessType. Passing businessType makes the server write the same
    // specific value the parallel complete-step writes (no race / no coarsening)
    // and derive the correct investorType (incl. "both" for hybrid). The server
    // /onboarding/complete still derives all three as a safety net if dropped.
    mutationFn: async ({ persona, businessType: bt }: { persona: Persona; businessType: BusinessType }) => {
      const res = await apiRequest("PUT", "/api/me/persona", { persona, businessType: bt });
      return res.json();
    },
    onSuccess: () => {
      // Persona gates nav content — the cached user must not go stale
      // across the SPA navigate() into /today.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    },
  });

  const sampleDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/sample-data", {});
      if (!res.ok) throw new Error("Failed to load sample data");
      return res.json();
    },
    onSuccess: (data) => {
      setSampleDataLoaded(true);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      // Fire complete-step so the checklist knows data was seeded
      completeStepMutation.mutate({
        stepId: 1,
        data: { dataImported: true, sampleDataLoaded: true },
      });
      toast({
        title: "Sample data ready",
        description: `Pax loaded ${data?.counts?.leads ?? 50} leads — your workspace is live.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Couldn't load sample data",
        description: `${getErrorMessage(error)} — your workspace is unchanged.`,
        variant: "destructive",
      });
    },
  });

  const csvImportMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/import/leads", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Import failed");
      return res.json();
    },
    onSuccess: (result) => {
      const count = result.imported ?? result.count ?? 0;
      setCsvImportDone(true);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      completeStepMutation.mutate({
        stepId: 1,
        data: { dataImported: true, csvImported: true },
      });
      toast({
        title: "Import complete",
        description: `${count} leads imported from your file.`,
      });
    },
    onError: () => {
      toast({
        title: "Couldn't import file",
        description:
          "No leads were imported. Check the file format (CSV or XLSX) and try again.",
        variant: "destructive",
      });
    },
  });

  const completeStepMutation = useMutation({
    mutationFn: async ({ stepId, data }: { stepId: number; data?: any }) => {
      const res = await apiRequest("POST", "/api/onboarding/complete-step", {
        stepId,
        data,
      });
      if (!res.ok) throw new Error("Failed to record step");
      return res.json();
    },
    onSuccess: () => {
      // Step progress is read by the onboarding status query — keep the
      // wizard's progress indicators live as steps record.
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
    },
  });

  const completeMutation = useMutation({
    // The finish screen drives toward the vertical's first real job, so the
    // destination is whatever the per-type config names (Map for land loops,
    // rent roll for landlords, redemption clock for tax certs, …).
    mutationFn: async (_destination?: string) => {
      const res = await apiRequest("POST", "/api/onboarding/complete", {
        formData: {
          businessType,
          orgName: workspaceName,
          // noteRole is persisted server-side for the note vertical so a
          // re-run prefills the same role.
          ...(isNoteBusiness ? { noteRole } : {}),
        },
        // Sample-data opt-in. The server seeds by DEFAULT when this flag is
        // absent, so it must be explicit: true only when the user actually
        // took the sample-data path at step 2 (idempotent re-seed), false
        // when they imported a CSV or chose to set up data later — those
        // users must never get surprise sample records.
        seedSampleData: sampleDataLoaded,
        path: "fast",
      });
      if (!res.ok) throw new Error("Failed to complete onboarding");
      return res.json();
    },
    onSuccess: (_data, destination) => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/needs-onboarding"] });
      navigate(destination ?? "/today");
    },
    onError: (error) => {
      toast({
        title: getErrorTitle(error),
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  // Skip — honest and always available (header affordance on every step).
  // POST /api/onboarding/skip marks onboarding complete with skipped:true and
  // seeds NOTHING; the user lands in the real app with an empty workspace.
  // Because the server flips onboardingCompleted, /api/me/needs-onboarding
  // goes false and the OnboardingGate never re-gates a skipped user.
  const skipMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/onboarding/skip", {});
      if (!res.ok) throw new Error("Failed to skip onboarding");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/me/needs-onboarding"] });
      navigate("/today");
    },
    onError: (error) => {
      toast({
        title: "Couldn't skip onboarding",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    },
  });

  // ── Step telemetry (best-effort) ─────────────────────────────────────────
  useEffect(() => {
    if (disclosureRequired) return;
    // unchecked-mutation: onboarding step telemetry. Nothing in the UI claims it was recorded, and a failed beacon must never block the step.
    fetch("/api/onboarding/step-entered", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: stepIndex + 1, path: "fast" }),
    }).catch(() => {
      /* telemetry is best-effort */
    });
  }, [stepIndex, disclosureRequired]);

  // ── CSV file selection handler ───────────────────────────────────────────
  const handleCsvFile = useCallback((file: File) => {
    setCsvFile(file);
    setDataPath("csv");
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      const lines = text
        .split("\n")
        .filter(Boolean)
        .slice(0, 6);
      const rows = lines.map((line) =>
        line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()),
      );
      setCsvPreview(rows);
    };
    reader.readAsText(file);
  }, []);

  // ── Advance to next step ─────────────────────────────────────────────────
  const advanceTo = (index: number) => {
    setStepIndex(index);
  };

  // ── Step 1 submit: save workspace + business type, advance ───────────────
  const handleWorkspaceSubmit = async () => {
    try {
      if (workspaceName && workspaceName !== orgData?.name) {
        await updateOrgMutation.mutateAsync(workspaceName);
      }
      // Fire provision + persona in parallel — both are best-effort;
      // /onboarding/complete will derive persona server-side as safety net.
      // The note-role fork is folded into resolvedPersona so originators +
      // servicers land on their own persona, not the generic note_investor.
      await Promise.allSettled([
        provisionMutation.mutateAsync(businessType),
        personaMutation.mutateAsync({ persona: resolvedPersona, businessType }),
        completeStepMutation.mutateAsync({
          stepId: 0,
          data: {
            businessType,
            organizationName: workspaceName,
            ...(isNoteBusiness ? { noteRole, persona: resolvedPersona } : {}),
          },
        }),
      ]);
      advanceTo(1);
    } catch (error) {
      clientLogger.error("Error saving workspace step", error);
      toast({
        variant: "destructive",
        title: "Couldn't save workspace",
        description:
          error instanceof Error
            ? error.message
            : "Something went wrong. Refresh and try again.",
      });
    }
  };

  // ── Step 2: try sample data ──────────────────────────────────────────────
  const handleTrySampleData = async () => {
    setDataPath("sample");
    await sampleDataMutation.mutateAsync();
    advanceTo(2);
  };

  // ── Step 2: try CSV upload ───────────────────────────────────────────────
  const handleCsvUpload = async () => {
    if (!csvFile) return;
    await csvImportMutation.mutateAsync(csvFile);
    advanceTo(2);
  };

  // ── Step 2: skip (no data) ───────────────────────────────────────────────
  const handleSkipData = async () => {
    await completeStepMutation.mutateAsync({
      stepId: 1,
      data: { skipped: true },
    });
    advanceTo(2);
  };

  // ── Final: complete + navigate ───────────────────────────────────────────
  const handleGoToToday = async () => {
    await completeMutation.mutateAsync("/today");
  };
  // The activation target is the vertical's first real job — the per-type
  // config names the destination (Map/offer for land loops, note book for
  // paper, rent roll for landlords, redemption clock for tax certs, …).
  const handleFinish = async () => {
    await completeMutation.mutateAsync(vertical.finish.path);
  };

  // ── Motion: step transition ──────────────────────────────────────────────
  const stepTransition = reduced
    ? { duration: 0 }
    : { duration: DURATIONS.normal, ease: EASINGS.linearExpo };

  const stepVariants = {
    enter: { opacity: 0, x: 20 },
    center: { opacity: 1, x: 0, transition: stepTransition },
    exit: {
      opacity: 0,
      x: -16,
      transition: { duration: DURATIONS.fast, ease: EASINGS.out },
    },
  };

  const isPendingWorkspace =
    updateOrgMutation.isPending ||
    provisionMutation.isPending ||
    completeStepMutation.isPending;

  const isPendingData =
    sampleDataMutation.isPending ||
    csvImportMutation.isPending ||
    completeStepMutation.isPending;

  const isPendingComplete = completeMutation.isPending;

  // Step 2 copy + entrypoint, tailored per vertical from the single per-type
  // config (client/src/lib/onboarding-verticals.ts). The note vertical's
  // three roles each override with their real first job ("load 50 leads"
  // isn't it). Sample data + CSV stay available for everyone as the fast path.
  const dataStep = getDataStepCopy(businessType, noteRole);
  const dataStepCopy = {
    title: (
      <>
        {dataStep.dataTitle[0]}{" "}
        <span className="ob2-title-italic">{dataStep.dataTitle[1]}</span>
      </>
    ),
    sub: dataStep.dataSub,
    jobLabel: dataStep.jobLabel,
    jobHref: dataStep.jobHref,
  };

  // ── Skeleton while disclosure status loads ───────────────────────────────
  if (disclosureLoading) {
    return (
      <div className="ob2-shell" aria-busy="true" aria-label="Loading">
        <div className="ob2-content">
          <Skeleton className="h-8 w-48 mb-3" />
          <Skeleton className="h-4 w-64 mb-8" />
          <Skeleton className="h-14 w-full rounded-xl mb-3" />
          <Skeleton className="h-14 w-full rounded-xl mb-3" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // ── AI-disclosure gate ────────────────────────────────────────────────────
  // Render skeleton behind the dialog so layout doesn't jump on accept.
  // NOTHING Pax-touching can render before this gate clears.
  if (disclosureRequired) {
    return (
      <div className="ob2-shell">
        <div className="ob2-content">
          <Skeleton className="h-8 w-48 mb-3" />
          <Skeleton className="h-4 w-64 mb-8" />
          <Skeleton className="h-14 w-full rounded-xl mb-3" />
          <Skeleton className="h-14 w-full rounded-xl mb-3" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
        {/* Dialog open=true is non-closable — per AiDisclosureDialog design */}
        <AiDisclosureDialog
          open={true}
          onAccepted={() => {
            // Invalidate so the gate re-evaluates to disclosed===true
            refetchDisclosure();
          }}
        />
      </div>
    );
  }
  // ── /AI-disclosure gate — cleared. All Pax surfaces below are safe to render.

  // Progress dots
  const totalSteps = STEPS.length;

  return (
    <div className="ob2-shell" role="main">
      {/* Paper grain texture — inherited from onboarding.css pattern */}
      <div className="ob2-grain" aria-hidden="true" />

      {/* Header */}
      <header className="ob2-header">
        <div className="ob2-logo" aria-label="AcreOS">
          <span className="ob2-logo-mark" aria-hidden="true">A</span>
          AcreOS
        </div>
        <div className="flex items-center gap-4">
          {/* Progress strip */}
          <nav
            className="ob2-progress"
            aria-label={`Step ${stepIndex + 1} of ${totalSteps}`}
          >
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "ob2-progress-pip",
                  i < stepIndex && "ob2-progress-pip--done",
                  i === stepIndex && "ob2-progress-pip--active",
                )}
                aria-hidden="true"
              />
            ))}
          </nav>
          {/* Skip — always visible, on every step. Honest: marks onboarding
              skipped (no fake progress, nothing seeded) and lands in the app.
              Onboarding can be re-run anytime from Settings. */}
          <button
            type="button"
            className="ob2-link"
            onClick={() => skipMutation.mutate()}
            disabled={skipMutation.isPending || isPendingComplete}
            data-testid="button-skip-onboarding"
          >
            {skipMutation.isPending ? "Skipping…" : "Skip for now"}
          </button>
        </div>
      </header>

      {/* Main content area — step transitions */}
      <AnimatePresence mode="wait">
        {/* ── STEP 0: workspace + business type ──────────────────────────── */}
        {currentStep === "workspace" && (
          <motion.main
            key="workspace"
            className="ob2-stage"
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <div className="ob2-content">
              {/* Eyebrow */}
              <div className="ob2-eyebrow" aria-hidden="true">
                <span className="ob2-eyebrow-dot" />
                Step 1 of {totalSteps}
              </div>

              {/* Title */}
              <h1 className="ob2-title">
                Your workspace,{" "}
                <span className="ob2-title-italic">your way.</span>
              </h1>
              <p className="ob2-sub">
                Takes about 30 seconds. Everything is editable later.
              </p>

              <motion.div
                className="ob2-fields"
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
              >
                {/* Workspace name */}
                <motion.div variants={staggerItem} className="ob2-field">
                  <Label htmlFor="ob2-workspace-name" className="ob2-label">
                    Workspace name
                  </Label>
                  <Input
                    id="ob2-workspace-name"
                    className="ob2-input"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="e.g. Apex Land Group"
                    autoComplete="organization"
                    autoCapitalize="words"
                    data-testid="input-org-name"
                  />
                  <p className="ob2-hint">You can rename this anytime in Settings.</p>
                </motion.div>

                {/* Business type */}
                <motion.div variants={staggerItem} className="ob2-field">
                  <span className="ob2-label" id="ob2-biztype-label">
                    What kind of investing do you do?
                  </span>
                  <RadioGroup
                    value={businessType}
                    onValueChange={(v) => {
                      typeTouchedRef.current = true;
                      setBusinessType(v as BusinessType);
                    }}
                    className="ob2-type-cards"
                    aria-labelledby="ob2-biztype-label"
                  >
                    {CORE_CHOICES.map(({ value, label, description, icon: Icon }) => (
                      <label
                        key={value}
                        htmlFor={`ob2-type-${value}`}
                        className={cn(
                          "ob2-type-card",
                          businessType === value && "ob2-type-card--on",
                        )}
                        data-testid={`option-${value}`}
                      >
                        <RadioGroupItem
                          value={value}
                          id={`ob2-type-${value}`}
                          className="sr-only"
                        />
                        <span className="ob2-type-card-glyph" aria-hidden="true">
                          <Icon className="w-4 h-4" />
                        </span>
                        <span className="ob2-type-card-title">{label}</span>
                        <span className="ob2-type-card-desc">{description}</span>
                      </label>
                    ))}
                  </RadioGroup>
                  {/* Secondary verticals — collapsed by default. Auto-opens
                      if the user previously selected one (e.g. coming back
                      to edit) so their selection is always visible. */}
                  <details
                    style={{ marginTop: 12 }}
                    open={SECONDARY_BUSINESS_TYPES.has(businessType) || showAllInvestorTypes}
                    onToggle={(e) =>
                      setShowAllInvestorTypes((e.target as HTMLDetailsElement).open)
                    }
                    data-testid="details-show-all-investor-types"
                  >
                    <summary
                      className="ob2-hint"
                      style={{ cursor: "pointer", userSelect: "none", marginBottom: 8 }}
                      data-testid="summary-show-all-investor-types"
                    >
                      Show all investor types (beta verticals)
                    </summary>
                    <RadioGroup
                      value={businessType}
                      onValueChange={(v) => {
                      typeTouchedRef.current = true;
                      setBusinessType(v as BusinessType);
                    }}
                      className="ob2-type-cards"
                      aria-labelledby="ob2-biztype-label"
                    >
                      {SECONDARY_CHOICES.map(({ value, label, description, icon: Icon }) => (
                        <label
                          key={value}
                          htmlFor={`ob2-type-${value}`}
                          className={cn(
                            "ob2-type-card",
                            businessType === value && "ob2-type-card--on",
                          )}
                          data-testid={`option-${value}`}
                        >
                          <RadioGroupItem
                            value={value}
                            id={`ob2-type-${value}`}
                            className="sr-only"
                          />
                          <span className="ob2-type-card-glyph" aria-hidden="true">
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="ob2-type-card-title">{label}</span>
                          <span className="ob2-type-card-desc">{description}</span>
                        </label>
                      ))}
                    </RadioGroup>
                  </details>
                  <p className="ob2-hint">
                    Land Flipper is primary. More verticals can be changed in Settings.
                  </p>
                </motion.div>

                {/* Note-role fork — the three note jobs need three different
                    setups. Only shown for "Note Investor"; sets the persona
                    that drives the rest of the product. */}
                {isNoteBusiness && (
                  <motion.div variants={staggerItem} className="ob2-field" data-testid="note-role-fork">
                    <span className="ob2-label" id="ob2-noterole-label">
                      How do you work with notes?
                    </span>
                    <RadioGroup
                      value={noteRole}
                      onValueChange={(v) => {
                        typeTouchedRef.current = true;
                        setNoteRole(v as NoteRole);
                      }}
                      className="ob2-type-cards"
                      aria-labelledby="ob2-noterole-label"
                    >
                      {NOTE_ROLE_CHOICES.map(({ value, label, description, icon: Icon }) => (
                        <label
                          key={value}
                          htmlFor={`ob2-noterole-${value}`}
                          className={cn(
                            "ob2-type-card",
                            noteRole === value && "ob2-type-card--on",
                          )}
                          data-testid={`option-noterole-${value}`}
                        >
                          <RadioGroupItem
                            value={value}
                            id={`ob2-noterole-${value}`}
                            className="sr-only"
                          />
                          <span className="ob2-type-card-glyph" aria-hidden="true">
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="ob2-type-card-title">{label}</span>
                          <span className="ob2-type-card-desc">{description}</span>
                        </label>
                      ))}
                    </RadioGroup>
                    <p className="ob2-hint">
                      This tailors your setup — buyers import a portfolio,
                      originators set rate &amp; term defaults, servicers set
                      fee &amp; escrow. Changeable later in Settings.
                    </p>
                  </motion.div>
                )}
              </motion.div>
            </div>

            {/* Footer CTA */}
            <footer className="ob2-footer">
              <Button
                className="ob2-btn-primary w-full"
                onClick={handleWorkspaceSubmit}
                disabled={!workspaceName.trim() || isPendingWorkspace}
                data-testid="button-continue-workspace"
              >
                {isPendingWorkspace ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                    Setting up…
                  </>
                ) : (
                  "Continue →"
                )}
              </Button>
            </footer>
          </motion.main>
        )}

        {/* ── STEP 1: data loading ────────────────────────────────────────── */}
        {currentStep === "data" && (
          <motion.main
            key="data"
            className="ob2-stage"
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <div className="ob2-content">
              <div className="ob2-eyebrow" aria-hidden="true">
                <span className="ob2-eyebrow-dot" />
                Step 2 of {totalSteps}
              </div>

              <h1 className="ob2-title">{dataStepCopy.title}</h1>
              <p className="ob2-sub">{dataStepCopy.sub}</p>

              {/* Primary CTA — sample data */}
              <motion.div
                variants={staggerContainer}
                initial="hidden"
                animate="visible"
                className="ob2-data-options"
              >
                <motion.div variants={staggerItem}>
                  <button
                    type="button"
                    className={cn(
                      "ob2-sample-card",
                      dataPath === "sample" && "ob2-sample-card--active",
                    )}
                    onClick={handleTrySampleData}
                    disabled={isPendingData}
                    data-testid="card-load-sample-data"
                    aria-label="Try with sample data — Pax loads 50 realistic leads"
                  >
                    <span className="ob2-sample-card-glyph" aria-hidden="true">
                      {sampleDataMutation.isPending ? (
                        <Loader2 className="w-6 h-6 animate-spin" />
                      ) : sampleDataLoaded ? (
                        <CheckCircle className="w-6 h-6 text-acr-pos" />
                      ) : (
                        <Sparkles className="w-6 h-6" />
                      )}
                    </span>
                    <div className="ob2-sample-card-body">
                      <span className="ob2-sample-card-title">
                        Try with sample data
                        <span className="ob2-sample-card-badge" aria-label="Recommended">
                          Recommended
                        </span>
                      </span>
                      <span className="ob2-sample-card-desc">
                        Pax loads 50 realistic leads so Today is alive from the start.
                        You'll approve before anything goes out. You'll wipe them when you're ready for real data.
                      </span>
                    </div>
                  </button>
                </motion.div>

                {/* Secondary: CSV drop-zone (inline — no window.open) */}
                {dataPath === "csv" ? (
                  <motion.div variants={staggerItem} className="ob2-secondary-zone">
                    <p className="ob2-secondary-label">Import your own leads</p>
                    {!csvFile ? (
                      <InlineCsvDropZone onFileSelected={handleCsvFile} />
                    ) : (
                      <div className="ob2-csv-file">
                        <span className="ob2-csv-filename">{csvFile.name}</span>
                        <button
                          type="button"
                          className="ob2-csv-change"
                          onClick={() => {
                            setCsvFile(null);
                            setCsvPreview([]);
                          }}
                          aria-label={`Remove ${csvFile.name} and choose a different file`}
                        >
                          Change file
                        </button>
                      </div>
                    )}
                    {csvFile && !csvImportDone && (
                      <Button
                        className="ob2-btn-secondary w-full mt-3"
                        onClick={handleCsvUpload}
                        disabled={csvImportMutation.isPending}
                      >
                        {csvImportMutation.isPending ? (
                          <>
                            <Loader2
                              className="w-4 h-4 mr-2 animate-spin"
                              aria-hidden="true"
                            />
                            Importing…
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-2" aria-hidden="true" />
                            Import {csvPreview.length > 1
                              ? `${csvPreview.length - 1} rows`
                              : "file"}
                          </>
                        )}
                      </Button>
                    )}
                    {csvImportDone && (
                      <div
                        className="ob2-success-note"
                        role="status"
                        aria-live="polite"
                      >
                        <CheckCircle className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                        Leads imported successfully.
                      </div>
                    )}
                  </motion.div>
                ) : (
                  /* Secondary text links — intentionally low-weight */
                  <motion.div variants={staggerItem} className="ob2-secondary-links">
                    {dataStepCopy.jobHref && dataStepCopy.jobLabel && (
                      <>
                        <a
                          href={dataStepCopy.jobHref}
                          className="ob2-link"
                          data-testid="link-note-role-job"
                        >
                          {dataStepCopy.jobLabel}
                        </a>
                        <span className="ob2-link-sep" aria-hidden="true">·</span>
                      </>
                    )}
                    <button
                      type="button"
                      className="ob2-link"
                      onClick={() => setDataPath("csv")}
                      disabled={isPendingData}
                    >
                      Import a CSV instead
                    </button>
                    <span className="ob2-link-sep" aria-hidden="true">·</span>
                    <button
                      type="button"
                      className="ob2-link"
                      onClick={handleSkipData}
                      disabled={isPendingData}
                    >
                      Set up data later
                    </button>
                  </motion.div>
                )}
              </motion.div>
            </div>

            {/* Footer: back link only — primary action is the sample card */}
            <footer className="ob2-footer ob2-footer--back-only">
              <button
                type="button"
                className="ob2-back"
                onClick={() => advanceTo(0)}
                disabled={isPendingData}
              >
                ← Back
              </button>
            </footer>
          </motion.main>
        )}

        {/* ── STEP 2: ready reveal ─────────────────────────────────────────── */}
        {currentStep === "ready" && (
          <motion.main
            key="ready"
            className="ob2-stage ob2-stage--centered"
            variants={stepVariants}
            initial="enter"
            animate="center"
            exit="exit"
          >
            <div className="ob2-content ob2-content--centered">
              {/* Celebration mark */}
              <motion.div
                className="ob2-reveal-icon"
                initial={reduced ? {} : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : {
                        type: "spring",
                        stiffness: 400,
                        damping: 12,
                        delay: 0.05,
                      }
                }
                aria-hidden="true"
              >
                <CheckCircle className="w-8 h-8 text-white" />
              </motion.div>

              <motion.h1
                className="ob2-reveal-title"
                initial={reduced ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : {
                        duration: DURATIONS.normal,
                        ease: EASINGS.out,
                        delay: 0.15,
                      }
                }
              >
                Your workspace is ready.
              </motion.h1>

              <motion.p
                className="ob2-reveal-sub"
                initial={reduced ? {} : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={
                  reduced
                    ? { duration: 0 }
                    : {
                        duration: DURATIONS.normal,
                        ease: EASINGS.out,
                        delay: 0.25,
                      }
                }
              >
                {sampleDataLoaded
                  ? "Sample data is loaded and Today is live. "
                  : csvImportDone
                    ? "Your leads are imported and Today is live. "
                    : "Pax is ready — data can wait on the checklist whenever you need it. You'll approve before anything goes out. "}
                {vertical.finish.blurb}
              </motion.p>
            </div>

            <footer className="ob2-footer">
              <Button
                className="ob2-btn-primary w-full"
                onClick={handleFinish}
                disabled={isPendingComplete}
                data-testid="button-finish-onboarding"
              >
                {isPendingComplete ? (
                  <>
                    <Loader2
                      className="w-4 h-4 mr-2 animate-spin"
                      aria-hidden="true"
                    />
                    Opening…
                  </>
                ) : (
                  vertical.finish.cta
                )}
              </Button>
              {vertical.finish.path !== "/today" && (
                <Button
                  variant="ghost"
                  className="w-full mt-2"
                  onClick={handleGoToToday}
                  disabled={isPendingComplete}
                  data-testid="button-go-to-today"
                >
                  Go to Today instead
                </Button>
              )}
            </footer>
          </motion.main>
        )}
      </AnimatePresence>
    </div>
  );
}
