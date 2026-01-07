import { users, type User, type UpsertUser } from "@shared/models/auth";
import { db } from "../../db";
import { eq } from "drizzle-orm";

// Interface for auth storage operations
// (IMPORTANT) These user operations are mandatory for Replit Auth.
export interface IAuthStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
}

class AuthStorage implements IAuthStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    try {
      // Try upsert by id first
      const [user] = await db
        .insert(users)
        .values(userData)
        .onConflictDoUpdate({
          target: users.id,
          set: {
            ...userData,
            updatedAt: new Date(),
          },
        })
        .returning();
      return user;
    } catch (error: any) {
      // Handle email uniqueness conflict (23505 = unique_violation)
      if (error?.code === '23505' && error?.constraint?.includes('email')) {
        // User with this email exists under different id - update by email
        const [user] = await db
          .update(users)
          .set({
            id: userData.id,
            ...userData,
            updatedAt: new Date(),
          })
          .where(eq(users.email, userData.email!))
          .returning();
        return user;
      }
      throw error;
    }
  }
}

export const authStorage = new AuthStorage();
