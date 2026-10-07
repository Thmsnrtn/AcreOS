// Server-only production build of a prod-like copy (same esbuild shape as
// script/build.ts's server + worker bundles; the client is built separately
// only when a UI walk needs it). `pg` is left EXTERNAL here (unlike the
// shipped bundle) so the simulation's db tap (preload.mjs) patches the same
// pg module instance the app uses — nothing else differs.
import { build } from "esbuild";
import { readFileSync } from "node:fs";
const root = process.argv[2];
process.chdir(root);
const bundled = ["@google/generative-ai", "axios", "connect-pg-simple", "compression", "cors", "date-fns", "drizzle-orm", "drizzle-zod", "express", "express-rate-limit", "express-session", "jsonwebtoken", "memorystore", "multer", "nanoid", "nodemailer", "openai", "passport", "passport-local", "stripe", "uuid", "ws", "xlsx", "zod", "zod-validation-error"];
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const externals = [...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})].filter((d) => !bundled.includes(d));
for (const [entry, out] of [["server/index.ts", "dist/index.cjs"], ["server/worker.ts", "dist/worker.cjs"]]) {
  await build({ entryPoints: [entry], platform: "node", bundle: true, format: "cjs", outfile: out, define: { "process.env.NODE_ENV": '"production"' }, minify: true, external: externals, logLevel: "warning" });
  console.log("built", out);
}
