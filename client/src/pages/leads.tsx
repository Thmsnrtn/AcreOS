import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useTerm } from "@/hooks/use-persona";
import { plural } from "@/lib/format";
import { clientLogger } from "@/lib/clientLogger";
import "./today.css";
import { PaxContextButton } from "@/components/pax-context-button";
import { ListPagination, usePagination } from "@/components/list-pagination";
import { useLeads, useLeadsPaginated, useCreateLead, useUpdateLead, useDeleteLead, useRescoreLead } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useTeamMembers, useUserPermissions, getRoleBadgeStyle, getRoleLabel } from "@/hooks/use-organization";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ListSkeleton, TableRowSkeleton } from "@/components/list-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineError } from "@/components/inline-error";
import { QueryErrorState } from "@/components/query-error-state";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";
import { ContentReveal } from "@/components/ContentReveal";
import { useState, useMemo, useEffect, useRef, useId, useDeferredValue } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLeadSchema, type Lead } from "@shared/schema";
import { z } from "zod";
import { useLocation, useSearch } from "wouter";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileLeadList } from "@/components/mobile/MobileLeadList";

// Module-level hook removed — use inside component instead

// Phone number formatting helper
const formatPhoneNumber = (phone: string): string => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
};

// Client-side form schema with enhanced validation
const leadFormSchema = insertLeadSchema.extend({
  firstName: z.string().min(1, "First name is required").max(100, "First name is too long"),
  lastName: z.string().min(1, "Last name is required").max(100, "Last name is too long"),
  email: z.string()
    .optional()
    .refine(
      (val) => !val || /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(val),
      { message: "Please enter a valid email address (e.g., name@example.com)" }
    ),
  phone: z.string()
    .optional()
    .transform((val) => val ? formatPhoneNumber(val) : val)
    .refine(
      (val) => {
        if (!val) return true;
        const digits = val.replace(/\D/g, '');
        return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
      },
      { message: "Please enter a valid 10-digit US phone number" }
    ),
  status: z.string().min(1, "Status is required"),
});
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalTrigger,
} from "@/components/ui/responsive-modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Mail, Phone, Trash2, Edit, Loader2, Users, FileText, Download, Upload, CheckCircle, XCircle, AlertCircle, Flame, Sun, Snowflake, Skull, ArrowUpDown, ArrowUp, ArrowDown, X, Clock, Eye, User, Calendar, MapPin, StickyNote, PhoneOff, Shield, CheckSquare, RefreshCw, TrendingUp, TrendingDown, Minus, History, Filter, ChevronDown, MoreVertical } from "lucide-react";
import { telemetry } from "@/lib/telemetry";
import { Checkbox } from "@/components/ui/checkbox";
import { FirstHelloEmpty, EmptyFilter } from "@/components/empty-states";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FocusList } from "@/components/focus-list";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ActivityTimeline } from "@/components/activity-timeline";
import { SavedViewsSelector } from "@/components/saved-views-selector";
import { CustomFieldValuesEditor } from "@/components/custom-fields";
import { SkipTracePanel } from "@/components/skip-trace-panel";
import { TaxDelinquentImporter } from "@/components/tax-delinquent-importer";
import { GisFilters, type GisFilterState, defaultGisFilters, countActiveGisFilters, applyGisFiltersToLead } from "@/components/gis-filters";
import { SafeBulkDeleteDialog } from "@/components/safe-bulk-delete-dialog";
import { LeadDetailContent } from "@/components/lead-detail-content";
import { format } from "date-fns";
import type { SavedView } from "@shared/schema";

type LeadWithScore = Lead & {
  score: number;
  nurturingStage: string;
  scoreFactors?: Record<string, number>;
};

function getStageIcon(stage: string) {
  switch (stage) {
    case "hot":
      return <Flame className="w-3 h-3" />;
    case "warm":
      return <Sun className="w-3 h-3" />;
    case "cold":
      return <Snowflake className="w-3 h-3" />;
    default:
      return <Skull className="w-3 h-3" />;
  }
}

