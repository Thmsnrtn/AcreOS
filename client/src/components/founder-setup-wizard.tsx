/**
 * FounderSetupWizard — Interactive Platform Credential Setup
 *
 * Multi-step wizard that walks the founder through configuring every
 * required and optional platform credential. Saves encrypted to DB,
 * validates with live API calls, and auto-wires services like Stripe webhooks.
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Server, Bot, CreditCard, Mail, Map as LucideMap, FileText, Phone, Database,
  Sparkles, Key, CheckCircle2, XCircle, AlertCircle, Loader2,
  Eye, EyeOff, Copy, RefreshCw, ExternalLink, ChevronRight,
  ChevronLeft, Zap, Shield, ArrowRight, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CredentialEntry {
  key: string;
  service: string;
  label: string;
  isSecret: boolean;
  isRequired: boolean;
  hasValue: boolean;
  source: "env" | "db" | "missing";
  maskedValue?: string;
  validationStatus?: string | null;
  validationMessage?: string | null;
}

interface ServiceGroup {
  service: string;
  label: string;
  description: string;
  icon: string;
  required: boolean;
  configured: number;
  total: number;
  allConfigured: boolean;
  requiredMissing: string[];
}

interface SetupStatus {
  credentials: CredentialEntry[];
  serviceGroups: ServiceGroup[];
  readinessScore: number;
  isLaunchReady: boolean;
  summary: {
    total: number;
    configured: number;
    requiredTotal: number;
    requiredConfigured: number;
    missingRequired: string[];
  };
}

interface ValidationResult {
  status: "ok" | "error" | "warn";
  message: string;
  details?: Record<string, any>;
}

// ─── Icon map ────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Server, Bot, CreditCard, Mail, Map: LucideMap, FileText, Phone, Database, Sparkles, Key,
};

// ─── Credential hints ────────────────────────────────────────────────────────

const HINTS: Record<string, string> = {
  DATABASE_URL: "postgresql://user:password@host:5432/dbname",
  SESSION_SECRET: "Click 'Generate' for a cryptographically secure value",
  APP_URL: "https://yourdomain.com (no trailing slash)",
  FOUNDER_EMAIL: "Your email — grants founder-level access",
  FIELD_ENCRYPTION_KEY: "Click 'Generate' for a 64-hex-char AES-256 key",
  AI_INTEGRATIONS_OPENROUTER_API_KEY: "sk-or-... — get free credits at openrouter.ai",
  OPENAI_API_KEY: "sk-... — only needed if OpenRouter is unavailable",
  STRIPE_SECRET_KEY: "sk_live_... or sk_test_... — from Stripe Dashboard",
  STRIPE_PUBLISHABLE_KEY: "pk_live_... or pk_test_...",
  STRIPE_WEBHOOK_SECRET: "whsec_... — auto-filled when you click 'Wire Stripe'",
  AWS_ACCESS_KEY_ID: "AKIA... — IAM user with SES:SendEmail permission",
  AWS_SECRET_ACCESS_KEY: "Secret access key for the IAM user above",
  AWS_REGION: "us-east-1",
  AWS_SES_FROM_EMAIL: "no-reply@yourdomain.com — must be verified in SES",
  VITE_MAPBOX_ACCESS_TOKEN: "pk.eyJ1... — from account.mapbox.com",
  LOB_API_KEY: "test_... or live_... — from dashboard.lob.com",
  TWILIO_ACCOUNT_SID: "AC... — from console.twilio.com",
  TWILIO_AUTH_TOKEN: "Auth token from Twilio Console",
  TWILIO_PHONE_NUMBER: "+12125550100",
  REDIS_URL: "redis://localhost:6379 or rediss://user:pass@host:6380",
  MCP_API_KEY: "Click 'Generate' for a secure random key",
};

const DOC_LINKS: Record<string, string> = {
  AI_INTEGRATIONS_OPENROUTER_API_KEY: "https://openrouter.ai/keys",
  STRIPE_SECRET_KEY: "https://dashboard.stripe.com/apikeys",
  STRIPE_PUBLISHABLE_KEY: "https://dashboard.stripe.com/apikeys",
  VITE_MAPBOX_ACCESS_TOKEN: "https://account.mapbox.com/access-tokens/",
  LOB_API_KEY: "https://dashboard.lob.com/settings/api-keys",
};

const GENERATE_TYPES: Record<string, string> = {
  SESSION_SECRET: "session-secret",
  FIELD_ENCRYPTION_KEY: "encryption-key",
  MCP_API_KEY: "mcp-key",
};

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { id: "welcome", label: "Welcome", service: null },
  { id: "core", label: "Core", service: "core" },
  { id: "ai", label: "AI", service: "openrouter" },
  { id: "payments", label: "Payments", service: "stripe" },
  { id: "email", label: "Email", service: "aws" },
  { id: "maps", label: "Maps", service: "mapbox" },
  { id: "direct-mail", label: "Mail", service: "lob" },
  { id: "sms", label: "SMS", service: "twilio" },
  { id: "launch", label: "Launch", service: null },
];

const KEYS_BY_STEP: Record<string, string[]> = {
  core: ["DATABASE_URL", "SESSION_SECRET", "APP_URL", "FOUNDER_EMAIL", "FIELD_ENCRYPTION_KEY"],
  openrouter: ["AI_INTEGRATIONS_OPENROUTER_API_KEY", "OPENAI_API_KEY"],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET"],
  aws: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION", "AWS_SES_FROM_EMAIL"],
  mapbox: ["VITE_MAPBOX_ACCESS_TOKEN"],
  lob: ["LOB_API_KEY"],
  twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"],
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusDot({ status }: { status: "ok" | "error" | "warn" | "missing" | null }) {
  if (!status || status === "missing") return <div className="w-2 h-2 rounded-full bg-muted-foreground/30" />;
  if (status === "ok") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
  if (status === "error") return <XCircle className="w-4 h-4 text-red-500" />;
  return <AlertCircle className="w-4 h-4 text-yellow-500" />;
}

function CredentialField({
  credKey,
  credential,
  value,
  onChange,
  onGenerate,
  validating,
  validationResult,
}: {
  credKey: string;
  credential?: CredentialEntry;
  value: string;
  onChange: (val: string) => void;
  onGenerate?: (type: string) => void;
  validating?: boolean;
  validationResult?: ValidationResult | null;
}) {
  const [show, setShow] = useState(false);
  const isSecret = credential?.isSecret ?? true;
  const generateType = GENERATE_TYPES[credKey];
  const docLink = DOC_LINKS[credKey];
  const hint = HINTS[credKey] || "";
  const isRequired = credential?.isRequired ?? false;
  const hasExistingValue = credential?.hasValue && !value;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium flex items-center gap-1.5">
          {credential?.label || credKey}
          {isRequired && <span className="text-red-400 text-xs">*</span>}
        </Label>
        <div className="flex items-center gap-2">
          {docLink && (
            <a href={docLink} target="_blank" rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5">
              Docs <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {generateType && onGenerate && (
            <Button type="button" variant="outline" size="sm" className="h-6 text-xs px-2"
              onClick={() => onGenerate(generateType)}>
              <RefreshCw className="w-3 h-3 mr-1" /> Generate
            </Button>
          )}
        </div>
      </div>
      <div className="relative">
        <Input
          type={isSecret && !show ? "password" : "text"}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={hasExistingValue ? (credential?.maskedValue || "••••••••") : hint}
          className={cn(
            "pr-10 font-mono text-sm",
            validationResult?.status === "ok" && "border-green-500/50",
            validationResult?.status === "error" && "border-red-500/50",
          )}
        />
        {isSecret && (
          <Button type="button" variant="ghost" size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => setShow(v => !v)}>
            {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </Button>
        )}
      </div>
      {validationResult && (
        <p className={cn("text-xs flex items-center gap-1",
          validationResult.status === "ok" ? "text-green-600" :
          validationResult.status === "warn" ? "text-yellow-600" : "text-red-500")}>
          {validationResult.status === "ok" ? <CheckCircle2 className="w-3 h-3" /> :
           validationResult.status === "warn" ? <AlertCircle className="w-3 h-3" /> :
           <XCircle className="w-3 h-3" />}
          {validationResult.message}
        </p>
      )}
      {hasExistingValue && !value && !validationResult && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-green-500" />
          Already configured — leave blank to keep current value
        </p>
      )}
    </div>
  );
}

function ServiceBadge({ service, configured, total }: { service: string; configured: number; total: number }) {
  const pct = total > 0 ? configured / total : 0;
  return (
    <div className={cn("text-xs px-2 py-0.5 rounded-full border",
      pct === 1 ? "bg-green-500/10 text-green-600 border-green-500/20" :
      pct > 0 ? "bg-yellow-500/10 text-yellow-600 border-yellow-500/20" :
      "bg-muted text-muted-foreground border-border")}>
      {configured}/{total}
    </div>
  );
}

// ─── Score Ring ───────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (score / 100) * circumference;
  const color = score >= 70 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="100" height="100" viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" stroke="hsl(var(--muted))" />
        <circle cx="50" cy="50" r={radius} fill="none" strokeWidth="8" stroke={color}
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashOffset}
          style={{ transition: "stroke-dashoffset 0.8s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black leading-none" style={{ color }}>{score}</span>
        <span className="text-[10px] text-muted-foreground leading-none mt-0.5">/100</span>
      </div>
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
}

export function FounderSetupWizard({ open, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [validations, setValidations] = useState<Record<string, ValidationResult>>({});
  const [validating, setValidating] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [wiring, setWiring] = useState<string | null>(null);

  const { data: status, isLoading, refetch } = useQuery<SetupStatus>({
    queryKey: ["/api/founder/setup/status"],
    staleTime: 30_000,
    enabled: open,
  });

  const credMap = new Map<string, CredentialEntry>(
    (status?.credentials ?? []).map(c => [c.key, c] as [string, CredentialEntry])
  );

  const currentStepDef = STEPS[step];
  const stepService = currentStepDef.service;
  const stepKeys = stepService ? (KEYS_BY_STEP[stepService] ?? []) : [];

  // Field helper
  const setField = (key: string, val: string) =>
    setFieldValues(prev => ({ ...prev, [key]: val }));

  // Generate a value
  const handleGenerate = useCallback(async (type: string, targetKey?: string) => {
    try {
      const res = await apiRequest("POST", `/api/founder/setup/generate/${type}`);
      const data = await res.json();
      const key = targetKey || data.key;
      setFieldValues(prev => ({ ...prev, [key]: data.value }));
      toast({ title: "Generated", description: `${key} value ready — save to apply` });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  }, [toast]);

  // Save credentials
  const handleSave = useCallback(async () => {
    const toSave: Record<string, string> = {};
    for (const [k, v] of Object.entries(fieldValues)) {
      if (v.trim()) toSave[k] = v.trim();
    }
    if (Object.keys(toSave).length === 0) {
      return { saved: [], errors: [] };
    }

    setSaving(true);
    try {
      const res = await apiRequest("POST", "/api/founder/setup/save", { credentials: toSave });
      const data = await res.json();
      if (data.saved?.length > 0) {
        toast({ title: `Saved ${data.saved.length} credential(s)`, description: data.saved.join(", ") });
        // Clear saved fields
        setFieldValues(prev => {
          const next = { ...prev };
          for (const k of data.saved) delete next[k];
          return next;
        });
        refetch();
        qc.invalidateQueries({ queryKey: ["/api/founder/readiness"] });
      }
      if (data.errors?.length > 0) {
        toast({ title: "Some errors", description: data.errors.join("; "), variant: "destructive" });
      }
      return data;
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
      return { saved: [], errors: [e.message] };
    } finally {
      setSaving(false);
    }
  }, [fieldValues, toast, refetch, qc]);

  // Validate a service
  const handleValidate = useCallback(async (service: string) => {
    setValidating(prev => ({ ...prev, [service]: true }));
    try {
      const res = await apiRequest("POST", `/api/founder/setup/validate/${service}`);
      const data: ValidationResult = await res.json();
      // Store per-service
      setValidations(prev => ({ ...prev, [service]: data }));
      refetch();
    } catch (e: any) {
      setValidations(prev => ({ ...prev, [service]: { status: "error", message: e.message } }));
    } finally {
      setValidating(prev => ({ ...prev, [service]: false }));
    }
  }, [refetch]);

  // Wire a service
  const handleWire = useCallback(async (service: string) => {
    setWiring(service);
    try {
      const res = await apiRequest("POST", `/api/founder/setup/wire/${service}`);
      const data = await res.json();
      toast({
        title: data.status === "ok" ? "Wired!" : "Wire issue",
        description: data.message,
        variant: data.status === "ok" ? "default" : "destructive",
      });
      refetch();
    } catch (e: any) {
      toast({ title: "Wiring failed", description: e.message, variant: "destructive" });
    } finally {
      setWiring(null);
    }
  }, [toast, refetch]);

  // Next step with auto-save
  const handleNext = useCallback(async () => {
    const hasPendingValues = Object.values(fieldValues).some(v => v.trim());
    if (hasPendingValues) {
      await handleSave();
    }
    setStep(s => Math.min(s + 1, STEPS.length - 1));
  }, [fieldValues, handleSave]);

  const handleBack = () => setStep(s => Math.max(s - 1, 0));

  const score = status?.readinessScore ?? 0;
  const isLaunchReady = status?.isLaunchReady ?? false;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col p-0">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <Shield className="h-5 w-5 text-purple-500" />
                Platform Setup
              </DialogTitle>
              <DialogDescription className="text-sm mt-0.5">
                Configure credentials to activate all AcreOS services
              </DialogDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black" style={{
                color: score >= 70 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444"
              }}>
                {score}
                <span className="text-sm font-normal text-muted-foreground">/100</span>
              </div>
              <div className="text-xs text-muted-foreground">Readiness</div>
            </div>
          </div>
          {/* Step progress */}
          <div className="flex items-center gap-1 mt-3">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setStep(i)}
                className={cn(
                  "flex-1 h-1.5 rounded-full transition-colors",
                  i < step ? "bg-green-500" :
                  i === step ? "bg-purple-500" :
                  "bg-muted"
                )}
              />
            ))}
          </div>
          <div className="text-xs text-muted-foreground text-center">
            Step {step + 1} of {STEPS.length} — {currentStepDef.label}
          </div>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* Welcome */}
              {step === 0 && (
                <div className="space-y-6">
                  <div className="text-center py-4">
                    <div className="flex justify-center mb-4">
                      <ScoreRing score={score} />
                    </div>
                    <h2 className="text-xl font-bold">
                      {score >= 70 ? "You're nearly ready to launch!" :
                       score >= 40 ? "Getting there — let's finish setup" :
                       "Let's get AcreOS ready for land investors"}
                    </h2>
                    <p className="text-muted-foreground text-sm mt-2 max-w-md mx-auto">
                      This wizard will walk you through every credential needed to run the platform.
                      All secrets are encrypted with AES-256 before being stored.
                    </p>
                  </div>

                  {/* Service overview */}
                  <div className="grid grid-cols-2 gap-2">
                    {(status?.serviceGroups ?? []).map(sg => {
                      const Icon = ICON_MAP[sg.icon] || Key;
                      return (
                        <div key={sg.service}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border p-3",
                            sg.allConfigured ? "border-green-500/30 bg-green-500/5" :
                            sg.required ? "border-red-500/20 bg-red-500/5" :
                            "border-border bg-muted/30"
                          )}>
                          <Icon className={cn("w-4 h-4 shrink-0",
                            sg.allConfigured ? "text-green-500" :
                            sg.required ? "text-red-400" :
                            "text-muted-foreground")} />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">{sg.label}</div>
                            <div className="text-xs text-muted-foreground">{sg.description}</div>
                          </div>
                          <div className={cn("text-xs font-bold shrink-0",
                            sg.allConfigured ? "text-green-500" :
                            sg.required ? "text-red-400" : "text-muted-foreground")}>
                            {sg.configured}/{sg.total}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(status?.summary?.missingRequired?.length ?? 0) > 0 && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                      <p className="text-xs font-semibold text-red-500 mb-1.5">Required credentials missing:</p>
                      <div className="flex flex-wrap gap-1">
                        {(status?.summary?.missingRequired ?? []).map(k => (
                          <Badge key={k} variant="outline" className="text-xs font-mono bg-red-500/10 text-red-500 border-red-500/20">
                            {k}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Core */}
              {step === 1 && (
                <StepSection
                  title="Core Platform"
                  description="Essential settings that the platform cannot run without."
                  icon={<Server className="w-4 h-4 text-purple-500" />}
                  service="core"
                  stepKeys={KEYS_BY_STEP.core}
                  credMap={credMap}
                  fieldValues={fieldValues}
                  setField={setField}
                  validations={validations}
                  onGenerate={handleGenerate}
                  extras={
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                      <p className="text-xs text-blue-600 flex items-start gap-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>
                          <strong>SESSION_SECRET</strong> and <strong>FIELD_ENCRYPTION_KEY</strong> should be
                          generated once and never changed — rotating them invalidates existing sessions and encrypted data.
                        </span>
                      </p>
                    </div>
                  }
                />
              )}

              {/* AI */}
              {step === 2 && (
                <StepSection
                  title="AI Provider"
                  description="Powers land valuations, offer generation, lead scoring, and every AI-driven insight."
                  icon={<Bot className="w-4 h-4 text-purple-500" />}
                  service="openrouter"
                  stepKeys={KEYS_BY_STEP.openrouter}
                  credMap={credMap}
                  fieldValues={fieldValues}
                  setField={setField}
                  validations={validations}
                  onGenerate={handleGenerate}
                  validateButton={
                    <ValidateButton
                      service="openrouter"
                      label="Test OpenRouter"
                      onValidate={handleValidate}
                      loading={validating["openrouter"]}
                      result={validations["openrouter"]}
                    />
                  }
                  extras={
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 space-y-1">
                      <p className="text-xs text-purple-600 font-semibold">Why OpenRouter?</p>
                      <p className="text-xs text-muted-foreground">
                        One key gives access to Claude, GPT-4o, DeepSeek, and Gemini.
                        AcreOS automatically routes each task to the cheapest capable model —
                        valuation to DeepSeek ($0.14/M), offers to Claude Sonnet, vision to GPT-4o.
                      </p>
                    </div>
                  }
                />
              )}

              {/* Payments */}
              {step === 3 && (
                <StepSection
                  title="Stripe Payments"
                  description="Subscription billing, credit purchases, and revenue collection."
                  icon={<CreditCard className="w-4 h-4 text-purple-500" />}
                  service="stripe"
                  stepKeys={KEYS_BY_STEP.stripe}
                  credMap={credMap}
                  fieldValues={fieldValues}
                  setField={setField}
                  validations={validations}
                  onGenerate={handleGenerate}
                  validateButton={
                    <ValidateButton
                      service="stripe"
                      label="Test Stripe"
                      onValidate={handleValidate}
                      loading={validating["stripe"]}
                      result={validations["stripe"]}
                    />
                  }
                  wireButton={
                    <Button variant="outline" size="sm" className="gap-2"
                      onClick={() => handleWire("stripe")}
                      disabled={wiring === "stripe" || !status?.credentials.find(c => c.key === "STRIPE_SECRET_KEY")?.hasValue}>
                      {wiring === "stripe" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                      Auto-wire Webhook
                    </Button>
                  }
                  extras={
                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                      <p className="text-xs text-blue-600 flex items-start gap-1.5">
                        <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        Click <strong>"Auto-wire Webhook"</strong> after saving your Stripe keys —
                        it creates the webhook in your Stripe dashboard and saves the signing secret automatically.
                        Make sure APP_URL is set first.
                      </p>
                    </div>
                  }
                />
              )}

              {/* Email */}
              {step === 4 && (
                <StepSection
                  title="Email Delivery (AWS SES)"
                  description="Sends transactional emails — signup confirmations, password resets, and campaign outreach."
                  icon={<Mail className="w-4 h-4 text-purple-500" />}
                  service="aws"
                  stepKeys={KEYS_BY_STEP.aws}
                  credMap={credMap}
                  fieldValues={fieldValues}
                  setField={setField}
                  validations={validations}
                  onGenerate={handleGenerate}
                  validateButton={
                    <ValidateButton
                      service="aws"
                      label="Test SES"
                      onValidate={handleValidate}
                      loading={validating["aws"]}
                      result={validations["aws"]}
                    />
                  }
                  extras={
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                      <p className="text-xs text-amber-600 flex items-start gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        SES requires domain verification before sending. Verify your domain in the
                        AWS SES console before going live, otherwise emails will land in spam.
                      </p>
                    </div>
                  }
                />
              )}

              {/* Maps */}
              {step === 5 && (
                <StepSection
                  title="Maps (Mapbox)"
                  description="Parcel overlay maps, county heat maps, and geographic lead visualization."
                  icon={<LucideMap className="w-4 h-4 text-purple-500" />}
                  service="mapbox"
                  stepKeys={KEYS_BY_STEP.mapbox}
                  credMap={credMap}
                  fieldValues={fieldValues}
                  setField={setField}
                  validations={validations}
                  onGenerate={handleGenerate}
                  validateButton={
                    <ValidateButton
                      service="mapbox"
                      label="Test Mapbox"
                      onValidate={handleValidate}
                      loading={validating["mapbox"]}
                      result={validations["mapbox"]}
                    />
                  }
                  optional
                />
              )}

              {/* Direct Mail */}
              {step === 6 && (
                <StepSection
                  title="Direct Mail (Lob)"
                  description="Physical mailers — postcards, letters, and offer packets to land sellers."
                  icon={<FileText className="w-4 h-4 text-purple-500" />}
                  service="lob"
                  stepKeys={KEYS_BY_STEP.lob}
                  credMap={credMap}
                  fieldValues={fieldValues}
                  setField={setField}
                  validations={validations}
                  onGenerate={handleGenerate}
                  validateButton={
                    <ValidateButton
                      service="lob"
                      label="Test Lob"
                      onValidate={handleValidate}
                      loading={validating["lob"]}
                      result={validations["lob"]}
                    />
                  }
                  optional
                />
              )}

              {/* SMS */}
              {step === 7 && (
                <StepSection
                  title="SMS & Phone (Twilio)"
                  description="Text message campaigns and call routing for seller outreach."
                  icon={<Phone className="w-4 h-4 text-purple-500" />}
                  service="twilio"
                  stepKeys={KEYS_BY_STEP.twilio}
                  credMap={credMap}
                  fieldValues={fieldValues}
                  setField={setField}
                  validations={validations}
                  onGenerate={handleGenerate}
                  validateButton={
                    <ValidateButton
                      service="twilio"
                      label="Test Twilio"
                      onValidate={handleValidate}
                      loading={validating["twilio"]}
                      result={validations["twilio"]}
                    />
                  }
                  optional
                />
              )}

              {/* Launch */}
              {step === 8 && (
                <div className="space-y-6">
                  <div className="text-center py-2">
                    <div className="flex justify-center mb-4">
                      <ScoreRing score={score} />
                    </div>
                    <h2 className="text-xl font-bold">
                      {isLaunchReady ? "Ready to launch!" : "Almost there"}
                    </h2>
                    <p className="text-muted-foreground text-sm mt-1">
                      {isLaunchReady
                        ? "All required services are configured. Your platform is ready for land investors."
                        : "Some required credentials are still missing. Complete them to unlock full functionality."}
                    </p>
                  </div>

                  {/* Final service summary */}
                  <div className="space-y-2">
                    {(status?.serviceGroups ?? []).map(sg => {
                      const Icon = ICON_MAP[sg.icon] || Key;
                      return (
                        <div key={sg.service}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border px-4 py-2.5",
                            sg.allConfigured ? "border-green-500/30 bg-green-500/5" :
                            sg.required ? "border-red-500/20 bg-red-500/5" :
                            "border-border"
                          )}>
                          <Icon className={cn("w-4 h-4 shrink-0",
                            sg.allConfigured ? "text-green-500" :
                            sg.required ? "text-red-400" : "text-muted-foreground")} />
                          <div className="flex-1">
                            <span className="text-sm font-medium">{sg.label}</span>
                            {!sg.allConfigured && sg.required && (
                              <span className="text-xs text-red-400 ml-2">Required — missing credentials</span>
                            )}
                            {!sg.allConfigured && !sg.required && (
                              <span className="text-xs text-muted-foreground ml-2">Optional — can configure later</span>
                            )}
                          </div>
                          {sg.allConfigured ? (
                            <CheckCircle2 className="w-4 h-4 text-green-500" />
                          ) : sg.required ? (
                            <XCircle className="w-4 h-4 text-red-400" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-muted-foreground" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {isLaunchReady && (
                    <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 text-center">
                      <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-green-700">Platform is configured and ready.</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        You can re-open this wizard anytime from the Founder Dashboard to update credentials.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t px-6 py-4 flex items-center justify-between bg-background">
          <Button variant="ghost" onClick={handleBack} disabled={step === 0} className="gap-1">
            <ChevronLeft className="w-4 h-4" /> Back
          </Button>
          <div className="flex items-center gap-2">
            {stepService && Object.values(fieldValues).some(v => v.trim()) && (
              <Button variant="outline" size="sm" onClick={handleSave} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                Save
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={handleNext} disabled={saving} className="gap-1 bg-purple-600 hover:bg-purple-700">
                Next <ChevronRight className="w-4 h-4" />
              </Button>
            ) : (
              <Button onClick={onClose} className="gap-1 bg-green-600 hover:bg-green-700">
                Done <CheckCircle2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── StepSection helper ───────────────────────────────────────────────────────

function StepSection({
  title, description, icon, service, stepKeys, credMap, fieldValues, setField,
  validations, onGenerate, validateButton, wireButton, extras, optional,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  service: string;
  stepKeys: string[];
  credMap: Map<string, CredentialEntry>;
  fieldValues: Record<string, string>;
  setField: (key: string, val: string) => void;
  validations: Record<string, ValidationResult>;
  onGenerate: (type: string, targetKey?: string) => void;
  validateButton?: React.ReactNode;
  wireButton?: React.ReactNode;
  extras?: React.ReactNode;
  optional?: boolean;
}) {
  const serviceValidation = validations[service];

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{title}</h3>
            {optional && (
              <Badge variant="outline" className="text-xs text-muted-foreground">Optional</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        {stepKeys.map(key => {
          const cred = credMap.get(key);
          // Map generate type for specific keys
          const genType = GENERATE_TYPES[key];
          return (
            <CredentialField
              key={key}
              credKey={key}
              credential={cred}
              value={fieldValues[key] ?? ""}
              onChange={val => setField(key, val)}
              onGenerate={genType ? (type) => onGenerate(type, key) : undefined}
              validationResult={null}
            />
          );
        })}
      </div>

      {(validateButton || wireButton) && (
        <div className="flex items-center gap-2 pt-1">
          {validateButton}
          {wireButton}
          {serviceValidation && (
            <span className={cn("text-xs flex items-center gap-1",
              serviceValidation.status === "ok" ? "text-green-600" :
              serviceValidation.status === "warn" ? "text-yellow-600" : "text-red-500")}>
              {serviceValidation.status === "ok" ? <CheckCircle2 className="w-3 h-3" /> :
               serviceValidation.status === "warn" ? <AlertCircle className="w-3 h-3" /> :
               <XCircle className="w-3 h-3" />}
              {serviceValidation.message}
            </span>
          )}
        </div>
      )}

      {extras}
    </div>
  );
}

// ─── ValidateButton ───────────────────────────────────────────────────────────

function ValidateButton({
  service, label, onValidate, loading, result,
}: {
  service: string;
  label: string;
  onValidate: (service: string) => void;
  loading?: boolean;
  result?: ValidationResult;
}) {
  return (
    <Button variant="outline" size="sm" className="gap-2"
      onClick={() => onValidate(service)} disabled={loading}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
      {label}
    </Button>
  );
}

// ─── Quick Readiness Banner (used in founder dashboard) ───────────────────────

export function SetupReadinessBanner({ onOpenWizard }: { onOpenWizard: () => void }) {
  const { data: status } = useQuery<SetupStatus>({
    queryKey: ["/api/founder/setup/status"],
    staleTime: 60_000,
  });

  if (!status) return null;
  const missingRequired = status.summary?.missingRequired ?? [];
  if (status.readinessScore >= 70 && missingRequired.length === 0) return null;

  const missingCount = missingRequired.length;
  const score = status.readinessScore;

  return (
    <div className={cn(
      "rounded-xl border p-4 flex items-center gap-4",
      missingCount > 0 ? "border-red-500/30 bg-red-500/5" : "border-amber-500/30 bg-amber-500/5"
    )}>
      <div className="shrink-0">
        {missingCount > 0
          ? <XCircle className="w-8 h-8 text-red-400" />
          : <AlertCircle className="w-8 h-8 text-amber-400" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("font-semibold text-sm",
          missingCount > 0 ? "text-red-600" : "text-amber-600")}>
          {missingCount > 0
            ? `${missingCount} required credential${missingCount > 1 ? "s" : ""} missing — platform incomplete`
            : `Platform ${score}% configured — optional services can unlock more automation`}
        </p>
        {missingCount > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {missingRequired.slice(0, 4).map(k => (
              <Badge key={k} variant="outline" className="text-xs font-mono bg-red-500/10 text-red-500 border-red-500/20">
                {k}
              </Badge>
            ))}
            {missingRequired.length > 4 && (
              <Badge variant="outline" className="text-xs text-muted-foreground">
                +{missingRequired.length - 4} more
              </Badge>
            )}
          </div>
        )}
      </div>
      <Button size="sm" onClick={onOpenWizard}
        className={cn("gap-1.5 shrink-0",
          missingCount > 0 ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700")}>
        <Shield className="w-3.5 h-3.5" />
        {missingCount > 0 ? "Fix Now" : "Complete Setup"}
      </Button>
    </div>
  );
}
