import { useQuery } from "@tanstack/react-query";
import { useOrganization, useUpdateOrganization } from "@/hooks/use-organization";
import { TIER_LIMITS, type SubscriptionTier } from "@shared/billing/tier-limits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Users, Upload, Megaphone, Handshake, Banknote, CheckCircle2, ArrowRight, X, Sparkles, MapPin, Plug } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ChecklistStatus {
  hasLead: boolean;
  hasImport: boolean;
  hasCampaign: boolean;
  hasDeal: boolean;
  hasNotePayment: boolean;
  hasPropertyLookup: boolean;
  hasConnectedService: boolean;
}

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  icon: typeof Users;
  href: string;
  // R5 reshape: optional items (e.g. "connect your services") are a bonus
  // nudge — they never count toward completion or block the checklist's
  // auto-dismiss. Value before friction: connecting is optional.
  optional?: boolean;
}

// FW-YUNA-1 (push-forward 2026-05-08): persona-aware aha checklist.
// Yuna's lead recommendation: time-to-first-value 7:30 → 2:30 by
// keying on organizations.investorType. Each persona gets a distinct
// 3-step aha — only the steps that produce the wow-moment for THAT
// operator type. Land-investors care about leads → campaign → deal;
// note-investors care about notes → payments → portfolio; "both" /
// wholesaler-shaped operators get the hybrid view.
//
// RAFE (Tahoe Wave-2): the single most differentiated, "I can't get this
// anywhere else for free" moment we own is opening a parcel on the Map door
// and watching soils + flood + wetlands + elevation light up — all from free
// federal/state open data (FEMA NFHL, USDA SSURGO, USFWS NWI, USGS 3DEP).
// That data-aha was buried behind the CRM funnel. For land + hybrid operators
// it now leads the checklist, ahead of add-lead/send-mailer. Completion is
// driven by hasPropertyLookup (server records `first_lead_enriched` on the
// first real /api/broker/enrich-property lookup). Note-investors keep their
// notes-first aha — a soil map is not their wow-moment.
const PERSONA_CHECKLISTS: Record<"land" | "notes" | "both", Omit<ChecklistItem, "isComplete">[]> = {
  land: [
    {
      id: "propertyLookup",
      title: "Look up your first property",
      description: "Open a parcel on the map — soils, flood, wetlands & elevation light up from free public data",
      icon: MapPin,
      href: "/maps",
    },
    {
      id: "lead",
      title: "Add your first lead",
      description: "Import a CSV or paste an address — your wedge into the deal pipeline",
      icon: Users,
      href: "/leads",
    },
    {
      id: "campaign",
      title: "Send your first mailer",
      description: "Pick a template, target your list, watch responses land",
      icon: Megaphone,
      href: "/campaigns",
    },
    {
      id: "deal",
      title: "Track your first deal",
      description: "Move a lead to deal and see the offer/close pipeline light up",
      icon: Handshake,
      href: "/deals",
    },
  ],
  notes: [
    {
      id: "import",
      title: "Import your note portfolio",
      description: "Upload your existing notes — amortization schedules render automatically",
      icon: Upload,
      href: "/finance",
    },
    {
      id: "notePayment",
      title: "Record your first payment",
      description: "Log a P&I payment and see the schedule update to the cent",
      icon: Banknote,
      href: "/finance",
    },
    {
      id: "deal",
      title: "Track a note buy or sell",
      description: "Move a note acquisition or disposition through your pipeline",
      icon: Handshake,
      href: "/deals",
    },
  ],
  both: [
    {
      id: "propertyLookup",
      title: "Look up your first property",
      description: "Open a parcel on the map — soils, flood, wetlands & elevation light up from free public data",
      icon: MapPin,
      href: "/maps",
    },
    {
      id: "lead",
      title: "Add your first lead or note",
      description: "Import a CSV — leads, notes, or both. Same pipeline, different surfaces",
      icon: Users,
      href: "/leads",
    },
    {
      id: "campaign",
      title: "Send your first outreach",
      description: "Mailer for sellers, or direct outreach to note holders",
      icon: Megaphone,
      href: "/campaigns",
    },
    {
      id: "notePayment",
      title: "Record activity",
      description: "First deal moved, or first note payment logged — pick the win that's closest",
      icon: Banknote,
      href: "/finance",
    },
  ],
};

const STATUS_KEYS: Record<string, keyof ChecklistStatus> = {
  propertyLookup: "hasPropertyLookup",
  lead: "hasLead",
  import: "hasImport",
  campaign: "hasCampaign",
  deal: "hasDeal",
  notePayment: "hasNotePayment",
  connectServices: "hasConnectedService",
};

