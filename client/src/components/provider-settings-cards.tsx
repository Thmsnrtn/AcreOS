"use client";

import * as React from "react";
import { useState } from "react";
import {
  Settings,
  Check,
  AlertTriangle,
  Wifi,
  WifiOff,
  Key,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface ProviderSettingsCardsProps {
  providers: Array<{
    name: string;
    displayName: string;
    status: "healthy" | "degraded" | "not_configured";
    configured: boolean;
    monthlyUsage: number;
    monthlyLimit: number | null;
    latencyMs?: number;
    costThisMonth?: number;
    categories: string[];
  }>;
  onConfigure?: (providerName: string, apiKey: string) => Promise<void>;
  onTestConnection?: (
    providerName: string
  ) => Promise<{ success: boolean; message: string }>;
}

const statusConfig = {
  healthy: {
    color: "bg-acr-pos",
    label: "Healthy",
    icon: Wifi,
    badgeVariant: "default" as const,
  },
  degraded: {
    color: "bg-acr-warn",
    label: "Degraded",
    icon: AlertTriangle,
    badgeVariant: "secondary" as const,
  },
  not_configured: {
    color: "bg-muted-foreground/40",
    label: "Not configured",
    icon: WifiOff,
    badgeVariant: "outline" as const,
  },
};

export function ProviderSettingsCards({
  providers,
  onConfigure,
  onTestConnection,
}: ProviderSettingsCardsProps) {
  const [configureSheet, setConfigureSheet] = useState<{
    open: boolean;
    providerName: string;
    displayName: string;
  }>({ open: false, providerName: "", displayName: "" });
  const [apiKey, setApiKey] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleOpenConfigure = (providerName: string, displayName: string) => {
    setApiKey("");
    setTestResult(null);
    setConfigureSheet({ open: true, providerName, displayName });
  };

  const handleTestConnection = async () => {
    if (!onTestConnection) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await onTestConnection(configureSheet.providerName);
      setTestResult(result);
    } catch {
      setTestResult({ success: false, message: "Connection test failed" });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    if (!onConfigure || !apiKey.trim()) return;
    setIsSaving(true);
    try {
      await onConfigure(configureSheet.providerName, apiKey);
      setConfigureSheet((prev) => ({ ...prev, open: false }));
    } catch {
      // Error handling is left to the caller via onConfigure rejection
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map((provider) => (
          <ProviderCard
            key={provider.name}
            provider={provider}
            onConfigure={() =>
              handleOpenConfigure(provider.name, provider.displayName)
            }
          />
        ))}
      </div>

      <Sheet
        open={configureSheet.open}
        onOpenChange={(open) =>
          setConfigureSheet((prev) => ({ ...prev, open }))
        }
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" aria-hidden="true" />
              Configure {configureSheet.displayName}
            </SheetTitle>
            <SheetDescription>
              Enter your API key to connect this provider.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-key-input">API key</Label>
              <Input
                id="api-key-input"
                type="password"
                placeholder="Enter API key…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {testResult && (
              <div
                role={testResult.success ? "status" : "alert"}
                aria-live="polite"
                className={cn(
                  "flex items-center gap-2 rounded-card border p-3 text-sm",
                  testResult.success
                    ? "border-acr-pos/30 bg-acr-pos/10 text-acr-pos dark:text-acr-pos"
                    : "border-destructive/30 bg-destructive/10 text-destructive"
                )}
              >
                {testResult.success ? (
                  <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                )}
                {testResult.message}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={handleTestConnection}
                disabled={!apiKey.trim() || isTesting || !onTestConnection}
                aria-busy={isTesting}
              >
                {isTesting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Wifi className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {isTesting ? "Testing…" : "Test connection"}
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={handleSave}
                disabled={!apiKey.trim() || isSaving}
                aria-busy={isSaving}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="mr-2 h-4 w-4" aria-hidden="true" />
                )}
                {isSaving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function ProviderCard({
  provider,
  onConfigure,
}: {
  provider: ProviderSettingsCardsProps["providers"][number];
  onConfigure: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = statusConfig[provider.status];
  const StatusIcon = config.icon;

  const usagePercent =
    provider.monthlyLimit != null && provider.monthlyLimit > 0
      ? Math.min((provider.monthlyUsage / provider.monthlyLimit) * 100, 100)
      : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-card bg-muted" aria-hidden="true">
              <Settings className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <CardTitle className="text-base">{provider.displayName}</CardTitle>
              <div className="mt-1 flex flex-wrap gap-1">
                {provider.categories.map((cat) => (
                  <Badge
                    key={cat}
                    variant="outline"
                    className="text-[10px] px-1.5 py-0"
                  >
                    {cat}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span
              role="status"
              className={cn(
                "h-2.5 w-2.5 rounded-full shrink-0",
                config.color
              )}
              aria-label={`Status: ${config.label}`}
            />
            <StatusIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Monthly usage bar */}
        {usagePercent != null ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Monthly usage</span>
              <span>
                {provider.monthlyUsage.toLocaleString()} /{" "}
                {provider.monthlyLimit!.toLocaleString()}
              </span>
            </div>
            <Progress
              value={usagePercent}
              className={cn(
                "h-1.5",
                usagePercent > 90 && "[&>div]:bg-destructive",
                usagePercent > 75 &&
                  usagePercent <= 90 &&
                  "[&>div]:bg-acr-warn"
              )}
            />
          </div>
        ) : (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Monthly Usage</span>
            <span>{provider.monthlyUsage.toLocaleString()} (no limit)</span>
          </div>
        )}

        {/* Expandable details */}
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-md px-1 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${provider.displayName} details`}
            >
              <span>Details</span>
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform duration-200",
                  expanded && "rotate-180"
                )}
                aria-hidden="true"
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-2 pt-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Health</span>
                <Badge variant={config.badgeVariant} className="text-[11px]">
                  {config.label}
                </Badge>
              </div>
              {provider.latencyMs != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Latency</span>
                  <span className="font-medium tabular-nums">
                    {provider.latencyMs}ms
                  </span>
                </div>
              )}
              {provider.costThisMonth != null && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Cost this month</span>
                  <span className="font-medium tabular-nums">
                    ${provider.costThisMonth.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Configure button */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onConfigure}
          aria-label={`Configure ${provider.displayName}`}
        >
          <Settings className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          Configure
        </Button>
      </CardContent>
    </Card>
  );
}
