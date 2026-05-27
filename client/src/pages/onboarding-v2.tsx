import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
  MapPin,
  TrendingUp,
  Users,
  Zap,
  Target,
  DollarSign,
  Star,
  ArrowRight,
  CheckCircle,
  Sparkles,
  Building,
  Home,
  Briefcase,
  BarChart3,
  Brain,
  Phone,
  Upload,
  Link2,
  Shield,
  UserPlus,
  Key,
  Settings,
  Workflow,
  CheckCircle2,
  FileSpreadsheet,
  Mail,
  MessageSquare,
  CreditCard,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { QueryErrorState } from "@/components/query-error-state";
import { usd } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";

// ---------------------------------------------------------------------------
// Onboarding flow — 3 paths, guided by Pax
//
// Expert land investing principle: The first 10 minutes determine whether
// someone becomes a lifelong professional user or abandons the platform.
// The "aha moment" must happen in minute 2 — real data, real opportunity.
// ---------------------------------------------------------------------------

type InvestorPath = "beginner" | "active" | "enterprise";

interface OnboardingStep {
  id: string;
  title: string;
  subtitle: string;
}

const STEPS_BY_PATH: Record<InvestorPath, OnboardingStep[]> = {
  beginner: [
    { id: "path", title: "Welcome to AcreOS", subtitle: "Let's personalize your experience." },
    { id: "target_county", title: "Where do you want to invest?", subtitle: "Pick a county to explore first." },
    { id: "instant_hunt", title: "AcreOS found real opportunities", subtitle: "Here's what's available in your target area right now." },
    { id: "strategy", title: "What's your strategy?", subtitle: "How do you plan to make money with land?" },
    { id: "pax_tour", title: "Meet Pax, your deal partner", subtitle: "Pax works 24/7 so you don't have to." },
    { id: "complete", title: "You're ready to find deals!", subtitle: "Your personalized dashboard is configured." },
  ],
  active: [
    { id: "path", title: "Welcome back to AcreOS", subtitle: "Upgrade your investing operation." },
    { id: "portfolio_import", title: "Import your existing portfolio", subtitle: "Connect what you've built so AcreOS can analyze it." },
    { id: "target_counties", title: "Set your target counties", subtitle: "Configure Deal Hunter for your active markets." },
    { id: "instant_hunt", title: "Deals in your markets", subtitle: "Here's what AcreOS found in your target counties." },
    { id: "automation", title: "Configure the autonomous deal machine", subtitle: "Set it once — AcreOS finds deals every night." },
    { id: "complete", title: "Your operation is upgraded!", subtitle: "AcreOS is now working while you sleep." },
  ],
  enterprise: [
    { id: "path", title: "Enterprise setup", subtitle: "Configure AcreOS for your team." },
    { id: "team", title: "Set up your team", subtitle: "Invite deal analysts, VAs, and closing coordinators." },
    { id: "integrations", title: "Connect your tools", subtitle: "CRM, accounting, and communication stack." },
    { id: "instant_hunt", title: "Enterprise market scan", subtitle: "AcreOS scanning all your target markets simultaneously." },
    { id: "workflows", title: "Configure deal workflows", subtitle: "Custom pipeline stages and automation rules." },
    { id: "complete", title: "Enterprise platform ready!", subtitle: "Your team can now work deals at scale." },
  ],
};

interface DealOpportunity {
  county: string;
  state: string;
  ownerName: string;
  acreage: number;
  assessedValue: number;
  motivationScore: number;
  motivationGrade: string;
  topSignal: string;
  estimatedOfferPrice: number;
  estimatedResaleValue: number;
  potentialProfit: number;
}

// ---------------------------------------------------------------------------
// Instant Deal Hunt component
// The #1 "aha moment" — show real data within first 3 minutes
// ---------------------------------------------------------------------------

