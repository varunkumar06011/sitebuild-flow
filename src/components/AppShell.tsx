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
  FileText,
  HeartPulse,
  Wallet,
  TrendingDown,
  Receipt,
  Lock,
  UserCog,
  Database,
  Brain,
  ShieldAlert,
  Award,
  RefreshCw,
} from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { useRole } from "@/lib/role-context";
import { ROLE_NAV, ROLE_SUMMARY } from "@/lib/erp-data";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { logoutUser } from "@/lib/auth-server";
import { fetchNotifications, markAllNotificationsRead } from "@/lib/api/notifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GlobalSearchTrigger } from "@/components/GlobalSearch";
import { initClickDiagnostics } from "@/lib/click-diagnostics";
import { useOfflineSync } from "@/lib/useOfflineSync";
import { toast } from "sonner";

// Maps navigation icon string names to their corresponding lucide-react components.
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
  FileText,
  HeartPulse,
  Wallet,
  TrendingDown,
  Receipt,
  Lock,
  UserCog,
  Database,
  Brain,
  ShieldAlert,
  Award,
};

// Top-level layout shell with sidebar navigation, header, notifications, and logout.
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
  const router = useRouter();
  const navItems = ROLE_NAV[role] ?? [];
  const { pendingCount, isOnline, triggerSync } = useOfflineSync();

  // Initialize click-diagnostics listener (no-op unless window.__debugClicks = true)
  useEffect(() => {
    initClickDiagnostics();
  }, []);

  // Defensive fix: Radix UI can leave `pointer-events: none` on <body> after a
  // Dialog/Popover/Sheet closes abnormally (fast interaction, nested overlays).
  // Once stuck, ALL clicks on the page are silently swallowed until a hard refresh.
  // This effect resets stray pointer-events on route change and periodically.
  useEffect(() => {
    const resetPointerEvents = () => {
      if (document.body.style.pointerEvents === "none") {
        // Only reset if no Radix overlay is actually open
        const hasOpenOverlay =
          document.querySelector("[data-state=open][role=dialog]") ||
          document.querySelector("[data-state=open][data-radix-popper-content-wrapper]") ||
          document.querySelector("[data-state=open][role=menu]") ||
          document.querySelector("[data-state=open][role=listbox]");
        if (!hasOpenOverlay) {
          document.body.style.pointerEvents = "";
        }
      }
    };

    // Run on route change
    resetPointerEvents();

    // Also check periodically — covers cases where the overlay closes
    // without a route change (e.g. Esc key, outside click)
    const interval = setInterval(resetPointerEvents, 1000);

    return () => clearInterval(interval);
  }, [router.state.location.pathname]);

  const { data: notifData } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => fetchNotifications({ data: { unreadOnly: true, limit: 10 } }),
    refetchInterval: 30000,
  });
  const unreadCount = notifData?.data?.length ?? 0;
  const notifications = notifData?.data ?? [];

  // Clears the session cookie and redirects to the login page.
  // Fire-and-forget the server call so the UI never hangs waiting for it.
  const handleLogout = () => {
    logoutUser().catch(() => {
      // server call may fail if session is already invalid — continue anyway
    });
    logout();
    queryClient.clear();
    window.location.href = "/login";
  };

  // Marks all unread notifications as read and refreshes the notification list.
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
      {/* Skip to content link for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <aside
        className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex"
        aria-label="Main navigation"
      >
        <div className="flex items-center gap-2.5 px-5 py-6">
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <HardHat className="size-5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold text-sidebar-foreground">Meditrust ERP</p>
            <p className="text-xs text-muted-foreground">Hospital Construction</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3" aria-label="Primary">
          {navItems.map(({ to, label, icon }) => {
            const Icon = ICON_MAP[icon] ?? LayoutDashboard;
            return (
              <Link
                key={to}
                to={to}
                activeOptions={{
                  exact: to === "/" || to === `/${role.toLowerCase().replace("+", "plus")}`,
                }}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{
                  className: "bg-sidebar-accent text-sidebar-accent-foreground font-semibold",
                }}
                aria-current="page"
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
            aria-label="Sign out"
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
              <GlobalSearchTrigger />
              {(pendingCount > 0 || !isOnline) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="relative"
                  aria-label={`${pendingCount} pending sync item${pendingCount > 1 ? "s" : ""}${!isOnline ? " (offline)" : ""}`}
                  onClick={() => triggerSync()}
                  disabled={!isOnline}
                >
                  <RefreshCw
                    className={`size-4 ${!isOnline ? "text-warning-foreground" : "text-muted-foreground"}`}
                  />
                  {pendingCount > 0 && (
                    <span
                      className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-warning-foreground"
                      aria-hidden="true"
                    >
                      {pendingCount > 9 ? "9+" : pendingCount}
                    </span>
                  )}
                </Button>
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="relative"
                    aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
                  >
                    <Bell className="size-4" />
                    {unreadCount > 0 && (
                      <span
                        className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground"
                        aria-hidden="true"
                      >
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="end">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <p className="text-sm font-semibold">Notifications</p>
                    {unreadCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleMarkAllRead}
                      >
                        <CheckCheck className="mr-1 size-3" /> Mark all read
                      </Button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="py-6 text-center text-sm text-muted-foreground">
                        No unread notifications
                      </p>
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
              <Button variant="outline" size="sm" onClick={handleLogout} aria-label="Logout">
                <LogOut className="mr-1.5 size-3.5" />
                Logout
              </Button>
            </div>
          </div>
          <nav
            className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 lg:hidden"
            aria-label="Mobile navigation"
          >
            {navItems.map(({ to, label }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{
                  exact: to === "/" || to === `/${role.toLowerCase().replace("+", "plus")}`,
                }}
                className="whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground"
                activeProps={{ className: "bg-accent text-accent-foreground font-semibold" }}
                aria-current="page"
              >
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main id="main-content" className="flex-1 px-5 py-6 md:px-8" role="main">
          <ErrorBoundary>{children}</ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

// Small colored badge that displays a status label with a tone-based background.
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
