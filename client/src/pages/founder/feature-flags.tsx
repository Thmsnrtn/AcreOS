import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Flag } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface FeatureFlag {
  key: string;
  enabled: boolean;
  description?: string;
}

const FRIENDLY_NAMES: Record<string, string> = {
  ai_agent_autonomy: "AI Agent Autonomy",
  auto_enrichment: "Automatic Data Enrichment",
  bulk_email: "Bulk Email Campaigns",
  lead_scoring: "Lead Scoring",
  smart_routing: "Smart Lead Routing",
  webhook_integrations: "Webhook Integrations",
  tenant_portal: "Tenant Self-Service Portal",
  auto_maintenance: "Automatic Maintenance Dispatch",
  payment_reminders: "Payment Reminder Emails",
  market_analysis: "Market Analysis Reports",
};

const FLAG_CATEGORIES: Record<string, string[]> = {
  "AI & Automation": ["ai_agent_autonomy", "auto_enrichment", "lead_scoring", "smart_routing", "auto_maintenance"],
  "Communications": ["bulk_email", "payment_reminders"],
  "Integrations": ["webhook_integrations", "tenant_portal"],
  "Analytics": ["market_analysis"],
};

function categorizeFlags(flags: FeatureFlag[]): {
  useDocumentTitle("Feature flags");
 category: string; flags: FeatureFlag[] }[] {
  const categorized = new Map<string, FeatureFlag[]>();
  const assigned = new Set<string>();

  for (const [category, keys] of Object.entries(FLAG_CATEGORIES)) {
    const matching = flags.filter((f) => keys.includes(f.key));
    if (matching.length > 0) {
      categorized.set(category, matching);
      matching.forEach((f) => assigned.add(f.key));
    }
  }

  const uncategorized = flags.filter((f) => !assigned.has(f.key));
  if (uncategorized.length > 0) {
    categorized.set("Other", uncategorized);
  }

  return Array.from(categorized.entries()).map(([category, flags]) => ({ category, flags }));
}

export default function FeatureFlagsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pendingToggle, setPendingToggle] = useState<{ key: string; enabled: boolean } | null>(null);

  const { data: flags, isLoading } = useQuery<FeatureFlag[]>({
    queryKey: ["/api/admin/feature-flags"],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/feature-flags/${key}`, { enabled });
      return res.json();
    },
    onSuccess: (_data, { key, enabled }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/feature-flags"] });
      toast({
        title: "Flag updated",
        description: `${FRIENDLY_NAMES[key] || key} is now ${enabled ? "enabled" : "disabled"}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't update flag",
        description: `${error.message || "No change was applied"} — the flag's existing value is unchanged.`,
        variant: "destructive",
      });
    },
  });

  const handleConfirmToggle = () => {
    if (pendingToggle) {
      toggleMutation.mutate(pendingToggle);
      setPendingToggle(null);
    }
  };

  const grouped = flags ? categorizeFlags(flags) : [];

  return (
    <PageShell>
      <div>
        <h1 className="text-3xl font-bold">Feature Flags</h1>
        <p className="text-muted-foreground">Manage feature flags across the platform.</p>
      </div>

      {isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flag className="w-5 h-5" />
              All Flags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : !flags || flags.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flag className="w-5 h-5" />
              All Flags
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">No feature flags configured.</p>
          </CardContent>
        </Card>
      ) : (
        grouped.map(({ category, flags: categoryFlags }) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Flag className="w-5 h-5" />
                {category}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {categoryFlags.map((flag) => (
                  <div
                    key={flag.key}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center gap-3">
                      <Badge variant={flag.enabled ? "default" : "secondary"} className="text-xs">
                        {flag.enabled ? "ON" : "OFF"}
                      </Badge>
                      <div>
                        <p className="text-sm font-medium">
                          {FRIENDLY_NAMES[flag.key] || flag.key}
                          {FRIENDLY_NAMES[flag.key] && (
                            <span className="text-xs text-muted-foreground font-mono ml-2">
                              {flag.key}
                            </span>
                          )}
                        </p>
                        {flag.description && (
                          <p className="text-xs text-muted-foreground">{flag.description}</p>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={flag.enabled}
                      onCheckedChange={(enabled) =>
                        setPendingToggle({ key: flag.key, enabled })
                      }
                      disabled={toggleMutation.isPending}
                      aria-label={`Toggle ${FRIENDLY_NAMES[flag.key] || flag.key}`}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}

      <AlertDialog open={!!pendingToggle} onOpenChange={(open) => { if (!open) setPendingToggle(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Are you sure you want to {pendingToggle?.enabled ? "enable" : "disable"}{" "}
              {pendingToggle ? (FRIENDLY_NAMES[pendingToggle.key] || pendingToggle.key) : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will affect all customers on your platform. The{" "}
              {pendingToggle ? (FRIENDLY_NAMES[pendingToggle.key] || pendingToggle.key) : ""}{" "}
              feature will be {pendingToggle?.enabled ? "turned on" : "turned off"} for everyone immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmToggle}>
              Yes, {pendingToggle?.enabled ? "enable" : "disable"} it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
