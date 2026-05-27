/**
 * /founder/growth/campaigns — Growth & Ads wizard (extracted F-D #5 Phase B).
 *
 * Per docs/exhaustive-completion/founder-dashboard-growth-extraction-phase-A.md.
 * Pure move; no behavior change. Same /api/founder/growth/* endpoints,
 * same query keys, same 4-step wizard state machine.
 */

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Megaphone, Wand2, Key, Sparkles, Loader2, Check, ChevronLeft, Send,
  Image as ImageIcon, PencilLine, Layers, Radio, Target, RotateCcw,
  Users2, Flame, Heart, HelpCircle, MousePointerClick, RefreshCw,
  Pause, Play, CheckCircle2,
} from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface GrowthCampaignItem {
  id: number;
  name: string;
  templateKey: string;
  status: string;
  externalCampaignId: string | null;
  dailyBudgetCents: number;
  totalSpendCents: number;
  impressions: number;
  clicks: number;
  signups: number;
  createdAt: string;
}

interface AdAccount {
  adAccountId: string;
  pixelId: string | null;
  isActive: boolean;
  accessToken: string;
}

interface CampaignTemplate {
  key: string;
  name: string;
  objective: string;
  headline: string;
  description: string;
}

interface SignupAttribution {
  organizationId: number;
  name: string;
  subscriptionTier: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  createdAt: string;
}

interface AdCopyVariant {
  angle: string;
  angleLabel: string;
  headline: string;
  primaryText: string;
  description: string;
  callToAction: string;
  hook: string;
}

interface GeneratedAdImage {
  style: string;
  styleLabel: string;
  url: string;
  aspectRatio: string;
  metaImageHash?: string;
}

interface CreativeBundle {
  id: string;
  templateKey: string;
  status: "generating" | "ready" | "error" | "deployed";
  copies: AdCopyVariant[] | null;
  images: GeneratedAdImage[] | null;
  error: string | null;
}

const ANGLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  pain_point: Flame,
  aspiration: Heart,
  social_proof: Users2,
  curiosity: HelpCircle,
};

const ANGLE_COLORS: Record<string, string> = {
  pain_point: "border-acr-neg/30 bg-acr-neg-soft/50 dark:border-acr-neg-soft/40 dark:bg-acr-neg-soft/20",
  aspiration: "border-acr-brand-soft bg-acr-brand-soft/50 dark:border-acr-brand-soft/40 dark:bg-acr-brand-soft/20",
  social_proof: "border-acr-accent bg-acr-accent/50 dark:border-acr-accent/40 dark:bg-acr-accent/20",
  curiosity: "border-acr-warn/30 bg-acr-warn-soft/50 dark:border-acr-warn-soft/40 dark:bg-acr-warn-soft/20",
};

