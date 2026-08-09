// Approvals page showing the role-based approval queue with tiered financial authority limits.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApprovalQueueItem } from "@/components/approval/ApprovalQueueItem";
import { DecisionHistory } from "@/components/approval/DecisionHistory";
import { useApprovalActions } from "@/hooks/use-approval-actions";
import { approverFor, ROLE_SUMMARY, type Role } from "@/lib/erp-data";
import { fetchRequisitions, type RequisitionRow } from "@/lib/api/requisitions";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { AlertCircle, Inbox, Search } from "lucide-react";

export const Route = createFileRoute("/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals & Limits — Meditrust ERP" },
      {
        name: "description",
        content:
          "Role-based approval queue with ₹50,000 admin, ₹5,00,000 A1 and above-limit A1+ authority tiers.",
      },
      { property: "og:title", content: "Approvals & Limits — Meditrust ERP" },
      {
        property: "og:description",
        content: "Approve or escalate requisitions according to Administrator, A1 and A1+ limits.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: Approvals,
  errorComponent: ({ error, reset }) => (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <AlertCircle className="mx-auto size-10 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold">Approvals failed to load</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message ?? "Something went wrong. Please try again."}
        </p>
        <Button className="mt-6" onClick={reset}>
          Try again
        </Button>
      </div>
    </div>
  ),
});

// Approval stage values that appear in the pending queue.
const APPROVAL_STAGES = ["Admin", "A1", "A1+"] as const;

// Tier filter options for the queue.
const TIER_FILTERS = ["all", "Administrator", "A1", "A1+"] as const;
type TierFilter = (typeof TIER_FILTERS)[number];

// Sort options for the queue.
const SORT_OPTIONS = ["newest", "oldest", "amount-high", "amount-low"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

// Main approvals component rendering pending decisions with approve/reject actions per role.
function Approvals() {
  const { role } = useRole();
  const actions = useApprovalActions();
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [sortBy, setSortBy] = useState<SortOption>("newest");

  const {
    data: reqData,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["requisitions"],
    queryFn: () => fetchRequisitions({ data: {} }),
    refetchInterval: 15000, // poll every 15 seconds for near-real-time updates
  });
  const requisitions: RequisitionRow[] = useMemo(() => reqData?.data ?? [], [reqData]);

  // Pending queue: requisitions in an approval stage, filtered and sorted.
  const queue = useMemo(() => {
    let items = requisitions.filter((r) =>
      (APPROVAL_STAGES as readonly string[]).includes(r.stage),
    );

    // Tier filter — by required approver.
    if (tierFilter !== "all") {
      items = items.filter((r) => approverFor(r.amount) === tierFilter);
    }

    // Search filter — PR number, title, vendor, block.
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      items = items.filter(
        (r) =>
          r.pr_number.toLowerCase().includes(q) ||
          r.title.toLowerCase().includes(q) ||
          (r.vendor_name ?? "").toLowerCase().includes(q) ||
          (r.block ?? "").toLowerCase().includes(q),
      );
    }

    // Sort.
    const sorted = [...items];
    switch (sortBy) {
      case "newest":
        sorted.sort((a, b) => b.date.localeCompare(a.date));
        break;
      case "oldest":
        sorted.sort((a, b) => a.date.localeCompare(b.date));
        break;
      case "amount-high":
        sorted.sort((a, b) => b.amount - a.amount);
        break;
      case "amount-low":
        sorted.sort((a, b) => a.amount - b.amount);
        break;
    }
    return sorted;
  }, [requisitions, tierFilter, search, sortBy]);

  // A1+ can override and approve any tier; others are gated by canApprove.
  const allowOverride = role === "A1+";

  return (
    <AppShell title="Approvals" subtitle={`Acting as ${role} · ${ROLE_SUMMARY[role].limit}`}>
      {/* Tier limit cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-medium text-muted-foreground">Administrator</p>
          <p className="mt-1 text-lg font-bold">₹0 – 50,000</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-muted-foreground">A1</p>
          <p className="mt-1 text-lg font-bold">₹50,001 – 5,00,000</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium text-muted-foreground">A1+ (final authority)</p>
          <p className="mt-1 text-lg font-bold">Above ₹5,00,000</p>
        </Card>
      </div>

      {/* Pending decisions */}
      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold">Pending decisions</h2>
          <span className="text-xs text-muted-foreground">
            {queue.length} item{queue.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Filters */}
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by PR, title, vendor, block…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search approvals"
            />
          </div>
          <Select value={tierFilter} onValueChange={(v) => setTierFilter(v as TierFilter)}>
            <SelectTrigger className="w-full sm:w-[150px]" aria-label="Filter by approval tier">
              <SelectValue placeholder="Tier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tiers</SelectItem>
              <SelectItem value="Administrator">Administrator</SelectItem>
              <SelectItem value="A1">A1</SelectItem>
              <SelectItem value="A1+">A1+</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
            <SelectTrigger className="w-full sm:w-[150px]" aria-label="Sort approvals">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="amount-high">Amount: high to low</SelectItem>
              <SelectItem value="amount-low">Amount: low to high</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Queue body */}
        <div className="mt-4 space-y-3" aria-live="polite" aria-busy={isLoading}>
          {isLoading ? (
            // Loading skeleton
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-xl border border-border p-4"
              >
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-8 w-40" />
              </div>
            ))
          ) : isError ? (
            // Error state
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <AlertCircle className="size-8 text-destructive" />
              <p className="text-sm font-medium text-destructive">Failed to load approvals</p>
              <p className="text-xs text-muted-foreground">
                {error?.message ?? "Please refresh the page to try again."}
              </p>
            </div>
          ) : queue.length === 0 ? (
            // Empty state
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <Inbox className="size-8 text-muted-foreground" />
              <p className="text-sm font-medium">No pending approvals</p>
              <p className="text-xs text-muted-foreground">
                {search || tierFilter !== "all"
                  ? "Try adjusting your filters."
                  : "All requisitions are handled — nothing awaiting your decision."}
              </p>
              {(search || tierFilter !== "all") && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => {
                    setSearch("");
                    setTierFilter("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            queue.map((r) => (
              <ApprovalQueueItem
                key={r.id}
                requisition={r}
                role={role as Role}
                actions={actions}
                approveLabel={allowOverride ? "Final Approve" : "Approve"}
                allowOverride={allowOverride}
              />
            ))
          )}
        </div>
      </Card>

      {/* Decision history */}
      <DecisionHistory requisitions={requisitions} />
    </AppShell>
  );
}
