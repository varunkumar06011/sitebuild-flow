import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LayoutDashboard,
  ClipboardList,
  ShieldCheck,
  ScanLine,
  Boxes,
  BadgeCheck,
  Users,
  HardHat,
  LogOut,
  Bell,
  Building2,
  Settings,
  History,
  CheckCheck,
  TrendingUp,
  Settings2,
  Package,
} from "lucide-react";
import type { ReactNode } from "react";
import { useRole } from "@/lib/role-context";
import { ROLE_NAV, ROLE_SUMMARY } from "@/lib/erp-data";
import { Button } from "@/components/ui/button";
import { logoutUser } from "@/lib/auth-server";
import { fetchNotifications, markAllNotificationsRead } from "@/lib/api/notifications";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";

const ICON_MAP: Record<string, typeof HardHat> = {
  LayoutDashboard,
  ClipboardList,
  ShieldCheck,
  ScanLine,
  Boxes,
  BadgeCheck,
  Users,
  HardHat,
  Building2,
  Settings,
  History,
  TrendingUp,
  Settings2,
  Package,
};

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const { role, name, logout } = useRole();
  const queryClient = useQueryClient();
  const navItems = ROLE_NAV[role] ?? [];

  const { data: notifData } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => fetchNotifications({ data: { unreadOnly: true, limit: 10 } }),
    refetchInterval: 30000,
  });
  const unreadCount = notifData?.data?.length ?? 0;
  const notifications = notifData?.data ?? [];

  const handleLogout = async () => {
    await logoutUser();
    document.cookie = "meditrust_session=; path=/; max-age=0; samesite=lax";
    logout();
    window.location.href = "/login";
  };

  const handleMarkAllRead = async () => {
    const result = await markAllNotificationsRead();
    if (result.success) {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    } else {
      toast.error("Failed to mark notifications");
    }
  };

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
          {navItems.map(({ to, label, icon }) => {
            const Icon = ICON_MAP[icon] ?? LayoutDashboard;
            return (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" || to === `/${role.toLowerCase().replace("+", "plus")}` }}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className:
                    "bg-sidebar-accent text-sidebar-accent-foreground font-semibold",
                }}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="m-3 space-y-3">
          <div className="rounded-xl bg-surface p-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Signed in as</p>
            <p className="mt-1 font-bold text-primary">{name ?? role}</p>
            <p className="mt-0.5">{ROLE_SUMMARY[role].limit}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 size-4" />
            Sign out
          </Button>
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
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="relative">
                    <Bell className="size-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <p className="text-sm font-semibold">Notifications</p>
                    {unreadCount > 0 && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleMarkAllRead}>
                        <CheckCheck className="mr-1 size-3" /> Mark all read
                      </Button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">No unread notifications</p>
                    ) : (
                      notifications.map((n: any) => (
                        <div key={n.id} className="border-b border-border px-4 py-3 last:border-0">
                          <p className="text-sm font-medium">{n.title}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground/70">
                            {new Date(n.created_at).toLocaleString("en-IN")}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </PopoverContent>
              </Popover>
              <div className="hidden text-right sm:block">
                <p className="text-xs font-medium text-muted-foreground">Role</p>
                <p className="text-xs font-bold text-primary">{role}</p>
              </div>
              <Button variant="outline" size="sm" onClick={handleLogout}>
                <LogOut className="mr-1.5 size-3.5" />
                Logout
              </Button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:hidden">
            {navItems.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/" || to === `/${role.toLowerCase().replace("+", "plus")}` }}
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
