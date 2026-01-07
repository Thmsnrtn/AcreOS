import { useState } from "react";
import { 
  useDueDiligenceChecklist, 
  useUpdateDueDiligenceChecklist,
  useLookupFloodZone,
  useLookupWetlands,
  useLookupTax,
  useLookupSoilData,
  useLookupEnvironmental
} from "@/hooks/use-due-diligence";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
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
      <CardContent>
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
