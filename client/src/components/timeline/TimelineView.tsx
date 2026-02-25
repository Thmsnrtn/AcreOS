import { useRef, useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { 
  ZoomIn, ZoomOut, Calendar, Milestone, Flag, CheckCircle2, 
  Clock, AlertTriangle, ChevronLeft, ChevronRight, Home
} from "lucide-react";
import { format, differenceInDays, addDays, startOfDay, endOfDay, isWithinInterval } from "date-fns";
import type { Deal } from "@shared/schema";

interface TimelineMilestone {
  id: string;
  date: Date;
  title: string;
  description?: string;
  type: "deal" | "task" | "deadline" | "milestone";
  status: "pending" | "in_progress" | "completed" | "overdue";
  entityId?: number;
  entityType?: "deal" | "property" | "lead";
}

interface TimelineViewProps {
  deals?: Deal[];
  milestones?: TimelineMilestone[];
  startDate?: Date;
  endDate?: Date;
}

const ZOOM_LEVELS = [
  { label: "Day", daysPerView: 7, dayWidth: 120 },
  { label: "Week", daysPerView: 14, dayWidth: 80 },
  { label: "Month", daysPerView: 30, dayWidth: 50 },
  { label: "Quarter", daysPerView: 90, dayWidth: 25 },
];

export function TimelineView({ deals = [], milestones: externalMilestones = [], startDate, endDate }: TimelineViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  
  const zoom = ZOOM_LEVELS[zoomLevel];
  
  const today = startOfDay(new Date());
  const timelineStart = startDate || addDays(today, -7);
  const timelineEnd = endDate || addDays(today, zoom.daysPerView);
  
  const totalDays = differenceInDays(timelineEnd, timelineStart) + 1;
  const timelineWidth = totalDays * zoom.dayWidth;
  
  const dealMilestones: TimelineMilestone[] = useMemo(() => {
    return deals.flatMap((deal) => {
      const items: TimelineMilestone[] = [];
      
      const dealAny = deal as any;
      if (deal.createdAt) {
        items.push({
          id: `deal-created-${deal.id}`,
          date: new Date(deal.createdAt),
          title: `Deal Created: ${dealAny.name || `Deal #${deal.id}`}`,
          type: "deal",
          status: "completed",
          entityId: deal.id,
          entityType: "deal",
        });
      }
      
      if (dealAny.expectedCloseDate) {
        const closeDate = new Date(dealAny.expectedCloseDate);
        const isOverdue = closeDate < today && deal.status !== "closed";
        items.push({
          id: `deal-close-${deal.id}`,
          date: closeDate,
          title: `Expected Close: ${dealAny.name || `Deal #${deal.id}`}`,
          type: "deadline",
          status: deal.status === "closed" ? "completed" : isOverdue ? "overdue" : "pending",
          entityId: deal.id,
          entityType: "deal",
        });
      }
      
      return items;
    });
  }, [deals, today]);
  
  const allMilestones = [...dealMilestones, ...externalMilestones].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );
  
  const visibleMilestones = allMilestones.filter((m) =>
    isWithinInterval(m.date, { start: timelineStart, end: timelineEnd })
  );
  
  const days = Array.from({ length: totalDays }, (_, i) => addDays(timelineStart, i));
  
  const getPositionForDate = (date: Date): number => {
    const daysFromStart = differenceInDays(startOfDay(date), timelineStart);
    return daysFromStart * zoom.dayWidth + zoom.dayWidth / 2;
  };
  
  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed":
        return "bg-green-500 text-white";
      case "in_progress":
        return "bg-primary text-primary-foreground";
      case "overdue":
        return "bg-red-500 text-white";
      case "pending":
      default:
        return "bg-muted text-muted-foreground";
    }
  };
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-3 h-3" />;
      case "in_progress":
        return <Clock className="w-3 h-3" />;
      case "overdue":
        return <AlertTriangle className="w-3 h-3" />;
      default:
        return <Milestone className="w-3 h-3" />;
    }
  };
  
  const getMilestoneIcon = (type: string) => {
    switch (type) {
      case "deal":
        return <Home className="w-4 h-4" />;
      case "deadline":
        return <Flag className="w-4 h-4" />;
      case "task":
        return <CheckCircle2 className="w-4 h-4" />;
      default:
        return <Milestone className="w-4 h-4" />;
    }
  };
  
  const scrollToToday = () => {
    if (scrollRef.current) {
      const todayPosition = getPositionForDate(today);
      scrollRef.current.scrollTo({ left: todayPosition - 200, behavior: "smooth" });
    }
  };
  
  const handleZoomIn = () => {
    setZoomLevel((prev) => Math.max(0, prev - 1));
  };
  
  const handleZoomOut = () => {
    setZoomLevel((prev) => Math.min(ZOOM_LEVELS.length - 1, prev + 1));
  };

  return (
    <Card data-testid="timeline-view">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            Timeline
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={scrollToToday}
              data-testid="button-timeline-today"
            >
              Today
            </Button>
            <div className="flex items-center gap-1 border rounded-md">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleZoomIn}
                disabled={zoomLevel === 0}
                data-testid="button-timeline-zoom-in"
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <span className="text-xs font-medium px-2 min-w-[60px] text-center">
                {zoom.label}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleZoomOut}
                disabled={zoomLevel === ZOOM_LEVELS.length - 1}
                data-testid="button-timeline-zoom-out"
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ScrollArea className="w-full" ref={scrollRef}>
          <div 
            className="relative min-h-[200px]" 
            style={{ width: `${timelineWidth}px` }}
          >
            <div className="flex border-b">
              {days.map((day, index) => {
                const isToday = format(day, "yyyy-MM-dd") === format(today, "yyyy-MM-dd");
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                const isFirstOfMonth = day.getDate() === 1;
                
                return (
                  <div
                    key={index}
                    className={`flex-shrink-0 border-r text-center py-2 ${
                      isToday ? "bg-primary/10" : isWeekend ? "bg-muted/50" : ""
                    }`}
                    style={{ width: `${zoom.dayWidth}px` }}
                  >
                    {isFirstOfMonth && (
                      <div className="text-xs font-semibold text-primary mb-1">
                        {format(day, "MMM yyyy")}
                      </div>
                    )}
                    <div className={`text-xs ${isToday ? "font-bold text-primary" : "text-muted-foreground"}`}>
                      {format(day, zoom.dayWidth > 40 ? "EEE" : "E")}
                    </div>
                    <div className={`text-sm ${isToday ? "font-bold text-primary" : ""}`}>
                      {format(day, "d")}
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="absolute top-0 bottom-0 w-0.5 bg-primary z-10" 
              style={{ left: `${getPositionForDate(today)}px` }}
            />
            
            <div className="relative pt-4 pb-8 min-h-[120px]">
              {visibleMilestones.map((milestone, index) => {
                const position = getPositionForDate(milestone.date);
                const row = index % 3;
                
                return (
                  <div
                    key={milestone.id}
                    className="absolute transform -translate-x-1/2"
                    style={{ 
                      left: `${position}px`,
                      top: `${16 + row * 36}px`
                    }}
                    data-testid={`timeline-milestone-${milestone.id}`}
                  >
                    <div 
                      className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs whitespace-nowrap ${getStatusColor(milestone.status)} cursor-pointer hover:opacity-90 transition-opacity`}
                      title={milestone.description || milestone.title}
                    >
                      {getMilestoneIcon(milestone.type)}
                      <span className="max-w-[120px] truncate">
                        {milestone.title}
                      </span>
                      {getStatusIcon(milestone.status)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
        
        {visibleMilestones.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p>No milestones in this time range</p>
          </div>
        )}
        
        <div className="flex items-center gap-4 mt-4 pt-4 border-t flex-wrap">
          <span className="text-xs text-muted-foreground">Legend:</span>
          <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completed
          </Badge>
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
            <Clock className="w-3 h-3 mr-1" />
            In Progress
          </Badge>
          <Badge variant="outline" className="bg-muted text-muted-foreground">
            <Milestone className="w-3 h-3 mr-1" />
            Pending
          </Badge>
          <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Overdue
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
