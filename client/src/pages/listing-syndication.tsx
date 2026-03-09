import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Share2, Globe, CheckCircle2, XCircle, RefreshCw, Loader2, AlertTriangle } from "lucide-react";

interface SyndicationChannel {
  id: string;
  name: string;
  logoUrl?: string;
  type: "mls" | "portal" | "social" | "marketplace";
  enabled: boolean;
  lastSyncAt?: string;
  syncStatus: "synced" | "pending" | "error" | "disabled";
  listingsPublished: number;
  pendingCount: number;
  errorMessage?: string;
}

interface SyndicationSummary {
  totalChannels: number;
  activeChannels: number;
  totalListingsPublished: number;
  pendingSync: number;
  channels: SyndicationChannel[];
}

const TYPE_LABELS: Record<string, string> = {
  mls: "MLS",
  portal: "Portal",
  social: "Social",
  marketplace: "Marketplace",
};

export default function ListingSyndicationPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<SyndicationSummary>({
    queryKey: ["/api/syndication/status"],
    queryFn: () => fetch("/api/syndication/status").then(r => r.json()),
  });

  const syncAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/syndication/sync-all"),
    onSuccess: () => {
      toast({ title: "Sync initiated for all channels" });
      qc.invalidateQueries({ queryKey: ["/api/syndication"] });
    },
    onError: () => toast({ title: "Sync failed", variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ channelId, enabled }: { channelId: string; enabled: boolean }) =>
      apiRequest("PATCH", `/api/syndication/channels/${channelId}`, { enabled }),
    onSuccess: () => {
      toast({ title: "Channel updated" });
      qc.invalidateQueries({ queryKey: ["/api/syndication"] });
    },
    onError: () => toast({ title: "Update failed", variant: "destructive" }),
  });

  const syncChannelMutation = useMutation({
    mutationFn: (channelId: string) => apiRequest("POST", `/api/syndication/channels/${channelId}/sync`),
    onSuccess: () => {
      toast({ title: "Channel sync initiated" });
      qc.invalidateQueries({ queryKey: ["/api/syndication"] });
    },
    onError: () => toast({ title: "Sync failed", variant: "destructive" }),
  });

  const channels = data?.channels ?? [];

  return (
    <PageShell>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-listing-syndication-title">
            Listing Syndication
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Publish listings to MLS, portals, and marketplaces from one place.
          </p>
        </div>
        <Button onClick={() => syncAllMutation.mutate()} disabled={syncAllMutation.isPending}>
          {syncAllMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Sync All
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Active Channels</p>
              <p className="text-2xl font-bold">{data.activeChannels} / {data.totalChannels}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Published Listings</p>
              <p className="text-2xl font-bold">{data.totalListingsPublished}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Pending Sync</p>
              <p className="text-2xl font-bold">{data.pendingSync}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1">Errors</p>
              <p className="text-2xl font-bold text-red-600">
                {channels.filter(c => c.syncStatus === "error").length}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading channels...
        </div>
      ) : (
        <div className="space-y-2">
          {channels.map(ch => (
            <Card key={ch.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5 flex-1">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <span className="font-medium text-sm">{ch.name}</span>
                      <Badge variant="outline" className="text-xs">{TYPE_LABELS[ch.type] ?? ch.type}</Badge>
                      {ch.syncStatus === "synced" && <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />}
                      {ch.syncStatus === "error" && <XCircle className="w-3.5 h-3.5 text-red-600" />}
                      {ch.syncStatus === "pending" && <RefreshCw className="w-3.5 h-3.5 text-blue-600" />}
                    </div>
                    {ch.errorMessage && (
                      <div className="flex items-center gap-1.5 text-xs text-red-600">
                        <AlertTriangle className="w-3 h-3" /> {ch.errorMessage}
                      </div>
                    )}
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>{ch.listingsPublished} published</span>
                      {ch.pendingCount > 0 && <span className="text-blue-600">{ch.pendingCount} pending</span>}
                      {ch.lastSyncAt && <span>Last sync: {new Date(ch.lastSyncAt).toLocaleString()}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => syncChannelMutation.mutate(ch.id)}
                      disabled={!ch.enabled}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={ch.enabled}
                        onCheckedChange={enabled => toggleMutation.mutate({ channelId: ch.id, enabled })}
                        id={`ch-${ch.id}`}
                      />
                      <Label htmlFor={`ch-${ch.id}`} className="text-xs cursor-pointer">
                        {ch.enabled ? "On" : "Off"}
                      </Label>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
