// Type definitions and utility functions for the Hospital Construction ERP.
// Mock data arrays have been removed — all data is fetched via server functions.

export type Role = "Supervisor" | "Administrator" | "A1" | "A1+";

export const ROLES: Role[] = ["Supervisor", "Administrator", "A1", "A1+"];

export const ROLE_SUMMARY: Record<Role, { scope: string; cannot: string; limit: string }> = {
  Supervisor: {
    scope: "Executes site operations, raises PRs, uploads quotations, POs, receipts, invoices",
    cannot: "Approve quotations, POs or payments",
    limit: "No approval authority",
  },
  Administrator: {
    scope: "Reviews & approves within limit, manages vendors, finance, users, reports",
    cannot: "Override Head Admin (A1+) rules",
    limit: "Up to ₹50,000",
  },
  A1: {
    scope: "Approves above admin limit, overrides project decisions, organization reports",
    cannot: "Grant final authority above ₹5,00,000",
    limit: "₹50,001 – ₹5,00,000",
  },
  "A1+": {
    scope: "Final approval authority, full system control",
    cannot: "—",
    limit: "Above ₹5,00,000",
  },
};

export function approverFor(amount: number): Role {
  if (amount <= 50000) return "Administrator";
  if (amount <= 500000) return "A1";
  return "A1+";
}

// Maps a role name to the corresponding procurement stage name.
// "Administrator" → "Admin" (the DB enum uses the short form).
// "A1" and "A1+" match their stage names directly.
export function stageForRole(role: Role): string {
  if (role === "Administrator") return "Admin";
  return role;
}

// Maps a procurement stage name to the corresponding role name.
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

export const inr = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

export const PROCUREMENT_STAGES = [
  "PR",
  "Quotation",
  "Admin",
  "A1",
  "A1+",
  "PO",
  "Material Received",
  "Invoice",
  "Payment",
  "Completed",
  "Cancelled",
] as const;
export type Stage = (typeof PROCUREMENT_STAGES)[number];

export type Requisition = {
  id: string;
  title: string;
  block: string;
  vendor: string;
  amount: number;
  stage: Stage;
  raisedBy: string;
  date: string;
  quotations: { vendor: string; amount: number; selected: boolean }[];
  documents: string[];
};

export type NavRoute = {
  to: string;
  label: string;
  icon: string;
};

