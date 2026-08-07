// Inventory management page: category tree, item master, stock register, low-stock alerts and ledger.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  fetchCategoryTree,
  createCategoryNode,
  fetchItems,
  createItem,
  fetchStockLevels,
  fetchLowStockAlerts,
  fetchItemLedger,
  fetchBlocks,
} from "@/lib/api/inventory";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  Plus,
  Search,
  ChevronRight,
  Package,
  AlertTriangle,
  History,
  Layers,
  FolderTree,
} from "lucide-react";

const LEVELS = ["category", "type", "subcategory", "subtype"] as const;
const LEVEL_LABELS: Record<string, string> = {
  category: "Category",
  type: "Type",
  subcategory: "Subcategory",
  subtype: "Subtype",
};
const CHILD_LEVEL: Record<string, string> = {
  category: "type",
  type: "subcategory",
  subcategory: "subtype",
  subtype: "",
};

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — Meditrust ERP" },
      {
        name: "description",
        content: "Inventory management: category tree, items, stock register, low-stock alerts, transaction ledger.",
      },
    ],
  }),
  beforeLoad: async () => { await requireAuth(); },
  component: InventoryPage,
});

// ---------------------------------------------------------------------------
// Tree node type
// ---------------------------------------------------------------------------
// Tree node type representing a category hierarchy entry with nested children.
type TreeNode = {
  id: string;
  name: string;
  level: string;
  parent_id: string | null;
  sort_order: number;
  children: TreeNode[];
};

