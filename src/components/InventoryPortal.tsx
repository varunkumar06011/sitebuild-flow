import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  fetchPortalItems,
  fetchPortalLedger,
  fetchPortalOpeningBalance,
  recordPortalEntry,
  createPortalItem,
  createPortalVendor,
  fetchWarehouses,
  fetchCategoryTree,
  fetchVendorsForInventory,
} from "@/lib/api/inventory";
import { toast } from "sonner";
import {
  Plus,
  Search,
  History,
  ArrowRightLeft,
  Package,
  Warehouse,
  ChevronLeft,
} from "lucide-react";

type InventoryPortalProps = {
  canAdmin: boolean;
  title: string;
  subtitle: string;
};

export function InventoryPortal({ canAdmin, title, subtitle }: InventoryPortalProps) {
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [view, setView] = useState<"list" | "ledger">("list");
  const [ledgerItem, setLedgerItem] = useState<any | null>(null);
  const [nextEntryItem, setNextEntryItem] = useState<any | null>(null);
  const [manageMaterialOpen, setManageMaterialOpen] = useState(false);

  const { data: warehousesData } = useQuery({
    queryKey: ["inventory-warehouses"],
    queryFn: () => fetchWarehouses(),
  });
  const warehouses = warehousesData?.data ?? [];

  const { data: categoriesData } = useQuery({
    queryKey: ["inventory-categories"],
    queryFn: () => fetchCategoryTree(),
  });
  const categoryNodes = categoriesData?.data ?? [];

  const { data: itemsData, refetch: refetchItems } = useQuery({
    queryKey: ["inventory-portal-items", warehouseId, categoryId, search, fromDate, toDate],
    queryFn: () =>
      fetchPortalItems({
        warehouse_id: warehouseId || undefined,
        category_id: categoryId || undefined,
        search: search || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
      }),
  });
  const items = itemsData?.data ?? [];

  const { data: vendorsData } = useQuery({
    queryKey: ["inventory-portal-vendors"],
    queryFn: () => fetchVendorsForInventory(),
  });
  const vendors = vendorsData?.data ?? [];

  const { categoryTree, categoryPathMap, flatCategories } = useMemo(() => {
    const nodeMap = new Map<string, any>();
    const roots: any[] = [];
    for (const n of categoryNodes) {
      const node = { ...n, children: [] as any[] };
      nodeMap.set(n.id, node);
    }
    for (const n of categoryNodes) {
      const node = nodeMap.get(n.id)!;
      if (n.parent_id && nodeMap.has(n.parent_id)) {
        nodeMap.get(n.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const flat: { id: string; name: string; level: string; path: string }[] = [];
    const pathMap = new Map<string, string>();
    function walk(nodes: any[], path: string) {
      for (const n of nodes) {
        const p = path ? `${path} › ${n.name}` : n.name;
        flat.push({ id: n.id, name: n.name, level: n.level, path: p });
        pathMap.set(n.id, p);
        if (n.children?.length) walk(n.children, p);
      }
    }
    walk(roots, "");
    return { categoryTree: roots, categoryPathMap: pathMap, flatCategories: flat };
  }, [categoryNodes]);

  const selectedWarehouseName = useMemo(() => {
    return warehouses.find((w: any) => w.id === warehouseId)?.name ?? "All Ventures";
  }, [warehouses, warehouseId]);

  return (
    <AppShell title={title} subtitle={subtitle}>
      <div className="space-y-4">
        {view === "list" ? (
          <>
            {/* Filters */}
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Venture / Warehouse</Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger>
                      <SelectValue placeholder="All ventures" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All Ventures</SelectItem>
                      {warehouses.map((w: any) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Category</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger>
                      <SelectValue placeholder="All categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">All Categories</SelectItem>
                      {flatCategories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.path || c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Search Material</Label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Material name..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Date Range</Label>
                  <div className="flex items-center gap-2">
                    <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
                    <span className="text-muted-foreground">→</span>
                    <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
                  </div>
                </div>
              </div>
              {canAdmin && (
                <Button onClick={() => setManageMaterialOpen(true)} className="shrink-0">
                  <Plus className="mr-1.5 size-4" /> Manage Materials
                </Button>
              )}
            </div>

            {/* Material list — desktop table */}
            <Card className="hidden overflow-hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">S.No</th>
                      <th className="px-3 py-2">Material</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Unit</th>
                      <th className="px-3 py-2 text-right">Purchased</th>
                      <th className="px-3 py-2 text-right">Used</th>
                      <th className="px-3 py-2 text-right">Balance</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                          No materials found. {canAdmin && "Create one to get started."}
                        </td>
                      </tr>
                    )}
                    {items.map((item: any, idx: number) => (
                      <tr key={item.item_id} className="border-b hover:bg-muted/30">
                        <td className="px-3 py-2 text-muted-foreground">{idx + 1}</td>
                        <td className="px-3 py-2 font-medium">{item.item_name}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {item.category_path || "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{item.unit_of_measure}</td>
                        <td className="px-3 py-2 text-right font-mono">{item.total_purchased}</td>
                        <td className="px-3 py-2 text-right font-mono">{item.total_used}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {item.current_balance}
                        </td>
                        <td className="px-3 py-2">
                          <StatusPill
                            tone={
                              item.status === "Out"
                                ? "danger"
                                : item.status === "Low"
                                  ? "warning"
                                  : "success"
                            }
                          >
                            {item.status}
                          </StatusPill>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setLedgerItem(item);
                                setView("ledger");
                              }}
                            >
                              <History className="mr-1 size-3.5" /> Ledger
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => setNextEntryItem(item)}
                            >
                              <ArrowRightLeft className="mr-1 size-3.5" /> Next Entry
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Material list — mobile cards */}
            <div className="space-y-3 md:hidden">
              {items.length === 0 && (
                <Card className="p-6 text-center text-sm text-muted-foreground">
                  No materials found.
                </Card>
              )}
              {items.map((item: any, idx: number) => (
                <Card key={item.item_id} className="p-4">
                  <div className="mb-3 flex items-start justify-between">
                    <div>
                      <p className="font-medium">{idx + 1}. {item.item_name}</p>
                      <p className="text-xs text-muted-foreground">{item.category_path || "—"}</p>
                    </div>
                    <StatusPill
                      tone={
                        item.status === "Out"
                          ? "danger"
                          : item.status === "Low"
                            ? "warning"
                            : "success"
                      }
                    >
                      {item.status}
                    </StatusPill>
                  </div>
                  <div className="mb-3 grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="rounded bg-muted/50 p-2">
                      <p className="text-xs text-muted-foreground">Purchased</p>
                      <p className="font-mono font-semibold">{item.total_purchased}</p>
                    </div>
                    <div className="rounded bg-muted/50 p-2">
                      <p className="text-xs text-muted-foreground">Used</p>
                      <p className="font-mono font-semibold">{item.total_used}</p>
                    </div>
                    <div className="rounded bg-muted/50 p-2">
                      <p className="text-xs text-muted-foreground">Balance</p>
                      <p className="font-mono font-semibold">{item.current_balance}</p>
                    </div>
                  </div>
                  <p className="mb-3 text-xs text-muted-foreground">Unit: {item.unit_of_measure}</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setLedgerItem(item);
                        setView("ledger");
                      }}
                    >
                      <History className="mr-1 size-3.5" /> Ledger
                    </Button>
                    <Button size="sm" className="flex-1" onClick={() => setNextEntryItem(item)}>
                      <ArrowRightLeft className="mr-1 size-3.5" /> Next Entry
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </>
        ) : (
          <LedgerView
            item={ledgerItem}
            warehouseName={selectedWarehouseName}
            onBack={() => {
              setView("list");
              setLedgerItem(null);
            }}
            onNextEntry={() => setNextEntryItem(ledgerItem)}
          />
        )}
      </div>

      {manageMaterialOpen && canAdmin && (
        <ManageMaterialModal
          warehouses={warehouses}
          categoryTree={categoryTree}
          flatCategories={flatCategories}
          onClose={() => setManageMaterialOpen(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["inventory-categories"] });
            qc.invalidateQueries({ queryKey: ["inventory-portal-items"] });
            setManageMaterialOpen(false);
          }}
        />
      )}

      {nextEntryItem && (
        <NextEntryModal
          item={nextEntryItem}
          warehouses={warehouses}
          vendors={vendors}
          canAdmin={canAdmin}
          onClose={() => setNextEntryItem(null)}
          onVendorCreated={() => qc.invalidateQueries({ queryKey: ["inventory-portal-vendors"] })}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["inventory-portal-items"] });
            if (view === "ledger" && ledgerItem) {
              qc.invalidateQueries({ queryKey: ["inventory-portal-ledger", ledgerItem.item_id] });
            }
            setNextEntryItem(null);
          }}
        />
      )}
    </AppShell>
  );
}

