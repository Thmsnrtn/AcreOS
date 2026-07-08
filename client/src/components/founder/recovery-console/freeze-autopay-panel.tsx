/**
 * Freeze-autopay panel for /founder/recovery-console — switches Stripe
 * collection to send_invoice on an org's subscription behind an AlertDialog.
 *
 * Extracted verbatim from client/src/pages/founder/recovery-console.tsx
 * (W3-5 decomposition) — behavior unchanged.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useToast } from "@/hooks/use-toast";
import { Snowflake } from "lucide-react";

export function FreezeAutopayPanel({ onAction }: { onAction: () => void }) {
  const { toast } = useToast();
  const [orgId, setOrgId] = useState("");
  const [reason, setReason] = useState("");
  const [untilDate, setUntilDate] = useState("");
  const [confirm, setConfirm] = useState(false);

  // allow-no-invalidation: onSuccess calls the parent's onAction() prop, which refreshes the console
  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { reason };
      if (untilDate.trim()) {
        body.untilDate = new Date(untilDate).toISOString();
      }
      const res = await apiRequest(
        "POST",
        `/api/admin/orgs/${encodeURIComponent(orgId)}/freeze-autopay`,
        body,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Autopay frozen" });
      setOrgId("");
      setReason("");
      setUntilDate("");
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "Freeze failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const canSubmit =
    orgId.trim().length > 0 && reason.trim().length > 0 && /^\d+$/.test(orgId.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Freeze autopay</CardTitle>
        <CardDescription>
          Switches Stripe collection to <code>send_invoice</code> on the
          org's subscription. Use when the cardholder has died, asked us
          to stop, or is mid-fraud-investigation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="freeze-org">Organization id (numeric)</Label>
            <Input
              id="freeze-org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="42"
              aria-label="Organization id"
            />
          </div>
          <div>
            <Label htmlFor="freeze-until">Until date (optional)</Label>
            <Input
              id="freeze-until"
              type="datetime-local"
              value={untilDate}
              onChange={(e) => setUntilDate(e.target.value)}
              aria-label="Freeze until date"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="freeze-reason">Reason (audit-logged)</Label>
          <Textarea
            id="freeze-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Cardholder deceased per family notice email 2026-04-30. Family asked we pause until estate settles."
            aria-label="Freeze reason"
          />
        </div>
        <Button
          variant="destructive"
          disabled={!canSubmit || mutation.isPending}
          onClick={() => setConfirm(true)}
          aria-label="Freeze autopay"
        >
          <Snowflake className="w-4 h-4 mr-1" aria-hidden="true" />
          Freeze autopay
        </Button>
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Freeze autopay on org #{orgId}?</AlertDialogTitle>
            <AlertDialogDescription>
              Stripe collection will switch to <code>send_invoice</code>{" "}
              and the org row will be flagged frozen. The customer will
              not be auto-charged until you manually unfreeze.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-label="Cancel freeze">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                mutation.mutate();
                setConfirm(false);
              }}
              aria-label="Confirm freeze autopay"
            >
              Freeze
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
