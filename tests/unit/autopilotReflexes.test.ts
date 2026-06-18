import { describe, it, expect } from "vitest";
import { summarizeReflexHealth, reflexHealthLine } from "../../server/services/autopilot/reflexes";
import { rankMoves, type DecisionSenses } from "../../server/services/autopilot/decide";

const calm: DecisionSenses = {
  openIncidents: 0, complianceOpenCount: 0, envelopeStatus: "green", supportBacklog: 0,
  trials: 0, activationStalled: false, mrr: 0, dispatchBacklog: 0,
};

describe("reflexes — summarizeReflexHealth (pure)", () => {
  it("is healthy when no failures (skipped_lock is not a failure)", () => {
    const h = summarizeReflexHealth([
      { jobName: "churn_engine_daily", status: "success" },
      { jobName: "dunning_tasks", status: "skipped_lock" },
    ]);
    expect(h.healthy).toBe(true);
    expect(h.failed).toBe(0);
    expect(h.totalRuns).toBe(2);
  });

  it("counts failed + timeout and lists distinct failing jobs sorted", () => {
    const h = summarizeReflexHealth([
      { jobName: "dunning_tasks", status: "failed" },
      { jobName: "dunning_tasks", status: "failed" },
      { jobName: "churn_engine_daily", status: "timeout" },
      { jobName: "backup", status: "success" },
    ]);
    expect(h.healthy).toBe(false);
    expect(h.failed).toBe(3);
    expect(h.failingJobs).toEqual(["churn_engine_daily", "dunning_tasks"]);
  });

  it("renders a letter line", () => {
    expect(reflexHealthLine(summarizeReflexHealth([]))).toContain("no runs");
    expect(reflexHealthLine(summarizeReflexHealth([{ jobName: "x", status: "success" }]))).toContain("all healthy");
    expect(reflexHealthLine(summarizeReflexHealth([{ jobName: "dunning_tasks", status: "failed" }]))).toContain("dunning_tasks");
  });
});

describe("decide — reflex failures are a P1 stabilize move", () => {
  it("emits stabilize_reflexes when an autonomous job is failing", () => {
    const moves = rankMoves({ ...calm, reflexFailures: 2 });
    const m = moves.find((x) => x.kind === "stabilize_reflexes");
    expect(m).toBeTruthy();
    expect(m!.priority).toBe(1);
  });

  it("does not emit it when reflexes are healthy", () => {
    expect(rankMoves(calm).find((x) => x.kind === "stabilize_reflexes")).toBeUndefined();
  });
});
