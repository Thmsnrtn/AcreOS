import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  AlertTriangle, 
  CheckCircle2, 
  Mail, 
  MessageSquare, 
  FileText,
  Settings,
  ArrowRight,
  Loader2
} from "lucide-react";
import { Link } from "wouter";

interface ChannelStatus {
  email: boolean;
  sms: boolean;
  directMail: boolean;
}

interface ProviderReadinessBannerProps {
  /** Which channel the user is trying to use */
  channel?: "email" | "sms" | "all";
  /** Compact mode for inline display */
  compact?: boolean;
  /** Custom class name */
  className?: string;
}

function ChannelStatusBadge({ 
  label, 
  configured, 
  icon: Icon 
}: { 
  label: string; 
  configured: boolean; 
  icon: React.ElementType;
}) {
  return (
    <Badge 
      variant={configured ? "default" : "outline"} 
      className={`gap-1 ${configured ? "bg-acr-pos/10 text-acr-pos border-acr-pos/20" : "bg-acr-warn/10 text-acr-warn border-acr-warn/20"}`}
      data-testid={`badge-channel-status-${label.toLowerCase().replace(/\s/g, '-')}`}
    >
      {configured ? (
        <CheckCircle2 className="h-3 w-3" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
      <Icon className="h-3 w-3" />
      {label}: {configured ? "Ready" : "Not configured"}
    </Badge>
  );
}

/**
 * Shows communication provider readiness status with actionable guidance.
 * 
 * Displays inline when providers need configuration, helping land investors
 * understand why sending might fail and directing them to Settings.
 */
export function ProviderReadinessBanner({ 
  channel = "all", 
  compact = false,
  className = ""
}: ProviderReadinessBannerProps) {
  const { data: status, isLoading, error } = useQuery<ChannelStatus>({
    queryKey: ["/api/integrations/status"],
    staleTime: 60000, // 1 minute
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    if (compact) return null;
    return (
      <div className={`flex items-center gap-2 text-muted-foreground text-sm ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking provider status...
      </div>
    );
  }

  if (error || !status) {
    return null;
  }

  // Determine which channels to check based on filter
  const channelsToCheck = {
    email: channel === "all" || channel === "email",
    sms: channel === "all" || channel === "sms",
  };

  // Check if any relevant channel is not configured
  const emailMissing = channelsToCheck.email && !status.email;
  const smsMissing = channelsToCheck.sms && !status.sms;
  const hasMissingChannels = emailMissing || smsMissing;

  // All channels ready - show success or nothing in compact mode
  if (!hasMissingChannels) {
    if (compact) return null;
    return (
      <Alert 
        className={`border-acr-pos/20 bg-acr-pos/5 ${className}`}
        data-testid="alert-providers-ready"
      >
        <CheckCircle2 className="h-4 w-4 text-acr-pos" />
        <AlertTitle className="text-acr-pos">Communication Ready</AlertTitle>
        <AlertDescription className="text-acr-pos/80">
          {channel === "email" && "Email provider is configured and ready to send."}
          {channel === "sms" && "SMS provider is configured and ready to send."}
          {channel === "all" && "All communication channels are configured and ready."}
        </AlertDescription>
      </Alert>
    );
  }

  // Some channels missing - show warning with guidance
  const missingChannelsList: string[] = [];
  if (emailMissing) missingChannelsList.push("Email (SendGrid)");
  if (smsMissing) missingChannelsList.push("SMS (Twilio)");

  if (compact) {
    return (
      <div 
        className={`flex items-center gap-2 p-2 rounded-md bg-acr-warn/10 border border-acr-warn/20 ${className}`}
        data-testid="banner-provider-setup-compact"
      >
        <AlertTriangle className="h-4 w-4 text-acr-warn flex-shrink-0" />
        <span className="text-sm text-acr-warn">
          {missingChannelsList.join(" & ")} not configured
        </span>
        <Button
          asChild
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-xs border-acr-warn/30 hover:bg-acr-warn/10"
          data-testid="button-setup-providers-compact"
        >
          <Link href="/settings?tab=integrations">
            <Settings className="h-3 w-3 mr-1" aria-hidden="true" />
            Setup
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <Alert 
      className={`border-acr-warn/20 bg-acr-warn/5 ${className}`}
      data-testid="alert-providers-setup-needed"
    >
      <AlertTriangle className="h-4 w-4 text-acr-warn" />
      <AlertTitle className="text-acr-warn flex items-center gap-2">
        Provider Setup Needed
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <p className="text-acr-warn/80">
          Configure your communication providers to send messages from your own verified domain and phone numbers.
        </p>
        
        <div className="flex flex-wrap gap-2">
          {channelsToCheck.email && (
            <ChannelStatusBadge 
              label="Email" 
              configured={status.email} 
              icon={Mail} 
            />
          )}
          {channelsToCheck.sms && (
            <ChannelStatusBadge 
              label="SMS" 
              configured={status.sms} 
              icon={MessageSquare} 
            />
          )}
          {channel === "all" && (
            <ChannelStatusBadge 
              label="Direct Mail" 
              configured={status.directMail} 
              icon={FileText} 
            />
          )}
        </div>

        <div className="flex items-center gap-3 pt-1">
          <Button
            asChild
            size="sm"
            className="gap-1"
            data-testid="button-configure-providers"
          >
            <Link href="/settings?tab=integrations">
              <Settings className="h-4 w-4" aria-hidden="true" />
              Configure integrations
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </Button>
          <span className="text-xs text-muted-foreground">
            Add your SendGrid or Twilio API keys for branded communications
          </span>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Inline provider status indicator for use in send forms/buttons.
 * Shows a subtle indicator when the target channel isn't configured.
 */
export function ProviderStatusIndicator({ 
  channel 
}: { 
  channel: "email" | "sms" 
}) {
  const { data: status } = useQuery<ChannelStatus>({
    queryKey: ["/api/integrations/status"],
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  if (!status) return null;

  const isConfigured = channel === "email" ? status.email : status.sms;
  
  if (isConfigured) {
    return (
      <span 
        className="inline-flex items-center gap-1 text-xs text-acr-pos"
        data-testid={`indicator-${channel}-ready`}
      >
        <CheckCircle2 className="h-3 w-3" />
        {channel === "email" ? "Email ready" : "SMS ready"}
      </span>
    );
  }

  return (
    <Link href="/settings?tab=integrations">
      <span 
        className="inline-flex items-center gap-1 text-xs text-acr-warn hover:text-acr-warn cursor-pointer"
        data-testid={`indicator-${channel}-setup`}
      >
        <AlertTriangle className="h-3 w-3" />
        {channel === "email" ? "Email not configured" : "SMS not configured"}
        <Settings className="h-3 w-3" />
      </span>
    </Link>
  );
}
