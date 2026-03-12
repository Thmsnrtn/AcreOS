/**
 * T223 — Sequence Optimizer Tests
 * Tests drip sequence scheduling, delay calculation, and completion logic.
 */

import { describe, it, expect } from "vitest";

// ─── Inline pure logic ────────────────────────────────────────────────────────

interface SequenceStep {
  order: number;
  channel: "email" | "sms" | "call" | "mail";
  delayDays: number;
  templateId: string;
  subject?: string;
}

interface SequenceEnrollment {
  leadId: number;
  sequenceId: number;
  currentStep: number;
  totalSteps: number;
  enrolledAt: Date;
  completedAt?: Date;
  unsubscribedAt?: Date;
  status: "active" | "completed" | "unsubscribed" | "paused";
}

function getNextStepDate(enrolledAt: Date, steps: SequenceStep[], currentStep: number): Date | null {
  const nextStep = steps.find(s => s.order === currentStep + 1);
  if (!nextStep) return null;

  // Calculate total delay from start
  const stepsUpToNext = steps.filter(s => s.order <= nextStep.order);
  const totalDelayDays = stepsUpToNext.reduce((sum, s) => sum + s.delayDays, 0);

  const nextDate = new Date(enrolledAt);
  nextDate.setDate(nextDate.getDate() + totalDelayDays);
  return nextDate;
}

function isSequenceComplete(enrollment: SequenceEnrollment): boolean {
  return enrollment.currentStep >= enrollment.totalSteps ||
    enrollment.status === "completed";
}

function calculateCompletionRate(enrollments: SequenceEnrollment[]): number {
  if (enrollments.length === 0) return 0;
  const completed = enrollments.filter(e => e.status === "completed").length;
  return Math.round((completed / enrollments.length) * 100);
}

function getUnsubscribeRate(enrollments: SequenceEnrollment[]): number {
  if (enrollments.length === 0) return 0;
  const unsubs = enrollments.filter(e => e.status === "unsubscribed").length;
  return parseFloat(((unsubs / enrollments.length) * 100).toFixed(1));
}

function shouldSendStep(
  enrollment: SequenceEnrollment,
  step: SequenceStep,
  now = new Date()
): boolean {
  if (enrollment.status !== "active") return false;
  if (enrollment.currentStep >= step.order) return false;
  if (enrollment.currentStep !== step.order - 1) return false;

  const scheduledDate = getNextStepDate(enrollment.enrolledAt, [step], enrollment.currentStep - 1);
  if (!scheduledDate) return false;
  return now >= scheduledDate;
}

function optimizeSequenceOrder(
  steps: SequenceStep[],
  channelPerformance: Record<string, number> // channel -> open/response rate
): SequenceStep[] {
  // Reorder early steps to use highest-performing channels first
  const earlySteps = steps.filter(s => s.order <= 2);
  const laterSteps = steps.filter(s => s.order > 2);

  const sortedEarly = [...earlySteps].sort((a, b) => {
    const perfA = channelPerformance[a.channel] ?? 0;
    const perfB = channelPerformance[b.channel] ?? 0;
    return perfB - perfA;
  }).map((s, i) => ({ ...s, order: i + 1 }));

  return [
    ...sortedEarly,
    ...laterSteps,
  ];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getNextStepDate", () => {
  const steps: SequenceStep[] = [
    { order: 1, channel: "email", delayDays: 0, templateId: "t1" },
    { order: 2, channel: "sms", delayDays: 3, templateId: "t2" },
    { order: 3, channel: "email", delayDays: 7, templateId: "t3" },
  ];

  it("returns null when no next step", () => {
    const enrolled = new Date("2024-01-01");
    expect(getNextStepDate(enrolled, steps, 3)).toBeNull();
  });

  it("calculates date for step 2", () => {
    const enrolled = new Date("2024-01-01");
    const nextDate = getNextStepDate(enrolled, steps, 1);
    expect(nextDate).not.toBeNull();
    // Step 2 has 0 (step 1) + 3 days = 3 days from enrolled
    expect(nextDate!.getDate()).toBe(4); // Jan 4
  });

  it("accumulates delay for step 3", () => {
    const enrolled = new Date("2024-01-01");
    const nextDate = getNextStepDate(enrolled, steps, 2);
    // Step 3: 0 + 3 + 7 = 10 days
    const expected = new Date("2024-01-11");
    expect(nextDate!.toDateString()).toBe(expected.toDateString());
  });
});

