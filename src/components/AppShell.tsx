import { Link } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ClipboardList,
  ShieldCheck,
  ScanLine,
  Boxes,
  BadgeCheck,
  Users,
  HardHat,
} from "lucide-react";
import type { ReactNode } from "react";
import { useRole } from "@/lib/role-context";
import { ROLES, ROLE_SUMMARY } from "@/lib/erp-data";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const NAV = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/procurement", label: "Procurement", icon: ClipboardList },
  { to: "/approvals", label: "Approvals", icon: ShieldCheck },
  { to: "/gate-pass", label: "Gate Pass", icon: ScanLine },
  { to: "/traceability", label: "Traceability", icon: Boxes },
  { to: "/quality", label: "Quality Control", icon: BadgeCheck },
  { to: "/registers", label: "Registers & Labour", icon: Users },
] as const;

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const { role, setRole } = useRole();

  return (
    <div className="flex min-h-screen bg-background font-sans">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-6">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <HardHat className="size-5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold text-sidebar-foreground">Meditrust ERP</p>
            <p className="text-xs text-muted-foreground">Hospital Construction</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              activeOptions={{ exact: to === "/" }}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              activeProps={{
                className:
                  "bg-sidebar-accent text-sidebar-accent-foreground font-semibold",
              }}
            >
              <Icon className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
        <div className="m-3 rounded-xl bg-surface p-3 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">Approval limits</p>
          <p className="mt-1.5">₹0 – 50,000 · Administrator</p>
          <p>₹50,001 – 5,00,000 · A1</p>
          <p>Above ₹5,00,000 · A1+</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-8">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight">{title}</h1>
              <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-xs font-medium text-muted-foreground">Signed in as</p>
                <p className="text-xs text-muted-foreground">{ROLE_SUMMARY[role].limit}</p>
              </div>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger className="w-[170px] bg-card">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:hidden">
            {NAV.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" }}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground"
                activeProps={{ className: "bg-accent text-accent-foreground font-semibold" }}
              >
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="flex-1 px-5 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning-foreground",
    danger: "bg-danger-soft text-destructive",
    info: "bg-info-soft text-info",
  } as const;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
