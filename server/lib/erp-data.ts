// Minimal shared types and utility functions needed by the server.
// These mirror src/lib/erp-data.ts but only include what the server needs.

export type Role = "Supervisor" | "Administrator" | "A1" | "A1+";

export function approverFor(amount: number): Role {
  if (amount <= 50000) return "Administrator";
  if (amount <= 500000) return "A1";
  return "A1+";
}

export function stageForRole(role: Role): string {
  if (role === "Administrator") return "Admin";
  return role;
}

export function roleForStage(stage: string): Role {
  if (stage === "Admin") return "Administrator";
  return stage as Role;
}

export function canApprove(role: Role, amount: number): boolean {
  if (role === "Supervisor") return false;
  const need = approverFor(amount);
  if (role === "A1+") return true;
  if (role === "A1") return need !== "A1+";
  return need === "Administrator";
}
