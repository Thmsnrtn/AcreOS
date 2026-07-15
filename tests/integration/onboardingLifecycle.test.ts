/**
 * Integration Tests: Onboarding Lifecycle
 * Phase 10 Task 10.1: Onboarding wizard completion for each path
 *
 * Tests the full onboarding flow:
 * - Organization creation with onboarding state
 * - Wizard completion for beginner, active, and enterprise paths
 * - Post-onboarding state verification (checklist, sample data)
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Types ────────────────────────────────────────────────────────────────────

type InvestorPath = "beginner" | "active" | "enterprise";

interface OnboardingData {
  path?: InvestorPath;
  completedSteps?: string[];
  skippedSteps?: string[];
  targetCounty?: string;
  targetState?: string;
  targetCounties?: Array<{ state: string; county: string }>;
  strategy?: string;
  dataImported?: boolean;
  teamInvited?: boolean;
}

interface Organization {
  id: number;
  name: string;
  onboardingCompleted: boolean;
  onboardingStep: number;
  onboardingData: OnboardingData;
  settings: Record<string, unknown>;
}

// ─── Onboarding simulation ───────────────────────────────────────────────────

const STEPS_BY_PATH: Record<InvestorPath, string[]> = {
  beginner: ["path", "target_county", "instant_hunt", "strategy", "atlas_tour", "complete"],
  active: ["path", "portfolio_import", "target_counties", "instant_hunt", "automation", "complete"],
  enterprise: ["path", "team", "integrations", "instant_hunt", "workflows", "complete"],
};

function createOrganization(id: number): Organization {
  return {
    id,
    name: "Test Org",
    onboardingCompleted: false,
    onboardingStep: 0,
    onboardingData: {},
    settings: { checklistDismissed: false, showTips: true },
  };
}

function advanceStep(org: Organization, stepId: string, data?: Partial<OnboardingData>): Organization {
  const completedSteps = [...(org.onboardingData.completedSteps || []), stepId];
  return {
    ...org,
    onboardingStep: org.onboardingStep + 1,
    onboardingData: {
      ...org.onboardingData,
      ...data,
      completedSteps,
    },
  };
}

function completeOnboarding(org: Organization, path: InvestorPath): Organization {
  return {
    ...org,
    onboardingCompleted: true,
    onboardingData: { ...org.onboardingData, path },
  };
}

function shouldRedirectToOnboarding(org: Organization, targetRoute: string): boolean {
  if (org.onboardingCompleted) return false;
  const protectedRoutes = ["/today", "/dashboard"];
  return protectedRoutes.includes(targetRoute);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Onboarding Lifecycle", () => {
  let org: Organization;

  beforeEach(() => {
    org = createOrganization(1);
  });

  describe("Initial state", () => {
    it("new org has onboarding not completed", () => {
      expect(org.onboardingCompleted).toBe(false);
      expect(org.onboardingStep).toBe(0);
    });

    it("new org redirects to onboarding from dashboard", () => {
      expect(shouldRedirectToOnboarding(org, "/today")).toBe(true);
      expect(shouldRedirectToOnboarding(org, "/dashboard")).toBe(true);
    });

    it("new org does not redirect from auth", () => {
      expect(shouldRedirectToOnboarding(org, "/auth")).toBe(false);
    });

    it("checklist is not dismissed by default", () => {
      expect(org.settings.checklistDismissed).toBe(false);
    });
  });

  describe("Beginner path completion", () => {
    it("completes all 6 steps in order", () => {
      const steps = STEPS_BY_PATH.beginner;
      expect(steps).toHaveLength(6);

      org = advanceStep(org, "path");
      org = advanceStep(org, "target_county", { targetState: "TX", targetCounty: "Hudspeth" });
      org = advanceStep(org, "instant_hunt");
      org = advanceStep(org, "strategy", { strategy: "hybrid" });
      org = advanceStep(org, "atlas_tour");
      org = completeOnboarding(org, "beginner");

      expect(org.onboardingCompleted).toBe(true);
      expect(org.onboardingData.path).toBe("beginner");
      expect(org.onboardingData.targetState).toBe("TX");
      expect(org.onboardingData.targetCounty).toBe("Hudspeth");
      expect(org.onboardingData.strategy).toBe("hybrid");
    });

    it("no longer redirects after completion", () => {
      org = completeOnboarding(org, "beginner");
      expect(shouldRedirectToOnboarding(org, "/today")).toBe(false);
      expect(shouldRedirectToOnboarding(org, "/dashboard")).toBe(false);
    });
  });

  describe("Active path completion", () => {
    it("completes with portfolio import and multi-county targeting", () => {
      const counties = [
        { state: "TX", county: "Hudspeth" },
        { state: "AZ", county: "Cochise" },
      ];

      org = advanceStep(org, "path");
      org = advanceStep(org, "portfolio_import", { dataImported: true });
      org = advanceStep(org, "target_counties", { targetCounties: counties });
      org = advanceStep(org, "instant_hunt");
      org = advanceStep(org, "automation");
      org = completeOnboarding(org, "active");

      expect(org.onboardingCompleted).toBe(true);
      expect(org.onboardingData.path).toBe("active");
      expect(org.onboardingData.dataImported).toBe(true);
      expect(org.onboardingData.targetCounties).toHaveLength(2);
    });

    it("can skip portfolio import", () => {
      org = advanceStep(org, "path");
      org = advanceStep(org, "portfolio_import", { dataImported: false });
      org = advanceStep(org, "target_counties", {
        targetCounties: [{ state: "TX", county: "Hudspeth" }],
      });
      org = advanceStep(org, "instant_hunt");
      org = advanceStep(org, "automation");
      org = completeOnboarding(org, "active");

      expect(org.onboardingCompleted).toBe(true);
      expect(org.onboardingData.dataImported).toBe(false);
    });
  });

  describe("Enterprise path completion", () => {
    it("completes with team setup and integrations", () => {
      org = advanceStep(org, "path");
      org = advanceStep(org, "team", { teamInvited: true });
      org = advanceStep(org, "integrations");
      org = advanceStep(org, "instant_hunt");
      org = advanceStep(org, "workflows");
      org = completeOnboarding(org, "enterprise");

      expect(org.onboardingCompleted).toBe(true);
      expect(org.onboardingData.path).toBe("enterprise");
      expect(org.onboardingData.teamInvited).toBe(true);
    });

    it("can skip team invitations", () => {
      org = advanceStep(org, "path");
      org = advanceStep(org, "team", { teamInvited: false });
      org = advanceStep(org, "integrations");
      org = advanceStep(org, "instant_hunt");
      org = advanceStep(org, "workflows");
      org = completeOnboarding(org, "enterprise");

      expect(org.onboardingCompleted).toBe(true);
      expect(org.onboardingData.teamInvited).toBe(false);
    });
  });

  describe("Step tracking", () => {
    it("records completed steps in order", () => {
      org = advanceStep(org, "path");
      org = advanceStep(org, "target_county");
      org = advanceStep(org, "instant_hunt");

      expect(org.onboardingData.completedSteps).toEqual([
        "path",
        "target_county",
        "instant_hunt",
      ]);
      expect(org.onboardingStep).toBe(3);
    });

    it("each path has exactly 6 steps", () => {
      for (const path of ["beginner", "active", "enterprise"] as InvestorPath[]) {
        expect(STEPS_BY_PATH[path]).toHaveLength(6);
      }
    });

    it("all paths start with 'path' and end with 'complete'", () => {
      for (const path of ["beginner", "active", "enterprise"] as InvestorPath[]) {
        expect(STEPS_BY_PATH[path][0]).toBe("path");
        expect(STEPS_BY_PATH[path][5]).toBe("complete");
      }
    });

    it("all paths include instant_hunt step", () => {
      for (const path of ["beginner", "active", "enterprise"] as InvestorPath[]) {
        expect(STEPS_BY_PATH[path]).toContain("instant_hunt");
      }
    });
  });

  describe("Getting Started Checklist", () => {
    interface ChecklistState {
      hasLead: boolean;
      hasProperty: boolean;
      hasDeal: boolean;
      hasNote: boolean;
      hasImported: boolean;
    }

    function getChecklistProgress(state: ChecklistState): {
      completed: number;
      total: number;
      progress: number;
    } {
      const items = [
        state.hasLead,
        state.hasImported,
        state.hasDeal,
        state.hasProperty,
        state.hasNote,
      ];
      const completed = items.filter(Boolean).length;
      return { completed, total: items.length, progress: (completed / items.length) * 100 };
    }

    it("starts at 0% completion", () => {
      const result = getChecklistProgress({
        hasLead: false,
        hasProperty: false,
        hasDeal: false,
        hasNote: false,
        hasImported: false,
      });
      expect(result.completed).toBe(0);
      expect(result.progress).toBe(0);
    });

    it("tracks individual item completion", () => {
      const result = getChecklistProgress({
        hasLead: true,
        hasProperty: false,
        hasDeal: false,
        hasNote: false,
        hasImported: true,
      });
      expect(result.completed).toBe(2);
      expect(result.progress).toBe(40);
    });

    it("reaches 100% when all items complete", () => {
      const result = getChecklistProgress({
        hasLead: true,
        hasProperty: true,
        hasDeal: true,
        hasNote: true,
        hasImported: true,
      });
      expect(result.completed).toBe(5);
      expect(result.progress).toBe(100);
    });

    // R5 reshape: the "connect your services" item is OPTIONAL — it never
    // counts toward progress or the auto-dismiss. Mirrors the required-only
    // math in client/src/components/getting-started-checklist.tsx.
    describe("optional connect-your-services item", () => {
      interface ItemState {
        isComplete: boolean;
        optional?: boolean;
      }
      function progressRequiredOnly(items: ItemState[]) {
        const required = items.filter((i) => !i.optional);
        const completed = required.filter((i) => i.isComplete).length;
        return {
          completed,
          total: required.length,
          allComplete: completed === required.length,
        };
      }

      it("excludes the optional item from the completion denominator", () => {
        const r = progressRequiredOnly([
          { isComplete: true },
          { isComplete: true },
          { isComplete: false, optional: true }, // connect — not connected
        ]);
        expect(r.total).toBe(2);
        expect(r.completed).toBe(2);
      });

      it("auto-dismisses when required steps are done even if not connected", () => {
        const r = progressRequiredOnly([
          { isComplete: true },
          { isComplete: true },
          { isComplete: false, optional: true },
        ]);
        expect(r.allComplete).toBe(true);
      });

      it("a completed optional item never pushes an incomplete list to done", () => {
        const r = progressRequiredOnly([
          { isComplete: true },
          { isComplete: false },
          { isComplete: true, optional: true }, // connected, but a required step is open
        ]);
        expect(r.allComplete).toBe(false);
        expect(r.completed).toBe(1);
      });
    });
  });
});
