import { Router, type Request, type Response } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const usersRouter = Router();

// GET /api/users/fetch
usersRouter.get("/fetch", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);

    if (user.role !== "A1+" && user.role !== "Administrator") {
      res.json({ data: [], total: 0, error: "Insufficient permissions" });
      return;
    }

    const search = req.query["search"] as string | undefined;

    let query = supabaseServer
      .from("users")
      .select("id, username, role, name, phone, failed_login_attempts, locked_until, created_at")
      .order("created_at", { ascending: true });

    if (search) {
      const s = search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(`username.ilike.%${s}%,name.ilike.%${s}%,phone.ilike.%${s}%`);
      }
    }

    const { data: users, count } = await query;
    res.json({ data: users ?? [], total: count ?? 0 });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ data: [], total: 0, error: err.message });
      return;
    }
    console.error("fetchUsers error:", err);
    res.status(500).json({ data: [], total: 0, error: "Failed to fetch users" });
  }
});

// POST /api/users/create
const createUserSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(6),
  role: z.enum(["Supervisor", "Administrator", "A1", "A1+"]),
  name: z.string().min(1),
  phone: z.string().optional(),
});

usersRouter.post("/create", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+" && user.role !== "Administrator") {
      res.json({ success: false, error: "Insufficient permissions" });
      return;
    }
    const data = createUserSchema.parse(req.body);

    const passwordHash = await bcrypt.hash(data.password, 12);

    const { data: newUser, error } = await supabaseServer
      .from("users")
      .insert({
        username: data.username,
        password_hash: passwordHash,
        role: data.role,
        name: data.name,
        phone: data.phone || null,
      })
      .select("id, username, name, role")
      .single();

    if (error || !newUser) {
      if (error?.code === "23505") {
        res.json({ success: false, error: "Username already exists" });
        return;
      }
      res.json({ success: false, error: "Failed to create user" });
      return;
    }

    await logAction(user, "create_user", "users", newUser.id, {
      username: newUser.username,
      name: newUser.name,
      role: newUser.role,
    });
    res.json({ success: true, id: newUser.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createUser error:", err);
    res.status(500).json({ success: false, error: "Failed to create user" });
  }
});

// POST /api/users/update
usersRouter.post("/update", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+" && user.role !== "Administrator") {
      res.json({ success: false, error: "Insufficient permissions" });
      return;
    }
    const { id, password, ...updates } = req.body as Record<string, any>;

    const dbUpdates: Record<string, any> = { ...updates };
    if (password) {
      dbUpdates["password_hash"] = await bcrypt.hash(password, 12);
    }

    const { error } = await supabaseServer.from("users").update(dbUpdates).eq("id", id);
    if (error) {
      if (error.code === "23505") {
        res.json({ success: false, error: "Username already exists" });
        return;
      }
      res.json({ success: false, error: "Failed to update user" });
      return;
    }

    await logAction(user, "update_user", "users", id, updates);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("updateUser error:", err);
    res.status(500).json({ success: false, error: "Failed to update user" });
  }
});

// POST /api/users/delete
usersRouter.post("/delete", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+" && user.role !== "Administrator") {
      res.json({ success: false, error: "Insufficient permissions" });
      return;
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);

    if (user.id === id) {
      res.json({ success: false, error: "Cannot delete your own account" });
      return;
    }

    const { error } = await supabaseServer.from("users").delete().eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to delete user" });
      return;
    }

    await logAction(user, "delete_user", "users", id, {});
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("deleteUser error:", err);
    res.status(500).json({ success: false, error: "Failed to delete user" });
  }
});

// POST /api/users/unlock
usersRouter.post("/unlock", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+" && user.role !== "Administrator") {
      res.json({ success: false, error: "Insufficient permissions" });
      return;
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);

    const { error } = await supabaseServer
      .from("users")
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq("id", id);

    if (error) {
      res.json({ success: false, error: "Failed to unlock user" });
      return;
    }

    await logAction(user, "unlock_user", "users", id, {});
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("unlockUser error:", err);
    res.status(500).json({ success: false, error: "Failed to unlock user" });
  }
});

// GET /api/users/sessions
usersRouter.get("/sessions", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+" && user.role !== "Administrator") {
      res.json({ data: [] });
      return;
    }

    const { data: sessions } = await supabaseServer
      .from("sessions")
      .select("id, user_id, token_hash, expires_at, revoked, created_at")
      .eq("revoked", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    const userIds = [...new Set((sessions ?? []).map((s: any) => s.user_id))];
    const { data: users } = await supabaseServer.from("users").select("id, name, role").in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    res.json({
      data: (sessions ?? []).map((s: any) => ({
        ...s,
        user_name: userMap.get(s.user_id)?.name ?? "Unknown",
        user_role: userMap.get(s.user_id)?.role ?? "—",
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ data: [], error: err.message });
      return;
    }
    console.error("fetchActiveSessions error:", err);
    res.status(500).json({ data: [], error: "Failed to fetch sessions" });
  }
});

// POST /api/users/revoke-session
usersRouter.post("/revoke-session", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+" && user.role !== "Administrator") {
      res.json({ success: false, error: "Insufficient permissions" });
      return;
    }
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);

    const { error } = await supabaseServer.from("sessions").update({ revoked: true }).eq("id", id);
    if (error) {
      res.json({ success: false, error: "Failed to revoke session" });
      return;
    }

    await logAction(user, "revoke_session", "sessions", id, {});
    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("revokeSession error:", err);
    res.status(500).json({ success: false, error: "Failed to revoke session" });
  }
});

// GET /api/users/role-change-audit
usersRouter.get("/role-change-audit", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+" && user.role !== "Administrator") {
      res.json({ data: [] });
      return;
    }

    const limit = parseInt((req.query["limit"] as string) ?? "100", 10);
    const { data: entries } = await supabaseServer
      .from("role_change_audit")
      .select("*")
      .limit(limit);

    res.json({ data: entries ?? [] });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ data: [], error: err.message });
      return;
    }
    console.error("fetchRoleChangeAudit error:", err);
    res.status(500).json({ data: [], error: "Failed to fetch role change audit" });
  }
});
