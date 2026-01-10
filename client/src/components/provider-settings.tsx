import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, XCircle, Cpu, MessageSquare, Mail, DollarSign } from "lucide-react";

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

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <Badge variant={active ? "default" : "outline"} className="gap-1">
      {active ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </Badge>
  );
}

function CostDisplay({ label, cost, unit = "each" }: { label: string; cost: number; unit?: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">${cost.toFixed(4)}/{unit}</span>
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
          Unable to load provider status
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="h-5 w-5" />
            AI Providers
          </CardTitle>
          <CardDescription>
            AI tasks are automatically routed to the most cost-effective provider based on complexity
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <StatusBadge active={providers.ai.openrouter} label="OpenRouter (Economy)" />
            <StatusBadge active={providers.ai.openai} label="OpenAI (Premium)" />
          </div>
          
          <div className="rounded-lg border p-3 bg-muted/30">
            <div className="text-sm font-medium mb-2">Automatic Routing</div>
            <div className="text-sm text-muted-foreground space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">Simple Tasks</Badge>
                <span>Summaries, drafts, data extraction → DeepSeek (~$0.14/M tokens)</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">Complex Tasks</Badge>
                <span>Deal analysis, legal docs, negotiations → GPT-4o (~$2.50/M tokens)</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-sm">
            <DollarSign className="h-4 w-4 text-green-600" />
            <span>
              Current mode: <strong>{providers.ai.defaultTier === "economy" ? "Economy (90% cheaper)" : "Premium"}</strong>
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            SMS Providers
          </CardTitle>
          <CardDescription>
            Text messaging providers for lead outreach and notifications
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <StatusBadge 
              active={providers.sms.available.includes("telnyx")} 
              label="Telnyx (Economy)" 
            />
            <StatusBadge 
              active={providers.sms.available.includes("twilio")} 
              label="Twilio (Premium)" 
            />
          </div>
          
          {providers.sms.available.length > 0 && (
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-sm font-medium mb-2">Cost per SMS</div>
              {providers.sms.costs.telnyx !== undefined && (
                <CostDisplay label="Telnyx" cost={providers.sms.costs.telnyx} unit="SMS" />
              )}
              {providers.sms.costs.twilio !== undefined && (
                <CostDisplay label="Twilio" cost={providers.sms.costs.twilio} unit="SMS" />
              )}
            </div>
          )}
          
          {providers.sms.default && (
            <div className="flex items-center gap-2 text-sm">
              <DollarSign className="h-4 w-4 text-green-600" />
              <span>
                Default provider: <strong>{providers.sms.default}</strong>
                {providers.sms.default === "telnyx" && " (50% cheaper)"}
              </span>
            </div>
          )}
          
          {providers.sms.available.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No SMS provider configured. Add Telnyx or Twilio API keys in integrations.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Direct Mail Providers
          </CardTitle>
          <CardDescription>
            Physical mail services for postcards and letters
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <StatusBadge 
              active={providers.mail.available.includes("pcm")} 
              label="PCM (No Monthly Fee)" 
            />
            <StatusBadge 
              active={providers.mail.available.includes("lob")} 
              label="Lob (Premium)" 
            />
          </div>
          
          {providers.mail.available.length > 0 && (
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-sm font-medium mb-2">Cost per Piece</div>
              {providers.mail.costs.pcm && (
                <>
                  <CostDisplay label="PCM Letter" cost={providers.mail.costs.pcm.letter} />
                  <CostDisplay label="PCM Postcard" cost={providers.mail.costs.pcm.postcard} />
                </>
              )}
              {providers.mail.costs.lob && (
                <>
                  <CostDisplay label="Lob Letter" cost={providers.mail.costs.lob.letter} />
                  <CostDisplay label="Lob Postcard" cost={providers.mail.costs.lob.postcard} />
                </>
              )}
            </div>
          )}
          
          {providers.mail.default && (
            <div className="flex items-center gap-2 text-sm">
              <DollarSign className="h-4 w-4 text-green-600" />
              <span>
                Default provider: <strong>{providers.mail.default}</strong>
                {providers.mail.default === "pcm" && " (No monthly subscription)"}
              </span>
            </div>
          )}
          
          {providers.mail.available.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No mail provider configured. Add PCM or Lob API keys in integrations.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
