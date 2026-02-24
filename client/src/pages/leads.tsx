import { PageShell } from "@/components/page-shell";
import { useLeads, useCreateLead, useUpdateLead, useDeleteLead } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useTeamMembers, useUserPermissions, getRoleBadgeStyle, getRoleLabel } from "@/hooks/use-organization";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ListSkeleton, TableRowSkeleton } from "@/components/list-skeleton";
import { useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertLeadSchema, type Lead } from "@shared/schema";
import { z } from "zod";
import { useLocation, useSearch } from "wouter";

// Phone number formatting helper - strips to digits only
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
const leadFormSchema = insertLeadSchema.omit({ organizationId: true }).extend({
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Mail, Phone, Trash2, Edit, Loader2, Users, FileText, Download, Upload, CheckCircle, XCircle, AlertCircle, Flame, Sun, Snowflake, Skull, ArrowUpDown, ArrowUp, ArrowDown, X, Clock, Eye, User, Calendar, MapPin, StickyNote, PhoneOff, Shield, CheckSquare, RefreshCw, TrendingUp, TrendingDown, Minus, History, Filter, ChevronDown, MoreVertical } from "lucide-react";
import { telemetry } from "@/lib/telemetry";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/empty-state";
import { LeadsEmptyState } from "@/components/empty-states";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
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
      return "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300";
    case "warm":
      return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "cold":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getRecommendationStyle(rec: "mail" | "maybe" | "skip"): string {
  switch (rec) {
    case "mail":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
    case "maybe":
      return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "skip":
      return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
  }
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

  const rescoreMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${lead.id}/betty-score`, { triggerSource: "manual" });
      if (!res.ok) throw new Error("Failed to rescore lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      refetchHistory();
      toast({
        title: "Lead rescored",
        description: "The lead score has been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to rescore lead.",
        variant: "destructive",
      });
    },
  });

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
      ? "text-green-600 dark:text-green-400" 
      : isNegative 
        ? "text-red-600 dark:text-red-400" 
        : "text-muted-foreground";
    const bgClass = isPositive
      ? "bg-green-50 dark:bg-green-900/20"
      : isNegative
        ? "bg-red-50 dark:bg-red-900/20"
        : "bg-muted/50";
    
    return (
      <div 
        key={key} 
        className={`flex items-center justify-between py-2 px-3 rounded-md ${bgClass}`}
        data-testid={`factor-${key}-${lead.id}`}
      >
        <div className="flex items-center gap-2">
          {isPositive && <TrendingUp className="w-3 h-3 text-green-600 dark:text-green-400" />}
          {isNegative && <TrendingDown className="w-3 h-3 text-red-600 dark:text-red-400" />}
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Score Details: {lead.firstName} {lead.lastName}
          </DialogTitle>
          <DialogDescription>
            Betty-style lead scoring breakdown
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4 p-4 bg-muted/50 rounded-lg">
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
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button 
            onClick={() => rescoreMutation.mutate()} 
            disabled={rescoreMutation.isPending}
            data-testid={`button-rescore-${lead.id}`}
          >
            {rescoreMutation.isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Rescoring...</>
            ) : (
              <><RefreshCw className="w-4 h-4 mr-2" /> Rescore</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RescoreMenuItem({ leadId }: { leadId: number }) {
  const { toast } = useToast();
  const rescoreMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/betty-score`, { triggerSource: "manual" });
      if (!res.ok) throw new Error("Failed to rescore lead");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({
        title: "Lead rescored",
        description: "The lead score has been updated.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to rescore lead.",
        variant: "destructive",
      });
    },
  });

  return (
    <DropdownMenuItem 
      onClick={() => rescoreMutation.mutate()} 
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

function LeadScoreBadge({ lead }: { lead: LeadWithScore }) {
  const [showDetails, setShowDetails] = useState(false);
  const stage = lead.nurturingStage || "new";
  const normalizedScore = lead.score ?? 0;
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
              className={`text-xs border-0 flex items-center gap-1 ${getStageStyle(stage)}`}
            >
              {getStageIcon(stage)}
              {normalizedScore}
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
          <span data-testid={`tooltip-score-${lead.id}`}>Score: {normalizedScore}/100 - Click for details</span>
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
  if (days <= 3) return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";
  if (days <= 7) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300";
  return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300";
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

function TcpaConsentToggle({ lead }: { lead: Lead }) {
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
        title: "Error",
        description: "Failed to update consent status.",
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

function TcpaConsentBadge({ lead }: { lead: Lead }) {
  const hasConsent = lead.tcpaConsent === true;
  const isOptedOut = lead.doNotContact === true;
  
  if (isOptedOut) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className="text-xs border-0 flex items-center gap-1 cursor-default bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
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
            className="text-xs border-0 flex items-center gap-1 cursor-default bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
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
          className="text-xs border-0 flex items-center gap-1 cursor-default bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
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
  const { data: leads, isLoading } = useLeads();
  const { data: properties } = useProperties();
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const stageFromUrl = urlParams.get("stage") || "all";
  const actionFromUrl = urlParams.get("action");
  
  const [isCreateOpen, setIsCreateOpen] = useState(actionFromUrl === "new");
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [deletingLead, setDeletingLead] = useState<Lead | null>(null);
  const [viewingLead, setViewingLead] = useState<Lead | null>(null);
  const [offerLetterLead, setOfferLetterLead] = useState<Lead | null>(null);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [offerAmount, setOfferAmount] = useState<string>("");
  const [isGeneratingOffer, setIsGeneratingOffer] = useState(false);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState(stageFromUrl);
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc" | null>(null);
  const [gisFilters, setGisFilters] = useState<GisFilterState>(defaultGisFilters);
  const { data: teamMembers } = useTeamMembers();
  const { data: userPermissions } = useUserPermissions();
  const [isExporting, setIsExporting] = useState(false);
  const [isImportOpen, setIsImportOpen] = useState(false);
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

  const handleBulkDelete = async () => {
    if (selectedLeadIds.size === 0) return;
    setIsBulkDeleting(true);
    try {
      const res = await apiRequest("POST", "/api/leads/bulk-delete", { ids: Array.from(selectedLeadIds) });
      if (!res.ok) throw new Error("Failed to delete leads");
      const result = await res.json();
      toast({ title: "Success", description: `Deleted ${result.deletedCount} leads.` });
      setSelectedLeadIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete leads", variant: "destructive" });
    } finally {
      setIsBulkDeleting(false);
      setShowBulkDeleteConfirm(false);
    }
  };

  const handleBulkStatusChange = async (status: string) => {
    if (selectedLeadIds.size === 0) return;
    setIsBulkUpdating(true);
    try {
      const res = await apiRequest("POST", "/api/leads/bulk-update", { ids: Array.from(selectedLeadIds), updates: { status } });
      if (!res.ok) throw new Error("Failed to update leads");
      const result = await res.json();
      toast({ title: "Success", description: `Updated ${result.updatedCount} leads to "${status}".` });
      setSelectedLeadIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to update leads", variant: "destructive" });
    } finally {
      setIsBulkUpdating(false);
    }
  };

  const handleBulkExport = () => {
    if (selectedLeadIds.size === 0) return;
    const selectedLeads = filteredLeads?.filter(l => selectedLeadIds.has(l.id)) || [];
    const headers = ["firstName", "lastName", "email", "phone", "status"];
    const csvRows = [headers.join(",")];
    selectedLeads.forEach(lead => {
      csvRows.push([lead.firstName, lead.lastName, lead.email || "", lead.phone || "", lead.status].map(v => `"${v || ""}"`).join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-export-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleStageFilterChange = (value: string) => {
    setStageFilter(value);
    if (value === "all") {
      setLocation("/leads");
    } else {
      setLocation(`/leads?stage=${value}`);
    }
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
      if (!response.ok) throw new Error('Failed to export');
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
    } catch (error) {
      console.error('Export error:', error);
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
    } catch (error) {
      console.error('Preview error:', error);
      setImportPreview(null);
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
    } catch (error) {
      console.error('Import error:', error);
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
    } catch (error) {
      console.error('Download error:', error);
    } finally {
      setIsGeneratingOffer(false);
    }
  };

  const filteredLeads = useMemo(() => {
    if (!leads) return [];
    
    let result = leads as LeadWithScore[];
    
    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      result = result.filter(l => 
        l.lastName.toLowerCase().includes(searchLower) || 
        l.firstName.toLowerCase().includes(searchLower) ||
        l.email?.toLowerCase().includes(searchLower)
      );
    }
    
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
  }, [leads, search, stageFilter, assigneeFilter, gisFilters, sortOrder]);

  const handleDelete = () => {
    if (deletingLead) {
      deleteLead(deletingLead.id, {
        onSuccess: () => setDeletingLead(null),
      });
    }
  };

  return (
    <PageShell>
          
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">Leads CRM</h1>
              <p className="text-muted-foreground">Manage your potential buyers and sellers.</p>
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
                    {isExporting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
                    Export CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => setIsImportOpen(true)}
                    className="min-h-[44px]"
                    data-testid="button-import-leads-mobile"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Import CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem 
                    onClick={() => setIsTaxDelinquentImportOpen(true)}
                    className="min-h-[44px]"
                    data-testid="button-import-tax-delinquent-mobile"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Import Tax List
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              
              <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogTrigger asChild>
                  <Button className="shadow-lg hover:shadow-primary/25 min-h-[44px]" data-testid="button-add-lead">
                    <Plus className="w-4 h-4 mr-2" /> Add New Lead
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[425px]">
                  <DialogHeader>
                    <DialogTitle>Create New Lead</DialogTitle>
                  </DialogHeader>
                  <LeadForm onSuccess={() => setIsCreateOpen(false)} />
                </DialogContent>
              </Dialog>
            </div>
          </div>

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
                      placeholder="Search leads..." 
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
                      <SelectItem value="all">All Leads</SelectItem>
                      <SelectItem value="hot">
                        <span className="flex items-center gap-2">
                          <Flame className="w-3 h-3 text-orange-500" /> Hot Leads
                        </span>
                      </SelectItem>
                      <SelectItem value="warm">
                        <span className="flex items-center gap-2">
                          <Sun className="w-3 h-3 text-yellow-500" /> Warm Leads
                        </span>
                      </SelectItem>
                      <SelectItem value="cold">
                        <span className="flex items-center gap-2">
                          <Snowflake className="w-3 h-3 text-blue-500" /> Cold Leads
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
                      <SelectTrigger className="w-[180px]" data-testid="select-assignee-filter">
                        <SelectValue placeholder="Filter by assignee" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Assignees</SelectItem>
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
                          placeholder="Search leads..." 
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
                                <Flame className="w-3 h-3 text-orange-500" /> Hot Leads
                              </span>
                            </SelectItem>
                            <SelectItem value="warm">
                              <span className="flex items-center gap-2">
                                <Sun className="w-3 h-3 text-yellow-500" /> Warm Leads
                              </span>
                            </SelectItem>
                            <SelectItem value="cold">
                              <span className="flex items-center gap-2">
                                <Snowflake className="w-3 h-3 text-blue-500" /> Cold Leads
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
                              <SelectItem value="all">All Assignees</SelectItem>
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
                      <Button variant="ghost" size="sm" onClick={() => setSelectedLeadIds(new Set())} data-testid="button-clear-selection">
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}

                {isLoading ? (
                  <div className="p-4" data-testid="skeleton-leads-table">
                    <ListSkeleton count={8} variant="table" />
                  </div>
                ) : (
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
                            <TableHead className="text-right min-w-[80px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredLeads?.length === 0 && leads?.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={6} className="p-0">
                                <LeadsEmptyState
                                  onAddLead={() => setIsCreateOpen(true)}
                                  onImportLeads={() => setIsImportOpen(true)}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                          {filteredLeads?.length === 0 && leads && leads.length > 0 && (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center h-32 text-muted-foreground">
                                No leads found matching your search or filter.
                              </TableCell>
                            </TableRow>
                          )}
                          {filteredLeads?.map((lead) => (
                            <TableRow key={lead.id} className="group" data-testid={`row-lead-${lead.id}`}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedLeadIds.has(lead.id)}
                                  onCheckedChange={(checked) => handleSelectLead(lead.id, checked === true)}
                                  data-testid={`checkbox-lead-${lead.id}`}
                                />
                              </TableCell>
                              <TableCell className="font-medium">
                                {lead.firstName} {lead.lastName}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <LeadScoreBadge lead={lead} />
                                  <ContactAgeBadge lead={lead} />
                                  <TcpaConsentBadge lead={lead} />
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
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" data-testid={`button-actions-lead-${lead.id}`}>
                                      Actions
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => setViewingLead(lead)} data-testid={`button-view-lead-${lead.id}`}>
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
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Mobile Card View */}
                    <div className="block md:hidden">
                      {filteredLeads?.length === 0 && leads?.length === 0 && (
                        <LeadsEmptyState
                          onAddLead={() => setIsCreateOpen(true)}
                          onImportLeads={() => setIsImportOpen(true)}
                        />
                      )}
                      {filteredLeads?.length === 0 && leads && leads.length > 0 && (
                        <div className="text-center py-12 text-muted-foreground">
                          No leads found matching your search or filter.
                        </div>
                      )}
                      {filteredLeads && filteredLeads.length > 0 && (
                        <div className="p-3 border-b flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={filteredLeads.length > 0 && selectedLeadIds.size === filteredLeads.length}
                              onCheckedChange={(checked) => handleSelectAll(checked === true)}
                              className="min-h-[20px] min-w-[20px]"
                              data-testid="checkbox-select-all-leads-mobile"
                            />
                            <span className="text-sm text-muted-foreground">Select all</span>
                          </div>
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
                        {filteredLeads?.map((lead) => (
                          <div 
                            key={lead.id} 
                            className="p-4 hover-elevate"
                            data-testid={`card-lead-${lead.id}`}
                          >
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked={selectedLeadIds.has(lead.id)}
                                onCheckedChange={(checked) => handleSelectLead(lead.id, checked === true)}
                                className="mt-1 min-h-[20px] min-w-[20px]"
                                data-testid={`checkbox-lead-mobile-${lead.id}`}
                              />
                              <div className="flex-1 min-w-0" onClick={() => setViewingLead(lead)}>
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
                                    data-testid={`button-actions-lead-mobile-${lead.id}`}
                                  >
                                    <MoreVertical className="w-5 h-5" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem 
                                    onClick={() => setViewingLead(lead)}
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
                    </div>
                  </>
                )}
              </div>
            </div>
            
            <div className="lg:w-80 flex-shrink-0">
              <FocusList />
            </div>
          </div>

      {viewingLead && (
        <LeadDetailDrawer 
          lead={viewingLead} 
          onClose={() => setViewingLead(null)} 
          onEdit={() => {
            setEditingLead(viewingLead);
            setViewingLead(null);
          }}
        />
      )}

      <Dialog open={!!editingLead} onOpenChange={(open) => !open && setEditingLead(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Lead</DialogTitle>
          </DialogHeader>
          {editingLead && (
            <LeadForm 
              lead={editingLead} 
              onSuccess={() => setEditingLead(null)} 
            />
          )}
        </DialogContent>
      </Dialog>

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

      <ConfirmDialog
        open={showBulkDeleteConfirm}
        onOpenChange={(open) => !open && setShowBulkDeleteConfirm(false)}
        title="Delete Selected Leads"
        description={`Are you sure you want to delete ${selectedLeadIds.size} lead${selectedLeadIds.size !== 1 ? "s" : ""}? This action cannot be undone and will permanently remove them from your CRM.`}
        confirmLabel={`Delete ${selectedLeadIds.size} Lead${selectedLeadIds.size !== 1 ? "s" : ""}`}
        onConfirm={handleBulkDelete}
        isLoading={isBulkDeleting}
        variant="destructive"
      />

      <Dialog open={!!offerLetterLead} onOpenChange={(open) => !open && setOfferLetterLead(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Generate Offer Letter</DialogTitle>
            <DialogDescription>
              Create an offer letter for {offerLetterLead?.firstName} {offerLetterLead?.lastName}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Property</label>
              <Select value={selectedPropertyId} onValueChange={setSelectedPropertyId}>
                <SelectTrigger data-testid="select-property-offer">
                  <SelectValue placeholder="Choose a property..." />
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
              <label className="text-sm font-medium">Offer Amount (Optional)</label>
              <Input
                type="number"
                placeholder="Enter offer amount..."
                value={offerAmount}
                onChange={(e) => setOfferAmount(e.target.value)}
                data-testid="input-offer-amount"
              />
              <p className="text-xs text-muted-foreground">Leave blank to use 30% of assessed value</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferLetterLead(null)}>
              Cancel
            </Button>
            <Button 
              onClick={handleGenerateOfferLetter} 
              disabled={!selectedPropertyId || isGeneratingOffer}
              data-testid="button-generate-offer"
            >
              {isGeneratingOffer ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
              ) : (
                <><FileText className="w-4 h-4 mr-2" /> Generate PDF</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isImportOpen} onOpenChange={(open) => !open && resetImportDialog()}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Leads from CSV</DialogTitle>
            <DialogDescription>
              Upload a CSV file to bulk import leads. Required columns: firstName, lastName
            </DialogDescription>
          </DialogHeader>
          
          {!importPreview && !importResult && (
            <div className="space-y-4 py-4">
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
                <label className="cursor-pointer">
                  <span className="text-sm text-muted-foreground">
                    {isLoadingPreview ? "Processing..." : "Click to select or drag a CSV file here"}
                  </span>
                  <Input
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileSelect}
                    disabled={isLoadingPreview}
                    data-testid="input-import-file"
                  />
                </label>
                <p className="text-xs text-muted-foreground mt-2">Max file size: 5MB</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-4">
                <p className="text-sm font-medium mb-2">Expected columns:</p>
                <p className="text-xs text-muted-foreground">
                  firstName, lastName, email, phone, address, city, state, zip, type, status, source, notes
                </p>
              </div>
            </div>
          )}

          {importPreview && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle className="w-4 h-4 text-green-600" />
                <span>Found {importPreview.totalRows} rows to import</span>
              </div>
              
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted/50 p-2 text-sm font-medium">
                  Preview (first 5 rows)
                </div>
                <div className="overflow-x-auto">
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
                              {row[header] || "-"}
                            </TableCell>
                          ))}
                          {importPreview.headers.length > 5 && (
                            <TableCell className="text-xs text-muted-foreground">...</TableCell>
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
              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-2xl font-bold">{importResult.totalRows}</p>
                  <p className="text-xs text-muted-foreground">Total Rows</p>
                </div>
                <div className="bg-green-100 dark:bg-green-900/30 rounded-lg p-4">
                  <p className="text-2xl font-bold text-green-700 dark:text-green-300">{importResult.successCount}</p>
                  <p className="text-xs text-green-600 dark:text-green-400">Imported</p>
                </div>
                <div className="bg-red-100 dark:bg-red-900/30 rounded-lg p-4">
                  <p className="text-2xl font-bold text-red-700 dark:text-red-300">{importResult.errorCount}</p>
                  <p className="text-xs text-red-600 dark:text-red-400">Failed</p>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden">
                  <div className="bg-red-50 dark:bg-red-900/30 p-2 text-sm font-medium text-red-700 dark:text-red-300 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Errors ({importResult.errors.length})
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {importResult.errors.slice(0, 10).map((err, idx) => (
                      <div key={idx} className="p-2 border-b last:border-0 text-xs">
                        <span className="font-medium">Row {err.row}:</span>{" "}
                        <span className="text-red-600 dark:text-red-400">{err.error}</span>
                      </div>
                    ))}
                    {importResult.errors.length > 10 && (
                      <div className="p-2 text-xs text-muted-foreground">
                        ...and {importResult.errors.length - 10} more errors
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {!importResult ? (
              <>
                <Button variant="outline" onClick={resetImportDialog}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleImport}
                  disabled={!importPreview || isImporting}
                  data-testid="button-confirm-import"
                >
                  {isImporting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Importing...</>
                  ) : (
                    <><Upload className="w-4 h-4 mr-2" /> Import {importPreview?.totalRows || 0} Leads</>
                  )}
                </Button>
              </>
            ) : (
              <Button onClick={resetImportDialog} data-testid="button-close-import">
                Done
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaxDelinquentImporter 
        open={isTaxDelinquentImportOpen} 
        onOpenChange={setIsTaxDelinquentImportOpen} 
      />
    </PageShell>
  );
}

function LeadStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    new: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    contacting: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    negotiation: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    closed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
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
    resolver: zodResolver(leadFormSchema),
    defaultValues: {
      firstName: lead?.firstName || "",
      lastName: lead?.lastName || "",
      email: lead?.email || "",
      phone: lead?.phone || "",
      status: lead?.status || "new",
    }
  });

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
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="firstName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>First Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="John" data-testid="input-first-name" />
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
                <FormLabel>Last Name</FormLabel>
                <FormControl>
                  <Input {...field} placeholder="Doe" data-testid="input-last-name" />
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
                <Input {...field} placeholder="john@example.com" type="email" data-testid="input-email" />
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
                <Input {...field} placeholder="(555) 123-4567" data-testid="input-phone" />
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
          <Button type="submit" className="w-full" disabled={isPending} data-testid="button-submit-lead">
            {isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {lead ? "Saving..." : "Creating..."}
              </>
            ) : (
              lead ? "Save Changes" : "Create Lead"
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function LeadDetailDrawer({ lead, onClose, onEdit }: { lead: Lead; onClose: () => void; onEdit: () => void }) {
  const { data: teamMembers } = useTeamMembers();
  const { data: userPermissions } = useUserPermissions();
  const { mutate: updateLead } = useUpdateLead();
  const [isAssigning, setIsAssigning] = useState(false);

  const handleAssignmentChange = (userId: string) => {
    setIsAssigning(true);
    updateLead(
      { id: lead.id, data: { assignedTo: userId === "unassigned" ? null : userId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/leads'] });
          setIsAssigning(false);
        },
        onError: () => {
          setIsAssigning(false);
        },
      }
    );
  };

  const getAssigneeName = (userId: string | number | null | undefined) => {
    if (!userId) return "Unassigned";
    const userIdStr = String(userId);
    const member = teamMembers?.find(m => m.userId === userIdStr);
    return member?.displayName || member?.email || userIdStr;
  };

  const statusColors: Record<string, string> = {
    new: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    contacting: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    negotiation: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
    closed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
    dead: 'bg-muted text-muted-foreground',
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="fixed right-0 top-0 h-full w-full max-w-2xl bg-background shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
        data-testid="drawer-lead-detail"
      >
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={statusColors[lead.status] || statusColors.new}>
                  {lead.status}
                </Badge>
              </div>
              <h2 className="text-xl font-bold mt-2" data-testid="text-lead-name">
                {lead.firstName} {lead.lastName}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <Button size="icon" variant="ghost" onClick={onEdit} data-testid="button-edit-lead-drawer">
                <Edit className="w-5 h-5" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onClose} data-testid="button-close-lead-drawer">
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>

        <div className="p-6">
          <Tabs defaultValue="details" className="space-y-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="details" data-testid="tab-lead-details">
                <User className="w-4 h-4 mr-2" />
                Details
              </TabsTrigger>
              <TabsTrigger value="timeline" data-testid="tab-lead-timeline">
                <Clock className="w-4 h-4 mr-2" />
                Timeline
              </TabsTrigger>
            </TabsList>

            <TabsContent value="details" className="space-y-6">
              <Card className="glass-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <User className="w-4 h-4" /> Contact Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Name</p>
                      <p className="font-medium">{lead.firstName} {lead.lastName}</p>
                    </div>
                    {lead.email && (
                      <div>
                        <p className="text-muted-foreground">Email</p>
                        <p className="font-medium flex items-center gap-2">
                          <Mail className="w-3 h-3" /> {lead.email}
                        </p>
                      </div>
                    )}
                    {lead.phone && (
                      <div>
                        <p className="text-muted-foreground">Phone</p>
                        <p className="font-medium flex items-center gap-2">
                          <Phone className="w-3 h-3" /> {lead.phone}
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {(lead.address || lead.city || lead.state || lead.zip) && (
                <Card className="glass-panel">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MapPin className="w-4 h-4" /> Address
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-sm">
                      {lead.address && <p className="font-medium">{lead.address}</p>}
                      <p className="text-muted-foreground">
                        {[lead.city, lead.state, lead.zip].filter(Boolean).join(', ')}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              <SkipTracePanel lead={lead} />

              <Card className="glass-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Calendar className="w-4 h-4" /> Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Created</span>
                      <span>{lead.createdAt ? format(new Date(lead.createdAt), 'MMM d, yyyy') : 'N/A'}</span>
                    </div>
                    {lead.lastContactedAt && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Contacted</span>
                        <span>{format(new Date(lead.lastContactedAt), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                    {lead.source && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Source</span>
                        <span className="capitalize">{lead.source}</span>
                      </div>
                    )}
                    {lead.type && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Type</span>
                        <span className="capitalize">{lead.type}</span>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* TCPA Compliance Card */}
              <Card className="glass-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Shield className="w-4 h-4" /> TCPA Compliance
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Status</span>
                      <TcpaConsentBadge lead={lead} />
                    </div>
                    {lead.consentDate && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Consent Date</span>
                        <span>{format(new Date(lead.consentDate), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                    {lead.consentSource && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Consent Source</span>
                        <span className="capitalize">{lead.consentSource}</span>
                      </div>
                    )}
                    {lead.optOutDate && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Opt-out Date</span>
                        <span>{format(new Date(lead.optOutDate), 'MMM d, yyyy')}</span>
                      </div>
                    )}
                    {lead.optOutReason && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Opt-out Reason</span>
                        <span>{lead.optOutReason}</span>
                      </div>
                    )}
                    <div className="pt-2 border-t flex gap-2">
                      <TcpaConsentToggle lead={lead} />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Assignment Card */}
              <Card className="glass-panel">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="w-4 h-4" /> Assignment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">Assigned to</span>
                      {userPermissions?.permissions.canManageTeam ? (
                        <Select
                          value={lead.assignedTo ? String(lead.assignedTo) : "unassigned"}
                          onValueChange={handleAssignmentChange}
                          disabled={isAssigning}
                        >
                          <SelectTrigger 
                            className="w-[180px]"
                            data-testid="select-lead-assignee"
                          >
                            <SelectValue placeholder="Select assignee" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {teamMembers?.map((member) => (
                              <SelectItem key={member.userId} value={member.userId}>
                                {member.displayName || member.email || member.userId}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span 
                          className="text-sm font-medium"
                          data-testid="text-lead-assignee"
                        >
                          {getAssigneeName(lead.assignedTo)}
                        </span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {lead.notes && (
                <Card className="glass-panel">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <StickyNote className="w-4 h-4" /> Notes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">{lead.notes}</p>
                  </CardContent>
                </Card>
              )}

              <Card className="glass-panel">
                <CardContent className="pt-6">
                  <CustomFieldValuesEditor entityType="lead" entityId={lead.id} />
                </CardContent>
              </Card>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={onEdit}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit Lead
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="timeline" className="space-y-6">
              <ActivityTimeline entityType="lead" entityId={lead.id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