// Builds a nested tree structure from a flat list of category nodes using parent_id links.
function buildTree(nodes: any[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const n of nodes) {
    map.set(n.id, { ...n, children: [] });
  }

  for (const n of nodes) {
    const node = map.get(n.id)!;
    if (n.parent_id && map.has(n.parent_id)) {
      map.get(n.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// Recursive tree node component
// ---------------------------------------------------------------------------
function TreeRow({
  node,
  depth,
  onAddChild,
}: {
  node: TreeNode;
  depth: number;
  onAddChild: (parent: TreeNode) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const childLevel = CHILD_LEVEL[node.level];

  return (
    <div>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
        >
          {hasChildren ? (
            <CollapsibleTrigger asChild>
              <button className="flex size-5 items-center justify-center rounded hover:bg-muted">
                <ChevronRight
                  className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`}
                />
              </button>
            </CollapsibleTrigger>
          ) : (
            <span className="w-5" />
          )}
          <span
            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
              depth === 0
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {LEVEL_LABELS[node.level] ?? node.level}
          </span>
          <span className="text-sm font-medium">{node.name}</span>
          {childLevel && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-xs"
              onClick={() => onAddChild(node)}
            >
              <Plus className="mr-0.5 size-3" /> Add {LEVEL_LABELS[childLevel]}
            </Button>
          )}
        </div>
        {hasChildren && (
          <CollapsibleContent>
            {node.children
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((child) => (
                <TreeRow key={child.id} node={child} depth={depth + 1} onAddChild={onAddChild} />
              ))}
          </CollapsibleContent>
        )}
      </Collapsible>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
// Main inventory page with tabs for category tree, items, stock register and transaction ledger.
function InventoryPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"tree" | "items" | "stock" | "ledger">("tree");

  // Category tree
  const { data: treeData } = useQuery({
    queryKey: ["inventory-categories"],
    queryFn: () => fetchCategoryTree({ data: {} }),
  });
  const tree = useMemo(() => buildTree(treeData?.data ?? []), [treeData]);

  // Items
  const [itemSearch, setItemSearch] = useState("");
  const { data: itemsData } = useQuery({
    queryKey: ["inventory-items", itemSearch],
    queryFn: () => fetchItems({ data: itemSearch ? { search: itemSearch } : {} }),
  });
  const items = itemsData?.data ?? [];

  // Stock levels
  const { data: stockData } = useQuery({
    queryKey: ["inventory-stock"],
    queryFn: () => fetchStockLevels({ data: {} }),
  });
  const stockItems = stockData?.data ?? [];

  // Low stock alerts
  const { data: lowStockData } = useQuery({
    queryKey: ["inventory-low-stock"],
    queryFn: () => fetchLowStockAlerts({ data: {} }),
  });
  const lowStock = lowStockData?.data ?? [];

  // Blocks
  const { data: blocksData } = useQuery({
    queryKey: ["inventory-blocks"],
    queryFn: () => fetchBlocks({ data: {} }),
  });
  const blocks = blocksData?.data ?? [];

  // Ledger
  const [ledgerItem, setLedgerItem] = useState<any | null>(null);
  const { data: ledgerData } = useQuery({
    queryKey: ["inventory-ledger", ledgerItem?.item_id],
    queryFn: () => fetchItemLedger({ data: { itemId: ledgerItem.item_id } }),
    enabled: !!ledgerItem,
  });
  const ledger = ledgerData?.data ?? [];

  // --- Add category dialog ---
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [catParent, setCatParent] = useState<TreeNode | null>(null);
  const [catForm, setCatForm] = useState({ name: "", level: "category" as string });
  const [catSaving, setCatSaving] = useState(false);

  // Opens the add-category dialog for a root-level category.
  const openAddRoot = () => {
    setCatParent(null);
    setCatForm({ name: "", level: "category" });
    setCatDialogOpen(true);
  };

  // Opens the add-category dialog for a child node under the given parent.
  const openAddChild = (parent: TreeNode) => {
    setCatParent(parent);
    const childLvl = CHILD_LEVEL[parent.level] ?? "type";
    setCatForm({ name: "", level: childLvl });
    setCatDialogOpen(true);
  };

  // Creates a new category node via the API and refreshes the tree on success.
  const handleCatSave = async () => {
    if (!catForm.name.trim()) {
      toast.error("Category name is required");
      return;
    }
    setCatSaving(true);
    try {
      const result = await createCategoryNode({
        data: {
          name: catForm.name.trim(),
          level: catForm.level as any,
          parent_id: catParent?.id ?? null,
        },
      });
      if (result.success) {
        toast.success(`${LEVEL_LABELS[catForm.level]} created`);
        setCatDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["inventory-categories"] });
      } else {
        toast.error(result.error ?? "Failed to create category");
      }
    } catch (err: any) {
      console.error("createCategoryNode client error:", err);
      const msg = err?.message || "Failed to create category";
      toast.error(msg);
    }
    setCatSaving(false);
  };

  // --- Add item dialog ---
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [itemForm, setItemForm] = useState({
    category_id: "",
    name: "",
    unit_of_measure: "",
    reorder_level: "0",
    opening_stock: "0",
  });
  const [itemSaving, setItemSaving] = useState(false);

  // Flatten tree for item category dropdown — only leaf nodes (subtype) or any node
  const flatCategories = useMemo(() => {
    const flat: { id: string; name: string; level: string; path: string }[] = [];
    function walk(nodes: TreeNode[], path: string) {
      for (const n of nodes) {
        const p = path ? `${path} › ${n.name}` : n.name;
        flat.push({ id: n.id, name: n.name, level: n.level, path: p });
        if (n.children.length > 0) walk(n.children, p);
      }
    }
    walk(tree, "");
    return flat;
  }, [tree]);

  // Opens the add-item dialog with the form fields reset to defaults.
  const openCreateItem = () => {
    setItemForm({ category_id: "", name: "", unit_of_measure: "", reorder_level: "0", opening_stock: "0" });
    setItemDialogOpen(true);
  };

  // Creates a new inventory item via the API and refreshes items and stock queries.
  const handleItemSave = async () => {
    if (!itemForm.name.trim()) {
      toast.error("Item name is required");
      return;
    }
    if (!itemForm.category_id) {
      toast.error("Select a category");
      return;
    }
    setItemSaving(true);
    try {
      const result = await createItem({
        data: {
          category_id: itemForm.category_id,
          name: itemForm.name.trim(),
          unit_of_measure: itemForm.unit_of_measure.trim() || undefined,
          reorder_level: Number(itemForm.reorder_level) || 0,
          opening_stock: Number(itemForm.opening_stock) || 0,
        },
      });
      if (result.success) {
        toast.success("Item created");
        setItemDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["inventory-items"] });
        queryClient.invalidateQueries({ queryKey: ["inventory-stock"] });
        queryClient.invalidateQueries({ queryKey: ["inventory-low-stock"] });
      } else {
        toast.error(result.error ?? "Failed to create item");
      }
    } catch {
      toast.error("Failed to create item");
    }
    setItemSaving(false);
  };

  const tabs = [
    { key: "tree" as const, label: "Category Tree", icon: FolderTree },
    { key: "items" as const, label: "Items", icon: Package },
    { key: "stock" as const, label: "Stock Register", icon: Layers },
    { key: "ledger" as const, label: "Ledger", icon: History },
  ];

  return (
    <AppShell title="Inventory" subtitle="Category tree, items, stock register & transaction ledger">
      {/* Low-stock alert banner */}
      {lowStock.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3">
          <AlertTriangle className="size-5 shrink-0 text-warning-foreground" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-warning-foreground">
              {lowStock.length} item{lowStock.length > 1 ? "s" : ""} at or below reorder level
            </p>
            <p className="text-xs text-muted-foreground">
              {lowStock.slice(0, 3).map((i: any) => i.item_name).join(", ")}
              {lowStock.length > 3 && ` +${lowStock.length - 3} more`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setTab("stock")}>
            View stock register
          </Button>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-4 flex gap-1 border-b border-border">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* --- Category Tree tab --- */}
      {tab === "tree" && (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Category hierarchy</h2>
            <Button size="sm" onClick={openAddRoot}>
              <Plus className="mr-1.5 size-4" /> Add root category
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Category → Type → Subcategory → Subtype. Click "Add" under any node to create a child.
          </p>
          <div className="mt-4 space-y-0.5">
            {tree.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No categories yet. Create a root category to get started.
              </p>
            ) : (
              tree
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((node) => (
                  <TreeRow key={node.id} node={node} depth={0} onAddChild={openAddChild} />
                ))
            )}
          </div>
        </Card>
      )}

      {/* --- Items tab --- */}
      {tab === "items" && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                className="w-64 pl-9"
              />
            </div>
            <Button size="sm" onClick={openCreateItem}>
              <Plus className="mr-1.5 size-4" /> Add item
            </Button>
          </div>
          <div className="mt-4">
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-semibold">Item</th>
                    <th className="pb-2 font-semibold">Category path</th>
                    <th className="pb-2 font-semibold">Unit</th>
                    <th className="pb-2 text-right font-semibold">Reorder lvl</th>
                    <th className="pb-2 text-right font-semibold">Current stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-muted-foreground">
                        No items found.
                      </td>
                    </tr>
                  )}
                  {items.map((i: any) => {
                    const isLow = Number(i.current_stock) <= Number(i.reorder_level);
                    return (
                      <tr key={i.item_id} className="align-middle">
                        <td className="py-3 font-medium">{i.item_name}</td>
                        <td className="py-3 text-xs text-muted-foreground">{i.category_path}</td>
                        <td className="py-3 text-muted-foreground">{i.unit_of_measure ?? "—"}</td>
                        <td className="py-3 text-right font-mono">{i.reorder_level}</td>
                        <td className="py-3 text-right">
                          <span className={`font-mono font-semibold ${isLow ? "text-destructive" : ""}`}>
                            {i.current_stock}
                          </span>
                          {isLow && (
                            <AlertTriangle className="ml-1 inline size-3.5 text-destructive" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {items.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No items found.</p>
              )}
              {items.map((i: any) => {
                const isLow = Number(i.current_stock) <= Number(i.reorder_level);
                return (
                  <div key={i.item_id} className="rounded-xl border border-border p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-medium">{i.item_name}</span>
                      {isLow ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                          <AlertTriangle className="size-3.5" /> Low
                        </span>
                      ) : (
                        <StatusPill tone="success">OK</StatusPill>
                      )}
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">{i.category_path}</p>
                    <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
                      <span className="text-muted-foreground">Stock: <span className={`font-mono font-semibold ${isLow ? "text-destructive" : ""}`}>{i.current_stock}</span> {i.unit_of_measure ?? ""}</span>
                      <span className="text-xs text-muted-foreground">Reorder: {i.reorder_level}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* --- Stock Register tab --- */}
      {tab === "stock" && (
        <Card className="p-5">
          <h2 className="text-sm font-bold">Stock register</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Current stock = opening + in − out ± adjustment (computed on read)
          </p>
          <div className="mt-4">
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-semibold">Item</th>
                    <th className="pb-2 font-semibold">Category</th>
                    <th className="pb-2 font-semibold">Unit</th>
                    <th className="pb-2 text-right font-semibold">Opening</th>
                    <th className="pb-2 text-right font-semibold">Current</th>
                    <th className="pb-2 text-right font-semibold">Reorder</th>
                    <th className="pb-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {stockItems.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No stock data. Create items first.
                      </td>
                    </tr>
                  )}
                  {stockItems.map((i: any) => {
                    const isLow = Number(i.current_stock) <= Number(i.reorder_level);
                    return (
                      <tr key={i.item_id} className="align-middle">
                        <td className="py-3 font-medium">{i.item_name}</td>
                        <td className="py-3 text-xs text-muted-foreground">{i.category_path}</td>
                        <td className="py-3 text-muted-foreground">{i.unit_of_measure ?? "—"}</td>
                        <td className="py-3 text-right font-mono">{i.opening_stock}</td>
                        <td className="py-3 text-right font-mono font-semibold">{i.current_stock}</td>
                        <td className="py-3 text-right font-mono">{i.reorder_level}</td>
                        <td className="py-3">
                          {isLow ? (
                            <StatusPill tone="danger">Low stock</StatusPill>
                          ) : (
                            <StatusPill tone="success">OK</StatusPill>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="space-y-3 md:hidden">
              {stockItems.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">No stock data. Create items first.</p>
              )}
              {stockItems.map((i: any) => {
                const isLow = Number(i.current_stock) <= Number(i.reorder_level);
                return (
                  <div key={i.item_id} className="rounded-xl border border-border p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-medium">{i.item_name}</span>
                      {isLow ? <StatusPill tone="danger">Low stock</StatusPill> : <StatusPill tone="success">OK</StatusPill>}
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">{i.category_path} · {i.unit_of_measure ?? "—"}</p>
                    <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-center text-xs">
                      <div><p className="text-muted-foreground">Opening</p><p className="font-mono font-semibold">{i.opening_stock}</p></div>
                      <div><p className="text-muted-foreground">Current</p><p className={`font-mono font-semibold ${isLow ? "text-destructive" : ""}`}>{i.current_stock}</p></div>
                      <div><p className="text-muted-foreground">Reorder</p><p className="font-mono">{i.reorder_level}</p></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}

      {/* --- Ledger tab --- */}
      {tab === "ledger" && (
        <Card className="p-5">
          <h2 className="text-sm font-bold">Transaction ledger</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Select an item to view its full transaction history.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              value={ledgerItem?.item_id ?? ""}
              onValueChange={(val) => {
                const item = stockItems.find((i: any) => i.item_id === val);
                setLedgerItem(item ?? null);
              }}
            >
              <SelectTrigger className="w-full sm:w-80">
                <SelectValue placeholder="Select item..." />
              </SelectTrigger>
              <SelectContent>
                {stockItems.map((i: any) => (
                  <SelectItem key={i.item_id} value={i.item_id}>
                    {i.item_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {ledgerItem && (
            <div className="mt-4">
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[700px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 font-semibold">Date</th>
                      <th className="pb-2 font-semibold">Type</th>
                      <th className="pb-2 text-right font-semibold">Qty</th>
                      <th className="pb-2 font-semibold">Block</th>
                      <th className="pb-2 font-semibold">Reference</th>
                      <th className="pb-2 font-semibold">Remarks</th>
                      <th className="pb-2 font-semibold">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ledger.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-muted-foreground">
                          No transactions recorded for this item.
                        </td>
                      </tr>
                    )}
                    {ledger.map((t: any) => (
                      <tr key={t.id} className="align-middle">
                        <td className="py-3 text-xs text-muted-foreground">
                          {new Date(t.created_at).toLocaleString("en-IN")}
                        </td>
                        <td className="py-3">
                          <StatusPill
                            tone={
                              t.type === "in" ? "success" : t.type === "out" ? "danger" : "warning"
                            }
                          >
                            {t.type}
                          </StatusPill>
                        </td>
                        <td className="py-3 text-right font-mono font-semibold">{t.quantity}</td>
                        <td className="py-3 text-muted-foreground">{t.block_name}</td>
                        <td className="py-3 font-mono text-xs">{t.reference ?? "—"}</td>
                        <td className="py-3 text-muted-foreground">{t.remarks ?? "—"}</td>
                        <td className="py-3 text-xs">{t.created_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {ledger.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">No transactions recorded for this item.</p>
                )}
                {ledger.map((t: any) => (
                  <div key={t.id} className="rounded-xl border border-border p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <StatusPill tone={t.type === "in" ? "success" : t.type === "out" ? "danger" : "warning"}>
                        {t.type}
                      </StatusPill>
                      <span className="font-mono text-sm font-semibold">{t.quantity}</span>
                    </div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleString("en-IN")}
                    </p>
                    <p className="text-sm">{t.block_name ?? "—"}</p>
                    {(t.reference || t.remarks) && (
                      <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                        {t.reference && <p>Ref: <span className="font-mono">{t.reference}</span></p>}
                        {t.remarks && <p>{t.remarks}</p>}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">By {t.created_by_name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* --- Add Category Dialog --- */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Add {catParent ? LEVEL_LABELS[catForm.level] : "root category"}
            </DialogTitle>
            <DialogDescription>
              {catParent
                ? `Under "${catParent.name}" (${LEVEL_LABELS[catParent.level]})`
                : "Top-level category in the inventory tree"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="catname">Name *</Label>
              <Input
                id="catname"
                value={catForm.name}
                onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                placeholder="e.g. Steel, Cement, MEP..."
              />
            </div>
            {!catParent && (
              <div className="space-y-2">
                <Label htmlFor="catlevel">Level</Label>
                <Select
                  value={catForm.level}
                  onValueChange={(val) => setCatForm({ ...catForm, level: val })}
                >
                  <SelectTrigger id="catlevel">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((l) => (
                      <SelectItem key={l} value={l}>
                        {LEVEL_LABELS[l]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>Cancel</Button>
            <Button disabled={catSaving} onClick={handleCatSave}>
              {catSaving ? "Saving..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* --- Add Item Dialog --- */}
      <Dialog open={itemDialogOpen} onOpenChange={setItemDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add inventory item</DialogTitle>
            <DialogDescription>
              Create an item at the bottom of the category tree (normally a subtype).
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="iname">Item name *</Label>
              <Input
                id="iname"
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                placeholder="e.g. TMT Steel Fe550D 16mm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="icat">Category *</Label>
              <Select
                value={itemForm.category_id}
                onValueChange={(val) => setItemForm({ ...itemForm, category_id: val })}
              >
                <SelectTrigger id="icat">
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  {flatCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="iunit">Unit of measure</Label>
                <Input
                  id="iunit"
                  value={itemForm.unit_of_measure}
                  onChange={(e) => setItemForm({ ...itemForm, unit_of_measure: e.target.value })}
                  placeholder="kg, bag, nos..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ireorder">Reorder level</Label>
                <Input
                  id="ireorder"
                  type="number"
                  value={itemForm.reorder_level}
                  onChange={(e) => setItemForm({ ...itemForm, reorder_level: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="iopening">Opening stock</Label>
              <Input
                id="iopening"
                type="number"
                value={itemForm.opening_stock}
                onChange={(e) => setItemForm({ ...itemForm, opening_stock: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>Cancel</Button>
            <Button disabled={itemSaving} onClick={handleItemSave}>
              {itemSaving ? "Saving..." : "Create item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
