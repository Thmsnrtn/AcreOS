import { useUser, useClerk } from "@clerk/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@shared/models/auth";

// Extended user type with founder status (added by server)
export type AuthUser = User & { isFounder?: boolean };

async function fetchAppUser(): Promise<AuthUser | null> {
  const response = await fetch("/api/auth/user", {
    credentials: "include",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export function useAuth() {
  const { isSignedIn, isLoaded } = useUser();
  const { signOut } = useClerk();
  const queryClient = useQueryClient();

  const { data: user, isLoading: userLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/user"],
    queryFn: fetchAppUser,
    enabled: isSignedIn === true,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: false,
  });

  const logout = () => {
    queryClient.setQueryData(["/api/auth/user"], null);
    signOut({ redirectUrl: "/auth" });
  };

  return {
    user: isSignedIn ? (user ?? null) : null,
    isLoading: !isLoaded || (isSignedIn === true && userLoading),
    isAuthenticated: isSignedIn === true,
    isFounder: user?.isFounder ?? false,
    logout,
  };
}