export const ROLE_NAV: Record<Role, NavRoute[]> = {
  Supervisor: [
    { to: "/supervisor", label: "My Dashboard", icon: "LayoutDashboard" },
    { to: "/procurement", label: "Procurement", icon: "ClipboardList" },
    { to: "/gate-pass", label: "Gate Pass", icon: "ScanLine" },
    { to: "/traceability", label: "Traceability", icon: "Boxes" },
    { to: "/quality", label: "Quality Control", icon: "BadgeCheck" },
    { to: "/registers", label: "Registers & Labour", icon: "Users" },
    { to: "/progress-tracking", label: "Progress Tracking", icon: "TrendingUp" },
    { to: "/progress-dashboard", label: "Progress Dashboard", icon: "TrendingUp" },
    { to: "/inventory-supervisor", label: "Log Material", icon: "Package" },
    { to: "/work-orders", label: "Work Orders", icon: "ClipboardList" },
    { to: "/labour", label: "Labour Attendance", icon: "Users" },
    { to: "/drawings", label: "Drawings & RFIs", icon: "FileText" },
  ],
  Administrator: [
    { to: "/administrator", label: "Dashboard", icon: "LayoutDashboard" },
    { to: "/documents", label: "Documents", icon: "FileText" },
    { to: "/procurement", label: "Procurement", icon: "ClipboardList" },
    { to: "/approvals", label: "Approvals", icon: "ShieldCheck" },
    { to: "/gate-pass", label: "Gate Pass", icon: "ScanLine" },
    { to: "/traceability", label: "Traceability", icon: "Boxes" },
    { to: "/quality", label: "Quality Control", icon: "BadgeCheck" },
    { to: "/registers", label: "Registers & Labour", icon: "Users" },
    { to: "/budget", label: "Budget vs Actual", icon: "Wallet" },
    { to: "/cash-flow", label: "Cash Flow", icon: "TrendingDown" },
    { to: "/tds-gst", label: "TDS & GST", icon: "Receipt" },
    { to: "/retention", label: "Retention Money", icon: "Lock" },
    { to: "/vendors", label: "Vendors", icon: "Building2" },
    { to: "/inventory", label: "Inventory", icon: "Package" },
    { to: "/parts-orders", label: "Parts Orders", icon: "Package" },
    { to: "/work-orders", label: "Work Orders", icon: "ClipboardList" },
    { to: "/progress-config", label: "Progress Config", icon: "Settings2" },
    { to: "/progress-dashboard", label: "Progress Dashboard", icon: "TrendingUp" },
    { to: "/users", label: "User Management", icon: "UserCog" },
    { to: "/labour", label: "Labour Attendance", icon: "Users" },
    { to: "/drawings", label: "Drawings & RFIs", icon: "FileText" },
    { to: "/vendor-scorecard", label: "Vendor Scorecards", icon: "Award" },
    { to: "/reports", label: "Reports & Analytics", icon: "BarChart3" },
    { to: "/settings", label: "Settings", icon: "Settings" },
  ],
  A1: [
    { to: "/a1", label: "Dashboard", icon: "LayoutDashboard" },
    { to: "/documents", label: "Documents", icon: "FileText" },
    { to: "/procurement", label: "Procurement", icon: "ClipboardList" },
    { to: "/approvals", label: "Approvals", icon: "ShieldCheck" },
    { to: "/gate-pass", label: "Gate Pass", icon: "ScanLine" },
    { to: "/traceability", label: "Traceability", icon: "Boxes" },
    { to: "/quality", label: "Quality Control", icon: "BadgeCheck" },
    { to: "/registers", label: "Registers & Labour", icon: "Users" },
    { to: "/budget", label: "Budget vs Actual", icon: "Wallet" },
    { to: "/cash-flow", label: "Cash Flow", icon: "TrendingDown" },
    { to: "/tds-gst", label: "TDS & GST", icon: "Receipt" },
    { to: "/retention", label: "Retention Money", icon: "Lock" },
    { to: "/vendors", label: "Vendors", icon: "Building2" },
    { to: "/inventory", label: "Inventory", icon: "Package" },
    { to: "/parts-orders", label: "Parts Orders", icon: "Package" },
    { to: "/work-orders", label: "Work Orders", icon: "ClipboardList" },
    { to: "/progress-config", label: "Progress Config", icon: "Settings2" },
    { to: "/progress-dashboard", label: "Progress Dashboard", icon: "TrendingUp" },
    { to: "/users", label: "User Management", icon: "UserCog" },
    { to: "/labour", label: "Labour Attendance", icon: "Users" },
    { to: "/drawings", label: "Drawings & RFIs", icon: "FileText" },
    { to: "/vendor-scorecard", label: "Vendor Scorecards", icon: "Award" },
    { to: "/notification-settings", label: "Notifications", icon: "Bell" },
    { to: "/system-robustness", label: "System Robustness", icon: "ShieldCheck" },
    { to: "/reports", label: "Reports & Analytics", icon: "BarChart3" },
    { to: "/role-audit", label: "Role Audit", icon: "UserCog" },
    { to: "/settings", label: "Settings", icon: "Settings" },
  ],
  "A1+": [
    { to: "/a1plus", label: "Dashboard", icon: "LayoutDashboard" },
    { to: "/documents", label: "Documents", icon: "FileText" },
    { to: "/procurement", label: "Procurement", icon: "ClipboardList" },
    { to: "/approvals", label: "Approvals", icon: "ShieldCheck" },
    { to: "/gate-pass", label: "Gate Pass", icon: "ScanLine" },
    { to: "/traceability", label: "Traceability", icon: "Boxes" },
    { to: "/quality", label: "Quality Control", icon: "BadgeCheck" },
    { to: "/registers", label: "Registers & Labour", icon: "Users" },
    { to: "/budget", label: "Budget vs Actual", icon: "Wallet" },
    { to: "/cash-flow", label: "Cash Flow", icon: "TrendingDown" },
    { to: "/tds-gst", label: "TDS & GST", icon: "Receipt" },
    { to: "/retention", label: "Retention Money", icon: "Lock" },
    { to: "/vendors", label: "Vendors", icon: "Building2" },
    { to: "/inventory", label: "Inventory", icon: "Package" },
    { to: "/parts-orders", label: "Parts Orders", icon: "Package" },
    { to: "/work-orders", label: "Work Orders", icon: "ClipboardList" },
    { to: "/progress-config", label: "Progress Config", icon: "Settings2" },
    { to: "/progress-dashboard", label: "Progress Dashboard", icon: "TrendingUp" },
    { to: "/users", label: "User Management", icon: "UserCog" },
    { to: "/notification-settings", label: "Notifications", icon: "Bell" },
    { to: "/system-robustness", label: "System Robustness", icon: "ShieldCheck" },
    { to: "/reports", label: "Reports & Analytics", icon: "BarChart3" },
    { to: "/role-audit", label: "Role Audit", icon: "UserCog" },
    { to: "/settings", label: "Settings", icon: "Settings" },
    { to: "/labour", label: "Labour Attendance", icon: "Users" },
    { to: "/drawings", label: "Drawings & RFIs", icon: "FileText" },
    { to: "/vendor-scorecard", label: "Vendor Scorecards", icon: "Award" },
    { to: "/audit-log", label: "Audit Log", icon: "History" },
  ],
};

export const ROLE_DASHBOARD_ROUTE: Record<Role, string> = {
  Supervisor: "/supervisor",
  Administrator: "/administrator",
  A1: "/a1",
  "A1+": "/a1plus",
};
