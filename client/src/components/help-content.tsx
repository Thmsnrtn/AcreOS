import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  PAX_CONTROLS_LABEL,
  PAX_CONTROLS_PATH,
  PAX_LABELS,
  PAX_PAUSE_STILL_WORKS,
  PAX_STANDING_LINE,
} from "@shared/pax-glossary-core";
import {
  Rocket,
  Mail,
  MessageSquare,
  Users,
  Map,
  GitBranch,
  Banknote,
  Bot,
  Key,
  Building2,
  Send,
  FileText,
  Sparkles,
  Target,
  TrendingUp,
  Headphones,
  type LucideIcon,
} from "lucide-react";
import type { HelpFaqItem, HelpFeatureGuide } from "@/data/help-content-data";
import {
  HELP_CONTENT_URL,
  substituteTokens,
  useStaticData,
} from "@/lib/static-data";

/**
 * The feature guides + FAQ items are served as data (/help-content.json,
 * generated verbatim from client/src/data/help-content-data.ts and pinned
 * deep-equal to it) instead of riding inside this chunk as JS. The data
 * names icons and carries {{TOKEN}} placeholders for the Pax glossary's
 * single-source constants; both resolve here, at render time, to exactly
 * the components and strings this file used inline before the extraction.
 */
const HELP_FEATURE_ICONS: Record<string, LucideIcon> = {
  Users,
  Map,
  GitBranch,
  Mail,
  Banknote,
  Bot,
};

const HELP_TOKENS: Record<string, string> = {
  PAX_STANDING_LINE,
  PAX_CONTROLS_LABEL,
  PAX_MENTAL_MODEL: PAX_LABELS.mentalModel.join(" "),
  PAX_FIXED_RULE: PAX_LABELS.fixedRule,
  PAX_QUEUE: PAX_LABELS.queue,
  PAX_PAUSE_STILL_WORKS,
};

interface HelpContentData {
  featureGuides: HelpFeatureGuide[];
  faqItems: HelpFaqItem[];
}

interface HelpContentProps {
  onNavigateToSupport?: () => void;
}

export function HelpContent({ onNavigateToSupport }: HelpContentProps) {
  const { data: helpData, error: helpError } =
    useStaticData<HelpContentData>(HELP_CONTENT_URL);
  const featureGuides = helpData?.featureGuides ?? [];
  const faqItems = helpData?.faqItems ?? [];
  return (
    <div className="space-y-8">
      {helpError && (
        <p className="text-sm text-muted-foreground" data-testid="text-help-load-error">
          Couldn't load the feature guides and FAQ — refresh to try again.
        </p>
      )}
      {/* Getting Started */}
      <Card data-testid="card-getting-started">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="w-5 h-5" />
            Getting Started
          </CardTitle>
          <CardDescription>Overview of AcreOS capabilities</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            AcreOS is an all-in-one platform designed for Land Investors. It helps you manage every aspect of your
            land-investing business, from finding motivated sellers to closing deals and managing seller-financed notes.
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <div className="flex flex-col items-center text-center p-4 rounded-card bg-muted/50">
              <Target className="w-8 h-8 text-primary mb-2" />
              <span className="font-medium">Find Deals</span>
              <span className="text-sm text-muted-foreground">Lead management & marketing campaigns</span>
            </div>
            <div className="flex flex-col items-center text-center p-4 rounded-card bg-muted/50">
              <TrendingUp className="w-8 h-8 text-primary mb-2" />
              <span className="font-medium">Close Deals</span>
              <span className="text-sm text-muted-foreground">Deal pipeline & property tracking</span>
            </div>
            <div className="flex flex-col items-center text-center p-4 rounded-card bg-muted/50">
              <Sparkles className="w-8 h-8 text-primary mb-2" />
              <span className="font-medium">Automate</span>
              <span className="text-sm text-muted-foreground">Workflows, sequences & Pax drafts</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button asChild variant="outline" size="sm" className="min-h-11 pointer-fine:sm:min-h-9">
              <Link href="/ai" data-testid="link-help-open-pax">Open Pax</Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="min-h-11 pointer-fine:sm:min-h-9">
              <Link href={PAX_CONTROLS_PATH} data-testid="link-help-pax-controls">{PAX_CONTROLS_LABEL}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* How Communications Work */}
      <Card data-testid="card-communications">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            How Communications Work
          </CardTitle>
          <CardDescription>Understanding platform vs. custom credentials</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-muted-foreground">
            AcreOS offers two modes for sending communications (email, SMS, and direct mail):
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Platform Credentials */}
            <div className="p-4 rounded-card border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="w-5 h-5 text-primary" />
                <span className="font-semibold">Platform Credentials</span>
                <Badge variant="secondary">Default</Badge>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  Uses AcreOS's shared sending infrastructure
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  Emails sent from AcreOS domain
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  SMS from shared phone numbers
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  Quick setup, no configuration needed
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  Credits deducted per message sent
                </li>
              </ul>
            </div>

            {/* Custom Credentials */}
            <div className="p-4 rounded-card border bg-card">
              <div className="flex items-center gap-2 mb-3">
                <Key className="w-5 h-5 text-primary" />
                <span className="font-semibold">Custom Credentials</span>
                <Badge variant="outline">Optional</Badge>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  Connect your own SendGrid, Twilio, or Lob accounts
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  Send from your branded email domain
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  Use your own phone numbers for SMS
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  Full control over sender reputation
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary mt-1">•</span>
                  Pay providers directly, reduced credit usage
                </li>
              </ul>
            </div>
          </div>

          <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-card">
            <strong>Tip:</strong> You can configure custom credentials in Settings → Communication Integrations. 
            Start with platform credentials to get up and running quickly, then switch to custom credentials 
            as your business grows and branding becomes more important.
          </p>
        </CardContent>
      </Card>

      {/* Feature Guides */}
      <div className="space-y-4" data-testid="section-feature-guides">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Feature Guides
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {featureGuides.map((feature) => {
            const FeatureIcon = HELP_FEATURE_ICONS[feature.icon] ?? FileText;
            return (
            <Card key={feature.title} data-testid={`card-feature-${feature.title.toLowerCase().replace(/\s+/g, '-')}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FeatureIcon className="w-5 h-5 text-primary" />
                  {feature.title}
                </CardTitle>
                <CardDescription>{substituteTokens(feature.description, HELP_TOKENS)}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {feature.details.map((detail, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      {substituteTokens(detail, HELP_TOKENS)}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            );
          })}
        </div>
      </div>

      {/* FAQ Section */}
      <Card data-testid="card-faq">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            Frequently Asked Questions
          </CardTitle>
          <CardDescription>Common questions about using AcreOS</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((faq, index) => (
              <AccordionItem key={index} value={`faq-${index}`} data-testid={`faq-item-${index}`}>
                <AccordionTrigger className="text-left">{substituteTokens(faq.question, HELP_TOKENS)}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {substituteTokens(faq.answer, HELP_TOKENS)}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
      </Card>

      {/* Need More Help */}
      <Card data-testid="card-more-help">
        <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 py-6">
          <div>
            <h3 className="font-semibold">Need More Help?</h3>
            <p className="text-sm text-muted-foreground">
              Contact our support team for personalized assistance.
            </p>
          </div>
          <Button className="min-h-11 pointer-fine:sm:min-h-9" onClick={onNavigateToSupport} data-testid="button-contact-support">
            <Headphones className="w-4 h-4 mr-2" />
            Contact Support
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
