import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { supabaseServer } from "../supabase-server";
import { checkServerEnv } from "../env-check";
import type { Role } from "../erp-data";
import { getStartContext } from "@tanstack/start-storage-context";

export type SessionUser = {
  id: string;
  name: string;
  role: Role;
  phone: string | null;
};

const COOKIE_NAME = "meditrust_session";

function getJwtSecret(): string {
  const secret = process.env["APP_JWT_SECRET"];
  if (!secret) {
    checkServerEnv();
    throw new Error("APP_JWT_SECRET is not set");
  }
  return secret;
}

async function hashToken(token: string): Promise<string> {
  return bcrypt.hash(token, 10);
}

async function readSessionCookie(): Promise<string | undefined> {
  // Try getStartContext first (works for SSR/GET and serverFn POST)
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

  // Fallback: dynamic import for cases where getStartContext doesn't have request
  try {
    const { getCookie } = await import("@tanstack/start-server-core");
    const value = getCookie(COOKIE_NAME);
    if (value) return decodeURIComponent(value);
  } catch {
    // ignore
  }

  return undefined;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const token = await readSessionCookie();
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { id: string; role: Role };
    const tokenHash = await hashToken(token);
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

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Error("Unauthorized — no valid session");
  }
  return user;
}
