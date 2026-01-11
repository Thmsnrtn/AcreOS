import { Sidebar } from "@/components/layout-sidebar";
import { DealCalculator } from "@/components/deal-calculator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calculator, Wrench } from "lucide-react";

export default function ToolsPage() {
  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-8 overflow-x-hidden">
        <div className="max-w-7xl mx-auto space-y-6 md:space-y-8">
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
              <div className="text-center py-12 text-muted-foreground">
                <Wrench className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>More tools coming soon...</p>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
