/**
 * Settings → AI & data providers — routed section (Wave 1.5, P2 §1).
 *
 * AI cost, AI settings, provider configuration, and the BYOK block —
 * moved intact from the settings.tsx monolith's Integrations tab. The
 * full BYOK key-entry surface stays at /settings/byok (registry-listed);
 * the trust microcopy + link block here is the in-context on-ramp.
 */
import { Link2, Lock } from "lucide-react";
import { AICostDashboard } from "@/components/ai-cost-dashboard";
import { AISettings } from "@/components/ai-settings";
import { ProviderSettings } from "@/components/provider-settings";
import { ByokSettings } from "@/components/settings/ByokSettings";

export default function ProvidersSection() {
  return (
    <div className="space-y-8" data-testid="settings-section-providers">
      {/* AI cost, settings, provider config */}
      <AICostDashboard />
      <AISettings />
      <div className="pt-4 border-t">
        <h3 className="text-section-h2 mb-4">Service Providers</h3>
        <ProviderSettings />
      </div>

      {/* BYOK */}
      <div className="space-y-6 pt-4 border-t">
        <div>
          <h2 className="text-section-h2 flex items-center gap-2">
            <Link2 className="w-5 h-5" />
            Use your own provider accounts
          </h2>
          <p className="text-muted-foreground text-sm">
            Plug in your own Twilio, SendGrid, or Lob account so texts, emails, and mail bill to you directly instead of drawing from AcreOS credits.
          </p>
          {/* Trust microcopy at the moment of key entry. BYOK
              adoption is gated on the user believing we won't
              leak their OpenAI / Twilio / SendGrid secret. */}
          <div className="mt-3 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-start gap-2">
            <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-foreground/70" aria-hidden />
            <span>
              Keys are encrypted at rest with per-org KMS, never logged, and only decrypted in-memory to make the upstream call.{" "}
              <a href="/security" className="underline hover:text-foreground active:text-foreground">
                Security details
              </a>
              .
            </span>
          </div>
        </div>
        <ByokSettings />
      </div>
    </div>
  );
}
