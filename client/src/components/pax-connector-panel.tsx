// PaxConnectorPanel — Sheet for managing Pax integrations (connectors)
// Opens from a Plug icon in the Pax rail header.

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plug,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Trash2,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Verbs } from "@/lib/labels";

interface CredentialField {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
  helpText?: string;
}

interface ConnectorDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  authType: string;
  capabilities: string[];
  tools: string[];
  credentialFields?: CredentialField[];
  setupUrl?: string;
  isPremium?: boolean;
  instance: {
    id: number;
    status: string;
    lastTestedAt?: string;
    errorMessage?: string;
  } | null;
}

interface PaxConnectorPanelProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  communication: "Communication",
  finance: "Finance",
  storage: "Storage & Documents",
  productivity: "Productivity",
  real_estate: "Real Estate",
  automation: "Automation",
};

function StatusBadge({ status }: { status?: string }) {
  if (!status || status === "disconnected") {
    return <Badge variant="outline" className="text-[10px] h-4">Not connected</Badge>;
  }
  if (status === "connected") {
    return (
      <Badge variant="default" className="text-[10px] h-4 bg-green-600 hover:bg-green-600">
        <CheckCircle2 className="w-2.5 h-2.5 mr-1" /> Connected
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="text-[10px] h-4">
      <AlertCircle className="w-2.5 h-2.5 mr-1" /> Error
    </Badge>
  );
}

function ConnectDialog({
  connector,
  open,
  onOpenChange,
  onSave,
}: {
  connector: ConnectorDef;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSave: (credentials: Record<string, string>) => Promise<void>;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(fields);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect {connector.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Provide credentials to connect the {connector.name} integration.
          </DialogDescription>
        </DialogHeader>
        <form
          id="connect-connector-form"
          className="space-y-4 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving) handleSave();
          }}
        >
          {connector.credentialFields?.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key}>{f.label}</Label>
              <Input
                id={f.key}
                placeholder={f.placeholder}
                type={f.secret ? "password" : "text"}
                value={fields[f.key] ?? ""}
                onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                autoComplete={f.secret ? "off" : undefined}
                autoCapitalize={f.secret ? "off" : undefined}
                autoCorrect={f.secret ? "off" : undefined}
                spellCheck={f.secret ? false : undefined}
              />
              {f.helpText && (
                <p className="text-[11px] text-muted-foreground">{f.helpText}</p>
              )}
            </div>
          ))}
          {connector.authType === "oauth" && (
            <p className="text-xs text-muted-foreground">
              This connector uses OAuth. Click Connect to be redirected to authorize access.
            </p>
          )}
          {connector.setupUrl && (
            <a
              href={connector.setupUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Setup guide for ${connector.name ?? "this connector"} (opens in new tab)`}
              className="flex items-center gap-1 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            >
              <ExternalLink className="w-3 h-3" aria-hidden="true" /> Setup guide
            </a>
          )}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{Verbs.CANCEL}</Button>
          <Button type="submit" form="connect-connector-form" disabled={saving}>
            {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" />}
            {saving ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaxConnectorPanel({ open, onOpenChange }: PaxConnectorPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const { data: connectors = [], isLoading } = useQuery<ConnectorDef[]>({
    queryKey: ["/api/ai/connectors"],
    enabled: open,
  });

  const disconnectMutation = useMutation({
    mutationFn: (connectorId: string) =>
      apiRequest("DELETE", `/api/ai/connectors/${connectorId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/connectors"] });
      toast({ title: "Connector disconnected" });
    },
  });

  const connectMutation = useMutation({
    mutationFn: ({ id, credentials }: { id: string; credentials: Record<string, string> }) =>
      apiRequest("POST", `/api/ai/connectors/${id}/connect`, { credentials }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/ai/connectors"] });
      toast({ title: "Connector connected", description: "Pax can now use this integration." });
    },
    onError: (err: any) => {
      toast({ title: "Couldn't connect", description: `${err.message} — the connector remains disconnected.`, variant: "destructive" });
    },
  });

  // Group by category
  const byCategory = connectors.reduce<Record<string, ConnectorDef[]>>((acc, c) => {
    if (!acc[c.category]) acc[c.category] = [];
    acc[c.category].push(c);
    return acc;
  }, {});

  const connectingConnector = connectors.find((c) => c.id === connectingId);

  const connectedCount = connectors.filter((c) => c.instance?.status === "connected").length;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[420px] sm:w-[480px] overflow-y-auto">
          <SheetHeader className="pb-4 border-b">
            <SheetTitle className="flex items-center gap-2">
              <Plug className="w-4 h-4 text-primary" />
              Integrations
            </SheetTitle>
            <p className="text-xs text-muted-foreground">
              Connect external services so Pax can take actions on your behalf.
              {connectedCount > 0 && (
                <span className="ml-1 font-medium text-foreground">
                  {connectedCount} active.
                </span>
              )}
            </p>
          </SheetHeader>

          {isLoading ? (
            <div role="status" aria-busy="true" aria-label="Loading connectors" className="flex justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">Loading…</span>
            </div>
          ) : (
            <div className="space-y-6 pt-4">
              {Object.entries(CATEGORY_LABELS).map(([cat, label]) => {
                const group = byCategory[cat];
                if (!group?.length) return null;
                return (
                  <div key={cat}>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
                      {label}
                    </p>
                    <div className="space-y-2">
                      {group.map((connector) => {
                        const isConnected = connector.instance?.status === "connected";
                        return (
                          <div
                            key={connector.id}
                            className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-sm font-medium">{connector.name}</span>
                                {connector.isPremium && (
                                  <Badge variant="secondary" className="text-[10px] h-4">Premium</Badge>
                                )}
                                <StatusBadge status={connector.instance?.status} />
                              </div>
                              <p className="text-[11px] text-muted-foreground leading-tight line-clamp-2">
                                {connector.description}
                              </p>
                              {isConnected && connector.instance?.lastTestedAt && (
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  Last tested {new Date(connector.instance.lastTestedAt).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0 pt-0.5">
                              {isConnected ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => disconnectMutation.mutate(connector.id)}
                                  title="Disconnect"
                                  aria-label="Disconnect integration"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1"
                                  onClick={() => setConnectingId(connector.id)}
                                >
                                  Connect <ChevronRight className="w-3 h-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {connectingConnector && (
        <ConnectDialog
          connector={connectingConnector}
          open={!!connectingId}
          onOpenChange={(v) => !v && setConnectingId(null)}
          onSave={async (credentials) => {
            await connectMutation.mutateAsync({ id: connectingConnector.id, credentials });
          }}
        />
      )}
    </>
  );
}
