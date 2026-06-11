/**
 * Password-reset-link panel for /founder/recovery-console — mints a one-hour
 * single-use Clerk sign-in token behind an AlertDialog confirmation.
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
import { KeyRound, Copy } from "lucide-react";
import type { UserHit } from "./recovery-shared";

export function PasswordResetPanel({
  user,
  onAction,
}: {
  user: UserHit;
  onAction: () => void;
}) {
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [generated, setGenerated] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${encodeURIComponent(user.id)}/password-reset-link`,
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message ?? "Failed");
      return json as { url: string };
    },
    onSuccess: (data) => {
      setGenerated(data.url);
      toast({ title: "Reset link generated" });
      onAction();
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to generate link",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const copy = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({
        title: "Copy failed",
        description: "Select the URL manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate password reset link</CardTitle>
        <CardDescription>
          Mints a one-hour Clerk sign-in token. Share via your trusted
          channel — the link bypasses the password requirement once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={() => setConfirm(true)}
          disabled={mutation.isPending}
          aria-label="Generate password reset link"
        >
          <KeyRound className="w-4 h-4 mr-1" aria-hidden="true" />
          Generate link
        </Button>

        {generated && (
          <div className="border rounded-md p-3 space-y-2">
            <Label>Reset link</Label>
            <div className="flex gap-2">
              <Input
                readOnly
                value={generated}
                aria-label="Generated reset link"
              />
              <Button
                variant="outline"
                onClick={copy}
                aria-label="Copy reset link to clipboard"
              >
                <Copy className="w-4 h-4" aria-hidden="true" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Expires in 1 hour. Single-use.
            </p>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate reset link?</AlertDialogTitle>
            <AlertDialogDescription>
              A one-time sign-in link will be created for{" "}
              {user.email ?? user.id}. The user will be able to sign in
              without their password. This action is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel aria-label="Cancel link generation">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                mutation.mutate();
                setConfirm(false);
              }}
              aria-label="Confirm link generation"
            >
              Generate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
