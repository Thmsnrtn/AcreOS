import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, readdir, unlink } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { execSync, execFileSync } from "child_process";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "compression",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

function resolveGitSha(): string {
  if (process.env.VITE_GIT_SHA) return process.env.VITE_GIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

/**
 * The client's two Vite outputs (P1-9 / X-2): the customer bundle that
 * server/static.ts serves at `/`, and the founder bundle it serves under
 * `/founder-app/`. Both are SERVED directories, so both get their source maps
 * uploaded to Sentry and then deleted.
 */
const CLIENT_OUTPUT_DIRS = ["dist/public", "dist/founder"] as const;

/**
 * Inject + upload source maps to Sentry. Runs only on production
 * builds (NODE_ENV=production). In CI we hard-fail if SENTRY_AUTH_TOKEN
 * is missing — silently skipping makes Sentry useless because stack
 * traces remain minified. Set SENTRY_SOURCEMAPS=skip to opt out
 * locally (e.g. when iterating on the build itself).
 */
async function uploadSourceMapsToSentry(release: string): Promise<void> {
  if (process.env.SENTRY_SOURCEMAPS === "skip") {
    console.log("[sentry] SENTRY_SOURCEMAPS=skip — bypassing upload");
    return;
  }

  const isCI = !!process.env.CI;
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;

  if (!token) {
    if (isCI) {
      throw new Error(
        "[sentry] SENTRY_AUTH_TOKEN is required in CI — broken source maps make Sentry useless. Set the secret or export SENTRY_SOURCEMAPS=skip explicitly."
      );
    }
    console.warn("[sentry] SENTRY_AUTH_TOKEN not set — skipping source-map upload (local build)");
    return;
  }

  if (!org || !project) {
    throw new Error("[sentry] SENTRY_ORG and SENTRY_PROJECT must be set when SENTRY_AUTH_TOKEN is provided.");
  }

  const env = { ...process.env, SENTRY_AUTH_TOKEN: token, SENTRY_ORG: org, SENTRY_PROJECT: project };
  const opts = { stdio: "inherit" as const, env };

  // Both client outputs (customer + founder, P1-9 / X-2) carry hidden maps; the
  // founder output's stack traces need symbolicating exactly like the customer's.
  for (const dir of CLIENT_OUTPUT_DIRS) {
    console.log(`[sentry] injecting debug ids into source maps in ${dir} (release=${release})...`);
    execFileSync("npx", ["--yes", "@sentry/cli", "sourcemaps", "inject", `./${dir}`], opts);

    console.log(`[sentry] uploading source maps from ${dir} for release=${release}...`);
    execFileSync(
      "npx",
      ["--yes", "@sentry/cli", "sourcemaps", "upload", `--release=${release}`, `./${dir}`],
      opts
    );
  }

  console.log(`[sentry] source-map upload complete for release=${release}`);
}

/**
 * Delete every source map from the SERVED asset directory.
 *
 * ── WHY THIS IS NOT OPTIONAL ────────────────────────────────────────────────
 * `sourcemap: "hidden"` in vite.config.ts suppresses the
 * `//# sourceMappingURL` comment — but it still WRITES the .map files, and
 * server/static.ts mounts express.static(distPath) with no extension filter.
 * The URL is derivable from the script tag in the HTML, so every map was
 * publicly fetchable.
 *
 * Observed on production 2026-09-04, not inferred:
 *
 *     GET https://acreos.io/assets/index-BHxNHrKf.js.map  ->  200, 5,239,629 bytes
 *
 * 474 maps, 55 MB, containing the original TypeScript with the comments that
 * name the security gates, the founder-only surfaces and the tenant-isolation
 * reasoning. It de-minifies JavaScript the browser already receives — no
 * server code, no credentials, no tenant data — so this is a readability
 * exposure rather than a breach. It is still ours to close, and the close is
 * one delete.
 *
 * When the upload above runs, Sentry keeps its own copy. An explicitly
 * skipped upload carries no symbolication proof. Deleting maps here rather
 * than not emitting them is deliberate: an upload needs the files to exist.
 */
async function stripSourceMapsFromDist(): Promise<void> {
  // BOTH served client outputs — a founder output outside this list would ship
  // its hidden maps (the highest-severity gotcha of the two-output split).
  for (const root of CLIENT_OUTPUT_DIRS) {
    await stripSourceMapsFrom(root);
  }
}

async function stripSourceMapsFrom(root: string): Promise<void> {
  let removed = 0;
  let bytes = 0;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // the directory may not exist on a partial build
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      // The compression plugin emits .map.gz / .map.br beside each .map, and
      // those are just as readable. Matching on ".map" anywhere in the tail
      // catches all three.
      if (!/\.map(\.gz|\.br)?$/.test(entry.name)) continue;
      const { statSync } = await import("fs");
      try {
        bytes += statSync(full).size;
      } catch {
        /* size is for the log line only */
      }
      await unlink(full);
      removed += 1;
    }
  }

  await walk(root);
  console.log(
    `[build] removed ${removed} source map(s) from ${root} (${(bytes / 1_048_576).toFixed(1)} MB)`,
  );

  // Assert, do not assume. A silent no-op here restores the exposure while the
  // log line above still reads like a success.
  const survivors: string[] = [];
  async function verify(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await verify(full);
      else if (/\.map(\.gz|\.br)?$/.test(entry.name)) survivors.push(full);
    }
  }
  await verify(root);
  if (survivors.length > 0) {
    throw new Error(
      `[build] ${survivors.length} source map(s) survived into the served asset directory ` +
        `and would be publicly fetchable:\n  ${survivors.slice(0, 10).join("\n  ")}`,
    );
  }
}

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  // Make sure VITE_GIT_SHA is consistent across vite + sentry-cli
  const release = resolveGitSha();
  process.env.VITE_GIT_SHA = release;

  // Verify sitemap.xml is fresh against the CANONICAL generator
  // (scripts/generate-sitemap.mjs — the one CI's staleness gate runs).
  // The build previously REGENERATED sitemap.xml + robots.txt here via
  // script/generate-sitemap.ts, a second generator with a different URL
  // set (it re-listed the noindex'd /compare pages the canonical one
  // deliberately excludes and rewrote robots.txt). Two generators meant
  // every local build dirtied the tree with a version CI then rejected
  // as stale. The committed files are the source of truth; --check makes
  // a genuinely stale sitemap fail the build instead of being silently
  // overwritten.
  console.log("[seo] checking sitemap.xml freshness (canonical generator)...");
  const { execSync: exec } = await import("child_process");
  exec("node scripts/generate-sitemap.mjs --check", { stdio: "inherit" });

  console.log(`building client (release=${release})...`);
  await viteBuild();

  // The founder output (P1-9 / X-2): client/founder.html → dist/founder, base
  // /founder-app/. A second build, not a second entry of the first, so the
  // customer chunk graph and bundle total never see a founder module.
  console.log("building founder client...");
  await viteBuild({ configFile: "vite.founder.config.ts" });
  if (!existsSync("dist/founder/founder.html")) {
    throw new Error(
      "[build] the founder build emitted no dist/founder/founder.html — server/static.ts would serve " +
        "the customer shell (which has no founder routes) for every /founder URL",
    );
  }

  // Pre-render the public marketing routes so /pricing, /security,
  // /changelog, /glossary serve route-specific <title>, <meta
  // description>, OG tags, and inline JSON-LD even before the SPA
  // hydrates. This is the SEO substance step from Wave 23-26.
  console.log("[prerender] generating per-route index.html shells...");
  exec("npx tsx script/prerender.ts", { stdio: "inherit" });

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // Worker bundle — separate entry consumed by the `worker` Fly process
  // group. Reuses the same externals so Postgres / Sentry / OpenAI
  // resolve at runtime. Kept minified so cold start stays fast.
  console.log("building worker...");
  await esbuild({
    entryPoints: ["server/worker.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/worker.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  // Upload AFTER both client + server are built so the dist/public dir
  // is final. Server release tag is set via SENTRY_RELEASE env at runtime
  // (server reads it in initSentry) so client + server agree on release.
  if (process.env.NODE_ENV === "production") {
    await uploadSourceMapsToSentry(release);
  }

  // ALWAYS, not only in production. A dev or preview build that serves
  // dist/public exposes the same files, and "we only ship maps by accident on
  // non-production hosts" is not a property anyone can check.
  await stripSourceMapsFromDist();
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
