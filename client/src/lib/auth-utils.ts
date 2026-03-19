export function isUnauthorizedError(error: Error): boolean {
  return /^401: .*Unauthorized/.test(error.message);
}

// Redirect to login with a toast notification
export function redirectToLogin(toast?: (options: { title: string; description: string; variant: string }) => void) {
  if (toast) {
    toast({
      title: "Unauthorized",
      description: "You are logged out. Logging in again...",
      variant: "destructive",
    });
  }
  setTimeout(() => {
    if (import.meta.env.DEV) {
      // In local dev, skip Replit login and go to the app shell
      window.location.href = "/";
    } else {
      window.location.href = "/api/login";
    }
  }, 500);
}
