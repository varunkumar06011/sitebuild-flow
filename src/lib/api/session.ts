import jwt from "jsonwebtoken";
import { createHmac } from "crypto";
import { supabaseServer } from "../supabase-server";
import { checkServerEnv } from "../env-check";
import type { Role } from "../erp-data";
import { getStartContext } from "@tanstack/start-storage-context";

const COOKIE_NAME = "meditrust_session";

function parseCookieHeader(header: string): string | undefined {
  for (const part of header.split(";")) {
    const [key, ...val] = part.trim().split("=");
    if (key === COOKIE_NAME) return decodeURIComponent(val.join("="));
  }
  return undefined;
}

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
function hashToken(token: string): string {
  return createHmac("sha256", getJwtSecret()).update(token).digest("hex");
}

// Reads the session cookie from the current request context using multiple fallbacks.
async function readSessionCookie(): Promise<string | undefined> {
  // Method 1: getStartContext (works for SSR/GET and some serverFn POST)
  try {
    const ctx = getStartContext({ throwIfNotFound: false });
    const req = ctx?.request as Request | undefined;
    if (req) {
      const cookieHeader = req.headers.get("cookie") ?? "";
      const token = parseCookieHeader(cookieHeader);
      if (token) return token;
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
      const token = parseCookieHeader(cookieHeader);
      if (token) return token;
    }
  } catch {
    // ignore
  }

  // Method 4: vinxi/http fallback
  try {
    // @ts-ignore — vinxi/http is available at runtime via Nitro
    const vinxiHttp = await import("vinxi/http");
    const event = vinxiHttp.getEvent?.();
    if (event) {
      const cookieHeader = vinxiHttp.getHeader?.(event, "cookie") ?? "";
      const token = parseCookieHeader(cookieHeader);
      if (token) return token;
    }
  } catch {
    // ignore
  }

  return undefined;
}

// Returns the current session user if the JWT is valid and the session is active, else null.
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await readSessionCookie();
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
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("Unauthorized — no valid session");
  }
  return user;
}

// Returns the current session user if their role is in the allowed list, else throws.
// Use this in server function handlers to enforce role-based access at the API layer.
export async function requireRole(allowedRoles: Role[]): Promise<SessionUser> {
  const user = await requireSessionUser();
  if (!allowedRoles.includes(user.role)) {
    throw new Error(`Forbidden — requires one of: ${allowedRoles.join(", ")}`);
  }
  return user;
}
