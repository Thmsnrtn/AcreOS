import { describe, it, expect } from "vitest";
import { sesNotificationToSuppressions } from "../../server/routes-ses-events";

/**
 * Gap 4 (product-truth audit) — the pure SES-notification → suppression mapper.
 * The DB application (ingestSesNotification) + SNS signature verification are
 * exercised by the live webhook + the shared snsVerification suite; this pins
 * the classification logic that decides who gets suppressed.
 */
describe("sesNotificationToSuppressions", () => {
  it("hard-suppresses a Permanent bounce", () => {
    const out = sesNotificationToSuppressions({
      notificationType: "Bounce",
      bounce: {
        bounceType: "Permanent",
        bounceSubType: "General",
        bouncedRecipients: [{ emailAddress: "Gone@Example.com", diagnosticCode: "smtp; 550 unknown" }],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      email: "Gone@Example.com",
      source: "bounce",
      bounceCategory: "hard",
    });
    expect(out[0].softBounce).toBeUndefined();
    expect(out[0].reason).toContain("550");
  });

  it("treats a Transient bounce as a soft-bounce strike (not immediate suppress)", () => {
    const out = sesNotificationToSuppressions({
      notificationType: "Bounce",
      bounce: {
        bounceType: "Transient",
        bounceSubType: "MailboxFull",
        bouncedRecipients: [{ emailAddress: "full@example.com" }],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].bounceCategory).toBe("soft");
    expect(out[0].softBounce).toBe(true);
  });

  it("treats an Undetermined bounce as soft (never permanently kills on ambiguity)", () => {
    const out = sesNotificationToSuppressions({
      notificationType: "Bounce",
      bounce: {
        bounceType: "Undetermined",
        bouncedRecipients: [{ emailAddress: "maybe@example.com" }],
      },
    });
    expect(out[0].softBounce).toBe(true);
    expect(out[0].bounceCategory).toBe("soft");
  });

  it("suppresses every recipient of a complaint", () => {
    const out = sesNotificationToSuppressions({
      notificationType: "Complaint",
      complaint: {
        complaintFeedbackType: "abuse",
        complainedRecipients: [{ emailAddress: "a@example.com" }, { emailAddress: "b@example.com" }],
      },
    });
    expect(out.map((o) => o.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(out.every((o) => o.source === "spam" && o.bounceCategory === "complaint")).toBe(true);
    expect(out[0].reason).toContain("abuse");
  });

  it("produces no suppressions for a Delivery notification", () => {
    expect(
      sesNotificationToSuppressions({
        notificationType: "Delivery",
        mail: { destination: ["ok@example.com"] },
      }),
    ).toEqual([]);
  });

  it("produces no suppressions for an unknown / missing type", () => {
    expect(sesNotificationToSuppressions({} as never)).toEqual([]);
    expect(sesNotificationToSuppressions({ notificationType: "Open" })).toEqual([]);
  });

  it("skips recipients with blank email addresses", () => {
    const out = sesNotificationToSuppressions({
      notificationType: "Bounce",
      bounce: {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "" }, { emailAddress: "  " }, { emailAddress: "real@x.com" }],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe("real@x.com");
  });

  it("is total on malformed input", () => {
    expect(sesNotificationToSuppressions(null as never)).toEqual([]);
    expect(
      sesNotificationToSuppressions({ notificationType: "Bounce" }),
    ).toEqual([]);
    expect(
      sesNotificationToSuppressions({ notificationType: "Complaint", complaint: {} }),
    ).toEqual([]);
  });
});
