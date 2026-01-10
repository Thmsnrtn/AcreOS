import { useState, useEffect } from "react";
import { 
  useDueDiligenceChecklist, 
  useUpdateDueDiligenceChecklist,
  useLookupFloodZone,
  useLookupWetlands,
  useLookupTax,
  useLookupSoilData,
  useLookupEnvironmental,
  useRequestAIDossier,
  useAIDossier,
} from "@/hooks/use-due-diligence";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  SkipForward,
  Search,
  Loader2,
  Leaf,
  DollarSign,
  Scale,
  Route,
  Zap,
  PlayCircle,
  Brain,
  FileSearch,
  MapPin,
  Building,
  Users,
  TrendingUp,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

interface DueDiligencePanelProps {
  propertyId: number;
}

type ItemStatus = "pending" | "passed" | "failed" | "warning" | "skipped";

interface ChecklistItem {
  id: string;
  category: string;
  name: string;
  status: ItemStatus;
  notes?: string;
  dataSource?: string;
  researchData?: any;
}

const statusIcons: Record<ItemStatus, { icon: typeof CheckCircle; className: string }> = {
  pending: { icon: Clock, className: "text-muted-foreground" },
  passed: { icon: CheckCircle, className: "text-green-600" },
  failed: { icon: XCircle, className: "text-red-600" },
  warning: { icon: AlertTriangle, className: "text-yellow-600" },
  skipped: { icon: SkipForward, className: "text-muted-foreground" },
};

const categoryIcons: Record<string, typeof Leaf> = {
  environmental: Leaf,
  taxes: DollarSign,
  legal: Scale,
  access: Route,
  utilities: Zap,
};

const categoryLabels: Record<string, string> = {
  environmental: "Environmental",
  taxes: "Taxes",
  legal: "Legal",
  access: "Access",
  utilities: "Utilities",
};

