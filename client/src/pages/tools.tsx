import { PageShell } from "@/components/page-shell";
import { DealCalculator } from "@/components/deal-calculator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calculator, Wrench } from "lucide-react";

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
              </div>
            </TabsContent>
          </Tabs>
    </PageShell>
  );
}
