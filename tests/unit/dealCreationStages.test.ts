import { beforeEach, describe, expect, it, vi } from "vitest";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/stripComments";
import { DEAL_STATUSES, OPENING_DEAL_STATUSES } from "@shared/lifecycle/pipeline-status";
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });
const h = vi.hoisted(() => ({ insert: vi.fn(), publish: vi.fn() }));
vi.mock("../../server/db", () => ({ db: { insert: h.insert } }));
vi.mock("../../server/services/dealLifecycleEvents", () => ({ publishDealLifecycle: h.publish, recordDealTransitionEvidence: vi.fn() }));
import { dealRepo } from "../../server/storage/dealRepo";
const create = (status?: string | null, source?: "historical_import" | "sample_fixture") =>
  dealRepo.createDeal.call({} as any, { organizationId: 7, propertyId: 4, type: "disposition", ...(status === undefined ? {} : { status }) } as any, undefined, source ? { source } : undefined);
beforeEach(() => {
  vi.clearAllMocks();
  h.insert.mockReturnValue({ values: (data: Record<string, unknown>) => ({ returning: async () => [{ id: 1, ...data }] }) });
});
describe("repository deal creation follows the canonical opening-stage rule", () => {
  it.each(["closed", "in_escrow", "cancelled", "listed", "bogus", ""])("refuses ordinary status %s before insert or events", async status => {
    await expect(create(status)).rejects.toThrow(/creat|status/i);
    expect(h.insert).not.toHaveBeenCalled(); expect(h.publish).not.toHaveBeenCalled();
  });
  it.each(OPENING_DEAL_STATUSES)("accepts canonical opening stage %s", async status => {
    await expect(create(status)).resolves.toMatchObject({ status });
    expect(h.insert).toHaveBeenCalledOnce();
  });
  it.each([undefined, null])("normalizes an omitted/null stage to the actual default", async status => {
    await expect(create(status)).resolves.toMatchObject({ status: "negotiating" });
  });
  it.each(DEAL_STATUSES)("historical imports retain canonical stage %s", async status => {
    await expect(create(status, "historical_import")).resolves.toMatchObject({ status });
  });
  it.each(["historical_import", "sample_fixture"] as const)("%s never permits invented vocabulary", async source => {
    await expect(create("listed", source)).rejects.toThrow(/status/i);
    expect(h.insert).not.toHaveBeenCalled();
  });
  it("supports labelled late-stage fixtures", async () => {
    await expect(create("closed", "sample_fixture")).resolves.toMatchObject({ status: "closed" });
  });
  it("cannot select historical mode through a data field", async () => {
    await expect(dealRepo.createDeal.call({} as any, { organizationId: 7, status: "closed", source: "historical_import" } as any)).rejects.toThrow();
    expect(h.insert).not.toHaveBeenCalled();
  });
});

it("historical creation exceptions are confined to the reviewed importer and labelled seeders", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { resolve, join, relative } = await import("node:path");
  const ts = await import("typescript");
  const root = resolve(__dirname, "../../server");
  const exceptions: string[] = []; let callers = 0; const directInserts: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { scan(path); continue; }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      const src = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
      function visit(node: import("typescript").Node) {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          if (node.expression.name.text === "createDeal") {
            callers++;
            if (node.arguments[2]) exceptions.push(`${relative(root, path)}:${node.arguments[2].getText(src)}`);
          }
          if (node.expression.name.text === "insert" && node.arguments[0]?.getText(src) === "deals") directInserts.push(relative(root, path));
        }
        ts.forEachChild(node, visit);
      }
      visit(src);
    }
  }
  scan(root);
  expect(callers).toBeGreaterThanOrEqual(6);
  expect(directInserts).toEqual(["storage/dealRepo.ts"]);
  expect(exceptions.sort()).toEqual([
    'services/importExport.ts:{ source: "historical_import" }',
    'services/onboarding/demoDataSeeder.ts:{ source: "sample_fixture" }',
    'services/onboarding/sampleSeeder.ts:{ source: "sample_fixture" }',
  ]);
});
