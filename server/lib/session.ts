import jwt from "jsonwebtoken";
import { createHmac } from "crypto";
import type { Request, Response } from "express";
import { supabaseServer } from "./supabase-server.js";
import { checkServerEnv } from "./env-check.js";
import type { Role } from "./erp-data.js";
import { checkRateLimit, getClientIpFromReq, API_RATE_LIMIT } from "./rate-limiter.js";

const COOKIE_NAME = "meditrust_session";

// Authenticated user shape derived from the JWT session token.
export type SessionUser = {
  id: string;
  name: string;
  role: Role;
  phone: string | null;
};

// Returns the JWT signing secret from env, throwing if unset.
function getJwtSecret(): string {
  const secret = process.env["APP_JWT_SECRET"];
  if (!secret) {
    checkServerEnv();
    throw new Error("APP_JWT_SECRET is not set");
  }
  return secret;
}

// Deterministic hash of the session token for DB lookup.
// Uses HMAC-SHA256 keyed with the JWT secret — bcrypt.hash() is unsuitable here
// because it generates a random salt on every call, making the hash non-deterministic
// and the session row impossible to find on subsequent requests.
export function hashToken(token: string): string {
  return createHmac("sha256", getJwtSecret()).update(token).digest("hex");
}

// Reads the session cookie from the Express request.
export function readSessionCookie(req: Request): string | undefined {
  const token = req.cookies?.[COOKIE_NAME] as string | undefined;
  if (token) return decodeURIComponent(token);
  return undefined;
}

// Returns the current session user if the JWT is valid and the session is active, else null.
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = readSessionCookie(req);
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { id: string; role: Role };
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
}

// Returns the current session user or throws if no valid session exists.
// Also enforces per-IP rate limiting on mutations (POST requests).
export async function requireSessionUser(req: Request): Promise<SessionUser> {
  // Rate-limit mutations: every POST route calls requireSessionUser(),
  // so this is the single chokepoint for all authenticated mutations.
  if (req.method === "POST") {
    const ip = getClientIpFromReq(req);
    const result = checkRateLimit(
      `mutation:${ip}`,
      API_RATE_LIMIT.maxRequests,
      API_RATE_LIMIT.windowMs,
    );
    if (!result.allowed) {
      throw new Error("Rate limit exceeded — too many requests");
    }
  }

  const user = await getSessionUser(req);
  if (!user) {
    throw new Error("Unauthorized — no valid session");
  }
  return user;
}

// Returns the current session user if their role is in the allowed list, else throws.
// Use this in route handlers to enforce role-based access at the API layer.
export async function requireRole(req: Request, allowedRoles: Role[]): Promise<SessionUser> {
  const user = await requireSessionUser(req);
  if (!allowedRoles.includes(user.role)) {
    throw new Error(`Forbidden — requires one of: ${allowedRoles.join(", ")}`);
  }
  return user;
}
