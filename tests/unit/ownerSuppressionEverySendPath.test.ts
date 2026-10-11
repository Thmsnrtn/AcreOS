/**
 * OWNER OPT-OUT — every outreach path honours the platform-wide suppression.
 *
 * A property owner who asks AcreOS to stop contacting them (W5a, the public
 * opt-out form) must not be reached by ANY org through ANY channel: mail,
 * email, SMS, voice, skip-trace, or a list import that brings them back in.
 *
 * THE POPULATION IS ENUMERATED, NOT ASSUMED (CLAUDE.md third law). The helper
 * (tests/helpers/ownerSendPaths.ts) PARSES every non-test server file and
 * finds every vendor-boundary shape — the Twilio Messages/Calls URLs, carrier
 * dispatch, SES commands, Gmail/Graph send endpoints, Lob creates, PostGrid
 * paths, skip-trace hosts, and every `.insert(leads)` (alias-aware). Each
 * occurrence must be REGISTERED below with its channel and exact count, and
 * must be GUARDED — a guard called before the shape in the same unit — or
 * carry a dated exemption. So:
 *   - a new send path anywhere in server/ that skips the guard is red;
 *   - a registered member whose shape the parser stops finding is red
 *     (per-member vacuity, both directions);
 *   - the total population and per-channel floors catch a scanner gone blind.
 * The canaries at the bottom prove each unit-boundary rule the scanner relies
 * on goes red when the defect is hidden in it.
 *
 * Behaviour (that a guard actually REFUSES) is proven separately, against the
 * real chokepoints, in ownerSuppressionRefuses.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";
import { scanServerForShapes, scanSourceForShapes, type OwnerChannel } from "../helpers/ownerSendPaths";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

type Member = { channel: OwnerChannel; count: number; exempt?: string };

/** file → its shapes. Keyed by file + channel; counts are exact. */
const REGISTER: Record<string, Member[]> = {
  // ── SMS / voice: the carrier adapter AND the router that dispatches to it.
  "server/services/comms/router.ts": [{ channel: "sms", count: 1 }, { channel: "voice", count: 1 }],
  "server/services/comms/providers/twilio.ts": [{ channel: "sms", count: 1 }, { channel: "voice", count: 1 }],
  // ── Email: SES (every system and counterparty send), the org's own
  //    Gmail/Outlook mailbox, and the Gmail connector.
  "server/services/emailService.ts": [{ channel: "email", count: 1 }],
  "server/services/mailbox/mailboxClient.ts": [{ channel: "email", count: 3 }],
  "server/services/connectors/executor.ts": [{ channel: "email", count: 1 }],
  "server/routes-integrations.ts": [
    {
      channel: "email",
      count: 1,
      exempt:
        "2026-10-11: SendGrid credential test — sandboxMode enabled, addressed to test@example.com; nothing is delivered to anyone.",
    },
  ],
  // ── Physical mail: every Lob client and PostGrid.
  "server/services/directMail.ts": [{ channel: "mail", count: 2 }],
  "server/services/directMailService.ts": [{ channel: "mail", count: 2 }],
  "server/services/lobService.ts": [{ channel: "mail", count: 2 }],
  "server/services/mailProvider.ts": [{ channel: "mail", count: 2 }],
  "server/services/mail/providers/postgrid.ts": [{ channel: "mail", count: 2 }],
  // ── Skip-trace vendors.
  "server/services/skipTracingService.ts": [{ channel: "skip_trace", count: 2 }],
  "server/services/providers/batchdata-provider.ts": [{ channel: "skip_trace", count: 1 }],
  // ── List import: every lead write stamps matching rows do-not-contact.
  "server/storage/leadRepo.ts": [{ channel: "list_import", count: 2 }],
  "server/routes-leads.ts": [{ channel: "list_import", count: 1 }],
  "server/services/taxDelinquentPipeline.ts": [{ channel: "list_import", count: 1 }],
  "server/api-v1/leads.ts": [{ channel: "list_import", count: 1 }],
  "server/services/metaAdsService.ts": [{ channel: "list_import", count: 1 }],
  "server/routes-drive-mode.ts": [{ channel: "list_import", count: 1 }],
  "server/jobs/autonomousDealMachine.ts": [{ channel: "list_import", count: 1 }],
  "server/services/onboardingEnhancements.ts": [
    {
      channel: "list_import",
      count: 1,
      exempt: "2026-10-11: three fixed sample rows (\"Sample Lead A/B/C\") with no email, phone or mailing address — nothing an opt-out could match.",
    },
  ],
};

/** Vacuity floors, measured 2026-10-11: 1,492 files, 33 shapes (Graph /reply added by the W5a audit). */
const FILE_FLOOR = 1200;
const SHAPE_FLOOR = 28;
const CHANNELS: OwnerChannel[] = ["sms", "voice", "email", "mail", "skip_trace", "list_import"];

