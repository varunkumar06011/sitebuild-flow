import { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { createHmac } from "crypto";
import { supabaseServer } from "../lib/supabase-server.js";
import { checkServerEnv } from "../lib/env-check.js";
import { readPortalCookie, getPortalAccount } from "../lib/portal-session.js";
import { checkRateLimit, getClientIpFromReq, LOGIN_RATE_LIMIT } from "../lib/rate-limiter.js";

export const portalAuthRouter = Router();

const PORTAL_COOKIE_NAME = "meditrust_portal_session";
const MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

function getPortalCookieOptions(maxAgeSeconds: number) {
  const isProduction = process.env["NODE_ENV"] === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ("none" as const) : ("lax" as const),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

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

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  account_type: z.enum(["vendor", "client"]),
});

// POST /api/portal-auth/login
portalAuthRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const data = loginSchema.parse(req.body);

    // IP-based rate limiting to prevent brute-force attacks
    const ip = getClientIpFromReq(req);
    const rateLimit = checkRateLimit(
      `portal-login:${ip}`,
      LOGIN_RATE_LIMIT.maxRequests,
      LOGIN_RATE_LIMIT.windowMs,
    );
    if (!rateLimit.allowed) {
      res.json({
        success: false,
        error: "Too many login attempts. Try again later.",
      });
      return;
    }

    const { data: account, error } = await supabaseServer
      .from("portal_accounts")
      .select("id, account_type, vendor_id, name, email, phone, password_hash, failed_attempts, locked_until, status")
      .eq("username", data.username)
      .eq("account_type", data.account_type)
      .single();

    if (error || !account) {
      res.json({ success: false, error: "Invalid username or password" });
      return;
    }

    if ((account as any).status === "suspended") {
      res.json({ success: false, error: "Account suspended. Contact administrator." });
      return;
    }

    const lockedUntil = (account as any).locked_until;
    if (lockedUntil && new Date(lockedUntil) > new Date()) {
      res.json({ success: false, error: "Account temporarily locked due to too many failed attempts", locked: true });
      return;
    }

    const passwordMatch = await bcrypt.compare(data.password, (account as any).password_hash);
    if (!passwordMatch) {
      const newAttempts = ((account as any).failed_attempts ?? 0) + 1;
      const shouldLock = newAttempts >= MAX_LOGIN_ATTEMPTS;

      await supabaseServer
        .from("portal_accounts")
        .update({
          failed_attempts: newAttempts,
          locked_until: shouldLock ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString() : null,
        })
        .eq("id", (account as any).id);

      res.json({
        success: false,
        error: shouldLock ? `Account locked for ${LOCK_DURATION_MINUTES} minutes` : "Invalid username or password",
        locked: shouldLock,
      });
      return;
    }

    // Reset failed attempts on successful login
    await supabaseServer
      .from("portal_accounts")
      .update({ failed_attempts: 0, locked_until: null })
      .eq("id", (account as any).id);

    // Generate JWT token
    const token = jwt.sign(
      { id: (account as any).id, type: (account as any).account_type },
      getJwtSecret(),
      { expiresIn: `${MAX_AGE_SECONDS}s` },
    );

    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + MAX_AGE_SECONDS * 1000).toISOString();

    // Create portal session
    await supabaseServer.from("portal_sessions").insert({
      account_id: (account as any).id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      revoked: false,
      created_at: new Date().toISOString(),
    });

    // Set the session cookie server-side so the client never sees the token value.
    res.cookie(PORTAL_COOKIE_NAME, token, getPortalCookieOptions(MAX_AGE_SECONDS));

    res.json({
      success: true,
      account: {
        id: (account as any).id,
        account_type: (account as any).account_type,
        vendor_id: (account as any).vendor_id,
        name: (account as any).name,
        email: (account as any).email,
        phone: (account as any).phone,
      },
      maxAge: MAX_AGE_SECONDS,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.json({ success: false, error: "Invalid input" });
      return;
    }
    console.error("portal login error:", err);
    res.status(500).json({ success: false, error: "Login failed" });
  }
});

// GET /api/portal-auth/verify
portalAuthRouter.get("/verify", async (req: Request, res: Response) => {
  try {
    const account = await getPortalAccount(req);
    if (!account) {
      res.json({ authenticated: false, account: null });
      return;
    }
    res.json({
      authenticated: true,
      account: {
        id: account.id,
        account_type: account.account_type,
        vendor_id: account.vendor_id,
        name: account.name,
        email: account.email,
        phone: account.phone,
      },
    });
  } catch (err) {
    console.error("portal verify error:", err);
    res.json({ authenticated: false, account: null });
  }
});

// POST /api/portal-auth/logout
portalAuthRouter.post("/logout", async (req: Request, res: Response) => {
  try {
    const token = readPortalCookie(req);
    if (token) {
      const tokenHash = hashToken(token);
      await supabaseServer
        .from("portal_sessions")
        .update({ revoked: true })
        .eq("token_hash", tokenHash);
    }
    res.clearCookie(PORTAL_COOKIE_NAME, getPortalCookieOptions(0));
    res.json({ success: true });
  } catch (err) {
    console.error("portal logout error:", err);
    res.clearCookie(PORTAL_COOKIE_NAME, getPortalCookieOptions(0));
    res.json({ success: true });
  }
});