export default function FounderGrowthCampaignsPage() {
  useDocumentTitle("Growth campaigns — AcreOS");
  const { toast } = useToast();

  // Ad account form
  const [showAdAccountForm, setShowAdAccountForm] = useState(false);
  const [adForm, setAdForm] = useState({ adAccountId: "", accessToken: "", pixelId: "", appId: "" });

  // Campaign wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<"setup" | "generating" | "preview" | "deploy">("setup");
  const [wizardTemplate, setWizardTemplate] = useState("");
  const [wizardName, setWizardName] = useState("");
  const [wizardBudget, setWizardBudget] = useState("2000");
  const [bundleId, setBundleId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<CreativeBundle | null>(null);
  const [editingCopy, setEditingCopy] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<AdCopyVariant>>({});
  const [selectedImageIdx, setSelectedImageIdx] = useState(0);
  const [regeneratingAngle, setRegeneratingAngle] = useState<string | null>(null);

  const { data: adAccount, refetch: refetchAccount } = useQuery<AdAccount | null>({
    queryKey: ["/api/founder/growth/ad-account"],
  });

  const { data: campaigns, refetch: refetchCampaigns } = useQuery<GrowthCampaignItem[]>({
    queryKey: ["/api/founder/growth/campaigns"],
  });

  const { data: templates } = useQuery<CampaignTemplate[]>({
    queryKey: ["/api/founder/growth/templates"],
  });

  const { data: attribution } = useQuery<SignupAttribution[]>({
    queryKey: ["/api/founder/growth/attribution"],
  });

  const { data: bundleData } = useQuery<CreativeBundle>({
    queryKey: [`/api/founder/growth/creative-bundles/${bundleId}`],
    enabled: !!bundleId && wizardStep === "generating",
    refetchInterval: (query) => {
      const data = query.state.data as CreativeBundle | undefined;
      if (data?.status === "generating") return 2000;
      return false;
    },
  });

  useEffect(() => {
    if (bundleData?.status === "ready" && wizardStep === "generating") {
      setBundle(bundleData);
      setWizardStep("preview");
      setSelectedImageIdx(0);
    }
    if (bundleData?.status === "error" && wizardStep === "generating") {
      toast({ title: "Couldn't generate creative", description: `${bundleData.error || "Try again"} — no bundle was saved.`, variant: "destructive" });
      setWizardStep("setup");
      setBundleId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleData, wizardStep]);

  const saveAdAccountMutation = useMutation({
    mutationFn: async (data: typeof adForm) => apiRequest("PUT", "/api/founder/growth/ad-account", data),
    onSuccess: () => { refetchAccount(); setShowAdAccountForm(false); toast({ title: "Ad account saved" }); },
    onError: () => toast({ title: "Couldn't save ad account", description: "Your existing ad account credentials are unchanged.", variant: "destructive" }),
  });

  const generateCreativeMutation = useMutation({
    mutationFn: async ({ templateKey }: { templateKey: string }) =>
      apiRequest("POST", "/api/founder/growth/generate-creative", { templateKey }).then((r) => r.json()),
    onSuccess: (data: { bundleId: string }) => {
      setBundleId(data.bundleId);
      setWizardStep("generating");
    },
    onError: (err: any) => toast({ title: "Couldn't start generation", description: `${err?.message || "Try again"} — no creative bundle was generated.`, variant: "destructive" }),
  });

  const regenerateCopyMutation = useMutation({
    mutationFn: async ({ id, angle }: { id: string; angle: string }) =>
      apiRequest("POST", `/api/founder/growth/creative-bundles/${id}/regenerate-copy`, { angle }).then((r) => r.json()),
    onSuccess: (data: CreativeBundle) => {
      setBundle(data);
      setRegeneratingAngle(null);
      toast({ title: "Copy variant refreshed" });
    },
    onError: () => { setRegeneratingAngle(null); toast({ title: "Couldn't regenerate copy", description: "The existing variant is unchanged.", variant: "destructive" }); },
  });

  const deployMutation = useMutation({
    mutationFn: async () => {
      if (!bundleId) throw new Error("No bundle");
      const budgetCents = parseInt(wizardBudget) || 2000;
      return apiRequest("POST", `/api/founder/growth/creative-bundles/${bundleId}/deploy`, {
        name: wizardName,
        dailyBudgetCents: budgetCents,
        targetCountries: ["US"],
      }).then((r) => r.json());
    },
    onSuccess: () => {
      refetchCampaigns();
      setWizardOpen(false);
      resetWizard();
      toast({ title: "Campaign deployed!", description: "Check Meta Ads Manager to activate it." });
    },
    onError: (err: any) => toast({ title: "Couldn't deploy campaign", description: `${err?.message || "Try again"} — no campaign was created in Meta.`, variant: "destructive" }),
  });

  const toggleCampaignMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) =>
      apiRequest("PUT", `/api/founder/growth/campaigns/${id}/status`, { status }),
    onSuccess: () => { refetchCampaigns(); toast({ title: "Campaign updated" }); },
    onError: () => toast({ title: "Couldn't update campaign", description: "The campaign's existing status is unchanged.", variant: "destructive" }),
  });

  const syncStatsMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/founder/growth/campaigns/${id}/sync`),
    onSuccess: () => { refetchCampaigns(); toast({ title: "Stats synced" }); },
    onError: () => toast({ title: "Couldn't sync stats", description: "Last-known stats are still displayed.", variant: "destructive" }),
  });

  function resetWizard() {
    setWizardStep("setup");
    setWizardTemplate("");
    setWizardName("");
    setWizardBudget("2000");
    setBundleId(null);
    setBundle(null);
    setEditingCopy(null);
    setEditDraft({});
    setSelectedImageIdx(0);
  }

  function saveCopyEdit(angle: string) {
    if (!bundle?.copies) return;
    const updated: CreativeBundle = {
      ...bundle,
      copies: bundle.copies.map((c) => c.angle === angle ? { ...c, ...editDraft } : c),
    };
    setBundle(updated);
    setEditingCopy(null);
    setEditDraft({});
  }

  const statusColors: Record<string, string> = {
    active: "bg-acr-pos-soft text-acr-pos border-[color:var(--acr-pos)]/20",
    paused: "bg-acr-warn-soft text-acr-warn border-[color:var(--acr-warn)]/20",
    draft: "bg-acr-surface-2 text-acr-ink-3 border-transparent",
    completed: "bg-acr-brand-soft text-acr-brand border-[color:var(--acr-brand)]/20",
  };

  const TEMPLATE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; tagline: string }> = {
    land_investors_signup: { icon: Target, color: "text-acr-pos", tagline: "Cold audience — land investors & buyers" },
    retargeting_visitors: { icon: RotateCcw, color: "text-acr-warn", tagline: "Warm audience — website visitors who didn't convert" },
    lookalike_subscribers: { icon: Users2, color: "text-acr-brand", tagline: "Lookalike — similar to your current subscribers" },
  };

  const sourceCounts = (attribution || []).reduce<Record<string, number>>((acc, s) => {
    const src = s.utmSource || "organic";
    acc[src] = (acc[src] || 0) + 1;
    return acc;
  }, {});

  const dailyBudgetDollars = Math.round(parseInt(wizardBudget || "2000") / 100);

  return (
    <PageShell label="Growth campaigns">
      <div className="p-6 border rounded-xl bg-card space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-primary" aria-hidden="true" />
              Growth &amp; Ads
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              AI-generated campaigns with 4 copy variants and 3 images. Deploy in one click.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowAdAccountForm(true)}>
              <Key className="w-3 h-3 mr-1" aria-hidden="true" />
              {adAccount ? "Update Ad Account" : "Connect Meta"}
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-gradient-to-r from-primary to-accent text-white font-semibold"
              onClick={() => { resetWizard(); setWizardOpen(true); }}
              disabled={!adAccount}
            >
              <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
              Generate Campaign
            </Button>
          </div>
        </div>

        {/* Ad account connection form */}
        {showAdAccountForm && (
          <div className="p-4 border rounded-card bg-muted/30 space-y-3">
            <h3 className="font-medium text-sm">Meta ad-account credentials</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="ad-account-id" className="text-xs text-muted-foreground mb-1 block">Ad account ID</Label>
                <Input id="ad-account-id" placeholder="act_123456789" className="h-8 text-sm" value={adForm.adAccountId}
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  onChange={(e) => setAdForm((f) => ({ ...f, adAccountId: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="meta-access-token" className="text-xs text-muted-foreground mb-1 block">Access token</Label>
                <Input id="meta-access-token" type="password" placeholder="EAAxxxxxxx" className="h-8 text-sm" value={adForm.accessToken}
                  autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                  onChange={(e) => setAdForm((f) => ({ ...f, accessToken: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="meta-pixel-id" className="text-xs text-muted-foreground mb-1 block">Pixel ID <span className="text-muted-foreground/70">(for conversion tracking)</span></Label>
                <Input id="meta-pixel-id" placeholder="123456789" className="h-8 text-sm" value={adForm.pixelId}
                  inputMode="numeric" autoComplete="off"
                  onChange={(e) => setAdForm((f) => ({ ...f, pixelId: e.target.value }))} />
              </div>
              <div>
                <Label htmlFor="meta-app-id" className="text-xs text-muted-foreground mb-1 block">Facebook page / app ID</Label>
                <Input id="meta-app-id" placeholder="Meta page or app ID" className="h-8 text-sm" value={adForm.appId}
                  autoComplete="off"
                  onChange={(e) => setAdForm((f) => ({ ...f, appId: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => saveAdAccountMutation.mutate(adForm)}
                disabled={saveAdAccountMutation.isPending || !adForm.adAccountId || !adForm.accessToken}>
                Save Credentials
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAdAccountForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {adAccount && (
          <div className="flex items-center gap-2 p-2.5 bg-acr-pos/5 border border-acr-pos/20 rounded-card">
            <CheckCircle2 className="w-4 h-4 text-acr-pos shrink-0" aria-hidden="true" />
            <span className="text-sm text-acr-pos font-medium">Meta ad account connected</span>
            <span className="text-sm text-muted-foreground ml-1">{adAccount.adAccountId}</span>
            {adAccount.pixelId && <Badge className="text-xs ml-auto">Pixel active</Badge>}
          </div>
        )}

        {!adAccount && (
          <div className="p-4 border border-dashed rounded-card text-center text-sm text-muted-foreground">
            Connect your Meta ad account above to enable campaign generation and deployment.
          </div>
        )}

        {/* Campaign Wizard Dialog */}
        <Dialog open={wizardOpen} onOpenChange={(o) => { if (!o) { setWizardOpen(false); } }}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-primary" aria-hidden="true" />
                {wizardStep === "setup" && "New Campaign — Setup"}
                {wizardStep === "generating" && "Generating AI Creatives…"}
                {wizardStep === "preview" && "Preview & Edit Creatives"}
                {wizardStep === "deploy" && "Ready to Deploy"}
              </DialogTitle>
              <DialogDescription>
                {wizardStep === "setup" && "Choose a campaign template and budget, then let AI generate your creatives."}
                {wizardStep === "generating" && "GPT-4o is writing 4 copy variants while DALL-E 3 generates 3 HD images. Takes ~30–60 seconds."}
                {wizardStep === "preview" && "Review and edit each ad variant. All 4 copy angles + 3 images will run as A/B tests."}
                {wizardStep === "deploy" && "Campaign will be created in Meta Ads Manager in PAUSED state. Activate it there when ready."}
              </DialogDescription>
            </DialogHeader>

            {/* ── Step 1: Setup ──────────────────────────────────────────── */}
            {wizardStep === "setup" && (
              <div className="space-y-5 pt-2">
                <div>
                  <p id="campaign-template-label" className="text-sm font-medium mb-2">Campaign template</p>
                  <div role="radiogroup" aria-labelledby="campaign-template-label" className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {(templates || []).map((t) => {
                      const meta = TEMPLATE_META[t.key] || { icon: Radio, color: "text-primary", tagline: t.description };
                      const Icon = meta.icon;
                      const isSelected = wizardTemplate === t.key;
                      return (
                        <button
                          key={t.key}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => setWizardTemplate(t.key)}
                          className={`p-4 border-2 rounded-xl text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            isSelected
                              ? "border-primary bg-primary/5 shadow-sm"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          <Icon className={`w-5 h-5 mb-2 ${meta.color}`} aria-hidden="true" />
                          <div className="font-medium text-sm">{t.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{meta.tagline}</div>
                          <div className="text-xs text-muted-foreground mt-1 italic">"{t.headline}"</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="campaign-name" className="text-sm font-medium mb-1.5 block">Campaign name</Label>
                    <Input
                      id="campaign-name"
                      placeholder="e.g. AcreOS – Real Estate Pros – March 2026"
                      value={wizardName}
                      onChange={(e) => setWizardName(e.target.value)}
                      autoCapitalize="words"
                    />
                  </div>
                  <div>
                    <Label htmlFor="campaign-budget" className="text-sm font-medium mb-1.5 block flex justify-between">
                      Daily budget
                      <span className="font-semibold text-primary">${dailyBudgetDollars}/day</span>
                    </Label>
                    <input
                      id="campaign-budget"
                      type="range"
                      min="1000"
                      max="50000"
                      step="500"
                      value={wizardBudget}
                      onChange={(e) => setWizardBudget(e.target.value)}
                      aria-valuetext={`$${dailyBudgetDollars} per day`}
                      className="w-full accent-primary"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-0.5">
                      <span>$10/day</span>
                      <span>$500/day</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-card text-xs text-muted-foreground">
                  <Sparkles className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                  <span>
                    AI will generate <strong>4 copy variants</strong> (pain point, aspiration, social proof, curiosity hook)
                    and <strong>3 DALL-E 3 HD images</strong> (lifestyle, product UI, aerial land). All will run as A/B tests
                    within a single ad set.
                  </span>
                </div>

                <DialogFooter>
                  <Button variant="ghost" onClick={() => setWizardOpen(false)}>Cancel</Button>
                  <Button
                    onClick={() => generateCreativeMutation.mutate({ templateKey: wizardTemplate })}
                    disabled={!wizardTemplate || !wizardName || generateCreativeMutation.isPending}
                    className="gap-2"
                  >
                    {generateCreativeMutation.isPending
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Wand2 className="w-4 h-4" />}
                    Generate AI Creatives
                  </Button>
                </DialogFooter>
              </div>
            )}

            {/* ── Step 2: Generating ──────────────────────────────────────── */}
            {wizardStep === "generating" && (
              <div className="py-12 text-center space-y-6">
                <div className="relative mx-auto w-20 h-20">
                  <div className="absolute inset-0 rounded-full bg-primary/10 animate-ping" />
                  <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-primary/15">
                    <Sparkles className="w-9 h-9 text-primary animate-pulse" aria-hidden="true" />
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-lg">AI is crafting your campaign</h3>
                  <p className="text-muted-foreground text-sm mt-1 max-w-sm mx-auto">
                    Writing 4 persuasion-angle copy variants and generating 3 HD images designed specifically for land investor audiences.
                  </p>
                </div>
                <div className="flex flex-col gap-2 max-w-xs mx-auto text-left">
                  {[
                    { label: "GPT-4o writing copy variants" },
                    { label: "DALL-E 3 generating lifestyle image" },
                    { label: "DALL-E 3 generating product UI image" },
                    { label: "DALL-E 3 generating aerial land image" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin text-primary shrink-0" aria-hidden="true" />
                      {item.label}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Usually takes 30–60 seconds…</p>
              </div>
            )}

            {/* ── Step 3: Preview ─────────────────────────────────────────── */}
            {wizardStep === "preview" && bundle && (
              <div className="space-y-5 pt-1">
                {/* Images row */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <ImageIcon className="w-4 h-4 text-primary" aria-hidden="true" />
                    <span className="font-medium text-sm">Generated Images <span className="text-muted-foreground font-normal">(click to select for preview)</span></span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {(bundle.images || []).map((img, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedImageIdx(idx)}
                        className={`relative rounded-card overflow-hidden border-2 transition-all aspect-square ${
                          selectedImageIdx === idx ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/50"
                        }`}
                      >
                        <img src={img.url} alt={img.styleLabel} className="w-full h-full object-cover" />
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-xs py-1 px-2 text-center">
                          {img.styleLabel}
                        </div>
                        {selectedImageIdx === idx && (
                          <div className="absolute top-1.5 right-1.5 bg-primary rounded-full p-0.5">
                            <Check className="w-3 h-3 text-white" aria-hidden="true" />
                          </div>
                        )}
                      </button>
                    ))}
                    {(bundle.images?.length || 0) === 0 && (
                      <div className="col-span-3 p-4 border border-dashed rounded-card text-center text-sm text-muted-foreground">
                        Image generation failed. Campaign will deploy without images.
                      </div>
                    )}
                  </div>
                </div>

                {/* Copy variants */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <PencilLine className="w-4 h-4 text-primary" aria-hidden="true" />
                    <span className="font-medium text-sm">Copy Variants <span className="text-muted-foreground font-normal">(4 angles running as A/B test)</span></span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(bundle.copies || []).map((copy) => {
                      const Icon = ANGLE_ICONS[copy.angle] || Radio;
                      const colorClass = ANGLE_COLORS[copy.angle] || "border-border";
                      const isEditing = editingCopy === copy.angle;
                      const isRegenerating = regeneratingAngle === copy.angle;

                      return (
                        <div key={copy.angle} className={`p-3.5 border rounded-xl ${colorClass}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-1.5">
                              <Icon className="w-3.5 h-3.5" />
                              <span className="text-xs font-semibold uppercase tracking-wide">{copy.angleLabel}</span>
                            </div>
                            <div className="flex gap-1">
                              <button
                                type="button"
                                title="Regenerate this variant"
                                onClick={() => {
                                  if (!bundleId) return;
                                  setRegeneratingAngle(copy.angle);
                                  regenerateCopyMutation.mutate({ id: bundleId, angle: copy.angle });
                                }}
                                disabled={isRegenerating || !!regeneratingAngle}
                                className="p-1 rounded hover:bg-black/5 disabled:opacity-40"
                              >
                                {isRegenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                              </button>
                              <button
                                type="button"
                                title="Edit copy"
                                onClick={() => {
                                  if (isEditing) { saveCopyEdit(copy.angle); }
                                  else { setEditingCopy(copy.angle); setEditDraft({ ...copy }); }
                                }}
                                className="p-1 rounded hover:bg-black/5"
                              >
                                {isEditing ? <Check className="w-3 h-3 text-acr-pos" /> : <PencilLine className="w-3 h-3" />}
                              </button>
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="space-y-1.5 text-sm">
                              <div>
                                <Label htmlFor={`copy-headline-${copy.angle}`} className="text-xs text-muted-foreground">Headline <span className="text-muted-foreground/70">(≤40 chars)</span></Label>
                                <Input
                                  id={`copy-headline-${copy.angle}`}
                                  value={editDraft.headline || ""}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, headline: e.target.value.slice(0, 40) }))}
                                  maxLength={40}
                                  className="h-7 text-xs mt-0.5"
                                />
                              </div>
                              <div>
                                <Label htmlFor={`copy-primary-${copy.angle}`} className="text-xs text-muted-foreground">Primary text <span className="text-muted-foreground/70">(≤125 chars)</span></Label>
                                <Textarea
                                  id={`copy-primary-${copy.angle}`}
                                  value={editDraft.primaryText || ""}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, primaryText: e.target.value.slice(0, 125) }))}
                                  maxLength={125}
                                  className="text-xs min-h-[60px] mt-0.5 resize-none"
                                  rows={3}
                                />
                              </div>
                              <div>
                                <Label htmlFor={`copy-description-${copy.angle}`} className="text-xs text-muted-foreground">Description <span className="text-muted-foreground/70">(≤30 chars)</span></Label>
                                <Input
                                  id={`copy-description-${copy.angle}`}
                                  value={editDraft.description || ""}
                                  onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value.slice(0, 30) }))}
                                  maxLength={30}
                                  className="h-7 text-xs mt-0.5"
                                />
                              </div>
                              <Button size="sm" className="w-full h-7 text-xs mt-1" onClick={() => saveCopyEdit(copy.angle)}>
                                <Check className="w-3 h-3 mr-1" /> Save
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-1 text-sm">
                              <div className="font-semibold leading-tight">{copy.headline}</div>
                              <p className="text-muted-foreground text-xs leading-relaxed">{copy.primaryText}</p>
                              <div className="flex items-center justify-between pt-1">
                                <span className="text-xs text-muted-foreground italic">{copy.description}</span>
                                <Badge variant="outline" className="text-xs h-5">{copy.callToAction}</Badge>
                              </div>
                              {copy.hook && (
                                <div className="text-xs text-muted-foreground/70 border-t pt-1 mt-1 italic">
                                  Hook: {copy.hook}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2 p-3 bg-muted/40 rounded-card text-xs text-muted-foreground">
                  <Layers className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                  <span>
                    Deploying creates <strong>1 campaign</strong> → <strong>1 ad set</strong> → <strong>{bundle.copies?.length || 4} ads</strong>, one per copy variant.
                    Meta will automatically optimize toward the best performer.
                  </span>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2">
                  <Button variant="ghost" onClick={() => setWizardStep("setup")} className="gap-1">
                    <ChevronLeft className="w-4 h-4" /> Back
                  </Button>
                  <Button
                    onClick={() => deployMutation.mutate()}
                    disabled={deployMutation.isPending || !wizardName}
                    className="gap-2 bg-gradient-to-r from-primary to-accent text-white"
                  >
                    {deployMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Deploy {bundle.copies?.length || 4} Ad Variants to Meta
                  </Button>
                </DialogFooter>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Live Campaigns */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-sm flex items-center gap-2">
              <Radio className="w-4 h-4 text-primary" aria-hidden="true" />
              Live Campaigns
              {(campaigns?.length || 0) > 0 && (
                <Badge variant="outline" className="text-xs">{campaigns!.length}</Badge>
              )}
            </h3>
            {(campaigns || []).some((c) => c.externalCampaignId) && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1"
                onClick={() => (campaigns || []).forEach((c) => c.externalCampaignId && syncStatsMutation.mutate(c.id))}
                disabled={syncStatsMutation.isPending}>
                <RefreshCw className="w-3 h-3" />
                Sync All
              </Button>
            )}
          </div>

          {(campaigns || []).length === 0 ? (
            <div className="text-center py-8 border border-dashed rounded-card">
              <Megaphone className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No campaigns yet.</p>
              <p className="text-xs text-muted-foreground mt-1">Click "Generate Campaign" to create your first one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(campaigns || []).map((c) => {
                const ctr = c.impressions > 0 ? ((c.clicks / c.impressions) * 100).toFixed(2) : null;
                const cpl = c.signups > 0 ? (c.totalSpendCents / 100 / c.signups).toFixed(2) : null;
                return (
                  <div key={c.id} className="p-3 border rounded-xl hover:bg-muted/20 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{c.name}</span>
                          <Badge className={`text-xs ${statusColors[c.status] || ""}`}>{c.status}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
                          <span className="font-medium">${(c.totalSpendCents / 100).toFixed(2)} spent</span>
                          <span>{c.impressions.toLocaleString()} impr.</span>
                          <span>{c.clicks.toLocaleString()} clicks</span>
                          {ctr && <span>{ctr}% CTR</span>}
                          {cpl && <span>${cpl} / signup</span>}
                          <span className="ml-auto">${(c.dailyBudgetCents / 100)}/day budget</span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {c.externalCampaignId && (
                          <Button aria-label="Refresh" size="sm" variant="ghost" className="h-7 w-7 p-0"
                            onClick={() => syncStatsMutation.mutate(c.id)} disabled={syncStatsMutation.isPending}>
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-7 px-2"
                          onClick={() => toggleCampaignMutation.mutate({ id: c.id, status: c.status === "active" ? "paused" : "active" })}
                          disabled={toggleCampaignMutation.isPending || !c.externalCampaignId}>
                          {c.status === "active" ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Attribution */}
        <div>
          <h3 className="font-medium text-sm flex items-center gap-2 mb-3">
            <MousePointerClick className="w-4 h-4 text-primary" aria-hidden="true" />
            Signup Attribution
          </h3>
          {Object.keys(sourceCounts).length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {Object.entries(sourceCounts).sort((a, b) => b[1] - a[1]).map(([src, count]) => (
                <Badge key={src} variant="outline" className="text-xs">
                  {src}: {count}
                </Badge>
              ))}
            </div>
          )}
          {(attribution || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              UTM attribution will appear here once users sign up from your campaigns.
            </p>
          ) : (
            <div className="space-y-0 max-h-52 overflow-y-auto border rounded-card divide-y">
              {(attribution || []).slice(0, 20).map((s) => (
                <div key={s.organizationId} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/20">
                  <span className="flex-1 font-medium truncate">{s.name}</span>
                  <Badge variant="outline" className="text-xs shrink-0">{s.subscriptionTier}</Badge>
                  <span className="text-muted-foreground shrink-0">
                    {s.utmSource ? `${s.utmSource}${s.utmCampaign ? ` › ${s.utmCampaign}` : ""}` : "organic"}
                  </span>
                  <span className="text-muted-foreground shrink-0">{new Date(s.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
