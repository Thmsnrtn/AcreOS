import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";
import { execSync } from "child_process";

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

  console.log(`[sentry] injecting debug ids into source maps (release=${release})...`);
  execSync(`npx --yes @sentry/cli sourcemaps inject ./dist/public`, opts);

  console.log(`[sentry] uploading source maps for release=${release}...`);
  execSync(
    `npx --yes @sentry/cli sourcemaps upload --release=${release} ./dist/public`,
    opts
  );

  console.log(`[sentry] source-map upload complete for release=${release}`);
}

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  // Make sure VITE_GIT_SHA is consistent across vite + sentry-cli
  const release = resolveGitSha();
  process.env.VITE_GIT_SHA = release;

  console.log(`building client (release=${release})...`);
  await viteBuild();

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

  // Upload AFTER both client + server are built so the dist/public dir
  // is final. Server release tag is set via SENTRY_RELEASE env at runtime
  // (server reads it in initSentry) so client + server agree on release.
  if (process.env.NODE_ENV === "production") {
    await uploadSourceMapsToSentry(release);
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
