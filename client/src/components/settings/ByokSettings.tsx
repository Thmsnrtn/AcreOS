import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { FileText, MapPin, Phone, Mail, Globe } from "lucide-react";
import { ApiKeySetup } from "./ApiKeySetup";

interface IntegrationStatus {
  provider: string;
  isConfigured: boolean;
  maskedKey?: string;
  lastValidatedAt?: string;
  validationError?: string;
}

const SERVICES = [
  {
    id: "lob",
    name: "Lob",
    description: "Send physical mail pieces (postcards, letters) directly to leads and buyers",
    placeholder: "pk_live_...",
    icon: FileText,
    learnMoreUrl: "https://www.lob.com/docs",
    validationEndpoint: "/api/settings/validate-lob",
  },
  // Regrid is now a system-wide API key managed in Founder Dashboard
  {
    id: "twilio",
    name: "Twilio",
    description: "Send SMS messages from your own phone numbers with full control",
    placeholder: "AC...",
    icon: Phone,
    learnMoreUrl: "https://www.twilio.com/docs/sms/api",
    validationEndpoint: "/api/settings/validate-twilio",
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    description: "Send professional emails from your verified domain with better deliverability",
    placeholder: "SG...",
    icon: Mail,
    learnMoreUrl: "https://docs.sendgrid.com/ui/account-and-settings/api-keys",
    validationEndpoint: "/api/settings/validate-sendgrid",
  },
  {
    id: "rapidapi",
    name: "RapidAPI Property Lines",
    description: "Cheaper parcel boundary data - used before Regrid to reduce costs",
    placeholder: "32e0fd6179...",
    icon: Globe,
    learnMoreUrl: "https://rapidapi.com/admin-DS8z8zYSG/api/property-lines",
    validationEndpoint: "/api/settings/validate-rapidapi",
  },
];

export function ByokSettings() {
  const { toast } = useToast();

  // Fetch integration statuses
  const { data: integrations, isLoading } = useQuery<IntegrationStatus[]>({
    queryKey: ["/api/settings/integrations/status"],
  });

  // Save API key mutation
  const saveKeyMutation = useMutation({
    mutationFn: async ({
      service,
      apiKey,
      validationEndpoint,
    }: {
      service: string;
      apiKey: string;
      validationEndpoint: string;
    }) => {
      // First validate the key
      const validateRes = await apiRequest("POST", validationEndpoint, {
        apiKey,
      });

      if (!validateRes.ok) {
        throw new Error("Failed to validate API key");
      }

      const { valid } = await validateRes.json();
      if (!valid) {
        return false;
      }

      // If valid, save it
      const saveRes = await apiRequest("POST", "/api/settings/save-api-key", {
        service,
        apiKey,
      });

      if (!saveRes.ok) {
        throw new Error("Failed to save API key");
      }

      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/settings/integrations/status"],
      });
    },
  });

  const handleSaveKey = async (service: string, apiKey: string) => {
    const serviceConfig = SERVICES.find((s) => s.id === service);
    if (!serviceConfig) return false;

    try {
      const result = await saveKeyMutation.mutateAsync({
        service,
        apiKey,
        validationEndpoint: serviceConfig.validationEndpoint,
      });
      return result;
    } catch (error) {
      console.error("Error saving API key:", error);
      return false;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {SERVICES.map((service) => (
          <Skeleton key={service.id} className="h-[200px] w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Bring Your Own Keys (BYOK)</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your own API keys to external services for unlimited usage without platform credits
        </p>
      </div>

      {SERVICES.map((service) => {
        const integration = integrations?.find((i) => i.provider === service.id);
        const Icon = service.icon;

        return (
          <div key={service.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <Icon className="w-5 h-5 text-muted-foreground" />
              <h4 className="font-medium">{service.name}</h4>
            </div>
            <ApiKeySetup
              service={service.id}
              serviceName={service.name}
              description={service.description}
              placeholder={service.placeholder}
              learnMoreUrl={service.learnMoreUrl}
              currentKeyMasked={integration?.maskedKey}
              onSave={(apiKey) =>
                handleSaveKey(service.id, apiKey)
              }
            />
          </div>
        );
      })}
    </div>
  );
}
