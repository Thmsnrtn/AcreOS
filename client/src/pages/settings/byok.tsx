/**
 * Settings → BYOK (Bring-Your-Own-Key)
 *
 * Pillar 5 cross-cutting (2026-05-22). Per-channel credential management
 * for Pro+ customers who want to plug their own provider accounts in
 * behind AcreOS. When a credential is active for a channel, that
 * channel's spend bypasses the AcreOS credit pool — the customer pays
 * the provider directly.
 *
 * Surface:
 *   - One row per supported channel (Twilio, Lob, SendGrid, ...)
 *   - "Platform" badge when no BYOK; fingerprint + lastUsedAt when BYOK
 *   - "Add credential" dialog per row → POST /api/byok
 *   - Revoke button when BYOK active → DELETE /api/byok/:channel
 *
 * Plain-language explainer at the top: "When you use your own keys, your
 * spend on that channel doesn't draw from your AcreOS credit pool — you
 * pay the provider directly."
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { getErrorMessage } from "@/lib/error-utils";
import { Trash2, KeyRound, ShieldCheck } from "lucide-react";
import { formatDate } from "@/lib/format";
import { Verbs } from "@/lib/labels";

interface ChannelStatus {
  channel: string;
  status: "platform" | "byok";
  fingerprint: string | null;
  lastUsedAt: string | null;
  createdAt: string | null;
}

interface ByokGetResponse {
  channels: ChannelStatus[];
  history: Array<{
    channel: string;
    fingerprint: string;
    createdAt: string | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }>;
}

// C1 legibility: lead with what the channel DOES in plain words; the
// "Format:" fragment stays as an input hint for the technical half.
const CHANNEL_LABELS: Record<string, { name: string; help: string; placeholder: string }> = {
  twilio: {
    name: "Twilio",
    help: "Texts and calls. Format: accountSid:authToken:phoneNumber",
    placeholder: "ACxxxxxxxx:xxxxxxxx:+15551234567",
  },
  telnyx: { name: "Telnyx", help: "Texts and calls (alternate carrier).", placeholder: "KEYxxxxxxxxxxxxxxxxxxxx" },
  sendgrid: { name: "SendGrid", help: "Email sending.", placeholder: "SG.xxxxxxxxxx" },
  ses: { name: "Amazon SES", help: "Email sending (via your AWS account).", placeholder: "AKIAxxxxxxxxxx" },
  lob: { name: "Lob", help: "Prints and mails your letters.", placeholder: "live_xxxxxxxxxx" },
  postgrid: { name: "PostGrid", help: "Prints and mails your letters (alternate).", placeholder: "key_live_xxxxxxxxxx" },
  openrouter: { name: "OpenRouter", help: "Powers Pax with your own AI account.", placeholder: "sk-or-v1-xxxxxxxx" },
  anthropic: { name: "Anthropic", help: "Powers Pax with your own Claude account.", placeholder: "sk-ant-xxxxxxxx" },
  openai: { name: "OpenAI", help: "Powers Pax with your own OpenAI account.", placeholder: "sk-xxxxxxxx" },
  batch_skiptracing: { name: "BatchSkipTracing", help: "Finds owners' phone numbers and addresses.", placeholder: "xxxxxxxx-xxxx-xxxx" },
  mapbox: { name: "Mapbox", help: "Maps and address lookups.", placeholder: "pk.xxxxxxxx" },
  s3: { name: "S3 / R2", help: "Stores your files. Format: accessKeyId:secretAccessKey:bucket", placeholder: "AKIA...:wJalr...:my-bucket" },
};

export default function ByokSettingsPage() {
  useDocumentTitle("Your provider keys");
  const { toast } = useToast();
  const [openChannel, setOpenChannel] = useState<string | null>(null);
  const [plaintext, setPlaintext] = useState("");
  const [requireValidation, setRequireValidation] = useState(true);

  const { data, isLoading } = useQuery<ByokGetResponse>({
    queryKey: ["/api/byok"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/byok");
      return (await res.json()) as ByokGetResponse;
    },
  });

  const setMutation = useMutation({
    mutationFn: async (vars: { channel: string; plaintext: string; requireValidation: boolean }) => {
      const res = await apiRequest("POST", "/api/byok", vars);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/byok"] });
      setOpenChannel(null);
      setPlaintext("");
      toast({ title: "Credential saved" });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: getErrorMessage(err), variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (channel: string) => {
      const res = await apiRequest("DELETE", `/api/byok/${channel}`);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/byok"] });
      toast({ title: "Credential revoked" });
    },
    onError: (err: Error) => {
      toast({ title: "Revoke failed", description: getErrorMessage(err), variant: "destructive" });
    },
  });

  return (
    <PageShell label="Your provider keys">
      <div className="mb-4">
        <h1 className="text-hero">Your provider keys</h1>
        <p className="text-sm text-muted-foreground">
          Use your own API keys for any channel — your spend goes straight to the provider, not through AcreOS credits.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-acr-pos" aria-hidden="true" />
            How this works
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            By default, AcreOS routes every paid action through our shared
            provider accounts and debits your AcreOS credit pool. If you'd
            rather use your own Twilio, Lob, SendGrid, OpenAI, or other
            provider account, paste the key here.
          </p>
          <p>
            <strong>When you use your own keys, your spend on that channel
            doesn't draw from your AcreOS credit pool — you pay the
            provider directly.</strong> We keep doing the orchestration; you
            keep your existing volume discounts and invoices.
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Channels</CardTitle>
          <CardDescription>
            Each row is one thing AcreOS does for you — texts, mail, email, AI — and whose account pays for it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between py-3">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-8 w-32" />
                </div>
              ))}
            </div>
          ) : (
            <div className="divide-y">
              {(data?.channels ?? []).map((row) => {
                const meta = CHANNEL_LABELS[row.channel] ?? { name: row.channel, help: "", placeholder: "" };
                return (
                  <div key={row.channel} className="flex items-center justify-between py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{meta.name}</span>
                        {row.status === "byok" ? (
                          <Badge variant="default" className="bg-acr-pos text-acr-brand-ink hover:bg-acr-pos">
                            BYOK · …{row.fingerprint}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Platform default</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {meta.help}
                        {row.lastUsedAt && (
                          <> · last used {formatDate(row.lastUsedAt)}</>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {row.status === "byok" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Revoke ${meta.name} credential`}
                          onClick={() => revokeMutation.mutate(row.channel)}
                          disabled={revokeMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setOpenChannel(row.channel);
                          setPlaintext("");
                        }}
                      >
                        <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
                        {row.status === "byok" ? "Replace" : "Add credential"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={openChannel !== null} onOpenChange={(open) => !open && setOpenChannel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add {openChannel ? (CHANNEL_LABELS[openChannel]?.name ?? openChannel) : ""} credential
            </DialogTitle>
            <DialogDescription>
              Your key is encrypted at rest with AES-256-GCM. We display only the last 4 characters.
              Spend on this channel will be billed directly by the provider.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="byok-key">Key</Label>
              <Input
                id="byok-key"
                type="password"
                autoComplete="off"
                placeholder={openChannel ? CHANNEL_LABELS[openChannel]?.placeholder : ""}
                value={plaintext}
                onChange={(e) => setPlaintext(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Label htmlFor="byok-validate" className="text-sm">
                  Check the key works before saving
                </Label>
                <p className="text-xs text-muted-foreground">
                  We make one test call so a wrong key gets caught now, not the first time you try to send.
                </p>
              </div>
              <Switch
                id="byok-validate"
                checked={requireValidation}
                onCheckedChange={setRequireValidation}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenChannel(null)}>
              {Verbs.CANCEL}
            </Button>
            <Button
              onClick={() => {
                if (!openChannel || !plaintext) return;
                setMutation.mutate({ channel: openChannel, plaintext, requireValidation });
              }}
              disabled={!plaintext || setMutation.isPending}
            >
              {setMutation.isPending ? "Saving…" : "Save credential"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
