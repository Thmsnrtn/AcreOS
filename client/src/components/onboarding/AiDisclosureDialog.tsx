/**
 * AiDisclosureDialog — Constitution §7 + Colorado SB 24-205 AI-disclosure gate.
 *
 * v2 (2026-09-02, customer autonomy clarity program, spec §1 + §6): the
 * wording is the three sentences of the Pax mental model plus the "you start
 * on Ask before sending" line — every sentence imported from
 * shared/pax-glossary.ts, none typed here — with two buttons, "Got it" and
 * "See what Pax may do" (which opens PAX_CONTROLS_PATH after consent is
 * recorded). Both buttons record consent; there is no third way out.
 *
 * Renders before any path-selection screen in onboarding-v2 (new users) and
 * once, from the app shell, for every EXISTING user whose stored version is
 * not the current one (see AiDisclosureGate below). Blocks further
 * interaction until the customer accepts, at which point the server records
 * an auditable consent row (users.ai_disclosed_at +
 * users.ai_disclosure_version). Acknowledgement stays the consent record.
 *
 * When the disclosure wording changes, bump AI_DISCLOSURE_VERSION
 * ("v2" → "v3"). The onboarding gate and AiDisclosureGate compare the stored
 * version against the current constant; a mismatch re-fires this dialog so
 * re-consent is recorded — exactly once per user, because the accept route
 * writes the new version and the gate reads it back.
 *
 * Customer AI is named "Pax" only. Founder-side codenames are never exposed
 * here.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { PAX_CONTROLS_PATH, PAX_LABELS } from "@shared/pax-glossary";
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

/** Bump this when the disclosure wording materially changes. v2 = the Pax mental model (2026-09-02). */
export const AI_DISCLOSURE_VERSION = "v2";

/** The one status read both gates share (onboarding-v2 and AiDisclosureGate). */
export const AI_DISCLOSURE_STATUS_KEY = ["/api/me/ai-disclosure/status"] as const;

export interface AiDisclosureStatus {
  disclosed: boolean;
  version: string | null;
  at: string | null;
}

/** True when the stored consent is missing or was given for older wording. */
export function isAiDisclosureRequired(status: AiDisclosureStatus | undefined): boolean {
  if (!status) return false;
  return !status.disclosed || status.version !== AI_DISCLOSURE_VERSION;
}

interface AiDisclosureDialogProps {
  /** Controls dialog visibility. Always true while disclosure is pending. */
  open: boolean;
  /** Called after the server confirms the consent write. */
  onAccepted: () => void;
}

type AfterAccept = "stay" | "controls";

export function AiDisclosureDialog({ open, onAccepted }: AiDisclosureDialogProps) {
  const [, navigate] = useLocation();
  // allow-no-invalidation: onSuccess calls the parent's onAccepted() — the dialog closes and gating re-derives
  const acceptMutation = useMutation({
    mutationFn: async (after: AfterAccept) => {
      const resp = await apiRequest("POST", "/api/me/ai-disclosure/accept", {
        version: AI_DISCLOSURE_VERSION,
      });
      await resp.json();
      return after;
    },
    onSuccess: (after) => {
      onAccepted();
      if (after === "controls") navigate(PAX_CONTROLS_PATH);
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
        data-testid="ai-disclosure-dialog"
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-acr-pos-soft/40 flex items-center justify-center flex-shrink-0">
              <Shield className="w-5 h-5 text-acr-pos" aria-hidden="true" />
            </div>
            <DialogTitle className="text-lg font-semibold leading-snug">
              How Pax works
            </DialogTitle>
          </div>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground leading-relaxed space-y-3">
              {PAX_LABELS.mentalModel.map((sentence, i) => (
                <p key={i}>{sentence}</p>
              ))}
              <p className="text-foreground">{PAX_LABELS.youStartOn}</p>
              <p>
                By continuing, you acknowledge AI involvement in the product
                experience.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="mt-4 flex-col gap-2 sm:flex-col sm:space-x-0">
          <Button
            className="w-full min-h-11 bg-acr-pos hover:bg-acr-pos/90 text-white font-semibold"
            onClick={() => acceptMutation.mutate("stay")}
            disabled={acceptMutation.isPending}
            aria-label="Acknowledge the Pax disclosure and continue"
            data-testid="ai-disclosure-got-it"
          >
            {acceptMutation.isPending ? "Saving…" : "Got it"}
          </Button>
          <Button
            variant="outline"
            className="w-full min-h-11"
            onClick={() => acceptMutation.mutate("controls")}
            disabled={acceptMutation.isPending}
            aria-label="Acknowledge the Pax disclosure and open the Pax settings"
            data-testid="ai-disclosure-see-controls"
          >
            See what Pax may do
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * AiDisclosureGate — the app-shell mount that makes a wording bump reach
 * EXISTING users.
 *
 * The onboarding page gates new signups; a user who finished onboarding never
 * returns there, so without this mount a version bump would be recorded for
 * nobody who had already consented. Mounted once in App.tsx's authenticated
 * shell. It renders the dialog only when the signed-in user's stored version
 * is not AI_DISCLOSURE_VERSION, and stands down on /onboarding-v2 (which
 * mounts its own instance) so a new user never sees two.
 *
 * The founder is deliberately skipped: the disclosure is the CONSUMER's
 * consent record under SB 24-205, and the founder is the deployer, not the
 * consumer — the founder plane keeps its own rules (four doors, admin
 * namespace) and is out of this program's scope.
 */
export function AiDisclosureGate() {
  const { user, isFounder } = useAuth();
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const onOnboarding = location.startsWith("/onboarding-v2");
  const enabled = !!user && !isFounder && !onOnboarding;

  const { data } = useQuery<AiDisclosureStatus>({
    queryKey: [...AI_DISCLOSURE_STATUS_KEY],
    queryFn: async () => {
      const resp = await apiRequest("GET", "/api/me/ai-disclosure/status");
      return resp.json();
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  if (!enabled || !isAiDisclosureRequired(data)) return null;

  return (
    <AiDisclosureDialog
      open
      onAccepted={() => {
        // Close immediately on the server's confirmation, then re-read the
        // canonical row so the cache holds server truth, not a client guess.
        queryClient.setQueryData<AiDisclosureStatus>([...AI_DISCLOSURE_STATUS_KEY], (prev) => ({
          disclosed: true,
          version: AI_DISCLOSURE_VERSION,
          at: prev?.at ?? null,
        }));
        void queryClient.invalidateQueries({ queryKey: [...AI_DISCLOSURE_STATUS_KEY] });
      }}
    />
  );
}
