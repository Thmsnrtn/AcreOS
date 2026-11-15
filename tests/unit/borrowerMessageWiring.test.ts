/**
 * S-05 (P1-4b) — borrower messages, wired end-to-end, pinned by source.
 *
 * The defect class (silent starvation): the borrower's write path and the
 * lender's read routes both existed, but nothing connected them — no client
 * called the lender routes and the borrower's POST notified no one. These
 * pins fail if any leg of the wire is removed:
 *   borrower POST → message row → lender notification (notify service)
 *   lender surface → note-detail panel → thread / unread-count / reply routes
 *   in-app row → notification-center entity link → the note
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripComments, REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));

describe("S-05 wire: borrower send notifies the lender", () => {
  it("the borrower POST writes the row first, then notifies the note's org", () => {
    const src = read("server/routes-borrower.ts");
    const postAt = src.indexOf('api.post("/api/borrower/messages"');
    expect(postAt).toBeGreaterThan(-1);
    const writeAt = src.indexOf("storage.createBorrowerMessage(", postAt);
    const notifyAt = src.indexOf("notifyLenderOfBorrowerMessage(", postAt);
    expect(writeAt).toBeGreaterThan(postAt);
    expect(notifyAt).toBeGreaterThan(writeAt);
    // The notification is scoped to the note's own org, never the session's
    // claim alone — the row and the notice share one org expression.
    const call = src.slice(notifyAt, src.indexOf("res.status(201)", notifyAt));
    expect(call).toContain("orgId: note.organizationId");
    expect(call).toContain("noteId: session.noteId");
    expect(call).toContain("messageId: msg.id");
  });

  it("the notify service fans out on both legs: mute-gated push + preference-gated in-app row", () => {
    const src = read("server/services/borrowerMessageNotify.ts");
    expect(src).toContain('family: "borrower_message"');
    expect(src).toContain("pushOrgEvent(notice.orgId");
    expect(src).toContain("shouldNotify(");
    expect(src).toContain('BORROWER_MESSAGE_EVENT_ID = "finance.borrower_message"');
    expect(src).toContain("storage.createNotification(");
    expect(src).toContain('entityType: "note"');
  });
});

describe("S-05 wire: the lender surface calls the lender routes", () => {
  it("the panel calls thread, unread-count and reply, and is mounted on the note page", () => {
    const panel = read("client/src/components/notes/BorrowerMessagesPanel.tsx");
    expect(panel).toContain("/borrower-messages`");
    expect(panel).toContain("/borrower-messages/unread-count`");
    expect(panel).toContain("/borrower-messages/reply`");
    const page = read("client/src/pages/note-detail.tsx");
    expect(page).toContain("BorrowerMessagesPanel");
    expect(page).toContain("<BorrowerMessagesPanel noteId={note.id} />");
  });

  it("the lender routes the panel calls exist server-side", () => {
    const admin = read("server/routes-admin.ts");
    expect(admin).toContain('api.get("/api/notes/:noteId/borrower-messages"');
    expect(admin).toContain('api.post("/api/notes/:noteId/borrower-messages/reply"');
    expect(admin).toContain('api.get("/api/notes/:noteId/borrower-messages/unread-count"');
  });

  it("the notification center links a note entity to the note page", () => {
    const center = read("client/src/components/notification-center.tsx");
    expect(center).toContain('notification.entityType === "note"');
    expect(center).toContain("/notes/${notification.entityId}");
  });
});
