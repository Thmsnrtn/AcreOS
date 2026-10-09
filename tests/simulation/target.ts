/**
 * Where the simulation suite is allowed to point.
 *
 * The suite creates users, organizations and leads, and its global setup
 * writes user rows straight into a database. It is meant for a local stack
 * started for the purpose, so both targets are refused unless they are local:
 *
 *   · SIM_BASE_URL — the server driven over HTTP. Defaults to
 *     DEFAULT_SIM_BASE_URL. A non-local host is refused unless
 *     SIM_ALLOW_REMOTE_BASE_URL=1 is set explicitly.
 *   · SIM_DATABASE_URL — the database the global setup seeds. Read ONLY from
 *     this variable: DATABASE_URL is never used as a fallback, because in a
 *     developer's shell it can name a database that is not a scratch one. A
 *     non-local host is always refused.
 */

export const DEFAULT_SIM_BASE_URL = "http://localhost:5000";
export const SIM_REMOTE_OPT_IN = "SIM_ALLOW_REMOTE_BASE_URL";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function hostOf(url: string): string {
  return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

export function isLocalHost(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(hostOf(url));
  } catch {
    return false;
  }
}

type Env = Record<string, string | undefined>;

/** The server the suite drives. Throws for a non-local host without the opt-in. */
export function simBaseUrl(env: Env = process.env): string {
  const url = env.SIM_BASE_URL ?? DEFAULT_SIM_BASE_URL;
  if (!isLocalHost(url) && env[SIM_REMOTE_OPT_IN] !== "1") {
    throw new Error(
      `[sim] SIM_BASE_URL=${url} is not a local host (localhost, 127.0.0.1, ::1). The simulation ` +
        `creates accounts and data; set ${SIM_REMOTE_OPT_IN}=1 to point it elsewhere deliberately.`,
    );
  }
  return url;
}

/**
 * The database the global setup may seed, or undefined when none was given.
 * Only SIM_DATABASE_URL is read, and only a local host is accepted.
 */
export function simDatabaseUrl(env: Env = process.env): string | undefined {
  const url = env.SIM_DATABASE_URL;
  if (!url) return undefined;
  if (!isLocalHost(url)) {
    throw new Error(
      "[sim] SIM_DATABASE_URL does not name a local host (localhost, 127.0.0.1, ::1). The global " +
        "setup writes user rows directly and refuses any other database.",
    );
  }
  return url;
}
