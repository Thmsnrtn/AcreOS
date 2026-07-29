import { useQuery } from "@tanstack/react-query";
import { useOrganization, useUpdateOrganization } from "@/hooks/use-organization";
import { TIER_LIMITS, type SubscriptionTier } from "@shared/billing/tier-limits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { CheckCircle2, ArrowRight, X, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  type ChecklistItemDef,
  type ChecklistStatus,
  computeChecklistProgress,
  getChecklistItems,
  isItemComplete,
  resolveChecklistBusinessType,
  shouldShowChecklist,
} from "@/lib/onboarding-checklist";

// Onboarding rebuild (2026-07-29 audit): this component no longer keys on the
// 3-value investorType fork — items come from the single vertical-aware config
// in @/lib/onboarding-checklist.ts, keyed on the org's 15-value
// onboardingData.businessType (shared/business-types.ts). Every item's
// completion is a REAL signal from GET /api/onboarding/checklist-status
// (derived server-side from actual org rows — leads, imports, campaigns/mail
// shipments, deals, payments, enriched parcels, BYOK credentials). Visibility
// is deliberately independent of the Today empty-state and of
// onboardingData.skipped — see shouldShowChecklist in the config module.

// ── Child: one checklist row ───────────────────────────────────────────────
function ChecklistItemRow({
  item,
  complete,
}: {
  item: ChecklistItemDef;
  complete: boolean;
}) {
  const ItemIcon = item.icon;
  return (
    <Link href={item.href}>
      <div
        className={`flex items-center gap-3 p-3 rounded-card transition-colors cursor-pointer hover-elevate ${
          complete ? "bg-muted/30" : "bg-muted/50"
        }`}
        data-testid={`checklist-item-${item.id}`}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <Checkbox
            checked={complete}
            className="pointer-events-none"
            aria-label={complete ? `${item.title} — done` : `${item.title} — not done yet`}
            data-testid={`checkbox-${item.id}`}
          />
          <div
            className={`w-9 h-9 rounded-card flex items-center justify-center flex-shrink-0 ${
              complete ? "bg-acr-pos/10 text-acr-pos" : "bg-primary/10 text-primary"
            }`}
          >
            {complete ? (
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ItemIcon className="w-4 h-4" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <p
              className={`text-sm font-medium truncate ${
                complete ? "line-through text-muted-foreground" : ""
              }`}
            >
              {item.title}
            </p>
            <p className="text-xs text-muted-foreground truncate">{item.description}</p>
          </div>
        </div>
        {!complete && (
          <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
        )}
      </div>
    </Link>
  );
}

export function GettingStartedChecklist() {
  const { data: organization } = useOrganization();
  const updateOrg = useUpdateOrganization();

  const { data: checklistStatus } = useQuery<ChecklistStatus>({
    queryKey: ["/api/onboarding/checklist-status"],
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const settings = organization?.settings as Record<string, unknown> | null;
  const checklistDismissed = settings?.checklistDismissed === true;

  // Vertical resolution: the 15-value businessType first, falling back
  // through the coarse investorType fork for orgs that predate the taxonomy.
  const businessType = resolveChecklistBusinessType(
    organization?.onboardingData?.businessType,
    organization?.investorType,
  );
  const verticalItems = getChecklistItems(businessType);

  // W2.1 (activation wedge, preserved): every tier can reach the mailer step.
  // Free-tier orgs see wedge-flavored copy for the campaign item — the server
  // caps the pieces (FREE_TIER_LIFETIME_PIECES on the queue route).
  const tier = (organization?.subscriptionTier as SubscriptionTier | undefined) ?? "free";
  const campaignsAllowed = TIER_LIMITS[tier]?.campaigns !== 0;
  const items = campaignsAllowed
    ? verticalItems
    : verticalItems.map((item) =>
        item.id === "campaign"
          ? {
              ...item,
              title: "Send your first letters — free",
              description:
                "Your first 5 pieces are on us. Pick a template, pick up to 5 sellers, watch responses land",
            }
          : item,
      );

  // Progress over REQUIRED items only (optional connect-services never
  // blocks completion or auto-dismiss — value before friction).
  const { completedCount, requiredCount, progressPct, allComplete } =
    computeChecklistProgress(items, checklistStatus);

  const handleDismiss = async () => {
    await updateOrg.mutateAsync({
      settings: {
        ...(organization?.settings || {}),
        checklistDismissed: true,
      },
    });
  };

  // Visibility is independent of empty-state / hasAnyData / skipped-onboarding
  // (audit fixes #1 + #4): hide only on dismiss, genuine completion, or while
  // real completion state hasn't loaded (never render unverified checkboxes).
  if (
    !shouldShowChecklist({
      dismissed: checklistDismissed,
      statusLoaded: !!checklistStatus,
      allComplete,
    })
  ) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="relative" data-testid="card-getting-started">
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-3 right-3"
          onClick={handleDismiss}
          aria-label="Dismiss checklist"
          data-testid="button-dismiss-checklist"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </Button>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="w-5 h-5 text-primary" aria-hidden="true" />
            <CardTitle className="text-lg">Getting Started</CardTitle>
            <Badge variant="secondary" className="ml-auto mr-8">
              {completedCount}/{requiredCount}
            </Badge>
          </div>
          <CardDescription>
            Complete these steps to get the most out of AcreOS
          </CardDescription>
          <Progress value={progressPct} className="mt-3" data-testid="progress-checklist" />
        </CardHeader>
        <CardContent>
          <motion.div
            className="space-y-3"
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
          >
            {items.map((item) => (
              <motion.div key={item.id} variants={staggerItem}>
                <ChecklistItemRow item={item} complete={isItemComplete(item, checklistStatus)} />
              </motion.div>
            ))}
          </motion.div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
