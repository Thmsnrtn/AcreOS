import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MapPin,
  DollarSign,
  User,
  Building2,
  FileWarning,
  ArrowRight,
} from "lucide-react";
import type { Lead, Property } from "@shared/schema";

interface ValidationIssue {
  leadId: number;
  leadName: string;
  type: "error" | "warning";
  category: "address" | "value" | "property" | "contact";
  message: string;
}

interface PreflightResult {
  totalLeads: number;
  validLeads: number;
  leadsWithWarnings: number;
  leadsWithErrors: number;
  issues: ValidationIssue[];
  readyToSend: number;
}

interface OfferPreflightChecklistProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedLeadIds: number[];
  leads: Lead[];
  propertyMap: Map<number, Property>;
  onProceed: () => void;
  onRemoveLeads: (leadIds: number[]) => void;
}

export function OfferPreflightChecklist({
  open,
  onOpenChange,
  selectedLeadIds,
  leads,
  propertyMap,
  onProceed,
  onRemoveLeads,
}: OfferPreflightChecklistProps) {
  const preflightResult = useMemo((): PreflightResult => {
    const issues: ValidationIssue[] = [];
    let validLeads = 0;
    let leadsWithWarnings = 0;
    let leadsWithErrors = 0;

    const selectedLeads = leads.filter((l) => selectedLeadIds.includes(l.id));

    selectedLeads.forEach((lead) => {
      const leadName = `${lead.firstName} ${lead.lastName}`;
      const property = propertyMap.get(lead.id);
      let hasError = false;
      let hasWarning = false;

      // Check for mailing address
      if (!lead.address || lead.address.trim() === "") {
        issues.push({
          leadId: lead.id,
          leadName,
          type: "error",
          category: "address",
          message: "Missing mailing address - offer cannot be sent via direct mail",
        });
        hasError = true;
      } else if (!lead.city || !lead.state || !lead.zip) {
        issues.push({
          leadId: lead.id,
          leadName,
          type: "warning",
          category: "address",
          message: "Incomplete address (missing city, state, or ZIP)",
        });
        hasWarning = true;
      }

      // Check for associated property
      if (!property) {
        issues.push({
          leadId: lead.id,
          leadName,
          type: "warning",
          category: "property",
          message: "No property linked - offer amount will be based on default calculations",
        });
        hasWarning = true;
      } else {
        // Check for assessed value
        if (!property.assessedValue || Number(property.assessedValue) <= 0) {
          issues.push({
            leadId: lead.id,
            leadName,
            type: "error",
            category: "value",
            message: "Missing assessed value - cannot calculate offer percentage",
          });
          hasError = true;
        }

        // Check for property address if different from lead address
        if (!property.address && !lead.address) {
          issues.push({
            leadId: lead.id,
            leadName,
            type: "warning",
            category: "property",
            message: "No property address available for letter personalization",
          });
          hasWarning = true;
        }
      }

      // Check for contact information (optional but helpful)
      if (!lead.phone && !lead.email) {
        issues.push({
          leadId: lead.id,
          leadName,
          type: "warning",
          category: "contact",
          message: "No phone or email - follow-up options limited",
        });
        hasWarning = true;
      }

      if (hasError) {
        leadsWithErrors++;
      } else if (hasWarning) {
        leadsWithWarnings++;
      } else {
        validLeads++;
      }
    });

    return {
      totalLeads: selectedLeadIds.length,
      validLeads,
      leadsWithWarnings,
      leadsWithErrors,
      issues,
      readyToSend: validLeads + leadsWithWarnings,
    };
  }, [selectedLeadIds, leads, propertyMap]);

  const errorLeadIds = useMemo(() => {
    return [
      ...new Set(
        preflightResult.issues
          .filter((i) => i.type === "error")
          .map((i) => i.leadId)
      ),
    ];
  }, [preflightResult.issues]);

  const overallScore = useMemo(() => {
    if (preflightResult.totalLeads === 0) return 0;
    return Math.round(
      ((preflightResult.validLeads +
        preflightResult.leadsWithWarnings * 0.7) /
        preflightResult.totalLeads) *
        100
    );
  }, [preflightResult]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    return "text-red-600";
  };

  const getCategoryIcon = (category: ValidationIssue["category"]) => {
    switch (category) {
      case "address":
        return <MapPin className="w-4 h-4" />;
      case "value":
        return <DollarSign className="w-4 h-4" />;
      case "property":
        return <Building2 className="w-4 h-4" />;
      case "contact":
        return <User className="w-4 h-4" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh]" data-testid="preflight-checklist-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileWarning className="w-5 h-5" />
            Offer Preflight Checklist
          </DialogTitle>
          <DialogDescription>
            Review selected leads before generating batch offers. Resolve critical issues to avoid sending incomplete offers.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="p-3">
              <div className="text-2xl font-bold text-center" data-testid="stat-total">
                {preflightResult.totalLeads}
              </div>
              <div className="text-xs text-muted-foreground text-center">Total Selected</div>
            </Card>
            <Card className="p-3">
              <div className="text-2xl font-bold text-center text-green-600" data-testid="stat-valid">
                {preflightResult.validLeads}
              </div>
              <div className="text-xs text-muted-foreground text-center">Ready</div>
            </Card>
            <Card className="p-3">
              <div className="text-2xl font-bold text-center text-yellow-600" data-testid="stat-warnings">
                {preflightResult.leadsWithWarnings}
              </div>
              <div className="text-xs text-muted-foreground text-center">Warnings</div>
            </Card>
            <Card className="p-3">
              <div className="text-2xl font-bold text-center text-red-600" data-testid="stat-errors">
                {preflightResult.leadsWithErrors}
              </div>
              <div className="text-xs text-muted-foreground text-center">Errors</div>
            </Card>
          </div>

          {/* Readiness Score */}
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Batch Readiness</span>
                <span className={`text-lg font-bold ${getScoreColor(overallScore)}`} data-testid="readiness-score">
                  {overallScore}%
                </span>
              </div>
              <Progress value={overallScore} className="h-2" />
              <p className="text-xs text-muted-foreground mt-2">
                {preflightResult.readyToSend} of {preflightResult.totalLeads} leads can be included in this batch
              </p>
            </CardContent>
          </Card>

          {/* Issues List */}
          {preflightResult.issues.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Issues Found</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-48">
                  <div className="space-y-2">
                    {preflightResult.issues.map((issue, index) => (
                      <div
                        key={`${issue.leadId}-${issue.category}-${index}`}
                        className={`flex items-start gap-3 p-2 rounded-md ${
                          issue.type === "error"
                            ? "bg-red-50 dark:bg-red-950/20"
                            : "bg-yellow-50 dark:bg-yellow-950/20"
                        }`}
                        data-testid={`issue-${issue.leadId}-${issue.category}`}
                      >
                        <div className={issue.type === "error" ? "text-red-500" : "text-yellow-500"}>
                          {issue.type === "error" ? (
                            <XCircle className="w-4 h-4 mt-0.5" />
                          ) : (
                            <AlertTriangle className="w-4 h-4 mt-0.5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{issue.leadName}</span>
                            <Badge variant="outline" className="text-xs">
                              {getCategoryIcon(issue.category)}
                              <span className="ml-1 capitalize">{issue.category}</span>
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">{issue.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          {/* All Clear Message */}
          {preflightResult.issues.length === 0 && (
            <Card className="border-green-200 dark:border-green-800">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3 text-green-600">
                  <CheckCircle2 className="w-8 h-8" />
                  <div>
                    <p className="font-medium">All checks passed!</p>
                    <p className="text-sm text-muted-foreground">
                      All {preflightResult.totalLeads} leads are ready for batch offer generation.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <Separator />

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {errorLeadIds.length > 0 && (
            <Button
              variant="outline"
              onClick={() => onRemoveLeads(errorLeadIds)}
              className="w-full sm:w-auto"
              data-testid="button-remove-error-leads"
            >
              Remove {errorLeadIds.length} Invalid Lead{errorLeadIds.length > 1 ? "s" : ""}
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-testid="button-cancel-preflight"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              onProceed();
            }}
            disabled={preflightResult.readyToSend === 0}
            data-testid="button-proceed-preflight"
          >
            Generate {preflightResult.readyToSend} Offers
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
