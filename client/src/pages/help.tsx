import { useState, useEffect } from "react";
import { Sidebar } from "@/components/layout-sidebar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HelpContent } from "@/components/help-content";
import { SupportContent } from "@/components/support-content";
import { HelpCircle, Headphones } from "lucide-react";

export default function HelpPage() {
  const [activeTab, setActiveTab] = useState("help");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash === "support") {
      setActiveTab("support");
    }
  }, []);

  useEffect(() => {
    const newHash = activeTab === "support" ? "#support" : "";
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, "", window.location.pathname + newHash);
    }
  }, [activeTab]);

  const handleNavigateToSupport = () => {
    setActiveTab("support");
  };

  return (
    <div className="flex min-h-screen bg-background desert-gradient">
      <Sidebar />
      <main className="flex-1 md:ml-[17rem] p-4 pt-16 md:pt-8 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold text-slate-900 dark:text-white flex items-center gap-2" data-testid="text-help-support-title">
              <HelpCircle className="w-8 h-8" />
              Help & Support
            </h1>
            <p className="text-slate-500 mt-2">
              Find answers to your questions or get help from our support team.
            </p>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full" data-testid="tabs-help-support">
            <TabsList className="w-full max-w-md overflow-x-auto" data-testid="tabs-list">
              <TabsTrigger value="help" className="flex items-center gap-2 flex-1" data-testid="tab-help">
                <HelpCircle className="w-4 h-4" />
                Help
              </TabsTrigger>
              <TabsTrigger value="support" className="flex items-center gap-2 flex-1" data-testid="tab-support">
                <Headphones className="w-4 h-4" />
                Support
              </TabsTrigger>
            </TabsList>

            <TabsContent value="help" className="mt-6" data-testid="tab-content-help">
              <HelpContent onNavigateToSupport={handleNavigateToSupport} />
            </TabsContent>

            <TabsContent value="support" className="mt-6" data-testid="tab-content-support">
              <SupportContent />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}
