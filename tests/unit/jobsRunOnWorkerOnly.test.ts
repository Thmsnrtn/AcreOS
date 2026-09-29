/**
 * Founder ruling 2026-09-29 #5 — background jobs run on the worker only.
 *
 * Both Fly process groups booted the scheduler because nothing set
 * DISABLE_BACKGROUND_JOBS=1 on the app (DEFECT-0049). The app now stands
 * down whenever Fly says it is the `app` group; the worker still boots the
 * scheduler; a single-process run (no Fly group) keeps it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../helpers/stripComments";
import { appProcessRunsScheduledJobs } from "../../server/jobs/jobPlacement";

describe("where the scheduler runs", () => {
  it("the Fly app process group does not run it", () => {
    expect(appProcessRunsScheduledJobs({ FLY_PROCESS_GROUP: "app" }).run).toBe(false);
  });
  it("a single-process run (no Fly group) keeps it", () => {
    expect(appProcessRunsScheduledJobs({}).run).toBe(true);
  });
  it("DISABLE_BACKGROUND_JOBS=1 still turns it off; the explicit override turns it back on", () => {
    expect(appProcessRunsScheduledJobs({ DISABLE_BACKGROUND_JOBS: "1" }).run).toBe(false);
    expect(appProcessRunsScheduledJobs({ FLY_PROCESS_GROUP: "app", APP_RUN_BACKGROUND_JOBS: "1" }).run).toBe(true);
  });
  it("the app boot actually consults the rule, and the worker still boots the scheduler", () => {
    const app = stripComments(readFileSync("server/index.ts", "utf8"));
    expect(app).toMatch(/appProcessRunsScheduledJobs\(\)/);
    expect(app).not.toMatch(/process\.env\.DISABLE_BACKGROUND_JOBS\s*===\s*"1"/);
    const worker = stripComments(readFileSync("server/worker.ts", "utf8"));
    expect(worker).toMatch(/runScheduledJobs\(\)/);
  });
  it("fly.toml still declares a worker process group to run it", () => {
    expect(readFileSync("fly.toml", "utf8")).toMatch(/\[processes\][\s\S]*worker\s*=/);
  });
});