export function DueDiligencePanel({ propertyId }: DueDiligencePanelProps) {
  const { data: checklist, isLoading } = useDueDiligenceChecklist(propertyId);
  const { mutateAsync: updateChecklistAsync, isPending: isUpdating } = useUpdateDueDiligenceChecklist();
  const { mutateAsync: lookupFlood, isPending: isLookingUpFlood } = useLookupFloodZone();
  const { mutateAsync: lookupWetlands, isPending: isLookingUpWetlands } = useLookupWetlands();
  const { mutateAsync: lookupTax, isPending: isLookingUpTax } = useLookupTax();
  const { mutateAsync: lookupSoil, isPending: isLookingUpSoil } = useLookupSoilData();
  const { mutateAsync: lookupEnvironmental, isPending: isLookingUpEnvironmental } = useLookupEnvironmental();
  const { toast } = useToast();
  
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [runningAll, setRunningAll] = useState(false);
  
  const [dossierId, setDossierId] = useState<number | null>(null);
  const { mutateAsync: requestDossier, isPending: isRequestingDossier } = useRequestAIDossier();
  const [shouldPollDossier, setShouldPollDossier] = useState(false);
  
  const { data: dossier, isLoading: isDossierLoading, error: dossierError } = useAIDossier(dossierId, {
    enabled: !!dossierId,
    refetchInterval: shouldPollDossier ? 3000 : false,
  });
  
  useEffect(() => {
    if (dossier) {
      setShouldPollDossier(dossier.status === "running" || dossier.status === "queued");
    }
  }, [dossier]);

  const handleGenerateDossier = async () => {
    try {
      const result = await requestDossier(propertyId);
      if (result.success && result.dossierId) {
        setDossierId(result.dossierId);
        setShouldPollDossier(true);
        toast({
          title: "AI Dossier Requested",
          description: "Generating comprehensive due diligence report...",
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Failed to generate dossier",
        description: error.message || "Please try again later.",
      });
    }
  };

  const getRecommendationBadge = (recommendation: string | null | undefined) => {
    if (!recommendation) return null;
    const variants: Record<string, { variant: "default" | "destructive" | "secondary" | "outline"; label: string }> = {
      strong_buy: { variant: "default", label: "Strong Buy" },
      buy: { variant: "default", label: "Buy" },
      hold: { variant: "secondary", label: "Hold" },
      pass: { variant: "outline", label: "Pass" },
      avoid: { variant: "destructive", label: "Avoid" },
    };
    const config = variants[recommendation] || { variant: "secondary" as const, label: recommendation };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  if (isLoading) {
    return (
      <Card data-testid="due-diligence-panel">
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!checklist) return null;

  const items = (checklist.items || []) as ChecklistItem[];
  const itemsByCategory = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, ChecklistItem[]>);

  const handleStatusChange = (itemId: string, newStatus: ItemStatus) => {
    const updatedItems = items.map(item =>
      item.id === itemId ? { ...item, status: newStatus } : item
    );
    updateChecklistAsync({ propertyId, updates: { items: updatedItems } });
  };

  const handleNotesChange = (itemId: string, notes: string) => {
    setEditingNotes(prev => ({ ...prev, [itemId]: notes }));
  };

  const handleNotesSave = (itemId: string) => {
    const updatedItems = items.map(item =>
      item.id === itemId ? { ...item, notes: editingNotes[itemId] ?? item.notes } : item
    );
    updateChecklistAsync({ propertyId, updates: { items: updatedItems } });
    setEditingNotes(prev => {
      const { [itemId]: _, ...rest } = prev;
      return rest;
    });
  };

  const runLookup = async (type: "flood" | "wetlands" | "tax" | "soil" | "environmental") => {
    const typeLabels: Record<typeof type, string> = {
      flood: "Flood Zone",
      wetlands: "Wetlands",
      soil: "Soil",
      environmental: "EPA Sites",
      tax: "Tax History",
    };
    
    try {
      let result: any;
      let itemId: string;
      let newStatus: ItemStatus;
      let notes: string;
      
      if (type === "flood") {
        result = await lookupFlood(propertyId);
        itemId = "env-flood";
        newStatus = result.riskLevel === "low" ? "passed" : result.riskLevel === "high" ? "failed" : "warning";
        notes = result.zone || "Flood zone data retrieved";
      } else if (type === "wetlands") {
        result = await lookupWetlands(propertyId);
        itemId = "env-wetlands";
        newStatus = result.hasWetlands ? "warning" : "passed";
        notes = result.hasWetlands ? `Wetlands present (${result.percentage}%)` : "No wetlands detected";
      } else if (type === "soil") {
        result = await lookupSoil(propertyId);
        itemId = "env-soil";
        newStatus = result.suitability === "good" ? "passed" : result.suitability === "poor" ? "warning" : "pending";
        notes = `Soil: ${result.soilType || "Unknown"}. Drainage: ${result.drainage || "Unknown"}. Suitability: ${result.suitability || "Unknown"}`;
      } else if (type === "environmental") {
        result = await lookupEnvironmental(propertyId);
        itemId = "env-epa";
        newStatus = result.riskLevel === "low" ? "passed" : result.riskLevel === "high" ? "failed" : "warning";
        notes = result.superfundSites?.length > 0 
          ? `${result.superfundSites.length} EPA sites nearby (${result.nearestSiteDistance} mi)` 
          : "No EPA Superfund sites nearby";
      } else {
        result = await lookupTax(propertyId);
        itemId = "tax-history";
        newStatus = result.backTaxes > 0 ? "failed" : "passed";
        notes = `Annual tax: $${result.annualTax}. Last paid: ${result.lastPaidDate}`;
        
        const taxBackId = "tax-back";
        const taxSaleId = "tax-sale";
        
        const updatedItems = items.map(item => {
          if (item.id === itemId) {
            return { ...item, status: newStatus, researchData: result, notes };
          }
          if (item.id === taxBackId) {
            return { ...item, status: result.backTaxes > 0 ? "failed" : "passed", notes: result.backTaxes > 0 ? `Back taxes: $${result.backTaxes}` : "No back taxes" };
          }
          if (item.id === taxSaleId) {
            return { ...item, status: result.taxSaleStatus === "none" ? "passed" : "failed", notes: `Status: ${result.taxSaleStatus}` };
          }
          return item;
        });
        await updateChecklistAsync({ propertyId, updates: { items: updatedItems } });
        return;
      }
      
      const updatedItems = items.map(item =>
        item.id === itemId
          ? { ...item, status: newStatus, researchData: result, notes }
          : item
      );
      await updateChecklistAsync({ propertyId, updates: { items: updatedItems } });
    } catch (error: any) {
      console.error(`Lookup ${type} failed:`, error);
      toast({
        variant: "destructive",
        title: `${typeLabels[type]} lookup failed`,
        description: error.message || "Could not retrieve data. Please try again.",
      });
    }
  };

  const runAllLookups = async () => {
    setRunningAll(true);
    try {
      await Promise.all([
        runLookup("flood"),
        runLookup("wetlands"),
        runLookup("soil"),
        runLookup("environmental"),
        runLookup("tax"),
      ]);
    } finally {
      setRunningAll(false);
    }
  };

  const StatusButton = ({ status, itemId }: { status: ItemStatus; itemId: string }) => {
    const { icon: Icon, className } = statusIcons[status];
    return (
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0"
        onClick={() => {
          const statusOrder: ItemStatus[] = ["pending", "passed", "warning", "failed", "skipped"];
          const nextIndex = (statusOrder.indexOf(status) + 1) % statusOrder.length;
          handleStatusChange(itemId, statusOrder[nextIndex]);
        }}
        data-testid={`button-status-${itemId}`}
      >
        <Icon className={`w-5 h-5 ${className}`} />
      </Button>
    );
  };

  return (
    <Card data-testid="due-diligence-panel">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-lg">
            Due Diligence Checklist
            <Badge variant="outline" data-testid="text-progress-percent">
              {checklist.completedPercent}% Complete
            </Badge>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={runAllLookups}
            disabled={runningAll || isLookingUpFlood || isLookingUpWetlands || isLookingUpTax || isLookingUpSoil || isLookingUpEnvironmental}
            data-testid="button-run-all-lookups"
          >
            {runningAll ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <PlayCircle className="w-4 h-4 mr-2" />
            )}
            Run All Lookups
          </Button>
        </div>
        <Progress value={checklist.completedPercent || 0} className="h-2 mt-2" data-testid="progress-checklist" />
      </CardHeader>
      <CardContent className="space-y-6">
        <Card className="border-2 border-dashed" data-testid="ai-dossier-section">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="w-5 h-5 text-primary" />
              AI Dossier
            </CardTitle>
            <CardDescription>
              AI-powered comprehensive due diligence report that analyzes title, tax, environmental, zoning, access, market comps, and owner research.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!dossierId && !dossier && (
              <Button
                onClick={handleGenerateDossier}
                disabled={isRequestingDossier}
                className="w-full"
                data-testid="button-generate-dossier"
              >
                {isRequestingDossier ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Requesting...
                  </>
                ) : (
                  <>
                    <Brain className="w-4 h-4 mr-2" />
                    Generate AI Dossier
                  </>
                )}
              </Button>
            )}
            
            {dossierId && (isDossierLoading || dossier?.status === "queued" || dossier?.status === "running") && (
              <div className="flex flex-col items-center justify-center py-6 space-y-3" data-testid="dossier-loading">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  {dossier?.status === "running" ? "Generating comprehensive analysis..." : "Queued for processing..."}
                </p>
                {dossier?.agentsAssigned && (
                  <div className="flex flex-wrap gap-1 justify-center">
                    {Object.entries(dossier.agentsAssigned).map(([key, agent]) => (
                      <Badge 
                        key={key} 
                        variant={agent?.status === "completed" ? "default" : agent?.status === "running" ? "secondary" : "outline"}
                        className="text-xs"
                      >
                        {key.replace(/([A-Z])/g, ' $1').trim()}
                        {agent?.status === "running" && <Loader2 className="w-3 h-3 ml-1 animate-spin" />}
                        {agent?.status === "completed" && <CheckCircle className="w-3 h-3 ml-1" />}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            )}

            {dossierError && (
              <div className="text-center py-4" data-testid="dossier-error">
                <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-2" />
                <p className="text-sm text-destructive">Failed to load dossier</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={handleGenerateDossier}
                  className="mt-2"
                  data-testid="button-retry-dossier"
                >
                  Retry
                </Button>
              </div>
            )}

            {dossier?.status === "failed" && (
              <div className="text-center py-4" data-testid="dossier-failed">
                <XCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
                <p className="text-sm text-destructive">Dossier generation failed</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => { setDossierId(null); handleGenerateDossier(); }}
                  className="mt-2"
                  data-testid="button-regenerate-dossier"
                >
                  Try Again
                </Button>
              </div>
            )}

            {dossier?.status === "completed" && dossier.findings && (
              <div className="space-y-4" data-testid="dossier-results">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Recommendation:</span>
                    {getRecommendationBadge(dossier.recommendation)}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1">
                      <ShieldCheck className="w-4 h-4 text-green-600" />
                      <span>Investability: {dossier.investabilityScore}%</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <ShieldAlert className="w-4 h-4 text-yellow-600" />
                      <span>Risk: {dossier.riskScore}%</span>
                    </div>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-xs text-muted-foreground">Investability</span>
                    <Progress value={dossier.investabilityScore || 0} className="h-2" data-testid="progress-investability" />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Risk Level</span>
                    <Progress value={dossier.riskScore || 0} className="h-2" data-testid="progress-risk" />
                  </div>
                </div>

                {(dossier.greenFlags && dossier.greenFlags.length > 0) && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-green-600">Green Flags:</span>
                    <div className="flex flex-wrap gap-1">
                      {(dossier.greenFlags as string[]).map((flag, i) => (
                        <Badge key={i} variant="outline" className="text-xs text-green-600 border-green-200">
                          <CheckCircle className="w-3 h-3 mr-1" />
                          {flag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {(dossier.redFlags && dossier.redFlags.length > 0) && (
                  <div className="space-y-1">
                    <span className="text-xs font-medium text-red-600">Red Flags:</span>
                    <div className="flex flex-wrap gap-1">
                      {(dossier.redFlags as string[]).map((flag, i) => (
                        <Badge key={i} variant="outline" className="text-xs text-red-600 border-red-200">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          {flag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <Separator />

                <Accordion type="multiple" defaultValue={["title", "tax", "environmental"]} className="w-full">
                  {dossier.findings.titleStatus && (
                    <AccordionItem value="title" data-testid="dossier-title-section">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2">
                          <FileSearch className="w-4 h-4" />
                          <span>Title Search</span>
                          <Badge variant={dossier.findings.titleStatus.clear ? "default" : "destructive"} className="text-xs">
                            {dossier.findings.titleStatus.clear ? "Clear" : "Issues Found"}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 text-sm">
                          {dossier.findings.titleStatus.liens && dossier.findings.titleStatus.liens.length > 0 && (
                            <div>
                              <span className="font-medium">Liens:</span>
                              <ul className="list-disc list-inside text-muted-foreground">
                                {dossier.findings.titleStatus.liens.map((lien, i) => (
                                  <li key={i}>{lien}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {dossier.findings.titleStatus.encumbrances && dossier.findings.titleStatus.encumbrances.length > 0 && (
                            <div>
                              <span className="font-medium">Encumbrances:</span>
                              <ul className="list-disc list-inside text-muted-foreground">
                                {dossier.findings.titleStatus.encumbrances.map((enc, i) => (
                                  <li key={i}>{enc}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {(!dossier.findings.titleStatus.liens?.length && !dossier.findings.titleStatus.encumbrances?.length) && (
                            <p className="text-muted-foreground">No liens or encumbrances found. Title appears clear.</p>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {dossier.findings.taxStatus && (
                    <AccordionItem value="tax" data-testid="dossier-tax-section">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2">
                          <DollarSign className="w-4 h-4" />
                          <span>Tax Analysis</span>
                          <Badge variant={dossier.findings.taxStatus.current ? "default" : "destructive"} className="text-xs">
                            {dossier.findings.taxStatus.current ? "Current" : "Delinquent"}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 text-sm">
                          {dossier.findings.taxStatus.amountDue !== undefined && dossier.findings.taxStatus.amountDue > 0 && (
                            <p><span className="font-medium">Amount Due:</span> ${dossier.findings.taxStatus.amountDue.toLocaleString()}</p>
                          )}
                          {dossier.findings.taxStatus.yearsDelinquent !== undefined && dossier.findings.taxStatus.yearsDelinquent > 0 && (
                            <p><span className="font-medium">Years Delinquent:</span> {dossier.findings.taxStatus.yearsDelinquent}</p>
                          )}
                          {dossier.findings.taxStatus.specialAssessments && dossier.findings.taxStatus.specialAssessments.length > 0 && (
                            <div>
                              <span className="font-medium">Special Assessments:</span>
                              <ul className="list-disc list-inside text-muted-foreground">
                                {dossier.findings.taxStatus.specialAssessments.map((assessment, i) => (
                                  <li key={i}>{assessment}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {dossier.findings.taxStatus.current && !dossier.findings.taxStatus.amountDue && (
                            <p className="text-muted-foreground">Taxes are current with no outstanding balance.</p>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {dossier.findings.environmental && (
                    <AccordionItem value="environmental" data-testid="dossier-environmental-section">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2">
                          <Leaf className="w-4 h-4" />
                          <span>Environmental</span>
                          <Badge variant={dossier.findings.environmental.clean ? "default" : "secondary"} className="text-xs">
                            {dossier.findings.environmental.clean ? "Clean" : "Concerns"}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 text-sm">
                          {dossier.findings.environmental.wetlands && (
                            <p><span className="font-medium">Wetlands:</span> Present on property</p>
                          )}
                          {dossier.findings.environmental.floodZone && (
                            <p><span className="font-medium">Flood Zone:</span> {dossier.findings.environmental.floodZone}</p>
                          )}
                          {dossier.findings.environmental.concerns && dossier.findings.environmental.concerns.length > 0 && (
                            <div>
                              <span className="font-medium">Concerns:</span>
                              <ul className="list-disc list-inside text-muted-foreground">
                                {dossier.findings.environmental.concerns.map((concern, i) => (
                                  <li key={i}>{concern}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {dossier.findings.environmental.clean && !dossier.findings.environmental.wetlands && (
                            <p className="text-muted-foreground">No environmental concerns identified.</p>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {dossier.findings.zoning && (
                    <AccordionItem value="zoning" data-testid="dossier-zoning-section">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2">
                          <Building className="w-4 h-4" />
                          <span>Zoning</span>
                          <Badge variant="outline" className="text-xs">{dossier.findings.zoning.current}</Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 text-sm">
                          {dossier.findings.zoning.allowedUses && dossier.findings.zoning.allowedUses.length > 0 && (
                            <div>
                              <span className="font-medium">Allowed Uses:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {dossier.findings.zoning.allowedUses.map((use, i) => (
                                  <Badge key={i} variant="secondary" className="text-xs">{use}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {dossier.findings.zoning.restrictions && dossier.findings.zoning.restrictions.length > 0 && (
                            <div>
                              <span className="font-medium">Restrictions:</span>
                              <ul className="list-disc list-inside text-muted-foreground">
                                {dossier.findings.zoning.restrictions.map((restriction, i) => (
                                  <li key={i}>{restriction}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {dossier.findings.access && (
                    <AccordionItem value="access" data-testid="dossier-access-section">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2">
                          <Route className="w-4 h-4" />
                          <span>Access</span>
                          <Badge variant={dossier.findings.access.legal ? "default" : "destructive"} className="text-xs">
                            {dossier.findings.access.legal ? "Legal Access" : "Access Issues"}
                          </Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 text-sm">
                          <p><span className="font-medium">Road Type:</span> {dossier.findings.access.type}</p>
                          {dossier.findings.access.roadMaintenance && (
                            <p><span className="font-medium">Maintenance:</span> {dossier.findings.access.roadMaintenance}</p>
                          )}
                          {dossier.findings.access.easements && dossier.findings.access.easements.length > 0 && (
                            <div>
                              <span className="font-medium">Easements:</span>
                              <ul className="list-disc list-inside text-muted-foreground">
                                {dossier.findings.access.easements.map((easement, i) => (
                                  <li key={i}>{easement}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {dossier.findings.comps && (
                    <AccordionItem value="comps" data-testid="dossier-comps-section">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4" />
                          <span>Market Comps</span>
                          {dossier.findings.comps.trend && (
                            <Badge variant="outline" className="text-xs">{dossier.findings.comps.trend}</Badge>
                          )}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 text-sm">
                          {dossier.findings.comps.medianPrice !== undefined && (
                            <p><span className="font-medium">Median Price:</span> ${dossier.findings.comps.medianPrice.toLocaleString()}</p>
                          )}
                          {dossier.findings.comps.pricePerAcre !== undefined && (
                            <p><span className="font-medium">Price per Acre:</span> ${dossier.findings.comps.pricePerAcre.toLocaleString()}</p>
                          )}
                          {dossier.findings.comps.salesCount !== undefined && (
                            <p><span className="font-medium">Recent Sales:</span> {dossier.findings.comps.salesCount} comparable sales found</p>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}

                  {dossier.findings.owner && (
                    <AccordionItem value="owner" data-testid="dossier-owner-section">
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4" />
                          <span>Owner Research</span>
                          <Badge variant="outline" className="text-xs">{dossier.findings.owner.type}</Badge>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2 text-sm">
                          <p><span className="font-medium">Owner:</span> {dossier.findings.owner.name}</p>
                          <p><span className="font-medium">Type:</span> {dossier.findings.owner.type}</p>
                          {dossier.findings.owner.motivationSignals && dossier.findings.owner.motivationSignals.length > 0 && (
                            <div>
                              <span className="font-medium">Motivation Indicators:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {dossier.findings.owner.motivationSignals.map((signal, i) => (
                                  <Badge key={i} variant="secondary" className="text-xs">{signal}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  )}
                </Accordion>

                {dossier.executiveSummary && (
                  <div className="mt-4 p-3 bg-muted rounded-md">
                    <span className="text-xs font-medium">Executive Summary:</span>
                    <p className="text-sm text-muted-foreground mt-1">{dossier.executiveSummary}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Separator />

        <Accordion type="multiple" defaultValue={Object.keys(categoryLabels)} className="w-full">
          {Object.entries(categoryLabels).map(([categoryKey, categoryLabel]) => {
            const categoryItems = itemsByCategory[categoryKey] || [];
            const CategoryIcon = categoryIcons[categoryKey] || Leaf;
            const completedInCategory = categoryItems.filter(i => i.status === "passed" || i.status === "failed" || i.status === "skipped").length;
            
            return (
              <AccordionItem key={categoryKey} value={categoryKey} data-testid={`accordion-${categoryKey}`}>
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center gap-2">
                    <CategoryIcon className="w-4 h-4" />
                    <span>{categoryLabel}</span>
                    <Badge variant="secondary" className="text-xs">
                      {completedInCategory}/{categoryItems.length}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3 pt-2">
                    {categoryItems.map((item) => (
                      <div
                        key={item.id}
                        className="border rounded-md p-3 space-y-2"
                        data-testid={`checklist-item-${item.id}`}
                      >
                        <div className="flex items-start gap-2">
                          <StatusButton status={item.status} itemId={item.id} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="font-medium">{item.name}</span>
                              {item.dataSource && (
                                <span className="text-xs text-muted-foreground">
                                  Source: {item.dataSource}
                                </span>
                              )}
                            </div>
                            {item.notes && (
                              <p className="text-sm text-muted-foreground mt-1">{item.notes}</p>
                            )}
                          </div>
                          {(item.id === "env-flood" || item.id === "env-wetlands" || item.id === "env-soil" || item.id === "env-epa" || item.id === "tax-history") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                if (item.id === "env-flood") runLookup("flood");
                                else if (item.id === "env-wetlands") runLookup("wetlands");
                                else if (item.id === "env-soil") runLookup("soil");
                                else if (item.id === "env-epa") runLookup("environmental");
                                else runLookup("tax");
                              }}
                              disabled={
                                (item.id === "env-flood" && isLookingUpFlood) ||
                                (item.id === "env-wetlands" && isLookingUpWetlands) ||
                                (item.id === "env-soil" && isLookingUpSoil) ||
                                (item.id === "env-epa" && isLookingUpEnvironmental) ||
                                (item.id === "tax-history" && isLookingUpTax)
                              }
                              data-testid={`button-lookup-${item.id}`}
                            >
                              {((item.id === "env-flood" && isLookingUpFlood) ||
                                (item.id === "env-wetlands" && isLookingUpWetlands) ||
                                (item.id === "env-soil" && isLookingUpSoil) ||
                                (item.id === "env-epa" && isLookingUpEnvironmental) ||
                                (item.id === "tax-history" && isLookingUpTax)) ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Search className="w-3 h-3" />
                              )}
                            </Button>
                          )}
                        </div>
                        <div className="pl-9">
                          <Textarea
                            placeholder="Add notes..."
                            className="min-h-[60px] text-sm"
                            value={editingNotes[item.id] ?? item.notes ?? ""}
                            onChange={(e) => handleNotesChange(item.id, e.target.value)}
                            onBlur={() => handleNotesSave(item.id)}
                            data-testid={`textarea-notes-${item.id}`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </CardContent>
    </Card>
  );
}
