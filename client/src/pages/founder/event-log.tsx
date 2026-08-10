import { useState, useId } from "react";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, EmptyFilter } from "@/components/empty-state";
import { QueryErrorState } from "@/components/query-error-state";
import {
  Network, Zap, Search, AlertTriangle,
  ChevronDown, ChevronUp, Filter,
} from "lucide-react";
import { formatDateTime, relative } from "@/lib/format";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  useEventMeshEvents,
  useEventMeshStats,
  useEventMeshSubscriptions,
} from "@/hooks/use-sovereign-dashboard";

function EventRow({ event }: { event: any }) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();

  const priorityColors: Record<number, string> = {
    1: "text-acr-neg",
    2: "text-acr-neg",
    3: "text-acr-warn",
    4: "text-acr-warn",
    5: "text-muted-foreground",
  };

  return (
    <li className="border-b last:border-0 py-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <Zap
            className={`w-3.5 h-3.5 shrink-0 ${priorityColors[event.priority] ?? "text-muted-foreground"}`}
            aria-label={`Priority ${event.priority}`}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-medium">{event.eventType}</span>
              <span className="text-xs text-muted-foreground">on</span>
              <Badge variant="outline" className="text-xs font-mono">{event.channel}</Badge>
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {event.publisher ?? "unknown"} ·{" "}
              {event.createdAt && relative(event.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {event.deadLettered && (
            <Badge variant="destructive" className="text-xs">DLQ</Badge>
          )}
          {event.requiresAck && (
            <Badge
              variant={event.ackedBy && event.ackedBy.length > 0 ? "default" : "secondary"}
              className="text-xs"
            >
              {event.ackedBy && event.ackedBy.length > 0
                ? <>Acked (<span className="tabular-nums">{event.ackedBy.length}</span>)</>
                : "Awaiting ack"}
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9 min-w-9"
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            aria-controls={detailsId}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${event.eventType} details`}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div id={detailsId} className="mt-2 ml-6 space-y-2">
          <div className="bg-muted/50 rounded p-3">
            <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(event.payload ?? {}, null, 2)}
            </pre>
          </div>
          <dl className="flex gap-4 text-xs text-muted-foreground flex-wrap">
            <div className="flex gap-1">
              <dt>ID:</dt>
              <dd className="font-mono">{event.eventId}</dd>
            </div>
            <div className="flex gap-1">
              <dt>Priority:</dt>
              <dd className="tabular-nums">{event.priority}</dd>
            </div>
            {event.retryCount > 0 && (
              <div className="flex gap-1">
                <dt>Retries:</dt>
                <dd className="tabular-nums">{event.retryCount}</dd>
              </div>
            )}
            {event.expiresAt && (
              <div className="flex gap-1">
                <dt>Expires:</dt>
                <dd className="tabular-nums">{formatDateTime(event.expiresAt)}</dd>
              </div>
            )}
          </dl>
          {event.deadLetterReason && (
            <p className="text-xs text-acr-neg" role="alert">DLQ reason: {event.deadLetterReason}</p>
          )}
        </div>
      )}
    </li>
  );
}

export function EventLogContent() {
  useDocumentTitle("Event log");
  const filterId = useId();
  const typeFilterId = useId();
  const [channelFilter, setChannelFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const {
    data: events = [],
    isLoading: eventsLoading,
    error: eventsError,
    refetch: refetchEvents,
  } = useEventMeshEvents(100);
  const { data: stats, isLoading: statsLoading } = useEventMeshStats();
  const { data: subscriptions = [] } = useEventMeshSubscriptions();

  const activeFilterCount = (channelFilter ? 1 : 0) + (typeFilter !== "all" ? 1 : 0);

  const filteredEvents = Array.isArray(events) ? events.filter((e: any) => {
    if (channelFilter && !e.channel?.includes(channelFilter) && !e.eventType?.includes(channelFilter)) return false;
    if (typeFilter === "dlq" && !e.deadLettered) return false;
    if (typeFilter === "pending" && (e.ackedBy?.length > 0 || !e.requiresAck)) return false;
    return true;
  }) : [];

  return (
    <div className="space-y-6 md:space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" aria-hidden="true" />
            Event log
          </h1>
          <p className="text-sm text-muted-foreground">
            Real-time event mesh — published events, subscriptions, and dead-letter queue.
          </p>
        </div>

        {statsLoading ? (
          <div role="status" aria-busy="true" className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <span className="sr-only">Loading event-mesh stats…</span>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} announce={false} className="h-20 w-full rounded-card" />
            ))}
          </div>
        ) : stats ? (
          <dl className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-4">
                <dt className="text-xs text-muted-foreground">Events</dt>
                <dd className="text-xl font-bold tabular-nums">{(stats.totalEvents ?? 0).toLocaleString()}</dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <dt className="text-xs text-muted-foreground">Channels</dt>
                <dd className="text-xl font-bold tabular-nums">{stats.channelsActive ?? 0}</dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <dt className="text-xs text-muted-foreground">Events/min</dt>
                <dd className="text-xl font-bold tabular-nums">{stats.recentEventsPerMinute ?? 0}</dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <dt className="text-xs text-muted-foreground">Subscribers</dt>
                <dd className="text-xl font-bold tabular-nums">{stats.activeSubscriptions ?? 0}</dd>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <dt className="text-xs text-muted-foreground flex items-center gap-1">
                  DLQ {(stats.deadLetterDepth ?? 0) > 0 && <AlertTriangle className="w-3 h-3 text-acr-warn" aria-hidden="true" />}
                </dt>
                <dd className="text-xl font-bold tabular-nums">{stats.deadLetterDepth ?? 0}</dd>
              </CardContent>
            </Card>
          </dl>
        ) : null}

        <div className="flex gap-3 items-center flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Label htmlFor={filterId} className="sr-only">Filter by channel or event type</Label>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
            <Input
              id={filterId}
              type="search"
              placeholder="Filter by channel or event type…"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="pl-10"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          <Label htmlFor={typeFilterId} className="sr-only">Event status filter</Label>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger id={typeFilterId} className="w-40" aria-label="Event status filter">
              <Filter className="w-3.5 h-3.5 mr-2" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              <SelectItem value="dlq">Dead letter</SelectItem>
              <SelectItem value="pending">Pending ack</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {Array.isArray(subscriptions) && subscriptions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Active subscriptions</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-wrap gap-2" aria-label="Active event subscriptions">
                {subscriptions.filter((s: any) => s.isActive).map((sub: any, i: number) => (
                  <li key={sub.id ?? i}>
                    <Badge variant="outline" className="text-xs">
                      <span className="font-medium">{sub.subscriber}</span>
                      <span className="text-muted-foreground mx-1" aria-hidden="true">→</span>
                      <span className="font-mono">{sub.channelPattern}</span>
                      {sub.eventsProcessed != null && (
                        <span className="ml-1 text-muted-foreground tabular-nums">({sub.eventsProcessed})</span>
                      )}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              Event stream
              <Badge variant="secondary" className="gap-1"><span className="tabular-nums">{filteredEvents.length}</span> events</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {eventsLoading ? (
              <div role="status" aria-busy="true" className="space-y-2">
                <span className="sr-only">Loading events…</span>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} announce={false} className="h-12 w-full rounded-card" />
                ))}
              </div>
            ) : eventsError ? (
              <QueryErrorState
                error={eventsError as Error}
                onRetry={() => refetchEvents()}
                compact
                testId="founder-event-log-error"
              />
            ) : filteredEvents.length > 0 ? (
              <ol className="max-h-[600px] overflow-y-auto" aria-label="Recent events, newest first">
                {filteredEvents.map((event: any, i: number) => (
                  <EventRow key={event.id ?? event.eventId ?? i} event={event} />
                ))}
              </ol>
            ) : activeFilterCount > 0 ? (
              <EmptyFilter
                filterCount={activeFilterCount}
                onClearFilters={() => {
                  setChannelFilter("");
                  setTypeFilter("all");
                }}
                headline="No events match your filters"
              />
            ) : (
              <EmptyState
                framed
                icon={Network}
                headline="No events published yet"
                subtitle="Events appear here as the system processes business operations — every decision and side effect lands on the mesh."
                // TODO(cta): read-only firehose — events are published by the
                // agent runtime, no user action available.
                cta={{ label: "", _noOp: true }}
                testId="founder-event-log-empty"
              />
            )}
          </CardContent>
        </Card>
    </div>
  );
}

export default function FounderEventLogPage() {
  return (
    <PageShell>
      <EventLogContent />
    </PageShell>
  );
}
