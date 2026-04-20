import { useQuery } from "@tanstack/react-query";
import { useOrganization, useUpdateOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Users, Upload, Megaphone, Handshake, Banknote, CheckCircle2, ArrowRight, X, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ChecklistStatus {
  hasLead: boolean;
  hasImport: boolean;
  hasCampaign: boolean;
  hasDeal: boolean;
  hasNotePayment: boolean;
}

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  icon: typeof Users;
  href: string;
  statusKey: keyof ChecklistStatus;
}

const CHECKLIST_ITEMS: Omit<ChecklistItem, "statusKey">[] = [
  {
    id: "lead",
    title: "Add your first lead",
    description: "Import or manually add a seller or buyer to your CRM",
    icon: Users,
    href: "/leads",
  },
  {
    id: "import",
    title: "Import leads from CSV",
    description: "Bulk import your existing contacts from a spreadsheet",
    icon: Upload,
    href: "/leads",
  },
  {
    id: "campaign",
    title: "Create a campaign",
    description: "Set up a mail or outreach campaign to engage leads",
    icon: Megaphone,
    href: "/campaigns",
  },
  {
    id: "deal",
    title: "Track a deal",
    description: "Start tracking an acquisition or disposition deal",
    icon: Handshake,
    href: "/deals",
  },
  {
    id: "notePayment",
    title: "Record a note payment",
    description: "Log a payment on a seller-financed note",
    icon: Banknote,
    href: "/finance",
  },
];

const STATUS_KEYS: Record<string, keyof ChecklistStatus> = {
  lead: "hasLead",
  import: "hasImport",
  campaign: "hasCampaign",
  deal: "hasDeal",
  notePayment: "hasNotePayment",
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

  const items = CHECKLIST_ITEMS.map((item) => ({
    ...item,
    isComplete: checklistStatus ? checklistStatus[STATUS_KEYS[item.id]] : false,
  }));

  const completedCount = items.filter((item) => item.isComplete).length;
  const progress = (completedCount / items.length) * 100;
  const allComplete = completedCount === items.length;

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
              {completedCount}/{items.length}
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
                      className={`flex items-center gap-3 p-3 rounded-lg transition-colors cursor-pointer hover-elevate ${
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
                          className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            item.isComplete
                              ? "bg-green-500/10 text-green-500"
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
