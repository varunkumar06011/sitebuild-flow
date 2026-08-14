import { api } from "../api-client";

export type PortalAccountType = "vendor" | "client";

export type PortalAccount = {
  id: string;
  account_type: PortalAccountType;
  vendor_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
};

export type PortalLoginResult =
  | { success: true; account: PortalAccount; maxAge: number }
  | { success: false; error: string; locked?: boolean };

export function loginPortalAccount(data: {
  username: string;
  password: string;
  account_type: "vendor" | "client";
}): Promise<PortalLoginResult> {
  return api.post("/api/portal-auth/login", data);
}

export function verifyPortalSession(): Promise<{
  authenticated: boolean;
  account: PortalAccount | null;
}> {
  return api.get("/api/portal-auth/verify");
}

export function logoutPortal(): Promise<{ success: boolean }> {
  return api.post("/api/portal-auth/logout", {});
}
