/**
 * SecurityPage — public customer-trust surface at /security.
 *
 * Linked from the public-page footer (P1-5) and surfaced during sales
 * conversations. Explains AcreOS's security posture in plain language:
 * encryption, authentication, sub-processors, vulnerability disclosure,
 * and how to reach us.
 *
 * 2026-10-20: the SOC 2 "in flight / audited continuously" section and the
 * "encrypted backups, rolling 30-day window, region-isolated bucket" claim
 * were removed. Neither had evidence behind it: no auditor engagement exists,
 * and the backup bucket is not provisioned (roadmap-2026-10 K3 / P0-05) — the
 * dbBackup job only uploads when DB_BACKUP_S3_BUCKET is set. Do not restore
 * either claim without the evidence; securityPageClaimsHaveEvidence.test.ts.
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
import { Button } from "@/components/ui/button";
import { AcreosLogo } from "@/components/acreos-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { SkipToContent } from "@/components/skip-to-content";
import { PublicFooter } from "@/components/public-footer";
import { usePageMeta } from "@/hooks/use-document-title";
import { JsonLd } from "@/components/seo/JsonLd";
import { OpenGraph } from "@/components/seo/OpenGraph";
import { securityPageSchema, organizationSchema, SITE } from "@/lib/jsonld-schemas";
import { SupportFeedbackButton } from "@/components/support-feedback-button";
import { SUB_PROCESSORS } from "@/data/sub-processors";

export default function SecurityPage() {
  usePageMeta(
    "Security",
    "How AcreOS protects Land Investors' data — field-level encryption, HTTPS, sign-in and MFA, sub-processors, and vulnerability disclosure.",
  );

  return (
    <div className="min-h-screen bg-background">
      <SkipToContent />
      <OpenGraph
        url={`${SITE.url}/security`}
        title="Security · AcreOS"
        description="How AcreOS protects Land Investors' data — field-level encryption, HTTPS, sign-in and MFA, sub-processors, and vulnerability disclosure."
        type="website"
      />
      <JsonLd id="ld-security-webpage" data={securityPageSchema()} />
      <JsonLd id="ld-security-org" data={organizationSchema()} />

      {/* Top nav — same pattern as /pricing, /privacy */}
      <nav className="border-b bg-surface-chrome backdrop-blur sticky top-0 z-floating">
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
              What we encrypt, how connections are secured, and how tenants are separated.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed">
            <div>
              <h3 className="font-semibold mb-1">Field-level encryption</h3>
              <p className="text-muted-foreground">
                Specific sensitive values are encrypted field by field with{" "}
                <span className="font-mono">AES-256-GCM</span>: your
                organization's own EIN or SSN for tax forms, a borrower's tax
                ID on a purchased note, and the credentials you store for your
                own integrations. Tax IDs are never sent back to the browser.
                We never store full card or bank numbers — your payment
                processor holds them, and AcreOS keeps a reference and the
                last four digits. We do not claim every field is encrypted
                individually.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-1">Connections</h3>
              <p className="text-muted-foreground">
                AcreOS is served over HTTPS only, and responses carry an HSTS
                header with a one-year lifetime that includes subdomains.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-1">Tenant isolation</h3>
              <p className="text-muted-foreground">
                Tenant data is logically isolated by organization:
                queries are scoped to the caller's organization, and
                automated tests and a repository check run on every change to
                catch reads that are not.
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
              Sign-in, multi-factor, and sessions — handled by Clerk.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              AcreOS uses Clerk as our identity provider. Clerk handles
              sign-in, verification, multi-factor authentication, and session
              lifecycle; AcreOS does not store your password.
            </p>
            <p>
              Two-factor authentication is available to every account from
              your account settings. It is not yet mandatory for customer
              accounts on any plan. AcreOS's own founder and admin consoles
              do enforce it server-side.
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
                      <TableCell className="text-muted-foreground">{sp.dataCategories.join(", ")}</TableCell>
                      <TableCell className="text-muted-foreground">{sp.region}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              The full list, with each vendor's data processing terms, is
              also published at{" "}
              <Link href="/legal/sub-processors" className="text-primary hover:underline">
                Sub-processors
              </Link>
              .
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
              If you believe you've discovered a security issue in AcreOS,{" "}
              <SupportFeedbackButton
                variant="link"
                defaultCategory="support"
                source="security_disclosure"
                ariaLabel="Open the support form to submit a security finding"
                testId="security-disclosure-submit"
                className="font-medium"
              >
                submit security findings here
              </SupportFeedbackButton>
              . Include reproduction steps and any affected accounts or
              endpoints; please omit live credentials, active session
              cookies, or exfiltrated user data from the report itself —
              we'll request a secure exchange channel if your finding
              requires PoC payloads.
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

        {/* Privacy requests and export */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-primary" aria-hidden="true" />
              Privacy requests and export
            </CardTitle>
            <CardDescription>
              Where to send a privacy request and how to export your data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            <p>
              You can submit a data-subject request from{" "}
              <Link href="/settings/privacy" className="text-primary hover:underline">
                Settings → Privacy
              </Link>
              . Account owners can export an organization's data from{" "}
              <Link href="/data-export" className="text-primary hover:underline">
                Settings → Data export
              </Link>.
            </p>
          </CardContent>
        </Card>
      </main>

      <PublicFooter />
    </div>
  );
}
