import { useState, useId } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Webhook,
  Plus,
  Trash2,
  Send,
  Shield,
  Loader2,
  Code,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";

interface WebhookEndpoint {
  url: string;
  events: string[];
  enabled: boolean;
  secret?: string;
  description?: string;
}

const ALL_EVENTS = [
  { id: "lead.created", label: "Lead created", group: "Leads" },
  { id: "lead.updated", label: "Lead updated", group: "Leads" },
  { id: "lead.status_changed", label: "Lead status changed", group: "Leads" },
  { id: "property.created", label: "Property created", group: "Properties" },
  { id: "property.updated", label: "Property updated", group: "Properties" },
  { id: "deal.created", label: "Deal created", group: "Deals" },
  { id: "deal.closed", label: "Deal closed", group: "Deals" },
  { id: "deal.status_changed", label: "Deal status changed", group: "Deals" },
  { id: "payment.received", label: "Payment received", group: "Finance" },
  { id: "payment.late", label: "Payment late", group: "Finance" },
  { id: "campaign.sent", label: "Campaign sent", group: "Marketing" },
  { id: "offer.sent", label: "Offer sent", group: "Marketing" },
  { id: "offer.accepted", label: "Offer accepted", group: "Marketing" },
  { id: "task.created", label: "Task created", group: "Tasks" },
  { id: "task.completed", label: "Task completed", group: "Tasks" },
];

const EVENT_GROUPS = Array.from(new Set(ALL_EVENTS.map(e => e.group)));

