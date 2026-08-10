/**
 * Settings → Profile & sharing — routed section (Wave 1.5, P2 §1).
 *
 * The personal pieces of the monolith's Account tab, moved intact:
 * refer-and-earn, the data-sources and transparency disclosure cards, and
 * the personal privacy/data-rights block (export + anonymize). The fuller
 * org-level DSAR surface stays at /settings/privacy (Privacy & data
 * requests) — both are listed in the registry.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, FileText, ExternalLink } from "lucide-react";
import { ReferralSettings, PrivacyDataSettings } from "@/pages/settings/account-sections";
import { useLocation } from "wouter";

export default function ProfileSection() {
  const [, setLocation] = useLocation();

  return (
    <div className="space-y-8" data-testid="settings-section-profile">
      {/* Refer & earn */}
      <ReferralSettings />

      {/* Privacy & data rights (GDPR/CCPA) */}
      <div className="pt-4 border-t" data-testid="tab-content-account-privacy">
        <PrivacyDataSettings />
      </div>

      {/* How AcreOS sources data (Quinn item #5 — transparency surface) */}
      <div className="pt-4 border-t" data-testid="tab-content-account-data-sources">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Database className="w-5 h-5" aria-hidden="true" />
              How AcreOS sources data
            </CardTitle>
            <CardDescription>
              See every data source behind the numbers in AcreOS — what
              each is on record for, how often it updates, its license,
              and how to read facts versus estimates.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="min-h-11 pointer-fine:sm:min-h-9"
              onClick={() => setLocation("/data-sources")}
              data-testid="button-view-data-sources"
            >
              View data sources
              <ExternalLink className="w-4 h-4 ml-2" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Transparency Report (Quinn #4 / Beatrice #3 — public
          accountability surface). Linked here for logged-in
          customers; also public at /transparency. */}
      <div className="pt-4 border-t" data-testid="tab-content-account-transparency">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-5 h-5" aria-hidden="true" />
              Transparency report
            </CardTitle>
            <CardDescription>
              See how Pax's rules play out each period — refusals by
              rule, appeal outcomes, founder overrides, and our drift
              and fairness checks. Published even when the numbers are
              unflattering.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="min-h-11 pointer-fine:sm:min-h-9"
              onClick={() => setLocation("/transparency")}
              data-testid="button-view-transparency"
            >
              View transparency report
              <ExternalLink className="w-4 h-4 ml-2" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
