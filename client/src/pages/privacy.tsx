import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield } from "lucide-react";
import { Link } from "wouter";

export default function PrivacyPolicy() {
  const lastUpdated = "January 6, 2026";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-4 md:p-8 pb-24">
        <div className="mb-6">
          <Link href="/auth">
            <Button variant="ghost" size="sm" data-testid="button-back-to-login">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Login
            </Button>
          </Link>
        </div>

        <Card className="border-border/50" data-testid="card-privacy">
          <CardContent className="p-6 md:p-8 space-y-8">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <Shield className="w-8 h-8 text-primary" />
                <h1 className="text-3xl font-bold" data-testid="text-privacy-title">Privacy Policy</h1>
              </div>
              <p className="text-muted-foreground" data-testid="text-last-updated">
                Last Updated: {lastUpdated}
              </p>
            </div>

            <section className="space-y-4" data-testid="section-introduction">
              <h2 className="text-xl font-semibold">1. Introduction</h2>
              <p className="text-muted-foreground leading-relaxed">
                AcreOS, Inc. ("Company", "we", "us", or "our") is committed to protecting your privacy. 
                This Privacy Policy explains how we collect, use, disclose, and safeguard your information 
                when you use our land investment CRM platform ("Service").
              </p>
              <p className="text-muted-foreground leading-relaxed font-medium">
                We will never sell your data. Your trust is essential to our business, and we are committed 
                to transparent data practices.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-data-collection">
              <h2 className="text-xl font-semibold">2. Information We Collect</h2>
              <p className="text-muted-foreground leading-relaxed">
                We collect information you provide directly to us, including:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li><strong>Account Information:</strong> Name, email address, and authentication credentials</li>
                <li><strong>Business Data:</strong> Lead information, property data, transaction records, and notes you create</li>
                <li><strong>Payment Information:</strong> Processed securely through Stripe; we do not store full payment card details</li>
                <li><strong>Communications:</strong> Support tickets, emails, and in-app messages</li>
                <li><strong>Usage Data:</strong> How you interact with our Service, including features used and time spent</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                We may also automatically collect:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Device information (browser type, operating system, device identifiers)</li>
                <li>Log data (IP address, access times, pages viewed)</li>
                <li>Cookies and similar tracking technologies</li>
              </ul>
            </section>

            <section className="space-y-4" data-testid="section-data-usage">
              <h2 className="text-xl font-semibold">3. How We Use Your Information</h2>
              <p className="text-muted-foreground leading-relaxed">
                We use the information we collect to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Provide, maintain, and improve the Service</li>
                <li>Process transactions and send related information</li>
                <li>Send technical notices, updates, security alerts, and support messages</li>
                <li>Respond to your comments, questions, and support requests</li>
                <li>Monitor and analyze usage trends to improve user experience</li>
                <li>Detect, prevent, and address technical issues and fraud</li>
                <li>Comply with legal obligations</li>
              </ul>
            </section>

            <section className="space-y-4" data-testid="section-byok">
              <h2 className="text-xl font-semibold">4. BYOK (Bring Your Own Key) Privacy</h2>
              <p className="text-muted-foreground leading-relaxed">
                AcreOS supports Bring Your Own Key (BYOK) integrations, allowing you to use your own API 
                keys for third-party services. When you use BYOK:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li><strong>Direct Data Flow:</strong> Your data flows directly between our Service and the third-party 
                    provider using your API credentials. We facilitate the connection but do not store the 
                    data processed by third-party services.</li>
                <li><strong>Your API Keys:</strong> We encrypt and securely store your API keys using industry-standard 
                    encryption. Keys are only decrypted when making authorized API calls on your behalf.</li>
                <li><strong>Third-Party Privacy:</strong> Data processed through BYOK integrations is subject to the 
                    privacy policies of the respective third-party providers. We recommend reviewing their policies.</li>
              </ul>
            </section>

            <section className="space-y-4" data-testid="section-third-party">
              <h2 className="text-xl font-semibold">5. Third-Party Services</h2>
              <p className="text-muted-foreground leading-relaxed">
                We integrate with the following third-party services to provide our Service:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li><strong>Stripe:</strong> Payment processing and subscription management. Stripe's privacy policy 
                    governs payment data handling.</li>
                <li><strong>OpenAI:</strong> AI-powered features including offer generation and document analysis. 
                    Data sent to OpenAI is used only to process your requests and is not used to train their models.</li>
                <li><strong>Lob:</strong> Direct mail services for campaign delivery. Recipient addresses and mail 
                    content are shared with Lob for fulfillment purposes.</li>
                <li><strong>Regrid:</strong> Parcel data and property information services. We retrieve publicly 
                    available property data on your behalf.</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                Each third-party service has its own privacy policy. We encourage you to review them to 
                understand how your data may be processed.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-data-retention">
              <h2 className="text-xl font-semibold">6. Data Retention</h2>
              <p className="text-muted-foreground leading-relaxed">
                We retain your information for as long as your account is active or as needed to provide 
                you services. Specifically:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li><strong>Active Accounts:</strong> Data is retained throughout your subscription</li>
                <li><strong>After Cancellation:</strong> We retain data for 90 days to allow for account reactivation 
                    and data export</li>
                <li><strong>Permanent Deletion:</strong> Upon request, we will permanently delete your data within 30 days, 
                    except where retention is required by law</li>
                <li><strong>Backup Systems:</strong> Backups are purged within 30 days of deletion from primary systems</li>
                <li><strong>Legal Requirements:</strong> We may retain certain data as required by law, regulation, or 
                    legitimate business purposes (e.g., billing records)</li>
              </ul>
            </section>

            <section className="space-y-4" data-testid="section-user-rights">
              <h2 className="text-xl font-semibold">7. Your Rights</h2>
              <p className="text-muted-foreground leading-relaxed">
                You have the following rights regarding your personal data:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li><strong>Access:</strong> Request a copy of all personal data we hold about you</li>
                <li><strong>Export:</strong> Download your data in a portable, machine-readable format (JSON, CSV)</li>
                <li><strong>Correction:</strong> Request correction of inaccurate or incomplete information</li>
                <li><strong>Deletion:</strong> Request permanent deletion of your personal data</li>
                <li><strong>Restriction:</strong> Request that we limit processing of your data in certain circumstances</li>
                <li><strong>Objection:</strong> Object to processing of your data for specific purposes</li>
                <li><strong>Portability:</strong> Transfer your data to another service provider</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                To exercise any of these rights, please contact us at privacy@acreos.com. We will respond 
                to your request within 30 days.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-security">
              <h2 className="text-xl font-semibold">8. Data Security</h2>
              <p className="text-muted-foreground leading-relaxed">
                We implement appropriate technical and organizational measures to protect your data, including:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Encryption of data in transit (TLS 1.3) and at rest (AES-256)</li>
                <li>Regular security assessments and penetration testing</li>
                <li>Access controls and authentication requirements</li>
                <li>Employee training on data protection practices</li>
                <li>Incident response procedures for potential breaches</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                While we strive to protect your information, no method of transmission over the internet 
                is 100% secure. We cannot guarantee absolute security.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-cookies">
              <h2 className="text-xl font-semibold">9. Cookies and Tracking</h2>
              <p className="text-muted-foreground leading-relaxed">
                We use cookies and similar technologies to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Maintain your session and authentication state</li>
                <li>Remember your preferences and settings</li>
                <li>Analyze usage patterns to improve the Service</li>
                <li>Ensure security and prevent fraud</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed mt-4">
                You can control cookies through your browser settings, but disabling certain cookies may 
                affect the functionality of the Service.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-children">
              <h2 className="text-xl font-semibold">10. Children's Privacy</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service is not intended for individuals under the age of 18. We do not knowingly collect 
                personal information from children. If we learn that we have collected personal information 
                from a child under 18, we will take steps to delete such information promptly.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-changes">
              <h2 className="text-xl font-semibold">11. Changes to This Policy</h2>
              <p className="text-muted-foreground leading-relaxed">
                We may update this Privacy Policy from time to time. We will notify you of material changes 
                by posting the new policy on this page and updating the "Last Updated" date. For significant 
                changes, we may also send you an email notification.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Your continued use of the Service after any changes indicates your acceptance of the updated policy.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-contact">
              <h2 className="text-xl font-semibold">12. Contact Us</h2>
              <p className="text-muted-foreground leading-relaxed">
                If you have any questions about this Privacy Policy or our data practices, please contact us at:
              </p>
              <p className="text-muted-foreground">
                Email: privacy@acreos.com<br />
                Address: [Company Address]<br />
                Data Protection Officer: dpo@acreos.com
              </p>
            </section>

            <div className="pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                By using AcreOS, you acknowledge that you have read and understood this Privacy Policy.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
