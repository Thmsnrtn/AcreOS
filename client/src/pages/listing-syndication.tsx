import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Globe, CheckCircle2, XCircle, RefreshCw, Loader2, AlertTriangle } from "lucide-react";

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
  useDocumentTitle("Listing syndication");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<SyndicationSummary>({
    queryKey: ["/api/syndication/status"],
    queryFn: () => fetch("/api/syndication/status").then(r => r.json()),
  });

  const syncAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/syndication/sync-all"),
    onSuccess: () => {
      toast({ title: "Sync initiated for all channels." });
      qc.invalidateQueries({ queryKey: ["/api/syndication"] });
    },
    onError: () =>
      toast({
        title: "Couldn't initiate sync",
        description: "No channels were synced — your existing listings and channel state are unchanged.",
        variant: "destructive",
      }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ channelId, enabled }: { channelId: string; enabled: boolean }) =>
      apiRequest("PATCH", `/api/syndication/channels/${channelId}`, { enabled }),
    onSuccess: () => {
      toast({ title: "Channel updated." });
      qc.invalidateQueries({ queryKey: ["/api/syndication"] });
    },
    onError: () =>
      toast({
        title: "Couldn't update channel",
        description: "The channel's on/off state is unchanged.",
        variant: "destructive",
      }),
  });

  const syncChannelMutation = useMutation({
    mutationFn: (channelId: string) => apiRequest("POST", `/api/syndication/channels/${channelId}/sync`),
    onSuccess: () => {
      toast({ title: "Channel sync initiated." });
      qc.invalidateQueries({ queryKey: ["/api/syndication"] });
    },
    onError: () =>
      toast({
        title: "Couldn't sync channel",
        description: "No listings were pushed — the channel state is unchanged.",
        variant: "destructive",
      }),
  });

  const channels = data?.channels ?? [];

  return (
    <PageShell>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-listing-syndication-title">
            Listing syndication
          </h1>
          <p className="text-muted-foreground text-sm md:text-base">
            Publish listings to MLS, portals, and marketplaces from one place.
          </p>
        </div>
        <Button
          onClick={() => syncAllMutation.mutate()}
          disabled={syncAllMutation.isPending}
          className="min-h-11"
        >
          {syncAllMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" aria-hidden="true" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          Sync all
        </Button>
      </div>

      {data && (
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground mb-1">Active channels</dt>
              <dd className="text-2xl font-bold tabular-nums">
                {data.activeChannels} / {data.totalChannels}
              </dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground mb-1">Published listings</dt>
              <dd className="text-2xl font-bold tabular-nums">{data.totalListingsPublished}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground mb-1">Pending sync</dt>
              <dd className="text-2xl font-bold tabular-nums">{data.pendingSync}</dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground mb-1">Errors</dt>
              <dd className="text-2xl font-bold text-red-600 tabular-nums">
                {channels.filter(c => c.syncStatus === "error").length}
              </dd>
            </CardContent>
          </Card>
        </dl>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading channels…
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Syndication channels">
          {channels.map(ch => (
            <li key={ch.id}>
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="space-y-0.5 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Globe className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                        <span className="font-medium text-sm">{ch.name}</span>
                        <Badge variant="outline" className="text-xs">{TYPE_LABELS[ch.type] ?? ch.type}</Badge>
                        {ch.syncStatus === "synced" && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-label="Synced" />
                        )}
                        {ch.syncStatus === "error" && (
                          <XCircle className="w-3.5 h-3.5 text-red-600" aria-label="Sync error" />
                        )}
                        {ch.syncStatus === "pending" && (
                          <RefreshCw className="w-3.5 h-3.5 text-blue-600" aria-label="Sync pending" />
                        )}
                      </div>
                      {ch.errorMessage && (
                        <div className="flex items-center gap-1.5 text-xs text-red-600" role="alert">
                          <AlertTriangle className="w-3 h-3" aria-hidden="true" /> {ch.errorMessage}
                        </div>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span><span className="tabular-nums">{ch.listingsPublished}</span> published</span>
                        {ch.pendingCount > 0 && <span className="text-blue-600"><span className="tabular-nums">{ch.pendingCount}</span> pending</span>}
                        {ch.lastSyncAt && <span className="tabular-nums">Last sync: {new Date(ch.lastSyncAt).toLocaleString()}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => syncChannelMutation.mutate(ch.id)}
                        disabled={!ch.enabled || syncChannelMutation.isPending}
                        className="min-h-9 min-w-9"
                        aria-label={`Sync ${ch.name} now`}
                      >
                        <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                      </Button>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={ch.enabled}
                          onCheckedChange={enabled => toggleMutation.mutate({ channelId: ch.id, enabled })}
                          id={`ch-${ch.id}`}
                          aria-label={`${ch.name} syndication ${ch.enabled ? "on" : "off"}`}
                        />
                        <Label htmlFor={`ch-${ch.id}`} className="text-xs cursor-pointer">
                          {ch.enabled ? "On" : "Off"}
                        </Label>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
