/**
 * AutopilotSetup — the crystal-clear, one-screen way to configure what Pax
 * does on its own, what it can use, and exactly what that means right now.
 *
 * Three plain-language sections (design steals: Intercom's "handles alone vs.
 * brings to you" framing, Zapier/n8n's plain-English rules, Shopify's connect-
 * your-tools rows):
 *   1. How much should Pax do?  — the four autonomy levels as clear choices.
 *   2. What Pax can use          — capability rows, each with a connect wizard.
 *   3. What this means right now  — a live summary of Pax's behaviour given the
 *                                  chosen level + the connected tools.
 *
 * Reads/writes the user autonomy pref (/api/me/autonomy, pax.level 0–3) and
 * READS connector state (/api/byok, /api/mailbox) to drive the summary. It
 * links to the connectors hub for the actual wizards — it never duplicates
 * them. Nav discipline: rendered inside Settings, never a new door.
 */

import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Eye, HandHelping, Zap, Rocket, MessageSquare, Mail, Printer, Database, Inbox, ArrowRight, CheckCircle2, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Level = 0 | 1 | 2 | 3;

interface AutonomyPrefs {
  pax?: { level?: Level };
}

interface ByokChannelRow {
  channel: string;
  status: "platform" | "byok";
}
interface ByokResponse {
  channels: ByokChannelRow[];
}
interface MailboxResponse {
  mailboxes: Array<{ id: number; emailAddress: string }>;
}

// The four autonomy levels, in plain language: what Pax handles alone vs.
// what it brings to you. Mirrors the user pref pax.level (0–3).
const LEVELS: {
  level: Level;
  name: string;
  icon: typeof Eye;
  handles: string;
  brings: string;
}[] = [
  { level: 0, name: "Suggest only", icon: Eye, handles: "Watches your pipeline and suggests next steps.", brings: "Everything — it never acts on its own." },
  { level: 1, name: "Ask first", icon: HandHelping, handles: "Prepares the work — drafts replies, builds lists, plans follow-ups.", brings: "Every action, for your OK before anything goes out." },
  { level: 2, name: "Act & tell", icon: Zap, handles: "Does the routine on its own — drafts, follow-ups, list-pulls — and tells you.", brings: "The bigger calls (offers, spend, anything risky)." },
  { level: 3, name: "Full autopilot", icon: Rocket, handles: "Runs the pipeline end-to-end within your guardrails.", brings: "Only the hard-stops — money, legal, pricing." },
];

// Capability rows — what Pax can DO once a rail is connected. "connected" is
// keyed on the customer having their own key (BYO-rails); the connect link
// goes to the wizard in the connectors hub.
const CAPABILITIES: {
  key: string;
  label: string;
  icon: typeof MessageSquare;
  channels: string[];
  unlocks: string;
}[] = [
  { key: "texts", label: "Text sellers", icon: MessageSquare, channels: ["twilio", "telnyx"], unlocks: "text sellers and follow up by SMS" },
  { key: "email", label: "Send email", icon: Mail, channels: ["sendgrid", "ses"], unlocks: "email sellers and buyers" },
  { key: "mail", label: "Send mail", icon: Printer, channels: ["lob", "postgrid"], unlocks: "send letters and postcards" },
  { key: "data", label: "Pull property data", icon: Database, channels: ["attom", "regrid", "batch_skiptracing"], unlocks: "pull owners, comps, and skip-trace" },
];

