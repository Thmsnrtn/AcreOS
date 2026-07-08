/**
 * 2FA reset panel for /founder/recovery-console — 4-step identity-proof
 * modal (proof type → proof reference → justification → final attestation)
 * before the destructive reset fires.
 *
 * Extracted verbatim from client/src/pages/founder/recovery-console.tsx
 * (W3-5 decomposition) — behavior unchanged.
 */

import { useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert } from "lucide-react";
import { PROOF_LABEL, type ProofType, type UserHit } from "./recovery-shared";
import { Verbs } from "@/lib/labels";

export function TwoFactorResetPanel({
  user,
  onAction,
}: {
  user: UserHit;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [proofType, setProofType] = useState<ProofType>("video_call");
  const [proofRefId, setProofRefId] = useState("");
  const [justification, setJustification] = useState("");
  const [verified, setVerified] = useState(false);

  const reset = () => {
    setStep(1);
    setProofType("video_call");
    setProofRefId("");
    setJustification("");
    setVerified(false);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  // Backend currently rejects "notarized_statement" because the Zod
  // schema is ["video_call","court_doc","id_photo"]. Map notarized →
  // court_doc on submit and capture the original choice in proofRefId.
  const apiProofType = (t: ProofType): "video_call" | "court_doc" | "id_photo" =>
    t === "notarized_statement" ? "court_doc" : t;

  // allow-no-invalidation: onSuccess calls the parent's onAction() prop, which refreshes the console
  const mutation = useMutation({
    mutationFn: async () => {
      const refLabel =
        proofType === "notarized_statement"
          ? `notarized_statement:${proofRefId}`
          : proofRefId;
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${encodeURIComponent(user.id)}/2fa/reset`,
        {
          identityProofType: apiProofType(proofType),
          proofRefId: refLabel,
          justification,
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "2FA reset failed");
      return json;
    },
    onSuccess: () => {
      toast({ title: "2FA reset complete" });
      close();
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "2FA reset failed",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const canProceed = useMemo(() => {
    if (step === 1) return !!proofType;
    if (step === 2) return proofRefId.trim().length >= 1;
    if (step === 3) return justification.trim().length >= 10;
    if (step === 4) return verified;
    return false;
  }, [step, proofType, proofRefId, justification, verified]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset 2FA for {user.email ?? user.id}</CardTitle>
        <CardDescription>
          Disables every Clerk MFA factor on the user. Use only after
          verifying identity through one of the four supported channels.
          The 4-step modal captures the proof for audit.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="destructive"
          onClick={() => setOpen(true)}
          aria-label="Begin 2FA reset workflow"
        >
          <ShieldAlert className="w-4 h-4 mr-1" aria-hidden="true" />
          Begin 2FA reset workflow
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>2FA reset — step {step} of 4</DialogTitle>
            <DialogDescription>
              Every step is logged. The reset is only fired after step 4
              confirmation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {step === 1 && (
              <div className="space-y-2">
                <Label htmlFor="proof-type">Identity-proof channel</Label>
                <Select
                  value={proofType}
                  onValueChange={(v) => setProofType(v as ProofType)}
                >
                  <SelectTrigger id="proof-type" aria-label="Identity proof type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROOF_LABEL) as ProofType[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {PROOF_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-2">
                <Label htmlFor="proof-ref">
                  Proof reference (S3 key, video session id, ticket #, etc.)
                </Label>
                <Input
                  id="proof-ref"
                  value={proofRefId}
                  onChange={(e) => setProofRefId(e.target.value)}
                  placeholder="s3://acreos-recovery/abc123.pdf"
                  aria-label="Proof reference id"
                />
              </div>
            )}

            {step === 3 && (
              <div className="space-y-2">
                <Label htmlFor="just">Justification (audit-logged)</Label>
                <Textarea
                  id="just"
                  rows={4}
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Customer lost their phone in a house fire; verified via video call against ID on file. Support ticket #12345."
                  aria-label="Justification text"
                />
                <p className="text-xs text-muted-foreground">
                  Minimum 10 characters. Be specific — this is the
                  permanent record.
                </p>
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <div className="rounded-md border p-3 text-sm space-y-1">
                  <div>
                    <span className="text-muted-foreground">User: </span>
                    {user.email ?? user.id}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Proof: </span>
                    {PROOF_LABEL[proofType]}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Reference: </span>
                    <code>{proofRefId}</code>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Justification:{" "}
                    </span>
                    {justification}
                  </div>
                </div>
                <label className="flex items-start gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={verified}
                    onCheckedChange={(v) => setVerified(v === true)}
                    aria-label="Confirm identity verified"
                  />
                  <span>I have verified the identity of this user.</span>
                </label>
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-row justify-between">
            <Button
              variant="ghost"
              onClick={close}
              aria-label="Cancel 2FA reset"
            >
              {Verbs.CANCEL}
            </Button>
            <div className="flex gap-2">
              {step > 1 && (
                <Button
                  variant="outline"
                  onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : 1))}
                  aria-label="Previous step"
                >
                  Back
                </Button>
              )}
              {step < 4 ? (
                <Button
                  disabled={!canProceed}
                  onClick={() => setStep((s) => (s < 4 ? ((s + 1) as 2 | 3 | 4) : 4))}
                  aria-label="Next step"
                >
                  Next
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  disabled={!canProceed || mutation.isPending}
                  onClick={() => mutation.mutate()}
                  aria-label="Confirm 2FA reset"
                >
                  {mutation.isPending ? "Resetting…" : "Reset 2FA"}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
