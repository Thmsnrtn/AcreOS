/**
 * Absence Mode — Sovereign Company Protocol v6
 *
 * "I'm away for 3 days."
 * Agents auto-elevate, batch non-urgent items, emergency-only breaks.
 * Come back to a summary, not a backlog.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plane,
  Power,
  Shield,
  Clock,
  AlertTriangle,
  Inbox,
  FileText,
} from "lucide-react";

interface AbsenceData {
  id: number;
  isActive: boolean;
  startedAt: string | null;
  endsAt: string | null;
  trustBoost: number;
  batchedItems: Array<{
    type: string;
    summary: string;
    agentCodename: string;
    priority: string;
    timestamp: string;
  }>;
  emergencyBreaks: Array<{
    agentCodename: string;
    reason: string;
    timestamp: string;
    actionTaken: string;
  }>;
  returnBriefing: string | null;
}

export function AbsenceMode() {
  const queryClient = useQueryClient();
  const [duration, setDuration] = useState("72"); // hours

  const { data: absence, isLoading } = useQuery({
    queryKey: ["/api/founder/v6/absence-mode"],
    queryFn: () => apiRequest("GET", "/api/founder/v6/absence-mode").then(r => r.json()),
    refetchInterval: 30000,
  });

  const activateMutation = useMutation({
    mutationFn: (hours: number) =>
      apiRequest("POST", "/api/founder/v6/absence-mode/activate", { durationHours: hours }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v6/absence-mode"] }),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/founder/v6/absence-mode/deactivate"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/founder/v6/absence-mode"] }),
  });

  if (isLoading) return <Skeleton className="h-32 w-full rounded-xl" />;

  const data = absence as AbsenceData | null;
  const isActive = data?.isActive;
  const batchedItems = data?.batchedItems || [];
  const emergencyBreaks = data?.emergencyBreaks || [];

  if (isActive && data) {
    const endsAt = data.endsAt ? new Date(data.endsAt) : null;
    const hoursLeft = endsAt ? Math.max(0, Math.round((endsAt.getTime() - Date.now()) / (1000 * 60 * 60))) : 0;

    return (
      <Card className="border-indigo-200 dark:border-indigo-800">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Plane className="h-4 w-4 text-indigo-600" />
              <span className="text-indigo-700 dark:text-indigo-400">Away Mode Active</span>
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => deactivateMutation.mutate()}
              disabled={deactivateMutation.isPending}
            >
              <Power className="h-3 w-3 mr-1" /> I'm Back
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Status */}
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span>{hoursLeft}h remaining</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield className="h-3 w-3 text-indigo-500" />
              <span>Trust boosted +{data.trustBoost}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Inbox className="h-3 w-3 text-muted-foreground" />
              <span>{batchedItems.length} items batched</span>
            </div>
          </div>

          {/* Emergency Breaks */}
          {emergencyBreaks.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-red-600 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Emergency Breaks
              </div>
              {emergencyBreaks.map((e, i) => (
                <div key={i} className="text-xs p-2 rounded bg-red-50 dark:bg-red-950/20 border border-red-100">
                  <span className="font-medium">{e.agentCodename}</span>: {e.reason}
                  <div className="text-muted-foreground mt-0.5">Action: {e.actionTaken}</div>
                </div>
              ))}
            </div>
          )}

          {/* Batched Items Preview */}
          {batchedItems.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Batched for Your Return</div>
              {batchedItems.slice(0, 3).map((item, i) => (
                <div key={i} className="text-xs p-1.5 rounded bg-muted/50 flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] h-4 px-1">{item.priority}</Badge>
                  <span className="truncate">{item.summary}</span>
                </div>
              ))}
              {batchedItems.length > 3 && (
                <div className="text-[10px] text-muted-foreground">
                  +{batchedItems.length - 3} more items
                </div>
              )}
            </div>
          )}

          {/* Return Briefing (shown after deactivation) */}
          {data.returnBriefing && (
            <div className="space-y-1">
              <div className="text-xs font-medium flex items-center gap-1">
                <FileText className="h-3 w-3" /> Return Briefing
              </div>
              <div className="text-sm whitespace-pre-wrap p-3 rounded-lg bg-muted/50 border">
                {data.returnBriefing}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Plane className="h-4 w-4" /> Absence Mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Going away? Your AI team will run things autonomously. Trust scores temporarily boosted.
          Non-urgent items batched. Only emergencies break through.
        </p>

        <div className="flex items-center gap-3">
          <Select value={duration} onValueChange={setDuration}>
            <SelectTrigger className="w-36 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">24 hours</SelectItem>
              <SelectItem value="48">2 days</SelectItem>
              <SelectItem value="72">3 days</SelectItem>
              <SelectItem value="120">5 days</SelectItem>
              <SelectItem value="168">1 week</SelectItem>
            </SelectContent>
          </Select>

          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => activateMutation.mutate(parseInt(duration))}
            disabled={activateMutation.isPending}
          >
            <Plane className="h-3 w-3 mr-1" /> Activate
          </Button>
        </div>

        {/* Show last return briefing if available */}
        {data?.returnBriefing && !data?.isActive && (
          <div className="space-y-1 mt-2">
            <div className="text-xs font-medium flex items-center gap-1">
              <FileText className="h-3 w-3" /> Last Return Briefing
            </div>
            <div className="text-xs whitespace-pre-wrap p-3 rounded-lg bg-muted/50 border max-h-40 overflow-y-auto">
              {data.returnBriefing}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
