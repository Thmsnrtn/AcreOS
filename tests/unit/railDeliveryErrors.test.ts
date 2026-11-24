/**
 * T-DEF-2 — rail delivery error taxonomy (journey-walk-tax-2026-11.md).
 *
 * On staging, a redemption notice whose mail lane refused (sender identity
 * unverified — T-DEF-1) answered 500 INTERNAL_ERROR: the route mapped only
 * RailDeliveryRefusedError, while the lane's refusals travel as
 * ProviderNotContactedError and fell through to the 500 handler. A fixable
 * configuration refusal was mislabelled as a server crash.
 *
 * These tests drive the REAL rail delivery module
 * (server/services/settlementRail/delivery.ts) with only its two edges
 * faked — storage (the sender-identity read) and directMailService's
 * sendLetter — and pin the whole taxonomy:
 *
 *   lane refusal (ProviderNotContactedError, reason on its cause chain)
 *     → RailDeliveryRefusedError carrying the lane's own reason + message
 *     → route shape 422 UNPROCESSABLE with details.reason
 *   outward-action claim conflicts (in flight / ambiguous / key reused)
 *     → RailDeliveryConflictError → 409 CONFLICT with its reason
 *   a genuinely unexpected error passes through UNTOUCHED, so the route's
 *     500 handler still owns it (railDeliveryHttpError returns null)
 *   success + already-sent replay are controls: translation changes
 *     nothing on the witnessed-send path.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/db", () => ({ db: {}, withTransaction: vi.fn() }));

vi.mock("../../server/storage", () => ({
  storage: { getDefaultMailSenderIdentity: vi.fn() },
}));

vi.mock("../../server/services/directMailService", () => ({
  sendLetter: vi.fn(),
  LetterAlreadySentError: class extends Error {
    constructor(
      readonly idempotencyKey: string,
      readonly lobId: string | null,
    ) {
      super(`Letter for idempotency key "${idempotencyKey}" was already sent`);
      this.name = "LetterAlreadySentError";
    }
  },
}));

import { storage } from "../../server/storage";
import { sendLetter, LetterAlreadySentError } from "../../server/services/directMailService";
import {
  ActionAmbiguousError,
  ActionInFlightError,
  ActionKeyReusedError,
  ProviderNotContactedError,
} from "../../server/services/actions/outwardAction";
import {
  deliverRailLetterByMail,
  railDeliveryHttpError,
  RailDeliveryConflictError,
  RailDeliveryRefusedError,
  translateRailDeliveryError,
} from "../../server/services/settlementRail/delivery";

const ORG = 7;
const IDENTITY = { id: 3, organizationId: ORG, name: "Main office", status: "failed" };
const ARGS = {
  organizationId: ORG,
  html: "<p>Redemption notice</p>",
  recipient: { name: "Pat Owner", address: { line1: "12 Palm Way", city: "Tampa", state: "FL", zip: "33602" } },
  lane: "certified_mail" as const,
  idempotencyKey: "tax-redemption-notice:cert-1:2026-11-18:v1",
};

/** A MailLaneRefusedError-shaped cause, as assertSendableLane wraps it. */
function laneRefusal(reason: string, message: string): Error {
  return Object.assign(new Error(message), { name: "MailLaneRefusedError", reason });
}

const identityMock = vi.mocked(storage.getDefaultMailSenderIdentity);
const sendMock = vi.mocked(sendLetter);

beforeEach(() => {
  vi.clearAllMocks();
  identityMock.mockResolvedValue(IDENTITY as never);
  sendMock.mockResolvedValue({
    lobId: "ltr_1",
    url: "",
    expectedDeliveryDate: new Date("2026-11-25T00:00:00Z"),
    testMode: true,
  } as never);
});