describe("owner opt-out: the send-path population", () => {
  const { files, hits } = scanServerForShapes();

  it("vacuity: the scan read the server and found send paths in every channel", () => {
    expect(files, "the server walk read implausibly few files").toBeGreaterThanOrEqual(FILE_FLOOR);
    expect(hits.length, "the scanner found implausibly few send shapes").toBeGreaterThanOrEqual(SHAPE_FLOOR);
    for (const ch of CHANNELS) {
      expect(hits.filter((h) => h.channel === ch).length, `no ${ch} send path found — the scanner went blind to it`).toBeGreaterThan(0);
    }
  });

  it("every send shape is registered — a new send path is a red test", () => {
    const unregistered = hits
      .filter((h) => !(REGISTER[h.file] ?? []).some((m) => m.channel === h.channel))
      .map((h) => `${h.file}#${h.unit}:${h.line} (${h.channel})`);
    expect(
      unregistered,
      "unregistered outreach path(s). Call assertOwnerContactAllowed / ownerContactRefusal (sends) or " +
        "stampOwnerSuppression (lead writes) from server/services/trust/ownerSuppression.ts before the vendor call, then register it here.",
    ).toEqual([]);
  });

  it("per-member vacuity: every registered member is found exactly as often as registered", () => {
    const wrong: string[] = [];
    for (const [file, members] of Object.entries(REGISTER)) {
      for (const m of members) {
        const n = hits.filter((h) => h.file === file && h.channel === m.channel).length;
        if (n !== m.count) wrong.push(`${file} ${m.channel}: registered ${m.count}, found ${n}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("every non-exempt send shape is guarded before the vendor is reached", () => {
    const unguarded = hits
      .filter((h) => !h.guarded)
      .filter((h) => !(REGISTER[h.file] ?? []).some((m) => m.channel === h.channel && m.exempt))
      .map((h) => `${h.file}#${h.unit}:${h.line} (${h.channel})`);
    expect(unguarded, "send path(s) that reach a vendor without checking the owner opt-out list").toEqual([]);
  });

  it("an exemption is not a hiding place: exempt members really are unguarded, and carry a dated reason", () => {
    for (const [file, members] of Object.entries(REGISTER)) {
      for (const m of members.filter((x) => x.exempt)) {
        expect(m.exempt, `${file}: exemption needs a dated reason`).toMatch(/^\d{4}-\d{2}-\d{2}: .{20,}/);
        const n = hits.filter((h) => h.file === file && h.channel === m.channel && !h.guarded).length;
        expect(n, `${file}: exempt but now guarded — drop the exemption`).toBe(m.count);
      }
    }
  });
});

describe("owner opt-out scanner canaries — each unit-boundary rule goes red on its hidden defect", () => {
  const IMPORTS = `import { leads as people } from "@shared/schema";\n`;

  it("a guard in the same unit before the shape passes", () => {
    const hits = scanSourceForShapes(
      "canary.ts",
      `async function send(c: any, to: string) { await assertOwnerContactAllowed("mail", {}); await c.letters.create({ to }); }`,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].guarded).toBe(true);
  });

  it("a guard AFTER the shape does not count", () => {
    const [h] = scanSourceForShapes("canary.ts", `async function send(c: any) { await c.postcards.create({}); await assertOwnerContactAllowed("mail", {}); }`);
    expect(h.guarded).toBe(false);
  });

  it("a guard in a SIBLING route handler does not count", () => {
    const [h] = scanSourceForShapes(
      "canary.ts",
      `${IMPORTS}export function reg(app: any) {
        app.post("/a", async () => { await stampOwnerSuppression([]); });
        app.post("/b", async () => { await db.insert(people).values({}); });
      }`,
    );
    expect(h.channel).toBe("list_import");
    expect(h.unit).toBe("post /b");
    expect(h.guarded).toBe(false);
  });

  it("a guard mentioned only in a comment does not count", () => {
    const [h] = scanSourceForShapes("canary.ts", `async function f(t: string) {\n // await ownerContactRefusal("sms", {})\n return fetch(\`https://api.twilio.com/x/Messages.json\`); }`);
    expect(h.channel).toBe("sms");
    expect(h.guarded).toBe(false);
  });

  it("a callback (withRetry / transaction / map) is climbed through to its real unit", () => {
    const [h] = scanSourceForShapes(
      "canary.ts",
      `async function send(o: any) { await ownerContactRefusal("email", {}); return retry(async () => new SendRawEmailCommand(o)); }`,
    );
    expect(h.unit).toBe("send");
    expect(h.guarded).toBe(true);
  });

  it("an aliased leads table is still a lead write", () => {
    const hits = scanSourceForShapes("canary.ts", `${IMPORTS}async function f() { await db.insert(people).values({}); }`);
    expect(hits.map((h) => h.channel)).toEqual(["list_import"]);
  });

  it("a Graph reply (the whole template segment) is an email send; a route path ending /reply is not", () => {
    const hits = scanSourceForShapes(
      "canary.ts",
      `export function reg(app: any) { app.post("/api/leads/:id/emails/reply", async () => {}); }
       async function reply(t: string, id: string) { await fetch(\`https://graph.microsoft.com/v1.0/me/messages/\${id}/reply\`, {}); }`,
    );
    expect(hits.map((h) => [h.channel, h.unit, h.guarded])).toEqual([["email", "reply", false]]);
  });

  it("a cast Lob client (`(lob.letters as any).create`) is still mail", () => {
    const hits = scanSourceForShapes("canary.ts", `async function f(lob: any) { await (lob.letters as any).create({}); }`);
    expect(hits.map((h) => h.channel)).toEqual(["mail"]);
  });

  it("the wrong guard for the channel does not count (a send guard does not stamp an import)", () => {
    const [h] = scanSourceForShapes("canary.ts", `${IMPORTS}async function f() { await ownerContactRefusal("email", {}); await db.insert(people).values({}); }`);
    expect(h.guarded).toBe(false);
  });
});
