import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  Mail, MessageSquare, Phone, FileText, DollarSign,
  GitBranch, Plus, Sparkles,
} from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { relative } from "@/lib/format";
import { PAX_LABELS, PAX_RECEIPT_WORDS } from "@shared/pax-glossary";

interface ActivityEvent {
  id: number;
  entityType: string;
  entityId: number;
  eventType: string;
  description: string;
  userId?: string;
  eventDate: string;
  metadata?: {
    subject?: string;
    recipient?: string;
    amount?: number;
    previousStage?: string;
    newStage?: string;
    campaignName?: string;
  };
}

interface ActivityResponse {
  events: ActivityEvent[];
  hasMore: boolean;
  total: number;
}

/**
 * One row of GET /api/pax/receipts — "What Pax did" (the Pax controls spec
 * §4.7): activity_log rows with agent_type = 'pax', read through
 * server/services/paxReceiptsReader.ts. `mode` is how it happened — asked /
 * ran on its own / rule — and `sent` is the append-only pax_sends row for a
 * send you approved. Every field comes from a row; nothing is inferred here.
 */
interface PaxReceiptItem {
  id: number;
  at: string;
  actor: "pax" | "rule";
  origin: string | null;
  group: string | null;
  mode: "asked" | "on_its_own" | "rule";
  modeLabel?: string;
  action: string;
  entityType: string;
  entityId: number;
  entityLabel?: string;
  summary: string;
  before?: unknown;
  after?: unknown;
  pendingActionId?: number;
  sent?: { channel: string; recipientRef: string | null; sentAt: string | null };
}

interface PaxReceiptsPage {
  items: PaxReceiptItem[];
  nextCursor: string | null;
}

const PAX_FILTER_ID = "pax";

const FILTER_TABS = [
  { id: "all",      label: "All",            eventTypes: [] },
  { id: "contacts", label: "Contacts",       eventTypes: ["call_made", "note_added", "sms_sent"] },
  { id: "offers",   label: "Offers",         eventTypes: ["offer_sent", "offer_accepted", "offer_rejected", "stage_changed"] },
  { id: "payments", label: "Payments",       eventTypes: ["payment_received"] },
  { id: "comms",    label: "Communications", eventTypes: ["email_sent", "mail_sent"] },
  // "What Pax did" — reads the receipts route, not /api/activity (the
  // receipt writer lands in activity_log, which /api/activity never reads).
  { id: PAX_FILTER_ID, label: "Pax",         eventTypes: [] },
] as const;

const EVENT_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  email_sent:       { icon: <Mail className="w-4 h-4" aria-hidden="true" />,          color: "border-acr-accent",    label: "Email" },
  sms_sent:         { icon: <MessageSquare className="w-4 h-4" aria-hidden="true" />, color: "border-acr-pos",   label: "SMS" },
  mail_sent:        { icon: <Mail className="w-4 h-4" aria-hidden="true" />,          color: "border-acr-brand",  label: "Mail" },
  call_made:        { icon: <Phone className="w-4 h-4" aria-hidden="true" />,         color: "border-acr-accent",    label: "Call" },
  note_added:       { icon: <FileText className="w-4 h-4" aria-hidden="true" />,      color: "border-border",    label: "Note" },
  stage_changed:    { icon: <GitBranch className="w-4 h-4" aria-hidden="true" />,     color: "border-acr-warn",  label: "Stage" },
  offer_sent:       { icon: <FileText className="w-4 h-4" aria-hidden="true" />,      color: "border-acr-warn",  label: "Offer" },
  offer_accepted:   { icon: <FileText className="w-4 h-4" aria-hidden="true" />,      color: "border-acr-pos",   label: "Accepted" },
  offer_rejected:   { icon: <FileText className="w-4 h-4" aria-hidden="true" />,      color: "border-acr-neg",     label: "Rejected" },
  payment_received: { icon: <DollarSign className="w-4 h-4" aria-hidden="true" />,    color: "border-acr-pos", label: "Payment" },
  deal_created:     { icon: <Plus className="w-4 h-4" aria-hidden="true" />,          color: "border-acr-accent",  label: "Deal" },
};