describe("isSequenceComplete", () => {
  it("returns true when currentStep >= totalSteps", () => {
    const e: SequenceEnrollment = {
      leadId: 1, sequenceId: 1, currentStep: 5, totalSteps: 5,
      enrolledAt: new Date(), status: "active",
    };
    expect(isSequenceComplete(e)).toBe(true);
  });

  it("returns true when status is completed", () => {
    const e: SequenceEnrollment = {
      leadId: 1, sequenceId: 1, currentStep: 2, totalSteps: 5,
      enrolledAt: new Date(), status: "completed",
    };
    expect(isSequenceComplete(e)).toBe(true);
  });

  it("returns false when active mid-sequence", () => {
    const e: SequenceEnrollment = {
      leadId: 1, sequenceId: 1, currentStep: 2, totalSteps: 5,
      enrolledAt: new Date(), status: "active",
    };
    expect(isSequenceComplete(e)).toBe(false);
  });
});

describe("calculateCompletionRate", () => {
  it("returns 0 for empty array", () => {
    expect(calculateCompletionRate([])).toBe(0);
  });

  it("calculates correctly", () => {
    const enrollments: SequenceEnrollment[] = [
      { leadId: 1, sequenceId: 1, currentStep: 5, totalSteps: 5, enrolledAt: new Date(), status: "completed" },
      { leadId: 2, sequenceId: 1, currentStep: 5, totalSteps: 5, enrolledAt: new Date(), status: "completed" },
      { leadId: 3, sequenceId: 1, currentStep: 2, totalSteps: 5, enrolledAt: new Date(), status: "active" },
      { leadId: 4, sequenceId: 1, currentStep: 2, totalSteps: 5, enrolledAt: new Date(), status: "unsubscribed" },
    ];
    expect(calculateCompletionRate(enrollments)).toBe(50);
  });
});

describe("getUnsubscribeRate", () => {
  it("returns 0 for empty enrollments", () => {
    expect(getUnsubscribeRate([])).toBe(0);
  });

  it("calculates unsubscribe rate", () => {
    const enrollments: SequenceEnrollment[] = [
      { leadId: 1, sequenceId: 1, currentStep: 5, totalSteps: 5, enrolledAt: new Date(), status: "completed" },
      { leadId: 2, sequenceId: 1, currentStep: 1, totalSteps: 5, enrolledAt: new Date(), status: "unsubscribed" },
    ];
    expect(getUnsubscribeRate(enrollments)).toBe(50);
  });
});

describe("optimizeSequenceOrder", () => {
  it("puts highest-performing channel first", () => {
    const steps: SequenceStep[] = [
      { order: 1, channel: "email", delayDays: 0, templateId: "t1" },
      { order: 2, channel: "sms", delayDays: 3, templateId: "t2" },
    ];
    const performance = { email: 25, sms: 45 };
    const optimized = optimizeSequenceOrder(steps, performance);
    expect(optimized[0].channel).toBe("sms");
    expect(optimized[1].channel).toBe("email");
  });

  it("preserves steps beyond order 2", () => {
    const steps: SequenceStep[] = [
      { order: 1, channel: "email", delayDays: 0, templateId: "t1" },
      { order: 2, channel: "sms", delayDays: 3, templateId: "t2" },
      { order: 3, channel: "mail", delayDays: 7, templateId: "t3" },
    ];
    const performance = { email: 25, sms: 45, mail: 10 };
    const optimized = optimizeSequenceOrder(steps, performance);
    expect(optimized).toHaveLength(3);
    expect(optimized[2].channel).toBe("mail");
  });
});
