"use client";

import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { ROLE_NAV, type Role } from "@/lib/erp-data";
import { useRole } from "@/lib/role-context";
import { globalEntitySearch, type SearchResult } from "@/lib/api/global-search";

// Maps icon string names to lucide-react components for rendering in search results.
import {
  LayoutDashboard,
  ClipboardList,
  ShieldCheck,
  ScanLine,
  Boxes,
  BadgeCheck,
  Users,
  HeartPulse,
  Wallet,
  TrendingDown,
  Receipt,
  Lock,
  Building2,
  Package,
  Settings2,
  TrendingUp,
  Settings,
  History,
  UserCog,
  HardHat,
  Search,
  type LucideIcon,
} from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  ClipboardList,
  ShieldCheck,
  ScanLine,
  Boxes,
  BadgeCheck,
  Users,
  HeartPulse,
  Wallet,
  TrendingDown,
  Receipt,
  Lock,
  Building2,
  Package,
  Settings2,
  TrendingUp,
  Settings,
  History,
  UserCog,
  HardHat,
};

// Global search command palette — activated with Cmd+K / Ctrl+K.
// Searches across all navigation routes and real data entities (PRs, vendors,
// gate passes, inventory items, equipment, batches) available to the current user.
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const { role } = useRole();

  // Listen for Cmd+K / Ctrl+K to toggle the palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      // Escape to close
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Debounce the entity search query — only search after the user stops typing
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Entity search — only fires when query is at least 2 characters
  const { data: entityData } = useQuery({
    queryKey: ["global-entity-search", debouncedQuery],
    queryFn: () => globalEntitySearch({ query: debouncedQuery }),
    enabled: open && debouncedQuery.length >= 2,
    staleTime: 30 * 1000,
  });

  const entityResults: SearchResult[] = entityData?.data ?? [];

  // Group entity results by type
  const entityGroups: Record<string, SearchResult[]> = {};
  entityResults.forEach((r) => {
    if (!entityGroups[r.type]) entityGroups[r.type] = [];
    entityGroups[r.type]!.push(r);
  });

  const navItems = (ROLE_NAV[role as Role] ?? []).filter(
    (item): item is { to: string; label: string; icon: string } => "to" in item,
  );

  // Group nav items by category for the command palette
  const groups: Record<string, typeof navItems> = {};
  navItems.forEach((item) => {
    const category = categorizeRoute(item.to);
    if (!groups[category]) groups[category] = [];
    groups[category].push(item);
  });

  const handleSelect = useCallback(
    (to: string) => {
      setOpen(false);
      setSearchQuery("");
      navigate({ to });
    },
    [navigate],
  );

  // Reset search when dialog closes
  useEffect(() => {
    if (!open) setSearchQuery("");
  }, [open]);

  const hasEntityResults = entityResults.length > 0;
  const showNav = debouncedQuery.length < 2;

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search pages, PRs, vendors, gate passes, items..."
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Entity search results — shown when query is 2+ characters */}
          {hasEntityResults && (
            <>
              {Object.entries(entityGroups).map(([type, items], idx) => (
                <div key={type}>
                  {idx > 0 && <CommandSeparator />}
                  <CommandGroup heading={type}>
                    {items.map((r) => (
                      <CommandItem
                        key={`${r.type}-${r.id}`}
                        value={`${r.type} ${r.label} ${r.sublabel}`}
                        onSelect={() => handleSelect(r.route)}
                      >
                        <Search className="size-4 text-muted-foreground" />
                        <span className="font-medium">{r.label}</span>
                        <span className="ml-1 text-xs text-muted-foreground truncate">
                          {r.sublabel}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </div>
              ))}
              <CommandSeparator />
            </>
          )}

          {/* Navigation results — shown when query is short or no entity results */}
          {showNav && (
            <>
              {Object.entries(groups).map(([category, items], idx) => (
                <div key={category}>
                  {idx > 0 && <CommandSeparator />}
                  <CommandGroup heading={category}>
                    {items.map((item) => {
                      const Icon = ICON_MAP[item.icon] ?? LayoutDashboard;
                      return (
                        <CommandItem
                          key={item.to}
                          value={`${item.label} ${item.to} ${category}`}
                          onSelect={() => handleSelect(item.to)}
                        >
                          <Icon className="size-4 text-muted-foreground" />
                          <span>{item.label}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{item.to}</span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </div>
              ))}
              <CommandSeparator />
              <CommandGroup heading="Quick actions">
                <CommandItem
                  value="user management accounts"
                  onSelect={() => handleSelect("/users")}
                >
                  <UserCog className="size-4 text-muted-foreground" />
                  <span>User Management</span>
                </CommandItem>
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      {/* Hidden trigger — the palette is activated via keyboard shortcut */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sr-only"
        aria-label="Open global search"
      />
    </>
  );
}

// Categorizes a route path into a display group for the command palette.
function categorizeRoute(to: string): string {
  if (
    to.includes("dashboard") ||
    to === "/supervisor" ||
    to === "/administrator" ||
    to === "/a1" ||
    to === "/a1plus"
  )
    return "Dashboards";
  if (to.includes("procurement") || to.includes("approvals")) return "Procurement";
  if (to.includes("gate-pass")) return "Site Operations";
  if (to.includes("traceability") || to.includes("quality") || to.includes("batches"))
    return "Quality & Traceability";
  if (to.includes("registers") || to.includes("labour")) return "Registers & Labour";
  if (to.includes("medical")) return "Hospital Compliance";
  if (
    to.includes("budget") ||
    to.includes("cash-flow") ||
    to.includes("tds-gst") ||
    to.includes("retention")
  )
    return "Finance";
  if (to.includes("vendor")) return "Vendors";
  if (to.includes("inventory")) return "Inventory";
  if (to.includes("progress")) return "Progress Tracking";
  if (to.includes("user")) return "Administration";
  if (to.includes("setting") || to.includes("audit")) return "System";
  return "Other";
}

// Visible trigger button for the command palette — shows a search hint with the Cmd+K shortcut.
// Dispatches a synthetic Ctrl+K keydown event to open the GlobalSearch dialog.
export function GlobalSearchTrigger() {
  const handleOpen = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
  };
  return (
    <button
      type="button"
      onClick={handleOpen}
      className="hidden items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent md:flex"
      aria-label="Open search (Ctrl+K)"
    >
      <Search className="size-3.5" />
      <span>Search...</span>
      <kbd className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
    </button>
  );
}
