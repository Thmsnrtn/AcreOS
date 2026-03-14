import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
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
  Headphones
} from "lucide-react";

const featureGuides = [
  {
    icon: Users,
    title: "Leads & CRM",
    description: "Manage your seller and buyer leads with a full-featured CRM system.",
    details: [
      "Import leads from various sources or add them manually",
      "Track lead status through customizable pipelines",
      "Store contact information, notes, and communication history",
      "Set follow-up reminders and automate outreach",
      "Filter and search leads by location, status, or custom fields"
    ]
  },
  {
    icon: Map,
    title: "Properties & Inventory",
    description: "Track all properties in your pipeline from acquisition to sale.",
    details: [
      "Add properties with parcel data, acreage, and location details",
      "Attach documents, photos, and due diligence materials",
      "Track property status (researching, under contract, owned, listed, sold)",
      "View properties on an interactive map",
      "Calculate comps and market values"
    ]
  },
  {
    icon: GitBranch,
    title: "Deals Pipeline",
    description: "Visualize and manage deals from initial offer to closing.",
    details: [
      "Kanban-style deal pipeline with customizable stages",
      "Track offer amounts, counter-offers, and negotiations",
      "Set closing dates and track contract deadlines",
      "Associate deals with leads and properties",
      "Calculate profit margins and ROI projections"
    ]
  },
  {
    icon: Mail,
    title: "Campaigns (Email, SMS, Direct Mail)",
    description: "Run multi-channel marketing campaigns to reach motivated sellers.",
    details: [
      "Create email campaigns with templates and personalization",
      "Send SMS messages to leads with opt-in/opt-out management",
      "Launch direct mail campaigns with automated letter printing",
      "Schedule campaigns or send immediately",
      "Track open rates, responses, and conversions"
    ]
  },
  {
    icon: Banknote,
    title: "Finance & Notes",
    description: "Manage seller financing and track note performance.",
    details: [
      "Create and track seller finance notes",
      "Set up payment schedules and amortization",
      "Monitor payment status and send reminders",
      "Generate borrower portals for online payments",
      "Track portfolio performance and cash flow"
    ]
  },
  {
    icon: Bot,
    title: "AI Agents",
    description: "Leverage AI-powered assistants to automate tasks and gain insights.",
    details: [
      "Virtual assistant for answering questions about your data",
      "Automated lead scoring and prioritization",
      "AI-generated property descriptions and marketing copy",
      "Smart follow-up recommendations",
      "Market analysis and investment suggestions"
    ]
  }
];

const faqItems = [
  {
    question: "How do I get started with AcreOS?",
    answer: "After signing up, complete the onboarding wizard to configure your organization. Start by importing or adding your first leads, then explore the different modules like Properties, Deals, and Campaigns. The Dashboard provides a quick overview of your entire operation."
  },
  {
    question: "What's the difference between Platform and Custom credentials?",
    answer: "Platform credentials use AcreOS's shared sending infrastructure - emails come from our domain and SMS from our numbers. Custom credentials let you connect your own SendGrid, Twilio, or Lob accounts so communications are sent from your branded email domain and phone numbers."
  },
  {
    question: "How does the credit system work?",
    answer: "AcreOS uses a credit-based system for billable actions like sending emails, SMS messages, and direct mail. Credits are deducted based on the action type. You can view pricing in Settings and purchase additional credits as needed. Your subscription tier may include monthly credit allowances."
  },
  {
    question: "Can I import existing leads?",
    answer: "Yes! AcreOS supports bulk lead import via CSV files. Navigate to the Leads page and use the Import feature. You can map your CSV columns to AcreOS fields and even deduplicate leads during import."
  },
  {
    question: "How do AI Agents work?",
    answer: "AI Agents are specialized assistants that help with specific tasks. The AI section provides a chat interface to ask questions about your data. The Team tab shows autonomous agents working on tasks like lead nurturing and market analysis. Usage counts toward your AI request limits."
  },
  {
    question: "Is my data secure?",
    answer: "Yes. AcreOS uses industry-standard encryption for data at rest and in transit. Your data is isolated per organization, and we follow security best practices. You can also connect your own API keys instead of using platform credentials for added control."
  },
  {
    question: "How do I track deal profitability?",
    answer: "Use the Deals Pipeline to track acquisition costs, selling price, and associated expenses. The deal calculator helps you analyze potential profit margins before making offers. Finance module tracks ongoing returns from seller-financed notes."
  },
  {
    question: "Can multiple team members use AcreOS?",
    answer: "Yes, AcreOS supports team collaboration. Organization members can access shared leads, properties, and deals. Different subscription tiers include varying numbers of team seats. Contact support to add team members."
  }
];

interface HelpContentProps {
  onNavigateToSupport?: () => void;
}

export function HelpContent({ onNavigateToSupport }: HelpContentProps) {
  return (
    <div className="space-y-8">
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
            AcreOS is an all-in-one platform designed for real estate investors. It helps you manage every aspect of your
            investing business, from finding motivated sellers to closing deals and managing seller-financed notes.
          </p>
          
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
              <Target className="w-8 h-8 text-primary mb-2" />
              <span className="font-medium">Find Deals</span>
              <span className="text-sm text-muted-foreground">Lead management & marketing campaigns</span>
            </div>
            <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
              <TrendingUp className="w-8 h-8 text-primary mb-2" />
              <span className="font-medium">Close Deals</span>
              <span className="text-sm text-muted-foreground">Deal pipeline & property tracking</span>
            </div>
            <div className="flex flex-col items-center text-center p-4 rounded-lg bg-muted/50">
              <Sparkles className="w-8 h-8 text-primary mb-2" />
              <span className="font-medium">Automate</span>
              <span className="text-sm text-muted-foreground">AI agents & smart workflows</span>
            </div>
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
            <div className="p-4 rounded-lg border bg-card">
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
            <div className="p-4 rounded-lg border bg-card">
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

          <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-lg">
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
          {featureGuides.map((feature) => (
            <Card key={feature.title} data-testid={`card-feature-${feature.title.toLowerCase().replace(/\s+/g, '-')}`}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <feature.icon className="w-5 h-5 text-primary" />
                  {feature.title}
                </CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  {feature.details.map((detail, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      {detail}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
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
                <AccordionTrigger className="text-left">{faq.question}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  {faq.answer}
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
          <Button onClick={onNavigateToSupport} data-testid="button-contact-support">
            <Headphones className="w-4 h-4 mr-2" />
            Contact Support
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
