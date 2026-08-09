// Progress configuration page for setting up blocks, floors, categories, work items, cell groups and supervisor assignments.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { requireAuth } from "@/lib/auth-guards";
import {
  fetchHierarchy,
  fetchSupervisors,
  createBlock,
  createFloor,
  createCategory,
  createWorkItem,
  createCellGroup,
  assignSupervisor,
  createWorkView,
  deleteWorkView,
} from "@/lib/api/progress-tracking";
import { toast } from "sonner";
import { Settings2, Plus, Layers, Building2, Tag, Wrench, Grid3x3, UserCheck, Eye } from "lucide-react";
import { WorkCategorySelect, WorkCategoryBadge } from "@/components/WorkCategory";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/progress-config")({
  head: () => ({
    meta: [{ title: "Progress Config — Meditrust ERP" }],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: ProgressConfigPage,
});

type Tab = "workViews" | "blocks" | "floors" | "categories" | "workItems" | "cellGroups" | "assignments";

const SCOPE_LABELS: Record<string, string> = {
  flat: "Unit/Room",
  floor: "Floor",
  block: "Block",
};

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: "workViews", label: "Work Views", icon: Eye },
  { id: "blocks", label: "Blocks", icon: Building2 },
  { id: "floors", label: "Floors", icon: Layers },
  { id: "categories", label: "Categories", icon: Tag },
  { id: "workItems", label: "Work Items", icon: Wrench },
  { id: "cellGroups", label: "Cell Groups", icon: Grid3x3 },
  { id: "assignments", label: "Supervisor Assignments", icon: UserCheck },
];

