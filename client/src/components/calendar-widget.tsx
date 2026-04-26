import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { staggerContainer, staggerItem } from "@/lib/animations";

interface CalendarEvent {
  id: string;
  title: string;
  date: string; // ISO date
  time?: string; // HH:mm
  type: "closing" | "visit" | "follow_up" | "other";
  entityType?: "deal" | "lead" | "property";
  entityId?: number;
  externalUrl?: string; // Google Calendar link
}

const EVENT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  closing: { bg: "bg-green-100 dark:bg-green-900/30", text: "text-green-700 dark:text-green-400", dot: "bg-green-500" },
  visit: { bg: "bg-blue-100 dark:bg-blue-900/30", text: "text-blue-700 dark:text-blue-400", dot: "bg-blue-500" },
  follow_up: { bg: "bg-amber-100 dark:bg-amber-900/30", text: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  other: { bg: "bg-gray-100 dark:bg-gray-900/30", text: "text-gray-700 dark:text-gray-400", dot: "bg-gray-500" },
};

function getWeekDays(): Date[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - dayOfWeek); // Sunday
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function CalendarWidget() {
  const { data: events, isLoading } = useQuery<CalendarEvent[]>({
    queryKey: ["/api/calendar/events"],
    refetchInterval: 300_000, // 5 min
  });

  const { data: calendarStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/integrations/google-calendar/status"],
  });

  const weekDays = useMemo(() => getWeekDays(), []);
  const today = new Date();

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const day of weekDays) {
      const key = day.toISOString().split("T")[0];
      map[key] = (events || []).filter(e => isSameDay(new Date(e.date), day));
    }
    return map;
  }, [events, weekDays]);

  const hasEvents = events && events.length > 0;

  if (isLoading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading calendar"
        className="border rounded-lg p-4 space-y-3"
      >
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (!hasEvents && !calendarStatus?.connected) {
    return (
      <div className="border rounded-lg p-4 text-center text-sm">
        <Calendar className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" aria-hidden="true" />
        <p className="text-muted-foreground mb-2">No upcoming events</p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/settings?tab=integrations" aria-label="Connect Google Calendar">
            Connect Google Calendar
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <section aria-labelledby="calendar-week-heading" className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 id="calendar-week-heading" className="text-sm font-medium flex items-center gap-2 m-0">
          <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          This week
        </h3>
        <ul aria-label="Event types" className="flex gap-2 list-none p-0 m-0">
          {Object.entries(EVENT_COLORS).map(([type, colors]) => (
            <li key={type} className="flex items-center gap-1">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${colors.dot}`} />
              <span className="text-[10px] text-muted-foreground capitalize">{type.replace(/_/g, " ")}</span>
            </li>
          ))}
        </ul>
      </div>

      <motion.ul
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        aria-label="Week calendar"
        className="grid grid-cols-7 gap-1 list-none p-0 m-0"
      >
        {weekDays.map((day, i) => {
          const key = day.toISOString().split("T")[0];
          const dayEvents = eventsByDay[key] || [];
          const isToday = isSameDay(day, today);
          const dayLabel = day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

          return (
            <motion.li
              key={key}
              variants={staggerItem}
              className={`min-h-[80px] rounded p-1.5 ${isToday ? "ring-2 ring-primary bg-primary/5" : "bg-muted/30"}`}
              aria-label={`${dayLabel}${isToday ? " (today)" : ""}: ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}`}
              aria-current={isToday ? "date" : undefined}
            >
              <div className={`text-xs font-medium mb-1 ${isToday ? "text-primary" : "text-muted-foreground"}`} aria-hidden="true">
                {DAY_LABELS[i]} <span className="tabular-nums">{day.getDate()}</span>
              </div>
              {dayEvents.length > 0 && (
                <ul aria-label={`${dayLabel} events`} className="space-y-0.5 list-none p-0 m-0">
                  {dayEvents.slice(0, 3).map((event) => {
                    const colors = EVENT_COLORS[event.type] || EVENT_COLORS.other;
                    const eventLabel = `${event.type.replace(/_/g, " ")}: ${event.title}${event.time ? ` at ${event.time}` : ""}`;
                    return (
                      <li
                        key={event.id}
                        className={`${colors.bg} ${colors.text} rounded px-1 py-0.5 text-[10px] truncate`}
                        aria-label={eventLabel}
                      >
                        {event.title}
                      </li>
                    );
                  })}
                  {dayEvents.length > 3 && (
                    <li className="text-[10px] text-muted-foreground text-center" aria-label={`${dayEvents.length - 3} more events`}>
                      +<span className="tabular-nums">{dayEvents.length - 3}</span> more
                    </li>
                  )}
                </ul>
              )}
            </motion.li>
          );
        })}
      </motion.ul>
    </section>
  );
}
