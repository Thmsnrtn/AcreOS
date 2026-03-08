import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Mail, MessageSquare, Phone, FileText, DollarSign,
  GitBranch, Plus, AlertCircle, Loader2,
} from "lucide-react";
import { formatDistanceToNow, format, isToday, isYesterday } from "date-fns";

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

const FILTER_TABS = [
  { id: "all",      label: "All",            eventTypes: [] },
  { id: "contacts", label: "Contacts",       eventTypes: ["call_made", "note_added", "sms_sent"] },
  { id: "offers",   label: "Offers",         eventTypes: ["offer_sent", "offer_accepted", "offer_rejected", "stage_changed"] },
  { id: "payments", label: "Payments",       eventTypes: ["payment_received"] },
  { id: "comms",    label: "Communications", eventTypes: ["email_sent", "mail_sent"] },
] as const;

const EVENT_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  email_sent:       { icon: <Mail className="w-4 h-4" />,          color: "border-blue-400",    label: "Email" },
  sms_sent:         { icon: <MessageSquare className="w-4 h-4" />, color: "border-green-400",   label: "SMS" },
  mail_sent:        { icon: <Mail className="w-4 h-4" />,          color: "border-purple-400",  label: "Mail" },
  call_made:        { icon: <Phone className="w-4 h-4" />,         color: "border-cyan-400",    label: "Call" },
  note_added:       { icon: <FileText className="w-4 h-4" />,      color: "border-gray-400",    label: "Note" },
  stage_changed:    { icon: <GitBranch className="w-4 h-4" />,     color: "border-yellow-400",  label: "Stage" },
  offer_sent:       { icon: <FileText className="w-4 h-4" />,      color: "border-orange-400",  label: "Offer" },
  offer_accepted:   { icon: <FileText className="w-4 h-4" />,      color: "border-green-500",   label: "Accepted" },
  offer_rejected:   { icon: <FileText className="w-4 h-4" />,      color: "border-red-400",     label: "Rejected" },
  payment_received: { icon: <DollarSign className="w-4 h-4" />,    color: "border-emerald-500", label: "Payment" },
  deal_created:     { icon: <Plus className="w-4 h-4" />,          color: "border-indigo-400",  label: "Deal" },
};

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMMM d, yyyy");
}

function groupByDay(events: ActivityEvent[]): [string, ActivityEvent[]][] {
  const map = new Map<string, ActivityEvent[]>();
  for (const e of events) {
    const label = dayLabel(e.eventDate);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(e);
  }
  return Array.from(map.entries());
}

export default function ActivityPage() {
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
  const PAGE_SIZE = 50;

  const filterConfig = FILTER_TABS.find(t => t.id === activeFilter)!;
  const eventTypesParam = filterConfig.eventTypes.length > 0
    ? `&eventTypes=${filterConfig.eventTypes.join(",")}`
    : "";

  const { data, isLoading, isError } = useQuery<ActivityResponse>({
    queryKey: ["/api/activity", activeFilter, offset],
    queryFn: () =>
      fetch(`/api/activity?limit=${PAGE_SIZE}&offset=${offset}${eventTypesParam}`)
        .then(r => r.json()),
  });

  function handleFilterChange(id: string) {
    setActiveFilter(id);
    setOffset(0);
  }

  const groups = groupByDay(data?.events ?? []);

  return (
    <PageShell>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Activity Feed</h1>
          <p className="text-muted-foreground text-sm mt-1">All actions across your organization</p>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 flex-wrap">
          {FILTER_TABS.map(tab => (
            <Button
              key={tab.id}
              size="sm"
              variant={activeFilter === tab.id ? "default" : "outline"}
              onClick={() => handleFilterChange(tab.id)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading activity…
          </div>
        )}

        {isError && (
          <div className="flex items-center gap-2 text-destructive py-8">
            <AlertCircle className="w-4 h-4" />
            Failed to load activity feed.
          </div>
        )}

        {!isLoading && !isError && groups.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            No activity recorded yet.
          </div>
        )}

        {groups.map(([day, events]) => (
          <div key={day} className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">{day}</p>
            {events.map(event => {
              const meta = EVENT_META[event.eventType] ?? {
                icon: <FileText className="w-4 h-4" />,
                color: "border-gray-300",
                label: event.eventType,
              };
              return (
                <Card key={event.id} className={`border-l-4 ${meta.color}`}>
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
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(event.eventDate), { addSuffix: true })}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ))}

        {data?.hasMore && (
          <div className="flex justify-center pt-2 pb-4">
            <Button variant="outline" onClick={() => setOffset(o => o + PAGE_SIZE)}>
              Load more
            </Button>
          </div>
        )}
      </div>
    </PageShell>
  );
}
