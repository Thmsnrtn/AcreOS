import { describe, it, expect, vi } from "vitest";

vi.mock("../../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

vi.mock("../../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  reportCapabilityGap,
  getCapabilityGap,
  listCapabilityGaps,
  updateGapStatus,
  proposeSolution,
  getSolution,
  listSolutions,
  approveSolution,
  rejectSolution,
  createProvisioningTasks,
  getProvisioningTasks,
  updateTaskStatus,
  getSelfProvisioningSummary,
} from "../../../server/services/scpSelfProvisioning";

describe("SCP v3 Self-Provisioning", () => {
  describe("Capability Gap Detection", () => {
    it("reports a new capability gap", () => {
      const gap = reportCapabilityGap({
        title: "No Slack Integration",
        description: "Cannot send notifications to team Slack channels",
        detected_by: "sentinel_devops",
        category: "integration",
        severity: "high",
        impact_description: "Incident alerts delayed by email latency",
        blocked_workflows: ["incident_response", "deploy_notification"],
      });

      expect(gap.id).toBeTruthy();
      expect(gap.status).toBe("detected");
      expect(gap.frequency).toBe(1);
    });

    it("deduplicates gaps by title", () => {
      const gap1 = reportCapabilityGap({
        title: "No Webhook Support",
        description: "Cannot receive webhooks from partners",
        detected_by: "atlas_cto",
        category: "integration",
        severity: "medium",
        impact_description: "Manual data sync needed",
      });

      const gap2 = reportCapabilityGap({
        title: "No Webhook Support",
        description: "Different description, same gap",
        detected_by: "forge_revenue",
        category: "integration",
        severity: "medium",
        impact_description: "Also affected",
      });

      expect(gap1.id).toBe(gap2.id);
      expect(gap2.frequency).toBe(2);
    });

    it("lists gaps sorted by severity then frequency", () => {
      reportCapabilityGap({
        title: "Critical Gap",
        description: "Critical issue",
        detected_by: "sentinel_devops",
        category: "infrastructure",
        severity: "critical",
        impact_description: "System down",
      });

      const gaps = listCapabilityGaps();
      expect(gaps[0].severity).toBe("critical");
    });

    it("filters gaps by category", () => {
      const integrationGaps = listCapabilityGaps({ category: "integration" });
      expect(integrationGaps.every((g) => g.category === "integration")).toBe(true);
    });
  });

  describe("Solution Proposals", () => {
    it("proposes a solution for a gap", () => {
      const gap = reportCapabilityGap({
        title: "No Calendar Integration",
        description: "Cannot sync with Google Calendar",
        detected_by: "harbor_csm",
        category: "integration",
        severity: "medium",
        impact_description: "Manual scheduling required",
      });

      const result = proposeSolution({
        gap_id: gap.id,
        title: "Google Calendar API Integration",
        description: "Integrate with Google Calendar API for meeting scheduling",
        approach: "integrate",
        proposed_by: "atlas_cto",
        estimated_effort_hours: 40,
        estimated_cost_usd: 0,
        expected_benefit: "Automated meeting scheduling for CSM",
        risk_assessment: "Low risk, well-documented API",
        implementation_steps: [
          "Set up OAuth2 credentials",
          "Build calendar sync service",
          "Add to integration fabric",
          "Test with CSM workflows",
        ],
      });

      expect(result.success).toBe(true);
      expect(result.solution!.score).toBeGreaterThan(0);
      expect(result.solution!.status).toBe("draft");
    });

    it("rejects solution for non-existent gap", () => {
      const result = proposeSolution({
        gap_id: "nonexistent",
        title: "Test",
        description: "Test",
        approach: "build",
        proposed_by: "atlas_cto",
        estimated_effort_hours: 10,
        estimated_cost_usd: 0,
        expected_benefit: "None",
        risk_assessment: "N/A",
        implementation_steps: ["Do nothing"],
      });

      expect(result.success).toBe(false);
    });

    it("approves a solution", () => {
      const gap = reportCapabilityGap({
        title: "No PDF Export",
        description: "Cannot export reports as PDF",
        detected_by: "oracle_analytics",
        category: "automation",
        severity: "low",
        impact_description: "Manual PDF creation",
      });

      const { solution } = proposeSolution({
        gap_id: gap.id,
        title: "Add PDF library",
        description: "Use puppeteer for PDF generation",
        approach: "build",
        proposed_by: "atlas_cto",
        estimated_effort_hours: 8,
        estimated_cost_usd: 0,
        expected_benefit: "Automated reports",
        risk_assessment: "Low",
        implementation_steps: ["Install puppeteer", "Build PDF service", "Wire to reports"],
      });

      expect(approveSolution(solution!.id)).toBe(true);
      expect(getSolution(solution!.id)!.status).toBe("approved");
      expect(getCapabilityGap(gap.id)!.status).toBe("approved");
    });

    it("rejects a solution", () => {
      const gap = reportCapabilityGap({
        title: "No Video Calls",
        description: "Cannot do in-app video",
        detected_by: "harbor_csm",
        category: "communication",
        severity: "low",
        impact_description: "Use external tools",
      });

      const { solution } = proposeSolution({
        gap_id: gap.id,
        title: "Build video calling",
        description: "Too complex",
        approach: "build",
        proposed_by: "atlas_cto",
        estimated_effort_hours: 500,
        estimated_cost_usd: 10000,
        expected_benefit: "In-app calls",
        risk_assessment: "Very high effort",
        implementation_steps: ["Research WebRTC", "Build infrastructure"],
      });

      expect(rejectSolution(solution!.id)).toBe(true);
      expect(getSolution(solution!.id)!.status).toBe("rejected");
    });

    it("lists solutions sorted by score", () => {
      const sols = listSolutions();
      for (let i = 1; i < sols.length; i++) {
        expect(sols[i - 1].score).toBeGreaterThanOrEqual(sols[i].score);
      }
    });
  });

  describe("Provisioning Pipeline", () => {
    it("creates provisioning tasks from approved solution", () => {
      const gap = reportCapabilityGap({
        title: "No SMS Templates",
        description: "Cannot template SMS messages",
        detected_by: "harbor_csm",
        category: "automation",
        severity: "medium",
        impact_description: "Manual SMS composition",
      });

      const { solution } = proposeSolution({
        gap_id: gap.id,
        title: "SMS Template Engine",
        description: "Build template system for SMS",
        approach: "build",
        proposed_by: "atlas_cto",
        estimated_effort_hours: 16,
        estimated_cost_usd: 0,
        expected_benefit: "Faster SMS workflows",
        risk_assessment: "Low",
        implementation_steps: [
          "Design template schema",
          "Build template engine",
          "Add template management UI",
          "Integrate with SMS service",
        ],
      });

      approveSolution(solution!.id);

      const tasks = createProvisioningTasks(solution!.id, [
        { step_index: 0, assigned_agent: "atlas_cto" },
        { step_index: 1, assigned_agent: "atlas_cto" },
        { step_index: 2, assigned_agent: "prism_ux" },
        { step_index: 3, assigned_agent: "sentinel_devops" },
      ]);

      expect(tasks.length).toBe(4);
      expect(tasks[0].assigned_agent).toBe("atlas_cto");
      expect(tasks[2].assigned_agent).toBe("prism_ux");
      expect(getCapabilityGap(gap.id)!.status).toBe("implementing");
    });

    it("resolves gap when all tasks complete", () => {
      const gap = reportCapabilityGap({
        title: "No Auto-Retry",
        description: "Failed API calls not retried",
        detected_by: "sentinel_devops",
        category: "infrastructure",
        severity: "high",
        impact_description: "Transient failures cause data loss",
      });

      const { solution } = proposeSolution({
        gap_id: gap.id,
        title: "Add retry middleware",
        description: "Exponential backoff retry",
        approach: "build",
        proposed_by: "sentinel_devops",
        estimated_effort_hours: 4,
        estimated_cost_usd: 0,
        expected_benefit: "Resilient API calls",
        risk_assessment: "Low",
        implementation_steps: ["Build retry utility", "Wire to HTTP client"],
      });

      approveSolution(solution!.id);
      const tasks = createProvisioningTasks(solution!.id, []);

      for (const task of tasks) {
        updateTaskStatus(task.id, "in_progress");
        updateTaskStatus(task.id, "completed");
      }

      expect(getCapabilityGap(gap.id)!.status).toBe("resolved");
    });

    it("won't create tasks for non-approved solutions", () => {
      const gap = reportCapabilityGap({
        title: "No GraphQL",
        description: "REST only",
        detected_by: "atlas_cto",
        category: "infrastructure",
        severity: "low",
        impact_description: "Over-fetching data",
      });

      const { solution } = proposeSolution({
        gap_id: gap.id,
        title: "Add GraphQL",
        description: "Complex migration",
        approach: "build",
        proposed_by: "atlas_cto",
        estimated_effort_hours: 200,
        estimated_cost_usd: 0,
        expected_benefit: "Better API",
        risk_assessment: "High",
        implementation_steps: ["Migrate to GraphQL"],
      });

      // Not approved — should return empty
      const tasks = createProvisioningTasks(solution!.id, []);
      expect(tasks.length).toBe(0);
    });
  });

  describe("Self-Provisioning Summary", () => {
    it("returns comprehensive summary", () => {
      const summary = getSelfProvisioningSummary();
      expect(summary.total_gaps).toBeGreaterThan(0);
      expect(summary.by_severity).toBeDefined();
      expect(summary.by_category).toBeDefined();
      expect(summary.total_solutions).toBeGreaterThan(0);
      expect(summary.resolved_gaps).toBeGreaterThan(0);
    });
  });
});
