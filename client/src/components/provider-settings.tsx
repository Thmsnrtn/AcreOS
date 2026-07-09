/**
 * Service status — which channels are ready and what each send costs.
 *
 * C1 legibility (2026-07-09): rewritten in consequence language. This
 * card answers two customer questions — "can AcreOS do X for me right
 * now?" and "what does one X cost?" — using only what the server
 * actually reports (/api/organization/providers). The old version
 * leaked internal routing trivia (model names, $/M-token prices) as
 * hardcoded client copy that could silently drift from reality.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Cpu, MessageSquare, Mail } from "lucide-react";

interface ProviderStatus {
  ai: {
    openai: boolean;
    openrouter: boolean;
    defaultTier: "economy" | "premium";
  };
  sms: {
    available: string[];
    default: string | null;
    costs: Record<string, number>;
  };
  mail: {
    available: string[];
    default: string | null;
    costs: Record<string, { letter: number; postcard: number }>;
  };
}

function ReadyBadge({ ready }: { ready: boolean }) {
  return (
    <Badge variant={ready ? "default" : "outline"} className="gap-1">
      {ready ? (
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      ) : (
        <XCircle className="h-3 w-3" aria-hidden="true" />
      )}
      {ready ? "Ready" : "Not set up"}
    </Badge>
  );
}

// Sub-nickel costs (a text is ~$0.008) render in cents so rounding
// doesn't overstate them; everything else as dollars.
function formatCost(cost: number): string {
  if (cost < 0.05) return `${(cost * 100).toFixed(1)}¢ each`;
  return `$${cost.toFixed(2)} each`;
}

function CostRow({ label, cost }: { label: string; cost: number }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{formatCost(cost)}</span>
    </div>
  );
}

export function ProviderSettings() {
  const { data: providers, isLoading } = useQuery<ProviderStatus>({
    queryKey: ["/api/organization/providers"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!providers) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          We couldn't check service status right now. Try refreshing.
        </CardContent>
      </Card>
    );
  }

  const aiReady = providers.ai.openai || providers.ai.openrouter;
  const smsReady = providers.sms.available.length > 0;
  const mailReady = providers.mail.available.length > 0;
  const smsCost = providers.sms.default ? providers.sms.costs[providers.sms.default] : undefined;
  const mailCosts = providers.mail.default ? providers.mail.costs[providers.mail.default] : undefined;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" aria-hidden="true" />
            AI
          </CardTitle>
          <CardDescription>
            Pax, deal analysis, and drafting. AcreOS picks the cheapest AI that can handle each job, so
            routine work never runs up your bill.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ReadyBadge ready={aiReady} />
            {aiReady && (
              <span className="text-sm text-muted-foreground">
                {providers.ai.defaultTier === "economy"
                  ? "Running in cost-saving mode"
                  : "Running in full-power mode"}
              </span>
            )}
          </div>
          {!aiReady && (
            <p className="text-sm text-muted-foreground">
              AI features aren't available yet — contact support if this doesn't resolve on its own.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
            Texting
          </CardTitle>
          <CardDescription>Text messages to sellers and text alerts to you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ReadyBadge ready={smsReady} />
          {smsReady && smsCost !== undefined && (
            <div className="rounded-card border p-3 bg-muted/30">
              <CostRow label="One text message" cost={smsCost} />
            </div>
          )}
          {!smsReady && (
            <p className="text-sm text-muted-foreground">
              Texting isn't set up yet. Plug in your own Twilio account under "Use your own provider
              accounts" below, or contact support.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" aria-hidden="true" />
            Letters &amp; postcards
          </CardTitle>
          <CardDescription>Real mail, printed and delivered to sellers for you.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ReadyBadge ready={mailReady} />
          {mailReady && mailCosts && (
            <div className="rounded-card border p-3 bg-muted/30">
              <CostRow label="One letter" cost={mailCosts.letter} />
              <CostRow label="One postcard" cost={mailCosts.postcard} />
            </div>
          )}
          {!mailReady && (
            <p className="text-sm text-muted-foreground">
              Mail isn't set up yet. Plug in your own Lob account under "Use your own provider accounts"
              below, or contact support.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
