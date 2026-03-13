import { useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  ClipboardCheck,
  CheckCircle,
  XCircle,
  MinusCircle,
  AlertTriangle,
  Info,
  AlertOctagon,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChecklistStatus = "pass" | "fail" | "na" | "unchecked";
export type ChecklistSeverity = "info" | "warning" | "critical";

export interface ChecklistItem {
  id: string;
  label: string;
  status: ChecklistStatus;
  notes: string;
  severity: ChecklistSeverity;
  checked: boolean;
}

export interface ChecklistCategory {
  id: string;
  label: string;
  items: ChecklistItem[];
}

export interface ChecklistResults {
  categories: ChecklistCategory[];
  overallScore: number;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Default categories & items
// ---------------------------------------------------------------------------

const DEFAULT_CATEGORIES: ChecklistCategory[] = [
  {
    id: "access_roads",
    label: "Access & Roads",
    items: [
      { id: "ar_1", label: "Legal road access confirmed", status: "unchecked", notes: "", severity: "critical", checked: false },
      { id: "ar_2", label: "Road condition (paved/gravel/dirt)", status: "unchecked", notes: "", severity: "info", checked: false },
      { id: "ar_3", label: "Easement recorded and accessible", status: "unchecked", notes: "", severity: "warning", checked: false },
      { id: "ar_4", label: "Driveway or entrance cut feasible", status: "unchecked", notes: "", severity: "info", checked: false },
    ],
  },
  {
    id: "utilities",
    label: "Utilities",
    items: [
      { id: "ut_1", label: "Electric available at road", status: "unchecked", notes: "", severity: "critical", checked: false },
      { id: "ut_2", label: "Water source (well/municipal/none)", status: "unchecked", notes: "", severity: "critical", checked: false },
      { id: "ut_3", label: "Sewer/septic feasibility", status: "unchecked", notes: "", severity: "warning", checked: false },
      { id: "ut_4", label: "Cell/internet signal strength", status: "unchecked", notes: "", severity: "info", checked: false },
      { id: "ut_5", label: "Gas line proximity", status: "unchecked", notes: "", severity: "info", checked: false },
    ],
  },
  {
    id: "terrain_vegetation",
    label: "Terrain & Vegetation",
    items: [
      { id: "tv_1", label: "Topography suitable for building", status: "unchecked", notes: "", severity: "warning", checked: false },
      { id: "tv_2", label: "No significant erosion issues", status: "unchecked", notes: "", severity: "warning", checked: false },
      { id: "tv_3", label: "Vegetation manageable (no dense brush)", status: "unchecked", notes: "", severity: "info", checked: false },
      { id: "tv_4", label: "Drainage patterns acceptable", status: "unchecked", notes: "", severity: "warning", checked: false },
    ],
  },
  {
    id: "boundaries_encroachments",
    label: "Boundaries & Encroachments",
    items: [
      { id: "be_1", label: "Corners/markers found", status: "unchecked", notes: "", severity: "warning", checked: false },
      { id: "be_2", label: "No encroachments from neighbors", status: "unchecked", notes: "", severity: "critical", checked: false },
      { id: "be_3", label: "Fencing matches legal boundary", status: "unchecked", notes: "", severity: "warning", checked: false },
      { id: "be_4", label: "No unauthorized structures on parcel", status: "unchecked", notes: "", severity: "critical", checked: false },
    ],
  },
  {
    id: "environmental",
    label: "Environmental",
    items: [
      { id: "en_1", label: "No visible contamination/dumping", status: "unchecked", notes: "", severity: "critical", checked: false },
      { id: "en_2", label: "Not in flood zone (visual check)", status: "unchecked", notes: "", severity: "critical", checked: false },
      { id: "en_3", label: "No wetlands/water features restricting use", status: "unchecked", notes: "", severity: "warning", checked: false },
      { id: "en_4", label: "No endangered species habitat indicators", status: "unchecked", notes: "", severity: "warning", checked: false },
    ],
  },
  {
    id: "structures",
    label: "Structures",
    items: [
      { id: "st_1", label: "Existing structures condition", status: "unchecked", notes: "", severity: "info", checked: false },
      { id: "st_2", label: "No condemned or hazardous buildings", status: "unchecked", notes: "", severity: "critical", checked: false },
      { id: "st_3", label: "Well/septic system condition (if exists)", status: "unchecked", notes: "", severity: "warning", checked: false },
    ],
  },
  {
    id: "general",
    label: "General Observations",
    items: [
      { id: "ge_1", label: "Neighborhood condition acceptable", status: "unchecked", notes: "", severity: "info", checked: false },
      { id: "ge_2", label: "No major noise/odor issues", status: "unchecked", notes: "", severity: "info", checked: false },
      { id: "ge_3", label: "Property matches listing description", status: "unchecked", notes: "", severity: "warning", checked: false },
      { id: "ge_4", label: "Overall impression positive", status: "unchecked", notes: "", severity: "info", checked: false },
      { id: "ge_5", label: "Recommend for acquisition", status: "unchecked", notes: "", severity: "info", checked: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeScore(categories: ChecklistCategory[]): number {
  let passing = 0;
  let total = 0;
  for (const cat of categories) {
    for (const item of cat.items) {
      if (item.checked) {
        total++;
        if (item.status === "pass" || item.status === "na") {
          passing++;
        }
      }
    }
  }
  return total === 0 ? 0 : Math.round((passing / total) * 100);
}

const STATUS_ICONS: Record<ChecklistStatus, React.ReactNode> = {
  pass: <CheckCircle className="w-4 h-4 text-emerald-400" />,
  fail: <XCircle className="w-4 h-4 text-red-400" />,
  na: <MinusCircle className="w-4 h-4 text-gray-500" />,
  unchecked: <MinusCircle className="w-4 h-4 text-gray-700" />,
};

const SEVERITY_BADGES: Record<ChecklistSeverity, { label: string; className: string; icon: React.ReactNode }> = {
  info: { label: "Info", className: "bg-blue-900/40 text-blue-300 border-blue-800", icon: <Info className="w-3 h-3" /> },
  warning: { label: "Warning", className: "bg-yellow-900/40 text-yellow-300 border-yellow-800", icon: <AlertTriangle className="w-3 h-3" /> },
  critical: { label: "Critical", className: "bg-red-900/40 text-red-300 border-red-800", icon: <AlertOctagon className="w-3 h-3" /> },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface InspectionChecklistProps {
  onComplete: (results: ChecklistResults) => void;
  initialData?: ChecklistResults;
}

export function InspectionChecklist({ onComplete, initialData }: InspectionChecklistProps) {
  const [categories, setCategories] = useState<ChecklistCategory[]>(
    initialData?.categories ?? DEFAULT_CATEGORIES.map((c) => ({
      ...c,
      items: c.items.map((item) => ({ ...item })),
    }))
  );

  const overallScore = useMemo(() => computeScore(categories), [categories]);

  const updateItem = useCallback(
    (categoryId: string, itemId: string, updates: Partial<ChecklistItem>) => {
      setCategories((prev) =>
        prev.map((cat) =>
          cat.id === categoryId
            ? {
                ...cat,
                items: cat.items.map((item) =>
                  item.id === itemId ? { ...item, ...updates } : item
                ),
              }
            : cat
        )
      );
    },
    []
  );

  const cycleStatus = useCallback(
    (categoryId: string, itemId: string, currentStatus: ChecklistStatus) => {
      const next: Record<ChecklistStatus, ChecklistStatus> = {
        unchecked: "pass",
        pass: "fail",
        fail: "na",
        na: "unchecked",
      };
      const nextStatus = next[currentStatus];
      updateItem(categoryId, itemId, {
        status: nextStatus,
        checked: nextStatus !== "unchecked",
      });
    },
    [updateItem]
  );

  const handleComplete = () => {
    const results: ChecklistResults = {
      categories,
      overallScore,
      completedAt: new Date().toISOString(),
    };
    onComplete(results);
  };

  const handleExportJSON = () => {
    const results: ChecklistResults = {
      categories,
      overallScore,
      completedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inspection-checklist-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Count checked items per category
  const getCategoryProgress = (cat: ChecklistCategory) => {
    const checked = cat.items.filter((i) => i.checked).length;
    return { checked, total: cat.items.length };
  };

  return (
    <Card className="bg-gray-900 border-gray-800">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <ClipboardCheck className="w-4 h-4 text-emerald-400" />
            Property Inspection Checklist
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge
              className={cn(
                "text-xs",
                overallScore >= 80
                  ? "bg-emerald-900/50 text-emerald-300"
                  : overallScore >= 50
                  ? "bg-yellow-900/50 text-yellow-300"
                  : "bg-gray-800 text-gray-400"
              )}
            >
              {overallScore}% passing
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <Accordion type="multiple" className="space-y-1">
          {categories.map((cat) => {
            const progress = getCategoryProgress(cat);
            return (
              <AccordionItem
                key={cat.id}
                value={cat.id}
                className="border border-gray-800 rounded-lg overflow-hidden"
              >
                <AccordionTrigger className="px-3 py-2 hover:bg-gray-800/50 text-sm [&[data-state=open]>svg]:rotate-180">
                  <div className="flex items-center gap-2 flex-1 text-left">
                    <span className="font-medium">{cat.label}</span>
                    <Badge variant="secondary" className="text-[10px] bg-gray-800 text-gray-400">
                      {progress.checked}/{progress.total}
                    </Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-3 pb-3 space-y-2">
                  {cat.items.map((item) => {
                    const sev = SEVERITY_BADGES[item.severity];
                    return (
                      <div
                        key={item.id}
                        className="border border-gray-800 rounded-md p-2 space-y-2"
                      >
                        <div className="flex items-start gap-2">
                          <Checkbox
                            checked={item.checked}
                            onCheckedChange={(checked) =>
                              updateItem(cat.id, item.id, {
                                checked: !!checked,
                                status: checked ? "pass" : "unchecked",
                              })
                            }
                            className="mt-0.5 border-gray-600 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium">{item.label}</span>
                              <Badge
                                variant="outline"
                                className={cn("text-[9px] px-1 py-0 h-4", sev.className)}
                              >
                                {sev.icon}
                                <span className="ml-0.5">{sev.label}</span>
                              </Badge>
                            </div>
                          </div>
                          <button
                            onClick={() => cycleStatus(cat.id, item.id, item.status)}
                            className="shrink-0 p-0.5 rounded hover:bg-gray-800 transition-colors"
                            title={`Status: ${item.status} (click to cycle)`}
                          >
                            {STATUS_ICONS[item.status]}
                          </button>
                        </div>
                        {item.checked && (
                          <Textarea
                            value={item.notes}
                            onChange={(e) =>
                              updateItem(cat.id, item.id, { notes: e.target.value })
                            }
                            placeholder="Add notes..."
                            className="bg-gray-800 border-gray-700 text-white text-xs h-14 resize-none"
                          />
                        )}
                      </div>
                    );
                  })}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportJSON}
            className="flex-1 border-gray-700 text-gray-400"
          >
            <Download className="w-3 h-3 mr-1" />
            Export JSON
          </Button>
          <Button
            size="sm"
            onClick={handleComplete}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
          >
            <ClipboardCheck className="w-3 h-3 mr-1" />
            Complete Inspection
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
