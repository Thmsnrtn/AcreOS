/**
 * Clerk direct mode (staging hot-patch, now in the repo).
 *
 * Staging sets the server env CLERK_DIRECT=1; server/static.ts injects it
 * into window.__ENV__ (buildRuntimeEnvPayload). When it is exactly "1",
 * main.tsx must not pass proxyUrl to ClerkProvider, so Clerk talks to
 * Clerk directly instead of through the /__clerk proxy. Any other value,
 * including unset, keeps the production proxy behaviour, identical to
 * main before this change.
 */
export const CLERK_PROXY_URL = "/__clerk";

export function isClerkDirect(env: { CLERK_DIRECT?: string }): boolean {
  return env.CLERK_DIRECT === "1";
}

export function resolveClerkProxyUrl(env: { CLERK_DIRECT?: string }): string | undefined {
  return isClerkDirect(env) ? undefined : CLERK_PROXY_URL;
}

export function clerkProviderProxyProps(env: { CLERK_DIRECT?: string }): { proxyUrl?: string } {
  const proxyUrl = resolveClerkProxyUrl(env);
  return proxyUrl ? { proxyUrl } : {};
}