function InstantDealHunt({
  targetCounty,
  targetState,
  onContinue,
}: {
  targetCounty: string;
  targetState: string;
  onContinue: () => void;
}) {
  const { data, isLoading, error, refetch } = useQuery<{ opportunities: DealOpportunity[]; totalScanned: number }>({
    queryKey: ["/api/onboarding/instant-deal-hunt", targetCounty, targetState],
    queryFn: async () => {
      const resp = await apiRequest(
        "GET",
        `/api/onboarding/instant-deal-hunt?county=${encodeURIComponent(targetCounty)}&state=${encodeURIComponent(targetState)}`
      );
      return resp.json();
    },
    enabled: !!targetCounty && !!targetState,
  });

  const opportunities = data?.opportunities || [];
  const totalScanned = data?.totalScanned || 0;

  if (error) {
    return (
      <div className="space-y-6">
        <QueryErrorState
          error={error}
          onRetry={() => refetch()}
          compact
          title="Couldn't scan this county"
          description="We hit a snag searching for deals. Try again or continue to set up later."
        />
        <Button
          onClick={onContinue}
          className="w-full min-h-11 bg-primary hover:bg-primary/90 text-white font-semibold py-3"
        >
          Continue to dashboard <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        {isLoading ? (
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-full border-4 border-acr-pos border-t-transparent animate-spin mx-auto" />
            <p className="text-muted-foreground">
              Scanning {targetCounty} County, {targetState} for motivated sellers…
            </p>
            <p className="text-xs text-muted-foreground">
              Checking tax delinquency records · Scoring seller motivation · Finding opportunities
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-2xl font-bold text-white">
              Found <span className="tabular-nums">{opportunities.length}</span> opportunities
              {totalScanned > 0 && (
                <span className="text-muted-foreground text-base font-normal ml-2">
                  (<span className="tabular-nums">{totalScanned.toLocaleString()}</span> properties scanned)
                </span>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              in {targetCounty} County, {targetState} — ranked by seller motivation.
            </p>
          </div>
        )}
      </div>

      {!isLoading && opportunities.length > 0 && (
        <div className="space-y-3">
          {opportunities.slice(0, 3).map((opp, i) => (
            <div
              key={i}
              className={cn(
                "rounded-card border p-4 relative overflow-hidden",
                i === 0
                  ? "border-[color:var(--acr-neg)]/50 bg-acr-neg-soft"
                  : i === 1
                  ? "border-[color:var(--acr-warn)]/30 bg-acr-warn-soft"
                  : "border-acr-line bg-acr-surface-2"
              )}
            >
              {i === 0 && (
                <div className="absolute top-2 right-2">
                  {/* Per design-system §1.2: no emoji in copy. Plain "Hot deal" pill. */}
                  <Badge className="bg-acr-neg text-acr-brand-ink text-xs">Hot deal</Badge>
                </div>
              )}
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold text-white">{opp.ownerName}</div>
                  <div className="text-xs text-muted-foreground">
                    {opp.acreage} acres · {opp.county}, {opp.state}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={cn(
                      "text-lg font-bold",
                      opp.motivationScore >= 80
                        ? "text-acr-neg"
                        : opp.motivationScore >= 65
                        ? "text-acr-warn"
                        : "text-acr-ink-3"
                    )}
                  >
                    {opp.motivationGrade} · {opp.motivationScore}
                  </div>
                  <div className="text-xs text-muted-foreground">Motivation score</div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground mb-3">
                📍 Top signal: <span className="text-muted-foreground">{opp.topSignal}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-acr-bg-sunken/60 rounded-card p-2 min-w-0">
                  <div className="text-sm font-semibold text-white truncate tabular-nums">
                    {usd(opp.estimatedOfferPrice, { noCents: true })}
                  </div>
                  <div className="text-xs text-muted-foreground">Offer price</div>
                </div>
                <div className="bg-acr-bg-sunken/60 rounded-card p-2 min-w-0">
                  <div className="text-sm font-semibold text-white truncate tabular-nums">
                    {usd(opp.estimatedResaleValue, { noCents: true })}
                  </div>
                  <div className="text-xs text-muted-foreground">Resale value</div>
                </div>
                <div className="bg-acr-pos-soft/40 rounded-card p-2">
                  <div className="text-sm font-semibold text-acr-pos tabular-nums">
                    {usd(opp.potentialProfit, { noCents: true })}
                  </div>
                  <div className="text-xs text-muted-foreground">Potential profit</div>
                </div>
              </div>
            </div>
          ))}

          <p className="text-xs text-muted-foreground text-center">
            These are real data points from public records in {targetCounty} County.
            AcreOS finds new opportunities like these every night automatically.
          </p>
        </div>
      )}

      {!isLoading && opportunities.length === 0 && (
        <div className="text-center py-6">
          <div className="text-muted-foreground mb-2">No high-motivation leads found in this county yet.</div>
          <div className="text-sm text-muted-foreground">
            AcreOS will monitor {targetCounty} County and alert you when opportunities emerge.
          </div>
        </div>
      )}

      <Button
        onClick={onContinue}
        disabled={isLoading}
        className="w-full min-h-11 bg-primary hover:bg-primary/90 text-white font-semibold py-3"
      >
        {isLoading ? "Scanning…" : "Continue to dashboard"}
        <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active path: Portfolio Import step
// ---------------------------------------------------------------------------

function PortfolioImportStep({ onContinue }: { onContinue: (data?: Record<string, any>) => void }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string[][]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [importComplete, setImportComplete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importedCountRef = useRef<number>(0);

  const handleFileSelect = useCallback((selectedFile: File) => {
    setFile(selectedFile);
    // Parse first 5 rows for preview
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;
      const lines = text.split("\n").filter(Boolean).slice(0, 6);
      const rows = lines.map((line) =>
        line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim())
      );
      setPreview(rows);
    };
    reader.readAsText(selectedFile);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile && (droppedFile.name.endsWith(".csv") || droppedFile.name.endsWith(".xlsx"))) {
        handleFileSelect(droppedFile);
      }
    },
    [handleFileSelect]
  );

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/import/leads", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Import failed");
      const result = await res.json();
      const count = result.imported ?? result.count ?? 0;
      importedCountRef.current = count;
      setImportComplete(true);
      toast({
        title: "Import successful",
        description: `Imported ${count} leads from your file.`,
      });
    } catch {
      toast({
        title: "Couldn't import portfolio",
        description: "No leads were imported — check the file format (CSV or XLSX) and try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      {!file ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Select or drop a CSV or XLSX file to import"
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-acr-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-acr-accent"
        >
          <Upload className="w-10 h-10 text-muted-foreground mx-auto mb-3" aria-hidden="true" />
          <p className="text-muted-foreground font-medium">Drop your CSV or XLSX file here</p>
          <p className="text-muted-foreground text-sm mt-1">or click to browse</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            aria-label="Portfolio file"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-acr-accent/30 border border-acr-accent/30 rounded-card">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-acr-accent" aria-hidden="true" />
              <span className="text-white text-sm font-medium">{file.name}</span>
            </div>
            {!importComplete && (
              <button
                type="button"
                onClick={() => { setFile(null); setPreview([]); }}
                className="text-muted-foreground hover:text-muted-foreground text-xs min-h-11 px-2"
                aria-label={`Remove ${file.name} and choose a different file`}
              >
                Change file
              </button>
            )}
          </div>

          {preview.length > 0 && !importComplete && (
            <div className="overflow-x-auto rounded-card border border-border" role="region" tabIndex={0} aria-label="Portfolio file preview">
              <table className="w-full text-xs text-muted-foreground">
                <thead>
                  <tr className="bg-acr-bg-sunken/80">
                    {preview[0]?.map((header, i) => (
                      <th key={i} scope="col" className="px-3 py-2 text-left font-medium text-muted-foreground">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(1, 6).map((row, ri) => (
                    <tr key={ri} className="border-t border-border/50">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-1.5 truncate max-w-[120px]">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-1.5 text-xs text-muted-foreground bg-acr-bg-sunken/50">
                Showing first <span className="tabular-nums">{Math.min(preview.length - 1, 5)}</span> rows
              </div>
            </div>
          )}

          {importComplete && (
            <div
              className="p-3 bg-acr-pos-soft/30 border border-acr-pos/30 rounded-card text-acr-pos text-sm flex items-center gap-2"
              role="status"
              aria-live="polite"
            >
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              Portfolio imported successfully{importedCountRef.current > 0 ? ` — ${importedCountRef.current} leads added.` : "."}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        {file && !importComplete && (
          <Button
            onClick={handleUpload}
            disabled={isUploading}
            className="flex-1 bg-acr-accent hover:bg-acr-accent py-3 min-h-11"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                Importing…
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" aria-hidden="true" />
                Import {preview.length > 1 ? <><span className="tabular-nums mx-1">{preview.length - 1}</span> rows</> : "file"}
              </>
            )}
          </Button>
        )}
        <Button
          onClick={() => onContinue({ dataImported: importComplete || !!file })}
          className={cn(
            "py-3 min-h-11",
            file && !importComplete ? "flex-1" : "w-full",
            "bg-primary hover:bg-primary/90"
          )}
        >
          {importComplete ? "Continue" : "Skip for now"} <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active path: Target Counties step (multi-county)
// ---------------------------------------------------------------------------

function TargetCountiesStep({
  formData,
  setFormData,
  onContinue,
}: {
  formData: Record<string, any>;
  setFormData: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  onContinue: (data?: Record<string, any>) => void;
}) {
  const [counties, setCounties] = useState<Array<{ state: string; county: string }>>(
    formData.targetCounties || [{ state: "", county: "" }]
  );

  const updateCounty = (index: number, field: "state" | "county", value: string) => {
    setCounties((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: field === "state" ? value.toUpperCase() : value };
      return updated;
    });
  };

  const addCounty = () => {
    if (counties.length < 5) {
      setCounties((prev) => [...prev, { state: "", county: "" }]);
    }
  };

  const validCounties = counties.filter((c) => c.state && c.county);

  return (
    <div className="space-y-4">
      {counties.map((c, i) => (
        <div key={i} className="flex gap-3">
          <div className="w-20">
            <Label htmlFor={`target-state-${i}`} className="sr-only">State (2 letter code)</Label>
            <Input
              id={`target-state-${i}`}
              placeholder="ST"
              maxLength={2}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="address-level1"
              autoCorrect="off"
              spellCheck={false}
              value={c.state}
              onChange={(e) => updateCounty(i, "state", e.target.value)}
              className="bg-acr-bg-sunken border-border text-white text-center uppercase"
            />
          </div>
          <div className="flex-1">
            <Label htmlFor={`target-county-${i}`} className="sr-only">County name</Label>
            <Input
              id={`target-county-${i}`}
              placeholder="County name"
              autoCapitalize="words"
              autoComplete="address-level2"
              value={c.county}
              onChange={(e) => updateCounty(i, "county", e.target.value)}
              className="bg-acr-bg-sunken border-border text-white"
            />
          </div>
        </div>
      ))}

      {counties.length < 5 && (
        <button
          type="button"
          onClick={addCounty}
          className="text-sm text-acr-accent hover:text-acr-accent min-h-11 px-2"
        >
          + Add another county (up to <span className="tabular-nums">5</span>)
        </button>
      )}

      <div className="p-3 bg-acr-bg-sunken border border-border rounded-card">
        <p className="text-xs text-muted-foreground mb-1">Pro tip</p>
        <p className="text-xs text-muted-foreground">
          Running deals in 3–5 counties gives you enough deal flow while keeping focus.
          The Deal Hunter scans each county every night.
        </p>
      </div>

      <Button
        onClick={() => {
          const data = {
            targetCounties: validCounties,
            targetCounty: validCounties[0]?.county || "",
            targetState: validCounties[0]?.state || "",
          };
          setFormData((prev) => ({ ...prev, ...data }));
          onContinue(data);
        }}
        disabled={validCounties.length === 0}
        className="w-full bg-primary hover:bg-primary/90 py-3 min-h-11"
      >
        Set <span className="tabular-nums mx-1">{validCounties.length}</span> {validCounties.length === 1 ? "county" : "counties"} as targets
        <Target className="w-4 h-4 ml-2" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Active path: Automation step
// ---------------------------------------------------------------------------

function AutomationStep({ onContinue }: { onContinue: () => void }) {
  const [settings, setSettings] = useState({
    dealHunter: true,
    autoMail: false,
    morningBriefing: true,
  });

  return (
    <div className="space-y-4">
      <div className="p-4 bg-acr-accent/20 border border-acr-accent/30 rounded-xl">
        <div className="flex items-center gap-3 mb-3">
          <Zap className="w-5 h-5 text-acr-accent" aria-hidden="true" />
          <span className="font-medium text-white">Autonomous deal machine</span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          AcreOS runs these processes automatically every night. Toggle what you want active.
        </p>
        <div className="space-y-3" role="group" aria-label="Autonomous deal machine settings">
          {[
            {
              key: "dealHunter" as const,
              icon: Target,
              label: "Nightly deal hunter",
              desc: "Scans your target counties for new motivated sellers",
            },
            {
              key: "autoMail" as const,
              icon: Mail,
              label: "Auto-send first-touch mailers",
              desc: "Automatically sends initial outreach to new high-score leads",
            },
            {
              key: "morningBriefing" as const,
              icon: Star,
              label: "Morning briefing email",
              desc: "Daily summary of new opportunities, responses, and action items",
            },
          ].map(({ key, icon: Icon, label, desc }) => (
            <button
              key={key}
              type="button"
              role="switch"
              aria-checked={settings[key]}
              aria-label={`${label}: ${settings[key] ? "on" : "off"}`}
              onClick={() => setSettings((prev) => ({ ...prev, [key]: !prev[key] }))}
              className={cn(
                "w-full text-left p-3 rounded-card border transition-colors flex items-start gap-3 min-h-11",
                settings[key]
                  ? "border-acr-accent/50 bg-acr-accent/30"
                  : "border-border bg-acr-bg-sunken/50"
              )}
            >
              <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", settings[key] ? "text-acr-accent" : "text-muted-foreground")} aria-hidden="true" />
              <div className="flex-1">
                <div className="text-sm font-medium text-white">{label}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
              <div
                aria-hidden="true"
                className={cn(
                  "w-8 h-5 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0 mt-0.5",
                  settings[key] ? "bg-acr-accent justify-end" : "bg-acr-bg-sunken justify-start"
                )}
              >
                <div className="w-4 h-4 bg-white rounded-full" />
              </div>
            </button>
          ))}
        </div>
      </div>

      <Button onClick={onContinue} className="w-full bg-primary hover:bg-primary/90 py-3 min-h-11">
        Activate deal machine <Zap className="w-4 h-4 ml-2" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enterprise path: Team Setup step
// ---------------------------------------------------------------------------

function TeamSetupStep({ onContinue }: { onContinue: (data?: Record<string, any>) => void }) {
  const { toast } = useToast();
  const [emails, setEmails] = useState("");
  const [invitesSent, setInvitesSent] = useState(false);

  const inviteMutation = useMutation({
    mutationFn: async (emailList: string[]) => {
      // Canonical bulk-invitation endpoint (routes-organization.ts:1610).
      // Was previously POST /api/team/invite which never existed server-side.
      const res = await apiRequest("POST", "/api/organization/invitations", {
        invites: emailList.map((email) => ({ email, role: "member" as const })),
      });
      return res.json();
    },
    onSuccess: () => {
      setInvitesSent(true);
      toast({ title: "Invitations sent", description: "Your team members will receive an email invite." });
    },
    onError: () => {
      toast({
        title: "Couldn't send invites",
        description: "No invites were sent — you can try again now or invite team members later in Settings.",
        variant: "destructive",
      });
    },
  });

  const handleInvite = () => {
    const emailList = emails
      .split(/[,\n]/)
      .map((e) => e.trim())
      .filter((e) => e.includes("@"));
    if (emailList.length > 0) {
      inviteMutation.mutate(emailList);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-acr-brand-soft/20 border border-acr-brand/30 rounded-xl">
        <ul className="space-y-3" aria-label="Team roles you can invite">
          {[
            { icon: UserPlus, role: "Deal analysts", desc: "Find and evaluate acquisition targets" },
            { icon: Users, role: "Virtual assistants", desc: "Handle outreach, follow-ups, and data entry" },
            { icon: Briefcase, role: "Closing coordinators", desc: "Manage contracts and transactions" },
          ].map(({ icon: Icon, role, desc }) => (
            <li key={role} className="flex items-center gap-3 p-2">
              <div className="w-8 h-8 bg-acr-brand-soft/50 rounded-card flex items-center justify-center flex-shrink-0" aria-hidden="true">
                <Icon className="w-4 h-4 text-acr-brand" />
              </div>
              <div>
                <div className="text-sm font-medium text-white">{role}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <Label htmlFor="team-invite-emails" className="text-muted-foreground mb-2 block">Invite team members</Label>
        <Textarea
          id="team-invite-emails"
          placeholder="Enter email addresses (one per line or comma-separated)"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          className="bg-acr-bg-sunken border-border text-white min-h-[80px]"
          disabled={invitesSent}
          aria-describedby="team-invite-emails-hint"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <p id="team-invite-emails-hint" className="text-xs text-muted-foreground mt-1">
          Each person receives an email with a sign-in link. You can add more later in Settings.
        </p>
      </div>

      {invitesSent && (
        <div
          className="p-3 bg-acr-pos-soft/30 border border-acr-pos/30 rounded-card text-acr-pos text-sm flex items-center gap-2"
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
          Invitations sent successfully.
        </div>
      )}

      <div className="flex gap-3">
        {!invitesSent && emails.trim() && (
          <Button
            onClick={handleInvite}
            disabled={inviteMutation.isPending}
            className="flex-1 bg-primary hover:bg-primary/90 py-3 min-h-11"
          >
            {inviteMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Sending…</>
            ) : (
              <><Mail className="w-4 h-4 mr-2" aria-hidden="true" /> Send invites</>
            )}
          </Button>
        )}
        <Button
          onClick={() => onContinue({ teamInvited: invitesSent })}
          className={cn(
            "py-3 min-h-11 bg-primary hover:bg-primary/90",
            !invitesSent && emails.trim() ? "flex-1" : "w-full"
          )}
        >
          {invitesSent ? "Continue" : "Skip for now"} <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enterprise path: Integrations step
// ---------------------------------------------------------------------------

function IntegrationsStep({ onContinue }: { onContinue: () => void }) {
  const { data: healthData } = useQuery<Record<string, any>>({
    queryKey: ["/api/health"],
    queryFn: async () => {
      const res = await fetch("/api/health", { credentials: "include" });
      return res.json();
    },
  });

  const { data: stripeData } = useQuery<{ subscription: any } | null>({
    queryKey: ["/api/stripe/subscription"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/stripe/subscription", { credentials: "include" });
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      }
    },
  });

  const integrations = [
    {
      icon: CreditCard,
      name: "Stripe payments",
      desc: "Collect payments, sell notes, manage subscriptions",
      status: stripeData?.subscription ? "connected" : "not_configured",
      configUrl: "/settings#billing",
    },
    {
      icon: Mail,
      name: "Email (AWS SES)",
      desc: "Send campaigns, follow-ups, and transactional email",
      status: healthData?.ses?.configured ? "connected" : "not_configured",
      configUrl: "/settings/email",
    },
    {
      icon: MessageSquare,
      name: "SMS (Twilio)",
      desc: "Text campaigns, two-way messaging, auto-follow-ups",
      status: healthData?.twilio?.configured ? "connected" : "not_configured",
      configUrl: "/settings",
    },
    {
      icon: Key,
      name: "API & webhooks",
      desc: "Connect external tools via REST API and webhooks",
      status: "available",
      configUrl: "/webhooks",
    },
  ];

  return (
    <div className="space-y-4">
      <ul className="space-y-3" aria-label="Available integrations">
        {integrations.map(({ icon: Icon, name, desc, status }) => (
          <li
            key={name}
            className={cn(
              "p-4 rounded-xl border flex items-start gap-3",
              status === "connected"
                ? "border-acr-pos/40 bg-acr-pos-soft/20"
                : "border-border bg-acr-bg-sunken/50"
            )}
          >
            <div
              aria-hidden="true"
              className={cn(
                "w-9 h-9 rounded-card flex items-center justify-center flex-shrink-0",
                status === "connected" ? "bg-acr-pos-soft/50" : "bg-acr-bg-sunken"
              )}
            >
              <Icon className={cn("w-5 h-5", status === "connected" ? "text-acr-pos" : "text-muted-foreground")} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white text-sm">{name}</span>
                <Badge
                  aria-label={`${name}: ${status === "connected" ? "connected" : "not configured"}`}
                  className={cn(
                    "text-micro px-1.5",
                    status === "connected"
                      ? "bg-acr-pos-soft/60 text-acr-pos border-acr-pos/30"
                      : "bg-acr-bg-sunken text-muted-foreground border-border"
                  )}
                >
                  {status === "connected" ? "Connected" : "Not configured"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground text-center">
        You can configure all integrations later in Settings.
      </p>

      <Button onClick={onContinue} className="w-full bg-primary hover:bg-primary/90 py-3 min-h-11">
        Continue <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enterprise path: Workflows step
// ---------------------------------------------------------------------------

function WorkflowsStep({ onContinue }: { onContinue: () => void }) {
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>(["standard_pipeline"]);

  const workflows = [
    {
      id: "standard_pipeline",
      icon: Workflow,
      title: "Standard deal pipeline",
      desc: "Lead → Contact → Negotiate → Contract → Close",
      stages: 5,
    },
    {
      id: "high_volume",
      icon: Zap,
      title: "High-volume acquisition",
      desc: "Auto-score → Auto-offer → Review → Close",
      stages: 4,
    },
    {
      id: "team_review",
      icon: Users,
      title: "Team review workflow",
      desc: "Analyst → Manager approval → Offer → Contract → Close",
      stages: 5,
    },
  ];

  const toggle = (id: string) => {
    setSelectedWorkflows((prev) =>
      prev.includes(id) ? prev.filter((w) => w !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3" role="group" aria-label="Deal workflows">
        {workflows.map(({ id, icon: Icon, title, desc, stages }) => {
          const checked = selectedWorkflows.includes(id);
          return (
            <button
              key={id}
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={`${title}, ${stages} stages`}
              onClick={() => toggle(id)}
              className={cn(
                "w-full text-left p-4 rounded-xl border-2 transition-all min-h-11",
                checked
                  ? "border-acr-brand bg-acr-brand-soft/20"
                  : "border-border bg-acr-bg-sunken hover:border-border"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon className={cn("w-5 h-5 flex-shrink-0", checked ? "text-acr-brand" : "text-muted-foreground")} aria-hidden="true" />
                <div>
                  <div className="font-semibold text-white text-sm">{title}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                  <div className="text-xs text-muted-foreground mt-1"><span className="tabular-nums">{stages}</span> stages</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Custom pipeline stages can be added in Settings after setup.
      </p>

      <Button
        onClick={onContinue}
        disabled={selectedWorkflows.length === 0}
        className="w-full bg-primary hover:bg-primary/90 py-3 min-h-11"
      >
        Configure <span className="tabular-nums mx-1">{selectedWorkflows.length}</span> {selectedWorkflows.length === 1 ? "workflow" : "workflows"}
        <Settings className="w-4 h-4 ml-2" aria-hidden="true" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main onboarding wizard
// ---------------------------------------------------------------------------

export default function OnboardingV2() {
  useDocumentTitle("Welcome to AcreOS");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [selectedPath, setSelectedPath] = useState<InvestorPath | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [isAnimating, setIsAnimating] = useState(false);

  const steps = selectedPath ? STEPS_BY_PATH[selectedPath] : STEPS_BY_PATH.beginner;
  const currentStep = steps[currentStepIndex];
  const progress = selectedPath ? ((currentStepIndex + 1) / steps.length) * 100 : 0;

  const updateOnboardingMutation = useMutation({
    mutationFn: async (data: any) => {
      const resp = await apiRequest("PATCH", "/api/onboarding/progress", data);
      return resp.json();
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest("POST", "/api/onboarding/complete", { formData, path: selectedPath });
      return resp.json();
    },
    onSuccess: () => navigate("/dashboard"),
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  // Per-step entry telemetry. Fires once on every step landing; the server
  // dedupes per (org, event) so subsequent visits to the same step are no-op.
  // Paired with the existing step_completed events written by /progress —
  // together they let the funnel compute per-step bail rate as
  // entered_N AND NOT completed_N. Drives the C.2 redesign revisit trigger.
  // Best-effort; never blocks the flow.
  useEffect(() => {
    if (!selectedPath) return;
    const stepNumber = currentStepIndex + 1;
    fetch("/api/onboarding/step-entered", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: stepNumber, path: selectedPath }),
    }).catch(() => { /* telemetry is best-effort */ });
  }, [selectedPath, currentStepIndex]);

  const advance = (data?: Record<string, any>) => {
    if (data) setFormData((prev) => ({ ...prev, ...data }));
    setIsAnimating(true);
    setTimeout(() => {
      if (currentStepIndex < steps.length - 1) {
        setCurrentStepIndex((i) => i + 1);
      }
      setIsAnimating(false);
    }, 300);
    updateOnboardingMutation.mutate({ step: currentStepIndex + 1, ...data });

    // Persona setter (#9) — when the user picks a businessType, also write
    // the modern users.persona column so vocabulary swaps + persona-gated
    // surfaces activate immediately. Best-effort; failure leaves the
    // legacy onboardingData.businessType in place as the source of truth.
    if (data?.businessType) {
      const persona = mapBusinessTypeToPersona(data.businessType as string);
      if (persona) {
        fetch("/api/me/persona", {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona }),
        }).catch(() => { /* best effort — onboardingData carries the truth */ });
      }
    }
  };

  // BusinessType → Persona translation. Onboarding's strategy picker
  // predates the persona registry; this map keeps both fields in sync
  // for users who land on a brief-defined archetype, defaults to
  // land_investor for ambiguous strategies.
  function mapBusinessTypeToPersona(bt: string): string | null {
    switch (bt) {
      case "land_flipper":          return "land_investor";
      case "note_investor":         return "note_investor";
      case "residential_wholesaler": return "wholesaler";
      case "fix_and_flip":          return "fix_flipper";
      case "buy_and_hold":          return "landlord";
      case "tax_lien_deed":         return "tax_delinquent";
      case "developer":             return "subdivider";
      // hybrid / commercial / multifamily / mobile_home / creative_finance /
      // agent_investor / short_term_rental — no persona-specific surface
      // yet, default to land_investor copy.
      default: return "land_investor";
    }
  }

  // PATH SELECTION screen (before step flow starts)
  if (!selectedPath) {
    return (
      <div className="min-h-screen bg-acr-bg-sunken flex items-center justify-center p-4">
        <div className="max-w-2xl w-full space-y-8">
          {/* Logo + headline */}
          <div className="text-center space-y-3">
            <h1 className="text-4xl font-bold text-white">Welcome to AcreOS</h1>
            <p className="text-muted-foreground text-lg">
              Tell us where you are in your land investing journey — we'll configure everything for you.
            </p>
          </div>

          {/* Path selection */}
          {/* Path colors keyed statically — Tailwind's safelist scans static
             string literals only. Dynamic `bg-${color}-950/20` patterns
             (pre-port version) get tree-shaken and render colorless. */}
          <div className="grid gap-4">
            {([
              {
                path: "beginner" as InvestorPath,
                icon: Home,
                title: "Just getting started",
                subtitle: "I'm new to land investing and want to learn the ropes",
                benefits: ["Guided first deal walkthrough", "Expert strategy explanations", "Sample deal pre-loaded", "Daily Pax coaching tips"],
                cardClasses: "border-acr-pos/40 bg-acr-pos-soft/20 hover:border-acr-pos",
                iconBg: "bg-acr-pos-soft/60",
                iconColor: "text-acr-pos",
              },
              {
                path: "active" as InvestorPath,
                icon: Building,
                title: "Active land investor",
                subtitle: "I'm already doing deals and need better tools",
                benefits: ["Import existing portfolio", "Configure Deal Hunter for your markets", "Activate Autonomous Deal Machine", "Advanced analytics"],
                cardClasses: "border-acr-accent/40 bg-acr-accent/20 hover:border-acr-accent",
                iconBg: "bg-acr-accent/60",
                iconColor: "text-acr-accent",
              },
              {
                path: "enterprise" as InvestorPath,
                icon: Briefcase,
                title: "Team or enterprise",
                subtitle: "I run a land investing operation with a team",
                benefits: ["Multi-user deal pipeline", "VA and team management", "White-label options", "API access for integrations"],
                cardClasses: "border-acr-brand/40 bg-acr-brand-soft/20 hover:border-acr-brand",
                iconBg: "bg-acr-brand-soft/60",
                iconColor: "text-acr-brand",
              },
            ] as const).map(({ path, icon: Icon, title, subtitle, benefits, cardClasses, iconBg, iconColor }) => (
              <button
                key={path}
                onClick={() => {
                  setSelectedPath(path);
                  setCurrentStepIndex(0);
                  // Path-selection telemetry — Wave 12 fork visibility
                  // (land/notes/both/enterprise). Drives C.2 revisit
                  // trigger #3. Best-effort fire-and-forget.
                  fetch("/api/onboarding/path-selected", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ path }),
                  }).catch(() => { /* telemetry is best-effort */ });
                }}
                className={cn(
                  "text-left p-6 rounded-2xl border-2 transition-all hover:scale-[1.01]",
                  cardClasses
                )}
              >
                <div className="flex items-start gap-4">
                  <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0", iconBg)}>
                    <Icon className={cn("w-6 h-6", iconColor)} />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-white text-lg">{title}</div>
                    <div className="text-muted-foreground text-sm mb-3">{subtitle}</div>
                    <div className="flex flex-wrap gap-2">
                      {benefits.map((b) => (
                        <span key={b} className="text-xs bg-acr-bg-sunken text-muted-foreground px-2 py-1 rounded-full">
                          ✓ {b}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ArrowRight className={cn("w-5 h-5 flex-shrink-0 mt-1", iconColor)} />
                </div>
              </button>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground">
            You can change your path at any time in Settings · No credit card required to start
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-acr-bg-sunken flex flex-col">
      {/* Progress bar */}
      <div className="h-1 bg-acr-bg-sunken">
        <div
          className="h-1 bg-acr-pos transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="text-sm font-medium text-primary">AcreOS</div>
        <div className="text-xs text-muted-foreground">
          Step {currentStepIndex + 1} of {steps.length}
        </div>
        {currentStepIndex > 0 && (
          <button
            onClick={() => navigate("/dashboard")}
            className="text-xs text-muted-foreground hover:text-muted-foreground"
          >
            Skip setup →
          </button>
        )}
      </div>

      {/* Main content */}
      <div
        className={cn(
          "flex-1 flex items-center justify-center p-6 transition-opacity duration-300",
          isAnimating ? "opacity-0" : "opacity-100"
        )}
      >
        <div className="max-w-xl w-full space-y-8">
          {/* Step header */}
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold text-white">{currentStep.title}</h2>
            <p className="text-muted-foreground">{currentStep.subtitle}</p>
          </div>

          {/* Step content */}
          {currentStep.id === "path" && selectedPath && (
            <div className="space-y-4">
              <div className="p-4 bg-acr-pos-soft/20 border border-acr-pos/30 rounded-xl">
                <div className="flex items-center gap-3 mb-3">
                  <Brain className="w-5 h-5 text-acr-pos" />
                  <span className="font-medium text-white">Pax is ready to help</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedPath === "beginner"
                    ? "I'll guide you through finding your first land deal step by step. Land investing is simpler than most real estate — no tenants, no repairs, just buying cheap and selling for a profit."
                    : selectedPath === "active"
                    ? "Let's upgrade your operation. I'll analyze your existing deals, identify your best counties, and configure the Autonomous Deal Machine to find new opportunities every night."
                    : "I'll help configure AcreOS for your full team operation — deal routing, VA workflows, and enterprise analytics."}
                </p>
              </div>
              <Button
                onClick={() => advance()}
                className="w-full bg-primary hover:bg-primary/90 py-3"
              >
                Let's get started <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
              </Button>
            </div>
          )}

          {currentStep.id === "target_county" && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="onb-target-state" className="text-muted-foreground mb-2 block">Target state</Label>
                <Input
                  id="onb-target-state"
                  placeholder="e.g., TX"
                  maxLength={2}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  value={formData.targetState || ""}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, targetState: e.target.value.toUpperCase() }))
                  }
                  className="bg-acr-bg-sunken border-border text-white text-lg py-3"
                />
              </div>
              <div>
                <Label htmlFor="onb-target-county" className="text-muted-foreground mb-2 block">Target county</Label>
                <Input
                  id="onb-target-county"
                  placeholder="e.g., Hudspeth"
                  autoCapitalize="words"
                  value={formData.targetCounty || ""}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, targetCounty: e.target.value }))
                  }
                  className="bg-acr-bg-sunken border-border text-white text-lg py-3"
                />
              </div>
              <div className="p-3 bg-acr-bg-sunken border border-border rounded-card">
                <div className="text-xs text-muted-foreground mb-2">💡 Not sure which county to pick?</div>
                <div className="text-xs text-muted-foreground">
                  Expert tip: Start with rural counties in TX, AZ, NM, or CO. Look for counties with
                  low competition (fewer mailers being sent) and active land sales. The Deal Hunter will
                  show you opportunity scores for any county you choose.
                </div>
              </div>
              <Button
                onClick={() => advance({ targetCounty: formData.targetCounty, targetState: formData.targetState })}
                disabled={!formData.targetCounty || !formData.targetState}
                className="w-full bg-primary hover:bg-primary/90 py-3"
              >
                Scan this county <Zap className="w-4 h-4 ml-2" aria-hidden="true" />
              </Button>
            </div>
          )}

          {currentStep.id === "instant_hunt" && (
            <InstantDealHunt
              targetCounty={formData.targetCounty || "Hudspeth"}
              targetState={formData.targetState || "TX"}
              onContinue={() => advance()}
            />
          )}

          {currentStep.id === "strategy" && (
            <div className="space-y-6">
              {[
                {
                  group: "Land & Development — Recommended",
                  types: [
                    { value: "land_flipper", icon: MapPin, title: "Land Flipper", desc: "Buy raw land at wholesale and resell for profit. Fast cycles, high margins. AcreOS is built for this." },
                    { value: "developer", icon: Building, title: "Developer / Subdivider", desc: "Land development, entitlements, subdivisions, and new construction." },
                    { value: "tax_lien_deed", icon: DollarSign, title: "Tax Lien / Tax Deed", desc: "Purchase tax liens and deeds at county auctions. Research-driven, high ROI." },
                  ],
                },
                {
                  group: "Residential",
                  types: [
                    { value: "residential_wholesaler", icon: Zap, title: "Wholesaler", desc: "Find deals, assign contracts. Earn assignment fees with zero rehab risk." },
                    { value: "fix_and_flip", icon: Home, title: "Fix & Flip", desc: "Buy distressed homes, renovate, sell at market. Higher returns, hands-on." },
                    { value: "buy_and_hold", icon: Key, title: "Buy & Hold", desc: "Build a long-term rental portfolio for cash flow and appreciation." },
                    { value: "short_term_rental", icon: Star, title: "Short-Term Rental", desc: "Acquire and manage Airbnb, VRBO, and vacation rentals for income." },
                  ],
                },
                {
                  group: "Commercial & Multifamily",
                  types: [
                    { value: "commercial", icon: Briefcase, title: "Commercial", desc: "Office, retail, industrial, and mixed-use investments." },
                    { value: "multifamily", icon: Building, title: "Multifamily", desc: "Apartment buildings and 5+ unit properties. Value-add or stabilized." },
                    { value: "mobile_home", icon: Home, title: "Mobile Home / MHP", desc: "Mobile home parks and manufactured housing. High cash-on-cash returns." },
                  ],
                },
                {
                  group: "Notes & Creative",
                  types: [
                    { value: "note_investor", icon: TrendingUp, title: "Note Professional", desc: "Buy, sell, and service mortgage notes. Build passive income streams." },
                    { value: "creative_finance", icon: Brain, title: "Creative Finance", desc: "Subject-to, wraps, lease options, and seller financing strategies." },
                  ],
                },
                {
                  group: "Multi-Strategy",
                  types: [
                    { value: "agent_investor", icon: UserPlus, title: "Agent & Professional", desc: "Licensed agent who also invests. Manage clients and your own deals." },
                    { value: "hybrid", icon: BarChart3, title: "Hybrid / Multi-Strategy", desc: "Combine multiple strategies — land, notes, rentals, and more." },
                  ],
                },
              ].map(({ group, types }) => (
                <div key={group} className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground px-1">{group}</div>
                  {types.map(({ value, icon: Icon, title, desc }) => (
                    <button
                      key={value}
                      onClick={() => advance({ strategy: value, businessType: value })}
                      className={cn(
                        "w-full text-left p-4 rounded-xl border-2 transition-all",
                        formData.strategy === value
                          ? "border-acr-pos bg-acr-pos-soft/20"
                          : "border-border bg-acr-bg-sunken hover:border-border"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-card bg-acr-pos-soft/50 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-5 h-5 text-acr-pos" />
                        </div>
                        <div>
                          <div className="font-semibold text-white">{title}</div>
                          <div className="text-sm text-muted-foreground">{desc}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {currentStep.id === "pax_tour" && (
            <div className="space-y-4">
              <div className="p-5 bg-acr-brand-soft/30 border border-acr-brand/30 rounded-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-acr-brand/50 rounded-full flex items-center justify-center">
                    <Brain className="w-5 h-5 text-acr-brand" />
                  </div>
                  <div>
                    <div className="font-bold text-white">Pax</div>
                    <div className="text-xs text-muted-foreground">Your autonomous deal partner</div>
                  </div>
                </div>
                <div className="space-y-3">
                  {[
                    { icon: Target, text: "Finds deals every night while you sleep" },
                    { icon: Star, text: "Scores every lead with Seller Motivation AI" },
                    { icon: Phone, text: "Schedules follow-ups automatically (5-touch system)" },
                    { icon: Zap, text: "Sends your Morning Briefing at 7 AM daily" },
                  ].map(({ icon: Icon, text }) => (
                    <div key={text} className="flex items-center gap-3">
                      <Icon className="w-4 h-4 text-acr-brand flex-shrink-0" />
                      <span className="text-sm text-muted-foreground">{text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Button
                onClick={() => advance()}
                className="w-full bg-primary hover:bg-primary/90 py-3"
              >
                Activate Pax <Sparkles className="w-4 h-4 ml-2" aria-hidden="true" />
              </Button>
            </div>
          )}

          {currentStep.id === "complete" && (
            <div className="space-y-6 text-center">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 bg-acr-pos/20 rounded-full animate-ping" />
                <div className="relative w-20 h-20 bg-acr-pos-soft/50 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-10 h-10 text-acr-pos" />
                </div>
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">You're all set!</h3>
                <p className="text-muted-foreground">
                  {selectedPath === "beginner"
                    ? "Your first target county is configured. AcreOS found opportunities while we talked — let's look at them."
                    : selectedPath === "active"
                    ? "Your operation is upgraded. The Autonomous Deal Machine will start tonight."
                    : "Your enterprise platform is configured. Invite your team to get started."}
                </p>
              </div>

              {/* Preview stats */}
              <div className="grid grid-cols-3 gap-3">
                {(selectedPath === "beginner"
                  ? [
                      { label: "Target Counties", value: "1", sub: "configured" },
                      { label: "Deals Found", value: "3+", sub: "overnight" },
                      { label: "Deal Machine", value: "Active", sub: "tonight" },
                    ]
                  : selectedPath === "active"
                  ? [
                      { label: "Counties", value: String(formData.targetCounties?.length || 1), sub: "tracked" },
                      { label: "Automation", value: "On", sub: "nightly scans" },
                      { label: "Portfolio", value: formData.dataImported ? "Imported" : "Ready", sub: "synced" },
                    ]
                  : [
                      { label: "Team", value: formData.teamInvited ? "Invited" : "Ready", sub: "onboarded" },
                      { label: "Integrations", value: "Set", sub: "configured" },
                      { label: "Workflows", value: "Active", sub: "customized" },
                    ]
                ).map(({ label, value, sub }) => (
                  <div key={label} className="bg-acr-bg-sunken border border-border rounded-card p-3 text-center">
                    <div className="text-2xl font-bold text-acr-pos">{value}</div>
                    <div className="text-xs text-white">{label}</div>
                    <div className="text-xs text-muted-foreground">{sub}</div>
                  </div>
                ))}
              </div>

              {/* What to do first */}
              <div className="p-4 bg-acr-bg-sunken border border-border rounded-xl text-left">
                <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wide">What to do first</p>
                <div className="space-y-2">
                  {(selectedPath === "beginner"
                    ? [
                        { label: "Review your deal opportunities", href: "/leads" },
                        { label: "Send your first mailer campaign", href: "/campaigns" },
                        { label: "Ask Pax a question about land investing", href: "/ai" },
                      ]
                    : selectedPath === "active"
                    ? [
                        { label: "Check tonight's Deal Hunter results", href: "/leads" },
                        { label: "Review your imported portfolio", href: "/properties" },
                        { label: "Set up a follow-up campaign", href: "/campaigns" },
                      ]
                    : [
                        { label: "Invite your team and assign roles", href: "/settings" },
                        { label: "Configure your deal pipeline stages", href: "/pipeline" },
                        { label: "Set up automated campaigns", href: "/campaigns" },
                      ]
                  ).map(({ label, href }) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 text-sm text-muted-foreground p-2 rounded hover:bg-acr-bg-sunken/50"
                    >
                      <ArrowRight className="w-3 h-3 text-acr-pos flex-shrink-0" />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
                className="w-full bg-primary hover:bg-primary/90 py-4 text-lg font-semibold"
              >
                {completeMutation.isPending ? "Setting up…" : "Go to my dashboard"}
                <ArrowRight className="w-5 h-5 ml-2" aria-hidden="true" />
              </Button>

              <p className="text-xs text-muted-foreground">
                AcreOS will run its first deal scan tonight. Check your email at 7 AM for your Morning Briefing.
              </p>
            </div>
          )}

          {/* Active path: portfolio_import */}
          {currentStep.id === "portfolio_import" && (
            <PortfolioImportStep onContinue={(data) => advance(data)} />
          )}

          {/* Active path: target_counties */}
          {currentStep.id === "target_counties" && (
            <TargetCountiesStep
              formData={formData}
              setFormData={setFormData}
              onContinue={(data) => advance(data)}
            />
          )}

          {/* Active path: automation */}
          {currentStep.id === "automation" && (
            <AutomationStep onContinue={() => advance()} />
          )}

          {/* Enterprise path: team */}
          {currentStep.id === "team" && (
            <TeamSetupStep onContinue={(data) => advance(data)} />
          )}

          {/* Enterprise path: integrations */}
          {currentStep.id === "integrations" && (
            <IntegrationsStep onContinue={() => advance()} />
          )}

          {/* Enterprise path: workflows */}
          {currentStep.id === "workflows" && (
            <WorkflowsStep onContinue={() => advance()} />
          )}
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex justify-center gap-2 py-4">
        {steps.map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i < currentStepIndex
                ? "w-6 bg-acr-pos"
                : i === currentStepIndex
                ? "w-8 bg-acr-pos"
                : "w-2 bg-acr-bg-sunken"
            )}
          />
        ))}
      </div>
    </div>
  );
}
