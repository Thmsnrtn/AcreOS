// DEPRECATED 2026-05-11 — consolidated into /deals/discover. The /deal-feed
// route now redirects there. Kept on disk for possible A/B reuse.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { DailyDealFeed } from "@/components/deal-feed/daily-deal-feed";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw, Bookmark, Filter } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function DealFeedPage() {
  useDocumentTitle("Deal feed");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"feed" | "saved">("feed");

  const refreshMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/deal-feed/refresh"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/deal-feed"] }),
  });

  return (
    <PageShell label="Deal feed">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">Today's Opportunities</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Properties matching your criteria, scored and ranked by our AI.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-muted rounded-md p-0.5">
              <Button
                variant={tab === "feed" ? "secondary" : "ghost"}
                size="sm"
                className="text-xs"
                onClick={() => setTab("feed")}
              >
                <Filter className="w-3 h-3 mr-1" /> Feed
              </Button>
              <Button
                variant={tab === "saved" ? "secondary" : "ghost"}
                size="sm"
                className="text-xs"
                onClick={() => setTab("saved")}
              >
                <Bookmark className="w-3 h-3 mr-1" /> Saved
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              aria-label="Refresh deal feed"
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {tab === "feed" ? (
          <DailyDealFeed />
        ) : (
          <Card>
            <CardContent className="p-6 text-center">
              <Bookmark className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                Opportunities you save will appear here for follow-up.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
