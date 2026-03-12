import { Link } from "wouter";
import { PageShell } from "@/components/page-shell";
import { DealCalculator } from "@/components/deal-calculator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calculator, Wrench, Receipt, Share2, Brain, Target, Webhook, UserCheck, ArrowRight } from "lucide-react";

export default function ToolsPage() {
  return (
    <PageShell>
        
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">Tools</h1>
            <p className="text-muted-foreground">Investment analysis and calculation tools.</p>
          </div>

          <Tabs defaultValue="calculator" className="space-y-6">
            <TabsList>
              <TabsTrigger value="calculator" className="gap-2" data-testid="tab-calculator">
                <Calculator className="w-4 h-4" />
                Deal Calculator
              </TabsTrigger>
              <TabsTrigger value="more" className="gap-2" data-testid="tab-more">
                <Wrench className="w-4 h-4" />
                More Tools
              </TabsTrigger>
            </TabsList>

            <TabsContent value="calculator" className="space-y-6">
              <DealCalculator showSaveButton={false} />
            </TabsContent>

            <TabsContent value="more">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border rounded-lg p-6 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <Calculator className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold">Amortization Schedule</h3>
                      <p className="text-sm text-muted-foreground">Generate payment schedules for seller-financed notes.</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">Create and view this from the Finance &gt; Notes section when you add a new note.</p>
                </div>
                <div className="border rounded-lg p-6 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-muted">
                      <Wrench className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold">CSV Import / Export</h3>
                      <p className="text-sm text-muted-foreground">Bulk import leads, properties, and deals from CSV files.</p>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">Available from the Leads, Properties, and Deals pages via the import/export buttons.</p>
                </div>

                {/* New Feature Tools */}
                {[
                  { href: "/tax-optimizer", icon: Receipt, title: "Tax Optimizer", desc: "Capital gains analysis, 1031 exchanges, and year-end tax planning.", color: "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600" },
                  { href: "/goals", icon: Target, title: "Goals & OKRs", desc: "Track revenue targets, deal counts, and organizational KPIs.", color: "bg-blue-50 dark:bg-blue-900/20 text-blue-600" },
                  { href: "/syndication", icon: Share2, title: "Listing Syndication", desc: "Publish properties to Land.com, LandWatch, LandFlip, and more.", color: "bg-violet-50 dark:bg-violet-900/20 text-violet-600" },
                  { href: "/model-training", icon: Brain, title: "Valuation Model", desc: "AcreOS Market Value™ training data, accuracy metrics, and predictions.", color: "bg-amber-50 dark:bg-amber-900/20 text-amber-600" },
                  { href: "/webhooks", icon: Webhook, title: "Webhooks", desc: "HMAC-signed webhooks for Zapier, Make, and custom integrations.", color: "bg-gray-50 dark:bg-gray-900/20 text-gray-600" },
                  { href: "/investor-network", icon: UserCheck, title: "Investor Network", desc: "Browse verified investors and manage your investor profile.", color: "bg-pink-50 dark:bg-pink-900/20 text-pink-600" },
                ].map(({ href, icon: Icon, title, desc, color }) => (
                  <Link key={href} href={href}>
                    <div className="border rounded-lg p-4 space-y-2 hover:bg-muted/50 transition-colors cursor-pointer group">
                      <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg ${color}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1">
                          <h3 className="font-semibold text-sm">{title}</h3>
                          <p className="text-xs text-muted-foreground">{desc}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </TabsContent>
          </Tabs>
    </PageShell>
  );
}