export default function WebhooksPage() {
  useDocumentTitle("Webhooks");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const urlInputId = useId();
  const descInputId = useId();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [testingUrl, setTestingUrl] = useState<string | null>(null);
  const [newEndpoint, setNewEndpoint] = useState<WebhookEndpoint>({
    url: "",
    events: ["lead.created", "deal.closed"],
    enabled: true,
    description: "",
  });

  const { data, isLoading } = useQuery<{ endpoints: WebhookEndpoint[] }>({
    queryKey: ["/api/webhooks"],
    queryFn: () => fetch("/api/webhooks").then(r => r.json()),
  });

  const saveMutation = useMutation({
    mutationFn: (endpoints: WebhookEndpoint[]) =>
      apiRequest("PUT", "/api/webhooks", { endpoints }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/webhooks"] });
      toast({ title: "Webhooks saved" });
      setPendingRemove(null);
    },
    onError: (err: any) =>
      toast({
        title: "Couldn't save webhooks",
        description: `${err.message}. Your endpoint list is unchanged — try again.`,
        variant: "destructive",
      }),
  });

  const testMutation = useMutation({
    mutationFn: (url: string) =>
      apiRequest("POST", "/api/webhooks/test", { url }),
    onSuccess: () => toast({ title: "Test event sent", description: "Check your endpoint for the test payload." }),
    onError: (err: any) =>
      toast({
        title: "Test event didn't reach the endpoint",
        description: `${err.message}. The endpoint config is unchanged. Verify the URL responds with a 2xx status.`,
        variant: "destructive",
      }),
    onSettled: () => setTestingUrl(null),
  });

  const endpoints = data?.endpoints || [];

  function addEndpoint(e: React.FormEvent) {
    e.preventDefault();
    const updated = [...endpoints, newEndpoint];
    saveMutation.mutate(updated);
    setAddOpen(false);
    setNewEndpoint({ url: "", events: ["lead.created", "deal.closed"], enabled: true, description: "" });
  }

  function removeEndpoint(url: string) {
    const updated = endpoints.filter(e => e.url !== url);
    saveMutation.mutate(updated);
  }

  function toggleEndpoint(url: string) {
    const updated = endpoints.map(e => e.url === url ? { ...e, enabled: !e.enabled } : e);
    saveMutation.mutate(updated);
  }

  function toggleEvent(checked: boolean, eventId: string) {
    setNewEndpoint(ep => ({
      ...ep,
      events: checked ? [...ep.events, eventId] : ep.events.filter(e => e !== eventId),
    }));
  }

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Webhooks</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Send real-time event data to external services via HMAC-signed webhooks.</p>
        </div>
        <Button onClick={() => setAddOpen(true)} aria-label="Add a new webhook endpoint">
          <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
          Add endpoint
        </Button>
      </div>

      <Card className="mb-6 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
        <CardContent className="pt-4 pb-4">
          <div className="flex gap-3">
            <Shield className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100">HMAC-SHA256 signed payloads</p>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                All webhook payloads are signed with a secret key. Verify the <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded">X-AcreOS-Signature</code> header to ensure authenticity.
                Failed deliveries are automatically retried with exponential backoff (up to <span className="tabular-nums">5</span> attempts).
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center h-40" role="status" aria-live="polite">
          <span className="sr-only">Loading webhooks…</span>
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        </div>
      ) : endpoints.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Webhook className="h-12 w-12 text-muted-foreground mx-auto mb-4" aria-hidden="true" />
            <h2 className="text-lg font-semibold mb-2">No webhook endpoints</h2>
            <p className="text-muted-foreground mb-4">Connect AcreOS to Zapier, Make, or your own systems.</p>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
              Add your first endpoint
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3" aria-label="Webhook endpoints">
          {endpoints.map(ep => (
            <li key={ep.url}>
              <Card>
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Switch
                          checked={ep.enabled}
                          onCheckedChange={() => toggleEndpoint(ep.url)}
                          className="scale-75"
                          aria-label={`${ep.url}: ${ep.enabled ? "active" : "paused"}`}
                        />
                        <code className="text-sm font-mono truncate block">{ep.url}</code>
                      </div>
                      {ep.description && (
                        <p className="text-xs text-muted-foreground mb-2">{ep.description}</p>
                      )}
                      <ul className="flex flex-wrap gap-1" aria-label={`Events ${ep.url} subscribes to`}>
                        {ep.events.slice(0, 6).map(ev => (
                          <li key={ev}><Badge variant="secondary" className="text-xs py-0">{ev}</Badge></li>
                        ))}
                        {ep.events.length > 6 && (
                          <li><Badge variant="outline" className="text-xs py-0 tabular-nums">+{ep.events.length - 6} more</Badge></li>
                        )}
                      </ul>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant={ep.enabled ? "default" : "secondary"}>
                        {ep.enabled ? "Active" : "Paused"}
                      </Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setTestingUrl(ep.url);
                          testMutation.mutate(ep.url);
                        }}
                        disabled={testingUrl === ep.url}
                        aria-label={`Send test event to ${ep.url}`}
                      >
                        {testingUrl === ep.url ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        <span className="ml-1.5 hidden sm:inline">Test</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setPendingRemove(ep.url)}
                        aria-label={`Remove webhook endpoint ${ep.url}`}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card className="mt-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Code className="h-4 w-4" aria-hidden="true" />
            Payload format
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-muted p-3 rounded-lg overflow-x-auto">{`{
  "event": "lead.created",
  "timestamp": "2026-03-09T12:00:00.000Z",
  "organizationId": 1,
  "data": {
    "id": 123,
    "firstName": "John",
    "lastName": "Smith",
    "status": "new",
    ...
  }
}`}</pre>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add webhook endpoint</DialogTitle>
          </DialogHeader>
          <form onSubmit={addEndpoint}>
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label htmlFor={urlInputId}>Endpoint URL</Label>
                <Input
                  id={urlInputId}
                  type="url"
                  placeholder="https://hooks.zapier.com/hooks/catch/…"
                  value={newEndpoint.url}
                  onChange={e => setNewEndpoint(ep => ({ ...ep, url: e.target.value }))}
                  required
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  inputMode="url"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={descInputId}>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  id={descInputId}
                  placeholder="e.g. Zapier CRM sync"
                  value={newEndpoint.description || ""}
                  onChange={e => setNewEndpoint(ep => ({ ...ep, description: e.target.value }))}
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Events to subscribe</legend>
                {EVENT_GROUPS.map(group => (
                  <div key={group}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{group}</p>
                    <div className="grid grid-cols-2 gap-1.5 mb-2">
                      {ALL_EVENTS.filter(e => e.group === group).map(ev => (
                        <div key={ev.id} className="flex items-center gap-2">
                          <Checkbox
                            id={ev.id}
                            checked={newEndpoint.events.includes(ev.id)}
                            onCheckedChange={v => toggleEvent(v as boolean, ev.id)}
                          />
                          <Label htmlFor={ev.id} className="text-xs cursor-pointer">{ev.label}</Label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button
                type="submit"
                disabled={!newEndpoint.url || newEndpoint.events.length === 0 || saveMutation.isPending}
              >
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true" /> : null}
                Add endpoint
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(open) => { if (!open) setPendingRemove(null); }}
        title="Remove webhook endpoint?"
        description={
          pendingRemove
            ? `Stop sending events to ${pendingRemove}. The endpoint will no longer receive any AcreOS webhooks until you re-add it. Existing in-flight payloads continue to retry but new events stop.`
            : ""
        }
        confirmLabel="Yes, remove"
        variant="destructive"
        isLoading={saveMutation.isPending}
        onConfirm={() => pendingRemove && removeEndpoint(pendingRemove)}
      />
    </PageShell>
  );
}
