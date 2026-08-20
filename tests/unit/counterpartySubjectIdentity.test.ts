/**
 * BYO send rails, applied to the SUBJECT LINE (founder decision 2026-07-17).
 *
 * THE DEFECT THIS GATE EXISTS FOR. `CommunicationsService.sendToLead` sent
 * deal mail with:
 *
 *     subject: options.subject || 'Message from AcreOS'
 *
 * on a call that also passes `purpose: 'counterparty'`. The live caller —
 * POST /api/communications/send (server/routes-core-ai.ts) — reads `subject`
 * straight from the request body, where it is optional. So a send with no
 * subject put OUR name in the first thing the recipient reads, on a message
 * the CUSTOMER is sending to their own seller. The sender-identity enforcement
 * in emailService could never catch it: that guard governs credentials, the
 * From: display name and the CAN-SPAM footer — not body or header TEXT.
 *
 * The lane gates that already existed all supplied an explicit subject, so the
 * defaulting branch was never executed by a test. These cases execute it.
 *
 * WHY BEHAVIOURAL, NOT A SOURCE SCAN. "the string 'Message from AcreOS' is
 * gone from communications.ts" is the wrong proposition — the platform brand
 * can return through a renamed constant, an env value, a helper, or a
 * different default expression. What matters is what lands in the `subject`
 * field handed to `emailService.sendEmail` on the counterparty lane, so that
 * is what every case below reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { stripCommentsPreservingLines } from "../../scripts/lib/strip-comments.mjs";

const ROOT = path.resolve(__dirname, "../..");

const sendEmail = vi.fn();
vi.mock("../../server/services/emailService", () => ({
  emailService: { sendEmail: (opts: unknown) => sendEmail(opts) },
}));

const state = {
  org: null as null | { id: number; name?: string | null },
  lead: {
    id: 7,
    organizationId: 42,
    firstName: "Lee",
    email: "seller@example.com",
    phone: null as string | null,
  },
};
const createLeadActivity = vi.fn();
vi.mock("../../server/storage", () => ({
  storage: {
    getLead: async () => state.lead,
    getOrganization: async () => state.org,
    createLeadActivity: (row: unknown) => createLeadActivity(row),
  },
}));

vi.mock("../../server/services/tcpaCompliance", () => ({
  checkTcpaConsentFromLead: () => ({ blocked: false }),
  checkTcpaConsent: async () => ({ blocked: false, canSms: true }),
  canSendViaChannel: () => ({ allowed: true }),
}));

vi.mock("../../server/services/compliance/contactFrequency", () => ({
  frequencyGateForLead: async () => ({ allowed: true }),
  describeFrequencySkip: () => "frequency",
}));

vi.mock("../../server/services/smsService", () => ({
  smsService: { isConfigured: () => false },
  sendOrgSMS: async () => ({ success: false }),
}));

vi.mock("../../server/services/lobService", () => ({
  lobService: {
    sendLetter: async () => ({ success: false, isTestMode: true }),
    isConfiguredForOrg: async () => false,
  },
  LobErrorType: {},
}));

vi.mock("../../server/services/actions/outwardAction", () => ({
  classifyExisting: () => "execute",
  requestHash: () => "hash",
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { communicationsService } from "../../server/services/communications";

const BASE = { leadId: 7, organizationId: 42, channel: "email" as const, message: "Are you selling?" };

beforeEach(() => {
  vi.clearAllMocks();
  sendEmail.mockResolvedValue({ success: true, messageId: "m-1" });
  state.org = { id: 42, name: "Brazos Land Partners" };
});

/** The options object handed to emailService for the one send under test. */
function sentOptions(): Record<string, any> {
  expect(sendEmail).toHaveBeenCalledTimes(1);
  return sendEmail.mock.calls[0][0] as Record<string, any>;
}

describe("VACUITY — this harness really does reach emailService on the counterparty lane", () => {
  it("an explicit subject is passed through verbatim, on the counterparty lane", async () => {
    // Without this control every "the subject is not 'Message from AcreOS'"
    // assertion below could pass on a send that never happened.
    const result = await communicationsService.sendToLead({ ...BASE, subject: "Your 40 acres on FM 2147" });

    expect(result.success).toBe(true);
    expect(sentOptions().subject).toBe("Your 40 acres on FM 2147");
    expect(sentOptions().purpose).toBe("counterparty");
  });
});

