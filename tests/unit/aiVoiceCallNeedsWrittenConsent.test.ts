/**
 * No AI-voiced outbound call without prior express written consent.
 *
 * AcreOS places no AI-voiced call today; the gate exists so the feature cannot
 * ship without consent (FCC 24-17: AI voices are "artificial" voices under
 * 47 U.S.C. § 227(b); 47 C.F.R. § 64.1200(a)(2), (f)(9) for written consent).
 *
 * Behavioural at the chokepoint (CommsRouter.initiateCall): a provider is
 * reached only when the call declares a human voice, or an artificial voice
 * with a live written consent record that names artificial / AI voice calls.
 * Structural over the population: only router.ts calls a provider's
 * initiateCall, and no file outside the provider adapters names a carrier's
 * call-creation endpoint — so no second path to a phone can skip the gate.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ts from "typescript";

const H = vi.hoisted(() => ({ leads: [] as any[], events: [] as any[], fail: false }));
vi.mock("../../server/db", async () => {
  const schema = await import("@shared/schema");
  return {
    db: {
      select: () => ({
        from: (t: any) => {
          if (H.fail) throw new Error("db down");
          const rows = t === schema.leads ? H.leads : H.events;
          const c: any = { where: () => c, orderBy: () => c, then: (ok: any, bad: any) => Promise.resolve(rows).then(ok, bad) };
          return c;
        },
      }),
    },
  };
});
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/founderSettings", () => ({ getSetting: async () => null }));

import { CommsRouter, type CommsProvider } from "../../server/services/comms/router";
import { AiVoiceConsentRequiredError, hasWrittenArtificialVoiceConsent } from "../../server/services/comms/aiVoiceConsent";

const placed: any[] = [];
const twilio: CommsProvider = {
  name: "twilio",
  isConfigured: () => true,
  sendSms: async () => ({ sid: "s" }) as any,
  initiateCall: async (o) => { placed.push(o); return { sid: "CA1" }; },
  rentNumber: async () => ({ number: "+1", costCentsPerMonth: 0 }),
  releaseNumber: async () => undefined,
  webhookSignatureValid: () => true,
  estimateCostCents: () => 1,
};
const router = new CommsRouter(new Map([["twilio", twilio]]));
const AI = { kind: "artificial" as const };
const at = (d: number) => new Date(Date.UTC(2026, 0, d));
const WRITTEN_AI = { eventType: "granted", channels: ["phone", "sms"], source: "written", consentText: "I agree that AcreOS may call me at this number using an artificial or AI-generated voice. Consent is not a condition of purchase.", metadata: null, createdAt: at(2) };

beforeEach(() => {
  placed.length = 0;
  H.leads = [{ id: 5 }];
  H.events = [];
  H.fail = false;
});

describe("the call-placing chokepoint", () => {
  it("a human-voiced call is placed", async () => {
    await router.initiateCall({ to: "+15125550100", organizationId: 7, voice: { kind: "human" } });
    expect(placed).toHaveLength(1);
  });

  it("an AI-voiced call with written consent naming artificial voice is placed", async () => {
    H.events = [WRITTEN_AI];
    await router.initiateCall({ to: "+1 (512) 555-0100", organizationId: 7, voice: AI });
    expect(placed).toHaveLength(1);
  });

  it.each([
    ["no consent at all", []],
    ["consent captured on a website, not in writing", [{ ...WRITTEN_AI, source: "website" }]],
    ["written consent that does not name artificial voice", [{ ...WRITTEN_AI, consentText: "You may call me about my land." }]],
    ["written consent for SMS only", [{ ...WRITTEN_AI, channels: ["sms"] }]],
    // A revocation carrying the same written record: only its eventType says no.
    ["written consent later revoked", [{ ...WRITTEN_AI, eventType: "revoked", createdAt: at(9) }, WRITTEN_AI]],
  ])("refuses an AI-voiced call with %s, and reaches no provider", async (_label, events) => {
    H.events = events as any[];
    await expect(router.initiateCall({ to: "+15125550100", organizationId: 7, voice: AI })).rejects.toBeInstanceOf(AiVoiceConsentRequiredError);
    expect(placed).toHaveLength(0);
  });

  it("refuses when the number is no lead's, when the org is missing, when the voice is undeclared, and when the record cannot be read", async () => {
    H.events = [WRITTEN_AI];
    H.leads = [];
    await expect(router.initiateCall({ to: "+15125550100", organizationId: 7, voice: AI })).rejects.toThrow(/no lead/);
    H.leads = [{ id: 5 }];
    await expect(router.initiateCall({ to: "+15125550100", voice: AI })).rejects.toThrow(/no organization/);
    await expect(router.initiateCall({ to: "+15125550100", organizationId: 7 } as any)).rejects.toThrow(/did not declare/);
    H.fail = true;
    await expect(router.initiateCall({ to: "+15125550100", organizationId: 7, voice: AI })).rejects.toThrow(/could not be read/);
    expect(placed).toHaveLength(0);
  });

  it("metadata.artificialVoice is an explicit grant even with terse text", () => {
    expect(hasWrittenArtificialVoiceConsent([{ ...WRITTEN_AI, consentText: "Yes.", metadata: { artificialVoice: true } }]).ok).toBe(true);
  });
});

describe("population: no path to a phone call skips the chokepoint", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const files = execSync("git ls-files server", { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  const PROVIDERS = new Set(["server/services/comms/providers/twilio.ts", "server/services/comms/providers/telnyx.ts", "server/services/comms/providers/bandwidth.ts"]);

  function initiateCallSites(file: string, text: string): string[] {
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const out: string[] = [];
    const v = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "initiateCall") {
        out.push(n.expression.expression.getText(sf));
      }
      ts.forEachChild(n, v);
    };
    v(sf);
    return out;
  }

  it("canary: the walker sees a provider-level call", () => {
    expect(initiateCallSites("f.ts", "await provider.initiateCall({ to })")).toEqual(["provider"]);
  });

  it("only the router calls a provider's initiateCall; everyone else calls the router", () => {
    const offenders: string[] = [];
    let routerSites = 0;
    for (const f of files) {
      const sites = initiateCallSites(f, fs.readFileSync(path.join(ROOT, f), "utf8"));
      for (const recv of sites) {
        if (f === "server/services/comms/router.ts" && recv === "provider") { routerSites++; continue; }
        if (/^(commsRouter|router|getCommsRouter\(\))$/.test(recv)) continue;
        offenders.push(`${f}: ${recv}.initiateCall(…)`);
      }
    }
    expect(routerSites).toBe(1);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no file outside the provider adapters names a carrier's call-creation endpoint", () => {
    const ENDPOINT = /\/Calls\.json|api\.telnyx\.com\/v2\/calls|voice\.bandwidth\.com\/api\/v2\/accounts\/[^"'`]*\/calls/;
    const found = files.filter((f) => !PROVIDERS.has(f) && ENDPOINT.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
    expect(found).toEqual([]);
    expect(ENDPOINT.test(fs.readFileSync(path.join(ROOT, "server/services/comms/providers/twilio.ts"), "utf8"))).toBe(true);
  });
});
