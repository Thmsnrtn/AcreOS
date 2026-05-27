import { useState, useEffect, lazy, Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HelpContent } from "@/components/help-content";
import { SupportContent } from "@/components/support-content";
import { Skeleton } from "@/components/ui/skeleton";
import { HelpCircle, Headphones, BookOpen } from "lucide-react";

// Lens 25 #3 — public KB tab. Lazy-loaded so the existing /help shell
// stays light. The same page is also reachable directly at /help/kb
// without going through this tab strip. We pull the inner content
// (no PageShell) so it nests cleanly under this tab; the standalone
// /help/kb route imports the default export which wraps in PageShell.
const KbBrowse = lazy(() =>
  import("@/pages/help/kb").then((m) => ({ default: m.KnowledgeBaseBrowseInner })),
);

type HelpTab = "help" | "kb" | "support";

function isHelpTab(v: string): v is HelpTab {
  return v === "help" || v === "kb" || v === "support";
}

export default function HelpPage() {
  useDocumentTitle("Help & support");
  const [activeTab, setActiveTab] = useState<HelpTab>("help");

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (isHelpTab(hash)) {
      setActiveTab(hash);
    }
  }, []);

  useEffect(() => {
    const newHash = activeTab === "help" ? "" : `#${activeTab}`;
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, "", window.location.pathname + newHash);
    }
  }, [activeTab]);

  const handleNavigateToSupport = () => {
    setActiveTab("support");
  };

  return (
    <PageShell label="Help">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-help-support-title">
          <HelpCircle className="w-8 h-8" />
          Help & Support
        </h1>
        <p className="text-muted-foreground mt-2">
          Find answers to your questions or get help from our support team.
        </p>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => isHelpTab(v) && setActiveTab(v)} className="w-full" data-testid="tabs-help-support">
        <TabsList className="w-full max-w-xl overflow-x-auto" data-testid="tabs-list">
          <TabsTrigger value="help" className="flex items-center gap-2 flex-1" data-testid="tab-help">
            <HelpCircle className="w-4 h-4" />
            Help
          </TabsTrigger>
          <TabsTrigger value="kb" className="flex items-center gap-2 flex-1" data-testid="tab-kb">
            <BookOpen className="w-4 h-4" />
            Knowledge base
          </TabsTrigger>
          <TabsTrigger value="support" className="flex items-center gap-2 flex-1" data-testid="tab-support">
            <Headphones className="w-4 h-4" />
            Support
          </TabsTrigger>
        </TabsList>

        <TabsContent value="help" className="mt-6" data-testid="tab-content-help">
          <HelpContent onNavigateToSupport={handleNavigateToSupport} />
        </TabsContent>

        <TabsContent value="kb" className="mt-6" data-testid="tab-content-kb">
          {/* KbBrowse renders inside its own PageShell when accessed via
              /help/kb; here we mount its inner content. The page handles
              its own header/search so this just nests cleanly. */}
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <KbBrowse />
          </Suspense>
        </TabsContent>

        <TabsContent value="support" className="mt-6" data-testid="tab-content-support">
          <SupportContent />
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}