// R5 reshape: the optional "connect your services" first-run nudge — the same
// invitation the landing (home-base identity) makes, now inside the product.
// Points at the grouped connectors hub (R1). Optional: never blocks the
// checklist's completion or auto-dismiss.
const CONNECT_ITEM: Omit<ChecklistItem, "isComplete"> = {
  id: "connectServices",
  title: "Connect your services (optional)",
  description: "Bring your own Twilio, SendGrid, Lob, or data accounts — your keys, your invoices. Or keep running on ours.",
  icon: Plug,
  href: "/settings/byok",
  optional: true,
};

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

  const investorType = (organization?.investorType as "land" | "notes" | "both" | undefined) ?? "land";
  const personaItems = PERSONA_CHECKLISTS[investorType] ?? PERSONA_CHECKLISTS.land;

  // W2.1 (activation wedge): every tier can now reach the mailer step. The
  // free tier gets a small lifetime allowance (FREE_TIER_LIFETIME_PIECES on
  // the server queue route) so "send your first mailer" is completable
  // before paying — the wedge IS the demo. The step used to be hidden when
  // TIER_LIMITS[tier].campaigns === 0, which made the magic moment
  // structurally unreachable for the tier that most needs to feel it. Free
  // users see wedge-flavored copy; the server caps the pieces and points
  // spent users at the plan comparison.
  const tier = (organization?.subscriptionTier as SubscriptionTier | undefined) ?? "free";
  const campaignsAllowed = TIER_LIMITS[tier]?.campaigns !== 0;
  const visibleItems = campaignsAllowed
    ? personaItems
    : personaItems.map((item) =>
        item.id === "campaign"
          ? {
              ...item,
              title: "Send your first letters — free",
              description:
                "Your first 5 pieces are on us. Pick a template, pick up to 5 sellers, watch responses land",
            }
          : item,
      );

  // Append the optional connect-your-services nudge after the persona aha
  // steps. It renders and completes like any item but is excluded from the
  // progress + auto-dismiss math below (optional === never blocking).
  const items = [...visibleItems, CONNECT_ITEM].map((item) => ({
    ...item,
    isComplete: checklistStatus ? checklistStatus[STATUS_KEYS[item.id]] : false,
  }));

  // Progress + completion are measured over REQUIRED items only, so a user who
  // finishes the aha steps but never connects a service still sees the
  // checklist auto-dismiss (value before friction).
  const requiredItems = items.filter((item) => !item.optional);
  const completedCount = requiredItems.filter((item) => item.isComplete).length;
  const progress = requiredItems.length > 0 ? (completedCount / requiredItems.length) * 100 : 0;
  const allComplete = completedCount === requiredItems.length;

  const handleDismiss = async () => {
    await updateOrg.mutateAsync({
      settings: {
        ...(organization?.settings || {}),
        checklistDismissed: true,
      },
    });
  };

  if (checklistDismissed || allComplete || !checklistStatus) {
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
          <X className="w-4 h-4" />
        </Button>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Getting Started</CardTitle>
            <Badge variant="secondary" className="ml-auto mr-8">
              {completedCount}/{requiredItems.length}
            </Badge>
          </div>
          <CardDescription>
            Complete these steps to get the most out of AcreOS
          </CardDescription>
          <Progress value={progress} className="mt-3" data-testid="progress-checklist" />
        </CardHeader>
        <CardContent className="space-y-3">
          <AnimatePresence>
            {items.map((item, index) => {
              const ItemIcon = item.icon;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <Link href={item.href}>
                    <div
                      className={`flex items-center gap-3 p-3 rounded-card transition-colors cursor-pointer hover-elevate ${
                        item.isComplete
                          ? "bg-muted/30"
                          : "bg-muted/50"
                      }`}
                      data-testid={`checklist-item-${item.id}`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <Checkbox
                          checked={item.isComplete}
                          className="pointer-events-none"
                          data-testid={`checkbox-${item.id}`}
                        />
                        <div
                          className={`w-9 h-9 rounded-card flex items-center justify-center flex-shrink-0 ${
                            item.isComplete
                              ? "bg-acr-pos/10 text-acr-pos"
                              : "bg-primary/10 text-primary"
                          }`}
                        >
                          {item.isComplete ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : (
                            <ItemIcon className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${
                              item.isComplete ? "line-through text-muted-foreground" : ""
                            }`}
                          >
                            {item.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {item.description}
                          </p>
                        </div>
                      </div>
                      {!item.isComplete && (
                        <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                      )}
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  );
}
