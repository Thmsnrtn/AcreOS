/**
 * htmlToText polynomial-ReDoS regression (CodeQL js/polynomial-redos, high).
 *
 * `EmailService.htmlToText` builds the text fallback for outbound mail
 * whenever a caller passes `html` without `text`. On the campaign path
 * (POST /api/campaigns/:id/send-email) that HTML is the tenant's own
 * composed campaign body with imported lead fields substituted in — i.e.
 * tenant-controlled input on the shared event loop, converted once per
 * recipient. The old implementation stripped style/script blocks and tags
 * with backtracking regexes (`/<style[^>]*>[\s\S]*?<\/style>/gi`,
 * `/<[^>]+>/g`): on repeated UNCLOSED tags the engine retries from every
 * tag start, so conversion was O(n²) — 112 KB of `<style>` repeats took
 * ~2 s, 140 KB of `<style` fragments ~5 s. The fix replaces those three
 * strips with forward-only scans (stripTagBlocks / stripTags in
 * emailService.ts) whose endpoints are exactly the old patterns'.
 *
 * These tests pin (a) byte-identical conversion output on the shapes the
 * old chain handled — every expectation below was produced by running the
 * PRE-FIX implementation — and (b) the pathological inputs completing in
 * near-linear time. The perf bounds are set ~3x under the pre-fix times
 * and orders of magnitude above the fixed times (~5 ms), so they fail on
 * the old code without flaking on a loaded CI box.
 */
import { describe, it, expect, vi } from "vitest";

// Module-load mocks: htmlToText itself is pure string work, but importing
// the service instantiates the singleton — mirror the established mock set
// from emailPurposeEnforcement.test.ts so the import stays hermetic.
vi.mock("../../server/services/trust/ownerSuppression", async () => (await import("../helpers/ownerSuppressionAllowAll")).ownerSuppressionAllowAll);

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send(..._args: unknown[]) {
      return Promise.resolve({ MessageId: "m-1" });
    }
  },
  SendEmailCommand: class {
    constructor(public input: unknown) {}
  },
  SendRawEmailCommand: class {
    constructor(public input: unknown) {}
  },
  GetSendQuotaCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock("../../server/storage", () => ({
  storage: new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "getOrganizationIntegration") return vi.fn().mockResolvedValue(undefined);
        if (prop === "getVerifiedEmailDomains") return vi.fn().mockResolvedValue([]);
        return vi.fn().mockResolvedValue(undefined);
      },
    },
  ),
  db: {},
}));

vi.mock("../../server/services/orgEmailIdentity", () => ({
  getIdentityForSend: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../server/services/fieldEncryption", () => ({
  decryptJsonCredentials: vi.fn().mockReturnValue({
    accessKeyId: "org-key",
    secretAccessKey: "org-secret",
    fromEmail: "deals@customer-domain.com",
  }),
}));

vi.mock("../../server/services/emailSuppressions", () => ({
  filterSuppressed: vi.fn(async (addrs: string[]) => ({ allowed: addrs, suppressed: [] })),
  isSuppressed: vi.fn().mockResolvedValue(false),
}));

vi.mock("../../server/services/emailWarmup", () => ({
  reserveSend: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../../server/services/unsubscribeTokens", () => ({
  issueToken: vi.fn().mockResolvedValue("tok"),
  buildUnsubscribeUrl: vi.fn().mockReturnValue("https://acreos.io/u/tok"),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { emailService } from "../../server/services/emailService";

const htmlToText = (html: string): string =>
  (emailService as unknown as { htmlToText(h: string): string }).htmlToText(html);

describe("htmlToText — conversion behavior preserved", () => {
  const cases: Array<[string, string, string]> = [
    // [name, input, expected output of the PRE-FIX implementation]
    ["style block removed", "<style>body{color:red}</style><p>Hello</p>", "Hello"],
    ["style with attributes", '<style type="text/css">.a{}</style>Text', "Text"],
    ["case-insensitive tags", "<STYLE>.a{}</STYLE>Text", "Text"],
    ["script block removed", "<script>alert(1)</script><p>Hi</p>", "Hi"],
    ["unclosed style removes no block", "A<style>B", "AB"],
    ["nested open tags end at first close", "<style><style></style></style>X", "X"],
    ["spaced close is not a close", "<style>a</style >b", "ab"],
    ["> inside style content", "<style>a>b</style>c", "c"],
    ["two style blocks", "<style>1</style>A<style>2</style>B", "AB"],
    ["paragraphs become blank lines", "<p>One</p><p>Two</p>", "One\n\nTwo"],
    [
      "media-query style + br",
      '<style media="screen and (max-width:600px)">p{margin:0}</style>Body<br>Line2',
      "Body\nLine2",
    ],
    ["unterminated style tag still strips as a tag", "<style>unterminated", "unterminated"],
    ["empty angle pair is kept", "a<>b", "a<>b"],
    ["div and list structure", "<div>line</div><ul><li>one</li><li>two</li></ul>", "line\n- one\n- two"],
    ["entities decoded", '<p>Tom &amp; Jerry &lt;3 &quot;hi&quot;&nbsp;end</p>', 'Tom & Jerry <3 "hi" end'],
    [
      "representative campaign email",
      "<html><head><style>@media only screen and (max-width:620px){.c{width:100%}}</style></head>" +
        "<body><p>Hi {{firstName}},</p><p>Your parcel in <b>Travis County</b> has a new document.</p>" +
        "<script>track()</script></body></html>",
      "Hi {{firstName}},\n\nYour parcel in Travis County has a new document.",
    ],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(htmlToText(input)).toBe(expected);
    });
  }
});

describe("htmlToText — pathological inputs complete fast", () => {
  const PERF_BUDGET_MS = 1500;
  const TEST_TIMEOUT_MS = 20000;

  function expectFast(name: string, input: string, expected: string) {
    it(
      name,
      () => {
        const t0 = performance.now();
        const out = htmlToText(input);
        const elapsed = performance.now() - t0;
        expect(out).toBe(expected);
        expect(elapsed).toBeLessThan(PERF_BUDGET_MS);
      },
      TEST_TIMEOUT_MS,
    );
  }

  // Pre-fix: ~4 s (style-strip retries from every unclosed tag start).
  expectFast("repeated unclosed <style> tags", "<style>".repeat(20000), "");
  // Pre-fix: same quadratic curve through the script pattern.
  expectFast("repeated unclosed <script> tags", "<script>".repeat(20000), "");
  // Pre-fix: ~5 s (generic tag strip rescans the tail from every `<`).
  expectFast("repeated <style fragments with no > anywhere", "<style".repeat(20000), "<style".repeat(20000));
  // One real close at the very end: the first open pairs with it, so the
  // whole run is one block — removed, as the old lazy pattern removed it.
  expectFast("many opens, single close at end", "<style>".repeat(5000) + "</style>", "");
});
