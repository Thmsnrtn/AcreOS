/**
 * Settings → API & developer — routed section (Wave 1.5, P2 §1).
 *
 * Developer tools moved intact from the settings.tsx monolith's
 * Integrations tab: demo-data seed/clear, org API keys, and the activity
 * audit log.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Database, Trash2, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ApiKeyManager, ActivityLogPanel } from "@/pages/settings/developer-sections";
import { useState } from "react";

export default function ApiSection() {
  const { toast } = useToast();
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const seedDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/seed-demo-data", {});
      if (!res.ok) throw new Error("Failed to seed demo data");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries();
      toast({
        title: "Demo data created",
        description: `Added ${data.counts.leads} leads, ${data.counts.properties} properties, ${data.counts.deals} deals, and ${data.counts.notes} notes.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't create demo data",
        description: err?.message || "Check your connection and try again.",
        variant: "destructive",
      });
    },
  });

  const clearDataMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/clear-demo-data", {});
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setShowClearConfirm(false);
      toast({
        title: "Workspace cleared",
        description:
          "All leads, properties, deals, notes, and payments were removed from your workspace.",
      });
    },
    onError: (err: any) => {
      // apiRequest throws "<status>: <server message>" — the numeric prefix
      // is engineer-speak, so drop it before showing the person the message.
      const raw = typeof err?.message === "string" ? err.message : "";
      const friendly = raw.replace(/^\d{3}:\s*/, "");
      toast({
        title: "Couldn't clear your data",
        description:
          friendly ||
          "Nothing was removed. Check your connection and try again — if it keeps failing, it's on our side and already logged.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="space-y-4" data-testid="settings-section-api">
      <div>
        <h2 className="text-section-h2 flex items-center gap-2">
          <Database className="w-5 h-5" />
          Developer Tools
        </h2>
        <p className="text-muted-foreground text-sm">
          Manage test data for development and demo purposes.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Demo Data</CardTitle>
          <CardDescription>
            Populate your account with sample leads, properties, deals, and notes for testing.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            className="min-h-11 pointer-fine:sm:min-h-9"
            onClick={() => seedDataMutation.mutate()}
            disabled={seedDataMutation.isPending}
            data-testid="button-seed-demo-data"
          >
            {seedDataMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Database className="w-4 h-4 mr-2" />
            )}
            Add Demo Data
          </Button>

          <Button
            variant="destructive"
            className="min-h-11 pointer-fine:sm:min-h-9"
            onClick={() => setShowClearConfirm(true)}
            disabled={clearDataMutation.isPending}
            data-testid="button-clear-data"
          >
            {clearDataMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4 mr-2" />
            )}
            Clear All Data
          </Button>
        </CardContent>
      </Card>

      {/* API Key Management */}
      <ApiKeyManager />

      {/* Activity Audit Log */}
      <ActivityLogPanel />

      <ConfirmDialog
        open={showClearConfirm}
        onOpenChange={setShowClearConfirm}
        title="Clear All Data"
        description="This will permanently delete all leads, properties, deals, notes, and payments from your organization. This action cannot be undone. Are you sure you want to continue?"
        confirmLabel="Yes, Delete Everything"
        onConfirm={() => clearDataMutation.mutate()}
        isLoading={clearDataMutation.isPending}
        variant="destructive"
      />
    </div>
  );
}
