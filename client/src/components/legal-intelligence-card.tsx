import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { usd } from "@/lib/format";
import {
  AlertTriangle,
  Users,
  FileWarning,
  Scale,
  Shield,
} from "lucide-react";

interface LegalIntelligenceCardProps {
  propertyId: number;
  /** Years the property has been held */
  yearsHeld?: number;
  /** Whether this view involves commission-related data */
  showRespaContext?: boolean;
}

interface LegalIntelligenceData {
  adversePossession?: {
    stateYears: number; // Adverse possession period for this state
    atRisk: boolean;
    yearsHeld: number;
  };
  partition?: {
    multipleOwners: boolean;
    ownerCount: number;
    partitionRisk: string; // "low" | "medium" | "high"
  };
  taxLien?: {
    taxDelinquent: boolean;
    redemptionMonths: number;
    delinquentAmount?: number;
  };
}

export function LegalIntelligenceCard({
  propertyId,
  yearsHeld,
  showRespaContext = false,
}: LegalIntelligenceCardProps) {
  const { data, isLoading, error } = useQuery<LegalIntelligenceData>({
    queryKey: [`/api/legal/property/${propertyId}`],
    staleTime: 10 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card role="status" aria-busy="true" aria-label="Loading legal intelligence">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <span className="sr-only">Loading…</span>
        </CardContent>
      </Card>
    );
  }

  // Don't render anything if there's an error or no relevant data
  if (error || !data) return null;

  const hasAdversePossessionWarning =
    data.adversePossession &&
    yearsHeld != null &&
    data.adversePossession.stateYears > 0 &&
    yearsHeld > data.adversePossession.stateYears * 0.5;

  const hasPartitionRisk =
    data.partition?.multipleOwners && (data.partition.ownerCount ?? 0) > 1;

  const hasTaxLienInfo = data.taxLien?.taxDelinquent;

  // If no sections are relevant, don't render the card
  if (!hasAdversePossessionWarning && !hasPartitionRisk && !hasTaxLienInfo && !showRespaContext) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="w-4 h-4" />
          Legal Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Adverse Possession Warning */}
        {hasAdversePossessionWarning && data.adversePossession && (
          <Alert className="border-acr-warn bg-acr-warn-soft dark:border-acr-warn dark:bg-acr-warn-soft/30">
            <AlertTriangle className="h-4 w-4 text-acr-warn dark:text-acr-warn" />
            <AlertTitle className="text-acr-warn dark:text-acr-warn text-sm font-medium">
              Adverse Possession Awareness
            </AlertTitle>
            <AlertDescription className="text-acr-warn dark:text-acr-warn text-xs">
              This property has been held for approximately{" "}
              {yearsHeld != null ? Math.round(yearsHeld) : "?"} years. The
              adverse possession period in this state is{" "}
              {data.adversePossession.stateYears} years. Consider verifying
              boundary markers, conducting periodic inspections, and
              documenting any unauthorized use of the property.
            </AlertDescription>
          </Alert>
        )}

        {/* Partition Risk */}
        {hasPartitionRisk && data.partition && (
          <Alert className="border-acr-warn bg-acr-warn-soft dark:border-acr-warn dark:bg-acr-warn-soft/30">
            <Users className="h-4 w-4 text-acr-warn dark:text-acr-warn" />
            <AlertTitle className="text-acr-warn dark:text-acr-warn text-sm font-medium">
              Multiple Owners Detected
              <Badge
                variant="outline"
                className="ml-2 text-[10px] border-acr-warn text-acr-warn dark:text-acr-warn"
              >
                {data.partition.ownerCount} owners
              </Badge>
            </AlertTitle>
            <AlertDescription className="text-acr-warn dark:text-acr-warn text-xs">
              Properties with multiple owners carry partition action risk. Any
              co-owner can petition the court to force a sale. Verify ownership
              structure and consider partition risk in your acquisition
              analysis.
            </AlertDescription>
          </Alert>
        )}

        {/* Tax Lien / Redemption Period */}
        {hasTaxLienInfo && data.taxLien && (
          <Alert className="border-acr-warn bg-acr-warn-soft dark:border-acr-warn dark:bg-acr-warn-soft/30">
            <FileWarning className="h-4 w-4 text-acr-warn dark:text-acr-warn" />
            <AlertTitle className="text-acr-warn dark:text-acr-warn text-sm font-medium">
              Tax Delinquent Property
              {data.taxLien.redemptionMonths > 0 && (
                <Badge
                  variant="outline"
                  className="ml-2 text-[10px] border-acr-warn text-acr-warn dark:text-acr-warn"
                >
                  {data.taxLien.redemptionMonths} mo redemption
                </Badge>
              )}
            </AlertTitle>
            <AlertDescription className="text-acr-warn dark:text-acr-warn text-xs">
              This property has delinquent taxes
              {data.taxLien.delinquentAmount != null &&
                ` (${usd(data.taxLien.delinquentAmount)})`}
              . The redemption period is {data.taxLien.redemptionMonths}{" "}
              months. Factor the redemption timeline and outstanding tax
              amount into your acquisition strategy.
            </AlertDescription>
          </Alert>
        )}

        {/* RESPA Informational Banner */}
        {showRespaContext && (
          <Alert className="border-acr-warn bg-acr-warn-soft dark:border-acr-warn dark:bg-acr-warn-soft/30">
            <Shield className="h-4 w-4 text-acr-warn dark:text-acr-warn" />
            <AlertTitle className="text-acr-warn dark:text-acr-warn text-sm font-medium">
              RESPA Awareness
            </AlertTitle>
            <AlertDescription className="text-acr-warn dark:text-acr-warn text-xs">
              The Real Estate Settlement Procedures Act (RESPA) prohibits
              kickbacks and unearned fees in real estate transactions. Ensure
              all commission splits and referral fees comply with Section 8 of
              RESPA.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