export function AutopilotSetup() {
  const { toast } = useToast();

  const { data: autonomy, isLoading: autoLoading } = useQuery<AutonomyPrefs>({
    queryKey: ["/api/me/autonomy"],
  });
  const { data: byok } = useQuery<ByokResponse>({
    queryKey: ["/api/byok"],
    queryFn: async () => (await (await apiRequest("GET", "/api/byok")).json()) as ByokResponse,
  });
  const { data: mailbox } = useQuery<MailboxResponse>({
    queryKey: ["/api/mailbox"],
    queryFn: async () => (await (await apiRequest("GET", "/api/mailbox")).json()) as MailboxResponse,
  });

  const level = (autonomy?.pax?.level ?? 1) as Level;

  const setLevel = useMutation({
    mutationFn: async (next: Level) =>
      apiRequest("PATCH", "/api/me/autonomy", { pax: { ...(autonomy?.pax ?? {}), level: next } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/autonomy"] });
      toast({ title: "Autopilot updated" });
    },
    onError: () => toast({ title: "Couldn't update autopilot", variant: "destructive" }),
  });

  const byokChannels = new Set((byok?.channels ?? []).filter((c) => c.status === "byok").map((c) => c.channel));
  const isCapabilityConnected = (channels: string[]) => channels.some((c) => byokChannels.has(c));
  const inboxConnected = (mailbox?.mailboxes?.length ?? 0) > 0;

  // The live "what this means" summary.
  const active = LEVELS.find((l) => l.level === level) ?? LEVELS[1];
  const connectedCaps = CAPABILITIES.filter((c) => isCapabilityConnected(c.channels));
  const missingCaps = CAPABILITIES.filter((c) => !isCapabilityConnected(c.channels));

  if (autoLoading) {
    return <Skeleton className="h-[420px] w-full" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
          Autopilot
        </CardTitle>
        <CardDescription>
          Decide how much Pax does on its own, connect the tools it uses, and see exactly what happens — in one place.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8">
        {/* 1 — How much should Pax do? */}
        <section>
          <h3 className="text-sm font-semibold mb-3">How much should Pax do for you?</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {LEVELS.map((l) => {
              const Icon = l.icon;
              const selected = l.level === level;
              return (
                <button
                  key={l.level}
                  type="button"
                  onClick={() => !selected && setLevel.mutate(l.level)}
                  disabled={setLevel.isPending}
                  aria-pressed={selected}
                  data-testid={`autopilot-level-${l.level}`}
                  className={cn(
                    "text-left rounded-card border p-4 transition-colors hover-elevate",
                    selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-muted/30",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                    <span className="font-medium">{l.name}</span>
                    {selected && <CheckCircle2 className="ml-auto h-4 w-4 text-primary" aria-hidden="true" />}
                  </div>
                  <dl className="mt-2 space-y-1 text-xs">
                    <div>
                      <dt className="inline text-acr-pos font-medium">Handles: </dt>
                      <dd className="inline text-muted-foreground">{l.handles}</dd>
                    </div>
                    <div>
                      <dt className="inline text-foreground/70 font-medium">Brings to you: </dt>
                      <dd className="inline text-muted-foreground">{l.brings}</dd>
                    </div>
                  </dl>
                </button>
              );
            })}
          </div>
        </section>

        {/* 2 — What Pax can use */}
        <section>
          <h3 className="text-sm font-semibold mb-1">What Pax can use</h3>
          <p className="text-xs text-muted-foreground mb-3">
            Connect your own accounts so Pax can act on your behalf — your keys, your invoices.
          </p>
          <div className="divide-y">
            {CAPABILITIES.map((c) => {
              const Icon = c.icon;
              const connected = isCapabilityConnected(c.channels);
              return (
                <div key={c.key} className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                    <span className="text-sm truncate">{c.label}</span>
                  </div>
                  {connected ? (
                    <Badge variant="default" className="bg-acr-pos text-acr-brand-ink hover:bg-acr-pos">
                      <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> Connected
                    </Badge>
                  ) : (
                    <Button asChild variant="outline" size="sm">
                      <Link href="/settings/byok">
                        Connect <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </Button>
                  )}
                </div>
              );
            })}
            {/* Inbox capability (Gmail/Outlook via Clerk). */}
            <div className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-3 min-w-0">
                <Inbox className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <span className="text-sm truncate">Read & reply to your inbox</span>
              </div>
              {inboxConnected ? (
                <Badge variant="default" className="bg-acr-pos text-acr-brand-ink hover:bg-acr-pos">
                  <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" /> Connected
                </Badge>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings/byok">
                    Connect <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </section>

        {/* 3 — What this means right now */}
        <section className="rounded-card border border-border/60 bg-muted/30 p-4">
          <h3 className="text-sm font-semibold mb-2">What this means right now</h3>
          <p className="text-sm text-muted-foreground">
            At <span className="font-medium text-foreground">{active.name}</span>, Pax {active.handles.charAt(0).toLowerCase() + active.handles.slice(1)}
            {" "}It brings {active.brings.charAt(0).toLowerCase() + active.brings.slice(1)}
          </p>
          {connectedCaps.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              With your connected tools it can{" "}
              <span className="text-foreground">{connectedCaps.map((c) => c.unlocks).join(", ")}</span>
              {inboxConnected && <>, and read &amp; reply to your inbox</>}.
            </p>
          )}
          {missingCaps.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Connect {missingCaps.map((c) => c.label.toLowerCase()).join(", ")} to let Pax do more on your behalf.
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
