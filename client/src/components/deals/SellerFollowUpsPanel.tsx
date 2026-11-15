/**
 * Wholesale §6.2 — seller follow-up DRAFTS on the deal record.
 *
 * The server side (server/services/wholesale/sellerFollowUps.ts, mounted at
 * /api/wholesale/deals/:dealId/seller-follow-ups) builds a draft from the
 * operator's OWN follow-up template (Offers page, type "follow_up") and the
 * deal's record, and stores it as a draft — nothing more. This panel is the
 * only client surface on it:
 *
 *   choose a follow-up template
 *   → PREVIEW exactly what the draft will say (GET …/preview writes nothing;
 *     a refusal — opted-out seller, unlinked seller, a token the record
 *     cannot fill — renders the server's own message, as written)
 *   → create the draft (POST; one record, never edited afterwards)
 *   → copy it out into the operator's own email or message tool.
 *
 * PREPARED, NEVER SENT. There is deliberately no send control here — no send
 * button, no mailto, no SMS link. Copy is the only way text leaves the panel,
 * so whatever goes to the seller goes through the operator's own consented
 * surface (no re-fronting platform send rails; no cold texting without
 * written consent).
 *
 * CREATED, NEVER EDITED. A correction is a new draft that supersedes the old
 * one; when a fact a draft cited has moved on the record, the list says which
 * fact, rather than rewriting the stored text.
 *
 * Rendered inside the Docs tab of a deal (a section behind an existing door,
 * per the five-door rule). Visible for wholesaler orgs — and for ANY org that
 * already has follow-up drafts on the deal (data is never hidden by a persona
 * toggle).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, FilePlus2, History, Info, MessageSquareText, ShieldAlert } from "lucide-react";
import { ApiError, apiRequest, fetchJsonArray } from "@/lib/queryClient";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import { Verbs } from "@/lib/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";

/** The slice of an offer template this panel reads (see client/src/pages/offers.tsx). */
interface FollowUpTemplate {
  id: number;
  name: string;
  type: string;
}

interface CitedFact {
  token: string;
  value: string;
  source: string;
}

interface MovedFact {
  token: string;
  source: string;
  snapshot: string;
  current: string;
}

/** GET …/seller-follow-ups/preview — writes nothing. */
interface FollowUpPreview {
  dealId: number;
  propertyId: number;
  leadId: number;
  offerTemplateId: number;
  offerTemplateName: string;
  subject: string;
  body: string;
  facts: CitedFact[];
  factsAsOf: string;
}

/** One row of GET …/seller-follow-ups (newest first). */
interface FollowUpDraft {
  id: number;
  name: string;
  subject: string;
  body: string;
  status: string;
  leadId: number;
  offerTemplateId: number;
  offerTemplateName: string;
  factsAsOf: string;
  facts: CitedFact[];
  supersedes: number | null;
  supersededBy: number | null;
  stale: boolean;
  moved: MovedFact[];
  createdAt: string;
  generatedBy: string | null;
}

/** A 404/422 from these routes carries a message written for the operator. */
function refusalMessageOf(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.status !== 404 && error.status !== 422) return null;
  return error.body?.message ?? null;
}

/** `owner_name` → `owner name` — the token named in plain words, nothing added. */
function tokenLabel(token: string): string {
  return token.replace(/_/g, " ");
}