describe("T-DEF-2 — lane refusals surface as reason-coded 422s, never a bare 500", () => {
  it("no sender identity at all → RailDeliveryRefusedError(no_sender_identity) → 422", async () => {
    identityMock.mockResolvedValue(undefined as never);
    const err = await deliverRailLetterByMail(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RailDeliveryRefusedError);
    expect(sendMock).not.toHaveBeenCalled();
    expect(railDeliveryHttpError(err)).toEqual({
      status: 422,
      code: "UNPROCESSABLE",
      reason: "no_sender_identity",
      message: expect.stringContaining("return address"),
    });
  });

  it("sender identity unverified (the T-DEF-1 shape) → 422 with the lane's reason and its own words", async () => {
    const laneMessage =
      'AcreOS mail only goes out under a verified return address, and "Main office" is not verified yet. ' +
      "Verify it in Mail Settings, or connect your own Lob key in Settings → Your provider keys.";
    sendMock.mockRejectedValue(new ProviderNotContactedError(laneMessage, laneRefusal("sender_identity_unverified", laneMessage)));
    const err = await deliverRailLetterByMail(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RailDeliveryRefusedError);
    expect(railDeliveryHttpError(err)).toEqual({
      status: 422,
      code: "UNPROCESSABLE",
      reason: "sender_identity_unverified",
      message: laneMessage,
    });
  });

  it("purchased credits short → 422 insufficient_purchased_credits", async () => {
    const laneMessage = "AcreOS mail is paid from purchased credits only: this needs 120 credits and your purchased balance is short. Nothing was mailed.";
    sendMock.mockRejectedValue(new ProviderNotContactedError(laneMessage, laneRefusal("insufficient_purchased_credits", laneMessage)));
    const err = await deliverRailLetterByMail(ARGS).catch((e: unknown) => e);
    expect(railDeliveryHttpError(err)).toMatchObject({ status: 422, code: "UNPROCESSABLE", reason: "insufficient_purchased_credits" });
  });

  it("house mail unavailable on this deployment → 422 house_mail_unavailable", async () => {
    const laneMessage = "AcreOS mail is not available on this deployment yet. Connect your own Lob key in Settings → Your provider keys to send now.";
    sendMock.mockRejectedValue(new ProviderNotContactedError(laneMessage, laneRefusal("house_mail_unavailable", laneMessage)));
    const err = await deliverRailLetterByMail(ARGS).catch((e: unknown) => e);
    expect(railDeliveryHttpError(err)).toMatchObject({ status: 422, reason: "house_mail_unavailable" });
  });

  it("a pre-contact refusal with no lane reason on its cause → 422 provider_not_contacted (never a guessed reason)", async () => {
    sendMock.mockRejectedValue(new ProviderNotContactedError("Your provider keys could not be read just now, so nothing was mailed or charged. Try again shortly."));
    const err = await deliverRailLetterByMail(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RailDeliveryRefusedError);
    expect(railDeliveryHttpError(err)).toMatchObject({ status: 422, code: "UNPROCESSABLE", reason: "provider_not_contacted" });
  });

  it("an unrecognised reason on the cause chain is not trusted — it degrades to provider_not_contacted", async () => {
    sendMock.mockRejectedValue(new ProviderNotContactedError("refused", laneRefusal("some_future_reason", "refused")));
    const err = await deliverRailLetterByMail(ARGS).catch((e: unknown) => e);
    expect(railDeliveryHttpError(err)).toMatchObject({ reason: "provider_not_contacted" });
  });
});

describe("T-DEF-2 — outward-action claim conflicts are honest 409s, not refusals and not 500s", () => {
  it("another worker is sending this piece → 409 send_in_flight", async () => {
    sendMock.mockRejectedValue(new ActionInFlightError("physical_mail.letter", ARGS.idempotencyKey));
    const err = await deliverRailLetterByMail(ARGS).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RailDeliveryConflictError);
    expect(railDeliveryHttpError(err)).toMatchObject({ status: 409, code: "CONFLICT", reason: "send_in_flight" });
  });

  it("a prior attempt's outcome is unknown → 409 send_outcome_unknown, and the message never claims nothing was sent", async () => {
    sendMock.mockRejectedValue(new ActionAmbiguousError("physical_mail.letter", ARGS.idempotencyKey, null));
    const err = await deliverRailLetterByMail(ARGS).catch((e: unknown) => e);
    const http = railDeliveryHttpError(err);
    expect(http).toMatchObject({ status: 409, code: "CONFLICT", reason: "send_outcome_unknown" });
    expect(http!.message).toContain("may already have performed it");
  });

  it("the idempotency key was reused for different content → 409 idempotency_key_reused", async () => {
    sendMock.mockRejectedValue(new ActionKeyReusedError("physical_mail.letter", ARGS.idempotencyKey));
    const err = await deliverRailLetterByMail(ARGS).catch((e: unknown) => e);
    expect(railDeliveryHttpError(err)).toMatchObject({ status: 409, code: "CONFLICT", reason: "idempotency_key_reused" });
  });
});

describe("T-DEF-2 — genuine faults still belong to the 500 handler", () => {
  it("an unexpected error passes through untouched (same instance) and maps to no 4xx", async () => {
    const boom = new Error("database connection terminated");
    sendMock.mockRejectedValue(boom);
    const err = await deliverRailLetterByMail(ARGS).catch((e: unknown) => e);
    expect(err).toBe(boom);
    expect(railDeliveryHttpError(err)).toBeNull();
    expect(translateRailDeliveryError(boom)).toBe(boom);
  });

  it("rail errors pass translation unchanged (no double-wrapping)", () => {
    const refused = new RailDeliveryRefusedError("sender_identity_unverified", "not verified");
    expect(translateRailDeliveryError(refused)).toBe(refused);
    const conflict = new RailDeliveryConflictError("send_in_flight", "in flight");
    expect(translateRailDeliveryError(conflict)).toBe(conflict);
  });
});

describe("T-DEF-2 — controls: the witnessed-send path is unchanged", () => {
  it("a provider acceptance returns its receipt untouched", async () => {
    const receipt = await deliverRailLetterByMail(ARGS);
    expect(receipt).toEqual({
      lane: "certified_mail",
      providerId: "ltr_1",
      testMode: true,
      alreadySent: false,
      expectedDeliveryDate: "2026-11-25T00:00:00.000Z",
    });
  });

  it("an already-sent replay still resolves to the recorded acceptance", async () => {
    sendMock.mockRejectedValue(new LetterAlreadySentError(ARGS.idempotencyKey, "ltr_0"));
    const receipt = await deliverRailLetterByMail(ARGS);
    expect(receipt).toMatchObject({ providerId: "ltr_0", alreadySent: true });
  });
});
