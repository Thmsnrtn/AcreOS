import { useState } from "react";
import { Check, AlertCircle, Loader2, Key } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface ApiKeySetupProps {
  service: string;
  serviceName: string;
  description: string;
  placeholder: string;
  learnMoreUrl?: string;
  onSave: (key: string) => Promise<boolean>;
  currentKeyMasked?: string;
}

export function ApiKeySetup({
  service,
  serviceName,
  description,
  placeholder,
  learnMoreUrl,
  onSave,
  currentKeyMasked,
}: ApiKeySetupProps) {
  const [key, setKey] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);
  const { toast } = useToast();

  const handleSave = async () => {
    if (!key.trim()) return;
    
    setIsValidating(true);
    try {
      const valid = await onSave(key);
      setIsValid(valid);
      if (valid) {
        toast({ title: `${serviceName} connected successfully` });
        setKey("");
      } else {
        toast({ title: "Invalid API key", variant: "destructive" });
      }
    } catch (error) {
      setIsValid(false);
      toast({ title: "Failed to validate key", variant: "destructive" });
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="w-5 h-5" />
          <CardTitle className="text-lg">{serviceName}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentKeyMasked && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="w-4 h-4 text-green-500" />
            Current key: {currentKeyMasked}
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor={`${service}-key`}>API Key</Label>
          <div className="flex gap-2">
            <Input
              id={`${service}-key`}
              type="password"
              placeholder={placeholder}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              data-testid={`input-${service}-key`}
            />
            <Button 
              onClick={handleSave} 
              disabled={!key.trim() || isValidating}
              data-testid={`button-save-${service}-key`}
            >
              {isValidating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
            </Button>
          </div>
        </div>
        {isValid === false && (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="w-4 h-4" />
            Invalid API key
          </div>
        )}
        {learnMoreUrl && (
          <a 
            href={learnMoreUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline block"
            data-testid={`link-learn-more-${service}`}
          >
            How to get your {serviceName} API key →
          </a>
        )}
      </CardContent>
    </Card>
  );
}
