// Frontend API wrapper for auth calls.
// These functions call the Express API server instead of TanStack server functions.
import { api } from "./api-client";
import type { Role } from "./erp-data";

export type AuthUser = {
  id: string;
  name: string;
  role: Role;
  phone: string | null;
};

export type LoginResult =
  | { success: true; user: AuthUser; maxAge: number }
  | { success: false; error: string; locked?: boolean };

// POST /api/auth/login
export function loginUser(data: { username: string; password: string }): Promise<LoginResult> {
  return api.post("/api/auth/login", data);
}

// GET /api/auth/verify
export function verifySession(): Promise<{
  authenticated: boolean;
  user: AuthUser | null;
}> {
  return api.get("/api/auth/verify");
}

// POST /api/auth/logout
export function logoutUser(): Promise<{ success: boolean }> {
  return api.post("/api/auth/logout");
}

// GET /api/auth/me
export function getCurrentUser(): Promise<AuthUser | null> {
  return api.get("/api/auth/me");
}

// POST /api/auth/change-password
export function changePassword(data: {
  currentPassword: string;
  newPassword: string;
}): Promise<{ success: boolean; error?: string }> {
  return api.post("/api/auth/change-password", data);
}
