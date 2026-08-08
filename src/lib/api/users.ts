import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches all users (password_hash excluded for security).
export const fetchUsers = createServerFn({ method: "GET" })
  .validator((input: { search?: string }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    // Only A1+ and Administrator can manage users
    if (user.role !== "A1+" && user.role !== "Administrator") {
      return { data: [], total: 0, error: "Insufficient permissions" };
    }

    let query = supabaseServer
      .from("users")
      .select("id, username, role, name, phone, failed_login_attempts, locked_until, created_at")
      .order("created_at", { ascending: true });

    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(`username.ilike.%${s}%,name.ilike.%${s}%,phone.ilike.%${s}%`);
      }
    }

    const { data: users, count } = await query;
    return { data: users ?? [], total: count ?? 0 };
  });

const createUserSchema = z.object({
  username: z.string().min(2),
  password: z.string().min(6),
  role: z.enum(["Supervisor", "Administrator", "A1", "A1+"]),
  name: z.string().min(1),
  phone: z.string().optional(),
});

// Creates a new user with bcrypt-hashed password.
export const createUser = createServerFn({ method: "POST" })
  .validator(createUserSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (user.role !== "A1+" && user.role !== "Administrator") {
      return { success: false, error: "Insufficient permissions" };
    }

    // Hash password with bcrypt cost 12 (matches seed data)
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
      if (error?.code === "23505") return { success: false, error: "Username already exists" };
      return { success: false, error: "Failed to create user" };
    }

    await logAction(user, "create_user", "users", newUser.id, {
      username: newUser.username,
      name: newUser.name,
      role: newUser.role,
    });
    return { success: true, id: newUser.id };
  });

const updateUserSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(2).optional(),
  password: z.string().min(6).optional(),
  role: z.enum(["Supervisor", "Administrator", "A1", "A1+"]).optional(),
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
});

// Updates an existing user. If password is provided, re-hashes it.
export const updateUser = createServerFn({ method: "POST" })
  .validator(updateUserSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (user.role !== "A1+" && user.role !== "Administrator") {
      return { success: false, error: "Insufficient permissions" };
    }

    const { id, password, ...updates } = data;

    // Build DB updates — map password to password_hash column
    const dbUpdates: Record<string, any> = { ...updates };
    if (password) {
      dbUpdates["password_hash"] = await bcrypt.hash(password, 12);
    }

    const { error } = await supabaseServer.from("users").update(dbUpdates).eq("id", id);

    if (error) {
      if (error.code === "23505") return { success: false, error: "Username already exists" };
      return { success: false, error: "Failed to update user" };
    }

    await logAction(user, "update_user", "users", id, updates);
    return { success: true };
  });

// Deletes a user. Prevents self-deletion.
export const deleteUser = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (user.role !== "A1+" && user.role !== "Administrator") {
      return { success: false, error: "Insufficient permissions" };
    }

    // Prevent self-deletion
    if (user.id === data.id) {
      return { success: false, error: "Cannot delete your own account" };
    }

    const { error } = await supabaseServer.from("users").delete().eq("id", data.id);

    if (error) return { success: false, error: "Failed to delete user" };

    await logAction(user, "delete_user", "users", data.id, {});
    return { success: true };
  });

// Unlocks a locked user account (resets failed_login_attempts and locked_until).
export const unlockUser = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (user.role !== "A1+" && user.role !== "Administrator") {
      return { success: false, error: "Insufficient permissions" };
    }

    const { error } = await supabaseServer
      .from("users")
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq("id", data.id);

    if (error) return { success: false, error: "Failed to unlock user" };

    await logAction(user, "unlock_user", "users", data.id, {});
    return { success: true };
  });

// Fetches active (non-expired, non-revoked) sessions with user names (admin only).
export const fetchActiveSessions = createServerFn({ method: "GET" })
  .validator((input: {}) => input)
  .handler(async () => {
    const user = await requireSessionUser();
    if (user.role !== "A1+" && user.role !== "Administrator") {
      return { data: [] };
    }

    const { data: sessions } = await supabaseServer
      .from("sessions")
      .select("id, user_id, token_hash, expires_at, revoked, created_at")
      .eq("revoked", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    // Resolve user names
    const userIds = [...new Set((sessions ?? []).map((s: any) => s.user_id))];
    const { data: users } = await supabaseServer
      .from("users")
      .select("id, name, role")
      .in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u]));

    return {
      data: (sessions ?? []).map((s: any) => ({
        ...s,
        user_name: userMap.get(s.user_id)?.name ?? "Unknown",
        user_role: userMap.get(s.user_id)?.role ?? "—",
      })),
    };
  });

// Revokes a session by ID (force logout). Admin only.
export const revokeSession = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (user.role !== "A1+" && user.role !== "Administrator") {
      return { success: false, error: "Insufficient permissions" };
    }

    const { error } = await supabaseServer
      .from("sessions")
      .update({ revoked: true })
      .eq("id", data.id);

    if (error) return { success: false, error: "Failed to revoke session" };

    await logAction(user, "revoke_session", "sessions", data.id, {});
    return { success: true };
  });

// Fetches role change audit trail (admin only).
export const fetchRoleChangeAudit = createServerFn({ method: "GET" })
  .validator((input: { limit?: number }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (user.role !== "A1+" && user.role !== "Administrator") {
      return { data: [] };
    }

    const { data: entries } = await supabaseServer
      .from("role_change_audit")
      .select("*")
      .limit(data.limit ?? 100);

    return { data: entries ?? [] };
  });
