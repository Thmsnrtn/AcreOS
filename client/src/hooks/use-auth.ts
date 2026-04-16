import { useUser, useClerk } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type { User } from "@shared/models/auth";

// Extended user type with founder status (added by server)
export type AuthUser = User & { isFounder?: boolean };

// Track consecutive auth failures to prevent redirect loops
let authFailCount = 0;
let lastAuthSuccess = 0;

async function fetchAppUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    authFailCount++;
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  authFailCount = 0;
  lastAuthSuccess = Date.now();
  return response.json();
}

export function useAuth() {
  const { isSignedIn, isLoaded } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();

  // Check for session cookie as a fallback when Clerk client-side
  // can't reach the FAPI (e.g., Cloudflare proxy issues)
  const hasSessionCookie = typeof document !== "undefined" && document.cookie.includes("__session=");

  // If we've had a successful auth recently, keep the user data cached longer
  // to prevent flicker during session refresh
  const recentlyAuthed = Date.now() - lastAuthSuccess < 5 * 60 * 1000; // 5 min

  const { data: user, isLoading: userLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchAppUser,
    enabled: isSignedIn === true || (isLoaded && hasSessionCookie),
    staleTime: recentlyAuthed ? 1000 * 60 * 5 : 1000 * 30, // 5min if recently authed, 30s otherwise
    gcTime: 1000 * 60 * 10, // Keep cached data for 10 min even if stale
    retry: (failureCount) => {
      // Don't retry if we've failed too many times (prevents spam)
      return failureCount < 2;
    },
    retryDelay: 5000,
  });

  const isAuthed = !!(isSignedIn || user);

  const logout = () => {
    authFailCount = 0;
    lastAuthSuccess = 0;
    queryClient.setQueryData(["/api/auth/user"], null);
    // Clear session cookies manually
    document.cookie = "__session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=acreos.io";
    document.cookie = "__session=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    document.cookie = "__client_uat=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.acreos.io";
    document.cookie = "__client_uat=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    signOut({ redirectUrl: "/auth" });
  };

  return {
    user: isAuthed ? (user ?? null) : null,
    isLoading: !isLoaded || ((isSignedIn === true || hasSessionCookie) && userLoading),
    isAuthenticated: isAuthed,
    isFounder: user?.isFounder ?? false,
    // Expose failure count so components can detect redirect loops
    authFailCount,
    logout,
  };
}
