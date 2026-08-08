// Portal authentication — separate from internal user auth.
// Handles vendor and client portal logins with their own JWT cookie.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHmac } from "crypto";
import { supabaseServer } from "../supabase-server";
import { checkServerEnv } from "../env-check";
import { getStartContext } from "@tanstack/start-storage-context";
import { logAction } from "./audit";
import type { SessionUser } from "./session";

// Builds a pseudo SessionUser from a portal account for audit logging.
// Portal accounts don't have internal user records, so we synthesize the
// minimum shape that logAction needs.
function portalAuditUser(account: { id: string; name: string; account_type: string }): SessionUser {
  return {
    id: account.id,
    name: account.name,
    role: account.account_type as any,
    phone: null,
  };
}

export type PortalAccountType = "vendor" | "client";

export type PortalAccount = {
  id: string;
  account_type: PortalAccountType;
  vendor_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
};

const PORTAL_COOKIE_NAME = "meditrust_portal_session";
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;
const PORTAL_JWT_EXPIRY = "8h";

function getJwtSecret(): string {
  const secret = process.env["APP_JWT_SECRET"];
  if (!secret) {
    checkServerEnv();
    throw new Error("APP_JWT_SECRET is not set");
  }
  return secret;
}

function hashToken(token: string): string {
  return createHmac("sha256", getJwtSecret()).update(token).digest("hex");
}

function parseExpiryToMs(expiry: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(expiry);
  if (!match) return 8 * 60 * 60 * 1000;
  const num = parseInt(match[1] as string, 10);
  const unit = match[2] as string;
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return num * (multipliers[unit] ?? 8 * 60 * 60 * 1000);
}

// Reads the portal session cookie from the request.
async function readPortalCookie(): Promise<string | undefined> {
  try {
    const ctx = getStartContext({ throwIfNotFound: false });
    const req = ctx?.request as Request | undefined;
    if (req) {
      const cookieHeader = req.headers.get("cookie") ?? "";
      for (const part of cookieHeader.split(";")) {
        const [key, ...val] = part.trim().split("=");
        if (key === PORTAL_COOKIE_NAME) return decodeURIComponent(val.join("="));
      }
    }
  } catch {
    // ignore
  }

  try {
    const { getCookie } = await import("@tanstack/start-server-core");
    const value = getCookie(PORTAL_COOKIE_NAME);
    if (value) return decodeURIComponent(value);
  } catch {
    // ignore
  }

  return undefined;
}

export type PortalLoginResult =
  | { success: true; account: PortalAccount; token: string; maxAge: number }
  | { success: false; error: string; locked?: boolean };

const portalLoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  account_type: z.enum(["vendor", "client"]),
});

