import { describe, it, expect } from "vitest";
import {
  SUPPORT_TRIAGE_CATEGORIES,
  SUPPORT_CATEGORY_ROUTING,
  SUPPORT_CLOCKS_STATUS,
  classifySupportMessage,
  addBusinessDays,
  firstResponseDeadline,
  isClockBreached,
  type SupportTriageCategory,
} from "../../shared/support/triage";
import {
  DSAR_CLOCK_HOURS,
  stampDsarDeadline,
  dsarReAlertsDue,
} from "../../shared/privacy/dsarClock";

describe("classifySupportMessage — one seeded arrival per category", () => {
  const fixtures: Array<{
    category: SupportTriageCategory;
    subject: string;
    body: string;
  }> = [
    {
      category: "how-to",
      subject: "Exporting notes",
      body: "Hi, how do I export my notes to a spreadsheet? Thanks!",
    },
    {
      category: "bug",
      subject: "Tape import broken",
      body: "When I open the tape import page it shows a blank page and a 500 error.",
    },
    {
      category: "billing-question",
      subject: "Invoice copy",
      body: "Can I get a copy of my invoice for last month, and change the card on file?",
    },
    {
      category: "billing-money",
      subject: "Double payment",
      body: "I was charged twice this month and want a refund please.",
    },
    {
      category: "complaint",
      subject: "Still no answer",
      body: "This is unacceptable. I've asked three times and nobody answers. I want a manager.",
    },
    {
      category: "privacy",
      subject: "Data request",
      body: "Please delete my data. This is a DSAR under GDPR.",
    },
    {
      category: "legal-shaped",
      subject: "Notice",
      body: "Our attorney is sending a cease and desist; expect a demand letter this week.",
    },
    {
      category: "abuse/security",
      subject: "Security concern",
      body: "Someone has compromised my account, and I received a phishing email claiming to be you.",
    },
  ];

  for (const f of fixtures) {
    it(`classifies ${f.category}`, () => {
      const result = classifySupportMessage({ subject: f.subject, body: f.body });
      expect(result.category).toBe(f.category);
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  }

  it("covers every category exactly once", () => {
    expect(fixtures.map((f) => f.category)).toEqual([...SUPPORT_TRIAGE_CATEGORIES]);
  });
});

describe("classifySupportMessage — precedence", () => {
  it("refund AND attorney/demand → legal-shaped", () => {
    const r = classifySupportMessage({
      subject: "Refund",
      body: "I want a refund, otherwise my attorney will send a demand letter.",
    });
    expect(r.category).toBe("legal-shaped");
  });

  it("delete data AND invoice → privacy, noting the also-matched category", () => {
    const r = classifySupportMessage({
      subject: "Request",
      body: "Please delete my data and also send me my invoice.",
    });
    expect(r.category).toBe("privacy");
    expect(r.reasons.some((x) => x.includes("also matched") && x.includes("billing-question"))).toBe(
      true,
    );
  });

  it("billing-money + complaint → billing-money", () => {
    const r = classifySupportMessage({
      subject: "Charged twice",
      body: "I was charged twice, this is unacceptable.",
    });
    expect(r.category).toBe("billing-money");
  });
});

describe("category table integrity", () => {
  it("has exactly the 8 spec categories in order", () => {
    expect([...SUPPORT_TRIAGE_CATEGORIES]).toEqual([
      "how-to",
      "bug",
      "billing-question",
      "billing-money",
      "complaint",
      "privacy",
      "legal-shaped",
      "abuse/security",
    ]);
  });

  it("routing has an entry for every category", () => {
    for (const c of SUPPORT_TRIAGE_CATEGORIES) {
      expect(SUPPORT_CATEGORY_ROUTING[c]).toBeDefined();
    }
    expect(Object.keys(SUPPORT_CATEGORY_ROUTING).sort()).toEqual(
      [...SUPPORT_TRIAGE_CATEGORIES].sort(),
    );
  });

  it("only privacy stamps a privacy deadline", () => {
    const stamping = SUPPORT_TRIAGE_CATEGORIES.filter(
      (c) => SUPPORT_CATEGORY_ROUTING[c].stampPrivacyDeadline,
    );
    expect(stamping).toEqual(["privacy"]);
  });

  it("only legal-shaped has no draft without Tom or counsel", () => {
    const none = SUPPORT_TRIAGE_CATEGORIES.filter(
      (c) => SUPPORT_CATEGORY_ROUTING[c].draftReply === "none-without-tom-or-counsel",
    );
    expect(none).toEqual(["legal-shaped"]);
  });

  it("privacy, legal-shaped, billing-money, abuse/security brief Tom same-day; the rest digest", () => {
    const sameDay = SUPPORT_TRIAGE_CATEGORIES.filter(
      (c) => SUPPORT_CATEGORY_ROUTING[c].briefTom === "same-day",
    );
    expect(sameDay.sort()).toEqual(
      ["privacy", "legal-shaped", "billing-money", "abuse/security"].sort(),
    );
    for (const c of ["how-to", "bug", "billing-question", "complaint"] as const) {
      expect(SUPPORT_CATEGORY_ROUTING[c].briefTom).toBe("digest");
    }
  });

  it("clocks are PROPOSED", () => {
    expect(SUPPORT_CLOCKS_STATUS).toBe("PROPOSED");
  });
});

describe("DSAR stamp math", () => {
  const arrival = "2026-11-09T14:00:00.000Z";

  it("default clock is 24h", () => {
    expect(DSAR_CLOCK_HOURS).toBe(24);
    const s = stampDsarDeadline(arrival);
    expect(s.arrivalAt).toBe("2026-11-09T14:00:00.000Z");
    expect(s.deadlineAt).toBe("2026-11-10T14:00:00.000Z");
    expect(s.reAlert50At).toBe("2026-11-10T02:00:00.000Z");
    expect(s.reAlert90At).toBe("2026-11-10T11:36:00.000Z");
  });

  it("shortened 2h test clock", () => {
    const s = stampDsarDeadline(arrival, 2);
    expect(s.deadlineAt).toBe("2026-11-09T16:00:00.000Z");
    expect(s.reAlert50At).toBe("2026-11-09T15:00:00.000Z");
    expect(s.reAlert90At).toBe("2026-11-09T15:48:00.000Z");
  });

  it("dsarReAlertsDue", () => {
    const s = stampDsarDeadline(arrival);
    const none = { fired50: false, fired90: false };
    expect(dsarReAlertsDue(s, "2026-11-10T03:00:00.000Z", none)).toEqual(["50"]);
    expect(dsarReAlertsDue(s, "2026-11-10T12:00:00.000Z", none)).toEqual(["50", "90"]);
    expect(
      dsarReAlertsDue(s, "2026-11-10T12:00:00.000Z", { fired50: true, fired90: false }),
    ).toEqual(["90"]);
    expect(dsarReAlertsDue(s, "2026-11-10T01:00:00.000Z", none)).toEqual([]);
  });
});

describe("business-day math", () => {
  it("Friday +1 → Monday, time preserved", () => {
    const fri = new Date("2026-11-06T15:30:00.000Z");
    expect(fri.getUTCDay()).toBe(5);
    expect(addBusinessDays(fri, 1).toISOString()).toBe("2026-11-09T15:30:00.000Z");
  });

  it("Wednesday +1 → Thursday", () => {
    expect(addBusinessDays(new Date("2026-11-11T09:00:00.000Z"), 1).toISOString()).toBe(
      "2026-11-12T09:00:00.000Z",
    );
  });

  it("billing-question arriving Friday → Monday end of day", () => {
    expect(firstResponseDeadline("billing-question", "2026-11-06T10:00:00.000Z").deadlineAt).toBe(
      "2026-11-09T23:59:59.999Z",
    );
  });

  it("billing-money (same business day) arriving Saturday → Monday end of day", () => {
    expect(firstResponseDeadline("billing-money", "2026-11-07T10:00:00.000Z").deadlineAt).toBe(
      "2026-11-09T23:59:59.999Z",
    );
  });

  it("privacy (same-day, calendar) arriving Sunday → Sunday end of day", () => {
    expect(firstResponseDeadline("privacy", "2026-11-08T10:00:00.000Z").deadlineAt).toBe(
      "2026-11-08T23:59:59.999Z",
    );
  });
});

describe("isClockBreached", () => {
  const deadline = "2026-11-09T23:59:59.999Z";
  it("unresponded past deadline → true", () => {
    expect(isClockBreached(deadline, null, "2026-11-10T00:00:00.000Z")).toBe(true);
  });
  it("responded before deadline → false", () => {
    expect(isClockBreached(deadline, "2026-11-09T12:00:00.000Z", "2026-11-12T00:00:00.000Z")).toBe(
      false,
    );
  });
  it("responded after deadline → true", () => {
    expect(isClockBreached(deadline, "2026-11-10T08:00:00.000Z", "2026-11-10T09:00:00.000Z")).toBe(
      true,
    );
  });
  it("unresponded before deadline → false", () => {
    expect(isClockBreached(deadline, null, "2026-11-09T12:00:00.000Z")).toBe(false);
  });
});
