import { Sidebar, useSidebarCollapsed } from "@/components/layout-sidebar";
import { ErrorBoundary } from "@/components/error-boundary";
import { TeamChatPanel } from "@/components/team-chat-panel";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function TeamInboxPage() {
  useDocumentTitle("Team inbox");
  const { isCollapsed } = useSidebarCollapsed();

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <ErrorBoundary>
        <div
          className={`flex flex-1 overflow-hidden h-screen content-spring ${
            isCollapsed ? "md:ml-[76px]" : "md:ml-[17rem]"
          }`}
        >
          <TeamChatPanel />
        </div>
      </ErrorBoundary>
    </div>
  );
}
