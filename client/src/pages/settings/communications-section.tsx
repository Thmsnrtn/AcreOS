/**
 * Settings → Mailbox, domains & phone numbers — routed section (Wave 1.5,
 * P2 §1).
 *
 * Sender identities, return addresses, phone numbers, and communication
 * provider connections — moved intact from the settings.tsx monolith's
 * Notifications tab. Every live "Connect provider" link (?tab=integrations,
 * #communications, /settings/email, /settings/mail) resolves here via the
 * shell's legacy redirects.
 */
import { Mail, Phone } from "lucide-react";
import { EmailSettingsContent } from "@/components/email-settings-content";
import { MailSettingsContent } from "@/components/mail-settings-content";
import { PhoneNumbersSettings } from "@/components/phone-numbers-settings";
import { IntegrationsSettings } from "@/components/integrations-settings";
import { EmailDomainsSettings } from "@/components/email-domains-settings";

export default function CommunicationsSection() {
  return (
    <div className="space-y-8" data-testid="settings-section-communications">
      <div className="space-y-4" data-testid="section-email-settings">
        <div>
          <h2 className="text-section-h2 flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Email Settings
          </h2>
          <p className="text-muted-foreground text-sm">
            Configure email sender identities and reply routing.
          </p>
        </div>
        <EmailSettingsContent />
      </div>

      <div className="space-y-4" data-testid="section-mail-settings">
        <div>
          <h2 className="text-section-h2 flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Mail Settings
          </h2>
          <p className="text-muted-foreground text-sm">
            Configure return addresses for direct mail campaigns.
          </p>
        </div>
        <MailSettingsContent />
      </div>

      <div className="space-y-4" data-testid="section-phone-settings">
        <div>
          <h2 className="text-section-h2 flex items-center gap-2">
            <Phone className="w-5 h-5" />
            Phone Numbers
          </h2>
          <p className="text-muted-foreground text-sm">
            Configure phone numbers for SMS and calling.
          </p>
        </div>
        <PhoneNumbersSettings />
      </div>

      <div className="space-y-4" data-testid="section-integrations">
        <div>
          <h2 className="text-section-h2">Communication Integrations</h2>
          <p className="text-muted-foreground text-sm">
            Connect your own email, SMS, and direct mail providers for branded communications.
          </p>
        </div>
        <IntegrationsSettings />
        <EmailDomainsSettings />
      </div>
    </div>
  );
}
