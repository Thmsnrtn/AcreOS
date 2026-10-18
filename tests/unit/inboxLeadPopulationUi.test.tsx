// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ api: vi.fn(), book: vi.fn(), toast: vi.fn(), client: null as unknown as QueryClient }));
vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  h.client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, queryFn: async () => [] }, mutations: { retry: false } } });
  return { queryClient: h.client, apiRequest: h.api, fetchJsonArray: h.book };
});
vi.mock("@/components/layout-sidebar", () => ({ Sidebar: () => null, useSidebarCollapsed: () => ({ isCollapsed: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));
vi.mock("@/hooks/use-document-title", () => ({ useDocumentTitle: vi.fn() }));
vi.mock("@/hooks/use-scroll-restoration", () => ({ useScrollRestoration: vi.fn() }));
vi.mock("@/hooks/usePaxNeedsYou", () => ({ usePaxNeedsYouCount: () => ({ count: 0 }) }));
vi.mock("@/components/provider-readiness-banner", () => ({ ProviderReadinessBanner: () => null, ProviderStatusIndicator: () => null }));
vi.mock("@/components/team-chat-panel", () => ({ TeamChatPanel: () => null }));
vi.mock("@/components/native-mail-panel", () => ({ NativeMailPanel: () => null }));
vi.mock("@/components/ContentReveal", () => ({ ContentReveal: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
import InboxPage from "../../client/src/pages/inbox";
const listKey = ["/api/inbox/unified", { isArchived: "false", channel: "all" }];
const conversation = { id: 77, leadId: 9001, lastMessageAt: new Date().toISOString(), unreadCount: 1 };
const lead = { id: 9001, firstName: "Older", lastName: "Contact", phone: "+15555559001" };
let root: Root; let container: HTMLDivElement;
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  vi.resetAllMocks(); h.client.clear();
  h.client.setQueryData(listKey, { emails: [], smsConversations: [conversation] });
  h.client.setQueryData(["/api/inbox/unread-count"], { count: 1 });
  h.book.mockResolvedValue([{ id: 1, firstName: "First", lastName: "Page" }]);
  h.api.mockImplementation(async (method: string, url: string) => method === "GET" && url === "/api/leads/9001" ? response(lead) : response({ ok: true }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); h.client.clear(); container.remove(); });
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function mount() { await act(async () => root.render(<QueryClientProvider client={h.client}><InboxPage /></QueryClientProvider>)); await flush(); }
async function select() { const row = container.querySelector<HTMLDivElement>('[data-testid="sms-conversation-row-77"]'); expect(row).not.toBeNull(); await act(async () => row!.click()); await flush(); }
async function fill(selector: string, value: string) {
  const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("resolves the older contact by ID, supports search and sends the real SMS hook to that ID", async () => {
  await mount();
  expect(h.book).not.toHaveBeenCalled(); expect(h.api).toHaveBeenCalledWith("GET", "/api/leads/9001");
  expect(container.textContent).toContain("Older Contact");
  await fill('[data-testid="input-search-inbox"]', "59001");
  expect(container.querySelector('[data-testid="sms-conversation-row-77"]')).not.toBeNull();
  await select(); await fill('[data-testid="input-sms-message"]', "Reviewed reply");
  const send = container.querySelector<HTMLButtonElement>('[data-testid="button-send-sms"]')!;
  expect(send.disabled).toBe(false); await act(async () => send.click()); await flush();
  expect(h.api).toHaveBeenCalledWith("POST", "/api/leads/9001/sms", { message: "Reviewed reply" });
});
it("retains a typed draft through a contact lookup failure and successful retry", async () => {
  h.api.mockRejectedValue(new Error("503: unavailable"));
  await mount(); await select(); await fill('[data-testid="input-sms-message"]', "Keep this draft");
  expect(container.querySelector('[data-testid="inbox-contact-error"]')).not.toBeNull();
  expect(container.querySelector<HTMLButtonElement>('[data-testid="button-send-sms"]')?.disabled).toBe(true);
  expect(container.textContent).not.toContain("no lead is linked");
  h.api.mockImplementation(async () => response(lead));
  const retry = container.querySelector('[data-testid="inbox-contact-error"]')?.querySelector<HTMLButtonElement>('button');
  expect(retry).toBeDefined(); await act(async () => retry!.click()); await flush();
  expect(container.querySelector<HTMLTextAreaElement>('[data-testid="input-sms-message"]')?.value).toBe("Keep this draft");
  expect(container.querySelector<HTMLButtonElement>('[data-testid="button-send-sms"]')?.disabled).toBe(false);
});
it("keeps an inaccessible identity unavailable, including during search, without inventing deletion", async () => {
  h.api.mockRejectedValue(new Error("404: Lead not found"));
  await mount(); await fill('[data-testid="input-search-inbox"]', "Older");
  expect(container.querySelector('[data-testid="inbox-contact-error"]')?.textContent).toContain("search and replies may be incomplete");
  expect(container.textContent?.toLowerCase()).not.toContain("deleted");
  expect(container.textContent).not.toContain("Older Contact");
  expect(h.book).not.toHaveBeenCalled();
});
it("retains an opened conversation identity when its list window changes", async () => {
  await mount(); await select();
  await act(async () => { h.client.setQueryData(listKey, { emails: [], smsConversations: [] }); });
  expect(container.querySelector('[data-testid="link-to-lead-sms"]')?.getAttribute("href")).toBe("/leads?id=9001");
  expect(h.client.getQueryData(["/api/leads", "by-id", 9001])).toEqual(lead);
});

it("deduplicates email and SMS references without fetching unrelated book rows", async () => {
  h.client.setQueryData(listKey, { emails: [{ id: 5, leadId: 9001, senderName: "Older", senderEmail: "fixture@example.test", subject: "Fixture", bodyText: "Message", receivedAt: conversation.lastMessageAt, isRead: true }], smsConversations: [conversation] });
  await mount();
  expect(h.api.mock.calls.filter(([method]) => method === "GET").map(([, url]) => url)).toEqual(["/api/leads/9001"]);
  expect(h.book).not.toHaveBeenCalled();
});
it("refuses a mismatched returned identity rather than enabling a reply to it", async () => {
  h.api.mockImplementation(async () => response({ ...lead, id: 123 }));
  await mount(); await select();
  expect(container.querySelector('[data-testid="inbox-contact-error"]')).not.toBeNull();
  expect(container.querySelector<HTMLButtonElement>('[data-testid="button-send-sms"]')?.disabled).toBe(true);
  expect(container.querySelector('[data-testid="link-to-lead-sms"]')).toBeNull();
});