function getStageStyle(stage: string) {
  switch (stage) {
    case "hot":
      return "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn";
    case "warm":
      return "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn";
    case "cold":
      return "bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getRecommendationStyle(rec: "mail" | "maybe" | "skip"): string {
  switch (rec) {
    case "mail":
      return "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos";
    case "maybe":
      return "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn";
    case "skip":
      return "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg";
  }
}

function getScoreColorStyle(score: number): string {
  if (score >= 70) return "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos";
  if (score >= 40) return "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn";
  return "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg";
}

interface ScoreHistory {
  id: number;
  score: number;
  previousScore: number | null;
  factors: Record<string, any>;
  triggerSource: string;
  scoredAt: string;
}

function normalizeRawScore(rawScore: number): number {
  return Math.round((rawScore + 400) / 8);
}

function ScoreDetailsDialog({ 
  lead, 
  open, 
  onOpenChange 
}: { 
  lead: LeadWithScore; 
  open: boolean; 
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const normalizedScore = lead.score ?? 0;
  // Use nurturingStage from backend which maps directly to recommendation
  const recommendation = (lead.nurturingStage === "hot" ? "mail" : 
                          lead.nurturingStage === "warm" ? "maybe" : 
                          "skip") as "mail" | "maybe" | "skip";

  const { data: scoreHistory, isLoading: isLoadingHistory, refetch: refetchHistory } = useQuery<ScoreHistory[]>({
    queryKey: ["/api/leads", lead.id, "score-history"],
    enabled: open,
  });

  const rescoreMutation = useRescoreLead();
  // The shared hook handles toast + dependent invalidations. We still
  // refetch the open modal's history query so the timeline updates
  // immediately even though invalidation alone would refetch it.
  const handleRescore = () => {
    rescoreMutation.mutate(lead.id, {
      onSuccess: () => refetchHistory(),
    });
  };

  const latestFactors = scoreHistory?.[0]?.factors || lead.scoreFactors || {};
  
  const propertyFactors = ["ownershipDuration", "taxDelinquency", "absenteeOwner", "propertySize"];
  const ownerFactors = ["corporateOwner", "outOfState", "inheritanceIndicator"];
  const marketFactors = ["floodZone"];
  const engagementFactors = ["responseRecency", "emailEngagement", "campaignTouches"];

  const renderFactor = (key: string, factor: any) => {
    if (!factor) return null;
    const score = factor.score || 0;
    const isPositive = score > 0;
    const isNegative = score < 0;
    const colorClass = isPositive 
      ? "text-acr-pos dark:text-acr-pos" 
      : isNegative 
        ? "text-acr-neg dark:text-acr-neg" 
        : "text-muted-foreground";
    const bgClass = isPositive
      ? "bg-acr-pos-soft dark:bg-acr-pos-soft/20"
      : isNegative
        ? "bg-acr-neg-soft dark:bg-acr-neg-soft/20"
        : "bg-muted/50";
    
    return (
      <div 
        key={key} 
        className={`flex items-center justify-between py-2 px-3 rounded-md ${bgClass}`}
        data-testid={`factor-${key}-${lead.id}`}
      >
        <div className="flex items-center gap-2">
          {isPositive && <TrendingUp className="w-3 h-3 text-acr-pos dark:text-acr-pos" />}
          {isNegative && <TrendingDown className="w-3 h-3 text-acr-neg dark:text-acr-neg" />}
          {!isPositive && !isNegative && <Minus className="w-3 h-3 text-muted-foreground" />}
          <span className="text-sm capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
        </div>
        <span className={`text-sm font-medium ${colorClass}`}>
          {isPositive ? "+" : ""}{score}
        </span>
      </div>
    );
  };

  const renderFactorGroup = (title: string, factors: string[]) => {
    const factorData = factors.map(f => ({ key: f, data: latestFactors[f] })).filter(f => f.data);
    if (factorData.length === 0) return null;
    
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
        <div className="space-y-1">
          {factorData.map(({ key, data }) => renderFactor(key, data))}
        </div>
      </div>
    );
  };

  return (
    <ResponsiveModal open={open} onOpenChange={onOpenChange}>
      <ResponsiveModalContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
        <ResponsiveModalHeader>
          <ResponsiveModalTitle className="flex items-center gap-2">
            Score Details: {lead.firstName} {lead.lastName}
          </ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Betty-style lead scoring breakdown
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4 p-4 bg-muted/50 rounded-card">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Overall Score</p>
              <p className="text-3xl font-bold" data-testid={`text-score-value-${lead.id}`}>{normalizedScore}</p>
            </div>
            <Badge 
              variant="outline"
              className={`text-sm border-0 px-3 py-1 capitalize ${getRecommendationStyle(recommendation)}`}
              data-testid={`badge-recommendation-${lead.id}`}
            >
              {recommendation}
            </Badge>
          </div>

          <div className="space-y-4">
            {renderFactorGroup("Property Factors", propertyFactors)}
            {renderFactorGroup("Owner Factors", ownerFactors)}
            {renderFactorGroup("Market/Location", marketFactors)}
            {renderFactorGroup("Engagement", engagementFactors)}
          </div>

          {scoreHistory && scoreHistory.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" />
                <h4 className="text-sm font-medium text-muted-foreground">Score History</h4>
              </div>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {scoreHistory.slice(0, 5).map((entry) => {
                  const historyRec = entry.factors?.recommendation as "mail" | "maybe" | "skip" | undefined;
                  const normalizedHistoryScore = normalizeRawScore(entry.score);
                  const normalizedPrevScore = entry.previousScore !== null ? normalizeRawScore(entry.previousScore) : null;
                  return (
                    <div 
                      key={entry.id} 
                      className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded"
                      data-testid={`history-entry-${entry.id}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">
                          {new Date(entry.scoredAt).toLocaleDateString()}
                        </span>
                        {historyRec && (
                          <Badge 
                            variant="outline" 
                            className={`text-xs border-0 capitalize ${getRecommendationStyle(historyRec)}`}
                          >
                            {historyRec}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {normalizedPrevScore !== null && (
                          <span className="text-muted-foreground">{normalizedPrevScore}/100</span>
                        )}
                        {normalizedPrevScore !== null && <span className="text-muted-foreground">→</span>}
                        <span className="font-medium">{normalizedHistoryScore}/100</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {isLoadingHistory && (
            <div className="space-y-2" data-testid="skeleton-score-history" aria-busy="true">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" />
                <h4 className="text-sm font-medium text-muted-foreground">Score History</h4>
              </div>
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 bg-muted/30 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-5 w-12 rounded-full" />
                    </div>
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <ResponsiveModalFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={handleRescore}
            disabled={rescoreMutation.isPending}
            data-testid={`button-rescore-${lead.id}`}
          >
            {rescoreMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Rescoring...</>
            ) : (
              <><RefreshCw className="w-4 h-4 mr-2" /> Rescore</>
            )}
          </Button>
        </ResponsiveModalFooter>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

function RescoreMenuItem({ leadId }: { leadId: number }) {
  const rescoreMutation = useRescoreLead();

  return (
    <DropdownMenuItem
      onClick={() => rescoreMutation.mutate(leadId)}
      disabled={rescoreMutation.isPending}
      data-testid={`button-rescore-menu-${leadId}`}
    >
      {rescoreMutation.isPending ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <RefreshCw className="w-4 h-4 mr-2" />
      )}
      Rescore Lead
    </DropdownMenuItem>
  );
}

function getScoreTier(score: number): { tier: string; color: string } {
  if (score >= 80) return { tier: 'A', color: 'text-acr-pos dark:text-acr-pos' };
  if (score >= 60) return { tier: 'B', color: 'text-acr-accent dark:text-acr-accent' };
  if (score >= 40) return { tier: 'C', color: 'text-acr-warn dark:text-acr-warn' };
  return { tier: 'D', color: 'text-muted-foreground' };
}

function LeadScoreBadge({ lead }: { lead: LeadWithScore }) {
  const [showDetails, setShowDetails] = useState(false);
  const stage = lead.nurturingStage || "new";
  const normalizedScore = lead.score ?? 0;
  const { tier, color: tierColor } = getScoreTier(normalizedScore);
  // Use nurturingStage from backend which maps directly to recommendation
  const recommendation = (stage === "hot" ? "mail" :
                          stage === "warm" ? "maybe" :
                          "skip") as "mail" | "maybe" | "skip";

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className="flex items-center gap-1 cursor-pointer"
            onClick={() => setShowDetails(true)}
            data-testid={`badge-score-${lead.id}`}
          >
            <Badge
              variant="outline"
              className={`text-xs border-0 flex items-center gap-1 font-semibold ${getScoreColorStyle(normalizedScore)}`}
            >
              {getStageIcon(stage)}
              {normalizedScore}
              <span className={`font-bold ml-0.5 ${tierColor}`}>{tier}</span>
            </Badge>
            <Badge
              variant="outline"
              className={`text-xs border-0 capitalize ${getRecommendationStyle(recommendation)}`}
            >
              {recommendation}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <span data-testid={`tooltip-score-${lead.id}`}>Score: {normalizedScore}/100 — Tier {tier} — Click for details</span>
        </TooltipContent>
      </Tooltip>
      <ScoreDetailsDialog
        lead={lead}
        open={showDetails}
        onOpenChange={setShowDetails}
      />
    </>
  );
}

function getDaysSinceContact(lead: Lead): number {
  const lastContact = lead.lastContactedAt || lead.createdAt;
  if (!lastContact) return 999;
  return Math.floor((Date.now() - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24));
}

function getContactAgeStyle(days: number): string {
  if (days <= 3) return "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos";
  if (days <= 7) return "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn";
  return "bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg";
}

function ContactAgeBadge({ lead }: { lead: Lead }) {
  const days = getDaysSinceContact(lead);
  const lastContactDate = lead.lastContactedAt || lead.createdAt;
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`text-xs border-0 flex items-center gap-1 cursor-default ${getContactAgeStyle(days)}`}
          data-testid={`badge-contact-age-${lead.id}`}
        >
          {days}d
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <span data-testid={`tooltip-contact-age-${lead.id}`}>
          {days === 0 ? 'Contacted today' : `${days} days since last contact`}
          {lastContactDate && ` (${new Date(lastContactDate).toLocaleDateString()})`}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export function TcpaConsentToggle({ lead }: { lead: Lead }) {
  const { toast } = useToast();
  
  const consentMutation = useMutation({
    mutationFn: async ({ tcpaConsent, consentSource, optOutReason }: { 
      tcpaConsent: boolean; 
      consentSource?: string;
      optOutReason?: string;
    }) => {
      const res = await apiRequest("PATCH", `/api/leads/${lead.id}/consent`, {
        tcpaConsent,
        consentSource,
        optOutReason
      });
      if (!res.ok) throw new Error("Failed to update consent");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({
        title: "Consent updated",
        description: "TCPA consent status has been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Couldn't update consent status",
        description: "TCPA consent is unchanged. Try again.",
        variant: "destructive",
      });
    },
  });

  const hasConsent = lead.tcpaConsent === true;
  const isOptedOut = lead.doNotContact === true;

  if (isOptedOut) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => consentMutation.mutate({ tcpaConsent: true, consentSource: "manual_restoration" })}
        disabled={consentMutation.isPending}
        data-testid={`button-restore-consent-${lead.id}`}
      >
        {consentMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
        Restore Consent
      </Button>
    );
  }

  if (hasConsent) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="text-destructive"
        onClick={() => consentMutation.mutate({ tcpaConsent: false, optOutReason: "manual_opt_out" })}
        disabled={consentMutation.isPending}
        data-testid={`button-revoke-consent-${lead.id}`}
      >
        {consentMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <PhoneOff className="w-3 h-3 mr-1" />}
        Opt Out
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      onClick={() => consentMutation.mutate({ tcpaConsent: true, consentSource: "manual" })}
      disabled={consentMutation.isPending}
      data-testid={`button-grant-consent-${lead.id}`}
    >
      {consentMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Shield className="w-3 h-3 mr-1" />}
      Grant Consent
    </Button>
  );
}

export function TcpaConsentBadge({ lead }: { lead: Lead }) {
  const hasConsent = lead.tcpaConsent === true;
  const isOptedOut = lead.doNotContact === true;
  
  if (isOptedOut) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="text-xs border-0 flex items-center gap-1 cursor-default bg-acr-neg-soft text-acr-neg dark:bg-acr-neg-soft/30 dark:text-acr-neg"
            data-testid={`badge-tcpa-${lead.id}`}
          >
            <PhoneOff className="w-3 h-3" />
            DNC
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <span data-testid={`tooltip-tcpa-${lead.id}`}>
            Do Not Contact - Opted out
            {lead.optOutDate && ` on ${new Date(lead.optOutDate).toLocaleDateString()}`}
          </span>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  if (hasConsent) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="text-xs border-0 flex items-center gap-1 cursor-default bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos"
            data-testid={`badge-tcpa-${lead.id}`}
          >
            <Shield className="w-3 h-3" />
            TCPA
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <span data-testid={`tooltip-tcpa-${lead.id}`}>
            TCPA consent on file
            {lead.consentDate && ` since ${new Date(lead.consentDate).toLocaleDateString()}`}
            {lead.consentSource && ` (${lead.consentSource})`}
          </span>
        </TooltipContent>
      </Tooltip>
    );
  }
  
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="text-xs border-0 flex items-center gap-1 cursor-default bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn"
          data-testid={`badge-tcpa-${lead.id}`}
        >
          <AlertCircle className="w-3 h-3" />
          No Consent
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        <span data-testid={`tooltip-tcpa-${lead.id}`}>
          No TCPA consent - SMS/calls blocked
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export default function LeadsPage() {
  // Mobile gets a swipeable card list. The desktop spreadsheet remains
  // reachable from any mobile by appending ?desktop=1 to the URL — that
  // escape valve is honored here as well as on /leads/:id.
  //
  // We branch FIRST (before any other hook) so neither subtree runs the
  // other's heavy data hooks — the desktop body alone instantiates
  // ~20 hooks that would otherwise mount on mobile for no reason.
  const { isMobile } = useIsMobile();
  const wantsDesktop =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("desktop") === "1";
  if (isMobile && !wantsDesktop) {
    return (
      <PageShell>
        <MobileLeadList />
      </PageShell>
    );
  }
  return <LeadsPageDesktop />;
}

function LeadsPageDesktop() {
  const leadsLabel = useTerm("entity.lead.plural");
  const leadLabel = useTerm("entity.lead");
  useDocumentTitle(`${leadsLabel} — AcreOS`);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { data: propertiesRaw } = useProperties();
  const properties = Array.isArray(propertiesRaw) ? propertiesRaw : [];
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const stageFromUrl = urlParams.get("stage") || "all";
  const queryFromUrl = urlParams.get("q") || "";
  const assigneeFromUrl = urlParams.get("assignee") || "all";
  const actionFromUrl = urlParams.get("action");
  
  const [isCreateOpen, setIsCreateOpen] = useState(actionFromUrl === "new");
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [deletingLead, setDeletingLead] = useState<Lead | null>(null);
  const [offerLetterLead, setOfferLetterLead] = useState<Lead | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [offerAmount, setOfferAmount] = useState<string>("");
  const offerPropertyId = useId();
  const offerAmountId = useId();
  const offerFormId = useId();
  const [isGeneratingOffer, setIsGeneratingOffer] = useState(false);
  const [search, setSearch] = useState(queryFromUrl);
  const [stageFilter, setStageFilter] = useState(stageFromUrl);
  const [assigneeFilter, setAssigneeFilter] = useState<string>(assigneeFromUrl);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [gisFilters, setGisFilters] = useState<GisFilterState>(defaultGisFilters);
  const { data: teamMembers } = useTeamMembers();
  const { data: userPermissions } = useUserPermissions();
  const [isExporting, setIsExporting] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(actionFromUrl === "import");
  const [isTaxDelinquentImportOpen, setIsTaxDelinquentImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<{
    totalRows: number;
    headers: string[];
    preview: Record<string, string>[];
    expectedColumns: string[];
  } | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    successCount: number;
    errorCount: number;
    errors: Array<{ row: number; data: Record<string, string>; error: string }>;
  } | null>(null);
  const { mutate: deleteLead, isPending: isDeleting } = useDeleteLead();
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<number>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isBulkUpdating, setIsBulkUpdating] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [pendingDiscardClose, setPendingDiscardClose] = useState(false);
  const { toast } = useToast();

  const handleSelectAll = (checked: boolean) => {
    if (checked && filteredLeads) {
      setSelectedLeadIds(new Set(filteredLeads.map(l => l.id)));
    } else {
      setSelectedLeadIds(new Set());
    }
  };

  const handleSelectLead = (leadId: number, checked: boolean) => {
    const newSet = new Set(selectedLeadIds);
    if (checked) {
      newSet.add(leadId);
    } else {
      newSet.delete(leadId);
    }
    setSelectedLeadIds(newSet);
  };

  const handleBulkDeleteSuccess = (deletedIds: number[]) => {
    setSelectedLeadIds(new Set());
    // Query cache is invalidated by the SafeBulkDeleteDialog component
  };

  const handleBulkStatusChange = async (status: string) => {
    if (selectedLeadIds.size === 0) return;
    setIsBulkUpdating(true);
    try {
      const res = await apiRequest("POST", "/api/leads/bulk-update", { ids: Array.from(selectedLeadIds), updates: { status } });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const result = await res.json();
      toast({
        title: `Updated ${result.updatedCount} lead${result.updatedCount === 1 ? "" : "s"}`,
        description: `Status set to "${status}".`,
      });
      setSelectedLeadIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    } catch (error: any) {
      toast({
        title: "Couldn't update leads",
        description: error?.message || "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleBulkExport = () => {
    if (selectedLeadIds.size === 0) return;
    try {
      const selectedLeads = filteredLeads?.filter(l => selectedLeadIds.has(l.id)) || [];
      // CSV-safe cell encoder (slice 5k rule): double embedded quotes AND
      // prefix formula-trigger leading characters with a `'` so spreadsheets
      // don't interpret exported values as formulas (CSV injection).
      const escapeCell = (raw: string | null | undefined): string => {
        const s = (raw ?? "").toString();
        const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const headers = ["firstName", "lastName", "email", "phone", "status"];
      const csvRows = [headers.map(h => escapeCell(h)).join(",")];
      selectedLeads.forEach(lead => {
        csvRows.push([lead.firstName, lead.lastName, lead.email, lead.phone, lead.status].map(escapeCell).join(","));
      });
      const filename = `leads-export-${new Date().toISOString().split("T")[0]}.csv`;
      const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: "Export ready",
        description: `Downloaded ${selectedLeads.length} lead${selectedLeads.length === 1 ? "" : "s"} to ${filename}.`,
      });
    } catch (err: any) {
      toast({
        title: "Couldn't export selection",
        description: err?.message || "CSV build failed. Try again — your leads weren't changed.",
        variant: "destructive",
      });
    }
  };

  // P1-28 — URL-sync active filters so /leads?stage=hot&q=foo round-trips
  // through the lead-detail route without losing state on back.
  const updateLeadsUrl = (overrides: { stage?: string; q?: string; assignee?: string }) => {
    const params = new URLSearchParams();
    const stage = overrides.stage ?? stageFilter;
    const q = overrides.q ?? search;
    const assignee = overrides.assignee ?? assigneeFilter;
    if (stage && stage !== "all") params.set("stage", stage);
    if (q) params.set("q", q);
    if (assignee && assignee !== "all") params.set("assignee", assignee);
    const qs = params.toString();
    setLocation(qs ? `/leads?${qs}` : "/leads");
  };

  const handleStageFilterChange = (value: string) => {
    setStageFilter(value);
    setCurrentPage(1);
    updateLeadsUrl({ stage: value });
  };

  const handleSortByScore = () => {
    if (sortOrder === null) {
      setSortOrder("desc");
    } else if (sortOrder === "desc") {
      setSortOrder("asc");
    } else {
      setSortOrder(null);
    }
  };

  const getSortIcon = () => {
    if (sortOrder === "desc") return <ArrowDown className="w-3 h-3 ml-1" />;
    if (sortOrder === "asc") return <ArrowUp className="w-3 h-3 ml-1" />;
    return <ArrowUpDown className="w-3 h-3 ml-1" />;
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await fetch('/api/leads/export', { credentials: 'include' });
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const filename = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 'leads.csv';
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error: any) {
      toast({
        title: "Couldn't export leads",
        description: error?.message || "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setImportFile(file);
    setImportPreview(null);
    setImportResult(null);
    setIsLoadingPreview(true);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/leads/import/preview', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to parse CSV');
      }
      
      const preview = await response.json();
      setImportPreview(preview);
    } catch (error: any) {
      setImportPreview(null);
      toast({
        title: "Couldn't preview this file",
        description: error?.message || "Check that the file is a valid CSV and try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    
    setIsImporting(true);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      
      const response = await fetch('/api/leads/import', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to import');
      }
      
      const result = await response.json();
      setImportResult(result);
      setImportPreview(null);
      queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
    } catch (error: any) {
      clientLogger.error('Import error:', error);
      toast({
        title: "Couldn't import leads",
        description: `${error?.message || "The CSV didn't process"} — your existing leads are unchanged.`,
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  const resetImportDialog = () => {
    setIsImportOpen(false);
    setImportFile(null);
    setImportPreview(null);
    setImportResult(null);
  };

  const handleGenerateOfferLetter = async () => {
    if (!offerLetterLead || !selectedPropertyId) return;
    setIsGeneratingOffer(true);
    try {
      const response = await fetch('/api/documents/offer-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leadId: offerLetterLead.id,
          propertyId: Number(selectedPropertyId),
          offerAmount: offerAmount ? Number(offerAmount) : undefined,
        }),
      });
      if (!response.ok) throw new Error('Failed to generate PDF');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `offer-letter-${offerLetterLead.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      setOfferLetterLead(null);
      setSelectedPropertyId("");
      setOfferAmount("");
      toast({
        title: "Offer letter ready",
        description: "PDF downloaded to your device.",
      });
    } catch (error: any) {
      clientLogger.error('Download error:', error);
      toast({
        title: "Couldn't generate offer letter",
        description: `${error?.message || "PDF generation failed"} — try again in a moment.`,
        variant: "destructive",
      });
    } finally {
      setIsGeneratingOffer(false);
    }
  };

  // Phase 8 Mo 12 — Beatriz §3 (INP).
  // useDeferredValue lets React keep the input echoing the user's keystrokes
  // while the (potentially expensive) re-filter happens at a lower priority.
  // On large lead lists the filter ran inline on every keystroke and pushed
  // INP > 200ms; deferring it keeps typing responsive without changing UX.
  //
  // Day-365 reliability (Workstream C): `deferredSearch` is now also the
  // server-side `?q=` we ship to /api/leads. Previously the filter ran
  // over `leads` — which was only the CURRENT page — so a user typing
  // "Smith" expecting their Smith from page 7 got nothing. Now the
  // server runs an ILIKE across name, email, phone, address, and the
  // result spans every lead in the org, not just page 1.
  const deferredSearch = useDeferredValue(search);

  // When the search query changes, snap back to page 1 — otherwise a
  // user on page 5 of /leads who types a search would see "page 5 of
  // <new total>" and possibly an empty page.
  useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearch]);

  const { data: leadsResponse, isLoading, error, refetch } = useLeadsPaginated({
    page: currentPage,
    pageSize,
    q: deferredSearch || undefined,
  });
  const leads = leadsResponse?.data;
  const serverTotal = leadsResponse?.total ?? 0;
  const serverTotalPages = leadsResponse?.totalPages ?? 1;

  const filteredLeads = useMemo(() => {
    if (!leads) return [];

    let result = leads as LeadWithScore[];

    // Name/email/phone/address search runs server-side now (see
    // useLeadsPaginated above) so the user can find a Smith on page 7
    // of an 8-page list. Client-side filtering is reserved for facets
    // that aren't yet plumbed through the API (stage, assignee, GIS).

    // Apply stage filter
    if (stageFilter && stageFilter !== "all") {
      result = result.filter(l => l.nurturingStage === stageFilter);
    }

    // Apply assignee filter (client-side, for admins who can see all leads)
    if (assigneeFilter && assigneeFilter !== "all") {
      if (assigneeFilter === "unassigned") {
        result = result.filter(l => !l.assignedTo);
      } else {
        result = result.filter(l => String(l.assignedTo) === assigneeFilter);
      }
    }

    // Apply GIS-based filters
    const hasActiveGisFilters = gisFilters.excludeFloodZones ||
      gisFilters.nearInfrastructure ||
      gisFilters.lowHazardRiskOnly ||
      gisFilters.minimumInvestmentScore > 0;

    if (hasActiveGisFilters) {
      result = result.filter(lead => applyGisFiltersToLead(lead, gisFilters));
    }

    // Apply score sorting
    if (sortOrder) {
      result = [...result].sort((a, b) => {
        const scoreA = a.score ?? 0;
        const scoreB = b.score ?? 0;
        return sortOrder === "desc" ? scoreB - scoreA : scoreA - scoreB;
      });
    }

    return result;
  }, [leads, stageFilter, assigneeFilter, gisFilters, sortOrder]);

  // Server-side pagination: the data returned is already one page
  // Client-side filtering (search, GIS) is applied on the current page
  const paginatedLeads = filteredLeads;
  const totalLeadItems = serverTotal;
  const safeCurrentPage = currentPage;

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    // Scroll to top of the list area
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setCurrentPage(1);
  };

  const handleDelete = () => {
    if (deletingLead) {
      deleteLead(deletingLead.id, {
        onSuccess: () => setDeletingLead(null),
      });
    }
  };

  if (error) {
    return (
      <PageShell label={leadsLabel}>
        <QueryErrorState
          error={error as Error}
          onRetry={() => refetch()}
          title="Failed to load leads"
          testId="error-state-leads"
        />
      </PageShell>
    );
  }

  return (
    <PageShell label={leadsLabel}>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {error && (
              <InlineError
                message={(error as Error)?.message || "Failed to load leads."}
                onRetry={() => (refetch as any)()}
                testId="inline-error-leads"
              />
            )}
            <div className="acr-cc-hero" style={{ marginTop: 0 }}>
              <div>
                <div className="acr-eyebrow">Leads</div>
                <h1 className="acr-cc-greeting" data-testid="text-page-title">
                  {leads && leads.length > 0 ? (
                    <>
                      {plural(leads.length, "lead")}
                      <span className="acr-cc-greeting-soft">
                        {" "}— buyers, sellers, and warm intros.
                      </span>
                    </>
                  ) : (
                    <>
                      No leads yet.
                      <span className="acr-cc-greeting-soft">
                        {" "}Import a CSV or add one by hand to get started.
                      </span>
                    </>
                  )}
                </h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Desktop: show all buttons */}
              <Button 
                variant="outline" 
                onClick={handleExport} 
                disabled={isExporting}
                className="hidden md:inline-flex"
                data-testid="button-export-leads"
              >
                {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                Export CSV
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setIsImportOpen(true)}
                className="hidden md:inline-flex"
                data-testid="button-import-leads"
              >
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </Button>
              <Button 
                variant="outline" 
                onClick={() => setIsTaxDelinquentImportOpen(true)}
                className="hidden md:inline-flex"
                data-testid="button-import-tax-delinquent"
              >
                <FileText className="w-4 h-4 mr-2" />
                Import Tax List
              </Button>
              
              {/* Mobile: show actions in dropdown menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="icon"
                    className="md:hidden min-h-[44px] min-w-[44px]"
                    aria-label="More actions"
                    data-testid="button-more-actions-mobile"
                  >
                    <MoreVertical className="w-5 h-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={handleExport}
                    disabled={isExporting}
                    className="min-h-[44px]"
                    data-testid="button-export-leads-mobile"
                  >
                    {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4 mr-2" aria-hidden="true" />}
                    Export CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setIsImportOpen(true)}
                    className="min-h-[44px]"
                    data-testid="button-import-leads-mobile"
                  >
                    <Upload className="w-4 h-4 mr-2" aria-hidden="true" />
                    Import CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setIsTaxDelinquentImportOpen(true)}
                    className="min-h-[44px]"
                    data-testid="button-import-tax-delinquent-mobile"
                  >
                    <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
                    Import tax list
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
<ResponsiveModal open={isCreateOpen} onOpenChange={(open) => {
                // Confirm discard if form has any input. window.confirm()
                // was banned in slice 5l (no focus trap, inconsistent with
                // Radix dialogs, blocks main thread); route through
                // <ConfirmDialog> so the discard prompt is accessible.
                if (!open) {
                  const formEl = document.querySelector('[data-testid="lead-form"]') as HTMLFormElement | null;
                  const dirty = formEl?.querySelector('input[name="firstName"],input[name="lastName"],input[name="email"],input[name="phone"]') as HTMLInputElement | null;
                  if (dirty && dirty.value) {
                    setPendingDiscardClose(true);
                    return;
                  }
                }
                setIsCreateOpen(open);
              }}>
                <ResponsiveModalTrigger asChild>
                  <Button className="shadow-lg hover:shadow-primary/25 min-h-[44px]" data-testid="button-add-lead">
                    <Plus className="w-4 h-4 mr-2" aria-hidden="true" /> Add {leadLabel.toLowerCase()}
                  </Button>
                </ResponsiveModalTrigger>
                <ResponsiveModalContent className="sm:max-w-[425px]">
                  <ResponsiveModalHeader>
                    <ResponsiveModalTitle>Create {leadLabel.toLowerCase()}</ResponsiveModalTitle>
                  </ResponsiveModalHeader>
                  <LeadForm onSuccess={() => setIsCreateOpen(false)} />
                </ResponsiveModalContent>
              </ResponsiveModal>
              <ConfirmDialog
                open={pendingDiscardClose}
                onOpenChange={(v) => setPendingDiscardClose(v)}
                title="Discard unsaved changes?"
                description="You've started entering a lead. Closing this form will discard what you've typed. This can't be undone."
                confirmLabel="Discard"
                cancelLabel="Keep editing"
                variant="destructive"
                onConfirm={() => {
                  setPendingDiscardClose(false);
                  setIsCreateOpen(false);
                }}
              />
            </div>
          </div>

          {/* Lead Quality Tier Distribution */}
          {leads && (leads as LeadWithScore[]).length > 0 && (() => {
            const allLeads = leads as LeadWithScore[];
            const tierA = allLeads.filter(l => (l.score ?? 0) >= 80).length;
            const tierB = allLeads.filter(l => (l.score ?? 0) >= 60 && (l.score ?? 0) < 80).length;
            const tierC = allLeads.filter(l => (l.score ?? 0) >= 40 && (l.score ?? 0) < 60).length;
            const tierD = allLeads.filter(l => (l.score ?? 0) < 40).length;
            const total = allLeads.length;
            const overdue = allLeads.filter(l => getDaysSinceContact(l) > 7).length;
            return (
              <div className="rounded-xl border bg-card p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-muted-foreground uppercase tracking-wide">
                    Lead quality distribution — <span className="tabular-nums">{total}</span> total
                  </span>
                  {overdue > 0 && (
                    <span className="flex items-center gap-1 text-acr-warn font-medium">
                      <Clock className="w-3 h-3" aria-hidden="true" /> <span className="tabular-nums">{overdue}</span> overdue for follow-up
                    </span>
                  )}
                </div>
                <div
                  className="flex h-2 rounded-full overflow-hidden gap-0.5"
                  role="img"
                  aria-label={`Quality distribution: ${tierA} A-tier, ${tierB} B-tier, ${tierC} C-tier, ${tierD} D-tier`}
                >
                  {tierA > 0 && <div className="bg-acr-pos transition-all" style={{ width: `${(tierA/total)*100}%` }} title={`A tier: ${tierA}`} />}
                  {tierB > 0 && <div className="bg-acr-accent transition-all" style={{ width: `${(tierB/total)*100}%` }} title={`B tier: ${tierB}`} />}
                  {tierC > 0 && <div className="bg-acr-warn transition-all" style={{ width: `${(tierC/total)*100}%` }} title={`C tier: ${tierC}`} />}
                  {tierD > 0 && <div className="bg-muted-foreground/30 transition-all" style={{ width: `${(tierD/total)*100}%` }} title={`D tier: ${tierD}`} />}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {tierA > 0 && <span className="text-micro text-acr-pos dark:text-acr-pos">A tier <strong className="tabular-nums">{tierA}</strong></span>}
                  {tierB > 0 && <span className="text-micro text-acr-accent dark:text-acr-accent">B tier <strong className="tabular-nums">{tierB}</strong></span>}
                  {tierC > 0 && <span className="text-micro text-acr-warn dark:text-acr-warn">C tier <strong className="tabular-nums">{tierC}</strong></span>}
                  {tierD > 0 && <span className="text-micro text-muted-foreground">D tier <strong className="tabular-nums">{tierD}</strong></span>}
                </div>
              </div>
            );
          })()}

          <div className="flex flex-col lg:flex-row gap-6">
            <div className="flex-1 min-w-0">
              <div className="bg-white dark:bg-card rounded-2xl shadow-sm border overflow-hidden">
                {/* Desktop filters - always visible */}
                <div className="hidden md:flex p-4 border-b flex-wrap items-center gap-3">
                  <SavedViewsSelector
                    entityType="lead"
                    currentFilters={{ stage: stageFilter }}
                    currentSort={sortOrder ? { field: "score", order: sortOrder } : undefined}
                    onApplyView={(view: SavedView) => {
                      if (view.filters && Array.isArray(view.filters)) {
                        const stageFilterDef = view.filters.find((f: any) => f.field === "stage");
                        if (stageFilterDef) {
                          setStageFilter(String(stageFilterDef.value));
                        } else {
                          setStageFilter("all");
                        }
                      } else {
                        setStageFilter("all");
                      }
                      if (view.sortBy === "score" && view.sortOrder) {
                        setSortOrder(view.sortOrder as "asc" | "desc");
                      } else {
                        setSortOrder(null);
                      }
                    }}
                  />
                  <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                      placeholder="Search leads…" 
                      className="pl-9 bg-muted border-none"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      data-testid="input-search-leads"
                    />
                  </div>
                  <Select value={stageFilter} onValueChange={handleStageFilterChange}>
                    <SelectTrigger className="w-[160px]" data-testid="select-stage-filter">
                      <SelectValue placeholder="Filter by stage" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All leads</SelectItem>
                      <SelectItem value="hot">
                        <span className="flex items-center gap-2">
                          <Flame className="w-3 h-3 text-acr-warn" aria-hidden="true" /> Hot leads
                        </span>
                      </SelectItem>
                      <SelectItem value="warm">
                        <span className="flex items-center gap-2">
                          <Sun className="w-3 h-3 text-acr-warn" aria-hidden="true" /> Warm leads
                        </span>
                      </SelectItem>
                      <SelectItem value="cold">
                        <span className="flex items-center gap-2">
                          <Snowflake className="w-3 h-3 text-acr-accent" aria-hidden="true" /> Cold leads
                        </span>
                      </SelectItem>
                      <SelectItem value="dead">
                        <span className="flex items-center gap-2">
                          <Skull className="w-3 h-3 text-muted-foreground" aria-hidden="true" /> Dead leads
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {userPermissions && !userPermissions.permissions.viewOnlyAssignedLeads && teamMembers && teamMembers.length > 0 && (
                    <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                      <SelectTrigger className="w-[180px]" data-testid="select-assignee-filter">
                        <SelectValue placeholder="Filter by assignee" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All assignees</SelectItem>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {teamMembers.map((member) => (
                          <SelectItem key={member.userId} value={member.userId}>
                            {member.displayName || member.email || member.userId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <GisFilters
                    filters={gisFilters}
                    onChange={setGisFilters}
                    activeFilterCount={countActiveGisFilters(gisFilters)}
                  />
                </div>

                {/* Mobile filters - collapsible */}
                <div className="md:hidden border-b">
                  <Collapsible open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                    <div className="p-3 flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input 
                          placeholder="Search leads…" 
                          className="pl-9 bg-muted border-none min-h-[44px]"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          data-testid="input-search-leads-mobile"
                        />
                      </div>
                      <CollapsibleTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="icon"
                          className="min-h-[44px] min-w-[44px] shrink-0"
                          aria-label="Toggle filters"
                          data-testid="button-toggle-filters"
                        >
                          <Filter className="w-4 h-4" />
                          {(stageFilter !== "all" || assigneeFilter !== "all" || countActiveGisFilters(gisFilters) > 0) && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
                          )}
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <div className="p-3 pt-0 space-y-3 border-t">
                        <SavedViewsSelector
                          entityType="lead"
                          currentFilters={{ stage: stageFilter }}
                          currentSort={sortOrder ? { field: "score", order: sortOrder } : undefined}
                          onApplyView={(view: SavedView) => {
                            if (view.filters && Array.isArray(view.filters)) {
                              const stageFilterDef = view.filters.find((f: any) => f.field === "stage");
                              if (stageFilterDef) {
                                setStageFilter(String(stageFilterDef.value));
                              } else {
                                setStageFilter("all");
                              }
                            } else {
                              setStageFilter("all");
                            }
                            if (view.sortBy === "score" && view.sortOrder) {
                              setSortOrder(view.sortOrder as "asc" | "desc");
                            } else {
                              setSortOrder(null);
                            }
                          }}
                        />
                        <Select value={stageFilter} onValueChange={handleStageFilterChange}>
                          <SelectTrigger className="w-full min-h-[44px]" data-testid="select-stage-filter-mobile">
                            <SelectValue placeholder="Filter by stage" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All Leads</SelectItem>
                            <SelectItem value="hot">
                              <span className="flex items-center gap-2">
                                <Flame className="w-3 h-3 text-acr-warn" /> Hot Leads
                              </span>
                            </SelectItem>
                            <SelectItem value="warm">
                              <span className="flex items-center gap-2">
                                <Sun className="w-3 h-3 text-acr-warn" /> Warm Leads
                              </span>
                            </SelectItem>
                            <SelectItem value="cold">
                              <span className="flex items-center gap-2">
                                <Snowflake className="w-3 h-3 text-acr-accent" /> Cold Leads
                              </span>
                            </SelectItem>
                            <SelectItem value="dead">
                              <span className="flex items-center gap-2">
                                <Skull className="w-3 h-3 text-muted-foreground" /> Dead Leads
                              </span>
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        {userPermissions && !userPermissions.permissions.viewOnlyAssignedLeads && teamMembers && teamMembers.length > 0 && (
                          <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
                            <SelectTrigger className="w-full min-h-[44px]" data-testid="select-assignee-filter-mobile">
                              <SelectValue placeholder="Filter by assignee" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All assignees</SelectItem>
                              <SelectItem value="unassigned">Unassigned</SelectItem>
                              {teamMembers.map((member) => (
                                <SelectItem key={member.userId} value={member.userId}>
                                  {member.displayName || member.email || member.userId}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <GisFilters
                          filters={gisFilters}
                          onChange={setGisFilters}
                          activeFilterCount={countActiveGisFilters(gisFilters)}
                        />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>

                {selectedLeadIds.size > 0 && (
                  <div className="p-3 bg-muted/50 border-b flex flex-wrap items-center gap-3" data-testid="bulk-actions-toolbar">
                    <div className="flex items-center gap-2">
                      <CheckSquare className="w-4 h-4" />
                      <span className="text-sm font-medium" data-testid="text-selected-count">{selectedLeadIds.size} lead{selectedLeadIds.size !== 1 ? "s" : ""} selected</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 ml-auto">
                      <Button variant="outline" size="sm" onClick={handleBulkExport} data-testid="button-bulk-export">
                        <Download className="w-4 h-4 mr-1" /> Export
                      </Button>
                      <Select onValueChange={handleBulkStatusChange} disabled={isBulkUpdating}>
                        <SelectTrigger className="w-[150px]" data-testid="select-bulk-status">
                          <SelectValue placeholder={isBulkUpdating ? "Updating..." : "Change Status"} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="new">New</SelectItem>
                          <SelectItem value="contacting">Contacting</SelectItem>
                          <SelectItem value="negotiation">Negotiation</SelectItem>
                          <SelectItem value="closed">Closed</SelectItem>
                          <SelectItem value="dead">Dead</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="destructive" size="sm" onClick={() => setShowBulkDeleteConfirm(true)} disabled={isBulkDeleting} data-testid="button-bulk-delete">
                        <Trash2 className="w-4 h-4 mr-1" /> Delete
                      </Button>
                      <Button aria-label="Content Reveal" variant="ghost" size="sm" onClick={() => setSelectedLeadIds(new Set())} data-testid="button-clear-selection">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                <ContentReveal
                  ready={!isLoading}
                  skeleton={
                    <div className="p-4" data-testid="skeleton-leads-table">
                      <ListSkeleton count={8} variant="table" />
                    </div>
                  }
                >
                  <>
                    {/* Desktop Table View */}
                    <div className="hidden md:block overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className="w-[50px]">
                              <Checkbox
                                checked={filteredLeads && filteredLeads.length > 0 && selectedLeadIds.size === filteredLeads.length}
                                onCheckedChange={(checked) => handleSelectAll(checked === true)}
                                data-testid="checkbox-select-all-leads"
                              />
                            </TableHead>
                            <TableHead className="min-w-[120px]">Name</TableHead>
                            <TableHead className="min-w-[100px]">
                              <button
                                type="button"
                                onClick={handleSortByScore}
                                className="flex items-center hover-elevate rounded px-1 -ml-1"
                                data-testid="button-sort-score"
                              >
                                Score
                                {getSortIcon()}
                              </button>
                            </TableHead>
                            <TableHead className="min-w-[180px]">Contact</TableHead>
                            <TableHead className="min-w-[100px]">Status</TableHead>
                            <TableHead className="text-right min-w-[160px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredLeads?.length === 0 && leads?.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={6} className="p-0">
                                <FirstHelloEmpty
                                  surface="leads"
                                  cta={{
                                    primary: { label: "Add your first lead", onClick: () => setIsCreateOpen(true) },
                                    secondary: { label: "Import from CSV", onClick: () => setIsImportOpen(true) },
                                  }}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                          {filteredLeads?.length === 0 && leads && leads.length > 0 && (
                            <TableRow>
                              <TableCell colSpan={6} className="p-4">
                                <EmptyFilter
                                  filterCount={
                                    (search ? 1 : 0) +
                                    (stageFilter !== "all" ? 1 : 0) +
                                    (assigneeFilter !== "all" ? 1 : 0) +
                                    countActiveGisFilters(gisFilters)
                                  }
                                  onClearFilters={() => {
                                    setSearch("");
                                    setStageFilter("all");
                                    setAssigneeFilter("all");
                                    setGisFilters(defaultGisFilters);
                                  }}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                          {paginatedLeads.map((lead) => (
                            <TableRow key={lead.id} className="group" data-testid={`row-lead-${lead.id}`}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedLeadIds.has(lead.id)}
                                  onCheckedChange={(checked) => handleSelectLead(lead.id, checked === true)}
                                  data-testid={`checkbox-lead-${lead.id}`}
                                />
                              </TableCell>
                              <TableCell className="font-medium">
                                <div className="flex items-center gap-1.5">
                                  <span>{lead.firstName} {lead.lastName}</span>
                                  <PaxContextButton
                                    entityType="lead"
                                    entityId={lead.id}
                                    entityName={`${lead.firstName} ${lead.lastName}`}
                                  />
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <LeadScoreBadge lead={lead} />
                                  <ContactAgeBadge lead={lead} />
                                  <TcpaConsentBadge lead={lead} />
{lead.lastContactedAt && (
                                    <span className="text-xs text-muted-foreground bg-muted/50 rounded px-[6px] py-[2px]" title="Last contacted">
                                      {new Date(lead.lastContactedAt).toLocaleDateString()}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex flex-col gap-1 text-sm text-muted-foreground">
                                  {lead.email && <div className="flex items-center gap-2"><Mail className="w-3 h-3" /> {lead.email}</div>}
                                  {lead.phone && <div className="flex items-center gap-2"><Phone className="w-3 h-3" /> {lead.phone}</div>}
                                </div>
                              </TableCell>
                              <TableCell>
                                <LeadStatusBadge status={lead.status} />
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  {lead.phone && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                          asChild
                                          aria-label="Call lead"
                                          data-testid={`button-call-lead-${lead.id}`}
                                        >
                                          <a href={`tel:${lead.phone}`}>
                                            <Phone className="w-4 h-4" />
                                          </a>
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Call {lead.phone}</TooltipContent>
                                    </Tooltip>
                                  )}
                                  {lead.email && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                          asChild
                                          aria-label="Email lead"
                                          data-testid={`button-email-lead-${lead.id}`}
                                        >
                                          <a href={`mailto:${lead.email}`}>
                                            <Mail className="w-4 h-4" />
                                          </a>
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent>Email {lead.email}</TooltipContent>
                                    </Tooltip>
                                  )}
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                        onClick={() => setLocation(`/leads/${lead.id}`)}
                                        aria-label="View notes and timeline"
                                        data-testid={`button-note-lead-${lead.id}`}
                                      >
                                        <StickyNote className="w-4 h-4" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>Add Note / View Timeline</TooltipContent>
                                  </Tooltip>
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Lead actions" data-testid={`button-actions-lead-${lead.id}`}>
                                        <MoreVertical className="w-4 h-4" />
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => setLocation(`/leads/${lead.id}`)} data-testid={`button-view-lead-${lead.id}`}>
                                        <Eye className="w-4 h-4 mr-2" />
                                        View Details
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => setEditingLead(lead)} data-testid={`button-edit-lead-${lead.id}`}>
                                        <Edit className="w-4 h-4 mr-2" />
                                        Edit
                                      </DropdownMenuItem>
                                      <RescoreMenuItem leadId={lead.id} />
                                      <DropdownMenuItem onClick={() => setOfferLetterLead(lead)} data-testid={`button-offer-letter-${lead.id}`}>
                                        <FileText className="w-4 h-4 mr-2" />
                                        Generate Offer Letter
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onClick={() => setDeletingLead(lead)}
                                        className="text-destructive"
                                        data-testid={`button-delete-lead-${lead.id}`}
                                      >
                                        <Trash2 className="w-4 h-4 mr-2" />
                                        Delete
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {serverTotal > pageSize && (
                        <ListPagination
                          currentPage={safeCurrentPage}
                          totalItems={totalLeadItems}
                          pageSize={pageSize}
                          onPageChange={handlePageChange}
                          onPageSizeChange={handlePageSizeChange}
                          className="border-t px-4"
                        />
                      )}
                    </div>

                    {/* Mobile Card View */}
                    <div className="block md:hidden">
                      {filteredLeads?.length === 0 && leads?.length === 0 && (
                        <FirstHelloEmpty
                          surface="leads"
                          cta={{
                            primary: { label: "Add your first lead", onClick: () => setIsCreateOpen(true) },
                            secondary: { label: "Import from CSV", onClick: () => setIsImportOpen(true) },
                          }}
                        />
                      )}
                      {filteredLeads?.length === 0 && leads && leads.length > 0 && (
                        <div className="p-4">
                          <EmptyFilter
                            filterCount={
                              (search ? 1 : 0) +
                              (stageFilter !== "all" ? 1 : 0) +
                              (assigneeFilter !== "all" ? 1 : 0) +
                              countActiveGisFilters(gisFilters)
                            }
                            onClearFilters={() => {
                              setSearch("");
                              setStageFilter("all");
                              setAssigneeFilter("all");
                              setGisFilters(defaultGisFilters);
                            }}
                          />
                        </div>
                      )}
                      {filteredLeads && filteredLeads.length > 0 && (
                        <div className="p-3 border-b flex items-center justify-between">
                          {/* Tap-friendly label wraps the checkbox so the
                              whole "☐ Select all" region (≥44pt tall) is
                              the hit target, not just the 20px box. */}
                          <label className="flex items-center gap-2 min-h-[44px] -my-2 px-2 -ml-2 rounded-md cursor-pointer">
                            <Checkbox
                              checked={filteredLeads.length > 0 && selectedLeadIds.size === filteredLeads.length}
                              onCheckedChange={(checked) => handleSelectAll(checked === true)}
                              className="min-h-[20px] min-w-[20px]"
                              data-testid="checkbox-select-all-leads-mobile"
                            />
                            <span className="text-sm text-muted-foreground">Select all</span>
                          </label>
                          <button
                            type="button"
                            onClick={handleSortByScore}
                            className="flex items-center text-sm text-muted-foreground hover-elevate rounded px-2 py-1 min-h-[44px]"
                            data-testid="button-sort-score-mobile"
                          >
                            Sort by Score
                            {getSortIcon()}
                          </button>
                        </div>
                      )}
                      <div className="divide-y">
                        {paginatedLeads.map((lead) => (
                          <div
                            key={lead.id}
                            className="p-4 hover-elevate"
                            data-testid={`card-lead-${lead.id}`}
                          >
                            <div className="flex items-start gap-1">
                              {/* Checkbox gets a 44pt invisible tap zone
                                  via the wrapping label — taps slightly
                                  off the 20px box still select, and the
                                  card body remains the "view lead"
                                  affordance. */}
                              <label
                                className="flex items-center justify-center min-h-[44px] min-w-[44px] -ml-2 rounded-md cursor-pointer shrink-0"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${lead.firstName} ${lead.lastName}`}
                              >
                                <Checkbox
                                  checked={selectedLeadIds.has(lead.id)}
                                  onCheckedChange={(checked) => handleSelectLead(lead.id, checked === true)}
                                  className="min-h-[20px] min-w-[20px]"
                                  data-testid={`checkbox-lead-mobile-${lead.id}`}
                                />
                              </label>
                              <div className="flex-1 min-w-0" onClick={() => setLocation(`/leads/${lead.id}`)}>
                                <div className="flex items-center justify-between gap-2">
                                  <h3 className="font-medium truncate" data-testid={`text-lead-name-${lead.id}`}>
                                    {lead.firstName} {lead.lastName}
                                  </h3>
                                  <LeadStatusBadge status={lead.status} />
                                </div>
                                <div className="flex items-center gap-2 mt-2 flex-wrap">
                                  <LeadScoreBadge lead={lead} />
                                  <ContactAgeBadge lead={lead} />
                                  <TcpaConsentBadge lead={lead} />
                                </div>
                                <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                                  {lead.email && (
                                    <div className="flex items-center gap-2 truncate">
                                      <Mail className="w-3 h-3 shrink-0" />
                                      <span className="truncate">{lead.email}</span>
                                    </div>
                                  )}
                                  {lead.phone && (
                                    <div className="flex items-center gap-2">
                                      <Phone className="w-3 h-3 shrink-0" />
                                      <span>{lead.phone}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button 
                                    variant="ghost"
                                    size="icon"
                                    className="min-h-[44px] min-w-[44px] shrink-0"
                                    aria-label="Lead actions"
                                    data-testid={`button-actions-lead-mobile-${lead.id}`}
                                  >
                                    <MoreVertical className="w-5 h-5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem 
                                    onClick={() => setLocation(`/leads/${lead.id}`)}
                                    className="min-h-[44px]"
                                    data-testid={`button-view-lead-mobile-${lead.id}`}
                                  >
                                    <Eye className="w-4 h-4 mr-2" />
                                    View Details
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    onClick={() => setEditingLead(lead)}
                                    className="min-h-[44px]"
                                    data-testid={`button-edit-lead-mobile-${lead.id}`}
                                  >
                                    <Edit className="w-4 h-4 mr-2" />
                                    Edit
                                  </DropdownMenuItem>
                                  <RescoreMenuItem leadId={lead.id} />
                                  <DropdownMenuItem 
                                    onClick={() => setOfferLetterLead(lead)}
                                    className="min-h-[44px]"
                                    data-testid={`button-offer-letter-mobile-${lead.id}`}
                                  >
                                    <FileText className="w-4 h-4 mr-2" />
                                    Generate Offer Letter
                                  </DropdownMenuItem>
                                  <DropdownMenuItem 
                                    onClick={() => setDeletingLead(lead)} 
                                    className="text-destructive min-h-[44px]"
                                    data-testid={`button-delete-lead-mobile-${lead.id}`}
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    Delete
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </div>
                        ))}
                      </div>
                      {serverTotal > pageSize && (
                        <ListPagination
                          currentPage={safeCurrentPage}
                          totalItems={totalLeadItems}
                          pageSize={pageSize}
                          onPageChange={handlePageChange}
                          onPageSizeChange={handlePageSizeChange}
                          className="border-t px-4"
                        />
                      )}
                    </div>
                  </>
                </ContentReveal>
              </div>
            </div>

            <div className="lg:w-80 flex-shrink-0">
              <FocusList />
            </div>
          </div>

      <ResponsiveModal open={!!editingLead} onOpenChange={(open) => !open && setEditingLead(null)}>
        <ResponsiveModalContent className="sm:max-w-[425px]">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Edit Lead</ResponsiveModalTitle>
          </ResponsiveModalHeader>
          {editingLead && (
            <LeadForm
              lead={editingLead}
              onSuccess={() => setEditingLead(null)}
            />
          )}
        </ResponsiveModalContent>
      </ResponsiveModal>

      <ConfirmDialog
        open={!!deletingLead}
        onOpenChange={(open) => !open && setDeletingLead(null)}
        title="Delete Lead"
        description={`Are you sure you want to delete ${deletingLead?.firstName} ${deletingLead?.lastName}? This action cannot be undone and will permanently remove this lead from your CRM.`}
        confirmLabel="Delete Lead"
        onConfirm={handleDelete}
        isLoading={isDeleting}
        variant="destructive"
      />

      <SafeBulkDeleteDialog
        open={showBulkDeleteConfirm}
        onOpenChange={setShowBulkDeleteConfirm}
        selectedIds={Array.from(selectedLeadIds)}
        onSuccess={handleBulkDeleteSuccess}
      />

      <ResponsiveModal open={!!offerLetterLead} onOpenChange={(open) => !open && setOfferLetterLead(null)}>
        <ResponsiveModalContent className="sm:max-w-[425px]">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Generate Offer Letter</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Create an offer letter for {offerLetterLead?.firstName} {offerLetterLead?.lastName}
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>
          <form
            id={offerFormId}
            className="space-y-4 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (selectedPropertyId && !isGeneratingOffer) handleGenerateOfferLetter();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor={offerPropertyId} className="text-sm font-medium">Select property</Label>
              <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
                <SelectTrigger id={offerPropertyId} data-testid="select-property-offer">
                  <SelectValue placeholder="Choose a property…" />
                </SelectTrigger>
                <SelectContent>
                  {properties?.map((prop) => (
                    <SelectItem key={prop.id} value={String(prop.id)}>
                      {prop.county}, {prop.state} - {prop.apn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor={offerAmountId} className="text-sm font-medium">Offer amount (optional)</Label>
              <Input
                id={offerAmountId}
                type="number"
                inputMode="decimal"
                placeholder="Enter offer amount…"
                value={offerAmount}
                onChange={(e) => setOfferAmount(e.target.value)}
                data-testid="input-offer-amount"
              />
              <p className="text-xs text-muted-foreground">Leave blank to use 30% of assessed value</p>
            </div>
          </form>
          <ResponsiveModalFooter>
            <Button type="button" variant="outline" onClick={() => setOfferLetterLead(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form={offerFormId}
              disabled={!selectedPropertyId || isGeneratingOffer}
              data-testid="button-generate-offer"
            >
              {isGeneratingOffer ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><FileText className="w-4 h-4 mr-2" /> Generate PDF</>
              )}
            </Button>
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      <ResponsiveModal open={isImportOpen} onOpenChange={(open) => !open && resetImportDialog()}>
        <ResponsiveModalContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <ResponsiveModalHeader>
            <ResponsiveModalTitle>Import leads from CSV</ResponsiveModalTitle>
            <ResponsiveModalDescription>
              Upload a CSV file to bulk import leads. Required columns: firstName, lastName.
            </ResponsiveModalDescription>
          </ResponsiveModalHeader>

          {!importPreview && !importResult && (
            <div className="space-y-4 py-4">
              <div className="border-2 border-dashed rounded-card p-8 text-center">
                <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
                <label className="cursor-pointer block min-h-11 focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 rounded">
                  <span className="text-sm text-muted-foreground">
                    {isLoadingPreview ? "Processing…" : "Click to select or drag a CSV file here"}
                  </span>
                  <Input
                    type="file"
                    accept=".csv"
                    className="sr-only"
                    onChange={handleFileSelect}
                    disabled={isLoadingPreview}
                    aria-label="Select CSV file to import"
                    data-testid="input-import-file"
                  />
                </label>
                <p className="text-xs text-muted-foreground mt-2">Max file size: 5 MB.</p>
              </div>
              <div className="bg-muted/50 rounded-card p-4">
                <p className="text-sm font-medium mb-2">Expected columns</p>
                <p className="text-xs text-muted-foreground">
                  firstName, lastName, email, phone, address, city, state, zip, type, status, source, notes
                </p>
              </div>
            </div>
          )}

          {importPreview && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-sm" role="status" aria-live="polite">
                <CheckCircle className="w-4 h-4 text-acr-pos" aria-hidden="true" />
                <span>Found <span className="tabular-nums">{importPreview.totalRows}</span> rows to import.</span>
              </div>

              <div className="border rounded-card overflow-hidden">
                <div className="bg-muted/50 p-2 text-sm font-medium">
                  Preview (first 5 rows)
                </div>
                <div className="overflow-x-auto" role="region" tabIndex={0} aria-label="CSV preview">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {importPreview.headers.slice(0, 5).map((header) => (
                          <TableHead key={header} className="text-xs whitespace-nowrap">
                            {header}
                          </TableHead>
                        ))}
                        {importPreview.headers.length > 5 && (
                          <TableHead className="text-xs">+{importPreview.headers.length - 5} more</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importPreview.preview.map((row, idx) => (
                        <TableRow key={idx}>
                          {importPreview.headers.slice(0, 5).map((header) => (
                            <TableCell key={header} className="text-xs max-w-[150px] truncate">
                              {row[header] || "—"}
                            </TableCell>
                          ))}
                          {importPreview.headers.length > 5 && (
                            <TableCell className="text-xs text-muted-foreground">…</TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          {importResult && (
            <div className="space-y-4 py-4">
              <dl className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-muted/50 rounded-card p-4">
                  <dd className="text-2xl font-bold tabular-nums">{importResult.totalRows}</dd>
                  <dt className="text-xs text-muted-foreground">Total rows</dt>
                </div>
                <div className="bg-acr-pos-soft dark:bg-acr-pos-soft/30 rounded-card p-4">
                  <dd className="text-2xl font-bold text-acr-pos dark:text-acr-pos tabular-nums">{importResult.successCount}</dd>
                  <dt className="text-xs text-acr-pos dark:text-acr-pos">Imported</dt>
                </div>
                <div className="bg-acr-neg-soft dark:bg-acr-neg-soft/30 rounded-card p-4">
                  <dd className="text-2xl font-bold text-acr-neg dark:text-acr-neg tabular-nums">{importResult.errorCount}</dd>
                  <dt className="text-xs text-acr-neg dark:text-acr-neg">Failed</dt>
                </div>
              </dl>

              {importResult.errors.length > 0 && (
                <div className="border border-acr-neg-soft dark:border-acr-neg-soft rounded-card overflow-hidden" role="alert">
                  <div className="bg-acr-neg-soft dark:bg-acr-neg-soft/30 p-2 text-sm font-medium text-acr-neg dark:text-acr-neg flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" aria-hidden="true" />
                    Errors (<span className="tabular-nums">{importResult.errors.length}</span>)
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {importResult.errors.slice(0, 10).map((err, idx) => (
                      <div key={idx} className="p-2 border-b last:border-0 text-xs">
                        <span className="font-medium">Row <span className="tabular-nums">{err.row}</span>:</span>{" "}
                        <span className="text-acr-neg dark:text-acr-neg">{err.error}</span>
                      </div>
                    ))}
                    {importResult.errors.length > 10 && (
                      <div className="p-2 text-xs text-muted-foreground">
                        …and <span className="tabular-nums">{importResult.errors.length - 10}</span> more errors.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <ResponsiveModalFooter>
            {!importResult ? (
              <>
                <Button variant="outline" className="min-h-11" onClick={resetImportDialog}>
                  Cancel
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={!importPreview || isImporting}
                  className="min-h-11"
                  data-testid="button-confirm-import"
                >
                  {isImporting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" /> Importing…</>
                  ) : (
                    <><Upload className="w-4 h-4 mr-2" aria-hidden="true" /> Import <span className="tabular-nums mx-1">{importPreview?.totalRows || 0}</span> leads</>
                  )}
                </Button>
              </>
            ) : (
              <Button onClick={resetImportDialog} className="min-h-11" data-testid="button-close-import">
                Done
              </Button>
            )}
          </ResponsiveModalFooter>
        </ResponsiveModalContent>
      </ResponsiveModal>

      <TaxDelinquentImporter 
        open={isTaxDelinquentImportOpen} 
        onOpenChange={setIsTaxDelinquentImportOpen} 
      />
    </PageShell>
  );
}

function LeadStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: "bg-acr-accent text-acr-accent dark:bg-acr-accent/30 dark:text-acr-accent",
    contacting: "bg-acr-brand-soft text-acr-brand dark:bg-acr-brand-soft/30 dark:text-acr-brand",
    negotiation: "bg-acr-warn-soft text-acr-warn dark:bg-acr-warn-soft/30 dark:text-acr-warn",
    closed: "bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/30 dark:text-acr-pos",
    dead: "bg-muted text-muted-foreground",
  };
  
  return (
    <Badge variant="outline" className={`capitalize font-medium border-0 ${styles[status] || styles.new}`}>
      {status}
    </Badge>
  );
}

function LeadForm({ lead, onSuccess }: { lead?: Lead; onSuccess: () => void }) {
  const { mutate: createLead, isPending: isCreating } = useCreateLead();
  const { mutate: updateLead, isPending: isUpdating } = useUpdateLead();
  const isPending = isCreating || isUpdating;

  const form = useForm<z.infer<typeof leadFormSchema>>({
    resolver: zodResolver(leadFormSchema) as any,
    defaultValues: {
      firstName: lead?.firstName || "",
      lastName: lead?.lastName || "",
      email: lead?.email || "",
      phone: lead?.phone || "",
      status: lead?.status || "new",
    }
  });

  useUnsavedChanges(form.formState.isDirty);

  const onSubmit = (data: z.infer<typeof leadFormSchema>) => {
    if (lead) {
      updateLead({ id: lead.id, ...data }, {
        onSuccess: () => {
          telemetry.actionCompleted('lead_updated', { leadId: lead.id });
          onSuccess();
        },
      });
    } else {
      createLead(data, {
        onSuccess: () => {
          telemetry.actionCompleted('lead_created', { firstName: data.firstName, lastName: data.lastName });
          onSuccess();
        },
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4" data-testid="lead-form">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  First name <span className="text-destructive" aria-label="required">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="John"
                    autoComplete="given-name"
                    autoCapitalize="words"
                    spellCheck={false}
                    data-testid="input-first-name"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lastName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Last name <span className="text-destructive" aria-label="required">*</span>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="Doe"
                    autoComplete="family-name"
                    autoCapitalize="words"
                    spellCheck={false}
                    data-testid="input-last-name"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="john@example.com"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  data-testid="input-email"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="(555) 123-4567"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  data-testid="input-phone"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <Select onValueChange={field.onChange} value={field.value || "new"}>
                <FormControl>
                  <SelectTrigger data-testid="select-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacting">Contacting</SelectItem>
                  <SelectItem value="negotiation">Negotiation</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="dead">Dead</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="pt-2">
          <Button type="submit" className="w-full min-h-11" disabled={isPending} data-testid="button-submit-lead">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                {lead ? "Saving…" : "Creating…"}
              </>
            ) : (
              lead ? "Save changes" : "Create lead"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export function ScoreBreakdownCard({ leadId }: { leadId: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const { data: scoreHistory, isLoading } = useQuery<ScoreHistory[]>({
    queryKey: ["/api/leads", leadId, "score-history"],
    enabled: isOpen,
  });

  const latestFactors = scoreHistory?.[0]?.factors || {};
  const factorEntries = Object.entries(latestFactors).filter(
    ([key]) => !["totalRawScore", "normalizedScore", "recommendation"].includes(key)
  );

  const FACTOR_LABELS: Record<string, string> = {
    ownershipDuration: "Ownership Duration",
    taxDelinquency: "Tax Delinquency",
    absenteeOwner: "Absentee Owner",
    propertySize: "Property Size",
    corporateOwner: "Corporate Owner",
    outOfState: "Out-of-State Owner",
    inheritanceIndicator: "Inheritance Indicator",
    floodZone: "Flood Zone",
    responseRecency: "Response Recency",
    emailEngagement: "Email Engagement",
    campaignTouches: "Campaign Touches",
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="glass-panel">
        <CollapsibleTrigger asChild>
          <CardHeader className="pb-2 cursor-pointer hover:bg-muted/30 rounded-t-lg transition-colors">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4" aria-hidden="true" /> Score breakdown
              </span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden="true" />
            </CardTitle>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-3">
            {isLoading && (
              <div className="flex items-center justify-center py-4" role="status" aria-live="polite">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-hidden="true" />
                <span className="sr-only">Loading score breakdown…</span>
              </div>
            )}
            {!isLoading && factorEntries.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-3">
                No score breakdown available. Click "Rescore lead" to generate one.
              </p>
            )}
            {!isLoading && factorEntries.length > 0 && (
              <div className="space-y-1 mt-1">
                {factorEntries.map(([key, factor]: [string, any]) => {
                  const score = factor?.score ?? 0;
                  const explanation = factor?.explanation ?? key;
                  const isPos = score > 0;
                  const isNeg = score < 0;
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between py-1.5 px-3 rounded-md text-sm
                        ${isPos ? "bg-acr-pos-soft dark:bg-acr-pos-soft/20" : isNeg ? "bg-acr-neg-soft dark:bg-acr-neg-soft/20" : "bg-muted/40"}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {isPos && <TrendingUp className="w-3 h-3 text-acr-pos dark:text-acr-pos flex-shrink-0" aria-hidden="true" />}
                        {isNeg && <TrendingDown className="w-3 h-3 text-acr-neg dark:text-acr-neg flex-shrink-0" aria-hidden="true" />}
                        {!isPos && !isNeg && <Minus className="w-3 h-3 text-muted-foreground flex-shrink-0" aria-hidden="true" />}
                        <span className="truncate text-xs">{explanation || FACTOR_LABELS[key] || key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      </div>
                      <span className={`text-xs font-semibold flex-shrink-0 ml-2 tabular-nums
                        ${isPos ? "text-acr-pos dark:text-acr-pos" : isNeg ? "text-acr-neg dark:text-acr-neg" : "text-muted-foreground"}`}>
                        {isPos ? "+" : ""}{score}
                      </span>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground text-center pt-2">
                  Scored {scoreHistory?.[0]?.scoredAt ? new Date(scoreHistory[0].scoredAt).toLocaleDateString() : "recently"}
                </p>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

