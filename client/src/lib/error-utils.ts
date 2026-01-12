export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Map common errors to user-friendly messages
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return 'Connection issue. Please check your internet and try again.';
    }
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      return 'Your session has expired. Please sign in again.';
    }
    if (error.message.includes('403') || error.message.includes('Forbidden')) {
      return 'You don\'t have permission to do this.';
    }
    if (error.message.includes('404')) {
      return 'The requested item could not be found.';
    }
    if (error.message.includes('500')) {
      return 'Something went wrong on our end. Please try again in a moment.';
    }
    if (error.message.includes('429')) {
      return 'Too many requests. Please wait a moment and try again.';
    }
    if (error.message.includes('timeout')) {
      return 'Request timed out. Please check your connection and try again.';
    }
    return error.message;
  }
  return 'An unexpected error occurred. Please try again.';
}

export function getErrorTitle(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('401') || error.message.includes('Unauthorized')) {
      return 'Session Expired';
    }
    if (error.message.includes('403') || error.message.includes('Forbidden')) {
      return 'Permission Denied';
    }
    if (error.message.includes('404')) {
      return 'Not Found';
    }
    if (error.message.includes('500')) {
      return 'Server Error';
    }
    if (error.message.includes('429')) {
      return 'Rate Limited';
    }
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return 'Connection Error';
    }
    if (error.message.includes('timeout')) {
      return 'Request Timeout';
    }
  }
  return 'Error';
}

export function shouldRetry(error: unknown, attempt: number): boolean {
  if (attempt >= 3) return false;
  if (error instanceof Error) {
    // Retry on network/timeout errors, not on auth/permission errors
    return error.message.includes('fetch') || 
           error.message.includes('network') ||
           error.message.includes('timeout') ||
           error.message.includes('500');
  }
  return false;
}

export function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('401') || error.message.includes('Unauthorized');
  }
  return false;
}

export function isPermissionError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('403') || error.message.includes('Forbidden');
  }
  return false;
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.message.includes('fetch') || 
           error.message.includes('network') ||
           error.message.includes('timeout') ||
           error.message.includes('500') ||
           error.message.includes('429');
  }
  return false;
}
