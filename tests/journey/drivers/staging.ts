/**
 * Journey-proof harness — the staging driver.
 *
 * Executes a walk spec against the deployed staging app over HTTPS, on a
 * fresh dedicated org owned by a unique E2E persona.
 *
 * AUTH: the staging-only token gate (`X-E2E-Auth-Token`, server/auth/
 * testAuth.ts) plus the persona cookie `__session=e2e-persona-<slug>`,
 * which resolves to a stable, distinct test user id — so the persona's
 * first authenticated request auto-provisions its OWN org via
 * getOrCreateOrg. The token comes from the environment
 * (`ACREOS_STAGING_E2E_TOKEN`); this file never reads it from anywhere
 * else, never logs it, and never includes it in any error message or
 * report. A run without the token refuses to start.
 *
 * CSRF: staging's double-submit middleware (server/middleware/csrf.ts)
 * issues a `csrf_token` cookie on safe requests and requires every
 * mutating request to echo it as the `x-csrf-token` header. The driver
 * keeps a cookie jar — it absorbs `Set-Cookie` from every response,
 * sends the accumulated cookies alongside the persona cookie, and
 * mirrors the jar's `csrf_token` into the header on mutating requests,
 * exactly as the product's own client does (client/src/lib/
 * queryClient.ts `readCsrfToken` + `doApiFetch`). Without the jar the
 * driver cannot mutate at all (H-DEF-1: every POST 403'd "CSRF token
 * validation failed" on the harness's first staging execution).
 *
 * SAFETY:
 * - The base URL must contain "staging" and use https. Anything else —
 *   including production — is refused before a single request is made.
 * - No SQL access exists from outside staging: `sql()` throws, so legs
 *   that need setup data must provide `stagingRun`.
 * - The transport is not observable from outside: `sentCount()` is null.
 *   The no-send fence on staging is the spec's dry-run steps plus the
 *   post-walk recipient-count assertions the spec itself makes.
 * - The deployed SHA is read from staging's own GET /api/version, verbatim.
 *   Today that endpoint returns {"sha":"unknown"} (the build does not set
 *   VITE_GIT_SHA); the record says so rather than carrying a SHA from
 *   anywhere else.
 */
import type { WalkDriver } from "../runner";
import type { WalkSpec } from "../walk-spec";

export interface StagingDriverOptions {
  /** Staging base URL. Must contain "staging". Defaults to the Fly staging app. */
  baseUrl?: string;
  /** E2E token. Defaults to ACREOS_STAGING_E2E_TOKEN. Never logged. */
  token?: string;
  /** Persona slug. Defaults to a fresh walk slug per run (see setupOrg). */
  personaSlug?: string;
  /** Operator values supplied non-interactively (CLI --input key=value). */
  manualInputs?: Record<string, string>;
  /** Interactive prompter for manual-step values (the CLI's readline prompt). */
  promptForManualInput?: (step: { id: string; collects?: { key: string; prompt: string }[] }) => Promise<Record<string, string>>;
}

/**
 * The staging-only base-URL refusal, shared by the driver constructor and
 * the CLI's `--check` probe: a walk runs on staging only, so the URL must
 * be https and contain "staging". Anything else — including production —
 * is refused before a single request is made. Returns the URL with any
 * trailing slash removed.
 */
export function assertStagingBaseUrl(raw: string): string {
  const baseUrl = raw.replace(/\/$/, "");
  if (!baseUrl.startsWith("https://") || !baseUrl.includes("staging")) {
    throw new Error(
      `staging driver refuses base URL ${JSON.stringify(baseUrl)} — a walk runs on staging only (https URL containing "staging")`,
    );
  }
  return baseUrl;
}

/** The methods the product's client treats as mutating (queryClient.ts). */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The `Set-Cookie` values a response carries, as raw `name=value; …`
 * strings. Node's fetch (undici) exposes them via `getSetCookie()`; the
 * fallback splits a combined header on cookie boundaries (a comma that
 * is followed by a token and `=` — expiry dates contain commas too).
 */
function setCookieValues(headers: Headers): string[] {
  const holder = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof holder.getSetCookie === "function") return holder.getSetCookie();
  const combined = headers.get("set-cookie");
  if (!combined) return [];
  return combined.split(/, (?=[^;,=]+?=)/);
}

/** One cookie's name/value out of a `Set-Cookie` string, or null. */
function parseSetCookie(raw: string): { name: string; value: string } | null {
  const pair = raw.split(";", 1)[0];
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
}

function stagingDateStamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}${byType.month}${byType.day}`;
}

export class StagingDriver implements WalkDriver {
  readonly name = "staging" as const;
  readonly label = "staging (deployed app, fresh dedicated org)";
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly manualInputs: Record<string, string>;
  private readonly promptForManualInput: StagingDriverOptions["promptForManualInput"];
  private personaSlug: string;
  private orgId: number | string = 0;
  /** Cookies staging has set on this driver's responses, name → value. */
  private readonly cookieJar = new Map<string, string>();

  constructor(opts: StagingDriverOptions = {}) {
    const baseUrl = assertStagingBaseUrl(opts.baseUrl ?? process.env.ACREOS_STAGING_URL ?? "https://acreos-staging.fly.dev");
    const token = opts.token ?? process.env.ACREOS_STAGING_E2E_TOKEN ?? "";
    if (!token) {
      throw new Error(
        "staging driver needs ACREOS_STAGING_E2E_TOKEN in the environment (the staging-only E2E token; present in-machine on walk sessions, never printed)",
      );
    }
    this.baseUrl = baseUrl;
    this.token = token;
    this.manualInputs = opts.manualInputs ?? {};
    this.promptForManualInput = opts.promptForManualInput;
    this.personaSlug = (opts.personaSlug ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  sentCount(): number | null {
    // The server's transport is not observable from outside staging.
    return null;
  }

  /** Absorb a response's `Set-Cookie` headers into the jar (H-DEF-1). */
  private absorbCookies(res: Response): void {
    for (const raw of setCookieValues(res.headers)) {
      const cookie = parseSetCookie(raw);
      if (!cookie) continue;
      if (cookie.value === "") this.cookieJar.delete(cookie.name);
      else this.cookieJar.set(cookie.name, cookie.value);
    }
  }

  /**
   * The Cookie header for the next request: the persona cookie first
   * (it is the driver's identity and always wins), then every jar
   * cookie the server has set — including `csrf_token`, which the
   * double-submit check compares against the header below.
   */
  private cookieHeader(): string {
    const parts = [`__session=e2e-persona-${this.personaSlug}`];
    for (const [name, value] of this.cookieJar) {
      if (name === "__session") continue;
      parts.push(`${name}=${value}`);
    }
    return parts.join("; ");
  }

  /**
   * The jar's `csrf_token`, decoded the way the product's client
   * decodes it (queryClient.ts `readCsrfToken`: decodeURIComponent,
   * raw value if the encoding is somehow malformed).
   */
  private csrfToken(): string {
    const raw = this.cookieJar.get("csrf_token");
    if (!raw) return "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  async version(): Promise<{ sha: string }> {
    const res = await fetch(`${this.baseUrl}/api/version`);
    this.absorbCookies(res);
    const body = (await res.json().catch(() => ({}))) as { sha?: unknown };
    return { sha: typeof body.sha === "string" && body.sha ? body.sha : "unknown" };
  }

  async setupOrg(spec: WalkSpec, tag: string): Promise<{ orgId: number | string }> {
    if (!this.personaSlug) {
      // Fresh persona per walk => fresh user id => fresh org. The slug is
      // derived from the run tag, so two walks never share an org.
      this.personaSlug = `walk_${spec.id}_${stagingDateStamp(new Date())}_${tag.slice(-6)}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_");
    }
    // First authenticated request auto-provisions the persona's own org.
    const orgRes = await this.api("GET", "/api/organization");
    const orgId = (orgRes.body as any)?.id ?? (orgRes.body as any)?.organization?.id;
    if (orgRes.status !== 200 || orgId === undefined) {
      throw new Error(
        `staging setupOrg: GET /api/organization returned ${orgRes.status} (keys: ${Object.keys(orgRes.body ?? {}).join(",") || "none"}) — the persona org was not provisioned`,
      );
    }
    this.orgId = orgId;
    // Provision the vertical's templates onto the fresh org. A fresh org's
    // owner is the persona user, so this must report organizationUpdated.
    const provision = await this.api("POST", "/api/onboarding/provision", { businessType: spec.org.businessType });
    if (provision.status !== 200 || (provision.body as any)?.organizationUpdated !== true) {
      throw new Error(
        `staging setupOrg: POST /api/onboarding/provision for ${spec.org.businessType} returned ${provision.status} (organizationUpdated=${JSON.stringify((provision.body as any)?.organizationUpdated)}) — the walk org is not the vertical's org`,
      );
    }
    return { orgId };
  }

  api: WalkDriver["api"] = async (method, path, body) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-e2e-auth-token": this.token,
      cookie: this.cookieHeader(),
    };
    // Double-submit: mirror the csrf_token cookie into the header on
    // mutating requests only, as the product's client does (H-DEF-1).
    if (MUTATING_METHODS.has(method.toUpperCase())) {
      const csrf = this.csrfToken();
      if (csrf) headers["x-csrf-token"] = csrf;
    }
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.absorbCookies(res);
    const parsed = await res.json().catch(() => null);
    return { status: res.status, body: parsed };
  };

  sql: WalkDriver["sql"] = async () => {
    throw new Error("staging driver has no SQL access — the step must provide stagingRun");
  };

  async collectManualInput(step: { id: string; collects?: { key: string; prompt: string }[] }): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const missing = (step.collects ?? []).filter((c) => this.manualInputs?.[c.key] === undefined);
    if (missing.length && this.promptForManualInput) {
      Object.assign(out, await this.promptForManualInput(step));
    }
    for (const c of step.collects ?? []) {
      const value = this.manualInputs?.[c.key] ?? out[c.key];
      if (value === undefined || value === "") {
        throw new Error(`manual input ${c.key} not provided (${c.prompt}) — re-run with --input ${c.key}=<value>`);
      }
      out[c.key] = value;
    }
    return out;
  }

  async cleanup(_spec: WalkSpec, _orgId: number | string): Promise<void> {
    // Staging walk orgs are left in place, like every prior walk org: the
    // record names the org id and tag, and no walk ever deletes or mutates
    // another walk's data. Deleting staging rows from outside the app would
    // need SQL access the driver deliberately does not have.
  }
}