function FactList({ facts, factsAsOf, testId }: { facts: CitedFact[]; factsAsOf: string; testId: string }) {
  if (facts.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid={testId}>
        This template cites no record facts — its text is used exactly as written.
      </p>
    );
  }
  return (
    <div className="space-y-1" data-testid={testId}>
      <p className="text-xs font-medium text-muted-foreground">
        Facts used, read from the record at {formatDateTime(factsAsOf)}
      </p>
      <ul className="m-0 list-none space-y-1 p-0 text-sm">
        {facts.map((f) => (
          <li key={f.token} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-xs text-muted-foreground">{`{{${f.token}}}`}</span>
            <span className="text-foreground">{f.value}</span>
            <span className="text-xs text-muted-foreground">— {f.source}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SellerFollowUpsPanel({ dealId }: { dealId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: org } = useOrganization();

  const listKey = `/api/wholesale/deals/${dealId}/seller-follow-ups`;

  const {
    data: drafts,
    isLoading: draftsLoading,
    isError: draftsIsError,
    error: draftsError,
    refetch: refetchDrafts,
  } = useQuery<FollowUpDraft[]>({
    queryKey: [listKey],
    queryFn: async () => {
      const res = await apiRequest("GET", listKey);
      return res.json();
    },
  });

  const businessType = (org?.settings as { businessType?: string } | null | undefined)?.businessType;
  const isWholesaler = businessType === "residential_wholesaler";
  const hasRecords = (drafts?.length ?? 0) > 0;
  const visible = isWholesaler || hasRecords;

  // Same cache key as the Offers page, so a template written there shows here.
  const {
    data: templates,
    isLoading: templatesLoading,
    isError: templatesIsError,
    error: templatesError,
    refetch: refetchTemplates,
  } = useQuery<FollowUpTemplate[]>({
    queryKey: ["/api/offer-templates"],
    queryFn: () => fetchJsonArray<FollowUpTemplate>("/api/offer-templates"),
    enabled: visible,
  });
  const followUpTemplates = (templates ?? []).filter((t) => t.type === "follow_up");

  const [templateId, setTemplateId] = useState<number | null>(null);
  /** The draft the next creation corrects, when the operator chose "supersede". */
  const [supersedesId, setSupersedesId] = useState<number | null>(null);

  // ── Preview: the exact subject + body the draft will hold. Writes nothing.
  const previewQuery = useQuery<FollowUpPreview>({
    queryKey: [listKey, "preview", templateId],
    queryFn: async () => {
      const res = await apiRequest("GET", `${listKey}/preview?templateId=${templateId}`);
      return res.json() as Promise<FollowUpPreview>;
    },
    enabled: visible && templateId !== null,
    retry: false,
  });
  const previewRefusal = refusalMessageOf(previewQuery.error);

  // ── Create: exactly one draft record. Sends nothing.
  const createDraft = useMutation({
    mutationFn: async ({ offerTemplateId, supersedes }: { offerTemplateId: number; supersedes: number | null }) => {
      const res = await apiRequest("POST", listKey, {
        offerTemplateId,
        ...(supersedes !== null ? { supersedes } : {}),
      });
      return res.json() as Promise<FollowUpDraft>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [listKey] });
      setSupersedesId(null);
      toast({
        title: data.supersedes ? "Correction drafted" : "Draft created",
        description: "Copy it into your own email or message tool — nothing was sent.",
      });
    },
    onError: (err: Error) => {
      const message = refusalMessageOf(err) ?? err.message;
      toast({
        title: "Couldn't create the draft",
        description: `${message} — nothing was created and nothing was sent.`,
        variant: "destructive",
      });
    },
  });

  const copyBody = async (draft: FollowUpDraft) => {
    try {
      await navigator.clipboard.writeText(draft.body);
      toast({ title: "Draft copied", description: "Paste it into your own email or message tool." });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Your browser refused clipboard access — select the text and copy it by hand.",
        variant: "destructive",
      });
    }
  };

  const supersededDraft = supersedesId !== null ? drafts?.find((d) => d.id === supersedesId) ?? null : null;

  // Persona gate LAST (after hooks): wholesalers see the panel always;
  // other personas only when follow-up drafts already exist on the deal.
  if (!visible) return null;

  return (
    <Card data-testid="seller-follow-ups-panel">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText className="h-4 w-4 text-primary" aria-hidden="true" />
          Seller follow-up drafts
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Prepared drafts — copy into your own email or message tool; nothing is sent from here.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ── Prepare a draft ─────────────────────────────────────────── */}
        <section className="space-y-3" aria-label="Prepare a follow-up draft">
          {templatesLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : templatesIsError ? (
            <QueryErrorState
              compact
              error={templatesError as Error}
              onRetry={() => refetchTemplates()}
              title="Couldn't load your follow-up templates"
              testId="error-state-follow-up-templates"
            />
          ) : followUpTemplates.length === 0 ? (
            <EmptyState
              icon={FilePlus2}
              headline="No follow-up templates yet"
              subtitle="Drafts are built from your own follow-up templates. Write one on the Offers page (type: Follow-up), then come back to prepare a draft here."
              cta={{ label: "Go to Offers", href: "/offers", "data-testid": "button-follow-up-go-to-offers" }}
            />
          ) : (
            <>
              {supersedesId !== null && (
                <div
                  role="status"
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3 text-sm"
                  data-testid="follow-up-superseding-notice"
                >
                  <History className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    The next draft will supersede
                    {supersededDraft
                      ? ` "${supersededDraft.subject}" from ${formatDateTime(supersededDraft.createdAt)}`
                      : ` draft #${supersedesId}`}
                    . The earlier draft stays on the record, marked superseded.
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setSupersedesId(null)}>
                    Don't supersede
                  </Button>
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor={`follow-up-template-${dealId}`}>Follow-up template</Label>
                <Select
                  value={templateId !== null ? String(templateId) : undefined}
                  onValueChange={(v) => setTemplateId(Number(v))}
                >
                  <SelectTrigger
                    id={`follow-up-template-${dealId}`}
                    className="w-full sm:w-80"
                    data-testid="select-follow-up-template"
                  >
                    <SelectValue placeholder="Choose a template to preview" />
                  </SelectTrigger>
                  <SelectContent>
                    {followUpTemplates.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {templateId !== null &&
                (previewQuery.isPending ? (
                  <div className="space-y-2" aria-busy="true">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-28 w-full" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                ) : previewRefusal ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-acr-warn/50 bg-acr-warn/10 p-3"
                    data-testid="follow-up-preview-refusal"
                  >
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-acr-warn" aria-hidden="true" />
                    <div className="min-w-0 space-y-1 text-sm">
                      <p className="font-medium">No draft can be prepared from this template</p>
                      <p className="text-muted-foreground">{previewRefusal}</p>
                    </div>
                  </div>
                ) : previewQuery.isError ? (
                  <QueryErrorState
                    compact
                    error={previewQuery.error as Error}
                    onRetry={() => previewQuery.refetch()}
                    title="Couldn't preview this draft"
                    testId="error-state-follow-up-preview"
                  />
                ) : previewQuery.data ? (
                  <div className="space-y-3 rounded-md border border-border p-4" data-testid="follow-up-preview">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{previewQuery.data.offerTemplateName}</Badge>
                      <Badge variant="secondary">Preview — nothing created yet</Badge>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Subject</p>
                      <p className="text-sm font-medium" data-testid="follow-up-preview-subject">
                        {previewQuery.data.subject}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Body</p>
                      <div
                        className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm"
                        data-testid="follow-up-preview-body"
                      >
                        {previewQuery.data.body}
                      </div>
                    </div>
                    <FactList
                      facts={previewQuery.data.facts}
                      factsAsOf={previewQuery.data.factsAsOf}
                      testId="follow-up-preview-facts"
                    />
                    <Button
                      onClick={() =>
                        createDraft.mutate({ offerTemplateId: previewQuery.data.offerTemplateId, supersedes: supersedesId })
                      }
                      disabled={createDraft.isPending}
                      data-testid="button-create-follow-up-draft"
                    >
                      <FilePlus2 className="mr-2 h-4 w-4" aria-hidden="true" />
                      {createDraft.isPending
                        ? "Creating…"
                        : supersedesId !== null
                          ? "Create superseding draft (sends nothing)"
                          : "Create draft (sends nothing)"}
                    </Button>
                  </div>
                ) : null)}
            </>
          )}
        </section>

        {/* ── Drafts on this deal ─────────────────────────────────────── */}
        <section className="space-y-3" aria-label="Follow-up drafts on this deal">
          <h4 className="text-sm font-medium">Drafts on this deal</h4>
          {draftsLoading ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : draftsIsError ? (
            <QueryErrorState
              compact
              error={draftsError as Error}
              onRetry={() => refetchDrafts()}
              title="Couldn't load this deal's follow-up drafts"
              testId="error-state-follow-up-drafts"
            />
          ) : !hasRecords ? (
            <p className="text-sm text-muted-foreground" data-testid="follow-up-drafts-empty">
              No follow-up drafts on this deal yet.
            </p>
          ) : (
            <ul className="m-0 list-none space-y-3 p-0" data-testid="follow-up-drafts-list">
              {drafts!.map((d) => (
                <li
                  key={d.id}
                  className="space-y-3 rounded-md border border-border p-4"
                  data-testid={`follow-up-draft-${d.id}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-medium">{d.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.offerTemplateName} · created {formatDateTime(d.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {d.supersededBy !== null && (
                        <Badge variant="secondary" data-testid={`badge-follow-up-superseded-${d.id}`}>
                          Superseded
                        </Badge>
                      )}
                      {d.stale && (
                        <Badge
                          variant="outline"
                          className="border-acr-warn/50 text-acr-warn"
                          data-testid={`badge-follow-up-stale-${d.id}`}
                        >
                          Stale — {d.moved.length > 0 ? d.moved.map((m) => tokenLabel(m.token)).join(", ") : "a cited fact"}{" "}
                          changed
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{d.body}</div>

                  <FactList facts={d.facts} factsAsOf={d.factsAsOf} testId={`follow-up-draft-facts-${d.id}`} />

                  {d.stale && d.moved.length > 0 && (
                    <div className="flex items-start gap-2 rounded-md border border-border p-3">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <ul className="m-0 list-none space-y-1 p-0 text-xs text-muted-foreground">
                        {d.moved.map((m) => (
                          <li key={m.token}>
                            <span className="font-medium text-foreground">{tokenLabel(m.token)}</span>: drafted as "
                            {m.snapshot}", the record now says "{m.current}" ({m.source})
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => copyBody(d)}
                      aria-label={`Copy the body of "${d.subject}"`}
                      data-testid={`button-copy-follow-up-${d.id}`}
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                      {Verbs.COPY}
                    </Button>
                    {d.supersededBy === null && followUpTemplates.length > 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setSupersedesId(d.id);
                          if (followUpTemplates.some((t) => t.id === d.offerTemplateId)) {
                            setTemplateId(d.offerTemplateId);
                          }
                        }}
                        data-testid={`button-supersede-follow-up-${d.id}`}
                      >
                        <History className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                        New draft superseding this one
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
