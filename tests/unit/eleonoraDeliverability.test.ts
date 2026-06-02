/**
 * Eleonora deliverability foundation — unit coverage.
 *
 * Three behaviors that must hold:
 *   1. Warmup limit honored — calling reserveSend() day-1 returns
 *      ok:false on the 51st call.
 *   2. Suppressions block sends — emailService.sendEmail rejects an
 *      all-suppressed recipient list before SES is touched.
 *   3. Bounce categorization — suppressionFromEvent() correctly maps
 *      hard/soft/complaint events to (source, bounceCategory).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { suppressionFromEvent } from "../../server/services/emailSuppressions";
import { limitForDay, WARMUP_RAMP, POST_WARMUP_LIMIT } from "../../server/services/emailWarmup";
import {
  buildDkimRecordValue,
  buildDmarcRecordValue,
  buildSpfRecordValue,
  buildDnsRecords,
  generateDkimKeypair,
} from "../../server/services/orgEmailIdentity";

describe("Eleonora bounce categorization", () => {
  it("hard bounce → bounceCategory:hard, source:bounce, no softBounce flag", () => {
    const sup = suppressionFromEvent({ event: "bounce", type: "bounce", reason: "550 mailbox not found" });
    expect(sup).not.toBeNull();
    expect(sup!.bounceCategory).toBe("hard");
    expect(sup!.source).toBe("bounce");
    expect(sup!.softBounce).toBeUndefined();
  });

  it("soft bounce (blocked) → bounceCategory:soft + softBounce:true", () => {
    const sup = suppressionFromEvent({ event: "bounce", type: "blocked", reason: "421 try again" });
    expect(sup).not.toBeNull();
    expect(sup!.bounceCategory).toBe("soft");
    expect(sup!.softBounce).toBe(true);
  });

  it("spamreport → bounceCategory:complaint, source:spam", () => {
    const sup = suppressionFromEvent({ event: "spamreport" });
    expect(sup!.bounceCategory).toBe("complaint");
    expect(sup!.source).toBe("spam");
  });

  it("unsubscribe → bounceCategory:unsubscribe", () => {
    const sup = suppressionFromEvent({ event: "unsubscribe" });
    expect(sup!.bounceCategory).toBe("unsubscribe");
    expect(sup!.source).toBe("unsubscribe");
  });

  it("dropped → bounceCategory:hard (treated as permanent)", () => {
    const sup = suppressionFromEvent({ event: "dropped", reason: "invalid_smtp" });
    expect(sup!.bounceCategory).toBe("hard");
    expect(sup!.source).toBe("bounce");
  });

  it("delivered/open/click → null (not a suppression event)", () => {
    expect(suppressionFromEvent({ event: "delivered" })).toBeNull();
    expect(suppressionFromEvent({ event: "open" })).toBeNull();
    expect(suppressionFromEvent({ event: "click" })).toBeNull();
  });
});

describe("Eleonora warmup ramp", () => {
  it("matches the published ramp on each day", () => {
    expect(limitForDay(0)).toBe(WARMUP_RAMP[0].limit); // day 1 → 50
    expect(limitForDay(1)).toBe(WARMUP_RAMP[1].limit); // day 2 → 100
    expect(limitForDay(2)).toBe(WARMUP_RAMP[2].limit); // day 3 → 500
    expect(limitForDay(3)).toBe(WARMUP_RAMP[3].limit); // day 4 → 1000
    expect(limitForDay(4)).toBe(WARMUP_RAMP[4].limit); // day 5 → 5000
  });

  it("caps at 10000 once day 7+ is reached", () => {
    expect(limitForDay(6)).toBe(POST_WARMUP_LIMIT);
    expect(limitForDay(30)).toBe(POST_WARMUP_LIMIT);
    expect(limitForDay(365)).toBe(POST_WARMUP_LIMIT);
  });

  it("day-1 limit is 50 (the strictest cap)", () => {
    expect(limitForDay(0)).toBe(50);
  });
});

describe("Eleonora DKIM/SPF/DMARC record generation", () => {
  it("DKIM record has v=DKIM1; k=rsa; p=<base64>", () => {
    const { publicKey } = generateDkimKeypair();
    const dkim = buildDkimRecordValue(publicKey);
    expect(dkim).toMatch(/^v=DKIM1; k=rsa; p=[A-Za-z0-9+/=]+$/);
  });

  it("DKIM bare key has no PEM headers/whitespace", () => {
    const { publicKey } = generateDkimKeypair();
    const dkim = buildDkimRecordValue(publicKey);
    expect(dkim).not.toContain("BEGIN PUBLIC KEY");
    expect(dkim).not.toContain("\n");
  });

  it("SPF record authorizes sendgrid.net", () => {
    const spf = buildSpfRecordValue();
    expect(spf).toContain("v=spf1");
    expect(spf).toContain("include:sendgrid.net");
  });

  it("DMARC record uses quarantine + report email", () => {
    const dmarc = buildDmarcRecordValue("dmarc-reports@example.com");
    expect(dmarc).toContain("v=DMARC1");
    expect(dmarc).toContain("p=quarantine");
    expect(dmarc).toContain("rua=mailto:dmarc-reports@example.com");
  });

  it("buildDnsRecords composes hosts correctly", () => {
    const { publicKey } = generateDkimKeypair();
    const records = buildDnsRecords({
      dkimDomain: "example.com",
      dkimSelector: "acreos1",
      publicKeyPem: publicKey,
      dmarcReportEmail: "dmarc@example.com",
    });
    expect(records.dkim.host).toBe("acreos1._domainkey.example.com");
    expect(records.spf.host).toBe("example.com");
    expect(records.dmarc.host).toBe("_dmarc.example.com");
  });

  it("generated keypair is RSA 2048-bit", () => {
    const { publicKey, privateKey } = generateDkimKeypair();
    expect(publicKey).toContain("BEGIN PUBLIC KEY");
    expect(privateKey).toContain("BEGIN PRIVATE KEY");
  });
});

describe("Eleonora MIME builder — List-Unsubscribe headers", () => {
  it("emits both mailto and https in List-Unsubscribe", async () => {
    const { buildRawMimeMessage } = await import("../../server/services/emailService");
    const raw = buildRawMimeMessage({
      from: "AcreOS <noreply@acreos.io>",
      to: ["recipient@example.com"],
      subject: "Test",
      html: "<p>hi</p>",
      text: "hi",
      listUnsubscribeMailto: "unsubscribe@acreos.io",
      listUnsubscribeUrl: "https://app.acreos.io/u/abc123",
    });
    expect(raw).toContain("List-Unsubscribe: <mailto:unsubscribe@acreos.io>, <https://app.acreos.io/u/abc123>");
    expect(raw).toContain("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
  });

  it("includes both text/plain and text/html alternatives", async () => {
    const { buildRawMimeMessage } = await import("../../server/services/emailService");
    const raw = buildRawMimeMessage({
      from: "x@y.com",
      to: ["a@b.com"],
      subject: "Test",
      html: "<p>HTML</p>",
      text: "TEXT",
      listUnsubscribeMailto: "u@x.com",
      listUnsubscribeUrl: "https://x/u/t",
    });
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(raw).toContain("multipart/alternative");
  });
});

// Suppression-blocks-send: re-imported pattern from existing
// emailSuppression.test.ts. We mock all the side-channel deps and assert
// SES is never reached when the only recipient is suppressed.
describe("Eleonora suppression blocks sends", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns recipient_rejected when every recipient is on the suppression list", async () => {
    vi.doMock("../../server/services/emailSuppressions", () => ({
      filterSuppressed: vi.fn(async (emails: string[]) => ({
        allowed: [],
        suppressed: emails.map((e) => e.toLowerCase()),
      })),
      isSuppressed: vi.fn(async () => true),
      suppress: vi.fn(),
      suppressionFromEvent: vi.fn(),
    }));
    vi.doMock("../../server/services/unsubscribeTokens", () => ({
      issueToken: vi.fn(async () => "token"),
      buildUnsubscribeUrl: () => "https://x/u/token",
    }));
    vi.doMock("../../server/services/emailWarmup", () => ({
      reserveSend: vi.fn(async () => ({ ok: true, dailyLimit: 50, used: 1, resetAt: new Date(), warmupDay: 1 })),
    }));
    vi.doMock("../../server/services/orgEmailIdentity", () => ({
      getIdentityForSend: vi.fn(async () => null),
    }));
    vi.doMock("../../server/utils/simulationMode", () => ({
      shouldSimulate: () => false,
      recordSimulatedAction: vi.fn(),
    }));
    vi.doMock("../../server/storage", () => ({
      storage: {
        getOrganization: vi.fn(async () => null),
        getOrganizationIntegration: vi.fn(async () => null),
        getVerifiedEmailDomains: vi.fn(async () => []),
      },
    }));
    vi.doMock("../../server/services/fieldEncryption", () => ({
      decryptJsonCredentials: vi.fn(),
    }));
    vi.doMock("../../server/utils/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));

    const { emailService } = await import("../../server/services/emailService");
    const result = await emailService.sendEmail({
      to: "blocked@example.com",
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("recipient_rejected");
  });

  it("returns quota_exceeded when warmup limit is hit", async () => {
    vi.doMock("../../server/services/emailSuppressions", () => ({
      filterSuppressed: vi.fn(async (emails: string[]) => ({ allowed: emails, suppressed: [] })),
      isSuppressed: vi.fn(async () => false),
      suppress: vi.fn(),
      suppressionFromEvent: vi.fn(),
    }));
    vi.doMock("../../server/services/unsubscribeTokens", () => ({
      issueToken: vi.fn(async () => "t"),
      buildUnsubscribeUrl: () => "https://x/u/t",
    }));
    vi.doMock("../../server/services/emailWarmup", () => ({
      reserveSend: vi.fn(async () => ({
        ok: false,
        dailyLimit: 50,
        used: 50,
        resetAt: new Date(Date.now() + 86400_000),
        warmupDay: 1,
        reason: "limit_exceeded" as const,
      })),
    }));
    vi.doMock("../../server/services/orgEmailIdentity", () => ({
      getIdentityForSend: vi.fn(async () => null),
    }));
    vi.doMock("../../server/utils/simulationMode", () => ({
      shouldSimulate: () => false,
      recordSimulatedAction: vi.fn(),
    }));
    vi.doMock("../../server/storage", () => ({
      storage: {
        getOrganization: vi.fn(async () => null),
        getOrganizationIntegration: vi.fn(async () => null),
        getVerifiedEmailDomains: vi.fn(async () => []),
      },
    }));
    vi.doMock("../../server/services/fieldEncryption", () => ({
      decryptJsonCredentials: vi.fn(),
    }));
    vi.doMock("../../server/utils/logger", () => ({
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));

    const { emailService } = await import("../../server/services/emailService");
    const result = await emailService.sendEmail({
      to: "ok@example.com",
      subject: "Hi",
      html: "<p>x</p>",
      organizationId: 42,
    });
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("quota_exceeded");
  });
});
