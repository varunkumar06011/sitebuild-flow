import { api } from "../api-client";

export function fetchUsers(params?: { search?: string }) {
  return api.get("/users/fetch", params);
}

export function createUser(data: {
  username: string;
  password: string;
  role: "Supervisor" | "Administrator" | "A1" | "A1+";
  name: string;
  phone?: string;
}) {
  return api.post("/users/create", data);
}

export function updateUser(data: {
  id: string;
  username?: string;
  password?: string;
  role?: "Supervisor" | "Administrator" | "A1" | "A1+";
  name?: string;
  phone?: string;
}) {
  return api.post("/users/update", data);
}

export function deleteUser(data: { id: string }) {
  return api.post("/users/delete", data);
}

export function unlockUser(data: { id: string }) {
  return api.post("/users/unlock", data);
}

export function fetchActiveSessions() {
  return api.get("/users/sessions");
}

export function revokeSession(data: { id: string }) {
  return api.post("/users/revoke-session", data);
}

export function fetchRoleChangeAudit(params?: { limit?: number }) {
  return api.get("/users/role-change-audit", params);
}
