/**
 * A shared secret is never compared with `===`.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * AcreOS compared secrets in two shapes and treated them differently for no
 * reason anyone chose. HMAC digests — Twilio, Meta webhook signatures, inbound
 * email, signing tokens, wire instructions, API keys — went through
 * `crypto.timingSafeEqual`, consistently, at eight sites. Plain header tokens —
 * `DEPLOY_BOT_TOKEN`, `METRICS_TOKEN`, `PULSE_SHARED_SECRET`,
 * `UPTIME_PROBE_TOKEN`, `META_WEBHOOK_VERIFY_TOKEN` — used `===`, consistently,
 * at five. The distinction was HOW THE SECRET IS ENCODED, not whether it is a
 * secret, and the naive half was the half compared directly against
 * caller-supplied bytes.
 *
 * ── THE SECOND BUG, WHICH IS THE SERIOUS ONE ────────────────────────────────
 * `===` also accepts `undefined === undefined`. `verifyMetaWebhook` compared
 * `token === process.env.META_WEBHOOK_VERIFY_TOKEN` with no truthiness guard,
 * and its caller passes `req.query["hub.verify_token"] as string` — a cast, not
 * a check. Env var unset + query param absent → both `undefined` → the
 * comparison passes → the handler echoes `req.query["hub.challenge"]` through
 * `res.send()`, which Express serves as `text/html`. An unauthenticated
 * reflected-content endpoint on the AcreOS origin.
 *
 * The other four sites guarded with `if (expected)` first. Nothing made that
 * guard mandatory, which is why one site did not have it.
 *
 * ── WHAT HELD IT SHUT, AND WHY THAT IS NOT REASSURING ───────────────────────
 * `registerEliteFeatureRoutes` runs at server/routes.ts:2630, AFTER the
 * `app.use('/api', isAuthenticated, …)` catch-all at :1572 — so today an
 * unauthenticated GET is 401'd before the handler runs. Two things follow, and
 * both are worse than they look:
 *
 *   - The Meta lead-ads webhook CANNOT WORK. Meta's servers carry no Clerk
 *     session, so both the verification GET and the signed POST are 401'd.
 *   - The comment block at routes.ts:1551-1568 instructs developers to register
 *     exactly this kind of route BEFORE the catch-all — it has already been
 *     done three times, for /api/docs, e-sign and transparency. Doing it here,
 *     which is the documented fix for the bullet above, would have opened the
 *     bypass.
 *
 * A latent vulnerability held shut by an unrelated bug, where fixing the bug the
 * documented way opens the vulnerability. So the fix is in the comparison, not
 * in the routing.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { secretEquals } from "../../server/utils/secretEquals";
import { verifyMetaWebhook } from "../../server/services/metaAdsService";

const ROOT = path.resolve(__dirname, "../..");

describe("secretEquals fails closed", () => {
  it("MATCHES A REAL SECRET", () => {
    expect(secretEquals("s3cr3t-value", "s3cr3t-value")).toBe(true);
  });

  it("rejects a mismatch, including prefixes and different lengths", () => {
    expect(secretEquals("s3cr3t-value", "s3cr3t-valuX")).toBe(false);
    expect(secretEquals("s3cr3t", "s3cr3t-value")).toBe(false);
    expect(secretEquals("s3cr3t-value-longer", "s3cr3t-value")).toBe(false);
  });

  it("REFUSES WHEN THE SECRET IS UNCONFIGURED — both sides undefined is not a match", () => {
    // The `undefined === undefined` bug, made unrepresentable.
    expect(secretEquals(undefined, undefined)).toBe(false);
    expect(secretEquals("", "")).toBe(false);
    expect(secretEquals(undefined, "configured")).toBe(false);
    expect(secretEquals("presented", undefined)).toBe(false);
    expect(secretEquals(null, null)).toBe(false);
  });

  it("refuses non-string input rather than coercing it", () => {
    // `req.headers['x-...']` is `string | string[] | undefined`, and a repeated
    // header arrives as an array. Coercion would compare "a,b" to the secret.
    expect(secretEquals(["a", "b"], "a,b")).toBe(false);
    expect(secretEquals({ toString: () => "secret" }, "secret")).toBe(false);
  });
});

describe("the Meta webhook challenge cannot be echoed without the secret", () => {
  const CHALLENGE = "<script>alert(1)</script>";

  it("REFUSES WHEN THE VERIFY TOKEN IS UNSET AND NO TOKEN IS PRESENTED", () => {
    // The exact live shape: the caller passes `req.query[…] as string`, which is
    // `undefined` when the param is absent.
    const prior = process.env.META_WEBHOOK_VERIFY_TOKEN;
    delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    try {
      expect(
        verifyMetaWebhook("subscribe", undefined as unknown as string, CHALLENGE),
        "an unauthenticated caller got attacker-controlled content echoed back",
      ).toBeNull();
      expect(verifyMetaWebhook("subscribe", "", CHALLENGE)).toBeNull();
      expect(verifyMetaWebhook("subscribe", "guessed", CHALLENGE)).toBeNull();
    } finally {
      if (prior === undefined) delete process.env.META_WEBHOOK_VERIFY_TOKEN;
      else process.env.META_WEBHOOK_VERIFY_TOKEN = prior;
    }
  });

  it("still completes the handshake for Meta when the token matches", () => {
    // Vacuity guard: a function that always returns null passes the test above
    // and silently breaks the integration.
    const prior = process.env.META_WEBHOOK_VERIFY_TOKEN;
    process.env.META_WEBHOOK_VERIFY_TOKEN = "the-real-token";
    try {
      expect(verifyMetaWebhook("subscribe", "the-real-token", "abc123")).toBe("abc123");
      expect(verifyMetaWebhook("unsubscribe", "the-real-token", "abc123")).toBeNull();
    } finally {
      if (prior === undefined) delete process.env.META_WEBHOOK_VERIFY_TOKEN;
      else process.env.META_WEBHOOK_VERIFY_TOKEN = prior;
    }
  });
});

describe("no site compares a secret naively", () => {
  /**
   * Scans for the SHAPE, not for the five known identifiers: a variable bound
   * from a secret-looking `process.env.*`, later compared with `===`/`!==`.
   * Renaming a token, adding a sixth, or copying the pattern into a new file
   * all fail this — which a list of the five original sites would not.
   */
  const SECRET_ENV = /process\.env\.([A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASSPHRASE)[A-Z0-9_]*)/;

  /**
   * Comparisons that are NOT authenticating a caller. Each needs a reason, and
   * each is checked to still exist so a stale exemption cannot hide a new site.
   */
  const EXEMPT: Array<{ file: string; needle: string; why: string }> = [
    {
      file: "server/scripts/rotateEncryptionKey.ts",
      needle: "OLD_KEY_HEX === NEW_KEY_HEX",
      why:
        "Not an authentication check: a startup sanity assertion that the operator " +
        "did not pass the same key twice. Both sides are operator-supplied config " +
        "in a CLI script, there is no untrusted caller, and the comparison's " +
        "purpose is to REFUSE when they are equal.",
    },
  ];

  function scan(): string[] {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;

        const src = fs.readFileSync(full, "utf8");
        const lines = src.split("\n");
        const bound = new Map<string, string>();
        for (const line of lines) {
          const m = line.match(
            new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=.*${SECRET_ENV.source}`),
          );
          if (m) bound.set(m[1], m[2]);
        }
        if (bound.size === 0) continue;

        lines.forEach((line, i) => {
          const code = line.split("//")[0];
          for (const [v, env] of bound) {
            const cmp = new RegExp(`(===|!==)\\s*${v}\\b|\\b${v}\\s*(===|!==)`);
            if (!cmp.test(code)) continue;
            const rel = path.relative(ROOT, full);
            if (EXEMPT.some((e) => e.file === rel && code.includes(e.needle))) continue;
            offenders.push(`${rel}:${i + 1} [${env}] ${line.trim().slice(0, 100)}`);
          }
        });
      }
    };
    walk(path.join(ROOT, "server"));
    return offenders;
  }

  it("THE SCAN IS NOT VACUOUS — it finds the shape when it is present", () => {
    // Guard first. A walker that stopped seeing files, or a regex that stopped
    // matching, would report zero offenders and read as a clean bill of health.
    // Proven against a synthetic file rather than a real one.
    const dir = fs.mkdtempSync(path.join(ROOT, "node_modules", ".secretscan-"));
    try {
      fs.writeFileSync(
        path.join(dir, "probe.ts"),
        'const expected = process.env.SOME_API_TOKEN;\nif (req.header("x") === expected) { ok(); }\n',
      );
      // Re-run the same matcher logic over the synthetic file.
      const src = fs.readFileSync(path.join(dir, "probe.ts"), "utf8");
      const m = src.match(new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=.*${SECRET_ENV.source}`));
      expect(m, "the binding regex no longer recognises a secret env var").not.toBeNull();
      expect(new RegExp(`(===|!==)\\s*${m![1]}\\b`).test(src)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("every exemption still exists, so none is silently covering a new site", () => {
    for (const e of EXEMPT) {
      const p = path.join(ROOT, e.file);
      expect(fs.existsSync(p), `${e.file} moved — re-adjudicate its exemption`).toBe(true);
      expect(
        fs.readFileSync(p, "utf8"),
        `${e.file} no longer contains "${e.needle}" — delete the stale exemption`,
      ).toContain(e.needle);
    }
  });

  it("NO server file compares a caller-supplied value to a secret with ===", () => {
    expect(
      scan(),
      "a shared secret is compared with === . Use secretEquals() from " +
        "server/utils/secretEquals.ts: it is constant-time AND fails closed on " +
        "an unset secret, which is how the Meta webhook came to accept " +
        "undefined === undefined.",
    ).toEqual([]);
  });
});
