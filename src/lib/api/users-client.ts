import { api } from "../api-client";

export function fetchUsers(params?: { search?: string }) {
  return api.get("/api/users/fetch", params);
}

export function createUser(data: {
  username: string;
  password: string;
  role: "Supervisor" | "Administrator" | "A1" | "A1+";
  name: string;
  phone?: string;
}) {
  return api.post("/api/users/create", data);
}

export function updateUser(data: {
  id: string;
  username?: string;
  password?: string;
  role?: "Supervisor" | "Administrator" | "A1" | "A1+";
  name?: string;
  phone?: string;
}) {
  return api.post("/api/users/update", data);
}

export function deleteUser(data: { id: string }) {
  return api.post("/api/users/delete", data);
}

export function unlockUser(data: { id: string }) {
  return api.post("/api/users/unlock", data);
}

export function fetchActiveSessions() {
  return api.get("/api/users/sessions");
}

export function revokeSession(data: { id: string }) {
  return api.post("/api/users/revoke-session", data);
}

export function fetchRoleChangeAudit(params?: { limit?: number }) {
  return api.get("/api/users/role-change-audit", params);
}
