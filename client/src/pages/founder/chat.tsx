/**
 * /founder — Atlas chat shell.
 *
 * Phase C deliverable. Replaces the legacy tile-driven Now-surface as
 * the default founder landing. Layout:
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ FounderChatHeader     ☰   Atlas — Daily check-in   [Dashboard] │
 *   ├──────────┬─────────────────────────────────────────────────────┤
 *   │ Threads  │                                                     │
 *   │  • Daily │   <MessageList — virtualized, role=log>              │
 *   │  • Q3    │                                                     │
 *   │  + new   │                                                     │
 *   │          ├─────────────────────────────────────────────────────┤
 *   │          │   <Composer — textarea, /-popover, send>            │
 *   └──────────┴─────────────────────────────────────────────────────┘
 *                                              [FounderMobileBottomNav]
 *
 * The morning brief (Phase E) renders as the FIRST message in the
 * default thread each day — it composes the same bucket / net-negative
 * / scale-up data that Now-surface tiles show today, but inline in the
 * chat instead of as a separate dashboard surface.
 *
 * "View dashboard" in the header opens /founder/dashboard which still
 * shows the legacy tile layout (LegacyNowSurface) — handy during the
 * transition, deprecated in Phase F.
 */
import { useState } from "react";
import { Link } from "wouter";
import { Menu, ExternalLink, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useFounderChat } from "@/hooks/use-founder-chat";
import { useFounderChatThreads } from "@/hooks/use-founder-chat-threads";
import { Composer } from "@/components/founder-chat/Composer";
import { MessageList } from "@/components/founder-chat/MessageList";
import { ThreadSidebar } from "@/components/founder-chat/ThreadSidebar";
import { PersonaSheet } from "@/components/persona-sheet";
import { usePersonaMode } from "@/hooks/use-persona-mode";
import { TOUCH_TARGET_PT } from "@/lib/spacing";

export default function FounderChatPage() {
  useDocumentTitle("Atlas — founder chat");
  const { threads } = useFounderChatThreads();
  const defaultThreadId =
    threads.find((t) => t.isDefault)?.id ?? threads[0]?.id ?? "default";
  const [activeThreadId, setActiveThreadId] = useState<string>(defaultThreadId);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [personaSheetOpen, setPersonaSheetOpen] = useState(false);
  const { mode: personaMode } = usePersonaMode();

  const {
    messages,
    sendMessage,
    isStreaming,
    activeToolCalls,
    status,
  } = useFounderChat(activeThreadId);

  const activeThread = threads.find((t) => t.id === activeThreadId);
  const headerTitle = activeThread?.isDefault
    ? "Atlas — Daily check-in"
    : activeThread?.title ?? "Atlas";

  return (
    // Container is locked to the viewport minus the founder mobile nav
    // (h-16 on mobile, hidden md+). We use a CSS calc so the chat fills
    // the rest of the screen and only the MessageList scrolls — the
    // Composer stays pinned to the bottom on every breakpoint.
    <div
      className="flex h-[100dvh] md:h-screen w-full overflow-hidden bg-background pb-16 md:pb-0"
      data-testid="founder-chat-shell"
    >
      <ThreadSidebar
        activeThreadId={activeThreadId}
        onSelect={(id) => {
          setActiveThreadId(id);
          setMobileSidebarOpen(false);
        }}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Header */}
        <header className="flex flex-col gap-1.5 px-3 sm:px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              className="md:hidden h-8 w-8"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open thread list"
              data-testid="header-open-sidebar"
            >
              <Menu className="w-4 h-4" aria-hidden="true" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-semibold truncate" data-testid="header-title">
                {headerTitle}
              </h1>
              {isStreaming && (
                <p className="text-micro text-acr-brand" aria-live="polite">
                  streaming…
                </p>
              )}
            </div>
            <Button
              size="sm"
              variant="ghost"
              asChild
              className="text-xs gap-1.5"
              data-testid="header-view-dashboard"
            >
              <Link href="/founder/dashboard" aria-label="View legacy dashboard">
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">View dashboard</span>
                <span className="sm:hidden">Dashboard</span>
              </Link>
            </Button>
          </div>
          {/* Mode chip — mobile-only. Tap opens the persona sheet. The
              desktop header has the full PersonaSwitcher dropdown in the
              PageTopbar, so we don't double up on md+. */}
          <button
            type="button"
            onClick={() => setPersonaSheetOpen(true)}
            aria-label={`Switch mode. Currently ${personaMode === "founder" ? "Founder" : "Customer"} mode.`}
            data-testid="chat-header-persona-chip"
            style={{ minHeight: TOUCH_TARGET_PT }}
            className="md:hidden self-start inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 text-caption font-medium text-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="text-muted-foreground">Mode:</span>
            <span>{personaMode === "founder" ? "Founder" : "Customer"}</span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          </button>
        </header>

        <PersonaSheet open={personaSheetOpen} onOpenChange={setPersonaSheetOpen} />

        {/* Messages */}
        <MessageList
          messages={messages}
          isStreaming={isStreaming}
          activeToolCalls={activeToolCalls}
        />

        {/* Composer */}
        <Composer
          onSubmit={sendMessage}
          disabled={status === "submitting"}
        />
      </div>
    </div>
  );
}
