/**
 * PostCallSheet — return-from-call follow-up.
 *
 * When a user taps Call/Text on a lead card, we stash a
 * `pendingContactEvent` flag in sessionStorage with {leadId, channel,
 * leadName}. The contact-event POST (lastContactedAt bump + activity
 * row) has already fired before the dialer opened, so the data layer
 * already knows the call happened — this sheet only enriches it with
 * an OUTCOME ("Hot / Warm / Cold / No answer / Wrong number").
 *
 * Trigger: `document.visibilitychange` back to "visible" with a pending
 * flag present. We mount this once at the MobileLeadList level (the
 * starting surface for tap-to-call), watch the visibility event, and
 * pop the sheet at most once per pending event.
 *
 * If the user dismisses without choosing, we still keep the
 * lastContactedAt write from the optimistic POST — we don't lose the
 * "I called" signal. Only the outcome is optional.
 */

import { useEffect, useState, useCallback } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

export interface PendingContactEvent {
  leadId: number;
  leadName: string;
  channel: "phone" | "sms";
  /** epoch ms when the call/text chip was tapped. */
  startedAt: number;
}

const STORAGE_KEY = "acreos.pendingContactEvent";

/** Persist a pending event before the dialer opens. */
export function setPendingContactEvent(event: PendingContactEvent): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(event));
  } catch {
    /* sessionStorage can throw in private mode — ignore */
  }
}

function readPending(): PendingContactEvent | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingContactEvent;
    if (typeof parsed?.leadId !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearPending() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

type Outcome = "hot" | "warm" | "cold" | "no_answer" | "wrong_number";

const OUTCOMES: Array<{ id: Outcome; label: string; tone: string }> = [
  { id: "hot", label: "Hot", tone: "bg-rose-500/15 text-rose-700 dark:text-rose-400" },
  { id: "warm", label: "Warm", tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  { id: "cold", label: "Cold", tone: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  { id: "no_answer", label: "No answer", tone: "bg-muted text-foreground" },
  { id: "wrong_number", label: "Wrong number", tone: "bg-muted text-foreground" },
];

/**
 * Returns the time gap (ms) we require between chip-tap and app-visible
 * before showing the outcome sheet. The dialer transition + a quick
 * conversation easily clears this; an accidental misfire in <2s should
 * not surface a sheet asking how the (non-)call went.
 */
const MIN_GAP_MS = 2000;

export function PostCallSheet() {
  const [pending, setPending] = useState<PendingContactEvent | null>(null);
  const [submitting, setSubmitting] = useState<Outcome | null>(null);
  const qc = useQueryClient();

  const onVisibility = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    const ev = readPending();
    if (!ev) return;
    if (Date.now() - ev.startedAt < MIN_GAP_MS) return;
    setPending(ev);
  }, []);

  useEffect(() => {
    // On mount, also check — covers the path where the user comes back
    // to the app via re-foreground while the component first paints.
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [onVisibility]);

  const submit = async (outcome: Outcome) => {
    if (!pending) return;
    setSubmitting(outcome);
    try {
      await apiRequest("POST", `/api/leads/${pending.leadId}/contact-event`, {
        channel: pending.channel,
        method: "tap",
        outcome,
      });
      qc.invalidateQueries({ queryKey: ["/api/leads"] });
      qc.invalidateQueries({ queryKey: [`/api/leads/${pending.leadId}/activities`] });
    } catch {
      // Outcome logging is best-effort: the contact event itself was
      // already written before the dialer opened. Swallow.
    } finally {
      clearPending();
      setPending(null);
      setSubmitting(null);
    }
  };

  const dismiss = () => {
    clearPending();
    setPending(null);
  };

  if (!pending) return null;

  return (
    <Sheet
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <SheetContent
        side="bottom"
        className="rounded-t-2xl"
        data-testid="post-call-sheet"
      >
        <SheetHeader className="text-left">
          <SheetTitle>How'd it go with {pending.leadName}?</SheetTitle>
          <SheetDescription>
            Tag the outcome so Pax can prioritize tomorrow's brief.
          </SheetDescription>
        </SheetHeader>
        <div className="grid grid-cols-2 gap-2 mt-4">
          {OUTCOMES.map((o) => (
            <Button
              key={o.id}
              variant="outline"
              className={`h-12 ${o.tone}`}
              disabled={submitting !== null}
              onClick={() => submit(o.id)}
              data-testid={`post-call-outcome-${o.id}`}
            >
              {submitting === o.id ? "Saving…" : o.label}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          className="w-full mt-3"
          onClick={dismiss}
          data-testid="post-call-dismiss"
        >
          Skip
        </Button>
      </SheetContent>
    </Sheet>
  );
}

export default PostCallSheet;
