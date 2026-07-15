/**
 * MailboxConnect — R1c native business inbox connect card (foundation slice).
 *
 * Lives in the connectors hub. Lets the operator connect their own Gmail /
 * Outlook account (OAuth) so AcreOS can become the intelligent inbox over it.
 * MINIMAL-CUSTODY: connecting stores only encrypted tokens; mail is read
 * on-demand (the inbox view is a later slice). Providers whose OAuth app the
 * platform hasn't configured render as "coming soon" rather than a dead
 * button — the same env-gated honesty as the rest of the hub.
 */

import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Mail, Trash2, Plug, ShieldCheck } from "lucide-react";
import { formatDate } from "@/lib/format";

interface MailboxRow {
  id: number;
  provider: string;
  emailAddress: string;
  status: string;
  lastError: string | null;
  lastSyncedAt: string | null;
  createdAt: string | null;
}

interface MailboxResponse {
  mailboxes: MailboxRow[];
  providers: Record<string, boolean>;
}

const PROVIDER_LABELS: Record<string, string> = {
  gmail: "Gmail / Google Workspace",
  outlook: "Outlook / Microsoft 365",
};

export function MailboxConnect() {
  const { toast } = useToast();

  // Surface the OAuth round-trip result (?mailbox=connected|error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("mailbox");
    if (result === "connected") {
      toast({ title: "Mailbox connected", description: "AcreOS can now work your inbox with you." });
    } else if (result === "error") {
      toast({ title: "Couldn't connect the mailbox", description: "Please try again.", variant: "destructive" });
    }
    if (result) {
      params.delete("mailbox");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      queryClient.invalidateQueries({ queryKey: ["/api/mailbox"] });
    }
  }, [toast]);

  const { data, isLoading } = useQuery<MailboxResponse>({
    queryKey: ["/api/mailbox"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/mailbox");
      return (await res.json()) as MailboxResponse;
    },
  });

  const disconnect = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/mailbox/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mailbox"] });
      toast({ title: "Mailbox disconnected" });
    },
    onError: () => toast({ title: "Couldn't disconnect", variant: "destructive" }),
  });

  const providers = data?.providers ?? {};
  const mailboxes = data?.mailboxes ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          Your business inbox
        </CardTitle>
        <CardDescription>
          Connect your own Gmail or Outlook so AcreOS becomes the intelligent inbox over it — your account,
          your mail. We store only the secure connection, never a copy of your messages.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : (
          <>
            {mailboxes.length > 0 && (
              <div className="divide-y">
                {mailboxes.map((mb) => (
                  <div key={mb.id} className="flex items-center justify-between py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{mb.emailAddress}</span>
                        <Badge variant={mb.status === "connected" ? "default" : "secondary"} className={mb.status === "connected" ? "bg-acr-pos text-acr-brand-ink hover:bg-acr-pos" : ""}>
                          {mb.status === "connected" ? "Connected" : mb.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {PROVIDER_LABELS[mb.provider] ?? mb.provider}
                        {mb.createdAt && <> · connected {formatDate(mb.createdAt)}</>}
                        {mb.lastError && <> · {mb.lastError}</>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Disconnect ${mb.emailAddress}`}
                      onClick={() => disconnect.mutate(mb.id)}
                      disabled={disconnect.isPending}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {(["gmail", "outlook"] as const).map((provider) => {
                const configured = providers[provider];
                return (
                  <Button
                    key={provider}
                    variant="outline"
                    disabled={!configured}
                    onClick={() => {
                      // Full-page redirect into the OAuth consent flow.
                      window.location.href = `/api/mailbox/connect/${provider}`;
                    }}
                    title={configured ? undefined : "Coming soon"}
                  >
                    <Plug className="mr-2 h-4 w-4" aria-hidden="true" />
                    Connect {PROVIDER_LABELS[provider]}
                    {!configured && <span className="ml-2 text-xs text-muted-foreground">(coming soon)</span>}
                  </Button>
                );
              })}
            </div>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-acr-pos" aria-hidden="true" />
              Tokens are encrypted at rest and only ever used to read and send from your own account. Disconnect any
              time — AcreOS keeps no copy of your mailbox.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
