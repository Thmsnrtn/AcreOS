/**
 * MailboxConnect — R1c native business inbox connect card (Clerk rewire).
 *
 * The customer LINKS their Gmail / Outlook through Clerk (Clerk owns OAuth):
 * clicking Connect runs Clerk's `createExternalAccount` with mail scopes and
 * redirects to consent. On return we POST /api/mailbox to record the org-
 * scoped connection. AcreOS stores NO tokens — Clerk holds them and the
 * server reads one on-demand. Minimal custody at its floor.
 */

import { useEffect, useState } from "react";
import { useSafeUser } from "@/lib/clerk-safe";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Mail, Trash2, Plug, ShieldCheck, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/format";
import { clientLogger } from "@/lib/clientLogger";

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
  providers: string[];
}

const PROVIDER_META: Record<string, { label: string; strategy: string; scopes: string[] }> = {
  gmail: {
    label: "Gmail / Google Workspace",
    strategy: "oauth_google",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ],
  },
  outlook: {
    label: "Outlook / Microsoft 365",
    strategy: "oauth_microsoft",
    scopes: ["Mail.Read", "Mail.Send"],
  },
};

export function MailboxConnect() {
  const { toast } = useToast();
  const { user, isLoaded } = useSafeUser();
  const [linking, setLinking] = useState<string | null>(null);

  const { data, isLoading } = useQuery<MailboxResponse>({
    queryKey: ["/api/mailbox"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/mailbox");
      return (await res.json()) as MailboxResponse;
    },
  });

  // Record a mailbox once the user returns from Clerk's OAuth consent
  // (?mailbox_connect=<provider>).
  const record = useMutation({
    mutationFn: async (provider: string) => {
      const res = await apiRequest("POST", "/api/mailbox", { provider });
      return (await res.json()) as { mailbox: MailboxRow };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mailbox"] });
      toast({ title: "Mailbox connected", description: "AcreOS can now work your inbox with you." });
    },
    onError: () =>
      toast({ title: "Couldn't finish connecting the mailbox", variant: "destructive" }),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const provider = params.get("mailbox_connect");
    if (provider && PROVIDER_META[provider]) {
      params.delete("mailbox_connect");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
      record.mutate(provider);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const disconnect = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/mailbox/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mailbox"] });
      toast({ title: "Mailbox disconnected" });
    },
    onError: () => toast({ title: "Couldn't disconnect", variant: "destructive" }),
  });

  async function connect(provider: string) {
    const meta = PROVIDER_META[provider];
    if (!meta || !user) return;
    setLinking(provider);
    try {
      const redirectUrl = `${window.location.origin}/settings/byok?mailbox_connect=${provider}`;
      const externalAccount = await user.createExternalAccount({
        strategy: meta.strategy as Parameters<typeof user.createExternalAccount>[0]["strategy"],
        redirectUrl,
        additionalScopes: meta.scopes,
      });
      const url = externalAccount.verification?.externalVerificationRedirectURL;
      if (url) {
        window.location.href = url.toString();
      } else {
        // Already linked (no consent needed) — record immediately.
        record.mutate(provider);
        setLinking(null);
      }
    } catch (err) {
      clientLogger.error("Mailbox connect failed", err);
      toast({
        title: "Couldn't start the connection",
        description: "Make sure this sign-in method is enabled, then try again.",
        variant: "destructive",
      });
      setLinking(null);
    }
  }

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
          your mail. We hold no copy of your messages, and the secure connection is managed by your sign-in
          provider, not stored here.
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
                        <Badge
                          variant={mb.status === "connected" ? "default" : "secondary"}
                          className={mb.status === "connected" ? "bg-acr-pos text-acr-brand-ink hover:bg-acr-pos" : ""}
                        >
                          {mb.status === "connected" ? "Connected" : mb.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {PROVIDER_META[mb.provider]?.label ?? mb.provider}
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
              {(["gmail", "outlook"] as const).map((provider) => (
                <Button
                  key={provider}
                  variant="outline"
                  disabled={!isLoaded || !user || linking !== null || record.isPending}
                  onClick={() => connect(provider)}
                >
                  {linking === provider ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plug className="mr-2 h-4 w-4" aria-hidden="true" />
                  )}
                  Connect {PROVIDER_META[provider].label}
                </Button>
              ))}
            </div>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-acr-pos" aria-hidden="true" />
              The connection is managed by your sign-in provider and used only to read and send from your own
              account. Disconnect any time — AcreOS keeps no copy of your mailbox.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