/** The third column of a receipt row, from the glossary's three words. */
const RECEIPT_MODE_WORD: Record<PaxReceiptItem["mode"], string> = {
  asked: PAX_RECEIPT_WORDS.asked,
  on_its_own: PAX_RECEIPT_WORDS.onItsOwn,
  rule: PAX_RECEIPT_WORDS.rule,
};

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMMM d, yyyy");
}

function groupByDay<T>(rows: T[], dateOf: (row: T) => string): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const label = dayLabel(dateOf(row));
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(row);
  }
  return Array.from(map.entries());
}

const PAGE_SIZE = 50;

async function fetchReceiptsPage(cursor: string | null): Promise<PaxReceiptsPage> {
  const url = `/api/pax/receipts?limit=${PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Couldn't load receipts (${res.status})`);
  return res.json();
}

// `embedded` — mounted inside the Pax overflow Sheet (pax-overflow-menu.tsx),
// which already lives inside the app shell. See PageShellProps.embedded (T0-9).
// `initialFilter` — the Sheet opens straight on "What Pax did"; the standalone
// route reads `?actor=pax` for the same thing (the /ai footer link).
export default function ActivityPage({
  embedded = false,
  initialFilter,
}: {
  embedded?: boolean;
  initialFilter?: string;
}) {
  useDocumentTitle("Activity feed");
  // The host surface (Sheet header / standalone shell) owns the H1 when embedded.
  const HeadingTag = embedded ? ("h2" as const) : ("h1" as const);
  const search = useSearch();
  const [activeFilter, setActiveFilter] = useState<string>(() => {
    if (initialFilter && FILTER_TABS.some((t) => t.id === initialFilter)) return initialFilter;
    return new URLSearchParams(search).get("actor") === PAX_FILTER_ID ? PAX_FILTER_ID : "all";
  });
  const [offset, setOffset] = useState(0);
  const isPax = activeFilter === PAX_FILTER_ID;

  const filterConfig = FILTER_TABS.find(t => t.id === activeFilter)!;
  const eventTypesParam = filterConfig.eventTypes.length > 0
    ? `&eventTypes=${filterConfig.eventTypes.join(",")}`
    : "";

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery<ActivityResponse>({
    queryKey: ["/api/activity", activeFilter, offset],
    queryFn: () =>
      fetch(`/api/activity?limit=${PAGE_SIZE}&offset=${offset}${eventTypesParam}`)
        .then(r => r.json()),
    enabled: !isPax,
  });

  const receipts = useInfiniteQuery({
    queryKey: ["/api/pax/receipts"],
    queryFn: ({ pageParam }) => fetchReceiptsPage(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last: PaxReceiptsPage) => last.nextCursor ?? undefined,
    enabled: isPax,
  });

  function handleFilterChange(id: string) {
    setActiveFilter(id);
    setOffset(0);
  }

  const groups = groupByDay(data?.events ?? [], (e) => e.eventDate);
  const receiptRows = receipts.data?.pages.flatMap((p) => p.items) ?? [];
  const receiptGroups = groupByDay(receiptRows, (r) => r.at);

  return (
    <PageShell embedded={embedded}>
      <div className="space-y-4">
        <div>
          <HeadingTag className="text-2xl font-semibold">{isPax ? PAX_LABELS.receipts : "Activity feed"}</HeadingTag>
          <p className="text-muted-foreground text-sm mt-1">
            {isPax
              ? "Every change Pax made and every rule that ran — when, what, which record, and whether you asked."
              : "All actions across your organization."}
          </p>
        </div>

        {/* Filter pills */}
        <div role="group" aria-label="Filter activity by category" className="flex gap-2 flex-wrap">
          {FILTER_TABS.map(tab => (
            <Button
              key={tab.id}
              size="sm"
              variant={activeFilter === tab.id ? "default" : "outline"}
              onClick={() => handleFilterChange(tab.id)}
              aria-pressed={activeFilter === tab.id}
              className="min-h-11 md:min-h-9"
              data-testid={`activity-filter-${tab.id}`}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {(isPax ? receipts.isLoading : isLoading) && (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="border-l-4 border-border">
                <CardContent className="py-3 px-4 flex items-start gap-3">
                  <Skeleton className="h-4 w-4 rounded-full mt-0.5" announce={i === 0} announceText="Loading activity" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" announce={false} />
                    <Skeleton className="h-3 w-1/3" announce={false} />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" announce={false} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!isPax && isError && (
          <QueryErrorState
            error={error as Error}
            onRetry={() => refetch()}
            isRetrying={isFetching}
            title="Couldn't load the activity feed"
            description="The records themselves are unchanged. Try again, or reload if this keeps happening."
          />
        )}

        {isPax && receipts.isError && (
          <QueryErrorState
            error={receipts.error as Error}
            onRetry={() => receipts.refetch()}
            isRetrying={receipts.isFetching}
            title={`Couldn't load ${PAX_LABELS.receipts}`}
            description="The receipts themselves are unchanged. Try again, or reload if this keeps happening."
          />
        )}

        {!isPax && !isLoading && !isError && groups.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            No activity recorded yet.
          </div>
        )}

        {isPax && !receipts.isLoading && !receipts.isError && receiptRows.length === 0 && (
          <div className="text-center py-16 text-muted-foreground" data-testid="pax-receipts-empty">
            Nothing yet. When Pax changes a record or a rule runs, it shows up here.
          </div>
        )}

        {!isPax && groups.map(([day, events]) => (
          <section key={day} className="space-y-2" aria-label={`Activity on ${day}`}>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">{day}</h2>
            <ul className="space-y-2" aria-label={`Events on ${day}`}>
              {events.map(event => {
                const meta = EVENT_META[event.eventType] ?? {
                  icon: <FileText className="w-4 h-4" aria-hidden="true" />,
                  color: "border-border",
                  label: event.eventType.replace(/_/g, ' '),
                };
                return (
                  <li key={event.id}>
                    <Card className={`border-l-4 ${meta.color}`}>
                      <CardContent className="py-3 px-4 flex items-start gap-3">
                        <span className="mt-0.5 text-muted-foreground">{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-snug">{event.description}</p>
                          {event.metadata?.subject && (
                            <p className="text-xs text-muted-foreground truncate">"{event.metadata.subject}"</p>
                          )}
                        </div>
                        <div className="text-right shrink-0 space-y-1">
                          <Badge variant="outline" className="text-xs">{meta.label}</Badge>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {relative(event.eventDate)}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {/* What Pax did — when · what · which record · asked / ran on its own / rule */}
        {isPax && receiptGroups.map(([day, rows]) => (
          <section key={day} className="space-y-2" aria-label={`${PAX_LABELS.receipts} on ${day}`}>
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">{day}</h2>
            <ul className="space-y-2" aria-label={`Receipts on ${day}`}>
              {rows.map((row) => {
                const modeWord = row.modeLabel ?? RECEIPT_MODE_WORD[row.mode] ?? row.mode;
                const record = row.entityLabel ?? `${row.entityType.replace(/_/g, " ")} #${row.entityId}`;
                return (
                  <li key={row.id} data-testid={`pax-receipt-${row.id}`}>
                    <Card className={`border-l-4 ${row.mode === "asked" ? "border-acr-pos" : row.mode === "rule" ? "border-acr-brand" : "border-acr-warn"}`}>
                      <CardContent className="py-3 px-4 flex items-start gap-3">
                        <span className="mt-0.5 text-muted-foreground"><Sparkles className="w-4 h-4" aria-hidden="true" /></span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm leading-snug">{row.summary}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {record}
                            {row.sent?.channel && <span> · sent by {row.sent.channel}</span>}
                          </p>
                        </div>
                        <div className="text-right shrink-0 space-y-1">
                          <Badge variant="outline" className="text-xs" aria-label={`How: ${modeWord}`}>{modeWord}</Badge>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {relative(row.at)}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {!isPax && data?.hasMore && (
          <div className="flex justify-center pt-2 pb-4">
            <Button
              variant="outline"
              onClick={() => setOffset(o => o + PAGE_SIZE)}
              className="min-h-11"
              aria-label="Load more activity events"
            >
              Load more
            </Button>
          </div>
        )}

        {isPax && receipts.hasNextPage && (
          <div className="flex justify-center pt-2 pb-4">
            <Button
              variant="outline"
              onClick={() => receipts.fetchNextPage()}
              disabled={receipts.isFetchingNextPage}
              className="min-h-11"
              aria-label="Load more receipts"
            >
              {receipts.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}
