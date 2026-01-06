import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, FileText } from "lucide-react";
import { Link } from "wouter";

export default function TermsOfService() {
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

        <Card className="border-border/50" data-testid="card-terms">
          <CardContent className="p-6 md:p-8 space-y-8">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <FileText className="w-8 h-8 text-primary" />
                <h1 className="text-3xl font-bold" data-testid="text-terms-title">Terms of Service</h1>
              </div>
              <p className="text-muted-foreground" data-testid="text-last-updated">
                Last Updated: {lastUpdated}
              </p>
            </div>

            <section className="space-y-4" data-testid="section-acceptance">
              <h2 className="text-xl font-semibold">1. Acceptance of Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                By accessing or using AcreOS ("Service"), you agree to be bound by these Terms of Service ("Terms"). 
                If you do not agree to these Terms, you may not access or use the Service. AcreOS is a land investment 
                customer relationship management (CRM) platform with seller financing features operated by AcreOS, Inc. ("Company", "we", "us", or "our").
              </p>
              <p className="text-muted-foreground leading-relaxed">
                We reserve the right to modify these Terms at any time. We will notify you of material changes by 
                posting the updated Terms on this page and updating the "Last Updated" date. Your continued use of 
                the Service after any changes constitutes acceptance of the new Terms.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-description">
              <h2 className="text-xl font-semibold">2. Service Description</h2>
              <p className="text-muted-foreground leading-relaxed">
                AcreOS provides a comprehensive platform for land investors, including but not limited to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Lead management and tracking</li>
                <li>Property due diligence tools and parcel data integration</li>
                <li>Offer generation and document management</li>
                <li>Campaign management for direct mail and communications</li>
                <li>Seller financing portfolio management</li>
                <li>AI-powered assistance for investment analysis</li>
                <li>Integration with third-party services (Stripe, Lob, Regrid, OpenAI)</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                The Service is designed for professional land investors and real estate professionals. 
                We do not provide legal, financial, or investment advice.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-account">
              <h2 className="text-xl font-semibold">3. Account Responsibilities</h2>
              <p className="text-muted-foreground leading-relaxed">
                To use the Service, you must create an account and provide accurate, complete information. You are responsible for:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Maintaining the confidentiality of your account credentials</li>
                <li>All activities that occur under your account</li>
                <li>Notifying us immediately of any unauthorized access or security breach</li>
                <li>Ensuring all users within your organization comply with these Terms</li>
                <li>Maintaining accurate and up-to-date account information</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                You must be at least 18 years old and have the legal capacity to enter into these Terms. 
                If you are using the Service on behalf of an organization, you represent that you have authority 
                to bind that organization to these Terms.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-payment">
              <h2 className="text-xl font-semibold">4. Payment Terms</h2>
              <p className="text-muted-foreground leading-relaxed">
                Payment processing is handled securely through Stripe. By subscribing to a paid plan, you agree to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Pay all applicable fees as described at the time of purchase</li>
                <li>Provide valid and current payment information</li>
                <li>Authorize recurring charges for subscription plans</li>
                <li>Pay any applicable taxes in addition to the stated fees</li>
              </ul>
              <p className="text-muted-foreground leading-relaxed">
                Subscription fees are billed in advance on a monthly or annual basis. Refunds are provided in accordance 
                with our refund policy. We reserve the right to change pricing with 30 days' notice. Credit-based services 
                (such as direct mail, skip tracing, and AI features) are charged on a per-use basis according to current rates.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-data-usage">
              <h2 className="text-xl font-semibold">5. Data Usage and BYOK Integrations</h2>
              <p className="text-muted-foreground leading-relaxed">
                We collect and process data as described in our Privacy Policy. By using the Service, you grant us 
                the right to use your data solely for the purpose of providing and improving the Service.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                <strong>Bring Your Own Key (BYOK):</strong> AcreOS supports BYOK integrations, allowing you to use your 
                own API keys for third-party services (such as OpenAI). When using BYOK:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Your data flows directly between your account and the third-party service</li>
                <li>You are responsible for any costs incurred with the third-party provider</li>
                <li>You must comply with the third-party provider's terms of service</li>
                <li>We encrypt and securely store your API keys but are not responsible for third-party service availability or data handling</li>
              </ul>
            </section>

            <section className="space-y-4" data-testid="section-prohibited">
              <h2 className="text-xl font-semibold">6. Prohibited Uses</h2>
              <p className="text-muted-foreground leading-relaxed">
                You agree not to use the Service to:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Violate any applicable laws, regulations, or third-party rights</li>
                <li>Send spam, unsolicited communications, or violate anti-spam laws (CAN-SPAM, TCPA)</li>
                <li>Engage in fraudulent, deceptive, or misleading practices</li>
                <li>Attempt to gain unauthorized access to our systems or other users' accounts</li>
                <li>Interfere with or disrupt the Service or its infrastructure</li>
                <li>Reverse engineer, decompile, or attempt to extract source code</li>
                <li>Use the Service to harass, threaten, or harm others</li>
                <li>Upload malicious code, viruses, or harmful content</li>
                <li>Resell or redistribute the Service without authorization</li>
              </ul>
            </section>

            <section className="space-y-4" data-testid="section-ip">
              <h2 className="text-xl font-semibold">7. Intellectual Property</h2>
              <p className="text-muted-foreground leading-relaxed">
                The Service, including all content, features, and functionality, is owned by the Company and is 
                protected by copyright, trademark, and other intellectual property laws. You retain ownership of 
                any data you upload to the Service.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                You are granted a limited, non-exclusive, non-transferable license to use the Service in accordance 
                with these Terms. This license does not include the right to modify, distribute, or create derivative 
                works based on the Service.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-liability">
              <h2 className="text-xl font-semibold">8. Limitation of Liability</h2>
              <p className="text-muted-foreground leading-relaxed">
                TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE COMPANY SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, 
                SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, OR 
                BUSINESS OPPORTUNITIES, ARISING OUT OF OR RELATED TO YOUR USE OF THE SERVICE.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, 
                INCLUDING BUT NOT LIMITED TO MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Our total liability for any claims arising from or related to the Service shall not exceed the amount 
                you paid us in the twelve (12) months preceding the claim.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-termination">
              <h2 className="text-xl font-semibold">9. Termination</h2>
              <p className="text-muted-foreground leading-relaxed">
                You may terminate your account at any time by contacting support or using the account settings. 
                We may terminate or suspend your access to the Service immediately, without prior notice, for any 
                reason, including breach of these Terms.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Upon termination:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-2 ml-4">
                <li>Your right to use the Service will immediately cease</li>
                <li>You may request export of your data within 30 days</li>
                <li>We may delete your data after the retention period specified in our Privacy Policy</li>
                <li>Any outstanding fees remain payable</li>
              </ul>
            </section>

            <section className="space-y-4" data-testid="section-governing-law">
              <h2 className="text-xl font-semibold">10. Governing Law and Disputes</h2>
              <p className="text-muted-foreground leading-relaxed">
                These Terms shall be governed by and construed in accordance with the laws of the State of Delaware, 
                United States, without regard to its conflict of law provisions. Any disputes arising from these Terms 
                or the Service shall be resolved through binding arbitration in accordance with the rules of the 
                American Arbitration Association.
              </p>
            </section>

            <section className="space-y-4" data-testid="section-contact">
              <h2 className="text-xl font-semibold">11. Contact Information</h2>
              <p className="text-muted-foreground leading-relaxed">
                If you have any questions about these Terms, please contact us at:
              </p>
              <p className="text-muted-foreground">
                Email: legal@acreos.com<br />
                Address: [Company Address]
              </p>
            </section>

            <div className="pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                By using AcreOS, you acknowledge that you have read, understood, and agree to be bound by these Terms of Service.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
