import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { PageShell } from "@/components/page-shell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Plug,
  ExternalLink,
  Copy,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import { useDocumentTitle } from "@/hooks/use-document-title";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Integration {
  key: string;
  displayName: string;
  isConfigured: boolean;
  isCritical: boolean;
  category: "ai" | "communications" | "data" | "mail";
  setupDocsUrl: string;
  flySecretName: string;
  envVars: string[];
  lastVerificationStatus: string;
  lastVerifiedAt: string | null;
}

interface IntegrationsResponse {
  integrations: Integration[];
  summary: {
    total: number;
    configured: number;
    criticalMissing: number;
  };
}

interface VerifyResult {
  key: string;
  status: "pass" | "fail";
  message: string;
  verifiedAt: string;
}

// ─── Category labels ────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  ai: "AI Services",
  communications: "Communications",
  data: "Data Providers",
  mail: "Direct Mail",
};

const CATEGORY_ORDER = ["ai", "data", "communications", "mail"];

// ─── Component ──────────────────────────────────────────────────────────────

export default function FounderIntegrationsPage() {
  useDocumentTitle("Integrations");

  const { toast } = useToast();
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<string, VerifyResult>>({});

  const { data, isLoading, error } = useQuery<IntegrationsResponse>({
    queryKey: ["/api/founder/integrations"],
  });

  const verifyMutation = useMutation({
    mutationFn: async (key: string) => {
      const res = await apiRequest("POST", `/api/founder/integrations/${key}/verify`);
      return res.json() as Promise<VerifyResult>;
    },
    onSuccess: (result) => {
      setVerifyResults((prev) => ({ ...prev, [result.key]: result }));
      toast({
        title: result.status === "pass" ? "Verification passed" : "Verification failed",
        description: result.message,
        variant: result.status === "pass" ? "default" : "destructive",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Verification error",
        description: err.message || "Could not verify integration.",
        variant: "destructive",
      });
    },
  });

  const handleCopy = (integration: Integration) => {
    const command = `fly secrets set ${integration.flySecretName}="YOUR_KEY_HERE"`;
    navigator.clipboard.writeText(command).then(() => {
      setCopiedKey(integration.key);
      setTimeout(() => setCopiedKey(null), 2000);
      toast({ title: "Copied to clipboard", description: command });
    });
  };

  // Group integrations by category
  const grouped = data
    ? CATEGORY_ORDER.map((cat) => ({
        category: cat,
        label: CATEGORY_LABELS[cat] || cat,
        integrations: data.integrations.filter((i) => i.category === cat),
      })).filter((g) => g.integrations.length > 0)
    : [];

  return (
    <PageShell>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Plug className="w-7 h-7" aria-hidden="true" />
            External Integrations
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitor and configure third-party service connections.
          </p>
        </div>

        {/* Summary banner */}
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : error ? (
          <Card className="border-destructive">
            <CardContent className="py-4">
              <p className="text-destructive text-sm">
                Failed to load integrations status. Please try again.
              </p>
            </CardContent>
          </Card>
        ) : data ? (
          <Card
            className={
              data.summary.criticalMissing > 0
                ? "border-acr-warn/50 bg-acr-warn-soft/50 dark:bg-acr-warn-soft/20"
                : "border-acr-pos/50 bg-acr-pos-soft/50 dark:bg-acr-pos-soft/20"
            }
          >
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                {data.summary.criticalMissing > 0 ? (
                  <AlertTriangle className="w-5 h-5 text-acr-warn dark:text-acr-warn shrink-0" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="w-5 h-5 text-acr-pos dark:text-acr-pos shrink-0" aria-hidden="true" />
                )}
                <p className="text-sm font-medium">
                  {data.summary.configured} of {data.summary.total} integrations configured.
                  {data.summary.criticalMissing > 0 && (
                    <span className="text-acr-warn dark:text-acr-warn ml-1">
                      {data.summary.criticalMissing} critical integration{data.summary.criticalMissing > 1 ? "s" : ""} need{data.summary.criticalMissing === 1 ? "s" : ""} attention.
                    </span>
                  )}
                  {data.summary.criticalMissing === 0 && (
                    <span className="text-acr-pos dark:text-acr-pos ml-1">
                      All critical integrations are configured.
                    </span>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Integration cards by category */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          grouped.map((group) => (
            <Card key={group.category}>
              <CardHeader>
                <CardTitle className="text-lg">{group.label}</CardTitle>
                <CardDescription>
                  {group.integrations.filter((i) => i.isConfigured).length} of{" "}
                  {group.integrations.length} configured
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  {group.integrations.map((integration) => (
                    <IntegrationCard
                      key={integration.key}
                      integration={integration}
                      verifyResult={verifyResults[integration.key]}
                      isCopied={copiedKey === integration.key}
                      isVerifying={
                        verifyMutation.isPending &&
                        verifyMutation.variables === integration.key
                      }
                      onCopy={() => handleCopy(integration)}
                      onVerify={() => verifyMutation.mutate(integration.key)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </PageShell>
  );
}

// ─── Integration Card ───────────────────────────────────────────────────────

function IntegrationCard({
  integration,
  verifyResult,
  isCopied,
  isVerifying,
  onCopy,
  onVerify,
}: {
  integration: Integration;
  verifyResult?: VerifyResult;
  isCopied: boolean;
  isVerifying: boolean;
  onCopy: () => void;
  onVerify: () => void;
}) {
  const flyCommand = `fly secrets set ${integration.flySecretName}="YOUR_KEY_HERE"`;

  return (
    <div className="rounded-card border p-4 space-y-3">
      {/* Title row */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-sm">{integration.displayName}</h3>
        <div className="flex items-center gap-1.5">
          {integration.isCritical && (
            <Badge variant="outline" className="text-xs border-acr-warn text-acr-warn dark:text-acr-warn">
              Critical
            </Badge>
          )}
          {integration.isConfigured ? (
            <Badge className="bg-acr-pos-soft text-acr-pos dark:bg-acr-pos-soft/40 dark:text-acr-pos text-xs">
              <CheckCircle2 className="w-3 h-3 mr-1" aria-hidden="true" />
              Configured
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">
              <XCircle className="w-3 h-3 mr-1" aria-hidden="true" />
              Not Configured
            </Badge>
          )}
        </div>
      </div>

      {/* Verification status */}
      {verifyResult && (
        <p
          className={`text-xs ${
            verifyResult.status === "pass"
              ? "text-acr-pos dark:text-acr-pos"
              : "text-acr-neg dark:text-acr-neg"
          }`}
        >
          {verifyResult.status === "pass" ? "Verified" : "Failed"}: {verifyResult.message}
        </p>
      )}

      {/* CLI command */}
      <div className="bg-muted rounded-md p-2">
        <code className="text-xs font-mono break-all select-all">{flyCommand}</code>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={onCopy}
          aria-label={`Copy CLI command for ${integration.displayName}`}
        >
          {isCopied ? (
            <CheckCircle2 className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
          ) : (
            <Copy className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
          )}
          {isCopied ? "Copied" : "Copy"}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onVerify}
          disabled={isVerifying}
          aria-label={`Verify ${integration.displayName} connection`}
        >
          {isVerifying ? (
            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="w-3.5 h-3.5 mr-1" aria-hidden="true" />
          )}
          Verify
        </Button>

        <a
          href={integration.setupDocsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          aria-label={`Get API key for ${integration.displayName} (opens in new tab)`}
        >
          <ExternalLink className="w-3 h-3" aria-hidden="true" />
          Get API Key
        </a>
      </div>
    </div>
  );
}
