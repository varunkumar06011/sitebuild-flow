// Stubbed portal-auth module for the frontend.
// The real portal auth logic now lives in the Express server (/server/routes/portal-auth.ts).
// This stub exists only so unconverted API modules and portal routes can compile.
// Portal routes will be migrated in Stage 2.

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

export const PORTAL_COOKIE = "meditrust_portal_session";

// Stubs that throw — these should never be called from the frontend.
// If they are, it means a route is still using an unconverted server function.
export async function loginPortalAccount(_data: any): Promise<PortalLoginResult> {
  throw new Error("loginPortalAccount is not available on the client — API not yet migrated");
}

export async function verifyPortalSession(): Promise<{
  authenticated: boolean;
  account: PortalAccount | null;
}> {
  throw new Error("verifyPortalSession is not available on the client — API not yet migrated");
}

export async function logoutPortal(): Promise<{ success: boolean }> {
  throw new Error("logoutPortal is not available on the client — API not yet migrated");
}

export async function getPortalAccount(): Promise<PortalAccount | null> {
  throw new Error("getPortalAccount is not available on the client — API not yet migrated");
}

export async function requirePortalAccount(): Promise<PortalAccount> {
  throw new Error("requirePortalAccount is not available on the client — API not yet migrated");
}

export async function requireVendorAccount(): Promise<PortalAccount> {
  throw new Error("requireVendorAccount is not available on the client — API not yet migrated");
}

export async function requireClientAccount(): Promise<PortalAccount> {
  throw new Error("requireClientAccount is not available on the client — API not yet migrated");
}
