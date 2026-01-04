import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { 
  Mail, MailOpen, MousePointer, MessageSquare, MessageCircle,
  FileText, Package, PhoneOutgoing, PhoneIncoming, StickyNote,
  ArrowRightCircle, DollarSign, Upload, Filter, Loader2,
  Users, Building2, Briefcase, Activity, ExternalLink
} from "lucide-react";
import { useState, useCallback, useRef, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Link } from "wouter";
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

const entityTypeIcons: Record<string, typeof Users> = {
  lead: Users,
  property: Building2,
  deal: Briefcase,
};

interface ActivityFeedResponse {
  events: ActivityEvent[];
  hasMore: boolean;
  total: number;
}

interface ActivityFeedItemProps {
  event: ActivityEvent;
}

function ActivityFeedItem({ event }: ActivityFeedItemProps) {
  const eventType = event.eventType as ActivityEventType;
  const Icon = eventTypeIcons[eventType] || FileText;
  const colorClass = eventTypeColors[eventType] || "bg-gray-100 text-gray-700";
  const eventInfo = ACTIVITY_EVENT_TYPES[eventType];
  const eventDate = new Date(event.eventDate);
  const EntityIcon = entityTypeIcons[event.entityType] || Activity;

  const getEntityLink = () => {
    switch (event.entityType) {
      case "lead":
        return `/leads/${event.entityId}`;
      case "property":
        return `/properties/${event.entityId}`;
      case "deal":
        return `/deals/${event.entityId}`;
      default:
        return null;
    }
  };

  const entityLink = getEntityLink();

  return (
    <div 
      className="flex gap-3 p-3 border-b last:border-b-0 hover-elevate"
      data-testid={`activity-feed-item-${event.id}`}
    >
      <div className={`flex items-center justify-center w-10 h-10 rounded-full shrink-0 ${colorClass}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <Badge variant="outline" size="sm" className={colorClass}>
            {eventInfo?.name || eventType}
          </Badge>
          <Badge variant="secondary" size="sm" className="flex items-center gap-1">
            <EntityIcon className="w-3 h-3" />
            {event.entityType}
          </Badge>
        </div>
        <p 
          className="text-sm text-foreground line-clamp-2"
          data-testid={`activity-feed-description-${event.id}`}
        >
          {event.description}
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span 
            className="text-xs text-muted-foreground"
            title={format(eventDate, "PPpp")}
          >
            {formatDistanceToNow(eventDate, { addSuffix: true })}
          </span>
          {entityLink && (
            <Link href={entityLink}>
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 px-2 text-xs"
                data-testid={`activity-feed-link-${event.id}`}
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                View
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

type EntityFilter = "all" | "lead" | "property" | "deal";

interface ActivityFeedProps {
  className?: string;
  maxHeight?: string;
  compact?: boolean;
}

export function ActivityFeed({ className, maxHeight = "500px", compact = false }: ActivityFeedProps) {
  const [selectedEventTypes, setSelectedEventTypes] = useState<Set<ActivityEventType>>(new Set());
  const [entityFilter, setEntityFilter] = useState<EntityFilter>("all");
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const buildQueryParams = (offset: number) => {
    const params = new URLSearchParams();
    params.set("limit", "20");
    params.set("offset", String(offset));
    if (selectedEventTypes.size > 0) {
      params.set("eventTypes", Array.from(selectedEventTypes).join(","));
    }
    if (entityFilter !== "all") {
      params.set("entityType", entityFilter);
    }
    return params.toString();
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteQuery<ActivityFeedResponse>({
    queryKey: ["/api/activity", Array.from(selectedEventTypes), entityFilter],
    queryFn: async ({ pageParam = 0 }) => {
      const res = await fetch(`/api/activity?${buildQueryParams(pageParam as number)}`);
      if (!res.ok) throw new Error("Failed to fetch activity feed");
      return res.json();
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined;
      return allPages.reduce((acc, page) => acc + page.events.length, 0);
    },
  });

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const target = entries[0];
      if (target.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  );

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element) return;

    observerRef.current = new IntersectionObserver(handleObserver, {
      threshold: 0.1,
    });
    observerRef.current.observe(element);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [handleObserver]);

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
    setEntityFilter("all");
  };

  const allEvents = data?.pages.flatMap((page) => page.events) || [];
  const hasFilters = selectedEventTypes.size > 0 || entityFilter !== "all";

  return (
    <Card className={className} data-testid="activity-feed">
      <CardHeader className="flex flex-row items-center justify-between gap-4 pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="w-5 h-5" />
          {compact ? "Activity" : "Recent Activity"}
        </CardTitle>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                data-testid="activity-feed-entity-filter"
              >
                {entityFilter === "all" ? "All" : entityFilter}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Entity Type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(["all", "lead", "property", "deal"] as EntityFilter[]).map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={entityFilter === type}
                  onCheckedChange={() => setEntityFilter(type)}
                  data-testid={`activity-feed-entity-${type}`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                variant="outline" 
                size="sm"
                data-testid="activity-feed-filter-button"
              >
                <Filter className="w-4 h-4 mr-2" />
                {compact ? "" : "Filter"}
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
                  data-testid={`activity-feed-filter-${type}`}
                >
                  {info.name}
                </DropdownMenuCheckboxItem>
              ))}
              {hasFilters && (
                <>
                  <DropdownMenuSeparator />
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="w-full justify-start"
                    onClick={clearFilters}
                    data-testid="activity-feed-clear-filters"
                  >
                    Clear all filters
                  </Button>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8" data-testid="activity-feed-loading">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-8 text-center text-muted-foreground" data-testid="activity-feed-error">
            Failed to load activity feed
          </div>
        ) : allEvents.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground" data-testid="activity-feed-empty">
            No activity recorded yet
          </div>
        ) : (
          <ScrollArea style={{ height: maxHeight }}>
            <div>
              {allEvents.map((event) => (
                <ActivityFeedItem key={event.id} event={event} />
              ))}
              <div ref={loadMoreRef} className="py-2">
                {isFetchingNextPage && (
                  <div className="flex items-center justify-center">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
