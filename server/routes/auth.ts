import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "../lib/supabase-server.js";
import { checkServerEnv } from "../lib/env-check.js";
import type { Role } from "../lib/erp-data.js";
import { checkRateLimit, getClientIpFromReq, LOGIN_RATE_LIMIT } from "../lib/rate-limiter.js";
import { hashToken, readSessionCookie, getSessionUser } from "../lib/session.js";

// Separate Supabase client for auth.admin / auth.signIn operations.
// signInWithPassword sets an in-memory session on the client, which would
// replace the service-role key on supabaseServer and break all subsequent
// DB queries (RLS would apply). This isolated client prevents that.
const supabaseAuthAdmin = createClient(
  process.env["SUPABASE_URL"] as string,
  process.env["SUPABASE_SERVICE_ROLE_KEY"] as string,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export const authRouter = Router();

// Represents the authenticated user shape returned to the client.
export type AuthUser = {
  id: string;
  name: string;
  role: Role;
  phone: string | null;
};

// Discriminated union describing the outcome of a login attempt.
// The token is never sent to the client — it is set as an httpOnly cookie
// in the server response itself.
export type SupabaseSession = {
  access_token: string;
  refresh_token: string;
};

export type LoginResult =
  | { success: true; user: AuthUser; maxAge: number; supabaseSession?: SupabaseSession }
  | { success: false; error: string; locked?: boolean };

const COOKIE_NAME = "meditrust_session";
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

// Retrieves the JWT signing secret from env, throwing if it is missing.
function getJwtSecret(): string {
  const secret = process.env["APP_JWT_SECRET"];
  if (!secret) {
    checkServerEnv();
    throw new Error("APP_JWT_SECRET is not set");
  }
  return secret;
}

// Returns the configured JWT expiry duration, defaulting to 12 hours.
function getJwtExpiry(): string {
  return process.env["APP_JWT_EXPIRY"] || "12h";
}

// Converts a human-readable expiry string (e.g. "12h") into milliseconds.
function parseExpiryToMs(expiry: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(expiry);
  if (!match) return 12 * 60 * 60 * 1000;
  const num = parseInt(match[1] as string, 10);
  const unit = match[2] as string;
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return num * (multipliers[unit] ?? 12 * 60 * 60 * 1000);
}

// Cookie options for the session cookie.
// In production, cookies are secure + sameSite=none so they work cross-origin
// (frontend on Vercel, API on Railway). In development, sameSite=lax + secure=false.
function getCookieOptions(maxAgeSeconds: number) {
  const isProduction = process.env["NODE_ENV"] === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ("none" as const) : ("lax" as const),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// POST /api/auth/login — validates credentials, enforces lockout, and issues a JWT session.
authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const data = loginSchema.parse(req.body);
    const { username, password } = data;

    // IP-based rate limiting to prevent brute-force across multiple accounts
    const ip = getClientIpFromReq(req);
    const rateLimit = checkRateLimit(
      `login:${ip}`,
      LOGIN_RATE_LIMIT.maxRequests,
      LOGIN_RATE_LIMIT.windowMs,
    );
    if (!rateLimit.allowed) {
      const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
      res.json({
        success: false,
        error: `Too many login attempts. Try again in ${retryAfter} seconds.`,
      });
      return;
    }

    const { data: user, error } = await supabaseServer
      .from("users")
      .select(
        "id, username, password_hash, role, name, phone, failed_login_attempts, locked_until",
      )
      .eq("username", username)
      .single();

    if (error || !user) {
      res.json({ success: false, error: "Invalid username or password" });
      return;
    }

    const now = new Date();

    if (user.locked_until && new Date(user.locked_until) > now) {
      const unlockAt = new Date(user.locked_until).toLocaleString();
      res.json({
        success: false,
        error: `Account locked until ${unlockAt}. Try again later.`,
        locked: true,
      });
      return;
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      const newAttempts = user.failed_login_attempts + 1;
      const shouldLock = newAttempts >= MAX_LOGIN_ATTEMPTS;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString()
        : null;

      await supabaseServer
        .from("users")
        .update({
          failed_login_attempts: shouldLock ? 0 : newAttempts,
          locked_until: lockedUntil,
        })
        .eq("id", user.id);

      if (shouldLock) {
        res.json({
          success: false,
          error: `Too many failed attempts. Account locked for ${LOCK_DURATION_MINUTES} minutes.`,
          locked: true,
        });
        return;
      }

      const remaining = MAX_LOGIN_ATTEMPTS - newAttempts;
      res.json({
        success: false,
        error: `Invalid password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
      });
      return;
    }

    await supabaseServer
      .from("users")
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq("id", user.id);

    const token = jwt.sign({ id: user.id, role: user.role }, getJwtSecret(), {
      expiresIn: getJwtExpiry() as any,
    });

    const tokenHash = hashToken(token);
    const expiryMs = parseExpiryToMs(getJwtExpiry());
    const expiresAt = new Date(Date.now() + expiryMs).toISOString();

    await supabaseServer.from("sessions").insert({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      revoked: false,
    });

    const authUser: AuthUser = {
      id: user.id,
      name: user.name,
      role: user.role as Role,
      phone: user.phone,
    };

    // Set the session cookie server-side so the client never sees the token value.
    res.cookie(COOKIE_NAME, token, getCookieOptions(Math.floor(expiryMs / 1000)));

    // Obtain a Supabase Auth session so the browser can use Realtime with RLS.
    // Lazily create the Supabase Auth user (same UUID as the custom users table)
    // on first login, then sign in to get access + refresh tokens.
    let supabaseSession: SupabaseSession | undefined;
    try {
      const syntheticEmail = `${username}@meditrust.local`;

      let authRes = await supabaseAuthAdmin.auth.signInWithPassword({
        email: syntheticEmail,
        password,
      });

      // If the user doesn't exist in Supabase Auth yet, create them and retry.
      if (authRes.error) {
        await supabaseAuthAdmin.auth.admin.createUser({
          id: user.id,
          email: syntheticEmail,
          password,
          email_confirm: true,
        });
        authRes = await supabaseAuthAdmin.auth.signInWithPassword({
          email: syntheticEmail,
          password,
        });
      }

      if (authRes.data.session) {
        supabaseSession = {
          access_token: authRes.data.session.access_token,
          refresh_token: authRes.data.session.refresh_token,
        };
      }
    } catch (e) {
      console.error("Supabase Auth sign-in failed:", e);
    }

    res.json({ success: true, user: authUser, maxAge: Math.floor(expiryMs / 1000), supabaseSession });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    console.error("Login error:", err);
    res.status(500).json({ success: false, error: "Login failed" });
  }
});

// GET /api/auth/verify — checks the session cookie and returns the current auth state.
authRouter.get("/verify", async (req: Request, res: Response) => {
  const token = readSessionCookie(req);
  if (!token) {
    res.json({ authenticated: false, user: null });
    return;
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as {
      id: string;
      role: Role;
    };

    const tokenHash = hashToken(token);
    const now = new Date().toISOString();

    const { data: session, error } = await supabaseServer
      .from("sessions")
      .select("id, revoked, expires_at")
      .eq("token_hash", tokenHash)
      .eq("revoked", false)
      .gt("expires_at", now)
      .single();

    if (error || !session) {
      res.json({ authenticated: false, user: null });
      return;
    }

    const { data: user, error: userError } = await supabaseServer
      .from("users")
      .select("id, name, role, phone")
      .eq("id", decoded.id)
      .single();

    if (userError || !user) {
      res.json({ authenticated: false, user: null });
      return;
    }

    res.json({
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role as Role,
        phone: user.phone,
      },
    });
  } catch {
    res.json({ authenticated: false, user: null });
  }
});

// POST /api/auth/logout — revokes the active session in the database and clears the cookie.
authRouter.post("/logout", async (req: Request, res: Response) => {
  const token = readSessionCookie(req);
  if (token) {
    try {
      const tokenHash = hashToken(token);
      await supabaseServer
        .from("sessions")
        .update({ revoked: true })
        .eq("token_hash", tokenHash);
    } catch {
      // ignore — session may already be invalid; cookie is cleared anyway
    }
  }

  res.clearCookie(COOKIE_NAME, getCookieOptions(0));
  res.json({ success: true });
});

// GET /api/auth/me — returns the authenticated user for the current session, or null.
authRouter.get("/me", async (req: Request, res: Response) => {
  const user = await getSessionUser(req);
  if (!user) {
    res.json(null);
    return;
  }
  res.json({
    id: user.id,
    name: user.name,
    role: user.role,
    phone: user.phone,
  });
});

// Password policy: min 8 chars, at least one uppercase, one lowercase, one digit.
function validatePasswordPolicy(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters long";
  if (!/[A-Z]/.test(password)) return "Password must contain at least one uppercase letter";
  if (!/[a-z]/.test(password)) return "Password must contain at least one lowercase letter";
  if (!/\d/.test(password)) return "Password must contain at least one digit";
  return null;
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

// POST /api/auth/change-password — changes the current user's password.
authRouter.post("/change-password", async (req: Request, res: Response) => {
  try {
    const data = changePasswordSchema.parse(req.body);

    // Read the session cookie to identify the current user
    const token = readSessionCookie(req);
    if (!token) {
      res.json({ success: false, error: "Not authenticated" });
      return;
    }

    let userId: string;
    try {
      const decoded = jwt.verify(token, getJwtSecret()) as { id: string };
      userId = decoded.id;
    } catch {
      res.json({ success: false, error: "Not authenticated" });
      return;
    }

    // Fetch the user's current password hash
    const { data: user, error } = await supabaseServer
      .from("users")
      .select("id, password_hash")
      .eq("id", userId)
      .single();

    if (error || !user) {
      res.json({ success: false, error: "User not found" });
      return;
    }

    // Verify current password
    const passwordMatch = await bcrypt.compare(data.currentPassword, user.password_hash);
    if (!passwordMatch) {
      res.json({ success: false, error: "Current password is incorrect" });
      return;
    }

    // Enforce password policy on new password
    const policyError = validatePasswordPolicy(data.newPassword);
    if (policyError) {
      res.json({ success: false, error: policyError });
      return;
    }

    // Hash new password and update
    const newHash = await bcrypt.hash(data.newPassword, 12);
    const { error: updateError } = await supabaseServer
      .from("users")
      .update({ password_hash: newHash, failed_login_attempts: 0, locked_until: null })
      .eq("id", userId);

    if (updateError) {
      res.json({ success: false, error: "Failed to update password" });
      return;
    }

    // Revoke all existing sessions for this user
    await supabaseServer
      .from("sessions")
      .update({ revoked: true })
      .eq("user_id", userId)
      .eq("revoked", false);

    // Keep Supabase Auth password in sync so Realtime sessions stay valid.
    try {
      await supabaseAuthAdmin.auth.admin.updateUserById(userId, { password: data.newPassword });
    } catch (e) {
      console.error("Supabase Auth password update failed:", e);
    }

    // Clear the current session cookie so the user is redirected to login
    res.clearCookie(COOKIE_NAME, getCookieOptions(0));

    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    console.error("Change password error:", err);
    res.status(500).json({ success: false, error: "Failed to change password" });
  }
});
