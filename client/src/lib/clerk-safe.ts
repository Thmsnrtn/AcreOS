/**
 * Provider-safe access to Clerk hooks.
 *
 * main.tsx deliberately mounts <App/> WITHOUT <ClerkProvider> in E2E
 * test-auth mode (and would if the publishable key ever went missing).
 * Clerk's hooks THROW outside their provider, so any component calling
 * useUser()/useClerk() unconditionally crashes the page to the 500
 * boundary in that mode — the 2026-07 production-gate audit found /auth,
 * /settings/byok, and the Settings Security tab all dead this way.
 *
 * `CLERK_AVAILABLE` mirrors main.tsx's mounting decision exactly. The
 * safe hooks are chosen ONCE at module load (a ternary over that
 * constant, not a conditional call inside a hook body), so hook order is
 * stable and rules-of-hooks are respected. When Clerk is absent they
 * return an honest "no user, loaded" shape — consumers render their
 * signed-out/unavailable states instead of crashing.
 */
import { useUser } from "@clerk/react";

const runtimeEnv =
  (typeof window !== "undefined" && (window as unknown as { __ENV__?: Record<string, string> }).__ENV__) || {};

/** True exactly when main.tsx mounted <ClerkProvider>. */
export const CLERK_AVAILABLE: boolean =
  runtimeEnv.E2E_TEST_AUTH !== "1" &&
  Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY || runtimeEnv.VITE_CLERK_PUBLISHABLE_KEY);

type SafeUserResult = {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  user: ReturnType<typeof useUser>["user"] | null;
};

const NO_CLERK_USER: SafeUserResult = {
  isLoaded: true,
  isSignedIn: false,
  user: null,
};

/**
 * useUser() that never throws: real hook when the provider is mounted,
 * a stable "no user" result otherwise.
 */
export const useSafeUser: () => SafeUserResult = CLERK_AVAILABLE
  ? (useUser as () => SafeUserResult)
  : () => NO_CLERK_USER;
