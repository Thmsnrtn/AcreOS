/**
 * Infrastructure restraint gate — proof that it BITES.
 *
 * scripts/check-infrastructure-restraint.mjs currently passes, because the repo
 * genuinely has zero non-canonical infrastructure primitives across 165
 * dependencies. That is exactly the condition under which a gate is most likely
 * to be quietly broken and never noticed: a check that only ever passes is
 * indistinguishable from a check that cannot fail.
 *
 * So these tests run the real script against synthetic repos — a temp directory
 * with a doctored package.json and infra config — and assert it exits non-zero
 * for each banned primitive the Master Audit names (BI56, BL7), and zero for the
 * things it must NOT ban.
 *
 * The most important test is the last one: a Postgres EXTENSION (pgvector) must
 * NOT trip the vector-database rule. pgvector runs inside the one primary
 * relational database, so it is a derived index rather than an alternate system
 * of record — permitted by BI57 and required by BI61. A gate that banned it
 * would be wrong, and would be disabled within a week.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const SCRIPT = path.join(ROOT, "scripts/check-infrastructure-restraint.mjs");

let tmpRoot: string;

/** Build a throwaway repo and run the REAL gate against it. */
function runGateOn(pkg: Record<string, unknown>, configs: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(tmpRoot, "repo-"));
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  for (const [name, body] of Object.entries(configs)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  // The script resolves REPO_ROOT as the parent of its own directory, so it must
  // be copied into <dir>/scripts/ to treat <dir> as the repo.
  fs.copyFileSync(SCRIPT, path.join(dir, "scripts", path.basename(SCRIPT)));

  try {
    const stdout = execFileSync(
      process.execPath,
      [path.join(dir, "scripts", path.basename(SCRIPT))],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output: stdout };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "infra-restraint-"));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("the gate passes on the real repo", () => {
  it("exits 0 at HEAD", () => {
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      cwd: ROOT,
    });
    expect(stdout).toContain("PASS");
    expect(stdout).toContain("banned primitives found: 0");
  });
});

describe("the gate BITES — each banned primitive is caught", () => {
  const cases: Array<[string, string]> = [
    ["graph database", "neo4j-driver"],
    ["vector database service", "@pinecone-database/pinecone"],
    ["streaming bus", "kafkajs"],
    ["data warehouse", "snowflake-sdk"],
    ["kubernetes client", "@kubernetes/client-node"],
    ["search cluster", "@elastic/elasticsearch"],
  ];

  for (const [label, dep] of cases) {
    it(`rejects an unregistered ${label} (${dep})`, () => {
      const res = runGateOn({ dependencies: { [dep]: "^1.0.0" } });
      expect(res.code, `${dep} must fail the gate`).toBe(1);
      expect(res.output).toContain("FAIL");
      expect(res.output).toContain(dep);
      // The failure must teach BI152's test, not just say "no".
      expect(res.output).toContain("MEASURED");
    });
  }

  it("catches a primitive that appears only in deploy config", () => {
    const res = runGateOn(
      { dependencies: {} },
      { "docker-compose.yml": "services:\n  search:\n    image: elasticsearch:8\n" },
    );
    // A dependency-only scan would miss this — infrastructure arrives through
    // config at least as often as through npm.
    expect(res.code).toBe(1);
    expect(res.output).toContain("docker-compose.yml");
  });

  it("catches an orchestration directory existing at all", () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "k8srepo-"));
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.mkdirSync(path.join(dir, "k8s"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: {} }));
    fs.copyFileSync(SCRIPT, path.join(dir, "scripts", path.basename(SCRIPT)));
    let code = 0;
    let output = "";
    try {
      output = execFileSync(
        process.execPath,
        [path.join(dir, "scripts", path.basename(SCRIPT))],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      code = e.status ?? 1;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(code).toBe(1);
    expect(output).toContain("k8s/");
  });
});

describe("the gate does NOT overreach", () => {
  it("allows pgvector — a Postgres extension is not a vector database", () => {
    // BI57 permits embeddings as a capability-specific index; BI61 requires one
    // primary relational database with specialised stores as derived indexes.
    // pgvector satisfies both because it lives INSIDE Postgres. A gate that
    // banned it would be wrong, and would be disabled within a week.
    const res = runGateOn(
      { dependencies: { pgvector: "^0.2.0", "drizzle-orm": "^0.30.0" } },
      { "fly.pgvector.staging.toml": 'app = "acreos-pgvector-staging"\n' },
    );
    expect(res.code, "pgvector must not trip the gate").toBe(0);
    expect(res.output).toContain("PASS");
  });

  it("allows the ordinary stack", () => {
    const res = runGateOn({
      dependencies: {
        express: "^4",
        "drizzle-orm": "^0.30",
        pg: "^8",
        bullmq: "^5",
        ioredis: "^5",
        stripe: "^14",
        react: "^18",
      },
    });
    expect(res.code).toBe(0);
  });
});

describe("the gate is wired into the build", () => {
  it("runs inside npm run check", () => {
    // A gate nobody runs is a file, not a gate — this repo's own most common
    // defect class, aimed at governance instead of features.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["lint:infrastructure-restraint"]).toContain(
      "check-infrastructure-restraint.mjs",
    );
    expect(pkg.scripts.check).toContain("lint:infrastructure-restraint");
  });
});
