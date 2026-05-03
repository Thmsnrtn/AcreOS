import { useId, useState } from "react";
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
  const formId = useId();
  const errorId = useId();

  const handleSave = async () => {
    if (!key.trim()) return;
    
    setIsValidating(true);
    try {
      const valid = await onSave(key);
      setIsValid(valid);
      if (valid) {
        toast({ title: `${serviceName} connected`, description: "Your key passed validation and is now active." });
        setKey("");
      } else {
        toast({ title: `${serviceName} key didn't validate`, description: "The key is still in the form — double-check the value and try again. No connection was made.", variant: "destructive" });
      }
    } catch (error) {
      setIsValid(false);
      toast({ title: "Couldn't validate key", description: "Network error. Your key is still in the form — try again in a moment.", variant: "destructive" });
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="w-5 h-5" aria-hidden="true" />
          <CardTitle className="text-lg">{serviceName}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {currentKeyMasked && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Check className="w-4 h-4 text-acr-pos" aria-hidden="true" />
            Current key: {currentKeyMasked}
          </div>
        )}
        <form
          id={formId}
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!isValidating && key.trim()) handleSave();
          }}
        >
          <Label htmlFor={`${service}-key`}>API key</Label>
          <div className="flex gap-2">
            <Input
              id={`${service}-key`}
              type="password"
              placeholder={placeholder}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={isValid === false ? true : undefined}
              aria-describedby={isValid === false ? errorId : undefined}
              data-testid={`input-${service}-key`}
            />
            <Button
              type="submit"
              disabled={!key.trim() || isValidating}
              data-testid={`button-save-${service}-key`}
            >
              {isValidating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span className="sr-only">Validating…</span>
                </>
              ) : "Save"}
            </Button>
          </div>
        </form>
        {isValid === false && (
          <div id={errorId} role="alert" className="flex items-center gap-2 text-sm text-acr-neg">
            <AlertCircle className="w-4 h-4" aria-hidden="true" />
            Invalid API key
          </div>
        )}
        {learnMoreUrl && (
          <a
            href={learnMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`How to get your ${serviceName} API key (opens in new tab)`}
            className="text-sm text-primary hover:underline block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
            data-testid={`link-learn-more-${service}`}
          >
            How to get your {serviceName} API key →
          </a>
        )}
      </CardContent>
    </Card>
  );
}
