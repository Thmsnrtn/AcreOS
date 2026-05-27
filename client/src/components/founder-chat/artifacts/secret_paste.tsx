/**
 * secret_paste artifact — sealed input for rotating a Fly secret.
 *
 * Atlas's fly_secret_set tool returns this artifact INSTEAD of executing.
 * Tom pastes the value into the sealed field; the value POSTs directly
 * to /api/founder/chat/secret-paste/:requestId and NEVER enters the
 * chat-history persistence layer.
 *
 * Design: Apple-grade warm-amber rail matching confirmation_request,
 * 44pt touch target Confirm, TAP_PRESS spring, CROSS_FADE on resolve,
 * ThinkingDots while pending.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Check, KeyRound } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ThinkingDots } from "@/components/founder-chat/ThinkingDots";
import { CROSS_FADE, SPRING_INTERACTIVE, TAP_PRESS } from "@/lib/motion";
import { TOUCH_TARGET_PT } from "@/lib/spacing";
import { cn } from "@/lib/utils";

interface SecretPasteProps {
  requestId: string;
  keyName: string;
  warning?: string;
  placeholder?: string;
}

interface PasteResponse {
  ok?: boolean;
  evidence?: { keyName: string; fingerprint: string; fingerprintShort: string };
  error?: string;
  message?: string;
}

export function SecretPasteArtifact({
  requestId,
  keyName,
  warning,
  placeholder,
}: SecretPasteProps) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [resolved, setResolved] = useState<
    | { status: "consumed"; fingerprintShort: string }
    | { status: "error"; message: string }
    | null
  >(null);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value || pending) return;
    setPending(true);
    try {
      const resp = await fetch(`/api/founder/chat/secret-paste/${requestId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const data: PasteResponse = await resp.json().catch(() => ({}));
      // Clear the local value BEFORE acknowledging — minimize the window
      // where the secret value sits in browser memory.
      setValue("");
      if (!resp.ok || !data.ok) {
        const msg = data.message || data.error || `HTTP ${resp.status}`;
        setResolved({ status: "error", message: msg });
        toast({
          title: "Secret rotation failed",
          description: msg,
          variant: "destructive",
        });
        return;
      }
      const short = data.evidence?.fingerprintShort ?? "";
      setResolved({ status: "consumed", fingerprintShort: short });
      toast({ title: "Secret rotated", description: `${keyName} (fp: ${short})` });
    } catch (err) {
      setValue("");
      const msg = err instanceof Error ? err.message : String(err);
      setResolved({ status: "error", message: msg });
      toast({ title: "Network error", description: msg, variant: "destructive" });
    } finally {
      setPending(false);
    }
  };

  return (
    <Card
      className={cn(
        "border border-acr-warn/30 bg-acr-warn-soft/20 overflow-hidden",
        "shadow-none",
      )}
      role="region"
      aria-labelledby={`secret-paste-title-${requestId}`}
      data-testid={`artifact-secret-paste-${requestId}`}
    >
      {/* Warm amber rail along the top — signals "sealed surface". */}
      <div aria-hidden="true" className="h-0.5 w-full bg-acr-warn/70" />
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-acr-warn/15"
          >
            <KeyRound
              className="w-4 h-4 text-acr-warn"
              aria-hidden="true"
              strokeWidth={1.5}
            />
          </span>
          <div className="space-y-1.5 flex-1 min-w-0">
            <h4
              id={`secret-paste-title-${requestId}`}
              className="text-base font-semibold leading-snug text-foreground"
            >
              Rotate {keyName}
            </h4>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Paste the new value directly. It never enters chat history or
              any audit log in plaintext — only a SHA-256 fingerprint is
              kept for verification.
            </p>
            <Badge
              variant="secondary"
              className="font-mono text-micro bg-background/60 text-muted-foreground border-transparent"
            >
              {keyName}
            </Badge>
          </div>
        </div>

        {warning && (
          <p
            className="text-xs text-acr-warn font-medium leading-relaxed pl-11 flex items-start gap-1.5"
            role="note"
          >
            <AlertTriangle
              className="w-3.5 h-3.5 shrink-0 mt-0.5"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            <span>{warning}</span>
          </p>
        )}

        <AnimatePresence mode="wait" initial={false}>
          {resolved?.status === "consumed" ? (
            <motion.div
              key="resolved"
              initial={CROSS_FADE.initial}
              animate={CROSS_FADE.animate}
              exit={CROSS_FADE.exit}
              className="text-sm font-medium text-acr-pos pl-11"
              role="status"
              aria-live="polite"
            >
              Rotated — fingerprint{" "}
              <code className="font-mono text-caption">
                {resolved.fingerprintShort}
              </code>
              .
            </motion.div>
          ) : resolved?.status === "error" ? (
            <motion.div
              key="error"
              initial={CROSS_FADE.initial}
              animate={CROSS_FADE.animate}
              exit={CROSS_FADE.exit}
              className="text-sm font-medium text-destructive pl-11"
              role="alert"
            >
              Failed: {resolved.message}
            </motion.div>
          ) : (
            <motion.form
              key="form"
              initial={CROSS_FADE.initial}
              animate={CROSS_FADE.animate}
              exit={CROSS_FADE.exit}
              onSubmit={handleSubmit}
              className="pl-11 space-y-3"
            >
              <label
                htmlFor={`secret-input-${requestId}`}
                className="sr-only"
              >
                Sealed value for {keyName}
              </label>
              <input
                id={`secret-input-${requestId}`}
                type="password"
                inputMode="text"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={pending}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder ?? `Paste new ${keyName} value`}
                aria-label={`Sealed input for ${keyName}`}
                data-testid={`secret-paste-input-${requestId}`}
                className={cn(
                  "w-full rounded-md border border-acr-warn/30 bg-background/80",
                  "px-3 text-sm font-mono leading-none",
                  "focus:outline-none focus:ring-2 focus:ring-acr-warn/40 focus:border-acr-warn/60",
                  "disabled:opacity-60",
                )}
                style={{ minHeight: TOUCH_TARGET_PT }}
              />
              <motion.div
                whileTap={pending || !value ? undefined : TAP_PRESS}
                transition={SPRING_INTERACTIVE}
              >
                <Button
                  type="submit"
                  size="default"
                  variant="default"
                  disabled={pending || !value}
                  aria-label={`Rotate ${keyName}`}
                  className="bg-acr-warn text-white hover:bg-acr-warn/90"
                  style={{ minHeight: TOUCH_TARGET_PT }}
                  data-testid={`secret-paste-confirm-${requestId}`}
                >
                  {pending ? (
                    <ThinkingDots size="sm" aria-label="Rotating" />
                  ) : (
                    <Check
                      className="w-4 h-4"
                      aria-hidden="true"
                      strokeWidth={1.75}
                    />
                  )}
                  <span className="ml-1.5">Confirm rotation</span>
                </Button>
              </motion.div>
            </motion.form>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

export default SecretPasteArtifact;
