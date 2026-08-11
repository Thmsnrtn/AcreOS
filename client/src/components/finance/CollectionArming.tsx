/**
 * Collections arming + confirm surface (founder ruling R-3, 2026-08-11).
 *
 * NAV POSTURE: this is a TAB inside the fixed Finance door — not a new
 * top-level nav entry and not a new AI destination. It renders inside
 * client/src/pages/finance.tsx alongside Portfolio and Book.
 *
 * WHAT IT DOES
 *  1. CONFIRM: lists sequences that are RUNNING but have nobody on record —
 *     rows created when `collection_sequences.auto_start` still defaulted to
 *     TRUE. They keep dispatching (a live collection is not cut off mid-ladder)
 *     and stay listed here until a human confirms the exact ladder.
 *  2. ARM: an unarmed sequence cannot run until it is armed here, and the
 *     arming control is only enabled once the real ladder — every step, its
 *     channel, its timing — has been rendered from the sequence's own `steps`.
 *
 * The ladder is rendered by `describeArmingPlan()` from
 * shared/collections/arming.ts — the SAME function the server chokepoint uses.
 * There is deliberately no placeholder ladder copy in this file: a sequence
 * with no steps says so rather than showing an invented one.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { formatDate } from "@/lib/format";
import { ShieldCheck, ShieldAlert, ShieldOff, Mail, MessageSquare, Phone, Send } from "lucide-react";
import {
  describeArmingPlan,
  type ArmableSequence,
  type ArmingPlan,
  type CollectionLadderStep,
} from "@shared/collections/arming";

interface SequenceRow extends ArmableSequence {
  id: number;
  name: string;
  steps?: CollectionLadderStep[] | null;
}

const CHANNEL_ICON: Record<string, typeof Mail> = {
  email: Mail,
  sms: MessageSquare,
  call: Phone,
  mail: Send,
};

const STATE_BADGE: Record<
  ArmingPlan["state"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  unarmed: { label: "Not armed", variant: "outline" },
  armed_unconfirmed: { label: "Running · needs confirmation", variant: "destructive" },
  armed_stale: { label: "Ladder changed · reconfirm", variant: "destructive" },
  armed_confirmed: { label: "Armed", variant: "default" },
};

/**
 * The disclosure. Every rung comes from the sequence's own steps — this is what
 * makes "the customer saw what will be sent, to whom, and when" true rather
 * than asserted.
 */
