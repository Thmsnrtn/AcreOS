/**
 * /leads/:id — full-page lead-detail surface (P1-28).
 *
 * Pre-port the only way to see one lead's profile was the right-side
 * sheet on /leads. There was no shareable URL — Reyna and Ethan
 * couldn't paste a lead link in Slack. This route hosts the same
 * <LeadDetailContent /> the sheet uses, so the two surfaces never
 * drift.
 */
import { useRoute, Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { LeadDetailContent } from "@/components/lead-detail-content";
import { useLead } from "@/hooks/use-leads";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useTerm } from "@/hooks/use-persona";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileLeadDetail } from "@/components/mobile/MobileLeadDetail";
import { ArrowLeft, User } from "lucide-react";

export default function LeadDetailPage() {
  const [, params] = useRoute<{ id: string }>("/leads/:id");
  const id = params?.id ? parseInt(params.id, 10) : null;

  const leadLabel = useTerm("entity.lead");
  useDocumentTitle(id ? `${leadLabel} #${id}` : leadLabel);

  const { isMobile } = useIsMobile();

  // Mobile gets a phone-shaped surface (call/text/email/maps tiles +
  // mark-contacted + notes capture). The `?desktop=1` query escape is
  // honored so the desktop view stays reachable from mobile when the
  // user explicitly asks for it via the header overflow icon.
  const wantsDesktop =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("desktop") === "1";

  // Branch into two distinct subtrees so hook order stays stable inside
  // each one (the desktop body calls useLead; the mobile component
  // calls its own copy).
  if (id != null && !Number.isNaN(id) && isMobile && !wantsDesktop) {
    return <MobileLeadDetail leadId={id} />;
  }

  return <LeadDetailDesktop id={id} />;
}

function LeadDetailDesktop({ id }: { id: number | null }) {
  const { data: lead, isLoading, error, refetch } = useLead(id ?? 0);

  if (id == null || Number.isNaN(id)) {
    return (
      <PageShell>
        <BackToLeads />
        <EmptyState
          icon={User}
          headline="Lead not found"
          subtitle="The URL is missing a valid lead ID."
          cta={{
            label: "Back to leads",
            onClick: () => { window.location.href = "/leads"; },
            "data-testid": "lead-detail-back",
          }}
          actionIcon={null}
        />
      </PageShell>
    );
  }

  if (isLoading) {
    return (
      <PageShell>
        <BackToLeads />
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
        <BackToLeads />
        <QueryErrorState
          error={error}
          onRetry={() => refetch()}
          title="Couldn't load this lead"
        />
      </PageShell>
    );
  }

  if (!lead) {
    return (
      <PageShell>
        <BackToLeads />
        <EmptyState
          icon={User}
          headline="Lead not found"
          subtitle="This lead doesn't exist or you don't have access to it."
          cta={{
            label: "Back to leads",
            onClick: () => { window.location.href = "/leads"; },
            "data-testid": "lead-detail-not-found-back",
          }}
          actionIcon={null}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <BackToLeads />
      <div className="rounded-xl border bg-background overflow-hidden">
        <LeadDetailContent lead={lead as any} />
      </div>
    </PageShell>
  );
}

function BackToLeads() {
  return (
    <div className="mb-4">
      <Button asChild variant="ghost" size="sm" className="min-h-11">
        <Link href="/leads" data-testid="link-back-to-leads">
          <ArrowLeft className="w-4 h-4 mr-2" aria-hidden="true" />
          Back to leads
        </Link>
      </Button>
    </div>
  );
}
