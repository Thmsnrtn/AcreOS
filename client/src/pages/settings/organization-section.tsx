/**
 * Settings → Organization — routed section (Wave 1.5, P2 §1).
 *
 * Workspace-wide preferences moved intact from the settings.tsx monolith:
 * business goals (GoalsSettings — previously orphaned in a second
 * TabsContent value="organization" that Radix never rendered), and the
 * Help & Tips card with the re-run-onboarding affordance.
 */
import { useOrganization, useUpdateOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Lightbulb, RotateCcw } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { GoalsSettings } from "@/pages/settings/organization-sections";
import { useLocation } from "wouter";

export default function OrganizationSection() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { data: organization } = useOrganization();
  const updateOrgMutation = useUpdateOrganization();

  const settings = organization?.settings as {
    showTips?: boolean;
    checklistDismissed?: boolean;
    onboardingCompleted?: boolean;
    [key: string]: unknown;
  } | null;
  const showTips = settings?.showTips !== false;

  return (
    <div className="space-y-8" data-testid="settings-section-organization">
      <GoalsSettings />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5" />
            Help & Tips
          </CardTitle>
          <CardDescription>Configure onboarding assistance and contextual help</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <Label htmlFor="show-tips" className="text-base">Show Tips</Label>
              <p className="text-sm text-muted-foreground">
                Display helpful tips and the getting started checklist
              </p>
            </div>
            <Switch
              id="show-tips"
              checked={showTips}
              onCheckedChange={async (checked) => {
                try {
                  await updateOrgMutation.mutateAsync({
                    settings: {
                      ...(organization?.settings || {}),
                      showTips: checked,
                      checklistDismissed: checked ? false : settings?.checklistDismissed,
                    },
                  });
                  toast({
                    title: checked ? "Tips enabled" : "Tips disabled",
                    description: checked
                      ? "You'll now see helpful tips throughout the app."
                      : "Tips have been hidden. You can re-enable them anytime.",
                  });
                } catch {
                  toast({
                    title: "Couldn't save your preference",
                    description: "The change didn't stick — please try again.",
                    variant: "destructive",
                  });
                }
              }}
              disabled={updateOrgMutation.isPending}
              data-testid="switch-show-tips"
            />
          </div>

          {/* Re-run onboarding — labeled for what it actually does
              (re-runs the setup wizard; there is no separate "tour").
              Reset PRESERVES the org's businessType/noteRole, and the
              wizard prefills from them — a re-run never flips the org
              back to the land_flipper default. */}
          <div className="flex items-center justify-between gap-4 pt-4 border-t">
            <div className="space-y-0.5">
              <Label className="text-base">Re-run onboarding</Label>
              <p className="text-sm text-muted-foreground">
                {settings?.onboardingCompleted
                  ? "Run the setup wizard again — your business type and answers are kept and prefilled."
                  : "Finish the setup wizard to configure your workspace."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 pointer-fine:sm:min-h-9"
              onClick={async () => {
                try {
                  const res = await fetch("/api/onboarding/reset", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                  });
                  if (!res.ok) throw new Error("Reset failed");
                  queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/onboarding/status"] });
                  queryClient.invalidateQueries({ queryKey: ["/api/me/needs-onboarding"] });
                  setLocation("/onboarding-v2");
                } catch (error) {
                  toast({
                    title: "Couldn't reset onboarding",
                    description: "Your onboarding state is unchanged. Try again.",
                    variant: "destructive",
                  });
                }
              }}
              disabled={updateOrgMutation.isPending}
              data-testid="button-restart-onboarding"
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              {settings?.onboardingCompleted ? "Re-run onboarding" : "Resume onboarding"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
