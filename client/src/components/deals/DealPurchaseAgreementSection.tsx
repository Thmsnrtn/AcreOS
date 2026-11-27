/**
 * The deal's own door into the purchase-agreement chain (Deals → a deal →
 * Documents tab). Before this, the chain was reachable only from the Contracts
 * tab of /offers, so an operator standing on an accepted deal had no way to
 * prepare its contract from the deal itself.
 *
 * Nothing new is built here: the review → draft → send dialog is the same
 * component the Contracts tab uses (ContractReviewDialog), every rule lives on
 * the server (which deals are eligible, which states have a reviewed template,
 * which fields are missing and where to fix them), and the hand-off is the
 * pre-existing native signing rail. The list shows the documents this deal
 * already has, read from generated_documents — the same state every other
 * document surface reads.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJsonArray } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { ScrollText } from "lucide-react";
import { ContractReviewDialog } from "@/components/deals/ContractReviewDialog";
import type { GeneratedDocument } from "@shared/schema";

/** generated_documents.status, in words. Never "sent": AcreOS emails no one. */
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft — not sent",
  pending_signature: "Awaiting signatures",
  partially_signed: "Partially signed",
  signed: "Signed",
  final: "Final",
  archived: "Archived",
  cancelled: "Cancelled",
};

export function DealPurchaseAgreementSection({
  dealId,
  dealLabel,
}: {
  dealId: number;
  dealLabel: string;
}) {
  const [reviewing, setReviewing] = useState(false);

  const documentsQuery = useQuery<GeneratedDocument[]>({
    queryKey: ["/api/generated-documents", { dealId }],
    queryFn: () => fetchJsonArray<GeneratedDocument>(`/api/generated-documents?dealId=${dealId}`),
  });
  const agreements = (documentsQuery.data ?? []).filter((d) => d.type === "purchase_agreement");

  return (
    <Card className="shadow-acr-1" data-testid="section-deal-purchase-agreement">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Purchase agreement</CardTitle>
        <CardDescription>
          AcreOS assembles it from this deal's accepted amount, closing date,
          property and seller, shows you exactly what would go out, and only
          then — as a separate click — hands it to the signing rail.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {documentsQuery.isPending ? (
          <Skeleton className="h-10 w-full" />
        ) : documentsQuery.isError ? (
          <QueryErrorState
            error={documentsQuery.error as Error}
            onRetry={() => documentsQuery.refetch()}
            title="Couldn't load this deal's documents"
            testId="deal-purchase-agreements-error"
          />
        ) : agreements.length > 0 ? (
          <ul className="m-0 list-none space-y-2 p-0" aria-label="Purchase agreements on this deal">
            {agreements.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-2 text-sm"
                data-testid={`deal-purchase-agreement-${doc.id}`}
              >
                <span className="min-w-0 truncate">{doc.name}</span>
                <Badge variant="outline" className="shrink-0">
                  {STATUS_LABEL[doc.status] ?? doc.status.replace(/_/g, " ")}
                </Badge>
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          variant="outline"
          className="min-h-[44px]"
          onClick={() => setReviewing(true)}
          data-testid="button-prepare-purchase-agreement"
        >
          <ScrollText className="mr-2 h-4 w-4" aria-hidden="true" />
          Prepare purchase agreement
        </Button>
      </CardContent>
      <ContractReviewDialog
        dealId={reviewing ? dealId : null}
        dealLabel={dealLabel}
        onClose={() => setReviewing(false)}
      />
    </Card>
  );
}
