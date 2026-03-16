// Augment Express Request with our DB user (attached by hydrateUser middleware)
import type { User } from "@shared/models/auth";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export {};
