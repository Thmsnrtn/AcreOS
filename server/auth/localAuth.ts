import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcrypt";
import type { Express, RequestHandler } from "express";
import { db } from "../db";
import { users, type UpsertUser } from "@shared/models/auth";
import { eq } from "drizzle-orm";

const SALT_ROUNDS = 12;

// ============================================
// SESSION CONFIGURATION
// ============================================

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  const isProduction = process.env.NODE_ENV === "production";

  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      maxAge: sessionTtl,
    },
  });
}

// ============================================
// USER STORAGE HELPERS
// ============================================

async function getUser(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user;
}

async function getUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()));
  return user;
}

export async function createUser(data: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}) {
  const existing = await getUserByEmail(data.email);
  if (existing) {
    throw new Error("An account with this email already exists");
  }

  const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

  const [user] = await db
    .insert(users)
    .values({
      email: data.email.toLowerCase(),
      passwordHash,
      firstName: data.firstName || null,
      lastName: data.lastName || null,
    })
    .returning();

  return user;
}

async function verifyPassword(user: any, password: string): Promise<boolean> {
  if (!user.passwordHash) return false;
  return bcrypt.compare(password, user.passwordHash);
}

// ============================================
// PASSPORT SETUP
// ============================================

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        try {
          const user = await getUserByEmail(email);

          if (!user) {
            return done(null, false, { message: "Invalid email or password" });
          }

          const valid = await verifyPassword(user, password);
          if (!valid) {
            return done(null, false, { message: "Invalid email or password" });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await getUser(id);
      done(null, user || null);
    } catch (error) {
      done(error, null);
    }
  });
}

// ============================================
// AUTH MIDDLEWARE
// ============================================

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated() && req.user) {
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};