// Main config page with tabbed sections for each hierarchy entity type.
function ProgressConfigPage() {
  const [tab, setTab] = useState<Tab>("blocks");

  return (
    <AppShell
      title="Progress Configuration"
      subtitle="Set up blocks, floors, categories, work items, and cell groups"
    >
      <div className="space-y-4">
        {/* Tab bar */}
        <div className="flex flex-wrap gap-2 border-b pb-2">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted"
                }`}
              >
                <Icon className="size-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === "workViews" && <WorkViewsTab />}
        {tab === "blocks" && <BlocksTab />}
        {tab === "floors" && <FloorsTab />}
        {tab === "categories" && <CategoriesTab />}
        {tab === "workItems" && <WorkItemsTab />}
        {tab === "cellGroups" && <CellGroupsTab />}
        {tab === "assignments" && <AssignmentsTab />}
      </div>
    </AppShell>
  );
}

// Tab component for creating and listing top-level construction blocks.
function BlocksTab() {
  const { data: hier } = useQuery({ queryKey: ["hierarchy"], queryFn: () => fetchHierarchy() });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [workCategory, setWorkCategory] = useState("uncategorized");
  const qc = useQueryClient();

  const blocks = hier?.blocks ?? [];

  // Creates a new block via the API and refreshes the hierarchy query.
  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      const result = await createBlock({
        name: name.trim(),
        sort_order: Math.max(0, Math.floor(Number(sortOrder) || 0)),
        work_category: workCategory,
      });
      if (result.success) {
        toast.success("Block created");
        qc.invalidateQueries({ queryKey: ["hierarchy"] });
        setOpen(false);
        setName("");
        setSortOrder("0");
        setWorkCategory("uncategorized");
      } else {
        toast.error(result.error || "Failed");
      }
    } catch (err: any) {
      console.error("createBlock client error:", err);
      toast.error("Failed to create block");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1 size-4" /> Add Block
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {blocks.map((b: any) => (
          <Card key={b.id} className="p-3">
            <p className="font-medium">{b.name}</p>
            <p className="text-xs text-muted-foreground">Sort: {b.sort_order}</p>
            <div className="mt-1">
              <WorkCategoryBadge category={b.work_category} />
            </div>
          </Card>
        ))}
        {blocks.length === 0 && <p className="text-sm text-muted-foreground">No blocks yet.</p>}
      </div>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-sm" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>New Block</DialogTitle>
              <DialogDescription>Add a top-level block (e.g. OT Block)</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="OT Block"
                />
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min={0}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </div>
              <div>
                <Label>Work Category *</Label>
                <WorkCategorySelect
                  value={workCategory}
                  onChange={setWorkCategory}
                  placeholder="Select work category..."
                />
              </div>
              <Button onClick={handleCreate} disabled={!name.trim()} className="w-full">
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Tab component for creating and listing floors within blocks.
function FloorsTab() {
  const { data: hier } = useQuery({ queryKey: ["hierarchy"], queryFn: () => fetchHierarchy() });
  const [open, setOpen] = useState(false);
  const [blockId, setBlockId] = useState("");
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const qc = useQueryClient();

  const blocks = hier?.blocks ?? [];
  const floors = hier?.floors ?? [];
  const blockMap = new Map(blocks.map((b: any) => [b.id, b.name]));

  // Creates a new floor under the selected block via the API.
  const handleCreate = async () => {
    if (!blockId) {
      toast.error("Select a block");
      return;
    }
    if (!name.trim()) {
      toast.error("Enter a name");
      return;
    }
    try {
      const result = await createFloor({
        block_id: blockId,
        name: name.trim(),
        sort_order: Math.max(0, Math.floor(Number(sortOrder) || 0)),
      });
      if (result.success) {
        toast.success("Floor created");
        qc.invalidateQueries({ queryKey: ["hierarchy"] });
        setOpen(false);
        setName("");
        setBlockId("");
        setSortOrder("0");
      } else {
        toast.error(result.error || "Failed");
      }
    } catch (err) {
      toast.error("Failed to create floor");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1 size-4" /> Add Floor
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {floors.map((f: any) => (
          <Card key={f.id} className="p-3">
            <p className="font-medium">{f.name}</p>
            <p className="text-xs text-muted-foreground">
              {blockMap.get(f.block_id) ?? "—"} · Sort: {f.sort_order}
            </p>
          </Card>
        ))}
        {floors.length === 0 && <p className="text-sm text-muted-foreground">No floors yet.</p>}
      </div>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-sm" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>New Floor</DialogTitle>
              <DialogDescription>Add a floor to a block</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Block</Label>
                <Select value={blockId} onValueChange={setBlockId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select block" />
                  </SelectTrigger>
                  <SelectContent>
                    {blocks.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Level 1"
                />
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min={0}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </div>
              <Button onClick={handleCreate} disabled={!name.trim()} className="w-full">
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Tab component for creating and listing work views (top-level grouping for categories).
function WorkViewsTab() {
  const { data: hier } = useQuery({ queryKey: ["hierarchy"], queryFn: () => fetchHierarchy() });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"flat" | "floor" | "block">("flat");
  const [sortOrder, setSortOrder] = useState("0");
  const qc = useQueryClient();

  const workViews = hier?.workViews ?? [];

  const handleCreate = async () => {
    if (!name.trim()) return;
    try {
      const result = await createWorkView({
        name: name.trim(),
        scope,
        sort_order: Math.max(0, Math.floor(Number(sortOrder) || 0)),
      });
      if (result.success) {
        toast.success("Work view created");
        qc.invalidateQueries({ queryKey: ["hierarchy"] });
        setOpen(false);
        setName("");
        setScope("flat");
        setSortOrder("0");
      } else {
        toast.error(result.error || "Failed");
      }
    } catch (err) {
      toast.error("Failed to create work view");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const result = await deleteWorkView({ id });
      if (result.success) {
        toast.success("Work view deleted");
        qc.invalidateQueries({ queryKey: ["hierarchy"] });
      } else {
        toast.error(result.error || "Failed");
      }
    } catch (err) {
      toast.error("Failed to delete work view");
    }
  };

  const scopeLabels = SCOPE_LABELS;

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1 size-4" /> Add Work View
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {workViews.map((wv: any) => (
          <Card key={wv.id} className="p-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium">{wv.name}</p>
                <p className="text-xs text-muted-foreground">
                  Scope: {scopeLabels[wv.scope] ?? wv.scope} · Sort: {wv.sort_order}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => handleDelete(wv.id)}
              >
                Delete
              </Button>
            </div>
          </Card>
        ))}
        {workViews.length === 0 && (
          <p className="text-sm text-muted-foreground">No work views yet.</p>
        )}
      </div>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-sm" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>New Work View</DialogTitle>
              <DialogDescription>Top-level grouping for categories</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="General"
                />
              </div>
              <div>
                <Label>Scope</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as "flat" | "floor" | "block")}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select scope" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="flat">Unit/Room</SelectItem>
                    <SelectItem value="floor">Floor</SelectItem>
                    <SelectItem value="block">Block</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min={0}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </div>
              <Button onClick={handleCreate} disabled={!name.trim()} className="w-full">
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Tab component for creating and listing work categories (e.g. Civil, MEP).
function CategoriesTab() {
  const { data: hier } = useQuery({ queryKey: ["hierarchy"], queryFn: () => fetchHierarchy() });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [selectedWorkViewId, setSelectedWorkViewId] = useState("");
  const qc = useQueryClient();

  const workViews = hier?.workViews ?? [];
  const categories = (hier?.categories ?? []).filter(
    (c: any) => c.work_view_id === selectedWorkViewId,
  );

  const handleCreate = async () => {
    if (!selectedWorkViewId) {
      toast.error("Select a work view");
      return;
    }
    if (!name.trim()) return;
    try {
      const result = await createCategory({
        name: name.trim(),
        work_view_id: selectedWorkViewId,
        sort_order: Math.max(0, Math.floor(Number(sortOrder) || 0)),
      });
      if (result.success) {
        toast.success("Category created");
        qc.invalidateQueries({ queryKey: ["hierarchy"] });
        setOpen(false);
        setName("");
        setSortOrder("0");
      } else {
        toast.error(result.error || "Failed");
      }
    } catch (err) {
      toast.error("Failed to create category");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <Label>Work View</Label>
          <Select
            value={selectedWorkViewId}
            onValueChange={setSelectedWorkViewId}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select work view" />
            </SelectTrigger>
            <SelectContent>
              {workViews.map((wv: any) => (
                <SelectItem key={wv.id} value={wv.id}>
                  {wv.name} ({SCOPE_LABELS[wv.scope] ?? wv.scope})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={() => setOpen(true)}
          disabled={!selectedWorkViewId}
          className="mt-6"
        >
          <Plus className="mr-1 size-4" /> Add Category
        </Button>
      </div>
      {workViews.length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground">
          Create a Work View first before adding categories.
        </Card>
      )}
      {selectedWorkViewId && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c: any) => (
            <Card key={c.id} className="p-3">
              <p className="font-medium">{c.name}</p>
              <p className="text-xs text-muted-foreground">Sort: {c.sort_order}</p>
            </Card>
          ))}
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground">No categories yet in this work view.</p>
          )}
        </div>
      )}

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-sm" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>New Category</DialogTitle>
              <DialogDescription>e.g. Civil, MEP, Finishing</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Civil" />
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min={0}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </div>
              <Button onClick={handleCreate} disabled={!name.trim()} className="w-full">
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Tab component for creating and listing work items under categories.
function WorkItemsTab() {
  const { data: hier } = useQuery({ queryKey: ["hierarchy"], queryFn: () => fetchHierarchy() });
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const qc = useQueryClient();

  const categories = hier?.categories ?? [];
  const workItems = hier?.workItems ?? [];
  const catMap = new Map(categories.map((c: any) => [c.id, c.name]));

  // Creates a new work item under the selected category via the API.
  const handleCreate = async () => {
    if (!categoryId) {
      toast.error("Select a category");
      return;
    }
    if (!name.trim()) {
      toast.error("Enter a name");
      return;
    }
    try {
      const result = await createWorkItem({
        category_id: categoryId,
        name: name.trim(),
        sort_order: Math.max(0, Math.floor(Number(sortOrder) || 0)),
      });
      if (result.success) {
        toast.success("Work item created");
        qc.invalidateQueries({ queryKey: ["hierarchy"] });
        setOpen(false);
        setName("");
        setCategoryId("");
        setSortOrder("0");
      } else {
        toast.error(result.error || "Failed");
      }
    } catch (err) {
      toast.error("Failed to create work item");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1 size-4" /> Add Work Item
        </Button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {workItems.map((w: any) => (
          <Card key={w.id} className="p-3">
            <p className="font-medium">{w.name}</p>
            <p className="text-xs text-muted-foreground">
              {catMap.get(w.category_id) ?? "—"} · Sort: {w.sort_order}
            </p>
          </Card>
        ))}
        {workItems.length === 0 && (
          <p className="text-sm text-muted-foreground">No work items yet.</p>
        )}
      </div>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-sm" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>New Work Item</DialogTitle>
              <DialogDescription>e.g. Slab Reinforcement, Tile Flooring</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Category</Label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Slab Reinforcement"
                />
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min={0}
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                />
              </div>
              <Button onClick={handleCreate} disabled={!name.trim()} className="w-full">
                Create
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Tab component for creating cell groups that auto-generate individual tracking cells.
function CellGroupsTab() {
  const { data: hier } = useQuery({ queryKey: ["hierarchy"], queryFn: () => fetchHierarchy() });
  const [open, setOpen] = useState(false);
  const [blockId, setBlockId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [workItemId, setWorkItemId] = useState("");
  const [cellCount, setCellCount] = useState(12);
  const [unitNumbersText, setUnitNumbersText] = useState("");
  const qc = useQueryClient();

  const blocks = hier?.blocks ?? [];
  const floors = (hier?.floors ?? []).filter((f: any) => f.block_id === blockId);
  const categories = hier?.categories ?? [];
  const workViews = hier?.workViews ?? [];
  const workItems = (hier?.workItems ?? []).filter((w: any) =>
    categories.some((c: any) => c.id === w.category_id),
  );

  const catMap = new Map(categories.map((c: any) => [c.id, c]));
  const workViewMap = new Map(workViews.map((wv: any) => [wv.id, wv]));
  const selectedWorkItem = workItems.find((w: any) => w.id === workItemId);
  const selectedCat = selectedWorkItem ? catMap.get(selectedWorkItem.category_id) : null;
  const selectedWorkView = selectedCat ? workViewMap.get(selectedCat.work_view_id) : null;
  const isFlatScope = selectedWorkView?.scope === "flat";

  // Creates a new cell group with the specified cell count via the API.
  const handleCreate = async () => {
    if (!blockId || !floorId || !workItemId) {
      toast.error("Select all fields");
      return;
    }
    const count = Math.max(1, Math.floor(cellCount));
    let unit_numbers: string[] | undefined;
    if (isFlatScope && unitNumbersText.trim()) {
      unit_numbers = unitNumbersText
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (unit_numbers.length !== count) {
        toast.error(`Expected ${count} unit numbers, got ${unit_numbers.length}`);
        return;
      }
    }
    try {
      const result = await createCellGroup({
        block_id: blockId,
        floor_id: floorId,
        work_item_id: workItemId,
        cell_count: count,
        ...(unit_numbers ? { unit_numbers } : {}),
      });
      if (result.success) {
        toast.success(`Cell group created with ${count} cells`);
        setOpen(false);
        setBlockId("");
        setFloorId("");
        setWorkItemId("");
        setCellCount(12);
        setUnitNumbersText("");
      } else {
        toast.error(result.error || "Failed");
      }
    } catch (err) {
      toast.error("Failed to create cell group");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1 size-4" /> Add Cell Group
        </Button>
      </div>
      <Card className="p-4 text-sm text-muted-foreground">
        <Settings2 className="mb-2 size-5" />
        Cell groups define a Block + Floor + Work Item combination with a number of cells. Creating
        a group auto-generates individual cell rows (1 to N).
      </Card>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>New Cell Group</DialogTitle>
              <DialogDescription>Auto-generates cells for tracking</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Block</Label>
                <Select
                  value={blockId}
                  onValueChange={(v) => {
                    setBlockId(v);
                    setFloorId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select block" />
                  </SelectTrigger>
                  <SelectContent>
                    {blocks.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Floor</Label>
                <Select value={floorId} onValueChange={setFloorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select floor" />
                  </SelectTrigger>
                  <SelectContent>
                    {floors.map((f: any) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Work Item</Label>
                <Select value={workItemId} onValueChange={setWorkItemId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select work item" />
                  </SelectTrigger>
                  <SelectContent>
                    {workItems.map((w: any) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Number of Cells</Label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={cellCount}
                  onChange={(e) => setCellCount(Number(e.target.value))}
                />
              </div>
              {isFlatScope && (
                <div>
                  <Label>Unit/Room Numbers (optional)</Label>
                  <Textarea
                    value={unitNumbersText}
                    onChange={(e) => setUnitNumbersText(e.target.value)}
                    placeholder="One per line or comma-separated, e.g.&#10;Unit 101&#10;Unit 102&#10;Unit 103"
                    rows={4}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Leave blank to auto-number as Unit 1, Unit 2, …
                  </p>
                </div>
              )}
              <Button onClick={handleCreate} className="w-full">
                Create Cell Group
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// Tab component for assigning supervisors to blocks or specific floors.
function AssignmentsTab() {
  const { data: hier } = useQuery({ queryKey: ["hierarchy"], queryFn: () => fetchHierarchy() });
  const { data: supData } = useQuery({
    queryKey: ["supervisors"],
    queryFn: () => fetchSupervisors(),
  });
  const [open, setOpen] = useState(false);
  const [supervisorId, setSupervisorId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [floorId, setFloorId] = useState("all");
  const qc = useQueryClient();

  const blocks = hier?.blocks ?? [];
  const floors = (hier?.floors ?? []).filter((f: any) => f.block_id === blockId);
  const supervisors = supData?.data ?? [];

  // Assigns the selected supervisor to a block (and optional floor) via the API.
  const handleAssign = async () => {
    if (!supervisorId || !blockId) {
      toast.error("Select supervisor and block");
      return;
    }
    try {
      const result = await assignSupervisor({
        supervisor_id: supervisorId,
        block_id: blockId,
        floor_id: floorId === "all" ? null : floorId,
      });
      if (result.success) {
        toast.success("Supervisor assigned");
        setOpen(false);
        setSupervisorId("");
        setBlockId("");
        setFloorId("all");
      } else {
        toast.error(result.error || "Failed");
      }
    } catch (err) {
      toast.error("Failed to assign supervisor");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1 size-4" /> Assign Supervisor
        </Button>
      </div>
      <Card className="p-4 text-sm text-muted-foreground">
        <UserCheck className="mb-2 size-5" />
        Assign supervisors to blocks (optionally limited to a specific floor). A supervisor can only
        update cells in blocks/floors they're assigned to.
      </Card>

      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent className="max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
            <DialogHeader>
              <DialogTitle>Assign Supervisor</DialogTitle>
              <DialogDescription>Choose who can update cells in a block/floor</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Supervisor</Label>
                <Select value={supervisorId} onValueChange={setSupervisorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select supervisor" />
                  </SelectTrigger>
                  <SelectContent>
                    {supervisors.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Block</Label>
                <Select
                  value={blockId}
                  onValueChange={(v) => {
                    setBlockId(v);
                    setFloorId("all");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select block" />
                  </SelectTrigger>
                  <SelectContent>
                    {blocks.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Floor (optional — leave as "All" for whole block)</Label>
                <Select value={floorId} onValueChange={setFloorId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Floors (whole block)</SelectItem>
                    {floors.map((f: any) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleAssign} className="w-full">
                Assign
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
