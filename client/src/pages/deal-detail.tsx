/**
 * /deals/:id — full-page deal-detail surface (P1-28).
 *
 * Pre-port the only way to inspect a deal was the right-side sheet
 * on /deals. Land Investors couldn't share a link to a specific
 * negotiation, and reloading the page lost the open state. This
 * route hosts the same <DealDetailContent /> the sheet renders.
 */
import { useState } from "react";
import { useRoute, Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DealDetailContent } from "@/components/deal-detail-content";
import { useDeal, useDeleteDeal } from "@/hooks/use-deals";
import { useProperties } from "@/hooks/use-properties";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useTerm } from "@/hooks/use-persona";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Briefcase, Trash2 } from "lucide-react";
import type { Deal, Property } from "@shared/schema";

type DealWithProperty = Deal & { property?: Property };

export default function DealDetailPage() {
  const [, params] = useRoute<{ id: string }>("/deals/:id");
  const id = params?.id ? parseInt(params.id, 10) : null;

  const dealLabel = useTerm("entity.deal");
  useDocumentTitle(id ? `${dealLabel} #${id}` : dealLabel);

  const { data: deal, isLoading, error, refetch } = useDeal(id ?? 0);
  const { data: propertiesRaw } = useProperties();
  const { mutate: deleteDeal, isPending: isDeleting } = useDeleteDeal();
  const { toast } = useToast();
  const [showDelete, setShowDelete] = useState(false);

  // Match the deals-list pattern of hydrating each deal with the
  // matching property row so DealDetailContent can render
  // "Yavapai, AZ" instead of "Deal #3".
  const properties = Array.isArray(propertiesRaw) ? propertiesRaw : [];
  const property = deal?.propertyId
    ? properties.find((p: any) => p.id === deal.propertyId)
    : undefined;
  const dealWithProperty: DealWithProperty | undefined = deal
    ? { ...(deal as Deal), property: (deal as any).property ?? (property as any) }
    : undefined;

  if (id == null || Number.isNaN(id)) {
    return (
      <PageShell>
        <BackToDeals />
        <EmptyState
          icon={Briefcase}
          title="Deal not found"
          description="The URL is missing a valid deal ID."
          actionLabel="Back to deals"
          actionIcon={null}
          onAction={() => {
            window.location.href = "/deals";
          }}
        />
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <BackToDeals />
        <div className="space-y-6">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-32 w-full" />
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <BackToDeals />
        <QueryErrorState
          error={error}
          onRetry={() => refetch()}
          title="Couldn't load this deal"
        />
      </PageShell>
    );
  }

  if (!dealWithProperty) {
    return (
      <PageShell>
        <BackToDeals />
        <EmptyState
          icon={Briefcase}
          title="Deal not found"
          description="This deal doesn't exist or you don't have access to it."
          actionLabel="Back to deals"
          actionIcon={null}
          onAction={() => {
            window.location.href = "/deals";
          }}
        />
      </PageShell>
    );
  }

  const handleDelete = () => {
    deleteDeal(dealWithProperty.id, {
      onSuccess: () => {
        toast({ title: "Deal deleted" });
        window.location.href = "/deals";
      },
    });
  };

  return (
    <PageShell>
      <BackToDeals />
      <div className="rounded-xl border bg-background overflow-hidden">
        <DealDetailContent
          deal={dealWithProperty}
          onDelete={() => setShowDelete(true)}
          headerActions={
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setShowDelete(true)}
              className="min-h-[44px] min-w-[44px]"
              aria-label={`Delete ${dealWithProperty.property ? `${dealWithProperty.property.county}, ${dealWithProperty.property.state}` : `deal #${dealWithProperty.id}`}`}
              data-testid="button-delete-deal"
            >
              <Trash2 className="w-5 h-5 text-destructive" aria-hidden="true" />
            </Button>
          }
        />
      </div>
      <ConfirmDialog
        open={showDelete}
        onOpenChange={(open) => !open && setShowDelete(false)}
        title="Delete deal?"
        description={
          dealWithProperty.property
            ? `Delete the ${dealWithProperty.type === "acquisition" ? "acquisition" : "disposition"} for ${dealWithProperty.property.county}, ${dealWithProperty.property.state}? This can't be undone.`
            : `Delete deal #${dealWithProperty.id}? This can't be undone.`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isLoading={isDeleting}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </PageShell>
  );
}

function BackToDeals() {
  return (
    <div className="mb-4">
      <Button asChild variant="ghost" size="sm" className="min-h-11">
        <Link href="/deals" data-testid="link-back-to-deals">
          <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
          Back to deals
        </Link>
      </Button>
    </div>
  );
}
