// Procurement pipeline page tracking purchase requisitions from PR through quotation, PO, receipt, invoice and payment.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { DocumentVersionHistory } from "@/components/DocumentVersionHistory";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { PROCUREMENT_STAGES, approverFor, canApprove, stageForRole, inr } from "@/lib/erp-data";
import {
  fetchRequisitions,
  createRequisition,
  updateRequisitionStage,
  updateRequisitionDetails,
  fetchRequisitionHistory,
  fetchRequisitionPayments,
  addRequisitionPayment,
  fetchRequisitionItems,
  saveRequisitionItems,
  type RequisitionRow,
} from "@/lib/api/requisitions";
import { fetchVendors } from "@/lib/api/vendors";
import { fetchItems } from "@/lib/api/inventory";
import { uploadFile, getSignedUrl } from "@/lib/api/storage";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  FileText,
  Check,
  Plus,
  Trash2,
  Upload,
  ArrowRight,
  Package,
  Receipt,
  IndianRupee,
  CheckCircle2,
  X,
  XCircle,
  Loader2,
  Search,
  ExternalLink,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Download,
  History,
  Clock,
} from "lucide-react";

export const Route = createFileRoute("/procurement")({
  head: () => ({
    meta: [
      { title: "Procurement Pipeline — Meditrust ERP" },
      {
        name: "description",
        content:
          "Track purchase requisitions from PR and quotations through PO, material receipt, invoice and vendor payment.",
      },
      { property: "og:title", content: "Procurement Pipeline — Meditrust ERP" },
      {
        property: "og:description",
        content:
          "PR → Quotation → Approval → PO → Receipt → Invoice → Payment in one linked chain.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: Procurement,
  errorComponent: ({ error, reset }) => (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <AlertCircle className="mx-auto size-10 text-destructive" />
        <h1 className="mt-4 text-xl font-semibold">Procurement failed to load</h1>
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

// Stages available for the filter dropdown (includes "all").
const STAGE_FILTERS = ["all", ...PROCUREMENT_STAGES] as const;

// Number of requisitions per page in the table.
const PAGE_SIZE = 20;

// Main procurement page showing the requisitions table with create and detail dialogs.
function Procurement() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const [detailReq, setDetailReq] = useState<RequisitionRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

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
  const requisitions = reqData?.data ?? [];
  const totalCount = reqData?.total ?? 0;

  // Client-side filtering (the API supports server-side filters too, but this avoids extra round-trips for small datasets)
  const filtered = requisitions.filter((r: RequisitionRow) => {
    if (stageFilter !== "all" && r.stage !== stageFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        r.title.toLowerCase().includes(q) ||
        r.pr_number.toLowerCase().includes(q) ||
        (r.po_number ?? "").toLowerCase().includes(q) ||
        (r.grn_number ?? "").toLowerCase().includes(q) ||
        (r.block ?? "").toLowerCase().includes(q) ||
        (r.vendor_name ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Pagination — slice the filtered list for the current page.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * PAGE_SIZE;
  const pageItems = filtered.slice(pageStart, pageStart + PAGE_SIZE);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setCurrentPage(1);
  }, [stageFilter, search]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["requisitions"] });

  // Summary stats computed from the full requisitions list (not just the current page).
  const stats = {
    total: requisitions.length,
    pendingApproval: requisitions.filter(
      (r) => r.stage === "Admin" || r.stage === "A1" || r.stage === "A1+",
    ).length,
    inProgress: requisitions.filter((r) =>
      ["PO", "Material Received", "Invoice", "Payment"].includes(r.stage),
    ).length,
    completed: requisitions.filter((r) => r.stage === "Completed").length,
    cancelled: requisitions.filter((r) => r.stage === "Cancelled").length,
    totalValue: requisitions
      .filter((r) => r.stage !== "Cancelled")
      .reduce((sum, r) => sum + r.amount, 0),
  };

  return (
    <AppShell
      title="Procurement pipeline"
      subtitle="PR → Quotation → Approval → PO → Material received → Invoice → Payment"
    >
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total PRs</p>
          <p className="mt-1 text-2xl font-bold">{stats.total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Pending approval</p>
          <p className="mt-1 text-2xl font-bold text-warning">{stats.pendingApproval}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">In progress</p>
          <p className="mt-1 text-2xl font-bold text-info">{stats.inProgress}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Completed</p>
          <p className="mt-1 text-2xl font-bold text-success">{stats.completed}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Cancelled</p>
          <p className="mt-1 text-2xl font-bold text-destructive">{stats.cancelled}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total value</p>
          <p className="mt-1 text-lg font-bold font-mono">{inr(stats.totalValue)}</p>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-bold">Requisitions</h2>
          <Button size="sm" disabled={role !== "Supervisor"} onClick={() => setShowCreate(true)}>
            <Plus className="size-4" />
            New purchase requisition
          </Button>
        </div>
        {role !== "Supervisor" && (
          <p className="mt-2 text-xs text-muted-foreground">
            Only a Supervisor raises PRs. Switch role in the header to try it.
          </p>
        )}

        {/* Filters */}
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by PR, PO, title, block, vendor…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search requisitions"
            />
          </div>
          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter by stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAGE_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All stages" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="outline"
            disabled={filtered.length === 0}
            onClick={() => {
              const headers = [
                "PR Number",
                "PO Number",
                "GRN Number",
                "Title",
                "Block",
                "Vendor",
                "Amount",
                "Stage",
                "Authority",
                "Raised By",
                "Date",
              ];
              const rows = filtered.map((r) => [
                r.pr_number,
                r.po_number ?? "",
                r.grn_number ?? "",
                r.title,
                r.block ?? "",
                r.vendor_name ?? "",
                r.amount,
                r.stage,
                approverFor(r.amount),
                r.raised_by_name ?? "",
                new Date(r.date).toLocaleDateString("en-IN"),
              ]);
              const csv = [headers, ...rows]
                .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
                .join("\n");
              const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `procurement-${new Date().toISOString().slice(0, 10)}.csv`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success(`Exported ${filtered.length} requisitions to CSV`);
            }}
          >
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>

        <div className="mt-4" aria-live="polite" aria-busy={isLoading}>
          {/* --- Desktop table view (md and up) --- */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-semibold">PR</th>
                  <th className="pb-2 font-semibold">PO</th>
                  <th className="pb-2 font-semibold">GRN</th>
                  <th className="pb-2 font-semibold">Item</th>
                  <th className="pb-2 font-semibold">Vendor</th>
                  <th className="pb-2 text-right font-semibold">Value</th>
                  <th className="pb-2 font-semibold">Stage</th>
                  <th className="pb-2 font-semibold">Authority</th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  // Loading skeleton rows
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={`skeleton-${i}`}>
                      <td className="py-3">
                        <Skeleton className="h-4 w-20" />
                      </td>
                      <td className="py-3">
                        <Skeleton className="h-4 w-16" />
                      </td>
                      <td className="py-3">
                        <Skeleton className="h-4 w-16" />
                      </td>
                      <td className="py-3">
                        <Skeleton className="h-4 w-40" />
                      </td>
                      <td className="py-3">
                        <Skeleton className="h-4 w-24" />
                      </td>
                      <td className="py-3">
                        <Skeleton className="h-4 w-20" />
                      </td>
                      <td className="py-3">
                        <Skeleton className="h-5 w-16 rounded-full" />
                      </td>
                      <td className="py-3">
                        <Skeleton className="h-4 w-16" />
                      </td>
                      <td className="py-3">
                        <Skeleton className="h-8 w-14" />
                      </td>
                    </tr>
                  ))
                ) : isError ? (
                  <tr>
                    <td colSpan={9} className="py-8">
                      <div className="flex flex-col items-center gap-2 text-center">
                        <AlertCircle className="size-8 text-destructive" />
                        <p className="text-sm font-medium text-destructive">
                          Failed to load requisitions
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {error?.message ?? "Please refresh the page to try again."}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : pageItems.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8">
                      <div className="flex flex-col items-center gap-2 text-center">
                        <Inbox className="size-8 text-muted-foreground" />
                        <p className="text-sm font-medium">No requisitions found</p>
                        <p className="text-xs text-muted-foreground">
                          {search || stageFilter !== "all"
                            ? "Try adjusting your filters."
                            : "Create a new purchase requisition to get started."}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pageItems.map((r: RequisitionRow) => (
                    <tr key={r.id} className="align-middle">
                      <td className="py-3 font-mono text-xs">{r.pr_number}</td>
                      <td className="py-3 font-mono text-xs text-muted-foreground">
                        {r.po_number ?? "—"}
                      </td>
                      <td className="py-3 font-mono text-xs text-muted-foreground">
                        {r.grn_number ?? "—"}
                      </td>
                      <td className="py-3">
                        <p className="font-medium">{r.title}</p>
                        <p className="text-xs text-muted-foreground">{r.block}</p>
                      </td>
                      <td className="py-3 text-muted-foreground">{r.vendor_name ?? "—"}</td>
                      <td className="py-3 text-right font-mono font-semibold">{inr(r.amount)}</td>
                      <td className="py-3">
                        <StatusPill
                          tone={
                            r.stage === "Completed"
                              ? "success"
                              : r.stage === "Cancelled"
                                ? "danger"
                                : r.stage === "Admin" || r.stage === "A1" || r.stage === "A1+"
                                  ? "warning"
                                  : "info"
                          }
                        >
                          {r.stage}
                        </StatusPill>
                      </td>
                      <td className="py-3 text-xs text-muted-foreground">
                        {approverFor(r.amount)}
                      </td>
                      <td className="py-3 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setDetailReq(r)}>
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* --- Mobile card view (below md) --- */}
          <div className="space-y-3 md:hidden">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={`mobile-skeleton-${i}`} className="rounded-xl border border-border p-4">
                  <Skeleton className="mb-3 h-4 w-24" />
                  <Skeleton className="mb-2 h-5 w-3/4" />
                  <Skeleton className="mb-3 h-3 w-1/2" />
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-6 w-20 rounded-full" />
                    <Skeleton className="h-8 w-16" />
                  </div>
                </div>
              ))
            ) : isError ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border py-8 text-center">
                <AlertCircle className="size-8 text-destructive" />
                <p className="text-sm font-medium text-destructive">Failed to load requisitions</p>
                <p className="text-xs text-muted-foreground">
                  {error?.message ?? "Please refresh the page to try again."}
                </p>
              </div>
            ) : pageItems.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-border py-8 text-center">
                <Inbox className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">No requisitions found</p>
                <p className="text-xs text-muted-foreground">
                  {search || stageFilter !== "all"
                    ? "Try adjusting your filters."
                    : "Create a new purchase requisition to get started."}
                </p>
              </div>
            ) : (
              pageItems.map((r: RequisitionRow) => (
                <div
                  key={r.id}
                  className="cursor-pointer rounded-xl border border-border p-4 transition-colors hover:bg-accent/50"
                  onClick={() => setDetailReq(r)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetailReq(r);
                    }
                  }}
                  aria-label={`Open ${r.pr_number} — ${r.title}`}
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{r.pr_number}</span>
                    <StatusPill
                      tone={
                        r.stage === "Completed"
                          ? "success"
                          : r.stage === "Cancelled"
                            ? "danger"
                            : r.stage === "Admin" || r.stage === "A1" || r.stage === "A1+"
                              ? "warning"
                              : "info"
                      }
                    >
                      {r.stage}
                    </StatusPill>
                  </div>
                  <p className="mb-1 font-medium leading-snug">{r.title}</p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    {r.block} · {r.vendor_name ?? "—"}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold">{inr(r.amount)}</span>
                    <span className="text-xs text-muted-foreground">{approverFor(r.amount)}</span>
                  </div>
                  {(r.po_number || r.grn_number) && (
                    <div className="mt-2 flex gap-3 border-t border-border pt-2 text-xs text-muted-foreground">
                      {r.po_number && <span>PO: {r.po_number}</span>}
                      {r.grn_number && <span>GRN: {r.grn_number}</span>}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Pagination controls */}
        {!isLoading && !isError && filtered.length > PAGE_SIZE && (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filtered.length)} of{" "}
              {filtered.length}
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="size-4" />
                Prev
              </Button>
              <span className="text-xs font-medium">
                Page {safePage} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={safePage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {showCreate && (
        <CreatePRDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      )}

      {detailReq && (
        <RequisitionDetail
          req={detailReq}
          onClose={() => setDetailReq(null)}
          onChanged={() => {
            setDetailReq(null);
            refresh();
          }}
        />
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Create PR Dialog
// ---------------------------------------------------------------------------
function CreatePRDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [block, setBlock] = useState("");
  const [vendorId, setVendorId] = useState<string>("none");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  // Line items state — optional, for multi-item PRs
  const [showItems, setShowItems] = useState(false);
  const [items, setItems] = useState<
    { description: string; quantity: string; unit: string; unitPrice: string }[]
  >([]);
  const [itemDesc, setItemDesc] = useState("");
  const [itemQty, setItemQty] = useState("");
  const [itemUnit, setItemUnit] = useState("");
  const [itemPrice, setItemPrice] = useState("");

  const { data: vendorData } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => fetchVendors({ data: {} }),
  });
  const vendors = vendorData?.data ?? [];

  // Compute total from line items if present, otherwise use manual amount
  const itemsTotal = items.reduce((sum, it) => {
    const qty = Number(it.quantity) || 0;
    const price = Number(it.unitPrice) || 0;
    return sum + qty * price;
  }, 0);
  const effectiveAmount = showItems && items.length > 0 ? itemsTotal : amount ? Number(amount) : 0;

  // Validates and submits a new purchase requisition via the API.
  const handleSubmit = async () => {
    if (!title.trim() || !block.trim()) {
      toast.error("Fill in title and block");
      return;
    }
    if (effectiveAmount <= 0) {
      toast.error("Enter an amount or add line items");
      return;
    }
    setSaving(true);
    const result = await createRequisition({
      data: {
        title: title.trim(),
        block: block.trim(),
        vendor_id: vendorId === "none" ? null : vendorId,
        amount: effectiveAmount,
        quotations: [],
        documents: [],
      },
    });
    if (!result.success) {
      setSaving(false);
      toast.error(result.error ?? "Failed to create PR");
      return;
    }

    // Save line items if any
    if (showItems && items.length > 0 && result.id) {
      const itemPayload = items.map((it) => ({
        description: it.description.trim(),
        quantity: Number(it.quantity) || 0,
        unit: it.unit.trim() || null,
        unit_price: Number(it.unitPrice) || 0,
        amount: (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0),
      }));
      await saveRequisitionItems({ data: { requisitionId: result.id, items: itemPayload } });
    }

    setSaving(false);
    toast.success(`PR ${result.pr_number} created`);
    onCreated();
  };

  const addItem = () => {
    if (!itemDesc.trim() || !itemQty || !itemPrice) {
      toast.error("Enter description, quantity and unit price");
      return;
    }
    setItems([
      ...items,
      {
        description: itemDesc.trim(),
        quantity: itemQty,
        unit: itemUnit.trim(),
        unitPrice: itemPrice,
      },
    ]);
    setItemDesc("");
    setItemQty("");
    setItemUnit("");
    setItemPrice("");
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New purchase requisition</DialogTitle>
          <DialogDescription>
            Raise a PR for materials or services needed on site.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="pr-title">Item / Work description</Label>
            <Input
              id="pr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. TMT Steel Fe550D — 24 T"
            />
          </div>
          <div>
            <Label htmlFor="pr-block">Block / Location</Label>
            <Input
              id="pr-block"
              value={block}
              onChange={(e) => setBlock(e.target.value)}
              placeholder="e.g. OT Block · Level 3"
            />
          </div>
          <div>
            <Label>Preferred vendor (optional)</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger>
                <SelectValue placeholder="Select vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— None —</SelectItem>
                {vendors.map((v: any) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Line items toggle */}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowItems(!showItems)}>
              {showItems ? "− Remove line items" : "+ Add line items"}
            </Button>
            {showItems && items.length > 0 && (
              <span className="text-xs text-muted-foreground">Total: {inr(itemsTotal)}</span>
            )}
          </div>

          {/* Line items editor */}
          {showItems && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              {items.length > 0 && (
                <div className="space-y-1">
                  {items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span>
                        {it.description} · {it.quantity} {it.unit}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono">
                          {inr(Number(it.quantity) * Number(it.unitPrice))}
                        </span>
                        <button
                          onClick={() => removeItem(i)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Input
                  className="col-span-2"
                  placeholder="Description"
                  value={itemDesc}
                  onChange={(e) => setItemDesc(e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Qty"
                  value={itemQty}
                  onChange={(e) => setItemQty(e.target.value)}
                />
                <Input
                  placeholder="Unit (kg, m, nos)"
                  value={itemUnit}
                  onChange={(e) => setItemUnit(e.target.value)}
                />
                <Input
                  className="col-span-2"
                  type="number"
                  placeholder="Unit price (₹)"
                  value={itemPrice}
                  onChange={(e) => setItemPrice(e.target.value)}
                />
              </div>
              <Button size="sm" variant="outline" onClick={addItem}>
                <Plus className="size-4" />
                Add item
              </Button>
            </div>
          )}

          {/* Manual amount — hidden when line items are present */}
          {(!showItems || items.length === 0) && (
            <div>
              <Label htmlFor="pr-amount">Estimated amount (₹)</Label>
              <Input
                id="pr-amount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 184000"
              />
            </div>
          )}
          {effectiveAmount > 0 && (
            <p className="text-xs text-muted-foreground">
              Total: <span className="font-bold">{inr(effectiveAmount)}</span> · Approval authority:{" "}
              <span className="font-semibold">{approverFor(effectiveAmount)}</span>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            Create PR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Requisition Detail — full workflow with stage transitions
// ---------------------------------------------------------------------------
function RequisitionDetail({
  req,
  onClose,
  onChanged,
}: {
  req: RequisitionRow;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const [working, setWorking] = useState(false);

  // Inventory form state for Material Received stage
  const [invItemId, setInvItemId] = useState<string>("none");
  const [qtyReceived, setQtyReceived] = useState("");
  const [deliveryDate, setDeliveryDate] = useState<string>(new Date().toISOString().slice(0, 10));

  // Invoice form state for Invoice stage
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [invoiceAmount, setInvoiceAmount] = useState("");

  // Payment form state for Payment stage
  const [paymentMethod, setPaymentMethod] = useState<string>("Cheque");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentProofPath, setPaymentProofPath] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);

  // Reject dialog state
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Cancel dialog state
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Confirm forward transition dialog state
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});
  const [confirmLabel, setConfirmLabel] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");

  // Edit details state (PR and Quotation stages only)
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(req.title);
  const [editBlock, setEditBlock] = useState(req.block ?? "");
  const [editAmount, setEditAmount] = useState(String(req.amount));
  const [editVendorId, setEditVendorId] = useState<string>(req.vendor_id ?? "none");
  const [savingEdit, setSavingEdit] = useState(false);

  const { data: vendorData } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => fetchVendors({ data: {} }),
  });
  const vendors = vendorData?.data ?? [];

  // Ref to the quotation editor's save function (for auto-save before submit)
  const saveQuotationsRef = useRef<(() => Promise<boolean>) | null>(null);

  const { data: itemData } = useQuery({
    queryKey: ["inventory-items"],
    queryFn: () => fetchItems({ data: {} }),
  });
  const inventoryItems = itemData?.data ?? [];

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["requisitions"] });

  // Advances the requisition to the next workflow stage via the API.
  // Auto-saves unsaved quotations before submitting for approval.
  const advanceStage = async (newStage: string, extra?: Record<string, any>) => {
    // Auto-save quotations if we're submitting for approval
    if (fromStage === "Quotation" && saveQuotationsRef.current) {
      const saved = await saveQuotationsRef.current();
      if (!saved) {
        toast.error("Please save quotations before submitting");
        setWorking(false);
        return;
      }
    }
    setWorking(true);
    const result = await updateRequisitionStage({
      data: {
        id: req.id,
        newStage,
        expectedStage: req.stage,
        ...extra,
      },
    });
    setWorking(false);
    if (result.success) {
      const label = result.po_number
        ? `${req.pr_number} → ${newStage} (${result.po_number})`
        : result.grn_number
          ? `${req.pr_number} → ${newStage} (${result.grn_number})`
          : `${req.pr_number} → ${newStage}`;
      toast.success(label);
      refresh();
      onChanged();
    } else {
      toast.error(result.error ?? "Failed to update stage");
    }
  };

  // Opens a confirmation dialog before executing a forward stage transition.
  const confirmAdvance = (label: string, message: string, action: () => void) => {
    setConfirmLabel(label);
    setConfirmMessage(message);
    setConfirmAction(() => action);
    setShowConfirm(true);
  };

  // Sends the requisition back to the quotation stage, rejecting current approval.
  const rejectRequisition = async () => {
    setWorking(true);
    const result = await updateRequisitionStage({
      data: {
        id: req.id,
        newStage: "Quotation",
        expectedStage: req.stage,
        rejectionReason: rejectReason.trim() || undefined,
      },
    });
    setWorking(false);
    if (result.success) {
      toast.error(`${req.pr_number} sent back to site`);
      setShowReject(false);
      refresh();
      onChanged();
    } else {
      toast.error(result.error ?? "Failed to reject");
    }
  };

  // Cancels the requisition — available from any pre-completion stage.
  const cancelRequisition = async () => {
    setWorking(true);
    const result = await updateRequisitionStage({
      data: {
        id: req.id,
        newStage: "Cancelled",
        expectedStage: req.stage,
        cancelReason: cancelReason.trim() || undefined,
      },
    });
    setWorking(false);
    if (result.success) {
      toast.info(`${req.pr_number} cancelled`);
      setShowCancel(false);
      refresh();
      onChanged();
    } else {
      toast.error(result.error ?? "Failed to cancel");
    }
  };

  // Saves edited PR details (title, block, amount, vendor) via the API.
  const saveEdit = async () => {
    if (!editTitle.trim() || !editBlock.trim() || !editAmount || Number(editAmount) <= 0) {
      toast.error("Title, block and amount are required");
      return;
    }
    setSavingEdit(true);
    const result = await updateRequisitionDetails({
      data: {
        id: req.id,
        title: editTitle.trim(),
        block: editBlock.trim(),
        amount: Number(editAmount),
        vendor_id: editVendorId === "none" ? null : editVendorId,
      },
    });
    setSavingEdit(false);
    if (result.success) {
      toast.success("Details updated");
      setEditing(false);
      refresh();
      onChanged();
    } else {
      toast.error(result.error ?? "Failed to update");
    }
  };

  const currentStageIdx = PROCUREMENT_STAGES.indexOf(req.stage);
  const approver = approverFor(req.amount);
  const approverStage = stageForRole(approver);
  const canUserApprove = canApprove(role, req.amount);
  const fromStage = req.stage;

  const isSupervisor = role === "Supervisor";
  const isApprover = role !== "Supervisor";

  return (
    <Dialog open={!!req} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {req.pr_number} · {req.title}
          </DialogTitle>
          <DialogDescription>
            {req.block} · raised by {req.raised_by_name ?? "Unknown"} on{" "}
            {new Date(req.date).toLocaleDateString("en-IN")}
            {req.po_number && ` · PO: ${req.po_number}`}
          </DialogDescription>
          <div className="mt-1">
            <DocumentVersionHistory entityType="requisition" entityId={req.id} />
          </div>
        </DialogHeader>

        {/* Workflow stepper */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Workflow
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PROCUREMENT_STAGES.filter((s) => s !== "Cancelled").map((s) => {
              const done = PROCUREMENT_STAGES.indexOf(s) <= currentStageIdx;
              const isCurrent = s === req.stage;
              return (
                <span
                  key={s}
                  className={`rounded-md px-2 py-1 text-xs font-medium ${
                    isCurrent
                      ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1"
                      : done
                        ? "bg-primary/80 text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s}
                </span>
              );
            })}
            {req.stage === "Cancelled" && (
              <span className="rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground ring-2 ring-destructive ring-offset-1">
                Cancelled
              </span>
            )}
          </div>
        </div>

        {/* Edit details — only for PR and Quotation stages, supervisor only */}
        {(req.stage === "PR" || req.stage === "Quotation") && isSupervisor && !editing && (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          </div>
        )}

        {/* Edit form */}
        {editing && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Edit details
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label htmlFor="edit-title">Item / Work description</Label>
                <Input
                  id="edit-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-block">Block / Location</Label>
                <Input
                  id="edit-block"
                  value={editBlock}
                  onChange={(e) => setEditBlock(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="edit-amount">Estimated amount (₹)</Label>
                <Input
                  id="edit-amount"
                  type="number"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Label>Vendor</Label>
                <Select value={editVendorId} onValueChange={setEditVendorId}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— None —</SelectItem>
                    {vendors.map((v: any) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveEdit} disabled={savingEdit}>
                {savingEdit && <Loader2 className="size-4 animate-spin" />}
                Save changes
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Key info — hidden when editing */}
        {!editing && (
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-border p-4">
            <div>
              <p className="text-xs text-muted-foreground">Value</p>
              <p className="text-lg font-bold font-mono">{inr(req.amount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Approval authority</p>
              <p className="text-lg font-bold">{approver}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Vendor</p>
              <p className="text-sm font-medium">{req.vendor_name ?? "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">PO number</p>
              <p className="text-sm font-medium font-mono">{req.po_number ?? "—"}</p>
            </div>
            {req.grn_number && (
              <div>
                <p className="text-xs text-muted-foreground">GRN number</p>
                <p className="text-sm font-medium font-mono">{req.grn_number}</p>
              </div>
            )}
            {req.delivery_date && (
              <div>
                <p className="text-xs text-muted-foreground">Delivery date</p>
                <p className="text-sm font-medium">
                  {new Date(req.delivery_date).toLocaleDateString("en-IN")}
                </p>
              </div>
            )}
            {req.invoice_number && (
              <div>
                <p className="text-xs text-muted-foreground">Invoice number</p>
                <p className="text-sm font-medium font-mono">{req.invoice_number}</p>
              </div>
            )}
            {req.invoice_amount != null && (
              <div>
                <p className="text-xs text-muted-foreground">Invoice amount</p>
                <p className="text-sm font-bold font-mono">{inr(req.invoice_amount)}</p>
              </div>
            )}
            {req.approved_at && (
              <div>
                <p className="text-xs text-muted-foreground">Approved on</p>
                <p className="text-sm font-medium">
                  {new Date(req.approved_at).toLocaleDateString("en-IN")}
                </p>
              </div>
            )}
            {req.rejection_reason && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">Rejection reason</p>
                <p className="text-sm font-medium text-destructive">{req.rejection_reason}</p>
              </div>
            )}
          </div>
        )}

        {/* Quotations section — editable when in PR or Quotation stage */}
        {(req.stage === "PR" || req.stage === "Quotation") && (
          <QuotationEditor
            req={req}
            onChanged={refresh}
            onSaveReady={(saveFn) => {
              saveQuotationsRef.current = saveFn;
            }}
          />
        )}

        {/* Line items — shows saved line items if any */}
        <LineItemsSection requisitionId={req.id} />

        {/* Approval timeline — shows audit history for this requisition */}
        <ApprovalTimeline requisitionId={req.id} />

        {/* Quotations — read-only for approvers and post-approval stages */}
        {req.stage !== "PR" && req.stage !== "Quotation" && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Quotations
            </p>
            <div className="mt-2 space-y-2">
              {req.quotations.length === 0 && (
                <p className="text-sm text-muted-foreground">No quotations recorded.</p>
              )}
              {req.quotations.map((q: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2">
                    {q.selected && <Check className="size-4 text-success" />}
                    {q.vendor}
                  </span>
                  <span className="font-mono font-semibold">{inr(q.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Documents */}
        <DocumentSection req={req} onChanged={refresh} />

        {/* Stage action buttons */}
        <Separator />
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Actions
          </p>

          {/* PR → Quotation (supervisor) */}
          {req.stage === "PR" && isSupervisor && (
            <Button onClick={() => advanceStage("Quotation")} disabled={working}>
              {working ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              Move to Quotation stage
            </Button>
          )}

          {/* Quotation → submit for approval (supervisor) */}
          {req.stage === "Quotation" && isSupervisor && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => advanceStage(approverStage)} disabled={working}>
                {working ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                Submit for {approver} approval
              </Button>
            </div>
          )}

          {/* Admin/A1/A1+ → PO (approve) */}
          {(req.stage === "Admin" || req.stage === "A1" || req.stage === "A1+") && isApprover && (
            <div className="flex flex-wrap gap-2">
              {canUserApprove ? (
                <>
                  <Button onClick={() => advanceStage("PO")} disabled={working}>
                    {working ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    Approve → Issue PO
                  </Button>
                  <Button variant="outline" onClick={() => setShowReject(true)} disabled={working}>
                    <X className="size-4" />
                    Reject → Send back
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This requisition requires {approver} approval. Your role ({role}) cannot approve
                  this amount.
                </p>
              )}
            </div>
          )}

          {/* Admin/A1/A1+ — locked for non-approvers */}
          {(req.stage === "Admin" || req.stage === "A1" || req.stage === "A1+") && isSupervisor && (
            <p className="text-sm text-muted-foreground">
              Awaiting {approver} approval. You will be notified when it is approved.
            </p>
          )}

          {/* PO → Material Received (with GRN, delivery date, optional inventory linkage) */}
          {req.stage === "PO" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground">
                  Record material receipt
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="delivery-date">
                      Delivery date <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="delivery-date"
                      type="date"
                      value={deliveryDate}
                      onChange={(e) => setDeliveryDate(e.target.value)}
                      aria-required="true"
                    />
                  </div>
                  <div>
                    <Label htmlFor="qty-received">Quantity received (optional)</Label>
                    <Input
                      id="qty-received"
                      type="number"
                      placeholder="e.g. 24000"
                      value={qtyReceived}
                      onChange={(e) => setQtyReceived(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label>Link to inventory item (optional)</Label>
                  <Select value={invItemId} onValueChange={setInvItemId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select inventory item to update stock" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Skip inventory —</SelectItem>
                      {inventoryItems.map((item: any) => (
                        <SelectItem key={item.item_id} value={item.item_id}>
                          {item.item_name} {item.unit_of_measure ? `(${item.unit_of_measure})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  A GRN (Goods Receipt Note) number will be auto-generated on confirmation.
                </p>
              </div>
              <Button
                onClick={() => {
                  if (!deliveryDate) {
                    toast.error("Delivery date is required");
                    return;
                  }
                  if (qtyReceived && Number(qtyReceived) <= 0) {
                    toast.error("Quantity received must be a positive number");
                    return;
                  }
                  confirmAdvance(
                    "Mark materials received",
                    `Confirm material receipt for ${req.pr_number}? A GRN number will be auto-generated.`,
                    () =>
                      advanceStage("Material Received", {
                        inventoryItemId: invItemId !== "none" ? invItemId : null,
                        quantityReceived: qtyReceived ? Number(qtyReceived) : undefined,
                        deliveryDate: deliveryDate
                          ? new Date(deliveryDate).toISOString()
                          : undefined,
                      }),
                  );
                }}
                disabled={working}
              >
                {working ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Package className="size-4" />
                )}
                Mark materials received
              </Button>
            </div>
          )}

          {/* Material Received → Invoice (with invoice details) */}
          {req.stage === "Material Received" && (
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground">Invoice details</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="inv-number">
                      Invoice number <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="inv-number"
                      placeholder="e.g. INV-9921"
                      value={invoiceNumber}
                      onChange={(e) => setInvoiceNumber(e.target.value)}
                      aria-required="true"
                    />
                  </div>
                  <div>
                    <Label htmlFor="inv-date">Invoice date</Label>
                    <Input
                      id="inv-date"
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="inv-amount">Invoice amount (₹)</Label>
                    <Input
                      id="inv-amount"
                      type="number"
                      placeholder={`e.g. ${req.amount}`}
                      value={invoiceAmount}
                      onChange={(e) => setInvoiceAmount(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      PR estimated amount: {inr(req.amount)}. Enter the actual invoiced amount if
                      different.
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Upload the invoice PDF/image in the documents section above before advancing.
                </p>
              </div>
              <Button
                onClick={() => {
                  if (!invoiceNumber.trim()) {
                    toast.error("Invoice number is required");
                    return;
                  }
                  if (!invoiceDate) {
                    toast.error("Invoice date is required");
                    return;
                  }
                  if (invoiceAmount && Number(invoiceAmount) <= 0) {
                    toast.error("Invoice amount must be a positive number");
                    return;
                  }
                  confirmAdvance(
                    "Record invoice",
                    `Confirm invoice ${invoiceNumber.trim()} for ${req.pr_number}?`,
                    () =>
                      advanceStage("Invoice", {
                        invoiceNumber: invoiceNumber.trim() || undefined,
                        invoiceDate: invoiceDate ? new Date(invoiceDate).toISOString() : undefined,
                        invoiceAmount: invoiceAmount ? Number(invoiceAmount) : undefined,
                      }),
                  );
                }}
                disabled={working}
              >
                {working ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Receipt className="size-4" />
                )}
                Record invoice → advance
              </Button>
            </div>
          )}

          {/* Invoice → Payment (with payment method, reference, proof upload) */}
          {req.stage === "Invoice" && (
            <div className="space-y-3">
              {req.vendor_id ? (
                <div className="rounded-lg border border-border p-4 space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">Payment details</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label>Payment method</Label>
                      <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["Cash", "Cheque", "UPI", "NEFT", "RTGS", "IMPS"].map((m) => (
                            <SelectItem key={m} value={m}>
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="pay-ref">
                        Reference number <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="pay-ref"
                        placeholder="Cheque no / UPI ref / Txn ID"
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        aria-required="true"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Payment proof (optional)</Label>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={uploadingProof}
                        onClick={() => document.getElementById("pay-proof-input")?.click()}
                      >
                        {uploadingProof ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Upload className="size-4" />
                        )}
                        {paymentProofPath ? "Replace proof" : "Upload proof"}
                      </Button>
                      {paymentProofPath && (
                        <span className="text-xs text-success">
                          ✓ {paymentProofPath.split("/").pop()}
                        </span>
                      )}
                      <input
                        id="pay-proof-input"
                        type="file"
                        className="hidden"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.tiff,.tif,.bmp,.heic,.heif,.xls,.xlsx,.doc,.docx,.csv,.txt,.zip"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          setUploadingProof(true);
                          const path = `requisitions/${req.id}/payment-proof-${Date.now()}-${file.name}`;
                          const reader = new FileReader();
                          reader.onload = async () => {
                            const base64 = (reader.result as string).split(",")[1] ?? "";
                            const result = await uploadFile({
                              data: {
                                bucket: "documents",
                                path,
                                contentType: file.type || "application/octet-stream",
                                fileData: base64,
                              },
                            });
                            setUploadingProof(false);
                            if (result.success) {
                              setPaymentProofPath(path);
                              toast.success("Payment proof uploaded");
                            } else {
                              toast.error(result.error ?? "Upload failed");
                            }
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A vendor payment record will be created for {req.vendor_name ?? "the vendor"}{" "}
                    and outstanding balance updated automatically.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No vendor linked — payment record will be skipped. Link a vendor to track
                  payments.
                </p>
              )}
              <Button
                onClick={() => {
                  if (req.vendor_id && !paymentReference.trim()) {
                    toast.error("Payment reference number is required");
                    return;
                  }
                  confirmAdvance(
                    "Record payment",
                    `Confirm payment of ${inr(req.amount)} via ${paymentMethod} for ${req.pr_number}? A vendor payment record will be created.`,
                    () =>
                      advanceStage("Payment", {
                        paymentMethod: req.vendor_id ? paymentMethod : undefined,
                        paymentReference: paymentReference.trim() || undefined,
                        paymentProofPath: paymentProofPath ?? undefined,
                      }),
                  );
                }}
                disabled={working || uploadingProof}
              >
                {working ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <IndianRupee className="size-4" />
                )}
                Record payment
              </Button>
            </div>
          )}

          {/* Payment → Completed (with partial payment support) */}
          {req.stage === "Payment" && (
            <PaymentsSection
              req={req}
              onPaymentRecorded={() => {
                refresh();
              }}
              onCloseRequisition={() =>
                confirmAdvance(
                  "Close requisition",
                  `Close ${req.pr_number}? This will mark the requisition as completed. This action cannot be undone.`,
                  () => advanceStage("Completed"),
                )
              }
              working={working}
            />
          )}

          {/* Completed */}
          {req.stage === "Completed" && (
            <div className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 className="size-4" />
              Requisition completed
            </div>
          )}

          {/* Cancelled */}
          {req.stage === "Cancelled" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <XCircle className="size-4" />
                Requisition cancelled
              </div>
              {req.cancel_reason && (
                <p className="text-sm text-muted-foreground">Reason: {req.cancel_reason}</p>
              )}
            </div>
          )}

          {/* Cancel button — available from any pre-completion, pre-cancel stage */}
          {req.stage !== "Completed" && req.stage !== "Cancelled" && (
            <div className="flex justify-end border-t border-border pt-3">
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setShowCancel(true)}
              >
                <XCircle className="size-4" />
                Cancel requisition
              </Button>
            </div>
          )}
        </div>

        {/* Reject dialog — captures rejection reason */}
        {showReject && (
          <Dialog open={showReject} onOpenChange={(v) => !v && setShowReject(false)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Reject {req.pr_number}?</DialogTitle>
                <DialogDescription>
                  The requisition will be sent back to the supervisor for rework. Provide a reason
                  (optional).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="reject-reason">Rejection reason</Label>
                  <Input
                    id="reject-reason"
                    placeholder="e.g. Quotation too high — negotiate lower rate"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowReject(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={rejectRequisition} disabled={working}>
                  {working ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
                  Reject & send back
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Cancel dialog — captures cancel reason */}
        {showCancel && (
          <Dialog open={showCancel} onOpenChange={(v) => !v && setShowCancel(false)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Cancel {req.pr_number}?</DialogTitle>
                <DialogDescription>
                  The requisition will be permanently cancelled. This cannot be undone. Provide a
                  reason (optional).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="cancel-reason">Cancel reason</Label>
                  <Input
                    id="cancel-reason"
                    placeholder="e.g. No longer required / duplicate PR"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowCancel(false)}>
                  Keep requisition
                </Button>
                <Button variant="destructive" onClick={cancelRequisition} disabled={working}>
                  {working ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <XCircle className="size-4" />
                  )}
                  Cancel requisition
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Confirm forward transition dialog */}
        {showConfirm && (
          <Dialog open={showConfirm} onOpenChange={(v) => !v && setShowConfirm(false)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{confirmLabel}</DialogTitle>
                <DialogDescription>{confirmMessage}</DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setShowConfirm(false);
                    confirmAction();
                  }}
                  disabled={working}
                >
                  {working ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  Confirm
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Quotation Editor — add/remove/select quotations (PR and Quotation stages)
// Auto-saves before submit for approval via onSaveReady callback.
// ---------------------------------------------------------------------------
function QuotationEditor({
  req,
  onChanged,
  onSaveReady,
}: {
  req: RequisitionRow;
  onChanged: () => void;
  onSaveReady: (saveFn: () => Promise<boolean>) => void;
}) {
  const [quotations, setQuotations] = useState<any[]>(req.quotations);
  const [newVendorId, setNewVendorId] = useState<string>("none");
  const [newVendorName, setNewVendorName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const { data: vendorData } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => fetchVendors({ data: {} }),
  });
  const vendors = vendorData?.data ?? [];

  // Track if local quotations differ from saved ones
  useEffect(() => {
    const saved = JSON.stringify(req.quotations ?? []);
    const current = JSON.stringify(quotations);
    setDirty(saved !== current);
  }, [quotations, req.quotations]);

  // Persists the current quotation list to the requisition via the API.
  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaving(true);
    const result = await updateRequisitionDetails({
      data: { id: req.id, quotations },
    });
    setSaving(false);
    if (result.success) {
      toast.success("Quotations saved");
      onChanged();
      return true;
    } else {
      toast.error(result.error ?? "Failed to save");
      return false;
    }
  }, [dirty, quotations, req.id, onChanged]);

  // Register the save function with the parent so it can auto-save before submit
  useEffect(() => {
    onSaveReady(save);
  }, [save, onSaveReady]);

  // Adds a new vendor quotation entry to the local list after validation.
  const addQuotation = () => {
    const vendorName =
      newVendorId !== "none"
        ? (vendors.find((v: any) => v.id === newVendorId)?.name ?? newVendorName.trim())
        : newVendorName.trim();
    if (!vendorName || !newAmount || Number(newAmount) <= 0) {
      toast.error("Select a vendor and enter amount");
      return;
    }
    setQuotations([
      ...quotations,
      {
        vendor: vendorName,
        vendor_id: newVendorId !== "none" ? newVendorId : null,
        amount: Number(newAmount),
        selected: false,
      },
    ]);
    setNewVendorId("none");
    setNewVendorName("");
    setNewAmount("");
  };

  // Removes a quotation entry from the local list by index.
  const removeQuotation = (idx: number) => {
    setQuotations(quotations.filter((_, i) => i !== idx));
  };

  // Marks a single quotation as selected, deselecting all others.
  const selectQuotation = (idx: number) => {
    setQuotations(quotations.map((q, i) => ({ ...q, selected: i === idx })));
  };

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Quotations {quotations.length > 0 && `(${quotations.length})`}
        {dirty && <span className="ml-2 text-warning">● unsaved</span>}
      </p>
      <div className="mt-2 space-y-2">
        {quotations.map((q, i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <button
                onClick={() => selectQuotation(i)}
                className={`flex size-5 items-center justify-center rounded-full border-2 transition-colors ${
                  q.selected
                    ? "border-success bg-success text-success-foreground"
                    : "border-muted-foreground/30"
                }`}
                title={q.selected ? "Selected" : "Click to select"}
              >
                {q.selected && <Check className="size-3" />}
              </button>
              <span className="font-medium">{q.vendor}</span>
              {q.vendor_id && (
                <Badge variant="outline" className="text-[10px]">
                  linked
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono font-semibold">{inr(q.amount)}</span>
              <button
                onClick={() => removeQuotation(i)}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add new quotation */}
      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <Select
            value={newVendorId}
            onValueChange={(v) => {
              setNewVendorId(v);
              if (v !== "none") setNewVendorName("");
            }}
          >
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select vendor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Other (type name) —</SelectItem>
              {vendors.map((v: any) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="w-32"
            type="number"
            placeholder="Amount ₹"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={addQuotation}>
            <Plus className="size-4" />
            Add
          </Button>
        </div>
        {newVendorId === "none" && (
          <Input
            className="max-w-[300px]"
            placeholder="Vendor name (if not in list)"
            value={newVendorName}
            onChange={(e) => setNewVendorName(e.target.value)}
          />
        )}
      </div>

      {/* Save button */}
      {quotations.length > 0 && (
        <div className="mt-3">
          <Button size="sm" onClick={() => save()} disabled={saving || !dirty}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {dirty ? "Save quotations" : "Saved"}
          </Button>
          {!quotations.some((q) => q.selected) && (
            <p className="mt-2 text-xs text-warning">
              Select a quotation (click the circle) before submitting for approval.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line Items Section — displays saved line items for a requisition
// ---------------------------------------------------------------------------
function LineItemsSection({ requisitionId }: { requisitionId: string }) {
  const { data: items } = useQuery({
    queryKey: ["requisition-items", requisitionId],
    queryFn: () => fetchRequisitionItems({ data: { requisitionId } }),
    staleTime: 30000,
  });

  const lineItems = items ?? [];
  if (lineItems.length === 0) return null;

  const total = lineItems.reduce((sum: number, it: any) => sum + it.amount, 0);

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Line items ({lineItems.length})
      </p>
      <div className="mt-2 space-y-1.5">
        {lineItems.map((it: any) => (
          <div
            key={it.id}
            className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
          >
            <div>
              <span className="font-medium">{it.description}</span>
              <span className="ml-2 text-xs text-muted-foreground">
                {it.quantity} {it.unit ?? ""} × {inr(it.unit_price ?? 0)}
              </span>
            </div>
            <span className="font-mono font-semibold">{inr(it.amount)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between border-t border-border pt-1.5 text-sm">
          <span className="font-medium">Total</span>
          <span className="font-mono font-bold">{inr(total)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payments Section — shows existing payments, allows recording additional partial payments
// ---------------------------------------------------------------------------
function PaymentsSection({
  req,
  onPaymentRecorded,
  onCloseRequisition,
  working,
}: {
  req: RequisitionRow;
  onPaymentRecorded: () => void;
  onCloseRequisition: () => void;
  working: boolean;
}) {
  const { data: payments } = useQuery({
    queryKey: ["requisition-payments", req.id],
    queryFn: () => fetchRequisitionPayments({ data: { requisitionId: req.id } }),
    staleTime: 10000,
  });

  const paymentList = payments ?? [];
  const totalPaid = paymentList.reduce((sum: number, p: any) => sum + p.amount, 0);
  const balance = req.amount - totalPaid;
  const fullyPaid = balance <= 0;

  const [showAddPayment, setShowAddPayment] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("Cheque");
  const [payRef, setPayRef] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAddPayment = async () => {
    if (!payAmount || Number(payAmount) <= 0) {
      toast.error("Enter a valid payment amount");
      return;
    }
    if (Number(payAmount) > balance) {
      toast.error(`Payment exceeds remaining balance (${inr(balance)})`);
      return;
    }
    setSaving(true);
    const result = await addRequisitionPayment({
      data: {
        requisitionId: req.id,
        vendorId: req.vendor_id!,
        amount: Number(payAmount),
        paymentMethod: payMethod as any,
        referenceNumber: payRef.trim() || undefined,
      },
    });
    setSaving(false);
    if (result.success) {
      toast.success(`Payment of ${inr(Number(payAmount))} recorded`);
      setPayAmount("");
      setPayRef("");
      setShowAddPayment(false);
      onPaymentRecorded();
    } else {
      toast.error(result.error ?? "Failed to record payment");
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground">Payment summary</p>
          {req.vendor_id && !fullyPaid && (
            <Button size="sm" variant="outline" onClick={() => setShowAddPayment(!showAddPayment)}>
              <Plus className="size-4" />
              Record partial payment
            </Button>
          )}
        </div>

        {/* Payment breakdown */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Total amount</p>
            <p className="text-sm font-bold font-mono">{inr(req.amount)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Paid</p>
            <p className="text-sm font-bold font-mono text-success">{inr(totalPaid)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Balance</p>
            <p
              className={`text-sm font-bold font-mono ${fullyPaid ? "text-success" : "text-warning"}`}
            >
              {inr(Math.max(0, balance))}
            </p>
          </div>
        </div>

        {/* Existing payments list */}
        {paymentList.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              Payments made ({paymentList.length})
            </p>
            {paymentList.map((p: any) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-mono font-semibold">{inr(p.amount)}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{p.payment_type}</span>
                  {p.reference_number && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      · {p.reference_number}
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {new Date(p.payment_date).toLocaleDateString("en-IN")}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Add payment form */}
        {showAddPayment && (
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label htmlFor="partial-amount">Amount (₹)</Label>
                <Input
                  id="partial-amount"
                  type="number"
                  placeholder={`max ${inr(balance)}`}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </div>
              <div>
                <Label>Method</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Cash", "Cheque", "UPI", "NEFT", "RTGS", "IMPS"].map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="partial-ref">Reference number</Label>
              <Input
                id="partial-ref"
                placeholder="Cheque no / UPI ref / Txn ID"
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddPayment} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Record payment
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAddPayment(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {!req.vendor_id && (
          <p className="text-xs text-muted-foreground">
            No vendor linked — payment records cannot be created.
          </p>
        )}
      </div>

      <Button onClick={onCloseRequisition} disabled={working}>
        {working ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CheckCircle2 className="size-4" />
        )}
        {fullyPaid ? "Close requisition" : "Close requisition (not fully paid)"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Approval Timeline — shows audit history for a requisition as a vertical timeline
// ---------------------------------------------------------------------------
function ApprovalTimeline({ requisitionId }: { requisitionId: string }) {
  const { data: history, isLoading } = useQuery({
    queryKey: ["requisition-history", requisitionId],
    queryFn: () => fetchRequisitionHistory({ data: { requisitionId } }),
    staleTime: 30000,
  });

  const entries = history ?? [];

  if (isLoading) {
    return (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Timeline
        </p>
        <div className="mt-2 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (entries.length === 0) return null;

  // Map action codes to human-readable labels
  const actionLabel = (action: string, details: any) => {
    switch (action) {
      case "create_requisition":
        return "PR created";
      case "update_requisition":
        return "Details updated";
      case "update_stage":
        if (details.to === "Cancelled") return "Cancelled";
        if (details.to === "Quotation" && details.from !== "PR") return "Rejected → sent back";
        if (details.to === "PO")
          return `Approved → PO${details.po_number ? ` ${details.po_number}` : ""}`;
        if (details.to === "Material Received")
          return `Material received${details.grn_number ? ` (${details.grn_number})` : ""}`;
        if (details.to === "Invoice") return "Invoice recorded";
        if (details.to === "Payment") return "Payment recorded";
        if (details.to === "Completed") return "Completed";
        if (details.to === "Quotation") return "Moved to Quotation";
        return `${details.from} → ${details.to}`;
      case "add_payment":
        return `Payment of ₹${Number(details.amount).toLocaleString("en-IN")} recorded`;
      default:
        return action.replace(/_/g, " ");
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Timeline ({entries.length})
      </p>
      <div className="mt-2 space-y-0">
        {entries.map((entry: any, i: number) => (
          <div key={entry.id} className="flex gap-3">
            {/* Vertical line + dot */}
            <div className="flex flex-col items-center">
              <div
                className={`size-2.5 rounded-full ${i === entries.length - 1 ? "bg-primary" : "bg-muted-foreground/40"}`}
              />
              {i < entries.length - 1 && <div className="w-px flex-1 bg-border" />}
            </div>
            {/* Content */}
            <div className="pb-3">
              <p className="text-sm font-medium">{actionLabel(entry.action, entry.details)}</p>
              <p className="text-xs text-muted-foreground">
                {entry.user_name} ·{" "}
                {new Date(entry.created_at).toLocaleString("en-IN", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document Section — upload, list, and download documents via signed URLs
// ---------------------------------------------------------------------------
function DocumentSection({ req, onChanged }: { req: RequisitionRow; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState<string[]>(req.documents);
  const [viewing, setViewing] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);

  // Uploads a selected file to storage and links it to the requisition document list.
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const path = `requisitions/${req.id}/${Date.now()}-${file.name}`;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(",")[1] ?? "";
      const result = await uploadFile({
        data: {
          bucket: "documents",
          path,
          contentType: file.type || "application/octet-stream",
          fileData: base64,
        },
      });
      setUploading(false);
      if (result.success) {
        // Store the full storage path (not just filename) so we can generate signed URLs later
        const updated = [...documents, path];
        setDocuments(updated);
        await updateRequisitionDetails({ data: { id: req.id, documents: updated } });
        toast.success(`${file.name} uploaded`);
        onChanged();
      } else {
        toast.error(result.error ?? "Upload failed");
      }
    };
    reader.readAsDataURL(file);
  };

  // Generates a signed URL and opens the document in a new tab.
  const handleView = async (docPath: string) => {
    setLoadingUrl(true);
    setViewing(docPath);
    const result = await getSignedUrl({ data: { bucket: "documents", path: docPath } });
    setLoadingUrl(false);
    if (result.success && result.url) {
      window.open(result.url, "_blank");
    } else {
      toast.error(result.error ?? "Failed to open document");
    }
    setViewing(null);
  };

  // Extracts a display name from a storage path (last segment after the final /)
  const displayName = (path: string) => {
    const parts = path.split("/");
    return parts[parts.length - 1] ?? path;
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Linked documents ({documents.length})
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Upload
        </Button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={handleUpload}
          accept=".pdf,.jpg,.jpeg,.png,.webp,.tiff,.tif,.bmp,.heic,.heif,.xls,.xlsx,.doc,.docx,.csv,.txt,.zip"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {documents.length === 0 && (
          <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
        )}
        {documents.map((d, i) => (
          <button
            key={i}
            onClick={() => handleView(d)}
            disabled={viewing === d}
            className="inline-flex items-center gap-1.5 rounded-md bg-surface px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted"
            title="Click to view/download"
          >
            {viewing === d && loadingUrl ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileText className="size-3.5 text-muted-foreground" />
            )}
            {displayName(d)}
            <ExternalLink className="size-3 text-muted-foreground" />
          </button>
        ))}
      </div>
    </div>
  );
}
