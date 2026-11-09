/**
 * Click-to-call (W3.9). Opens a dialog that shows the server's verdict BEFORE
 * anything is dialled — why calling is blocked, or that the operator's own
 * phone rings first — and places the call only on an explicit "Call now".
 * The server re-runs every gate on that press; nothing here decides.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { PhoneOutgoing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryErrorState } from "@/components/query-error-state";
import { apiRequest, queryClient } from "@/lib/queryClient";

interface CallVerdict {
  allowed: boolean;
  code: string;
  reason: string;
}

export function ClickToCallAction({ leadId, leadName }: { leadId: number; leadName: string }) {
  const [open, setOpen] = useState(false);
  const url = `/api/leads/${leadId}/call`;
  const verdict = useQuery<CallVerdict>({ queryKey: [url], enabled: open, staleTime: 0 });
  const place = useMutation({
    mutationFn: async () => (await apiRequest("POST", url, undefined, { idempotent: true })).json() as Promise<CallVerdict>,
    onSettled: () => queryClient.invalidateQueries({ queryKey: [`/api/leads/${leadId}/timeline`] }),
  });

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 pointer-fine:sm:min-h-9"
        aria-label={`Call ${leadName}`}
        onClick={() => {
          place.reset();
          setOpen(true);
        }}
        data-testid="button-click-to-call"
      >
        <PhoneOutgoing className="w-4 h-4 mr-2" aria-hidden="true" />
        Call
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Call {leadName}</DialogTitle>
            <DialogDescription>From your own Twilio number. Nothing is recorded.</DialogDescription>
          </DialogHeader>
          {verdict.isLoading ? (
            <div className="space-y-2" data-testid="click-to-call-loading">
              <Skeleton className="h-4 w-full" announceText="Checking whether this call can be placed" />
              <Skeleton className="h-4 w-2/3" announce={false} />
            </div>
          ) : verdict.error ? (
            <QueryErrorState error={verdict.error} onRetry={() => verdict.refetch()} compact />
          ) : (
            <p className="text-sm" role="status" data-testid="click-to-call-verdict">
              {place.isSuccess
                ? place.data.reason
                : place.error
                  ? (place.error as Error).message
                  : verdict.data?.reason}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => place.mutate()}
              disabled={!verdict.data?.allowed || place.isPending || place.isSuccess || Boolean(place.error)}
              data-testid="button-click-to-call-confirm"
            >
              Call now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
