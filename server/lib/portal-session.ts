import jwt from "jsonwebtoken";
import { createHmac } from "crypto";
import type { Request } from "express";
import { supabaseServer } from "./supabase-server.js";
import { checkServerEnv } from "./env-check.js";

const PORTAL_COOKIE_NAME = "meditrust_portal_session";

export type PortalAccountType = "vendor" | "client";

export type PortalAccount = {
  id: string;
  account_type: PortalAccountType;
  vendor_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
};

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

export function readPortalCookie(req: Request): string | undefined {
  const token = req.cookies?.[PORTAL_COOKIE_NAME] as string | undefined;
  if (token) return decodeURIComponent(token);
  return undefined;
}

export async function getPortalAccount(req: Request): Promise<PortalAccount | null> {
  const token = readPortalCookie(req);
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as { id: string; type: PortalAccountType };
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
      .select("id, account_type, vendor_id, name, email, phone")
      .eq("id", decoded.id)
      .single();

    if (!account) return null;

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

export async function requirePortalAccount(req: Request): Promise<PortalAccount> {
  const account = await getPortalAccount(req);
  if (!account) {
    throw new Error("Unauthorized — no valid portal session");
  }
  return account;
}

export async function requireVendorAccount(req: Request): Promise<PortalAccount> {
  const account = await requirePortalAccount(req);
  if (account.account_type !== "vendor" || !account.vendor_id) {
    throw new Error("Forbidden — vendor account required");
  }
  return account;
}

export async function requireClientAccount(req: Request): Promise<PortalAccount> {
  const account = await requirePortalAccount(req);
  if (account.account_type !== "client") {
    throw new Error("Forbidden — client account required");
  }
  return account;
}
