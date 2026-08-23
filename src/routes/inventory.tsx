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
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import {
  fetchCategoryTree,
  createCategoryNode,
  fetchItems,
  createItem,
  fetchStockLevels,
  fetchLowStockAlerts,
  fetchItemLedger,
  fetchBlocks,
  fetchInventoryAlerts,
  resolveInventoryAlert,
  fetchWastageReport,
  fetchStockProjections,
  fetchBudgets,
  fetchItemBudget,
  setItemBudget,
  fetchInstantInventoryReport,
} from "@/lib/api/inventory";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { SectionTour, type TourStep } from "@/components/SectionTour";
import { toast } from "sonner";
import { inr } from "@/lib/erp-data";
import {
  Plus,
  Search,
  ChevronRight,
  Package,
  AlertTriangle,
  History,
  Layers,
  FolderTree,
  TrendingDown,
  Trash2,
  Wallet,
  CheckCircle,
  Boxes,
} from "lucide-react";
import { WorkCategorySelect, WorkCategoryBadge } from "@/components/WorkCategory";

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
      { title: "Inventory ΓÇö Meditrust ERP" },
      {
        name: "description",
        content:
          "Inventory management: category tree, items, stock register, low-stock alerts, transaction ledger.",
      },
    ],
  }),
  beforeLoad: () => {
    requireAuth();
  },
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
              depth === 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
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
  const [tab, setTab] = useState<
    "tree" | "items" | "stock" | "ledger" | "alerts" | "wastage" | "projections" | "budgets"
  >("tree");
  const isAdminRole = ["Administrator", "A1", "A1+"].includes(role);

  const tourSteps: TourStep[] = isAdminRole
    ? [
        {
          selector: '[data-tour="inv-items-count"]',
          title: "Item Count",
          description:
            "Total inventory items registered across all categories — use this to check if your catalog is complete.",
        },
        {
          selector: '[data-tour="inv-low-stock"]',
          title: "Low Stock Count",
          description:
            "Items at or below their reorder level — each one needs a purchase requisition raised soon.",
        },
        {
          selector: '[data-tour="inv-open-alerts"]',
          title: "Open Alerts",
          description:
            "Persistent low-stock alerts that haven't been resolved yet — resolve them once you've reordered.",
        },
        {
          selector: '[data-tour="inv-vendor-outstanding"]',
          title: "Vendor Outstanding",
          description:
            "Total unpaid vendor invoices for inventory purchases — track this against your budget.",
        },
        {
          selector: '[data-tour="inv-tab-tree"]',
          title: "Category Tree Tab",
          description:
            "Switch here to organize your material hierarchy — categories, types, subcategories, and subtypes.",
        },
        {
          selector: '[data-tour="inv-tab-items"]',
          title: "Items Tab",
          description:
            "Switch here to view, search, and add individual inventory items with units and reorder levels.",
        },
        {
          selector: '[data-tour="inv-tab-stock"]',
          title: "Stock Register Tab",
          description:
            "Switch here to see current stock levels computed from all transactions — opening + in − out ± adjustments.",
        },
        {
          selector: '[data-tour="inv-tab-alerts"]',
          title: "Alerts Tab",
          description:
            "Switch here to review and resolve persistent low-stock alerts that need attention.",
        },
        {
          selector: '[data-tour="add-root-category"]',
          title: "+ Add Root Category",
          description:
            "Create a top-level material category (e.g. Cement, Electrical) before adding items under it.",
        },
        {
          selector: '[data-tour="inv-item-search"]',
          title: "Search Items",
          description: "Type an item name to find it quickly in the items table.",
        },
        {
          selector: '[data-tour="add-item"]',
          title: "+ Add Item",
          description:
            "Add a new stock item under this category — set its unit and reorder threshold so low-stock alerts trigger automatically.",
        },
        {
          selector: '[data-tour="inv-alert-resolve"]',
          title: "Resolve Alert",
          description:
            "Click Resolve once you've raised a purchase requisition for the low-stock item — this clears the persistent alert.",
        },
      ]
    : [
        {
          selector: '[data-tour="inv-items-count"]',
          title: "Item Count",
          description: "Total inventory items registered across all categories.",
        },
        {
          selector: '[data-tour="inv-low-stock"]',
          title: "Low Stock Count",
          description: "Items at or below their reorder level — these need attention.",
        },
        {
          selector: '[data-tour="inv-tab-items"]',
          title: "Items Tab",
          description: "Switch here to view and search inventory items with current stock levels.",
        },
        {
          selector: '[data-tour="inv-tab-stock"]',
          title: "Stock Register Tab",
          description: "Switch here to see current stock levels for all items.",
        },
        {
          selector: '[data-tour="inv-item-search"]',
          title: "Search Items",
          description: "Type an item name to find it quickly in the items table.",
        },
      ];

  // Category tree
  const { data: treeData } = useQuery({
    queryKey: ["inventory-categories"],
    queryFn: () => fetchCategoryTree(),
  });
  const tree = useMemo(() => buildTree(treeData?.data ?? []), [treeData]);

  // Items
  const [inventoryDomain, setInventoryDomain] = useState<"civil" | "structural">("civil");
  const [itemSearch, setItemSearch] = useState("");
  const [itemWorkCat, setItemWorkCat] = useState("all");
  const { data: itemsData } = useQuery({
    queryKey: ["inventory-items", inventoryDomain, itemSearch, itemWorkCat],
    queryFn: () =>
      fetchItems({
        domain: inventoryDomain,
        ...(itemSearch ? { search: itemSearch } : {}),
        ...(itemWorkCat !== "all" ? { workCategory: itemWorkCat } : {}),
      }),
  });
  const items = itemsData?.data ?? [];

  // Stock levels
  const { data: stockData } = useQuery({
    queryKey: ["inventory-stock"],
    queryFn: () => fetchStockLevels(),
  });
  const stockItems = stockData?.data ?? [];

  // Low stock alerts
  const { data: lowStockData } = useQuery({
    queryKey: ["inventory-low-stock"],
    queryFn: () => fetchLowStockAlerts(),
  });
  const lowStock = lowStockData?.data ?? [];

  // A2: Persistent inventory alerts
  const { data: alertsData } = useQuery({
    queryKey: ["inventory-alerts"],
    queryFn: () => fetchInventoryAlerts({ resolved: false }),
  });
  const alerts = alertsData?.data ?? [];

  // B4: Instant consolidated report
  const { data: reportData } = useQuery({
    queryKey: ["inventory-instant-report"],
    queryFn: () => fetchInstantInventoryReport(),
  });
  const report = reportData?.data;

  // B1: Wastage report
  const [wastageFrom, setWastageFrom] = useState("");
  const [wastageTo, setWastageTo] = useState("");
  const { data: wastageData } = useQuery({
    queryKey: ["inventory-wastage", wastageFrom, wastageTo],
    queryFn: () =>
      fetchWastageReport({
        ...(wastageFrom ? { fromDate: wastageFrom } : {}),
        ...(wastageTo ? { toDate: wastageTo } : {}),
      }),
  });
  const wastageItems = wastageData?.data ?? [];

  // B2: Stock projections
  const { data: projectionsData } = useQuery({
    queryKey: ["inventory-projections"],
    queryFn: () => fetchStockProjections(),
  });
  const projections = projectionsData?.data ?? [];

  // B3: Budgets
  const { data: budgetsData } = useQuery({
    queryKey: ["inventory-budgets"],
    queryFn: () => fetchBudgets(),
  });
  const budgets = budgetsData?.data ?? [];

  // Blocks
  const { data: blocksData } = useQuery({
    queryKey: ["inventory-blocks"],
    queryFn: () => fetchBlocks(),
  });
  const blocks = blocksData?.data ?? [];

  // Ledger
  const [ledgerItem, setLedgerItem] = useState<any | null>(null);
  const { data: ledgerData } = useQuery({
    queryKey: ["inventory-ledger", ledgerItem?.item_id],
    queryFn: () => fetchItemLedger({ itemId: ledgerItem.item_id }),
    enabled: !!ledgerItem,
  });
  const ledger = ledgerData?.data ?? [];

  // B3: Budget for the selected ledger item
  const { data: itemBudgetData, refetch: refetchItemBudget } = useQuery({
    queryKey: ["inventory-item-budget", ledgerItem?.item_id],
    queryFn: () => fetchItemBudget({ itemId: ledgerItem.item_id }),
    enabled: !!ledgerItem,
  });
  const itemBudget = itemBudgetData?.data;
  const [budgetForm, setBudgetForm] = useState({
    budget_qty: "",
    budget_value: "",
    alert_threshold_pct: "80",
  });
  const [budgetSaving, setBudgetSaving] = useState(false);

  // A2: Resolve alert handler
  const handleResolveAlert = async (alertId: string) => {
    const result = await resolveInventoryAlert({ alertId });
    if (result.success) {
      toast.success("Alert resolved");
      queryClient.invalidateQueries({ queryKey: ["inventory-alerts"] });
      queryClient.invalidateQueries({ queryKey: ["inventory-instant-report"] });
    } else {
      toast.error(result.error ?? "Failed to resolve alert");
    }
  };

  // B3: Set budget handler
  const handleSetBudget = async () => {
    if (!ledgerItem || !budgetForm.budget_qty) {
      toast.error("Enter a budget quantity");
      return;
    }
    setBudgetSaving(true);
    const result = await setItemBudget({
      item_id: ledgerItem.item_id,
      budget_qty: Number(budgetForm.budget_qty),
      budget_value: Number(budgetForm.budget_value) || 0,
      alert_threshold_pct: Number(budgetForm.alert_threshold_pct) || 80,
    });
    if (result.success) {
      toast.success("Budget saved");
      queryClient.invalidateQueries({ queryKey: ["inventory-budgets"] });
      refetchItemBudget();
    } else {
      toast.error(result.error ?? "Failed to save budget");
    }
    setBudgetSaving(false);
  };

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
        name: catForm.name.trim(),
        level: catForm.level as any,
        parent_id: catParent?.id ?? null,
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
    work_category: "uncategorized",
    domain: "civil" as "civil" | "structural" | "uncategorized",
  });
  const [itemSaving, setItemSaving] = useState(false);

  // Flatten tree for item category dropdown ΓÇö only leaf nodes (subtype) or any node
  const flatCategories = useMemo(() => {
    const flat: { id: string; name: string; level: string; path: string }[] = [];
    function walk(nodes: TreeNode[], path: string) {
      for (const n of nodes) {
        const p = path ? `${path} ΓÇ║ ${n.name}` : n.name;
        flat.push({ id: n.id, name: n.name, level: n.level, path: p });
        if (n.children.length > 0) walk(n.children, p);
      }
    }
    walk(tree, "");
    return flat;
  }, [tree]);

  // Opens the add-item dialog with the form fields reset to defaults.
  const openCreateItem = () => {
    setItemForm({
      category_id: "",
      name: "",
      unit_of_measure: "",
      reorder_level: "0",
      opening_stock: "0",
      work_category: inventoryDomain,
      domain: inventoryDomain,
    });
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
        category_id: itemForm.category_id,
        name: itemForm.name.trim(),
        ...(itemForm.unit_of_measure.trim()
          ? { unit_of_measure: itemForm.unit_of_measure.trim() }
          : {}),
        reorder_level: Number(itemForm.reorder_level) || 0,
        opening_stock: Number(itemForm.opening_stock) || 0,
        work_category: itemForm.work_category,
        domain: itemForm.domain,
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
    { key: "tree" as const, label: "Category Tree", icon: FolderTree, badge: 0 },
    { key: "items" as const, label: "Items", icon: Package, badge: 0 },
    { key: "stock" as const, label: "Stock Register", icon: Layers, badge: 0 },
    { key: "ledger" as const, label: "Ledger", icon: History, badge: 0 },
    { key: "alerts" as const, label: "Alerts", icon: AlertTriangle, badge: alerts.length },
    { key: "wastage" as const, label: "Wastage", icon: Trash2, badge: 0 },
    { key: "projections" as const, label: "Projections", icon: TrendingDown, badge: 0 },
    { key: "budgets" as const, label: "Budgets", icon: Wallet, badge: 0 },
  ];

  return (
    <AppShell
      title="Inventory"
      subtitle="Category tree, items, stock register & transaction ledger"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-lg border border-border p-1"
          role="tablist"
          aria-label="Inventory domain"
        >
          {(["civil", "structural"] as const).map((domain) => (
            <button
              key={domain}
              type="button"
              role="tab"
              aria-selected={inventoryDomain === domain}
              onClick={() => setInventoryDomain(domain)}
              className={`rounded-md px-4 py-2 text-sm font-semibold capitalize transition-colors ${
                inventoryDomain === domain
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {domain}
            </button>
          ))}
        </div>
        <SectionTour sectionKey="inventory" steps={tourSteps} />
      </div>
      {/* B4: Instant consolidated report ΓÇö summary cards */}
      {report && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Card className="p-4" data-tour="inv-items-count">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Boxes className="size-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Items</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{report.item_count}</p>
          </Card>
          <Card className="p-4" data-tour="inv-low-stock">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="size-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Low Stock</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-destructive">{report.low_stock_count}</p>
          </Card>
          <Card className="p-4" data-tour="inv-open-alerts">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertTriangle className="size-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Open Alerts</span>
            </div>
            <p className="mt-1 text-2xl font-bold text-warning-foreground">
              {report.open_alerts_count}
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Trash2 className="size-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Wastage (30d)</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{report.wastage_total_30d}</p>
          </Card>
          <Card className="p-4" data-tour="inv-vendor-outstanding">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wallet className="size-4" />
              <span className="text-xs font-medium uppercase tracking-wide">
                Vendor Outstanding
              </span>
            </div>
            <p className="mt-1 text-2xl font-bold">{inr(report.total_vendor_outstanding)}</p>
          </Card>
        </div>
      )}

      {/* Low-stock alert banner */}
      {lowStock.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3">
          <AlertTriangle className="size-5 shrink-0 text-warning-foreground" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-warning-foreground">
              {lowStock.length} item{lowStock.length > 1 ? "s" : ""} at or below reorder level
            </p>
            <p className="text-xs text-muted-foreground">
              {lowStock
                .slice(0, 3)
                .map((i: any) => i.item_name)
                .join(", ")}
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
              data-tour={`inv-tab-${t.key}`}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {t.label}
              {t.badge > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 text-[10px] font-bold text-destructive-foreground">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* --- Category Tree tab --- */}
      {tab === "tree" && (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold">Category hierarchy</h2>
            <Button size="sm" onClick={openAddRoot} data-tour="add-root-category">
              <Plus className="mr-1.5 size-4" /> Add root category
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Category ΓåÆ Type ΓåÆ Subcategory ΓåÆ Subtype. Click "Add" under any node to create a
            child.
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
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  className="w-64 pl-9"
                  data-tour="inv-item-search"
                />
              </div>
              <WorkCategorySelect
                value={itemWorkCat}
                onChange={setItemWorkCat}
                placeholder="All categories"
                className="w-48"
              />
            </div>
            <Button size="sm" onClick={openCreateItem} data-tour="add-item">
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
                    <th className="pb-2 font-semibold">Work</th>
                    <th className="pb-2 font-semibold">Unit</th>
                    <th className="pb-2 text-right font-semibold">Reorder lvl</th>
                    <th className="pb-2 text-right font-semibold">Current stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
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
                        <td className="py-3">
                          <WorkCategoryBadge category={i.work_category} />
                        </td>
                        <td className="py-3 text-muted-foreground">{i.unit_of_measure ?? "ΓÇö"}</td>
                        <td className="py-3 text-right font-mono">{i.reorder_level}</td>
                        <td className="py-3 text-right">
                          <span
                            className={`font-mono font-semibold ${isLow ? "text-destructive" : ""}`}
                          >
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
                    <div className="mb-2">
                      <WorkCategoryBadge category={i.work_category} />
                    </div>
                    <div className="flex items-center justify-between border-t border-border pt-2 text-sm">
                      <span className="text-muted-foreground">
                        Stock:{" "}
                        <span
                          className={`font-mono font-semibold ${isLow ? "text-destructive" : ""}`}
                        >
                          {i.current_stock}
                        </span>{" "}
                        {i.unit_of_measure ?? ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Reorder: {i.reorder_level}
                      </span>
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
            Current stock = opening + in ΓêÆ out ┬▒ adjustment (computed on read)
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
                        <td className="py-3 text-muted-foreground">{i.unit_of_measure ?? "ΓÇö"}</td>
                        <td className="py-3 text-right font-mono">{i.opening_stock}</td>
                        <td className="py-3 text-right font-mono font-semibold">
                          {i.current_stock}
                        </td>
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
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No stock data. Create items first.
                </p>
              )}
              {stockItems.map((i: any) => {
                const isLow = Number(i.current_stock) <= Number(i.reorder_level);
                return (
                  <div key={i.item_id} className="rounded-xl border border-border p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="font-medium">{i.item_name}</span>
                      {isLow ? (
                        <StatusPill tone="danger">Low stock</StatusPill>
                      ) : (
                        <StatusPill tone="success">OK</StatusPill>
                      )}
                    </div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      {i.category_path} ┬╖ {i.unit_of_measure ?? "ΓÇö"}
                    </p>
                    <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-center text-xs">
                      <div>
                        <p className="text-muted-foreground">Opening</p>
                        <p className="font-mono font-semibold">{i.opening_stock}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Current</p>
                        <p className={`font-mono font-semibold ${isLow ? "text-destructive" : ""}`}>
                          {i.current_stock}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Reorder</p>
                        <p className="font-mono">{i.reorder_level}</p>
                      </div>
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
                          <div className="flex items-center gap-1.5">
                            <StatusPill
                              tone={
                                t.type === "in"
                                  ? "success"
                                  : t.type === "out"
                                    ? "danger"
                                    : "warning"
                              }
                            >
                              {t.type}
                            </StatusPill>
                            {t.is_wastage && (
                              <span className="inline-flex items-center rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                                WASTAGE
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 text-right font-mono font-semibold">{t.quantity}</td>
                        <td className="py-3 text-muted-foreground">{t.block_name}</td>
                        <td className="py-3 font-mono text-xs">{t.reference ?? "ΓÇö"}</td>
                        <td className="py-3 text-muted-foreground">{t.remarks ?? "ΓÇö"}</td>
                        <td className="py-3 text-xs">{t.created_by_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {ledger.length === 0 && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No transactions recorded for this item.
                  </p>
                )}
                {ledger.map((t: any) => (
                  <div key={t.id} className="rounded-xl border border-border p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <StatusPill
                          tone={
                            t.type === "in" ? "success" : t.type === "out" ? "danger" : "warning"
                          }
                        >
                          {t.type}
                        </StatusPill>
                        {t.is_wastage && (
                          <span className="inline-flex items-center rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                            WASTAGE
                          </span>
                        )}
                      </div>
                      <span className="font-mono text-sm font-semibold">{t.quantity}</span>
                    </div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      {new Date(t.created_at).toLocaleString("en-IN")}
                    </p>
                    <p className="text-sm">{t.block_name ?? "ΓÇö"}</p>
                    {(t.reference || t.remarks) && (
                      <div className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                        {t.reference && (
                          <p>
                            Ref: <span className="font-mono">{t.reference}</span>
                          </p>
                        )}
                        {t.remarks && <p>{t.remarks}</p>}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">By {t.created_by_name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* B3: Budget section for the selected ledger item */}
          {ledgerItem && isAdminRole && (
            <div className="mt-4 rounded-lg border border-border p-4">
              <h3 className="text-sm font-bold">Material budget</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Set an expected usage quantity. You'll be warned when actual usage crosses the
                threshold.
              </p>
              {itemBudget && (
                <div
                  className={`mt-3 rounded-md p-3 ${itemBudget.is_over_threshold ? "bg-destructive/10 border border-destructive/30" : "bg-muted/50"}`}
                >
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Budget: <span className="font-semibold">{itemBudget.budget_qty}</span>
                    </span>
                    <span className="text-muted-foreground">
                      Used:{" "}
                      <span
                        className={`font-semibold ${itemBudget.is_over_threshold ? "text-destructive" : ""}`}
                      >
                        {itemBudget.total_usage}
                      </span>
                    </span>
                    <span
                      className={`font-semibold ${itemBudget.is_over_threshold ? "text-destructive" : "text-muted-foreground"}`}
                    >
                      {itemBudget.usage_pct}%
                    </span>
                  </div>
                  {itemBudget.is_over_threshold && (
                    <p className="mt-1 text-xs font-semibold text-destructive">
                      Over {itemBudget.alert_threshold_pct}% threshold ΓÇö consider reviewing usage.
                    </p>
                  )}
                </div>
              )}
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="bqty" className="text-xs">
                    Budget Qty
                  </Label>
                  <Input
                    id="bqty"
                    type="number"
                    value={budgetForm.budget_qty}
                    onChange={(e) => setBudgetForm({ ...budgetForm, budget_qty: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bval" className="text-xs">
                    Budget Value (Γé╣)
                  </Label>
                  <Input
                    id="bval"
                    type="number"
                    value={budgetForm.budget_value}
                    onChange={(e) => setBudgetForm({ ...budgetForm, budget_value: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="bthr" className="text-xs">
                    Alert %
                  </Label>
                  <Input
                    id="bthr"
                    type="number"
                    value={budgetForm.alert_threshold_pct}
                    onChange={(e) =>
                      setBudgetForm({ ...budgetForm, alert_threshold_pct: e.target.value })
                    }
                    placeholder="80"
                  />
                </div>
              </div>
              <Button className="mt-3" size="sm" disabled={budgetSaving} onClick={handleSetBudget}>
                {budgetSaving ? "Saving..." : "Save budget"}
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* --- Alerts tab (A2) --- */}
      {tab === "alerts" && (
        <Card className="p-5" data-tour="inv-alerts">
          <h2 className="text-sm font-bold">Inventory alerts</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Persistent low-stock alerts. Click "Resolve" once you've reordered.
          </p>
          <div className="mt-4">
            {alerts.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No open alerts. Stock levels are healthy.
              </p>
            ) : (
              <div className="space-y-2">
                {alerts.map((a: any) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between rounded-lg border border-warning/30 bg-warning-soft px-4 py-3"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{a.item_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Stock at alert: {a.stock_at_alert} · Reorder level:{" "}
                        {a.reorder_level_at_alert} · Alerted:{" "}
                        {new Date(a.created_at).toLocaleDateString("en-IN")}
                      </p>
                    </div>
                    {isAdminRole && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResolveAlert(a.id)}
                        data-tour="inv-alert-resolve"
                      >
                        <CheckCircle className="mr-1 size-3.5" /> Resolve
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* --- Wastage Report tab (B1) --- */}
      {tab === "wastage" && (
        <Card className="p-5">
          <h2 className="text-sm font-bold">Wastage report</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            All wastage/damage-flagged stock out transactions.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="wfrom" className="text-xs">
                From date
              </Label>
              <Input
                id="wfrom"
                type="date"
                value={wastageFrom}
                onChange={(e) => setWastageFrom(e.target.value)}
                className="w-full sm:w-40"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="wto" className="text-xs">
                To date
              </Label>
              <Input
                id="wto"
                type="date"
                value={wastageTo}
                onChange={(e) => setWastageTo(e.target.value)}
                className="w-full sm:w-40"
              />
            </div>
          </div>
          <div className="mt-4">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-semibold">Date</th>
                    <th className="pb-2 font-semibold">Item</th>
                    <th className="pb-2 text-right font-semibold">Qty Wasted</th>
                    <th className="pb-2 font-semibold">Block</th>
                    <th className="pb-2 font-semibold">Reference</th>
                    <th className="pb-2 font-semibold">Logged by</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {wastageItems.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        No wastage recorded in this period.
                      </td>
                    </tr>
                  )}
                  {wastageItems.map((t: any) => (
                    <tr key={t.id} className="align-middle">
                      <td className="py-3 text-xs text-muted-foreground">
                        {new Date(t.created_at).toLocaleString("en-IN")}
                      </td>
                      <td className="py-3 font-medium">{t.item_name}</td>
                      <td className="py-3 text-right font-mono font-semibold text-destructive">
                        {t.quantity} {t.unit_of_measure ?? ""}
                      </td>
                      <td className="py-3 text-muted-foreground">{t.block_name}</td>
                      <td className="py-3 font-mono text-xs">{t.reference ?? "ΓÇö"}</td>
                      <td className="py-3 text-xs">{t.created_by_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {wastageItems.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No wastage recorded in this period.
                </p>
              )}
              {wastageItems.map((t: any) => (
                <div key={t.id} className="rounded-xl border border-border p-4">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-medium">{t.item_name}</span>
                    <span className="font-mono text-sm font-semibold text-destructive">
                      {t.quantity} {t.unit_of_measure ?? ""}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(t.created_at).toLocaleString("en-IN")}
                  </p>
                  <p className="mt-1 text-sm">Block: {t.block_name}</p>
                  <p className="text-xs text-muted-foreground">By {t.created_by_name}</p>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* --- Projections tab (B2) --- */}
      {tab === "projections" && (
        <Card className="p-5">
          <h2 className="text-sm font-bold">Stock usage projections</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Estimated days until each item reaches reorder level, based on last 30 days of usage.
          </p>
          <div className="mt-4">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 font-semibold">Item</th>
                    <th className="pb-2 text-right font-semibold">Current Stock</th>
                    <th className="pb-2 text-right font-semibold">Reorder Level</th>
                    <th className="pb-2 text-right font-semibold">Usage (30d)</th>
                    <th className="pb-2 text-right font-semibold">Avg Daily</th>
                    <th className="pb-2 text-right font-semibold">Days Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {projections.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        No items to project.
                      </td>
                    </tr>
                  )}
                  {projections.map((p: any) => (
                    <tr key={p.item_id} className="align-middle">
                      <td className="py-3 font-medium">{p.item_name}</td>
                      <td className="py-3 text-right font-mono">
                        {p.current_stock} {p.unit_of_measure ?? ""}
                      </td>
                      <td className="py-3 text-right font-mono">{p.reorder_level}</td>
                      <td className="py-3 text-right font-mono">{p.total_usage_30d}</td>
                      <td className="py-3 text-right font-mono">{p.avg_daily_usage}</td>
                      <td className="py-3 text-right">
                        {p.days_remaining === null ? (
                          <span className="text-muted-foreground">ΓÇö</span>
                        ) : (
                          <span
                            className={`font-mono font-semibold ${
                              p.days_remaining <= 7
                                ? "text-destructive"
                                : p.days_remaining <= 14
                                  ? "text-warning-foreground"
                                  : ""
                            }`}
                          >
                            {p.days_remaining} days
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 md:hidden">
              {projections.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No items to project.
                </p>
              )}
              {projections.map((p: any) => (
                <div key={p.item_id} className="rounded-xl border border-border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">{p.item_name}</span>
                    {p.days_remaining === null ? (
                      <span className="text-xs text-muted-foreground">No usage</span>
                    ) : (
                      <span
                        className={`font-mono text-sm font-semibold ${
                          p.days_remaining <= 7
                            ? "text-destructive"
                            : p.days_remaining <= 14
                              ? "text-warning-foreground"
                              : ""
                        }`}
                      >
                        {p.days_remaining} days left
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-center text-xs">
                    <div>
                      <p className="text-muted-foreground">Stock</p>
                      <p className="font-mono font-semibold">{p.current_stock}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Usage 30d</p>
                      <p className="font-mono">{p.total_usage_30d}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Daily avg</p>
                      <p className="font-mono">{p.avg_daily_usage}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* --- Budgets tab (B3) --- */}
      {tab === "budgets" && (
        <Card className="p-5">
          <h2 className="text-sm font-bold">Material budgets</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Track planned vs. actual usage. Items over threshold are highlighted.
          </p>
          <div className="mt-4">
            {budgets.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No budgets set. Open an item's ledger to set a budget.
              </p>
            ) : (
              <div className="space-y-2">
                {budgets.map((b: any) => (
                  <div
                    key={b.id}
                    className={`rounded-lg border p-4 ${b.is_over_threshold ? "border-destructive/30 bg-destructive/5" : "border-border"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{b.item_name}</span>
                      {b.is_over_threshold && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive">
                          <AlertTriangle className="size-3.5" /> Over threshold
                        </span>
                      )}
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-2 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Budget</p>
                        <p className="font-mono font-semibold">
                          {b.budget_qty} {b.unit_of_measure ?? ""}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Used</p>
                        <p
                          className={`font-mono font-semibold ${b.is_over_threshold ? "text-destructive" : ""}`}
                        >
                          {b.total_usage}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Usage</p>
                        <p
                          className={`font-mono font-semibold ${b.is_over_threshold ? "text-destructive" : ""}`}
                        >
                          {b.usage_pct}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Threshold</p>
                        <p className="font-mono">{b.alert_threshold_pct}%</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
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
            <Button variant="outline" onClick={() => setCatDialogOpen(false)}>
              Cancel
            </Button>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="idomain">Inventory domain *</Label>
                <Select
                  value={itemForm.domain}
                  onValueChange={(val) =>
                    setItemForm({ ...itemForm, domain: val as "civil" | "structural" })
                  }
                >
                  <SelectTrigger id="idomain">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="civil">Civil</SelectItem>
                    <SelectItem value="structural">Structural</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="iworkcat">Work Category *</Label>
                <WorkCategorySelect
                  value={itemForm.work_category}
                  onChange={(val) => setItemForm({ ...itemForm, work_category: val })}
                  placeholder="Select work category..."
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemDialogOpen(false)}>
              Cancel
            </Button>
            <Button disabled={itemSaving} onClick={handleItemSave}>
              {itemSaving ? "Saving..." : "Create item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
