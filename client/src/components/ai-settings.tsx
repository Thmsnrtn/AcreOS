import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useOrganization } from "@/hooks/use-organization";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Bot, Loader2, Save, Sparkles } from "lucide-react";

interface AISettingsProps {
  compact?: boolean;
}

interface AISettings {
  responseStyle?: "concise" | "detailed" | "balanced";
  defaultAgent?: string;
  autoSuggestions?: boolean;
  rememberContext?: boolean;
}

const RESPONSE_STYLES = [
  { value: "concise", label: "Concise" },
  { value: "detailed", label: "Detailed" },
  { value: "balanced", label: "Balanced" },
] as const;

const DEFAULT_AGENTS = [
  { value: "general", label: "General" },
  { value: "research", label: "Research" },
  { value: "marketing", label: "Marketing" },
  { value: "finance", label: "Finance" },
  { value: "support", label: "Support" },
] as const;

export function AISettings({ compact = false }: AISettingsProps) {
  const { toast } = useToast();
  const { data: organization, isLoading: orgLoading } = useOrganization();

  const [responseStyle, setResponseStyle] = useState<"concise" | "detailed" | "balanced">("balanced");
  const [defaultAgent, setDefaultAgent] = useState("general");
  const [autoSuggestions, setAutoSuggestions] = useState(false);
  const [rememberContext, setRememberContext] = useState(true);

  useEffect(() => {
    if (organization?.settings?.aiSettings) {
      const settings = organization.settings.aiSettings;
      setResponseStyle(settings.responseStyle ?? "balanced");
      setDefaultAgent(settings.defaultAgent ?? "general");
      setAutoSuggestions(settings.autoSuggestions ?? false);
      setRememberContext(settings.rememberContext ?? true);
    }
  }, [organization]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (aiSettings: AISettings) => {
      const res = await apiRequest("PATCH", "/api/organization/ai-settings", aiSettings);
      if (!res.ok) throw new Error("Failed to update AI settings");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organization"] });
      toast({
        title: "Settings updated",
        description: "Your AI settings have been saved.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Couldn't save AI settings",
        description: `${error.message || "No changes were applied"} — your existing settings are unchanged.`,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    updateSettingsMutation.mutate({
      responseStyle,
      defaultAgent,
      autoSuggestions,
      rememberContext,
    });
  };

  if (orgLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-6 w-full" />
          <Skeleton className="h-6 w-full" />
        </CardContent>
      </Card>
    );
  }

  const content = (
    <div className={`space-y-${compact ? "4" : "6"}`}>
      <div className="space-y-2">
        <Label htmlFor="response-style">How much detail AI gives</Label>
        <Select value={responseStyle} onValueChange={(v) => setResponseStyle(v as typeof responseStyle)}>
          <SelectTrigger id="response-style" data-testid="select-ai-response-style">
            <SelectValue placeholder="Select response style" />
          </SelectTrigger>
          <SelectContent>
            {RESPONSE_STYLES.map((style) => (
              <SelectItem key={style.value} value={style.value}>
                {style.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Short and to the point, or fuller explanations — your call.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="default-agent">Which assistant starts your chats</Label>
        <Select value={defaultAgent} onValueChange={setDefaultAgent}>
          <SelectTrigger id="default-agent" data-testid="select-ai-default-agent">
            <SelectValue placeholder="Select default agent" />
          </SelectTrigger>
          <SelectContent>
            {DEFAULT_AGENTS.map((agent) => (
              <SelectItem key={agent.value} value={agent.value}>
                {agent.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          New conversations open with this assistant — pick the topic you work on most.
        </p>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="auto-suggestions">Show tips without being asked</Label>
          <p className="text-xs text-muted-foreground">
            AI offers suggestions as you work, instead of waiting for you to ask.
          </p>
        </div>
        <Switch
          id="auto-suggestions"
          checked={autoSuggestions}
          onCheckedChange={setAutoSuggestions}
          data-testid="switch-ai-auto-suggestions"
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="remember-context">Let AI remember past chats</Label>
          <p className="text-xs text-muted-foreground">
            AI can refer back to your earlier conversations instead of starting fresh every time.
          </p>
        </div>
        <Switch
          id="remember-context"
          checked={rememberContext}
          onCheckedChange={setRememberContext}
          data-testid="switch-ai-remember-context"
        />
      </div>

      <div className={compact ? "pt-2" : "pt-4"}>
        <Button
          type="button"
          onClick={handleSave}
          disabled={updateSettingsMutation.isPending}
          aria-busy={updateSettingsMutation.isPending}
          className="w-full"
          data-testid="button-save-ai-settings"
        >
          {updateSettingsMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="w-4 h-4 mr-2" aria-hidden="true" />
          )}
          {updateSettingsMutation.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );

  if (compact) {
    return content;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5" aria-hidden="true" />
          AI settings
        </CardTitle>
        <CardDescription>
          Configure how AI assistants behave across your organization
        </CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  );
}
