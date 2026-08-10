/**
 * Settings → Compliance — routed section (Wave 1.5, P2 §1).
 *
 * Moved intact from the settings.tsx monolith's Tax & Compliance tab:
 * the tax-identity on-ramp card (the full editor stays at
 * /settings/tax-identity, registry-listed) and the TCPA/DNC compliance
 * settings. Legacy `?tab=tax-compliance` links (onboarding finish paths,
 * PersonaMapStrip) land here via the shell's legacy redirects.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, ExternalLink } from "lucide-react";
import { ComplianceSettings } from "@/components/compliance-settings";
import { useLocation } from "wouter";

export default function ComplianceSection() {
  const [, setLocation] = useLocation();

  return (
    <div className="space-y-8" data-testid="settings-section-compliance">
      {/* Tax identity link card — surfaces /settings/tax-identity
          (shipped during the onboarding-tax-identity merge but
          never discoverably wired from this bucket). Reyna §2 gap. */}
      <Card data-testid="card-tax-compliance-identity">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" aria-hidden="true" />
            Tax identity (W-9)
          </CardTitle>
          <CardDescription>
            Add your business's tax details (EIN or SSN) so AcreOS can issue
            the 1099 forms you owe anyone you pay more than $600 in a year.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="min-h-11 pointer-fine:sm:min-h-9"
            onClick={() => setLocation("/settings/tax-identity")}
            data-testid="button-tax-compliance-open-tax-identity"
          >
            <FileText className="w-4 h-4 mr-2" aria-hidden="true" />
            Open tax identity settings
            <ExternalLink className="w-3 h-3 ml-2" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <ComplianceSettings />
      </div>
    </div>
  );
}