describe("a counterparty send with NO subject never names the platform", () => {
  it("falls back to the SENDING ORG's own name", async () => {
    const result = await communicationsService.sendToLead({ ...BASE });

    expect(result.success).toBe(true);
    expect(sentOptions().subject).toBe("Message from Brazos Land Partners");
    // Unanchored and case-insensitive on purpose: the defect is "our identity
    // on their mail", and it does not care which spelling it arrives in.
    expect(sentOptions().subject).not.toMatch(/acreos/i);
  });

  it("a whitespace-only subject is treated as absent, not sent as-is", async () => {
    // The old `options.subject || …` accepted "   " as a subject. An empty
    // subject line is its own defect, and a gate that only checked `undefined`
    // would miss the equivalent representation.
    await communicationsService.sendToLead({ ...BASE, subject: "   " });

    expect(sentOptions().subject).toBe("Message from Brazos Land Partners");
  });

  it("REFUSES when the org has no name on file — it never invents a sender", async () => {
    // Refuse, never fabricate. A generic subject would be a made-up sender
    // identity on a real person's inbox, which is worse than an unsent email.
    state.org = { id: 42, name: "  " };

    const result = await communicationsService.sendToLead({ ...BASE });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/subject/i);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("REFUSES when the org row cannot be read at all", async () => {
    state.org = null;

    const result = await communicationsService.sendToLead({ ...BASE });

    expect(result.success).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("records the subject that was ACTUALLY SENT, not the caller's absent one", async () => {
    // The activity row is the durable account of what the counterparty
    // received; logging `undefined` there would leave no record of the line
    // that went out under the customer's name.
    await communicationsService.sendToLead({ ...BASE });

    expect(createLeadActivity).toHaveBeenCalledTimes(1);
    const row = createLeadActivity.mock.calls[0][0] as Record<string, any>;
    expect(row.metadata.subject).toBe("Message from Brazos Land Partners");
  });
});

// ─── No platform-branded fallback anywhere on the counterparty lane ──────────

describe("no counterparty send falls back to an AcreOS literal", () => {
  /**
   * A POPULATION rule, not a per-site one, and that is the point.
   *
   * Three sites carried the identical shape and were found one at a time:
   * `communications.ts` (`subject: options.subject || 'Message from AcreOS'`),
   * `routes-campaigns.ts` (the same default, in a per-lead blast loop — the
   * higher-volume surface, and the one still live after the first two were
   * fixed), and `routes-deal-rooms.ts` (`— ${org?.name ?? 'AcreOS'} Team`
   * signing a customer's invitation to the other side of their own deal).
   *
   * Fixing them individually leaves the fourth to be found the same way. What
   * this asserts instead is that a fallback expression yielding an
   * AcreOS-bearing literal cannot sit near a `purpose: 'counterparty'` send at
   * all — so a new counterparty surface written in the same shape fails here
   * rather than shipping our name on a customer's mail.
   */
  const SRC_DIRS = ["server"];
  const FALLBACK_TO_ACREOS = /(\|\||\?\?)\s*[`'"][^`'"\n]*AcreOS/;
  /** How far above a counterparty send a fallback still counts as feeding it. */
  const WINDOW = 40;

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        out.push(...walk(rel));
      } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
        out.push(rel);
      }
    }
    return out;
  }

  function counterpartySites(): Array<{ file: string; line: number; window: string }> {
    const sites: Array<{ file: string; line: number; window: string }> = [];
    for (const rel of SRC_DIRS.flatMap(walk)) {
      const raw = fs.readFileSync(path.join(ROOT, rel), "utf8");
      if (!raw.includes("counterparty")) continue;
      const lines = stripCommentsPreservingLines(raw).split("\n");
      lines.forEach((line, i) => {
        if (!/purpose:\s*['"]counterparty['"]/.test(line)) return;
        sites.push({
          file: rel,
          line: i + 1,
          window: lines.slice(Math.max(0, i - WINDOW), i + 5).join("\n"),
        });
      });
    }
    return sites;
  }

  it("VACUITY: the scan finds real counterparty send sites", () => {
    // Without this, "no offenders" is satisfied by a walker that read nothing.
    const sites = counterpartySites();
    expect(sites.length, "no `purpose: 'counterparty'` sites found at all").toBeGreaterThan(3);
    const files = new Set(sites.map((s) => s.file));
    expect(files.has("server/services/communications.ts")).toBe(true);
  });

  it("VACUITY: the matcher recognises the shape that shipped", () => {
    // The three real offenders, verbatim. If the regex stopped matching these,
    // the rule below would pass over a repo full of them.
    expect(FALLBACK_TO_ACREOS.test(`const s = a || "Message from AcreOS";`)).toBe(true);
    expect(FALLBACK_TO_ACREOS.test("`— ${org?.name ?? 'AcreOS'} Team`")).toBe(true);
    // And does NOT match an ordinary org-name fallback with no AcreOS in it.
    expect(FALLBACK_TO_ACREOS.test(`const s = a || campaign.name;`)).toBe(false);
  });

  it("finds none", () => {
    const offenders = counterpartySites()
      .filter((s) => FALLBACK_TO_ACREOS.test(s.window))
      .map((s) => `${s.file}:${s.line}`);

    expect(
      offenders,
      "a counterparty send has a fallback to a literal containing 'AcreOS' within " +
        `${WINDOW} lines above it. Counterparty mail carries the CUSTOMER's identity — ` +
        "the platform sender is for system mail only (founder decision 2026-07-17). " +
        "Use the org's own name, or refuse: an unsigned message is honest, a " +
        "misattributed one is not.",
    ).toEqual([]);
  });
});
