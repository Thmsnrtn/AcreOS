import { useLeads } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import { useDeals } from "@/hooks/use-deals";
import { useOrganization, useUpdateOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Users, Map, Handshake, Bell, CheckCircle2, ArrowRight, X, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  icon: typeof Users;
  href: string;
  isComplete: boolean;
}

export function GettingStartedChecklist() {
  const { data: organization } = useOrganization();
  const { data: leads = [] } = useLeads();
  const { data: properties = [] } = useProperties();
  const { data: deals = [] } = useDeals();
  const updateOrg = useUpdateOrganization();

  const settings = organization?.settings as Record<string, unknown> | null;
  const showTips = settings?.showTips !== false;
  const checklistDismissed = settings?.checklistDismissed === true;

  const checklistItems: ChecklistItem[] = [
    {
      id: "lead",
      title: "Add your first lead",
      description: "Import or manually add a seller or buyer to your CRM",
      icon: Users,
      href: "/leads",
      isComplete: leads.length > 0,
    },
    {
      id: "property",
      title: "Create a property listing",
      description: "Add a property to track through your pipeline",
      icon: Map,
      href: "/properties",
      isComplete: properties.length > 0,
    },
    {
      id: "deal",
      title: "Set up your first deal",
      description: "Start tracking an acquisition or disposition",
      icon: Handshake,
      href: "/deals",
      isComplete: deals.length > 0,
    },
    {
      id: "notifications",
      title: "Configure notifications",
      description: "Customize how you receive updates and alerts",
      icon: Bell,
      href: "/settings",
      isComplete: settings?.notificationsConfigured === true,
    },
  ];

  const completedCount = checklistItems.filter((item) => item.isComplete).length;
  const progress = (completedCount / checklistItems.length) * 100;
  const allComplete = completedCount === checklistItems.length;

  const handleDismiss = async () => {
    await updateOrg.mutateAsync({
      settings: {
        ...(organization?.settings || {}),
        checklistDismissed: true,
      },
    });
  };

  if (!showTips || checklistDismissed || allComplete) {
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
          data-testid="button-dismiss-checklist"
        >
          <X className="w-4 h-4" />
        </Button>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Sparkles className="w-5 h-5 text-primary" />
            <CardTitle className="text-lg">Getting Started</CardTitle>
            <Badge variant="secondary" className="ml-auto mr-8">
              {completedCount}/{checklistItems.length}
            </Badge>
          </div>
          <CardDescription>
            Complete these steps to get the most out of AcreOS
          </CardDescription>
          <Progress value={progress} className="mt-3" data-testid="progress-checklist" />
        </CardHeader>
        <CardContent className="space-y-3">
          <AnimatePresence>
            {checklistItems.map((item, index) => {
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
