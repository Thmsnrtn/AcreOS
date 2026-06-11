import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowRight, Activity } from "lucide-react";
import { ActivityFeed as BaseActivityFeed } from "@/components/activity-feed";

// Thin wrapper to give /today its own styled header without
// duplicating the underlying infinite-scroll feed implementation.
// The base ActivityFeed renders its own Card; we render the eyebrow
// heading + "View all" affordance above it.
export function TodayActivityFeed() {
  return (
    <div data-testid="section-activity-feed">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="acr-section-h2 text-section-h2">Activity</h2>
        </div>
        <Button asChild variant="ghost" size="sm" className="gap-1 text-xs">
          <Link href="/activity">
            View all <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </Link>
        </Button>
      </div>
      <BaseActivityFeed compact maxHeight="420px" />
    </div>
  );
}