function LadderDisclosure({ plan }: { plan: ArmingPlan }) {
  if (plan.totalSteps === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="ladder-empty">
        This sequence has no steps, so there is nothing to send. Add steps before arming it.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Arming this sends <strong>{plan.totalSteps}</strong>{" "}
        {plan.totalSteps === 1 ? "message" : "messages"} to the borrower on each enrolled note,
        over {plan.channels.map((c) => c.toUpperCase()).join(", ")}, {plan.span}.
      </p>
      <ol className="space-y-2" data-testid="ladder-rungs">
        {plan.rungs.map((rung) => {
          const Icon = CHANNEL_ICON[rung.channel] ?? Send;
          return (
            <li
              key={`${rung.stepNumber}-${rung.relativeDays}-${rung.channel}`}
              className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3"
              data-testid={`ladder-rung-${rung.stepNumber}`}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  Step {rung.stepNumber} · {rung.channel.toUpperCase()}
                </p>
                <p className="text-sm text-muted-foreground">
                  Sent {rung.timing} · tone: {rung.escalationLevel}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SequenceCard({
  sequence,
  onArm,
  onDisarm,
  pending,
}: {
  sequence: SequenceRow;
  onArm: (id: number, digest: string) => void;
  onDisarm: (id: number) => void;
  pending: boolean;
}) {
  // Recomputed from the row itself, so the digest submitted with the
  // confirmation is the digest of the ladder actually on screen.
  const plan = useMemo(() => describeArmingPlan(sequence), [sequence]);
  const badge = STATE_BADGE[plan.state];
  const StateIcon =
    plan.state === "armed_confirmed"
      ? ShieldCheck
      : plan.state === "unarmed"
        ? ShieldOff
        : ShieldAlert;

  return (
    <Card data-testid={`collection-sequence-${sequence.id}`} className="floating-window">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="acr-section-h2 text-section-h2 flex items-center gap-2">
              <StateIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {plan.sequenceName}
            </CardTitle>
            {plan.armedBy && plan.armedAt && (
              <CardDescription data-testid={`armed-by-${sequence.id}`}>
                Confirmed by {plan.armedBy} on {formatDate(plan.armedAt)}
              </CardDescription>
            )}
          </div>
          <Badge variant={badge.variant} data-testid={`arming-state-${sequence.id}`}>
            {badge.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {plan.reason && (
          <p
            className="rounded-md border border-border bg-muted/50 p-3 text-sm"
            data-testid={`confirm-reason-${sequence.id}`}
          >
            {plan.reason}
          </p>
        )}

        <LadderDisclosure plan={plan} />

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => onArm(sequence.id, plan.digest)}
            disabled={pending || plan.totalSteps === 0}
            data-testid={`button-arm-${sequence.id}`}
          >
            {plan.needsConfirmation ? "Confirm this ladder" : "Arm this sequence"}
          </Button>
          {plan.armedForDispatch && (
            <Button
              variant="outline"
              onClick={() => onDisarm(sequence.id)}
              disabled={pending}
              data-testid={`button-disarm-${sequence.id}`}
            >
              Stop this sequence
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function CollectionArming() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<number | null>(null);

  const { data, isLoading, error, refetch } = useQuery<SequenceRow[]>({
    queryKey: ["/api/collection-sequences/arming"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/collection-sequences/arming"] });
    queryClient.invalidateQueries({ queryKey: ["/api/collection-sequences/needs-confirmation"] });
    queryClient.invalidateQueries({ queryKey: ["/api/collection-sequences"] });
  };

  // allow-no-invalidation: both arming mutations refresh through the local
  // `invalidate()` helper above, which invalidates the needs-confirmation and
  // sequences queries. The rule matches literal invalidateQueries calls inside
  // the callback and cannot see one hop of indirection.
  const armMutation = useMutation({
    mutationFn: async ({ id, digest }: { id: number; digest: string }) => {
      const res = await apiRequest("POST", `/api/collection-sequences/${id}/arm`, {
        acknowledgedDigest: digest,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sequence armed", description: "The ladder you reviewed is now on record." });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Could not arm sequence", description: err.message, variant: "destructive" });
    },
    onSettled: () => setPendingId(null),
  });

  // allow-no-invalidation: both arming mutations refresh through the local
  // `invalidate()` helper above, which invalidates the needs-confirmation and
  // sequences queries. The rule matches literal invalidateQueries calls inside
  // the callback and cannot see one hop of indirection.
  const disarmMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/collection-sequences/${id}/disarm`);
      return res.json();
    },
    onSuccess: (result: { cancelledEnrollments?: number }) => {
      // Says what the server actually did. The claim "no further messages will
      // be sent" was previously made by a call that only flipped the sequence
      // row — every enrollment already walking the ladder kept sending. The
      // disarm now cancels them, and the toast reports the count rather than
      // asserting a blanket silence.
      const stopped = result?.cancelledEnrollments ?? 0;
      toast({
        title: "Sequence stopped",
        description:
          stopped > 0
            ? `No further messages will be sent. ${stopped} note${stopped === 1 ? "" : "s"} already in this ladder ${stopped === 1 ? "was" : "were"} stopped.`
            : "No further messages will be sent. Nothing was mid-ladder.",
      });
      invalidate();
    },
    onError: (err: Error) => {
      toast({ title: "Could not stop sequence", description: err.message, variant: "destructive" });
    },
    onSettled: () => setPendingId(null),
  });

  const sequences = data ?? [];
  const needsConfirmation = sequences.filter((s) => describeArmingPlan(s).needsConfirmation);
  const rest = sequences.filter((s) => !describeArmingPlan(s).needsConfirmation);

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading collection sequences">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-4">
            <Skeleton className="h-5 w-48" announce={i === 0} announceText="Loading collection sequences" />
            <Skeleton className="h-4 w-full" announce={false} />
            <Skeleton className="h-16 w-full" announce={false} />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <QueryErrorState
        error={error instanceof Error ? error : null}
        onRetry={() => refetch()}
        title="Couldn't load collection sequences"
      />
    );
  }

  if (sequences.length === 0) {
    return (
      <EmptyState
        icon={ShieldOff}
        headline="No collection sequences yet"
        subtitle="A collection sequence is a reminder ladder for borrowers who fall behind. New sequences start switched off — you'll see every step, channel and send date before anything goes out."
        cta={{
          label: "Refresh",
          onClick: () => refetch(),
          "data-testid": "button-refresh-collection-sequences",
        }}
      />
    );
  }

  const onArm = (id: number, digest: string) => {
    setPendingId(id);
    armMutation.mutate({ id, digest });
  };
  const onDisarm = (id: number) => {
    setPendingId(id);
    disarmMutation.mutate(id);
  };

  return (
    <div className="space-y-6" data-testid="collection-arming">
      {needsConfirmation.length > 0 && (
        <section className="space-y-3" aria-labelledby="collections-confirm-heading">
          <div>
            <h3 id="collections-confirm-heading" className="acr-section-h2 text-section-h2">
              Needs your confirmation
            </h3>
            <p className="text-sm text-muted-foreground">
              These sequences are still running — nobody is cut off mid-ladder. They were switched on
              by an old system default rather than by a person, so each one needs someone to confirm
              the exact steps below.
            </p>
          </div>
          {needsConfirmation.map((sequence) => (
            <SequenceCard
              key={sequence.id}
              sequence={sequence}
              onArm={onArm}
              onDisarm={onDisarm}
              pending={pendingId === sequence.id}
            />
          ))}
        </section>
      )}

      {rest.length > 0 && (
        <section className="space-y-3" aria-labelledby="collections-all-heading">
          <h3 id="collections-all-heading" className="acr-section-h2 text-section-h2">
            All sequences
          </h3>
          {rest.map((sequence) => (
            <SequenceCard
              key={sequence.id}
              sequence={sequence}
              onArm={onArm}
              onDisarm={onDisarm}
              pending={pendingId === sequence.id}
            />
          ))}
        </section>
      )}
    </div>
  );
}
