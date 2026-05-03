/**
 * SecurityPage — public customer-trust surface at /security.
 *
 * Linked from the public-page footer (P1-5) and surfaced during sales
 * conversations. Explains AcreOS's security posture in plain language:
 * encryption, authentication, sub-processors, vulnerability disclosure,
 * and where we are on SOC 2.
 *
 * Public, no auth required. Mirrors the layout pattern used by
 * /pricing, /privacy, /terms (top nav + content + shared footer).
 */
import { Link } from "wouter";
import { ArrowLeft, ShieldCheck, KeyRound, Lock, Mail, FileCheck2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SkipToContent } from "@/components/skip-to-content";
import { PublicFooter } from "@/components/public-footer";
import { usePageMeta } from "@/hooks/use-document-title";

interface SubProcessor {
  vendor: string;
  purpose: string;
  dataCategory: string;
  region: string;
}

const SUB_PROCESSORS: SubProcessor[] = [
  {
    vendor: "Stripe",
    purpose: "Payments and subscription billing",
    dataCategory: "Billing identifiers, last-4 of card",
    region: "United States",
  },
  {
    vendor: "Twilio",
    purpose: "SMS and voice outreach",
    dataCategory: "Phone numbers, message content",
    region: "United States",
  },
  {
    vendor: "SendGrid",
    purpose: "Transactional and campaign email",
    dataCategory: "Email addresses, message content",
    region: "United States",
  },
  {
    vendor: "Clerk",
    purpose: "Authentication, MFA, session management",
    dataCategory: "Email, hashed credentials, device metadata",
    region: "United States",
  },
  {
    vendor: "Anthropic",
    purpose: "AI assistance (Pax / agent runtime)",
    dataCategory: "Prompts and context the user submits",
    region: "United States",
  },
  {
    vendor: "OpenAI",
    purpose: "AI assistance (model fallback and embeddings)",
    dataCategory: "Prompts and context the user submits",
    region: "United States",
  },
  {
    vendor: "Lob",
    purpose: "Direct mail (postcards, letters)",
    dataCategory: "Mailing addresses, recipient names",
    region: "United States",
  },
  {
    vendor: "AWS",
    purpose: "Application hosting, object storage, backups",
    dataCategory: "All application data at rest",
    region: "United States (us-east-1)",
  },
];

