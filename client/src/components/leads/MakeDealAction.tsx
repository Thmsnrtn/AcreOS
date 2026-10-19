/**
 * "Make this a deal" — the lead → deal step, on the lead detail (behind the
 * Deals door; no nav entry of its own).
 *
 * Reads GET /api/leads/:id/deal-state: whether the lead's parcel is complete
 * enough to become a property (APN, county, state and acreage — one rule,
 * shared/leads/leadToDeal.ts), and whether an open deal already exists for it.
 * The action is POST /api/leads/:id/convert-to-deal, which creates or reuses
 * the property and the deal in one transaction and is safe to retry; on
 * success the customer lands on the deal.
 *
 * Nothing is filled in for the customer: a lead missing its parcel facts says
 * which ones to add, and offers the lead's own edit form.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Briefcase, ArrowRight, MapPinOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { describeLeadDealMissing, type LeadDealMissingField } from "@shared/leads/leadToDeal";

interface LeadDealState {
  ready: boolean;
  reason: "not_seller" | "missing" | null;
  missing: LeadDealMissingField[];
  existingDealId: number | null;
}

interface Props {
  leadId: number;
  /** Opens the lead's edit form — the CTA when parcel facts are missing. */
  onEdit?: () => void;
}

export function MakeDealAction({ leadId, onEdit }: Props) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const stateUrl = `/api/leads/${leadId}/deal-state`;
  const q = useQuery<LeadDealState>({
    queryKey: [stateUrl],
    queryFn: async () => (await apiRequest("GET", stateUrl)).json(),
  });

  const convert = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/leads/${leadId}/convert-to-deal`);
      return (await res.json()) as { deal: { id: number }; createdDeal: boolean };
    },
    onSuccess: ({ deal, createdDeal }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/deals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      queryClient.invalidateQueries({ queryKey: [stateUrl] });
      toast({ title: createdDeal ? "Deal created" : "Opened the existing deal for this parcel" });
      navigate(`/deals/${deal.id}`);
    },
    onError: (err: Error) =>
      toast({ variant: "destructive", title: "Couldn't make this a deal", description: err.message }),
  });

  if (q.isLoading) {
    return (
      <Card className="glass-panel" data-testid="make-deal-loading">
        <CardContent className="pt-6 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-11 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (q.error) {
    return (
      <QueryErrorState
        error={q.error as Error}
        onRetry={() => q.refetch()}
        isRetrying={q.isFetching}
        title="Couldn't check whether this lead can become a deal"
        compact
        testId="make-deal-error"
      />
    );
  }
  const state = q.data;
  if (!state || state.reason === "not_seller") return null;

  if (state.existingDealId != null) {
    const id = state.existingDealId;
    return (
      <Button
        variant="outline"
        className="w-full min-h-11"
        onClick={() => navigate(`/deals/${id}`)}
        data-testid="button-open-lead-deal"
      >
        <Briefcase className="w-4 h-4 mr-2" aria-hidden="true" />
        Open the deal for this parcel
        <ArrowRight className="w-4 h-4 ml-2" aria-hidden="true" />
      </Button>
    );
  }

  if (!state.ready) {
    return (
      <div data-testid="make-deal-missing">
        <EmptyState
          icon={MapPinOff}
          headline="Not ready to become a deal"
          subtitle={describeLeadDealMissing(state.missing)}
          cta={
            onEdit
              ? { label: "Edit lead", onClick: onEdit, "data-testid": "button-make-deal-edit-lead" }
              : // TODO(cta): rendered without an edit handler — the lead's own page offers the edit
                { label: "", _noOp: true }
          }
        />
      </div>
    );
  }

  return (
    <Button
      className="w-full min-h-11"
      onClick={() => convert.mutate()}
      disabled={convert.isPending}
      data-testid="button-make-deal"
    >
      <Briefcase className="w-4 h-4 mr-2" aria-hidden="true" />
      {convert.isPending ? "Making it a deal…" : "Make this a deal"}
    </Button>
  );
}
