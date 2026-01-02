import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { 
  Mail, 
  MessageSquare, 
  FileText, 
  CheckCircle2, 
  XCircle, 
  Loader2, 
  Eye, 
  EyeOff,
  Trash2,
  RefreshCw,
  AlertCircle
} from "lucide-react";
import { SiSendgrid, SiTwilio } from "react-icons/si";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface IntegrationConfig {
  provider: string;
  isEnabled: boolean;
  isConfigured: boolean;
  credentials?: {
    hasApiKey: boolean;
    maskedKey: string;
  } | null;
  lastValidatedAt?: string | null;
  validationError?: string | null;
}

const PROVIDERS = [
  {
    id: 'sendgrid',
    name: 'SendGrid',
    description: 'Send professional emails from your verified domain',
    icon: SiSendgrid,
    iconColor: 'text-blue-500',
    apiKeyLabel: 'SendGrid API Key',
    helpUrl: 'https://docs.sendgrid.com/ui/account-and-settings/api-keys',
  },
  {
    id: 'twilio',
    name: 'Twilio',
    description: 'Send SMS messages from your own phone number',
    icon: SiTwilio,
    iconColor: 'text-red-500',
    apiKeyLabel: 'Twilio Auth Token',
    helpUrl: 'https://www.twilio.com/docs/sms/api',
    additionalFields: [
      { key: 'accountSid', label: 'Account SID', type: 'text' },
    ],
  },
  {
    id: 'lob',
    name: 'Lob',
    description: 'Send physical mail pieces (postcards, letters)',
    icon: FileText,
    iconColor: 'text-green-500',
    apiKeyLabel: 'Lob API Key',
    helpUrl: 'https://www.lob.com/docs',
  },
];

