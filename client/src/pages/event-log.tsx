import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Network, Zap, Search, RefreshCw, AlertTriangle,
  CheckCircle, Clock, ChevronDown, ChevronUp, Filter,
} from "lucide-react";
import { format } from "date-fns";
import { relative } from "@/lib/format";
import {
  useEventMeshEvents,
  useEventMeshStats,
  useEventMeshSubscriptions,
} from "@/hooks/use-sovereign-dashboard";

function EventRow({ event }: { event: any }) {
  const [expanded, setExpanded] = useState(false);

  const priorityColors: Record<number, string> = {
    1: "text-red-500",
    2: "text-red-400",
    3: "text-orange-500",
    4: "text-yellow-500",
    5: "text-muted-foreground",
  };

  return (
    <div className="border-b last:border-0 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className={`w-3.5 h-3.5 ${priorityColors[event.priority] ?? "text-muted-foreground"}`} />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-medium">{event.eventType}</span>
              <span className="text-xs text-muted-foreground">on</span>
              <Badge variant="outline" className="text-xs font-mono">{event.channel}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
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
            <Badge variant={
              event.ackedBy && event.ackedBy.length > 0 ? "default" : "secondary"
            } className="text-xs">
              {event.ackedBy && event.ackedBy.length > 0
                ? `Acked (${event.ackedBy.length})`
                : "Awaiting Ack"}
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 ml-6 space-y-2">
          <div className="bg-muted/50 rounded p-3">
            <pre className="text-xs overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(event.payload ?? {}, null, 2)}
            </pre>
          </div>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>ID: {event.eventId}</span>
            <span>Priority: {event.priority}</span>
            {event.retryCount > 0 && <span>Retries: {event.retryCount}</span>}
            {event.expiresAt && (
              <span>Expires: {format(new Date(event.expiresAt), "MMM d, HH:mm")}</span>
            )}
          </div>
          {event.deadLetterReason && (
            <p className="text-xs text-red-500">DLQ Reason: {event.deadLetterReason}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function EventLog() {
  const [channelFilter, setChannelFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const { data: events = [], isLoading: eventsLoading } = useEventMeshEvents(100);
  const { data: stats, isLoading: statsLoading } = useEventMeshStats();
  const { data: subscriptions = [] } = useEventMeshSubscriptions();

  const isLoading = eventsLoading;

  const filteredEvents = Array.isArray(events) ? events.filter((e: any) => {
    if (channelFilter && !e.channel?.includes(channelFilter) && !e.eventType?.includes(channelFilter)) return false;
    if (typeFilter === "dlq" && !e.deadLettered) return false;
    if (typeFilter === "pending" && (e.ackedBy?.length > 0 || !e.requiresAck)) return false;
    return true;
  }) : [];

  return (
    <PageShell isLoading={isLoading}>
      <div className="space-y-6 md:space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Network className="w-6 h-6 text-primary" />
            Event Log
          </h1>
          <p className="text-sm text-muted-foreground">
            Real-time event mesh — published events, subscriptions, and dead-letter queue
          </p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Events</p>
                <p className="text-xl font-bold">{stats.totalEvents?.toLocaleString() ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Channels</p>
                <p className="text-xl font-bold">{stats.channelsActive ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Events/min</p>
                <p className="text-xl font-bold">{stats.recentEventsPerMinute ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground">Subscribers</p>
                <p className="text-xl font-bold">{stats.activeSubscriptions ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  DLQ {(stats.deadLetterDepth ?? 0) > 0 && <AlertTriangle className="w-3 h-3 text-yellow-500" />}
                </p>
                <p className="text-xl font-bold">{stats.deadLetterDepth ?? 0}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Filter by channel or event type..."
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-40">
              <Filter className="w-3.5 h-3.5 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Events</SelectItem>
              <SelectItem value="dlq">Dead Letter</SelectItem>
              <SelectItem value="pending">Pending Ack</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Active Subscriptions */}
        {Array.isArray(subscriptions) && subscriptions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Active Subscriptions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {subscriptions.filter((s: any) => s.isActive).map((sub: any, i: number) => (
                  <Badge key={sub.id ?? i} variant="outline" className="text-xs">
                    <span className="font-medium">{sub.subscriber}</span>
                    <span className="text-muted-foreground mx-1">→</span>
                    <span className="font-mono">{sub.channelPattern}</span>
                    {sub.eventsProcessed != null && (
                      <span className="ml-1 text-muted-foreground">({sub.eventsProcessed})</span>
                    )}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Event Stream */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center justify-between">
              Event Stream
              <Badge variant="secondary">{filteredEvents.length} events</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredEvents.length > 0 ? (
              <div className="max-h-[600px] overflow-y-auto">
                {filteredEvents.map((event: any, i: number) => (
                  <EventRow key={event.id ?? event.eventId ?? i} event={event} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                {channelFilter || typeFilter !== "all"
                  ? "No events match your filters."
                  : "No events published yet. Events will appear here as the system processes business operations."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
