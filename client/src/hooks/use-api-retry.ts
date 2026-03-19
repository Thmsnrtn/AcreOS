import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import React from "react";
import { ToastAction } from "@/components/ui/toast";

interface RetryOptions {
  maxRetries?: number;
  retryDelay?: number;
  showToast?: boolean;
  onAuthError?: () => void;
}

interface RetryState {
  isRetrying: boolean;
  retryCount: number;
  lastError: Error | null;
}

export function useApiRetry<T>(
  asyncFn: () => Promise<T>,
  options: RetryOptions = {}
) {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    showToast = true,
    onAuthError,
  } = options;

  const [state, setState] = useState<RetryState>({
    isRetrying: false,
    retryCount: 0,
    lastError: null,
  });

  const queryClient = useQueryClient();

  const isAuthError = (error: Error): boolean => {
    const message = error.message.toLowerCase();
    return (
      message.includes("401") ||
      message.includes("unauthorized") ||
      message.includes("session expired") ||
      message.includes("authentication")
    );
  };

  const execute = useCallback(async (): Promise<T | null> => {
    setState((prev) => ({ ...prev, isRetrying: true, lastError: null }));

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await asyncFn();
        setState({ isRetrying: false, retryCount: 0, lastError: null });
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        
        console.error(`[API Retry] Attempt ${attempt + 1}/${maxRetries + 1} failed:`, err.message);
        
        if (isAuthError(err)) {
          setState({ isRetrying: false, retryCount: attempt, lastError: err });
          
          if (showToast) {
            toast({
              title: "Session Expired",
              description: "Please sign in again to continue.",
              variant: "destructive",
            });
          }
          
          if (onAuthError) {
            onAuthError();
          } else {
            window.location.href = "/auth";
          }
          
          return null;
        }

        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
          setState((prev) => ({ ...prev, retryCount: attempt + 1 }));
        } else {
          setState({ isRetrying: false, retryCount: attempt, lastError: err });
          
          if (showToast) {
            toast({
              title: "Request Failed",
              description: err.message || "Something went wrong. Please try again.",
              variant: "destructive",
              // Intentionally omit action in dev baseline to avoid strict type coupling
            });
          }
          
          throw err;
        }
      }
    }

    return null;
  }, [asyncFn, maxRetries, retryDelay, showToast, onAuthError]);

  const retry = useCallback(async (): Promise<T | null> => {
    return execute();
  }, [execute]);

  const reset = useCallback(() => {
    setState({ isRetrying: false, retryCount: 0, lastError: null });
  }, []);

  return {
    execute,
    retry,
    reset,
    isRetrying: state.isRetrying,
    retryCount: state.retryCount,
    lastError: state.lastError,
    hasError: state.lastError !== null,
  };
}

export function useQueryRefetch(queryKey: string | string[]) {
  const queryClient = useQueryClient();
  const [isRefetching, setIsRefetching] = useState(false);

  const refetch = useCallback(async () => {
    setIsRefetching(true);
    try {
      const key = Array.isArray(queryKey) ? queryKey : [queryKey];
      await queryClient.invalidateQueries({ queryKey: key });
      
      toast({
        title: "Data Refreshed",
        description: "The data has been successfully refreshed.",
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      
      toast({
        title: "Refresh Failed",
        description: err.message || "Failed to refresh data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRefetching(false);
    }
  }, [queryClient, queryKey]);

  return { refetch, isRefetching };
}

interface ApiErrorFallbackProps {
  error: Error | null;
  onRetry: () => void;
  isRetrying?: boolean;
  message?: string;
}

export function getApiErrorMessage(error: Error | null): string {
  if (!error) return "An unexpected error occurred";
  
  const message = error.message;
  
  if (message.includes("500")) {
    return "Server error. Please try again later.";
  }
  if (message.includes("404")) {
    return "The requested resource was not found.";
  }
  if (message.includes("403")) {
    return "You don't have permission to access this resource.";
  }
  if (message.includes("401")) {
    return "Your session has expired. Please sign in again.";
  }
  if (message.includes("429")) {
    return "Too many requests. Please wait a moment and try again.";
  }
  if (message.includes("network") || message.includes("fetch")) {
    return "Network error. Please check your connection.";
  }
  
  return message || "An unexpected error occurred";
}

export function handleApiError(error: unknown, fallbackMessage?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = getApiErrorMessage(err);
  
  console.error("[API Error]", err);
  
  toast({
    title: "Error",
    description: fallbackMessage || message,
    variant: "destructive",
  });
}