function IntegrationCard({ 
  provider, 
  config, 
  onConfigure, 
  onTest, 
  onDelete,
  testingProvider,
}: { 
  provider: typeof PROVIDERS[0];
  config: IntegrationConfig | undefined;
  onConfigure: (provider: string) => void;
  onTest: (provider: string) => void;
  onDelete: (provider: string) => void;
  testingProvider: string | null;
}) {
  const Icon = provider.icon;
  const isConfigured = config?.isConfigured;
  const isValid = config?.lastValidatedAt && !config?.validationError;
  const isTesting = testingProvider === provider.id;
  
  return (
    <Card className="relative">
      <CardHeader className="flex flex-row items-start justify-between gap-4 pb-2">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-md bg-muted ${provider.iconColor}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-base">{provider.name}</CardTitle>
            <CardDescription className="text-sm">{provider.description}</CardDescription>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConfigured ? (
            isValid ? (
              <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Connected
              </Badge>
            ) : config?.validationError ? (
              <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20">
                <XCircle className="w-3 h-3 mr-1" />
                Error
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
                <AlertCircle className="w-3 h-3 mr-1" />
                Pending
              </Badge>
            )
          ) : (
            <Badge variant="outline">Not Configured</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {isConfigured && config?.credentials?.maskedKey && (
          <div className="mb-4 p-3 rounded-md bg-muted/50">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">API Key:</span>
              <code className="text-sm font-mono">{config.credentials.maskedKey}</code>
            </div>
            {config.validationError && (
              <p className="text-sm text-red-500 mt-2">{config.validationError}</p>
            )}
          </div>
        )}
        
        <div className="flex items-center gap-2 flex-wrap">
          <Button 
            variant={isConfigured ? "outline" : "default"}
            size="sm"
            onClick={() => onConfigure(provider.id)}
            data-testid={`button-configure-${provider.id}`}
          >
            {isConfigured ? "Update Key" : "Configure"}
          </Button>
          
          {isConfigured && (
            <>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => onTest(provider.id)}
                disabled={isTesting}
                data-testid={`button-test-${provider.id}`}
              >
                {isTesting ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4 mr-1" />
                )}
                Test Connection
              </Button>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => onDelete(provider.id)}
                className="text-red-500"
                data-testid={`button-delete-${provider.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfigureDialog({
  provider,
  open,
  onOpenChange,
  onSave,
  isSaving,
}: {
  provider: typeof PROVIDERS[0] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (provider: string, apiKey: string, settings?: Record<string, string>) => void;
  isSaving: boolean;
}) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [additionalFields, setAdditionalFields] = useState<Record<string, string>>({});
  
  const handleSave = () => {
    if (!provider || !apiKey.trim()) return;
    onSave(provider.id, apiKey.trim(), additionalFields);
    setApiKey('');
    setAdditionalFields({});
  };
  
  const handleClose = () => {
    onOpenChange(false);
    setApiKey('');
    setShowKey(false);
    setAdditionalFields({});
  };
  
  if (!provider) return null;
  
  const Icon = provider.icon;
  
  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${provider.iconColor}`} />
            Configure {provider.name}
          </DialogTitle>
          <DialogDescription>
            Enter your API credentials to enable {provider.name} integration.
            {provider.helpUrl && (
              <a 
                href={provider.helpUrl} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-primary hover:underline ml-1"
              >
                Get your API key
              </a>
            )}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {provider.additionalFields?.map(field => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={field.key}>{field.label}</Label>
              <Input
                id={field.key}
                type={field.type || 'text'}
                value={additionalFields[field.key] || ''}
                onChange={(e) => setAdditionalFields(prev => ({
                  ...prev,
                  [field.key]: e.target.value,
                }))}
                placeholder={`Enter ${field.label.toLowerCase()}`}
                data-testid={`input-${provider.id}-${field.key}`}
              />
            </div>
          ))}
          
          <div className="space-y-2">
            <Label htmlFor="apiKey">{provider.apiKeyLabel}</Label>
            <div className="relative">
              <Input
                id="apiKey"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                className="pr-10"
                data-testid={`input-${provider.id}-apikey`}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-full"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!apiKey.trim() || isSaving}
            data-testid={`button-save-${provider.id}`}
          >
            {isSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Credentials
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function IntegrationsSettings() {
  const { toast } = useToast();
  const [configureProvider, setConfigureProvider] = useState<typeof PROVIDERS[0] | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  
  const { data: integrations = [], isLoading } = useQuery<IntegrationConfig[]>({
    queryKey: ['/api/integrations'],
  });
  
  const saveMutation = useMutation({
    mutationFn: async ({ provider, apiKey, settings }: { 
      provider: string; 
      apiKey: string; 
      settings?: Record<string, string>;
    }) => {
      const res = await apiRequest('POST', `/api/integrations/${provider}`, { 
        apiKey, 
        settings 
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to save integration');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      setConfigureProvider(null);
      toast({
        title: 'Integration saved',
        description: data.message,
      });
    },
    onError: (err: Error) => {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
  
  const testMutation = useMutation({
    mutationFn: async (provider: string) => {
      setTestingProvider(provider);
      const res = await apiRequest('POST', `/api/integrations/${provider}/test`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Test failed');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      toast({
        title: data.success ? 'Connection successful' : 'Connection failed',
        description: data.message,
        variant: data.success ? 'default' : 'destructive',
      });
    },
    onError: (err: Error) => {
      toast({
        title: 'Test failed',
        description: err.message,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setTestingProvider(null);
    },
  });
  
  const deleteMutation = useMutation({
    mutationFn: async (provider: string) => {
      const res = await apiRequest('DELETE', `/api/integrations/${provider}`, {});
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to delete');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/integrations'] });
      toast({
        title: 'Integration removed',
        description: data.message,
      });
    },
    onError: (err: Error) => {
      toast({
        title: 'Error',
        description: err.message,
        variant: 'destructive',
      });
    },
  });
  
  const getConfig = (providerId: string) => {
    return integrations.find(i => i.provider === providerId);
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5" />
          Communication Integrations
        </CardTitle>
        <CardDescription>
          Connect your own email and SMS providers for branded communications. 
          Your API keys are encrypted and stored securely.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          PROVIDERS.map(provider => (
            <IntegrationCard
              key={provider.id}
              provider={provider}
              config={getConfig(provider.id)}
              onConfigure={(id) => {
                const p = PROVIDERS.find(p => p.id === id);
                if (p) setConfigureProvider(p);
              }}
              onTest={(id) => testMutation.mutate(id)}
              onDelete={(id) => deleteMutation.mutate(id)}
              testingProvider={testingProvider}
            />
          ))
        )}
        
        <div className="pt-4 border-t">
          <p className="text-sm text-muted-foreground">
            Note: Platform-wide Lob integration (for direct mail) is available by default. 
            Configure your own API keys to use your own account and billing.
          </p>
        </div>
      </CardContent>
      
      <ConfigureDialog
        provider={configureProvider}
        open={!!configureProvider}
        onOpenChange={(open) => !open && setConfigureProvider(null)}
        onSave={(provider, apiKey, settings) => {
          saveMutation.mutate({ provider, apiKey, settings });
        }}
        isSaving={saveMutation.isPending}
      />
    </Card>
  );
}