// Portal login — validates credentials, enforces lockout, issues JWT.
export const loginPortalAccount = createServerFn({ method: "POST" })
  .validator(portalLoginSchema)
  .handler(async ({ data }): Promise<PortalLoginResult> => {
    const { username, password, account_type } = data;

    const { data: account, error } = await supabaseServer
      .from("portal_accounts")
      .select(
        "id, account_type, vendor_id, username, password_hash, name, email, phone, active, failed_login_attempts, locked_until",
      )
      .eq("username", username)
      .eq("account_type", account_type)
      .single();

    if (error || !account) {
      return { success: false, error: "Invalid username or password" };
    }

    if (!account.active) {
      return { success: false, error: "Account deactivated. Contact the project administrator." };
    }

    const now = new Date();
    if (account.locked_until && new Date(account.locked_until) > now) {
      const unlockAt = new Date(account.locked_until).toLocaleString();
      return {
        success: false,
        error: `Account locked until ${unlockAt}. Try again later.`,
        locked: true,
      };
    }

    const passwordMatch = await bcrypt.compare(password, account.password_hash);
    if (!passwordMatch) {
      const newAttempts = account.failed_login_attempts + 1;
      const shouldLock = newAttempts >= MAX_LOGIN_ATTEMPTS;
      const lockedUntil = shouldLock
        ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString()
        : null;

      await supabaseServer
        .from("portal_accounts")
        .update({
          failed_login_attempts: shouldLock ? 0 : newAttempts,
          locked_until: lockedUntil,
        })
        .eq("id", account.id);

      if (shouldLock) {
        await logAction(
          portalAuditUser(account),
          "portal_account_locked",
          "portal_account",
          account.id,
          { account_type: account.account_type, username },
        );
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

    // Reset failed attempts and update last login
    await supabaseServer
      .from("portal_accounts")
      .update({ failed_login_attempts: 0, locked_until: null, last_login_at: now.toISOString() })
      .eq("id", account.id);

    const token = jwt.sign(
      { id: account.id, type: account.account_type, vendor_id: account.vendor_id },
      getJwtSecret(),
      { expiresIn: PORTAL_JWT_EXPIRY as any },
    );

    const tokenHash = hashToken(token);
    const expiryMs = parseExpiryToMs(PORTAL_JWT_EXPIRY);
    const expiresAt = new Date(Date.now() + expiryMs).toISOString();

    await supabaseServer.from("portal_sessions").insert({
      account_id: account.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      revoked: false,
    });

    const portalAccount: PortalAccount = {
      id: account.id,
      account_type: account.account_type as PortalAccountType,
      vendor_id: account.vendor_id,
      name: account.name,
      email: account.email,
      phone: account.phone,
    };

    await logAction(portalAuditUser(account), "portal_login", "portal_account", account.id, {
      account_type: account.account_type,
      username,
    });

    return { success: true, account: portalAccount, token, maxAge: Math.floor(expiryMs / 1000) };
  });

export const PORTAL_COOKIE = PORTAL_COOKIE_NAME;

// Returns the current portal account from the session cookie, or null.
export async function getPortalAccount(): Promise<PortalAccount | null> {
  const token = await readPortalCookie();
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as {
      id: string;
      type: PortalAccountType;
      vendor_id: string | null;
    };
    const tokenHash = hashToken(token);
    const now = new Date().toISOString();

    const { data: session } = await supabaseServer
      .from("portal_sessions")
      .select("id, revoked, expires_at")
      .eq("token_hash", tokenHash)
      .eq("revoked", false)
      .gt("expires_at", now)
      .single();

    if (!session) return null;

    const { data: account } = await supabaseServer
      .from("portal_accounts")
      .select("id, account_type, vendor_id, name, email, phone, active")
      .eq("id", decoded.id)
      .single();

    if (!account || !account.active) return null;

    return {
      id: account.id,
      account_type: account.account_type as PortalAccountType,
      vendor_id: account.vendor_id,
      name: account.name,
      email: account.email,
      phone: account.phone,
    };
  } catch {
    return null;
  }
}

// Throws if no valid portal session exists.
export async function requirePortalAccount(): Promise<PortalAccount> {
  const account = await getPortalAccount();
  if (!account) {
    throw new Error("Unauthorized — no valid portal session");
  }
  return account;
}

// Throws if no valid vendor portal session exists.
export async function requireVendorAccount(): Promise<PortalAccount> {
  const account = await requirePortalAccount();
  if (account.account_type !== "vendor" || !account.vendor_id) {
    throw new Error("Unauthorized — vendor access required");
  }
  return account;
}

// Throws if no valid client portal session exists.
export async function requireClientAccount(): Promise<PortalAccount> {
  const account = await requirePortalAccount();
  if (account.account_type !== "client") {
    throw new Error("Unauthorized — client access required");
  }
  return account;
}

// Verifies the portal session and returns the account info.
export const verifyPortalSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ authenticated: boolean; account: PortalAccount | null }> => {
    const account = await getPortalAccount();
    return { authenticated: !!account, account };
  },
);

// Logs out the portal account by revoking the session.
export const logoutPortal = createServerFn({ method: "POST" }).handler(async () => {
  const token = await readPortalCookie();
  if (!token) return { success: true };

  try {
    const tokenHash = hashToken(token);
    await supabaseServer
      .from("portal_sessions")
      .update({ revoked: true })
      .eq("token_hash", tokenHash);

    // Audit log the logout if we can resolve the account
    const account = await getPortalAccount();
    if (account) {
      await logAction(portalAuditUser(account), "portal_logout", "portal_account", account.id, {
        account_type: account.account_type,
      });
    }
  } catch {
    // ignore
  }

  return { success: true };
});
