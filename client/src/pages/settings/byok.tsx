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
import { Trash2, KeyRound, ShieldCheck, MessageSquare, Mail, Printer, Sparkles, Database, MapPin, type LucideIcon } from "lucide-react";
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
  batch_skiptracing: { name: "BatchData", help: "Finds owners' phones and addresses, and pulls property details — your BatchData account, billed direct.", placeholder: "xxxxxxxx-xxxx-xxxx" },
  mapbox: { name: "Mapbox", help: "Maps and address lookups.", placeholder: "pk.xxxxxxxx" },
  s3: { name: "S3 / R2", help: "Stores your files. Format: accessKeyId:secretAccessKey:bucket", placeholder: "AKIA...:wJalr...:my-bucket" },
  attom: { name: "ATTOM Data", help: "Property details, valuations, and comps — your ATTOM account, billed direct.", placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
  regrid: { name: "Regrid", help: "Nationwide parcel boundaries and owner data — your Regrid account, billed direct.", placeholder: "xxxxxxxx-xxxx-xxxx" },
};

// R1 Connectors hub: group the channels by what they DO, so the surface reads
// as "connect the tools your business runs on" (the home-base reshape) rather
// than a flat key list. Each group leads with the capability, not the vendor.
// Any channel not listed here still renders under "More connectors" so a newly
// added channel is never silently hidden.
const CHANNEL_GROUPS: Array<{ title: string; blurb: string; channels: string[]; icon: LucideIcon }> = [
  { title: "Texts & calls", blurb: "Reach sellers by SMS and phone on your own carrier account.", channels: ["twilio", "telnyx"], icon: MessageSquare },
  { title: "Email", blurb: "Send from your verified domain for the best deliverability.", channels: ["sendgrid", "ses"], icon: Mail },
  { title: "Print & mail", blurb: "Print and post physical letters and postcards to owners.", channels: ["lob", "postgrid"], icon: Printer },
  { title: "AI & Pax", blurb: "Power Pax with your own AI account past the included turns.", channels: ["openrouter", "anthropic", "openai"], icon: Sparkles },
  { title: "Property data", blurb: "Pull parcels, owners, comps, and skip-trace on your own data account.", channels: ["batch_skiptracing", "attom", "regrid"], icon: Database },
  { title: "Storage & maps", blurb: "Bring your own file storage and mapping tokens.", channels: ["s3", "mapbox"], icon: MapPin },
];

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

      {isLoading ? (
        <Card className="mt-4">
          <CardContent className="pt-6">
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
          </CardContent>
        </Card>
      ) : (
        (() => {
          // Index the API status rows by channel, then render grouped by
          // capability. A trailing "More connectors" group catches any channel
          // the server returns that isn't assigned to a group above, so a new
          // channel is never silently dropped from the surface.
          const byChannel = new Map((data?.channels ?? []).map((r) => [r.channel, r]));
          const grouped = new Set(CHANNEL_GROUPS.flatMap((g) => g.channels));
          const leftover = (data?.channels ?? [])
            .map((r) => r.channel)
            .filter((ch) => !grouped.has(ch));
          const groups = [
            ...CHANNEL_GROUPS.map((g) => ({ ...g, channels: g.channels.filter((ch) => byChannel.has(ch)) })),
            ...(leftover.length
              ? [{ title: "More connectors", blurb: "Other services you can bring your own account for.", channels: leftover, icon: KeyRound as LucideIcon }]
              : []),
          ].filter((g) => g.channels.length > 0);

          const renderRow = (channel: string) => {
            const row = byChannel.get(channel);
            if (!row) return null;
            const meta = CHANNEL_LABELS[channel] ?? { name: channel, help: "", placeholder: "" };
            return (
              <div key={channel} className="flex items-center justify-between py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{meta.name}</span>
                    {row.status === "byok" ? (
                      <Badge variant="default" className="bg-acr-pos text-acr-brand-ink hover:bg-acr-pos">
                        Connected · …{row.fingerprint}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Platform default</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {meta.help}
                    {row.lastUsedAt && <> · last used {formatDate(row.lastUsedAt)}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {row.status === "byok" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Revoke ${meta.name} credential`}
                      onClick={() => revokeMutation.mutate(channel)}
                      disabled={revokeMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOpenChannel(channel);
                      setPlaintext("");
                    }}
                  >
                    <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
                    {row.status === "byok" ? "Replace" : "Connect"}
                  </Button>
                </div>
              </div>
            );
          };

          return (
            <div className="mt-4 space-y-4">
              {groups.map((group) => {
                const GroupIcon = group.icon;
                const connectedCount = group.channels.filter((ch) => byChannel.get(ch)?.status === "byok").length;
                return (
                  <Card key={group.title}>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <GroupIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                        {group.title}
                        {connectedCount > 0 && (
                          <Badge variant="secondary" className="ml-1 font-normal">
                            {connectedCount} connected
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription>{group.blurb}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="divide-y">{group.channels.map(renderRow)}</div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          );
        })()
      )}

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
