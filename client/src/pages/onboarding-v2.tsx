import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  PartyPopper,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { QueryErrorState } from "@/components/query-error-state";

// ── Completion celebration animation ─────────────────────────────────────
// Pure CSS confetti burst that plays for 2s then fades to reveal content.

function CompletionCelebration({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      <style>{`
        @keyframes acr-confetti-burst {
          0% { transform: scale(0) rotate(0deg); opacity: 1; }
          50% { transform: scale(1.2) rotate(180deg); opacity: 0.8; }
          100% { transform: scale(1) rotate(360deg); opacity: 0; }
        }
        @keyframes acr-celebration-glow {
          0% { transform: scale(0.3); opacity: 0; filter: blur(8px); }
          40% { transform: scale(1.05); opacity: 1; filter: blur(0px); }
          100% { transform: scale(1); opacity: 1; filter: blur(0px); }
        }
        @keyframes acr-dot {
          0% { transform: translate(0, 0) scale(1); opacity: 1; }
          100% { opacity: 0; }
        }
        .acr-dot-1 { animation: acr-dot 1.8s ease-out forwards; transform: translate(-60px, -80px) scale(0); }
        .acr-dot-2 { animation: acr-dot 1.6s ease-out 0.1s forwards; transform: translate(70px, -70px) scale(0); }
        .acr-dot-3 { animation: acr-dot 1.5s ease-out 0.2s forwards; transform: translate(-40px, -100px) scale(0); }
        .acr-dot-4 { animation: acr-dot 1.7s ease-out 0.15s forwards; transform: translate(50px, -90px) scale(0); }
        .acr-dot-5 { animation: acr-dot 1.4s ease-out 0.25s forwards; transform: translate(-80px, -50px) scale(0); }
        .acr-dot-6 { animation: acr-dot 1.9s ease-out 0.05s forwards; transform: translate(80px, -40px) scale(0); }
        .acr-dot-7 { animation: acr-dot 1.3s ease-out 0.3s forwards; transform: translate(0px, -110px) scale(0); }
        .acr-dot-8 { animation: acr-dot 1.6s ease-out 0.12s forwards; transform: translate(-70px, -30px) scale(0); }
        .acr-celebration-content {
          animation: acr-celebration-glow 2s ease-out forwards;
        }
      `}</style>
      {/* Confetti dots */}
      <div className="absolute inset-0 flex items-start justify-center pointer-events-none overflow-hidden">
        <div className="relative mt-10">
          <div className="acr-dot-1 absolute w-2 h-2 rounded-full bg-emerald-400" />
          <div className="acr-dot-2 absolute w-3 h-3 rounded-full bg-yellow-400" />
          <div className="acr-dot-3 absolute w-2 h-2 rounded-full bg-purple-400" />
          <div className="acr-dot-4 absolute w-2.5 h-2.5 rounded-full bg-blue-400" />
          <div className="acr-dot-5 absolute w-2 h-2 rounded-full bg-pink-400" />
          <div className="acr-dot-6 absolute w-3 h-3 rounded-full bg-orange-400" />
          <div className="acr-dot-7 absolute w-2 h-2 rounded-full bg-teal-400" />
          <div className="acr-dot-8 absolute w-2.5 h-2.5 rounded-full bg-red-400" />
        </div>
      </div>
      <div className="acr-celebration-content">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Onboarding flow — 3 paths, guided by Atlas
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
    { id: "path", title: "Welcome to AcreOS", subtitle: "Let's personalize your experience" },
    { id: "target_county", title: "Where Do You Want to Invest?", subtitle: "Your first step: pick a county to explore" },
    { id: "instant_hunt", title: "🔥 AcreOS Found Real Opportunities", subtitle: "Here's what's available in your target area RIGHT NOW" },
    { id: "strategy", title: "What's Your Strategy?", subtitle: "How do you plan to make money with land?" },
    { id: "atlas_tour", title: "Meet Atlas, Your AI Deal Partner", subtitle: "Atlas works 24/7 so you don't have to" },
    { id: "complete", title: "You're Ready to Find Deals!", subtitle: "Your personalized dashboard is configured" },
  ],
  active: [
    { id: "path", title: "Welcome Back to AcreOS", subtitle: "Upgrade your investing operation" },
    { id: "portfolio_import", title: "Import Your Existing Portfolio", subtitle: "Connect what you've built so AcreOS can analyze it" },
    { id: "target_counties", title: "Set Your Target Counties", subtitle: "Configure Deal Hunter for your active markets" },
    { id: "instant_hunt", title: "🔥 Deals in Your Markets", subtitle: "Here's what AcreOS found in your target counties" },
    { id: "automation", title: "Configure Autonomous Deal Machine", subtitle: "Set it once — AcreOS finds deals every night" },
    { id: "complete", title: "Your Operation is Upgraded!", subtitle: "AcreOS is now working while you sleep" },
  ],
  enterprise: [
    { id: "path", title: "Enterprise Setup", subtitle: "Configure AcreOS for your team" },
    { id: "team", title: "Set Up Your Team", subtitle: "Invite deal analysts, VAs, and closing coordinators" },
    { id: "integrations", title: "Connect Your Tools", subtitle: "CRM, accounting, and communication stack" },
    { id: "instant_hunt", title: "🔥 Enterprise Market Scan", subtitle: "AcreOS scanning all your target markets simultaneously" },
    { id: "workflows", title: "Configure Deal Workflows", subtitle: "Custom pipeline stages and automation rules" },
    { id: "complete", title: "Enterprise Platform Ready!", subtitle: "Your team can now work deals at scale" },
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
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3"
        >
          Continue to Dashboard <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        {isLoading ? (
          <div className="space-y-3">
            <div className="w-12 h-12 rounded-full border-4 border-emerald-500 border-t-transparent animate-spin mx-auto" />
            <p className="text-gray-400">
              Scanning {targetCounty} County, {targetState} for motivated sellers...
            </p>
            <p className="text-xs text-gray-600">
              Checking tax delinquency records · Scoring seller motivation · Finding opportunities
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-2xl font-bold text-white">
              Found {opportunities.length} opportunities
              {totalScanned > 0 && (
                <span className="text-gray-400 text-base font-normal ml-2">
                  ({totalScanned.toLocaleString()} properties scanned)
                </span>
              )}
            </div>
            <p className="text-gray-400 text-sm">
              in {targetCounty} County, {targetState} — ranked by seller motivation
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
                "rounded-xl border p-4 relative overflow-hidden",
                i === 0
                  ? "border-red-500/50 bg-red-950/20"
                  : i === 1
                  ? "border-yellow-500/30 bg-yellow-950/10"
                  : "border-gray-700 bg-gray-900/50"
              )}
            >
              {i === 0 && (
                <div className="absolute top-2 right-2">
                  <Badge className="bg-red-600 text-white text-xs">🔥 Hot Deal</Badge>
                </div>
              )}
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-semibold text-white">{opp.ownerName}</div>
                  <div className="text-xs text-gray-400">
                    {opp.acreage} acres · {opp.county}, {opp.state}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={cn(
                      "text-lg font-bold",
                      opp.motivationScore >= 80
                        ? "text-red-400"
                        : opp.motivationScore >= 65
                        ? "text-yellow-400"
                        : "text-gray-400"
                    )}
                  >
                    {opp.motivationGrade} · {opp.motivationScore}
                  </div>
                  <div className="text-xs text-gray-500">Motivation Score</div>
                </div>
              </div>

              <div className="text-xs text-gray-400 mb-3">
                📍 Top Signal: <span className="text-gray-300">{opp.topSignal}</span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-800/60 rounded-lg p-2">
                  <div className="text-sm font-semibold text-white">
                    ${opp.estimatedOfferPrice.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">Offer Price</div>
                </div>
                <div className="bg-gray-800/60 rounded-lg p-2">
                  <div className="text-sm font-semibold text-white">
                    ${opp.estimatedResaleValue.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">Resale Value</div>
                </div>
                <div className="bg-emerald-900/40 rounded-lg p-2">
                  <div className="text-sm font-semibold text-emerald-400">
                    ${opp.potentialProfit.toLocaleString()}
                  </div>
                  <div className="text-xs text-gray-500">Potential Profit</div>
                </div>
              </div>
            </div>
          ))}

          <p className="text-xs text-gray-600 text-center">
            These are real data points from public records in {targetCounty} County.
            AcreOS finds new opportunities like these every night automatically.
          </p>
        </div>
      )}

      {!isLoading && opportunities.length === 0 && (
        <div className="text-center py-6">
          <div className="text-gray-500 mb-2">No high-motivation leads found in this county yet.</div>
          <div className="text-sm text-gray-600">
            AcreOS will monitor {targetCounty} County and alert you when opportunities emerge.
          </div>
        </div>
      )}

      <Button
        onClick={onContinue}
        disabled={isLoading}
        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-3"
      >
        {isLoading ? "Scanning..." : "Continue to Dashboard"}
        <ArrowRight className="w-4 h-4 ml-2" />
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
      setImportComplete(true);
      toast({
        title: "Import successful",
        description: `Imported ${result.imported ?? result.count ?? 0} leads from your file.`,
      });
    } catch {
      toast({
        title: "Import failed",
        description: "Check the file format and try again.",
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
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-gray-700 rounded-xl p-10 text-center cursor-pointer hover:border-blue-500 transition-colors"
        >
          <Upload className="w-10 h-10 text-gray-500 mx-auto mb-3" />
          <p className="text-gray-300 font-medium">Drop your CSV or XLSX file here</p>
          <p className="text-gray-500 text-sm mt-1">or click to browse</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-blue-950/30 border border-blue-700/30 rounded-lg">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-blue-400" />
              <span className="text-white text-sm font-medium">{file.name}</span>
            </div>
            {!importComplete && (
              <button
                onClick={() => { setFile(null); setPreview([]); }}
                className="text-gray-500 hover:text-gray-300 text-xs"
              >
                Change file
              </button>
            )}
          </div>

          {preview.length > 0 && !importComplete && (
            <div className="overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full text-xs text-gray-300">
                <thead>
                  <tr className="bg-gray-900/80">
                    {preview[0]?.map((header, i) => (
                      <th key={i} className="px-3 py-2 text-left font-medium text-gray-400">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(1, 6).map((row, ri) => (
                    <tr key={ri} className="border-t border-gray-800/50">
                      {row.map((cell, ci) => (
                        <td key={ci} className="px-3 py-1.5 truncate max-w-[120px]">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-1.5 text-xs text-gray-600 bg-gray-900/50">
                Showing first {Math.min(preview.length - 1, 5)} rows
              </div>
            </div>
          )}

          {importComplete && (
            <div className="p-3 bg-emerald-950/30 border border-emerald-700/30 rounded-lg text-emerald-300 text-sm flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              Portfolio imported successfully
            </div>
          )}
        </div>
      )}

      <div className="flex gap-3">
        {file && !importComplete && (
          <Button
            onClick={handleUpload}
            disabled={isUploading}
            className="flex-1 bg-blue-600 hover:bg-blue-700 py-3"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4 mr-2" />
                Import {preview.length > 1 ? `${preview.length - 1} rows` : "file"}
              </>
            )}
          </Button>
        )}
        <Button
          onClick={() => onContinue({ dataImported: importComplete || !!file })}
          className={cn(
            "py-3",
            file && !importComplete ? "flex-1" : "w-full",
            "bg-emerald-600 hover:bg-emerald-700"
          )}
        >
          {importComplete ? "Continue" : "Skip for now"} <ArrowRight className="w-4 h-4 ml-2" />
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
            <Input
              placeholder="ST"
              maxLength={2}
              value={c.state}
              onChange={(e) => updateCounty(i, "state", e.target.value)}
              className="bg-gray-900 border-gray-700 text-white text-center"
            />
          </div>
          <div className="flex-1">
            <Input
              placeholder="County name"
              value={c.county}
              onChange={(e) => updateCounty(i, "county", e.target.value)}
              className="bg-gray-900 border-gray-700 text-white"
            />
          </div>
        </div>
      ))}

      {counties.length < 5 && (
        <button
          onClick={addCounty}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          + Add another county (up to 5)
        </button>
      )}

      <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg">
        <p className="text-xs text-gray-500 mb-1">Pro tip</p>
        <p className="text-xs text-gray-400">
          Running deals in 3-5 counties gives you enough deal flow while keeping focus.
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
        className="w-full bg-emerald-600 hover:bg-emerald-700 py-3"
      >
        Set {validCounties.length} {validCounties.length === 1 ? "County" : "Counties"} as Targets
        <Target className="w-4 h-4 ml-2" />
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
      <div className="p-4 bg-blue-950/20 border border-blue-700/30 rounded-xl">
        <div className="flex items-center gap-3 mb-3">
          <Zap className="w-5 h-5 text-blue-400" />
          <span className="font-medium text-white">Autonomous Deal Machine</span>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          AcreOS runs these processes automatically every night. Toggle what you want active.
        </p>
        <div className="space-y-3">
          {[
            {
              key: "dealHunter" as const,
              icon: Target,
              label: "Nightly Deal Hunter",
              desc: "Scans your target counties for new motivated sellers",
            },
            {
              key: "autoMail" as const,
              icon: Mail,
              label: "Auto-Send First Touch Mailers",
              desc: "Automatically sends initial outreach to new high-score leads",
            },
            {
              key: "morningBriefing" as const,
              icon: Star,
              label: "Morning Briefing Email",
              desc: "Daily summary of new opportunities, responses, and action items",
            },
          ].map(({ key, icon: Icon, label, desc }) => (
            <button
              key={key}
              onClick={() => setSettings((prev) => ({ ...prev, [key]: !prev[key] }))}
              className={cn(
                "w-full text-left p-3 rounded-lg border transition-colors flex items-start gap-3",
                settings[key]
                  ? "border-blue-500/50 bg-blue-950/30"
                  : "border-gray-700 bg-gray-900/50"
              )}
            >
              <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", settings[key] ? "text-blue-400" : "text-gray-500")} />
              <div className="flex-1">
                <div className="text-sm font-medium text-white">{label}</div>
                <div className="text-xs text-gray-500">{desc}</div>
              </div>
              <div className={cn(
                "w-8 h-5 rounded-full transition-colors flex items-center px-0.5 flex-shrink-0 mt-0.5",
                settings[key] ? "bg-blue-500 justify-end" : "bg-gray-700 justify-start"
              )}>
                <div className="w-4 h-4 bg-white rounded-full" />
              </div>
            </button>
          ))}
        </div>
      </div>

      <Button onClick={onContinue} className="w-full bg-emerald-600 hover:bg-emerald-700 py-3">
        Activate Deal Machine <Zap className="w-4 h-4 ml-2" />
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
      const res = await apiRequest("POST", "/api/team/invite", { emails: emailList });
      return res.json();
    },
    onSuccess: () => {
      setInvitesSent(true);
      toast({ title: "Invitations sent", description: "Your team members will receive an email invite." });
    },
    onError: () => {
      toast({ title: "Could not send invites", description: "You can invite team members later in Settings.", variant: "destructive" });
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
      <div className="p-4 bg-purple-950/20 border border-purple-700/30 rounded-xl">
        <div className="space-y-3">
          {[
            { icon: UserPlus, role: "Deal Analysts", desc: "Find and evaluate acquisition targets" },
            { icon: Users, role: "Virtual Assistants", desc: "Handle outreach, follow-ups, and data entry" },
            { icon: Briefcase, role: "Closing Coordinators", desc: "Manage contracts and transactions" },
          ].map(({ icon: Icon, role, desc }) => (
            <div key={role} className="flex items-center gap-3 p-2">
              <div className="w-8 h-8 bg-purple-900/50 rounded-lg flex items-center justify-center flex-shrink-0">
                <Icon className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <div className="text-sm font-medium text-white">{role}</div>
                <div className="text-xs text-gray-500">{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Label className="text-gray-300 mb-2 block">Invite team members</Label>
        <Textarea
          placeholder="Enter email addresses (one per line or comma-separated)"
          value={emails}
          onChange={(e) => setEmails(e.target.value)}
          className="bg-gray-900 border-gray-700 text-white min-h-[80px]"
          disabled={invitesSent}
        />
      </div>

      {invitesSent && (
        <div className="p-3 bg-emerald-950/30 border border-emerald-700/30 rounded-lg text-emerald-300 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Invitations sent successfully
        </div>
      )}

      <div className="flex gap-3">
        {!invitesSent && emails.trim() && (
          <Button
            onClick={handleInvite}
            disabled={inviteMutation.isPending}
            className="flex-1 bg-purple-600 hover:bg-purple-700 py-3"
          >
            {inviteMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
            ) : (
              <><Mail className="w-4 h-4 mr-2" /> Send Invites</>
            )}
          </Button>
        )}
        <Button
          onClick={() => onContinue({ teamInvited: invitesSent })}
          className={cn(
            "py-3 bg-emerald-600 hover:bg-emerald-700",
            !invitesSent && emails.trim() ? "flex-1" : "w-full"
          )}
        >
          {invitesSent ? "Continue" : "Skip for now"} <ArrowRight className="w-4 h-4 ml-2" />
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
      name: "Stripe Payments",
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
      name: "API & Webhooks",
      desc: "Connect external tools via REST API and webhooks",
      status: "available",
      configUrl: "/webhooks",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {integrations.map(({ icon: Icon, name, desc, status, configUrl }) => (
          <div
            key={name}
            className={cn(
              "p-4 rounded-xl border flex items-start gap-3",
              status === "connected"
                ? "border-emerald-700/40 bg-emerald-950/20"
                : "border-gray-700 bg-gray-900/50"
            )}
          >
            <div className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
              status === "connected" ? "bg-emerald-900/50" : "bg-gray-800"
            )}>
              <Icon className={cn("w-5 h-5", status === "connected" ? "text-emerald-400" : "text-gray-400")} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white text-sm">{name}</span>
                <Badge
                  className={cn(
                    "text-[10px] px-1.5",
                    status === "connected"
                      ? "bg-emerald-900/60 text-emerald-300 border-emerald-700/30"
                      : "bg-gray-800 text-gray-400 border-gray-700"
                  )}
                >
                  {status === "connected" ? "Connected" : "Not configured"}
                </Badge>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-600 text-center">
        You can configure all integrations later in Settings.
      </p>

      <Button onClick={onContinue} className="w-full bg-emerald-600 hover:bg-emerald-700 py-3">
        Continue <ArrowRight className="w-4 h-4 ml-2" />
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
      title: "Standard Deal Pipeline",
      desc: "Lead → Contact → Negotiate → Contract → Close",
      stages: 5,
    },
    {
      id: "high_volume",
      icon: Zap,
      title: "High-Volume Acquisition",
      desc: "Auto-score → Auto-offer → Review → Close",
      stages: 4,
    },
    {
      id: "team_review",
      icon: Users,
      title: "Team Review Workflow",
      desc: "Analyst → Manager Approval → Offer → Contract → Close",
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
      <div className="space-y-3">
        {workflows.map(({ id, icon: Icon, title, desc, stages }) => (
          <button
            key={id}
            onClick={() => toggle(id)}
            className={cn(
              "w-full text-left p-4 rounded-xl border-2 transition-all",
              selectedWorkflows.includes(id)
                ? "border-purple-500 bg-purple-950/20"
                : "border-gray-700 bg-gray-900 hover:border-gray-600"
            )}
          >
            <div className="flex items-center gap-3">
              <Icon className={cn("w-5 h-5 flex-shrink-0", selectedWorkflows.includes(id) ? "text-purple-400" : "text-gray-500")} />
              <div>
                <div className="font-semibold text-white text-sm">{title}</div>
                <div className="text-xs text-gray-400">{desc}</div>
                <div className="text-xs text-gray-600 mt-1">{stages} stages</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <p className="text-xs text-gray-600 text-center">
        Custom pipeline stages can be added in Settings after setup.
      </p>

      <Button
        onClick={onContinue}
        disabled={selectedWorkflows.length === 0}
        className="w-full bg-purple-600 hover:bg-purple-700 py-3"
      >
        Configure {selectedWorkflows.length} {selectedWorkflows.length === 1 ? "Workflow" : "Workflows"}
        <Settings className="w-4 h-4 ml-2" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main onboarding wizard
// ---------------------------------------------------------------------------

export default function OnboardingV2() {
  const [, navigate] = useLocation();
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
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest("POST", "/api/onboarding/complete", { formData, path: selectedPath });
      return resp.json();
    },
    onSuccess: () => navigate("/dashboard"),
  });

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
  };

  // PATH SELECTION screen (before step flow starts)
  if (!selectedPath) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full space-y-8">
          {/* Logo + headline */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 bg-emerald-900/40 border border-emerald-700/50 rounded-full px-4 py-2">
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span className="text-emerald-300 text-sm font-medium">The Most Intelligent Land Investing Platform</span>
            </div>
            <h1 className="text-4xl font-bold text-white">Welcome to AcreOS</h1>
            <p className="text-gray-400 text-lg">
              Tell us where you are in your land investing journey — we'll configure everything for you.
            </p>
          </div>

          {/* Path selection */}
          <div className="grid gap-4">
            {[
              {
                path: "beginner" as InvestorPath,
                icon: Home,
                title: "Just Getting Started",
                subtitle: "I'm new to land investing and want to learn the ropes",
                benefits: ["Guided first deal walkthrough", "Expert strategy explanations", "Sample deal pre-loaded", "Daily Atlas coaching tips"],
                color: "emerald",
              },
              {
                path: "active" as InvestorPath,
                icon: Building,
                title: "Active Real Estate Professional",
                subtitle: "I'm already doing deals and need better tools",
                benefits: ["Import existing portfolio", "Configure Deal Hunter for your markets", "Activate Autonomous Deal Machine", "Advanced analytics"],
                color: "blue",
              },
              {
                path: "enterprise" as InvestorPath,
                icon: Briefcase,
                title: "Team or Enterprise",
                subtitle: "I run a land investing operation with a team",
                benefits: ["Multi-user deal pipeline", "VA and team management", "White-label options", "API access for integrations"],
                color: "purple",
              },
            ].map(({ path, icon: Icon, title, subtitle, benefits, color }) => (
              <button
                key={path}
                onClick={() => {
                  setSelectedPath(path);
                  setCurrentStepIndex(0);
                }}
                className={cn(
                  "text-left p-6 rounded-2xl border-2 transition-all hover:scale-[1.01]",
                  `border-${color}-700/40 bg-${color}-950/20 hover:border-${color}-500`
                )}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-${color}-900/60 flex items-center justify-center flex-shrink-0`}>
                    <Icon className={`w-6 h-6 text-${color}-400`} />
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-white text-lg">{title}</div>
                    <div className="text-gray-400 text-sm mb-3">{subtitle}</div>
                    <div className="flex flex-wrap gap-2">
                      {benefits.map((b) => (
                        <span key={b} className="text-xs bg-gray-800 text-gray-300 px-2 py-1 rounded-full">
                          ✓ {b}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ArrowRight className={`w-5 h-5 text-${color}-400 flex-shrink-0 mt-1`} />
                </div>
              </button>
            ))}
          </div>

          <p className="text-center text-xs text-gray-600">
            You can change your path at any time in Settings · No credit card required to start
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      {/* Progress bar */}
      <div className="h-1 bg-gray-900">
        <div
          className="h-1 bg-emerald-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-900">
        <div className="text-sm font-medium text-emerald-400">AcreOS</div>
        <div className="text-xs text-gray-600">
          Step {currentStepIndex + 1} of {steps.length}
        </div>
        {currentStepIndex > 0 && (
          <button
            onClick={() => navigate("/dashboard")}
            className="text-xs text-gray-600 hover:text-gray-400"
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
            <p className="text-gray-400">{currentStep.subtitle}</p>
          </div>

          {/* Step content */}
          {currentStep.id === "path" && selectedPath && (
            <div className="space-y-4">
              <div className="p-4 bg-emerald-900/20 border border-emerald-700/30 rounded-xl">
                <div className="flex items-center gap-3 mb-3">
                  <Brain className="w-5 h-5 text-emerald-400" />
                  <span className="font-medium text-white">Atlas AI is ready to help</span>
                </div>
                <p className="text-sm text-gray-400">
                  {selectedPath === "beginner"
                    ? "I'll guide you through finding your first land deal step by step. Land investing is simpler than most real estate — no tenants, no repairs, just buying cheap and selling for a profit."
                    : selectedPath === "active"
                    ? "Let's upgrade your operation. I'll analyze your existing deals, identify your best counties, and configure the Autonomous Deal Machine to find new opportunities every night."
                    : "I'll help configure AcreOS for your full team operation — deal routing, VA workflows, and enterprise analytics."}
                </p>
              </div>
              <Button
                onClick={() => advance()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 py-3"
              >
                Let's Get Started <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {currentStep.id === "target_county" && (
            <div className="space-y-4">
              <div>
                <Label className="text-gray-300 mb-2 block">Target State</Label>
                <Input
                  placeholder="e.g., TX"
                  maxLength={2}
                  value={formData.targetState || ""}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, targetState: e.target.value.toUpperCase() }))
                  }
                  className="bg-gray-900 border-gray-700 text-white text-lg py-3"
                />
              </div>
              <div>
                <Label className="text-gray-300 mb-2 block">Target County</Label>
                <Input
                  placeholder="e.g., Hudspeth"
                  value={formData.targetCounty || ""}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, targetCounty: e.target.value }))
                  }
                  className="bg-gray-900 border-gray-700 text-white text-lg py-3"
                />
              </div>
              <div className="p-3 bg-gray-900 border border-gray-800 rounded-lg">
                <div className="text-xs text-gray-500 mb-2">💡 Not sure which county to pick?</div>
                <div className="text-xs text-gray-400">
                  Expert tip: Start with rural counties in TX, AZ, NM, or CO. Look for counties with
                  low competition (fewer mailers being sent) and active land sales. The Deal Hunter will
                  show you opportunity scores for any county you choose.
                </div>
              </div>
              <Button
                onClick={() => advance({ targetCounty: formData.targetCounty, targetState: formData.targetState })}
                disabled={!formData.targetCounty || !formData.targetState}
                className="w-full bg-emerald-600 hover:bg-emerald-700 py-3"
              >
                Scan This County <Zap className="w-4 h-4 ml-2" />
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
                  <div className="text-xs font-medium uppercase tracking-wider text-gray-500 px-1">{group}</div>
                  {types.map(({ value, icon: Icon, title, desc }) => (
                    <button
                      key={value}
                      onClick={() => advance({ strategy: value, businessType: value })}
                      className={cn(
                        "w-full text-left p-4 rounded-xl border-2 transition-all",
                        formData.strategy === value
                          ? "border-emerald-500 bg-emerald-900/20"
                          : "border-gray-700 bg-gray-900 hover:border-gray-600"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-emerald-900/50 flex items-center justify-center flex-shrink-0">
                          <Icon className="w-5 h-5 text-emerald-400" />
                        </div>
                        <div>
                          <div className="font-semibold text-white">{title}</div>
                          <div className="text-sm text-gray-400">{desc}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          {currentStep.id === "atlas_tour" && (
            <div className="space-y-4">
              <div className="p-5 bg-purple-950/30 border border-purple-700/30 rounded-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 bg-purple-700/50 rounded-full flex items-center justify-center">
                    <Brain className="w-5 h-5 text-purple-300" />
                  </div>
                  <div>
                    <div className="font-bold text-white">Atlas AI</div>
                    <div className="text-xs text-gray-500">Your autonomous deal partner</div>
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
                      <Icon className="w-4 h-4 text-purple-400 flex-shrink-0" />
                      <span className="text-sm text-gray-300">{text}</span>
                    </div>
                  ))}
                </div>
              </div>
              <Button
                onClick={() => advance()}
                className="w-full bg-purple-600 hover:bg-purple-700 py-3"
              >
                Activate Atlas <Sparkles className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {currentStep.id === "complete" && (
            <CompletionCelebration>
            <div className="space-y-6 text-center">
              <div className="relative w-20 h-20 mx-auto">
                <div className="absolute inset-0 bg-emerald-500/20 rounded-full animate-ping" />
                <div className="relative w-20 h-20 bg-emerald-900/50 rounded-full flex items-center justify-center">
                  <CheckCircle className="w-10 h-10 text-emerald-400" />
                </div>
              </div>
              <div>
                <h3 className="text-xl font-bold text-white mb-2">You're all set!</h3>
                <p className="text-gray-400">
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
                  <div key={label} className="bg-gray-900 border border-gray-800 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-emerald-400">{value}</div>
                    <div className="text-xs text-white">{label}</div>
                    <div className="text-xs text-gray-600">{sub}</div>
                  </div>
                ))}
              </div>

              {/* What to do first */}
              <div className="p-4 bg-gray-900 border border-gray-800 rounded-xl text-left">
                <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">What to do first</p>
                <div className="space-y-2">
                  {(selectedPath === "beginner"
                    ? [
                        { label: "Review your deal opportunities", href: "/leads" },
                        { label: "Send your first mailer campaign", href: "/campaigns" },
                        { label: "Ask Atlas a question about land investing", href: "/ai" },
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
                      className="flex items-center gap-2 text-sm text-gray-300 p-2 rounded hover:bg-gray-800/50"
                    >
                      <ArrowRight className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <Button
                onClick={() => completeMutation.mutate()}
                disabled={completeMutation.isPending}
                className="w-full bg-emerald-600 hover:bg-emerald-700 py-4 text-lg font-semibold"
              >
                {completeMutation.isPending ? "Setting up..." : "Go to My Dashboard"}
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>

              <p className="text-xs text-gray-600">
                AcreOS will run its first deal scan tonight. Check your email at 7 AM for your Morning Briefing.
              </p>
            </div>
            </CompletionCelebration>
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
                ? "w-6 bg-emerald-500"
                : i === currentStepIndex
                ? "w-8 bg-emerald-400"
                : "w-2 bg-gray-800"
            )}
          />
        ))}
      </div>
    </div>
  );
}
