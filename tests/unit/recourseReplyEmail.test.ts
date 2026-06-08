/**
 * Recourse Loop — send-flow email contract (Rafe).
 *
 * The send half of the loop delivers the founder's final (edited) reply via the
 * lifecycle-email registry's `recourse_reply` kind. These tests pin the
 * load-bearing properties of that kind:
 *   - transactional (always sends — never blocked by a marketing opt-out)
 *   - renders the founder's EXACT words (no template framing layered on)
 *   - personal subject + greeting; no marketing chrome.
 *
 * The render function is pure; we mock the registry's side-effect deps (db,
 * emailService, suppressions) so importing the module doesn't touch I/O.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: { insert: () => ({ values: async () => {} }) } }));
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: vi.fn(async () => ({ success: true })) },
}));
vi.mock("../../server/services/emailSuppressions", () => ({
  isSuppressed: vi.fn(async () => false),
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("recourse_reply email kind", () => {
  it("is transactional (always sends — not gated by marketing opt-out)", async () => {
    const { EMAIL_KINDS } = await import("../../server/services/emailRegistry");
    expect(EMAIL_KINDS.recourse_reply.category).toBe("transactional");
  });

  it("renders the founder's exact words and a personal subject", async () => {
    const { EMAIL_KINDS } = await import("../../server/services/emailRegistry");
    const body =
      "Hi Dana — your county data being wrong is on me. I've pulled that source and I'll confirm the fix on your parcel tomorrow. — Tom";
    const { subject, html } = EMAIL_KINDS.recourse_reply.render({
      firstName: "Dana",
      body,
    });

    // Personal subject — a human reaching out, not a system notice.
    expect(subject).toBe("A note from AcreOS");
    expect(subject).not.toContain("[");

    // The founder's exact words survive into the rendered HTML.
    expect(html).toContain("county data being wrong is on me");
    expect(html).toContain("confirm the fix on your parcel");
    // Greeting uses the first name.
    expect(html).toContain("Hi Dana,");
  });

  it("greets generically when no first name is known", async () => {
    const { EMAIL_KINDS } = await import("../../server/services/emailRegistry");
    const { html } = EMAIL_KINDS.recourse_reply.render({
      body: "Thanks for the honest feedback. — Tom",
    });
    expect(html).toContain("Hi there,");
  });
});
