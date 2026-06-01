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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const CHANNEL_LABELS: Record<string, { name: string; help: string; placeholder: string }> = {
  twilio: {
    name: "Twilio",
    help: "SMS + voice. Format: accountSid:authToken:phoneNumber",
    placeholder: "ACxxxxxxxx:xxxxxxxx:+15551234567",
  },
  telnyx: { name: "Telnyx", help: "SMS + voice (alt carrier).", placeholder: "KEYxxxxxxxxxxxxxxxxxxxx" },
  sendgrid: { name: "SendGrid", help: "Transactional + marketing email.", placeholder: "SG.xxxxxxxxxx" },
  ses: { name: "Amazon SES", help: "AWS-native transactional email.", placeholder: "AKIAxxxxxxxxxx" },
  lob: { name: "Lob", help: "Direct mail printing + delivery.", placeholder: "live_xxxxxxxxxx" },
  postgrid: { name: "PostGrid", help: "Direct mail (alt).", placeholder: "key_live_xxxxxxxxxx" },
  openrouter: { name: "OpenRouter", help: "Multi-model AI gateway.", placeholder: "sk-or-v1-xxxxxxxx" },
  anthropic: { name: "Anthropic", help: "Claude API direct.", placeholder: "sk-ant-xxxxxxxx" },
  openai: { name: "OpenAI", help: "GPT API direct.", placeholder: "sk-xxxxxxxx" },
  batch_skiptracing: { name: "BatchSkipTracing", help: "Skip-trace owner contact info.", placeholder: "xxxxxxxx-xxxx-xxxx" },
  mapbox: { name: "Mapbox", help: "Maps + geocoding.", placeholder: "pk.xxxxxxxx" },
  s3: { name: "S3 / R2", help: "Object storage. Format: accessKeyId:secretAccessKey:bucket", placeholder: "AKIA...:wJalr...:my-bucket" },
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
            <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
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
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
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
                          <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-600">
                            BYOK · …{row.fingerprint}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Platform default</Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {meta.help}
                        {row.lastUsedAt && (
                          <> · last used {new Date(row.lastUsedAt).toLocaleDateString()}</>
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
            <div className="flex items-center justify-between">
              <Label htmlFor="byok-validate" className="text-sm">
                Validate with provider before saving
              </Label>
              <Switch
                id="byok-validate"
                checked={requireValidation}
                onCheckedChange={setRequireValidation}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpenChannel(null)}>
              Cancel
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
