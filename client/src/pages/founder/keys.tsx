/**
 * /founder/keys — System API keys: what is at rest, read-only.
 *
 * This page used to offer a key field per vendor and PUT the pasted value to
 * /api/admin/system-api-keys/:provider, which stored it in plain text in
 * system_api_keys.api_key. Nothing read that value for an outbound call — the
 * platform reads vendor keys from the server environment — and that table is
 * also the Data-API credential table, so every pasted secret became a working
 * partner bearer key (DEFECT-0054). The save route now answers 410 and this
 * page shows only what matters: which rows still hold a plain-text secret,
 * which the founder should rotate at the vendor.
 */

import { useQuery } from "@tanstack/react-query";
import { Key, AlertTriangle } from "lucide-react";

import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorState } from "@/components/query-error-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { PLATFORM_VENDOR_KEY_PROVIDERS } from "@shared/platformVendorKeyProviders";

interface SystemKeyRow {
  id: number;
  provider: string;
  displayName: string;
  isActive: boolean | null;
  plaintextAtRest: boolean;
}

export default function FounderKeysPage() {
  useDocumentTitle("System API keys — AcreOS");

  const { data: rows = [], isLoading, error, refetch } = useQuery<SystemKeyRow[]>({
    queryKey: ["/api/admin/system-api-keys"],
  });

  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const vendorRows = PLATFORM_VENDOR_KEY_PROVIDERS.map((p) => ({
    ...p,
    plaintextAtRest: byProvider.get(p.provider)?.plaintextAtRest ?? false,
  }));
  const exposedCount = vendorRows.filter((r) => r.plaintextAtRest).length;

  return (
    <PageShell label="System API keys">
      <div className="mb-6 flex items-start gap-3">
        <Key className="w-6 h-6 text-primary mt-1" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System API keys</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Platform vendor keys are read from the server environment (Fly
            secrets). Keys saved on this page were stored in plain text and
            never used, so the form is retired. Any vendor listed as
            &ldquo;Plain text at rest&rdquo; below still has its secret in the
            database: rotate that key at the vendor.
          </p>
        </div>
      </div>

      <div className="p-6 border rounded-xl bg-card space-y-4" data-testid="section-system-api-keys">
        {isLoading ? (
          <div
            role="status"
            aria-busy="true"
            aria-live="polite"
            className="space-y-2"
            data-testid="skeleton-system-api-keys"
          >
            <span className="sr-only">Loading API keys</span>
            {Array.from({ length: PLATFORM_VENDOR_KEY_PROVIDERS.length }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 p-3 border rounded-card">
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Skeleton announce={false} className="h-4 w-24" />
                  <Skeleton announce={false} className="h-3 w-56" />
                </div>
                <Skeleton announce={false} className="h-5 w-28 rounded-full shrink-0" />
              </div>
            ))}
          </div>
        ) : error ? (
          <QueryErrorState
            error={error as Error}
            onRetry={() => refetch()}
            title="Couldn't load API keys"
            testId="error-system-api-keys"
          />
        ) : (
          <div className="space-y-2">
            {exposedCount > 0 && (
              <div className="flex items-start gap-2 text-sm text-acr-warn" data-testid="text-plaintext-keys-warning">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                <span>
                  {exposedCount === 1 ? "1 vendor secret is" : `${exposedCount} vendor secrets are`} still stored in plain text. Rotate {exposedCount === 1 ? "it" : "them"} at the vendor.
                </span>
              </div>
            )}
            {vendorRows.map((row) => (
              <div key={row.provider} className="flex items-center gap-3 p-3 border rounded-card" data-testid={`row-system-key-${row.provider}`}>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm">{row.displayName}</span>
                  <div className="text-xs text-muted-foreground">
                    <span className="font-mono">{row.provider}</span>
                    <span className="ml-2">— {row.description}</span>
                  </div>
                </div>
                <Badge variant="outline" className={`text-xs shrink-0 ${row.plaintextAtRest ? "text-acr-warn" : ""}`}>
                  {row.plaintextAtRest ? "Plain text at rest" : "Nothing stored"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}
