import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHmac } from "crypto";
import { supabaseServer } from "./supabase-server";
import { checkServerEnv } from "./env-check";
import type { Role } from "./erp-data";
import { getStartContext } from "@tanstack/start-storage-context";
import { checkRateLimit, getClientIp, LOGIN_RATE_LIMIT } from "./rate-limiter";

// Represents the authenticated user shape returned to the client.
export type AuthUser = {
  id: string;
  name: string;
  role: Role;
  phone: string | null;
};

// Discriminated union describing the outcome of a login attempt.
export type LoginResult =
  | { success: true; user: AuthUser; token: string; maxAge: number }
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

// Deterministic hash of the session token for DB lookup.
// Uses HMAC-SHA256 keyed with the JWT secret — bcrypt.hash() is unsuitable here
// because it generates a random salt on every call, making the hash non-deterministic
// and the session row impossible to find on subsequent requests.
function hashToken(token: string): string {
  return createHmac("sha256", getJwtSecret()).update(token).digest("hex");
}

// Reads the session JWT from the request cookie, trying multiple methods.
async function readSessionCookie(): Promise<string | undefined> {
  // Method 1: getStartContext (works for SSR/GET and some serverFn POST)
  try {
    const ctx = getStartContext({ throwIfNotFound: false });
    const req = ctx?.request as Request | undefined;
    if (req) {
      const cookieHeader = req.headers.get("cookie") ?? "";
      for (const part of cookieHeader.split(";")) {
        const [key, ...val] = part.trim().split("=");
        if (key === COOKIE_NAME) return decodeURIComponent(val.join("="));
      }
    }
  } catch {
    // ignore
  }

  // Method 2: getCookie from @tanstack/start-server-core
  try {
    const { getCookie } = await import("@tanstack/start-server-core");
    const value = getCookie(COOKIE_NAME);
    if (value) return decodeURIComponent(value);
  } catch {
    // ignore
  }

  // Method 3: h3 getEvent (works in Nitro/h3 server context for RPC calls)
  try {
    const h3: any = await import("h3");
    const event = h3.getEvent?.();
    if (event) {
      const cookieHeader = h3.getHeader?.(event, "cookie") ?? "";
      for (const part of cookieHeader.split(";")) {
        const [key, ...val] = part.trim().split("=");
        if (key === COOKIE_NAME) return decodeURIComponent(val.join("="));
      }
    }
  } catch {
    // ignore
  }

  // Method 4: vinxi/http fallback
  try {
    // @ts-ignore — vinxi/http is available at runtime via Nitro
    const vinxiHttp: any = await import("vinxi/http");
    const event = vinxiHttp.getEvent?.();
    if (event) {
      const cookieHeader = vinxiHttp.getHeader?.(event, "cookie") ?? "";
      for (const part of cookieHeader.split(";")) {
        const [key, ...val] = part.trim().split("=");
        if (key === COOKIE_NAME) return decodeURIComponent(val.join("="));
      }
    }
  } catch {
    // ignore
  }

  return undefined;
}

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// Server function that validates credentials, enforces lockout, and issues a JWT session.
export const loginUser = createServerFn({ method: "POST" })
  .validator(loginSchema)
  .handler(async ({ data }): Promise<LoginResult> => {
    const { username, password } = data;

    // IP-based rate limiting to prevent brute-force across multiple accounts
    const ip = getClientIp();
    const rateLimit = checkRateLimit(
      `login:${ip}`,
      LOGIN_RATE_LIMIT.maxRequests,
      LOGIN_RATE_LIMIT.windowMs,
    );
    if (!rateLimit.allowed) {
      const retryAfter = Math.ceil((rateLimit.resetAt - Date.now()) / 1000);
      return {
        success: false,
        error: `Too many login attempts. Try again in ${retryAfter} seconds.`,
      };
    }

    const { data: user, error } = await supabaseServer
      .from("users")
      .select("id, username, password_hash, role, name, phone, failed_login_attempts, locked_until")
      .eq("username", username)
      .single();

    if (error || !user) {
      return { success: false, error: "Invalid username or password" };
    }

    const now = new Date();

    if (user.locked_until && new Date(user.locked_until) > now) {
      const unlockAt = new Date(user.locked_until).toLocaleString();
      return {
        success: false,
        error: `Account locked until ${unlockAt}. Try again later.`,
        locked: true,
      };
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
        return {
          success: false,
          error: `Too many failed attempts. Account locked for ${LOCK_DURATION_MINUTES} minutes.`,
          locked: true,
        };
      }

      const remaining = MAX_LOGIN_ATTEMPTS - newAttempts;
      return {
        success: false,
        error: `Invalid password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`,
      };
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

    return { success: true, user: authUser, token, maxAge: Math.floor(expiryMs / 1000) };
  });

// Server function that checks the session cookie and returns the current auth state.
export const verifySession = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ authenticated: boolean; user: AuthUser | null }> => {
    const token = await readSessionCookie();
    if (!token) {
      return { authenticated: false, user: null };
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
        return { authenticated: false, user: null };
      }

      const { data: user, error: userError } = await supabaseServer
        .from("users")
        .select("id, name, role, phone")
        .eq("id", decoded.id)
        .single();

      if (userError || !user) {
        return { authenticated: false, user: null };
      }

      return {
        authenticated: true,
        user: {
          id: user.id,
          name: user.name,
          role: user.role as Role,
          phone: user.phone,
        },
      };
    } catch {
      return { authenticated: false, user: null };
    }
  },
);

// Server function that revokes the active session in the database.
export const logoutUser = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ success: boolean }> => {
    const token = await readSessionCookie();
    if (token) {
      try {
        const tokenHash = hashToken(token);
        await supabaseServer.from("sessions").update({ revoked: true }).eq("token_hash", tokenHash);
      } catch {
        // ignore — cookie is cleared anyway
      }
    }

    return { success: true };
  },
);

// Server function that returns the authenticated user for the current session, or null.
export const getCurrentUser = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthUser | null> => {
    const token = await readSessionCookie();
    if (!token) return null;

    try {
      const decoded = jwt.verify(token, getJwtSecret()) as {
        id: string;
        role: Role;
      };

      const tokenHash = hashToken(token);
      const now = new Date().toISOString();

      const { data: session } = await supabaseServer
        .from("sessions")
        .select("id, revoked, expires_at")
        .eq("token_hash", tokenHash)
        .eq("revoked", false)
        .gt("expires_at", now)
        .single();

      if (!session) return null;

      const { data: user } = await supabaseServer
        .from("users")
        .select("id, name, role, phone")
        .eq("id", decoded.id)
        .single();

      if (!user) return null;

      return {
        id: user.id,
        name: user.name,
        role: user.role as Role,
        phone: user.phone,
      };
    } catch {
      return null;
    }
  },
);
