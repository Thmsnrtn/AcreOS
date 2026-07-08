/**
 * Transfer-ownership panel for /founder/recovery-console — reassigns
 * organizations.ownerId for probate / court-ordered transfers, capturing the
 * court-doc S3 key + justification on the audit row.
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
import { ArrowRightLeft, CheckCircle2, Upload } from "lucide-react";

export function TransferOwnershipPanel({ onAction }: { onAction: () => void }) {
  const { toast } = useToast();
  const [orgId, setOrgId] = useState("");
  const [newOwnerUserId, setNewOwnerUserId] = useState("");
  const [courtDocS3Key, setCourtDocS3Key] = useState("");
  const [justification, setJustification] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [uploadName, setUploadName] = useState<string | null>(null);

  // No production S3-presign helper exists in client/src yet (verified via
  // grep on 2026-05-03). We accept a manually-pasted S3 key here; when the
  // file picker is used, we surface a clear note that the operator must
  // upload to S3 separately and paste the resulting key. This matches the
  // "S3 key" contract on the backend (transferOwnershipSchema.courtDocumentS3Key).
  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setUploadName(f.name);
    toast({
      title: "File noted",
      description:
        "Upload the file to S3 via the ops bucket, then paste the S3 key below.",
    });
    e.target.value = "";
  };

  // allow-no-invalidation: onSuccess calls the parent's onAction() prop, which refreshes the console
  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        newOwnerUserId: newOwnerUserId.trim(),
        justification,
      };
      if (courtDocS3Key.trim()) {
        body.courtDocumentS3Key = courtDocS3Key.trim();
      }
      const res = await apiRequest(
        "POST",
        `/api/admin/orgs/${encodeURIComponent(orgId)}/transfer-ownership`,
        body,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "Ownership transferred" });
      setOrgId("");
      setNewOwnerUserId("");
      setCourtDocS3Key("");
      setJustification("");
      setUploadName(null);
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "Transfer failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const canSubmit =
    orgId.trim().length > 0 &&
    /^\d+$/.test(orgId.trim()) &&
    newOwnerUserId.trim().length > 0 &&
    justification.trim().length >= 10;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer organization ownership</CardTitle>
        <CardDescription>
          Reassigns <code>organizations.ownerId</code>. Used for probate /
          court-ordered transfers and acquihires. Both old + new owner
          receive an email when the transfer succeeds.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="xfer-org">Organization id (numeric)</Label>
            <Input
              id="xfer-org"
              value={orgId}
              onChange={(e) => setOrgId(e.target.value)}
              placeholder="42"
              aria-label="Organization id"
            />
          </div>
          <div>
            <Label htmlFor="xfer-new">New owner userId</Label>
            <Input
              id="xfer-new"
              value={newOwnerUserId}
              onChange={(e) => setNewOwnerUserId(e.target.value)}
              placeholder="user_..."
              aria-label="New owner user id"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Court document</Label>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 cursor-pointer rounded-md border px-3 py-1.5 text-sm hover:bg-muted/50">
              <Upload className="w-4 h-4" aria-hidden="true" />
              <span>Choose file</span>
              <input
                type="file"
                className="hidden"
                onChange={onFileChosen}
                aria-label="Court document file"
              />
            </label>
            {uploadName && (
              <span className="text-xs text-muted-foreground">
                {uploadName}
              </span>
            )}
          </div>
          <Input
            value={courtDocS3Key}
            onChange={(e) => setCourtDocS3Key(e.target.value)}
            placeholder="s3://acreos-ops/court-docs/2026/abc123.pdf"
            aria-label="Court document S3 key"
          />
          <p className="text-xs text-muted-foreground">
            Upload to the ops bucket, then paste the resulting S3 key
            here. Stored on the audit row for legal traceability.
          </p>
        </div>

        <div>
          <Label htmlFor="xfer-just">Justification (audit-logged)</Label>
          <Textarea
            id="xfer-just"
            rows={3}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Probate order #2026-PR-1234 transfers operating control to spouse. Court doc attached above."
            aria-label="Transfer justification"
          />
        </div>

        <Button
          variant="destructive"
          disabled={!canSubmit || mutation.isPending}
          onClick={() => setConfirm(true)}
          aria-label="Transfer ownership"
        >
          <ArrowRightLeft className="w-4 h-4 mr-1" aria-hidden="true" />
          Transfer ownership
        </Button>
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Transfer ownership of org #{orgId}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <code>organizations.ownerId</code> will become{" "}
              <code>{newOwnerUserId}</code>. Both the old and new owner
              will receive an email. This action is logged with the
              court-doc S3 key and your justification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-label="Cancel transfer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                mutation.mutate();
                setConfirm(false);
              }}
              aria-label="Confirm ownership transfer"
            >
              <CheckCircle2 className="w-4 h-4 mr-1" aria-hidden="true" />
              Transfer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