export default function SecurityPage() {
  usePageMeta(
    "Security",
    "How AcreOS protects Land Investors' data — encryption at rest and in transit, MFA, sub-processors, vulnerability disclosure, and SOC 2 posture.",
  );

  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />

      {/* Top nav — same pattern as /pricing, /privacy */}
      <nav className="border-b bg-background/95 backdrop-blur sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity min-h-11 py-1"
            aria-label="Back to AcreOS home"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            <AcreosLogo size={30} />
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button asChild>
              <Link href="/auth?mode=register" className="min-h-11">
                Get started
              </Link>
            </Button>
          </div>
        </div>
      </nav>

      <main id="main-content" className="max-w-4xl mx-auto px-6 py-16 space-y-12">
        {/* Header */}
        <header className="space-y-3">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-primary" aria-hidden="true" />
            <h1 className="text-4xl font-bold">Security at AcreOS</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl leading-relaxed">
            Your land business runs on the data inside AcreOS. We treat that
            obligation seriously. Below is a plain-language summary of how we
            protect it — what's encrypted, who we share it with, how we
            authenticate you, and how to reach our security team.
          </p>
        </header>

        {/* How we protect your data */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" aria-hidden="true" />
              How we protect your data
            </CardTitle>
            <CardDescription>
              Encryption at rest and in transit — no exceptions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed">
            <div>
              <h3 className="font-semibold mb-1">Encryption at rest</h3>
              <p className="text-muted-foreground">
                All customer data is stored encrypted at rest using{" "}
                <span className="font-mono">AES-256-GCM</span>. Sensitive
                fields — credentials, signing tokens, payout details, identity
                verification artifacts — receive an additional layer of{" "}
                <strong>field-level encryption</strong> with keys distinct
                from the database key, so a compromise of one tier does not
                expose the next.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-1">Encryption in transit</h3>
              <p className="text-muted-foreground">
                Every connection to AcreOS — browser, API client, mobile —
                requires TLS 1.2 or higher. Older protocols and weak ciphers
                are rejected at the edge.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-1">Backups and isolation</h3>
              <p className="text-muted-foreground">
                Backups are encrypted with the same standard, retained on a
                rolling 30-day window, and stored in a region-isolated
                bucket. Tenant data is logically isolated by organization;
                every authenticated request is scoped to the caller's
                organization at the database query layer.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Authentication */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" />
              Authentication
            </CardTitle>
            <CardDescription>
              Sign-in, multi-factor, and session management — handled by
              Clerk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              AcreOS uses Clerk as our identity provider. Clerk manages
              password storage (bcrypt with per-account salts), email and
              SMS verification, multi-factor authentication (TOTP and
              backup codes), and session lifecycle.
            </p>
            <p>
              Sessions are short-lived JWTs refreshed against Clerk on each
              navigation. Revoking a device, rotating a password, or
              disabling a teammate's account takes effect across all open
              tabs within minutes — there is no long-lived bearer token to
              recover.
            </p>
            <p>
              Multi-factor authentication is available on every plan and is
              required for organization owners on the Scale tier.
            </p>
          </CardContent>
        </Card>

        {/* Sub-processors */}
        <Card>
          <CardHeader>
            <CardTitle>Sub-processors</CardTitle>
            <CardDescription>
              The trusted vendors AcreOS relies on, what they process, and
              where.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table aria-label="AcreOS sub-processors">
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Data category</TableHead>
                    <TableHead>Region</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {SUB_PROCESSORS.map((sp) => (
                    <TableRow key={sp.vendor}>
                      <TableCell className="font-medium">{sp.vendor}</TableCell>
                      <TableCell className="text-muted-foreground">{sp.purpose}</TableCell>
                      <TableCell className="text-muted-foreground">{sp.dataCategory}</TableCell>
                      <TableCell className="text-muted-foreground">{sp.region}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              We notify customers of material changes to this list via the
              changelog and account-owner email. A current Data Processing
              Addendum is available on request.
            </p>
          </CardContent>
        </Card>

        {/* Vulnerability disclosure */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" aria-hidden="true" />
              Vulnerability disclosure
            </CardTitle>
            <CardDescription>
              Found something? We want to hear from you.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              If you believe you've discovered a security issue in AcreOS,
              please email{" "}
              <a
                href="mailto:security@acreos.com"
                className="font-medium text-primary hover:underline"
                aria-label="Email AcreOS security at security@acreos.com"
              >
                security@acreos.com
              </a>
              . Encrypt sensitive details with our PGP key (available on
              request) if your finding includes proof-of-concept payloads
              or active session artifacts.
            </p>
            <ul className="space-y-2 list-disc pl-5">
              <li>
                <strong className="text-foreground">Acknowledgement:</strong>{" "}
                we will reply within{" "}
                <span className="tabular-nums">2 business days</span>.
              </li>
              <li>
                <strong className="text-foreground">Triage:</strong> initial
                severity assessment within{" "}
                <span className="tabular-nums">5 business days</span>.
              </li>
              <li>
                <strong className="text-foreground">Resolution:</strong>{" "}
                critical and high-severity issues are remediated as quickly
                as possible; we'll keep you updated on progress and
                disclosure timing.
              </li>
              <li>
                <strong className="text-foreground">Safe harbor:</strong>{" "}
                we will not pursue legal action against good-faith
                researchers who follow this process and avoid privacy
                violations, service disruption, and data exfiltration.
              </li>
            </ul>
          </CardContent>
        </Card>

        {/* Compliance posture */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-primary" aria-hidden="true" />
              Compliance posture
            </CardTitle>
            <CardDescription>
              Where we are today, and what's next.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="secondary">SOC 2 Type 1 — in flight</Badge>
              <Badge variant="outline">CCPA-aligned</Badge>
              <Badge variant="outline">GDPR-aligned</Badge>
            </div>
            <p>
              AcreOS is actively pursuing SOC 2 Type 1 certification. Our
              controls — access reviews, change management, vendor risk,
              incident response — are mapped to the AICPA Trust Services
              Criteria and audited continuously. Once Type 1 is issued we
              roll directly into the Type 2 observation window.
            </p>
            <p>
              We honor data-subject access, deletion, and portability
              requests under both CCPA and GDPR-style frameworks. Account
              owners can export an organization's full dataset from{" "}
              <Link href="/data-export" className="text-primary hover:underline">
                Settings → Data export
              </Link>{" "}
              at any time.
            </p>
            <p>
              For enterprise procurement: a current security questionnaire,
              architecture diagram, and DPA are available on request via{" "}
              <a
                href="mailto:security@acreos.com"
                className="font-medium text-primary hover:underline"
                aria-label="Email AcreOS security at security@acreos.com"
              >
                security@acreos.com
              </a>
              .
            </p>
          </CardContent>
        </Card>
      </main>

      <PublicFooter />
    </div>
  );
}
