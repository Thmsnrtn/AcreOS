/**
 * AiDisclosureDialog — Constitution §7 + Colorado SB 24-205 AI-disclosure gate.
 *
 * Renders before any path-selection screen in onboarding-v2. Blocks further
 * interaction until the customer clicks "I understand — continue", at which
 * point the server records an auditable consent row (users.ai_disclosed_at +
 * users.ai_disclosure_version).
 *
 * When Beatrice updates the disclosure wording, bump AI_DISCLOSURE_VERSION
 * (e.g. "v1" → "v2"). The onboarding gate compares the stored version against
 * the current constant; a mismatch re-fires this dialog for existing users so
 * re-consent is recorded.
 *
 * Customer AI is named "Pax" only. Sophie, Forge, Atlas are internal — never
 * exposed here.
 */

import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
// DialogContent always renders the macOS traffic-light close button (it's
// hardcoded in the shared component). For this mandatory consent dialog we
// suppress it via the className escape hatch `[&_.traffic-light-close]:hidden`
// rather than forking the shared primitive.
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

/** Bump this when Beatrice materially updates the disclosure wording. */
export const AI_DISCLOSURE_VERSION = "v1";

interface AiDisclosureDialogProps {
  /** Controls dialog visibility. Always true while disclosure is pending. */
  open: boolean;
  /** Called after the server confirms the consent write. */
  onAccepted: () => void;
}

export function AiDisclosureDialog({ open, onAccepted }: AiDisclosureDialogProps) {
  // allow-no-invalidation: onSuccess calls the parent's onAccepted() — the dialog closes and gating re-derives
  const acceptMutation = useMutation({
    mutationFn: async () => {
      const resp = await apiRequest("POST", "/api/me/ai-disclosure/accept", {
        version: AI_DISCLOSURE_VERSION,
      });
      return resp.json();
    },
    onSuccess: () => {
      onAccepted();
    },
  });

  return (
    <Dialog open={open} onOpenChange={() => { /* intentionally non-closable */ }}>
      <DialogContent
        // Prevent the user from dismissing via the Escape key or the
        // close button — disclosure is required before any product use.
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        // Suppress the traffic-light close button — disclosure is mandatory.
        className="max-w-md [&_.traffic-light-close]:hidden"
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-acr-pos-soft/40 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-acr-pos" aria-hidden="true" />
            </div>
            <DialogTitle className="text-lg font-semibold leading-snug">
              AI-powered product
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed space-y-3">
            <p>
              AcreOS is operated by an AI executive team on behalf of the
              founder. The customer-facing AI assistant is named{" "}
              <strong className="text-foreground">Pax</strong> — Pax surfaces
              data and offers suggestions, but every decision about your money
              is yours.
            </p>
            <p>
              By continuing, you acknowledge AI involvement in the product
              experience.
            </p>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-4">
          <Button
            className="w-full min-h-11 bg-acr-pos hover:bg-acr-pos/90 text-white font-semibold"
            onClick={() => acceptMutation.mutate()}
            disabled={acceptMutation.isPending}
            aria-label="Acknowledge AI disclosure and continue to onboarding"
          >
            {acceptMutation.isPending ? "Saving…" : "I understand — continue"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
