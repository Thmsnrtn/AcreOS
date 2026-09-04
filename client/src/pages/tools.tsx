import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { DealCalculator } from "@/components/deal-calculator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Calculator, Wrench, Receipt, Share2, Brain, Target, Webhook, UserCheck, ArrowRight } from "lucide-react";

export default function ToolsPage() {
  useDocumentTitle("Tools");
  return (
    <PageShell>
      <div>
        <h1 className="text-3xl font-bold" data-testid="text-page-title">Tools</h1>
        <p className="text-muted-foreground">Investment analysis and calculation tools.</p>
      </div>

      <Tabs defaultValue="calculator" className="space-y-6">
        <TabsList>
          <TabsTrigger value="calculator" className="gap-2" data-testid="tab-calculator">
            <Calculator className="w-4 h-4" aria-hidden="true" />
            Deal calculator
          </TabsTrigger>
          <TabsTrigger value="more" className="gap-2" data-testid="tab-more">
            <Wrench className="w-4 h-4" aria-hidden="true" />
            More tools
          </TabsTrigger>
        </TabsList>

        <TabsContent value="calculator" className="space-y-6">
          <DealCalculator showSaveButton={false} />
        </TabsContent>

        <TabsContent value="more">
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-6" aria-label="Available tools">
            <li className="border rounded-card p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-card bg-muted" aria-hidden="true">
                  <Calculator className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold">Amortization schedule</h3>
                  <p className="text-sm text-muted-foreground">Generate payment schedules for seller-financed notes.</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Create and view this from the Finance &gt; Notes section when you add a new note.</p>
            </li>
            <li className="border rounded-card p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-card bg-muted" aria-hidden="true">
                  <Wrench className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold">CSV import / export</h3>
                  <p className="text-sm text-muted-foreground">Bulk import leads, properties, and deals from CSV files.</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">Available from the Leads, Properties, and Deals pages via the import/export buttons.</p>
            </li>

            {/* New Feature Tools */}
            {[
              { href: "/tax-optimizer", icon: Receipt, title: "Tax optimizer", desc: "Capital gains analysis, 1031 exchanges, and year-end tax planning.", color: "bg-acr-pos-soft dark:bg-acr-pos-soft/20 text-acr-pos-soft-ink" },
              { href: "/goals", icon: Target, title: "Goals & OKRs", desc: "Track revenue targets, deal counts, and organizational KPIs.", color: "bg-acr-accent dark:bg-acr-accent/20 text-acr-accent" },
              { href: "/syndication", icon: Share2, title: "Listing syndication", desc: "Publish properties to Land.com, LandWatch, LandFlip, and more.", color: "bg-acr-accent dark:bg-acr-accent/20 text-acr-accent" },
              { href: "/model-training", icon: Brain, title: "Valuation model", desc: "AcreOS Market Value™ training data, accuracy metrics, and predictions.", color: "bg-acr-warn-soft dark:bg-acr-warn-soft/20 text-acr-warn-soft-ink" },
              { href: "/webhooks", icon: Webhook, title: "Webhooks", desc: "HMAC-signed webhooks for Zapier, Make, and custom integrations.", color: "bg-muted dark:bg-acr-bg-sunken/20 text-muted-foreground" },
              { href: "/investor-network", icon: UserCheck, title: "Investor network", desc: "Browse verified investors and manage your investor profile.", color: "bg-acr-brand-soft dark:bg-acr-brand-soft/20 text-acr-brand-soft-ink" },
            ].map(({ href, icon: Icon, title, desc, color }) => (
              <li key={href}>
                <Link href={href}>
                  <a
                    className="block border rounded-card p-4 space-y-2 hover:bg-muted/50 transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-11"
                    aria-label={`${title}: ${desc}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-card ${color}`} aria-hidden="true">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-sm">{title}</h3>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                      <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden="true" />
                    </div>
                  </a>
                </Link>
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
