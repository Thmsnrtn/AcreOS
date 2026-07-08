/**
 * Settings → Integrations — Phase 5 §5 Part D (team readiness).
 *
 * Slack & Microsoft Teams incoming-webhook configuration. Admins paste
 * a webhook URL, choose which events to subscribe to, and the server
 * will fire JSON payloads on deal-closed / big-lead-arrived / offer
 * approvals.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { EmptyState } from "@/components/empty-state";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getErrorMessage, getErrorTitle } from "@/lib/error-utils";
import { Trash2, Webhook } from "lucide-react";

interface SlackIntegration {
  id: number;
  provider: "slack" | "teams";
  webhookUrl: string;
  channelName: string | null;
  eventTypes: string[];
  isActive: boolean;
  lastDispatchedAt: string | null;
  lastError: string | null;
}

const ALL_EVENTS = ["deal_closed", "big_lead_arrived", "offer_pending_approval"];
// C1 legibility (experience-legibility.md): the raw enum is the API
// contract; the label is what a person reads. Never render the enum.
const EVENT_LABEL: Record<string, string> = {
  deal_closed: "A deal closes",
  big_lead_arrived: "A big lead comes in",
  offer_pending_approval: "An offer is waiting for your approval",
};

export default function IntegrationsSettingsPage() {
  useDocumentTitle("Integrations");
  const { toast } = useToast();
  const [provider, setProvider] = useState<"slack" | "teams">("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [channelName, setChannelName] = useState("");
  const [eventTypes, setEventTypes] = useState<string[]>(["deal_closed", "big_lead_arrived"]);

  const {
    data: integrations = [],
    isLoading,
    error,
    refetch,
  } = useQuery<SlackIntegration[]>({
    queryKey: ["/api/team-readiness/slack-integrations"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/team-readiness/slack-integrations");
      const json = await res.json();
      return json.integrations;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/team-readiness/slack-integrations", {
        provider,
        webhookUrl,
        channelName: channelName || undefined,
        eventTypes,
      });
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-readiness/slack-integrations"] });
      setWebhookUrl("");
      setChannelName("");
      toast({ title: "Integration saved" });
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/team-readiness/slack-integrations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/team-readiness/slack-integrations"] });
      toast({ title: "Integration removed" });
    },
    onError: (error) => {
      const title = getErrorTitle(error);
      const description = getErrorMessage(error);
      toast({ title, description, variant: "destructive" });
    },
  });

  return (
    <PageShell label="Integrations">
      <div className="space-y-6">
        <div>
          <h1 className="text-hero">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            Get a message in Slack or Teams the moment something important happens in AcreOS.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Connect a channel</CardTitle>
            <CardDescription>
              Pick where messages go and which moments send one.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="provider-select">Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as any)}>
                  <SelectTrigger id="provider-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="slack">Slack</SelectItem>
                    <SelectItem value="teams">Microsoft Teams</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="channel-input">Channel name (optional)</Label>
                <Input
                  id="channel-input"
                  placeholder="#deals"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="webhook-input">Paste the link from Slack or Teams</Label>
              <Input
                id="webhook-input"
                type="url"
                placeholder="https://hooks.slack.com/services/T00000/B00000/XXXXXXX"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                In Slack, open Incoming Webhooks and copy the web address it gives you — that's how we deliver messages to your channel.
              </p>
            </div>
            <div>
              <Label>Which moments send a message</Label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {ALL_EVENTS.map((evt) => (
                  <div key={evt} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`evt-${evt}`}
                      checked={eventTypes.includes(evt)}
                      onChange={(e) => {
                        setEventTypes(
                          e.target.checked ? [...eventTypes, evt] : eventTypes.filter((x) => x !== evt),
                        );
                      }}
                    />
                    <Label htmlFor={`evt-${evt}`}>{EVENT_LABEL[evt] ?? evt}</Label>
                  </div>
                ))}
              </div>
            </div>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !webhookUrl}
            >
              {saveMutation.isPending ? "Saving…" : "Start sending to this channel"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connected channels</CardTitle>
            <CardDescription>
              Every channel currently getting messages, and which moments trigger them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div role="status" aria-busy="true">
                <span className="sr-only">Loading configured webhooks…</span>
                <ul className="divide-y">
                  {[0, 1, 2].map((i) => (
                    <li key={i} className="flex items-center justify-between py-3">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-32" announce={false} />
                        <Skeleton className="h-3 w-64" announce={false} />
                        <Skeleton className="h-3 w-40" announce={false} />
                      </div>
                      <Skeleton className="h-9 w-9 rounded-md" announce={false} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : error ? (
              <QueryErrorState
                error={error as Error}
                onRetry={() => refetch()}
                title="Couldn't load integrations"
                testId="integrations-error"
              />
            ) : integrations.length === 0 ? (
              <EmptyState
                icon={Webhook}
                headline="No webhooks configured yet"
                subtitle="Send AcreOS events to Slack or Microsoft Teams. Add a webhook above to start receiving deal-closed, big-lead, and approval notifications."
                // TODO(cta): the "Add webhook" form is already on this page above — no separate action needed
                cta={{ label: "", _noOp: true }}
                testId="integrations-empty"
              />
            ) : (
              <ul className="divide-y">
                {integrations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {i.provider === "teams" ? "Microsoft Teams" : "Slack"}
                        {!i.isActive && <Badge variant="secondary">disabled</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-[46ch]">
                        {i.channelName ? `${i.channelName} · ` : ""}{i.webhookUrl}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Sends when: {i.eventTypes.map((e) => EVENT_LABEL[e]?.toLowerCase() ?? e).join(" · ")}
                      </div>
                      {i.lastError && (
                        <div className="text-xs text-destructive">Last error: {i.lastError}</div>
                      )}
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete webhook"
                      onClick={() => deleteMutation.mutate(i.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