function LedgerView({
  item,
  warehouseName,
  onBack,
  onNextEntry,
}: {
  item: any;
  warehouseName: string;
  onBack: () => void;
  onNextEntry: () => void;
}) {
  const { data: ledgerData } = useQuery({
    queryKey: ["inventory-portal-ledger", item?.item_id],
    queryFn: () => fetchPortalLedger({ item_id: item.item_id }),
    enabled: !!item?.item_id,
  });
  const ledger = ledgerData;
  const rows = ledger?.rows ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ChevronLeft className="mr-1 size-4" /> Back to Materials
        </Button>
        <h2 className="text-lg font-semibold">
          {ledger?.item_name || item?.item_name} Ledger
        </h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Current Balance</p>
          <p className="text-2xl font-bold text-emerald-600">
            {ledger?.current_balance ?? item?.current_balance} {ledger?.unit_of_measure}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Purchased</p>
          <p className="text-2xl font-bold text-blue-600">{ledger?.total_purchased ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Total Used</p>
          <p className="text-2xl font-bold text-red-600">{ledger?.total_used ?? 0}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Status</p>
          <p className="text-2xl font-bold">
            {item?.status === "Low" ? "Low" : item?.current_balance === 0 ? "Out" : "OK"}
          </p>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Venture: {warehouseName}</p>
        <Button size="sm" onClick={onNextEntry}>
          <Plus className="mr-1 size-4" /> Next Entry
        </Button>
      </div>

      {/* Desktop ledger table */}
      <Card className="hidden overflow-hidden md:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Opening</th>
                <th className="px-3 py-2 text-right">Purchase</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Usage</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2">Purpose / Vendor</th>
                <th className="px-3 py-2">Invoice / Flat</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                    No ledger entries yet.
                  </td>
                </tr>
              )}
              {rows.map((row: any, idx: number) => (
                <tr key={`${row.date}-${idx}`} className="border-b hover:bg-muted/30">
                  <td className="px-3 py-2">{new Date(row.date).toLocaleDateString("en-IN")}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.opening}</td>
                  <td className="px-3 py-2 text-right font-mono text-blue-600">{row.purchase}</td>
                  <td className="px-3 py-2 text-right font-mono">{row.total}</td>
                  <td className="px-3 py-2 text-right font-mono text-red-600">{row.usage}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{row.closing}</td>
                  <td className="px-3 py-2">
                    {row.transactions.map((t: any) => (
                      <div key={t.id} className="text-xs">
                        {t.purpose || t.vendor_name || "—"}
                      </div>
                    ))}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {row.transactions.map((t: any) => (
                      <div key={t.id}>
                        {t.invoice_number || "—"} {t.flat_no ? `· ${t.flat_no}` : ""}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Mobile ledger cards */}
      <div className="space-y-3 md:hidden">
        {rows.length === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground">No ledger entries yet.</Card>
        )}
        {rows.map((row: any, idx: number) => (
          <Card key={`${row.date}-${idx}`} className="p-4">
            <p className="mb-2 font-medium">{new Date(row.date).toLocaleDateString("en-IN")}</p>
            <div className="mb-3 grid grid-cols-2 gap-2 text-sm">
              <div className="space-y-1 rounded bg-muted/50 p-2">
                <p className="text-xs text-muted-foreground">Opening</p>
                <p className="font-mono font-semibold">{row.opening}</p>
              </div>
              <div className="space-y-1 rounded bg-muted/50 p-2">
                <p className="text-xs text-muted-foreground">Purchase</p>
                <p className="font-mono font-semibold text-blue-600">{row.purchase}</p>
              </div>
              <div className="space-y-1 rounded bg-muted/50 p-2">
                <p className="text-xs text-muted-foreground">Usage</p>
                <p className="font-mono font-semibold text-red-600">{row.usage}</p>
              </div>
              <div className="space-y-1 rounded bg-muted/50 p-2">
                <p className="text-xs text-muted-foreground">Balance</p>
                <p className="font-mono font-semibold">{row.closing}</p>
              </div>
            </div>
            {row.transactions.map((t: any) => (
              <div key={t.id} className="border-t pt-2 text-xs text-muted-foreground">
                <p>Purpose: {t.purpose || "—"}</p>
                <p>Vendor: {t.vendor_name || "—"}</p>
                <p>Invoice: {t.invoice_number || "—"}</p>
                <p>Flat/Unit: {t.flat_no || "—"}</p>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}

function ManageMaterialModal({
  warehouses,
  categoryTree,
  flatCategories,
  onClose,
  onSaved,
}: {
  warehouses: any[];
  categoryTree: any[];
  flatCategories: { id: string; name: string; level: string; path: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    unit: "",
    reorder_level: "0",
    warehouse_id: "",
  });
  const [selection, setSelection] = useState<{
    category: { id: string; value: string; isNew: boolean };
    type: { id: string; value: string; isNew: boolean };
    subcategory: { id: string; value: string; isNew: boolean };
    subtype: { id: string; value: string; isNew: boolean };
  }>({
    category: { id: "", value: "", isNew: false },
    type: { id: "", value: "", isNew: false },
    subcategory: { id: "", value: "", isNew: false },
    subtype: { id: "", value: "", isNew: false },
  });
  const [saving, setSaving] = useState(false);

  const selectedCategory = categoryTree.find((n) => n.id === selection.category.id);
  const selectedType = selectedCategory?.children?.find((n: any) => n.id === selection.type.id);
  const selectedSubcategory = selectedType?.children?.find((n: any) => n.id === selection.subcategory.id);

  function levelNodes(parent: any[] | undefined, level: string) {
    return (parent ?? []).filter((n) => n.level === level);
  }

  function renderLevel(
    label: string,
    level: "category" | "type" | "subcategory" | "subtype",
    required: boolean,
    parentNodes: any[] | undefined,
  ) {
    const sel = selection[level];
    const options = levelNodes(parentNodes, level);
    const hasOptions = options.length > 0;

    return (
      <div className="space-y-1">
        <Label className="text-sm">
          {label} {required && <span className="text-red-500">*</span>}
        </Label>
        <div className="flex gap-2">
          {sel.isNew ? (
            <Input
              className="flex-1"
              placeholder={`New ${label.toLowerCase()}`}
              value={sel.value}
              onChange={(e) =>
                setSelection({ ...selection, [level]: { ...sel, value: e.target.value } })
              }
            />
          ) : (
            <Select
              value={sel.id}
              onValueChange={(id) => {
                const node = flatCategories.find((c) => c.id === id);
                const reset: Partial<typeof selection> = {};
                if (level === "category") {
                  reset.type = { id: "", value: "", isNew: false };
                  reset.subcategory = { id: "", value: "", isNew: false };
                  reset.subtype = { id: "", value: "", isNew: false };
                } else if (level === "type") {
                  reset.subcategory = { id: "", value: "", isNew: false };
                  reset.subtype = { id: "", value: "", isNew: false };
                } else if (level === "subcategory") {
                  reset.subtype = { id: "", value: "", isNew: false };
                }
                setSelection({
                  ...selection,
                  ...reset,
                  [level]: { id, value: node?.name || "", isNew: false },
                });
              }}
              disabled={!hasOptions && level !== "category"}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {options.map((n: any) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="icon"
            type="button"
            onClick={() =>
              setSelection({ ...selection, [level]: { id: "", value: "", isNew: !sel.isNew } })
            }
            title={sel.isNew ? "Cancel new" : "Create new"}
          >
            {sel.isNew ? "×" : "+"}
          </Button>
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    const categoryName = selection.category.isNew ? selection.category.value.trim() : selection.category.value.trim();
    if (!form.name.trim() || !categoryName || !form.unit.trim()) {
      toast.error("Material Name, Category and Unit are required");
      return;
    }
    setSaving(true);
    const result = await createPortalItem({
      name: form.name.trim(),
      unit: form.unit.trim(),
      category: categoryName,
      type: selection.type.value.trim(),
      subcategory: selection.subcategory.value.trim(),
      subtype: selection.subtype.value.trim(),
      reorder_level: Number(form.reorder_level) || 0,
      warehouse_id: form.warehouse_id || null,
    });
    if (result.success) {
      toast.success("Material saved");
      onSaved();
    } else {
      toast.error(result.error || "Failed to save material");
    }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        className="max-w-md max-h-[90vh] overflow-y-auto"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Manage Materials</DialogTitle>
          <DialogDescription>Create a new material and its category path</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-sm">
              Material Name <span className="text-red-500">*</span>
            </Label>
            <Input
              placeholder="e.g. Cement OPC 53"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          {renderLevel("Category", "category", true, categoryTree)}
          {renderLevel("Type", "type", false, selectedCategory?.children)}
          {renderLevel("Subcategory", "subcategory", false, selectedType?.children)}
          {renderLevel("Subtype", "subtype", false, selectedSubcategory?.children)}
          <div className="space-y-1">
            <Label className="text-sm">
              Unit <span className="text-red-500">*</span>
            </Label>
            <Input
              placeholder="e.g. bag"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Minimum Threshold</Label>
            <Input
              type="number"
              min={0}
              value={form.reorder_level}
              onChange={(e) => setForm({ ...form, reorder_level: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Default Warehouse</Label>
            <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w: any) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Material"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NextEntryModal({
  item,
  warehouses,
  vendors,
  canAdmin,
  onClose,
  onVendorCreated,
  onSaved,
}: {
  item: any;
  warehouses: any[];
  vendors: any[];
  canAdmin: boolean;
  onClose: () => void;
  onVendorCreated: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    transaction_date: new Date().toISOString().split("T")[0],
    purchase_qty: "",
    usage_qty: "",
    vendor_id: "",
    rate_per_unit: "",
    invoice_number: "",
    warehouse_id: item?.warehouse_id || "",
    flat_no: "",
    purpose: "",
    notes: "",
  });
  const [newVendorName, setNewVendorName] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: openingBalanceData } = useQuery({
    queryKey: ["inventory-portal-opening-balance", item.item_id, form.transaction_date],
    queryFn: () =>
      fetchPortalOpeningBalance({
        item_id: item.item_id as string,
        date: form.transaction_date as string,
      }),
    enabled: !!item.item_id && !!form.transaction_date,
  });
  const openingBalance = openingBalanceData?.opening_balance ?? item.current_balance;

  const handleSave = async () => {
    const purchase = Number(form.purchase_qty) || 0;
    const usage = Number(form.usage_qty) || 0;
    if (purchase <= 0 && usage <= 0) {
      toast.error("Enter purchase or usage quantity");
      return;
    }
    setSaving(true);
    const payload: Parameters<typeof recordPortalEntry>[0] = {
      item_id: item.item_id as string,
      transaction_date: form.transaction_date as string,
      vendor_id: form.vendor_id || null,
      warehouse_id: form.warehouse_id || null,
      flat_no: form.flat_no,
      purpose: form.purpose,
      notes: form.notes,
    };
    if (purchase > 0) payload.purchase_qty = purchase;
    if (usage > 0) payload.usage_qty = usage;
    if (form.rate_per_unit) payload.rate_per_unit = Number(form.rate_per_unit);
    if (form.invoice_number) payload.invoice_number = form.invoice_number;
    const result = await recordPortalEntry(payload);
    if (result.success) {
      toast.success("Entry saved");
      onSaved();
    } else {
      toast.error(result.error || "Failed to save entry");
    }
    setSaving(false);
  };

  const handleCreateVendor = async () => {
    if (!newVendorName.trim()) return;
    const result = await createPortalVendor({ name: newVendorName.trim() });
    if (result.success && result.id) {
      toast.success("Vendor created");
      setForm({ ...form, vendor_id: result.id });
      setNewVendorName("");
      onVendorCreated();
    } else {
      toast.error(result.error || "Failed to create vendor");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Next Entry — {item.item_name}</DialogTitle>
          <DialogDescription>Record purchase and/or usage for this material</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-sm">Material</Label>
              <Input value={`${item.item_name} (${item.unit_of_measure})`} disabled />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">
                Date <span className="text-red-500">*</span>
              </Label>
              <Input
                type="date"
                value={form.transaction_date}
                onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-sm">Opening Balance</Label>
              <Input value={`${openingBalance} ${item.unit_of_measure}`} disabled />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Purchase Quantity</Label>
              <Input
                type="number"
                min={0}
                placeholder="0"
                value={form.purchase_qty}
                onChange={(e) => setForm({ ...form, purchase_qty: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-sm">Vendor</Label>
              <Select value={form.vendor_id} onValueChange={(v) => setForm({ ...form, vendor_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Rate per Unit (₹)</Label>
              <Input
                type="number"
                min={0}
                placeholder="0"
                value={form.rate_per_unit}
                onChange={(e) => setForm({ ...form, rate_per_unit: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Invoice No</Label>
              <Input
                placeholder="e.g. INV-123"
                value={form.invoice_number}
                onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
              />
            </div>
          </div>

          {/* Quick vendor creation — admin only */}
          {canAdmin && (
            <div className="space-y-1">
              <Label className="text-sm">Create New Vendor</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Vendor name"
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={handleCreateVendor}
                  disabled={!newVendorName.trim()}
                >
                  <Plus className="mr-1 size-4" /> Add
                </Button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-sm">Venture</Label>
              <Select value={form.warehouse_id} onValueChange={(v) => setForm({ ...form, warehouse_id: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select venture" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((w: any) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Flat / Unit No</Label>
              <Input
                placeholder="e.g. 101"
                value={form.flat_no}
                onChange={(e) => setForm({ ...form, flat_no: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Usage Quantity</Label>
              <Input
                type="number"
                min={0}
                placeholder="0"
                value={form.usage_qty}
                onChange={(e) => setForm({ ...form, usage_qty: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-sm">Purpose / Work</Label>
            <Input
              placeholder="e.g. Plastering"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-sm">Notes</Label>
            <Textarea
              placeholder="Optional notes for this entry"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save Entry"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
