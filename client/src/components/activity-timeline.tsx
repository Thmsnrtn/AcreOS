import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { 
  Mail, MailOpen, MousePointer, MessageSquare, MessageCircle,
  FileText, Package, PhoneOutgoing, PhoneIncoming, StickyNote,
  ArrowRightCircle, DollarSign, Upload, Filter, ChevronDown, ChevronUp, Loader2
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ActivityEvent, ActivityEventType } from "@shared/schema";
import { ACTIVITY_EVENT_TYPES } from "@shared/schema";

const eventTypeIcons: Record<ActivityEventType, typeof Mail> = {
  email_sent: Mail,
  email_opened: MailOpen,
  email_clicked: MousePointer,
  sms_sent: MessageSquare,
  sms_delivered: MessageCircle,
  mail_sent: FileText,
  mail_delivered: Package,
  call_made: PhoneOutgoing,
  call_received: PhoneIncoming,
  note_added: StickyNote,
  stage_changed: ArrowRightCircle,
  payment_received: DollarSign,
  document_uploaded: Upload,
};

const eventTypeColors: Record<ActivityEventType, string> = {
  email_sent: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  email_opened: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  email_clicked: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  sms_sent: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300",
  sms_delivered: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  mail_sent: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  mail_delivered: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  call_made: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  call_received: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  note_added: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  stage_changed: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  payment_received: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  document_uploaded: "bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

interface TimelineEventProps {
  event: ActivityEvent;
}

function TimelineEvent({ event }: TimelineEventProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const eventType = event.eventType as ActivityEventType;
  const Icon = eventTypeIcons[eventType] || FileText;
  const colorClass = eventTypeColors[eventType] || "bg-gray-100 text-gray-700";
  const eventInfo = ACTIVITY_EVENT_TYPES[eventType];
  const eventDate = new Date(event.eventDate);
  const metadata = event.metadata as Record<string, unknown> | null;
  const hasMetadata = metadata && Object.keys(metadata).length > 0;

  return (
    <div className="flex gap-3 pb-4" data-testid={`timeline-event-${event.id}`}>
      <div className="flex flex-col items-center">
        <div className={`flex items-center justify-center w-8 h-8 rounded-full ${colorClass}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="w-0.5 flex-1 bg-border mt-2" />
      </div>
      <div className="flex-1 pb-2">
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" size="sm" className={colorClass}>
                  {eventInfo?.name || eventType}
                </Badge>
                {event.campaignId && (
                  <Badge variant="secondary" size="sm">
                    Campaign
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-foreground" data-testid={`timeline-event-description-${event.id}`}>
                {event.description}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-muted-foreground">
                <span title={format(eventDate, "PPpp")}>
                  {formatDistanceToNow(eventDate, { addSuffix: true })}
                </span>
                {event.userId && (
                  <>
                    <span>by</span>
                    <span className="font-medium">{event.userId}</span>
                  </>
                )}
              </div>
            </div>
            {hasMetadata && (
              <CollapsibleTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon"
                  data-testid={`timeline-event-expand-${event.id}`}
                >
                  {isExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
            )}
          </div>
          {hasMetadata && (
            <CollapsibleContent>
              <div 
                className="mt-2 p-2 bg-muted/50 rounded-md text-sm"
                data-testid={`timeline-event-metadata-${event.id}`}
              >
                <dl className="space-y-1">
                  {metadata && Object.entries(metadata).map(([key, value]) => {
                    if (value === undefined || value === null) return null;
                    const displayKey = key
                      .replace(/([A-Z])/g, " $1")
                      .replace(/^./, (s) => s.toUpperCase())
                      .trim();
                    let displayValue = String(value);
                    if (key === "amount" && typeof value === "number") {
                      displayValue = new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                      }).format(value);
                    } else if (key === "callDuration" && typeof value === "number") {
                      const mins = Math.floor(value / 60);
                      const secs = value % 60;
                      displayValue = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
                    }
                    return (
                      <div key={key} className="flex gap-2">
                        <dt className="font-medium text-muted-foreground min-w-24">{displayKey}:</dt>
                        <dd className="text-foreground">{displayValue}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            </CollapsibleContent>
          )}
        </Collapsible>
      </div>
    </div>
  );
}

interface ActivityTimelineProps {
  entityType: "lead" | "property" | "deal";
  entityId: number;
  className?: string;
}

export function ActivityTimeline({ entityType, entityId, className }: ActivityTimelineProps) {
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<ActivityEventType>>(new Set());

  const eventTypesParam = selectedEventTypes.size > 0 
    ? `?eventTypes=${Array.from(selectedEventTypes).join(",")}` 
    : "";

  const { data: events = [], isLoading, error } = useQuery<ActivityEvent[]>({
    queryKey: [`/api/${entityType}s/${entityId}/timeline`, Array.from(selectedEventTypes)],
    queryFn: async () => {
      const res = await fetch(`/api/${entityType}s/${entityId}/timeline${eventTypesParam}`);
      if (!res.ok) throw new Error("Failed to fetch timeline");
      return res.json();
    },
  });

  const toggleEventType = (type: ActivityEventType) => {
    const newSet = new Set(selectedEventTypes);
    if (newSet.has(type)) {
      newSet.delete(type);
    } else {
      newSet.add(type);
    }
    setSelectedEventTypes(newSet);
  };

  const clearFilters = () => {
    setSelectedEventTypes(new Set());
  };

  return (
    <Card className={className} data-testid="activity-timeline">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
        <CardTitle className="text-lg">Activity Timeline</CardTitle>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="outline" 
              size="sm"
              data-testid="timeline-filter-button"
            >
              <Filter className="w-4 h-4 mr-2" />
              Filter
              {selectedEventTypes.size > 0 && (
                <Badge variant="secondary" size="sm" className="ml-2">
                  {selectedEventTypes.size}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Filter by Event Type</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {Object.entries(ACTIVITY_EVENT_TYPES).map(([type, info]) => (
              <DropdownMenuCheckboxItem
                key={type}
                checked={selectedEventTypes.has(type as ActivityEventType)}
                onCheckedChange={() => toggleEventType(type as ActivityEventType)}
                data-testid={`timeline-filter-${type}`}
              >
                {info.name}
              </DropdownMenuCheckboxItem>
            ))}
            {selectedEventTypes.size > 0 && (
              <>
                <DropdownMenuSeparator />
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="w-full justify-start"
                  onClick={clearFilters}
                  data-testid="timeline-clear-filters"
                >
                  Clear filters
                </Button>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8" data-testid="timeline-loading">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-8 text-center text-muted-foreground" data-testid="timeline-error">
            Failed to load timeline
          </div>
        ) : events.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground" data-testid="timeline-empty">
            No activity recorded yet
          </div>
        ) : (
          <ScrollArea className="h-[400px] pr-4">
            <div className="space-y-0">
              {events.map((event) => (
                <TimelineEvent key={event.id} event={event} />
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
