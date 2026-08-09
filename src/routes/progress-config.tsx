// Progress configuration page — hierarchical setup: Venture → Block → Floor → Category → Work Description.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
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
import { authStore } from "@/lib/auth-store";
import type { Role } from "@/lib/erp-data";
import {
  fetchHierarchy,
  fetchSupervisors,
  createBlock,
  updateBlock,
  createFloor,
  updateFloor,
  createCategory,
  updateCategory,
  createWorkItem,
  updateWorkItem,
  createCellGroup,
  assignSupervisor,
  createWorkView,
  updateWorkView,
} from "@/lib/api/progress-tracking";
import { toast } from "sonner";
import { Plus, Save, UserCheck, ArrowUp, ArrowDown, Building2, Layers, Eye, Tag } from "lucide-react";

const ADMIN_ROLES: Role[] = ["Administrator", "A1", "A1+"];

export const Route = createFileRoute("/progress-config")({
  head: () => ({
    meta: [{ title: "Progress Configuration — Meditrust ERP" }],
  }),
  beforeLoad: async () => {
    await requireAuth();
    if (typeof window !== "undefined") {
      const role = authStore.getState().role;
      if (!role || !ADMIN_ROLES.includes(role)) {
        throw redirect({ to: "/portal" });
      }
    }
  },
  component: ProgressConfigPage,
});

const SCOPE_LABELS: Record<string, string> = {
  flat: "Unit/Room",
  floor: "Floor",
  block: "Block",
};

function ProgressConfigPage() {
  return (
    <AppShell
      title="Progress Configuration"
      subtitle="Set up the hierarchy that drives the Progress Dashboard"
    >
      <div className="space-y-6">
        <HierarchicalConfig />
        <SupervisorAssignments />
      </div>
    </AppShell>
  );
}

// Main hierarchical configuration: Venture → Block → Floor → Category → Work Description.
function HierarchicalConfig() {
  const { data: hier, isLoading } = useQuery({ queryKey: ["hierarchy"], queryFn: () => fetchHierarchy() });
  const qc = useQueryClient();

  const workViews = hier?.workViews ?? [];
  const blocks = hier?.blocks ?? [];
  const floors = hier?.floors ?? [];
  const categories = hier?.categories ?? [];
  const workItems = hier?.workItems ?? [];

  const [selectedVentureId, setSelectedVentureId] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [selectedFloorId, setSelectedFloorId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");

  // Reset dependent selections when parents change.
  useEffect(() => { setSelectedBlockId(""); setSelectedFloorId(""); }, [selectedVentureId]);
  useEffect(() => { setSelectedFloorId(""); }, [selectedBlockId]);

  const selectedFloor = floors.find((f: any) => f.id === selectedFloorId);

  const ventureBlocks = useMemo(
    () => blocks.filter((b: any) => b.work_view_id === selectedVentureId).sort((a: any, b: any) => a.sort_order - b.sort_order),
    [blocks, selectedVentureId],
  );
  const blockFloors = useMemo(
    () => floors.filter((f: any) => f.block_id === selectedBlockId).sort((a: any, b: any) => a.sort_order - b.sort_order),
    [floors, selectedBlockId],
  );
  const ventureCategories = useMemo(
    () => categories.filter((c: any) => c.work_view_id === selectedVentureId).sort((a: any, b: any) => a.sort_order - b.sort_order),
    [categories, selectedVentureId],
  );
  const categoryItems = useMemo<{ id: string; name: string; category_id: string; sort_order: number }[]>(
    () => workItems.filter((w: any) => w.category_id === selectedCategoryId).sort((a: any, b: any) => a.sort_order - b.sort_order),
    [workItems, selectedCategoryId],
  );

  // Floor unit count management.
  const [floorUnitCount, setFloorUnitCount] = useState<string>("");
  useEffect(() => {
    if (selectedFloor) {
      setFloorUnitCount(String(selectedFloor.default_cell_count ?? 1));
    } else {
      setFloorUnitCount("");
    }
  }, [selectedFloor]);

  async function saveFloorUnitCount() {
    if (!selectedFloorId) return;
    const count = Math.max(1, Math.min(500, Math.floor(Number(floorUnitCount) || 1)));
    const result = await updateFloor({ id: selectedFloorId, default_cell_count: count });
    if (result.success) {
      toast.success("Unit count saved");
      qc.invalidateQueries({ queryKey: ["hierarchy"] });
    } else {
      toast.error(result.error || "Failed to save unit count");
    }
  }

  // Add dialogs.
  const [addVentureOpen, setAddVentureOpen] = useState(false);
  const [addBlockOpen, setAddBlockOpen] = useState(false);
  const [addFloorOpen, setAddFloorOpen] = useState(false);
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addWorkItemOpen, setAddWorkItemOpen] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Edit dialog.
  const [editItem, setEditItem] = useState<{ type: "venture" | "block" | "floor" | "category" | "workItem"; id: string; name: string } | null>(null);

  async function handleRename() {
    if (!editItem || !editItem.name.trim()) return;
    let result;
    switch (editItem.type) {
      case "venture":
        result = await updateWorkView({ id: editItem.id, name: editItem.name.trim() });
        break;
      case "block":
        result = await updateBlock({ id: editItem.id, name: editItem.name.trim() });
        break;
      case "floor":
        result = await updateFloor({ id: editItem.id, name: editItem.name.trim() });
        break;
      case "category":
        result = await updateCategory({ id: editItem.id, name: editItem.name.trim() });
        break;
      case "workItem":
        result = await updateWorkItem({ id: editItem.id, name: editItem.name.trim() });
        break;
    }
    if (result?.success) {
      toast.success("Renamed");
      qc.invalidateQueries({ queryKey: ["hierarchy"] });
      setEditItem(null);
    } else {
      toast.error(result?.error || "Failed to rename");
    }
  }

  async function handleAddWorkItem(name: string) {
    if (!selectedCategoryId) return;
    const sortOrder = categoryItems.length;
    const wiResult = await createWorkItem({ category_id: selectedCategoryId, name: name.trim(), sort_order: sortOrder });
    if (!wiResult.success || !wiResult.data) {
      toast.error(wiResult.error || "Failed to create work description");
      return;
    }
    // Auto-create cell groups for every block/floor that has a default_cell_count so the dashboard shows data.
    if (selectedVentureId && selectedBlockId && selectedFloorId && selectedFloor) {
      const count = selectedFloor.default_cell_count ?? 1;
      const cgResult = await createCellGroup({
        block_id: selectedBlockId,
        floor_id: selectedFloorId,
        work_item_id: wiResult.data.id,
        cell_count: count,
      });
      if (!cgResult.success) {
        toast.error(cgResult.error || "Failed to create cells for this work description");
        return;
      }
    }
    toast.success("Work description added");
    qc.invalidateQueries({ queryKey: ["hierarchy"] });
    qc.invalidateQueries({ queryKey: ["progressDashboard"] });
    setAddWorkItemOpen(false);
  }

  async function generateCellsForCategory() {
    if (!selectedBlockId || !selectedFloorId || !selectedCategoryId || !selectedFloor) return;
    if (categoryItems.length === 0) return;
    setGenerating(true);
    let created = 0;
    let skipped = 0;
    const count = selectedFloor.default_cell_count ?? 1;
    for (const wi of categoryItems) {
      const result = await createCellGroup({
        block_id: selectedBlockId,
        floor_id: selectedFloorId,
        work_item_id: wi.id,
        cell_count: count,
      });
      if (result.success) {
        created++;
      } else if (result.error?.includes("already exists")) {
        skipped++;
      } else {
        toast.error(result.error || "Failed to generate cells");
        break;
      }
    }
    setGenerating(false);
    qc.invalidateQueries({ queryKey: ["progressDashboard"] });
    if (created > 0) toast.success(`Generated cells for ${created} work description(s)`);
    if (skipped > 0) toast.info(`${skipped} already had cells`);
    if (created === 0 && skipped === 0) toast.error("No cells were generated");
  }

  async function moveWorkItem(id: string, direction: "up" | "down") {
    const idx = categoryItems.findIndex((w: any) => w.id === id);
    if (idx < 0) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= categoryItems.length) return;
    const target = categoryItems[idx]!;
    const swap = categoryItems[swapIdx]!;
    const r1 = await updateWorkItem({ id: target.id, sort_order: swap.sort_order });
    const r2 = await updateWorkItem({ id: swap.id, sort_order: target.sort_order });
    if (r1.success && r2.success) {
      qc.invalidateQueries({ queryKey: ["hierarchy"] });
    } else {
      toast.error("Failed to reorder");
    }
  }

  if (isLoading) {
    return <Card className="p-8 text-center text-muted-foreground">Loading configuration...</Card>;
  }

  return (
    <div className="space-y-6">
      {/* Step 1: Venture */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">1. Venture</h2>
          <Button size="sm" variant="outline" onClick={() => setAddVentureOpen(true)}><Plus className="mr-1 size-4" /> Add Venture</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {workViews.map((v: any) => (
            <button
              key={v.id}
              onClick={() => setSelectedVentureId(v.id)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border ${selectedVentureId === v.id ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
            >
              <Building2 className="size-4" />
              <span>{v.name}</span>
              <span className="text-xs opacity-80">({SCOPE_LABELS[v.scope] ?? v.scope})</span>
              <span onClick={(e) => { e.stopPropagation(); setEditItem({ type: "venture", id: v.id, name: v.name }); }} className="ml-1 opacity-50 hover:opacity-100">✎</span>
            </button>
          ))}
          {workViews.length === 0 && <p className="text-sm text-muted-foreground">No ventures yet. Create one to start.</p>}
        </div>
      </section>

      {/* Step 2: Block */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">2. Block</h2>
          <Button size="sm" variant="outline" disabled={!selectedVentureId} onClick={() => setAddBlockOpen(true)}><Plus className="mr-1 size-4" /> Add Block</Button>
        </div>
        {!selectedVentureId ? (
          <p className="text-sm text-muted-foreground">Select a venture first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {ventureBlocks.map((b: any) => (
              <button
                key={b.id}
                onClick={() => setSelectedBlockId(b.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border ${selectedBlockId === b.id ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
              >
                <Layers className="size-4" />
                <span>{b.name}</span>
                <span onClick={(e) => { e.stopPropagation(); setEditItem({ type: "block", id: b.id, name: b.name }); }} className="ml-1 opacity-50 hover:opacity-100">✎</span>
              </button>
            ))}
            {ventureBlocks.length === 0 && <p className="text-sm text-muted-foreground">No blocks for this venture yet.</p>}
          </div>
        )}
      </section>

      {/* Step 3: Floor + Unit Count */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">3. Floor & Units</h2>
          <Button size="sm" variant="outline" disabled={!selectedBlockId} onClick={() => setAddFloorOpen(true)}><Plus className="mr-1 size-4" /> Add Floor</Button>
        </div>
        {!selectedBlockId ? (
          <p className="text-sm text-muted-foreground">Select a block first.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-wrap gap-2">
              {blockFloors.map((f: any) => (
                <button
                  key={f.id}
                  onClick={() => setSelectedFloorId(f.id)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border ${selectedFloorId === f.id ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
                >
                  <Eye className="size-4" />
                  <span>{f.name}</span>
                  <span onClick={(e) => { e.stopPropagation(); setEditItem({ type: "floor", id: f.id, name: f.name }); }} className="ml-1 opacity-50 hover:opacity-100">✎</span>
                </button>
              ))}
              {blockFloors.length === 0 && <p className="text-sm text-muted-foreground">No floors for this block yet.</p>}
            </div>
            {selectedFloor && (
              <Card className="p-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[12rem]">
                  <Label className="text-xs">Flat/Unit count for {selectedFloor.name}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={floorUnitCount}
                    onChange={(e) => setFloorUnitCount(e.target.value)}
                    placeholder="Number of units"
                  />
                </div>
                <Button size="sm" onClick={saveFloorUnitCount}><Save className="mr-1 size-4" /> Save Units</Button>
              </Card>
            )}
          </div>
        )}
      </section>

      {/* Step 4: Category */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">4. Category</h2>
          <Button size="sm" variant="outline" disabled={!selectedVentureId} onClick={() => setAddCategoryOpen(true)}><Plus className="mr-1 size-4" /> Add Category</Button>
        </div>
        {!selectedVentureId ? (
          <p className="text-sm text-muted-foreground">Select a venture first.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {ventureCategories.map((c: any) => (
              <button
                key={c.id}
                onClick={() => setSelectedCategoryId(c.id)}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium border ${selectedCategoryId === c.id ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted"}`}
              >
                <Tag className="size-4" />
                <span>{c.name}</span>
                <span onClick={(e) => { e.stopPropagation(); setEditItem({ type: "category", id: c.id, name: c.name }); }} className="ml-1 opacity-50 hover:opacity-100">✎</span>
              </button>
            ))}
            {ventureCategories.length === 0 && <p className="text-sm text-muted-foreground">No categories for this venture yet.</p>}
          </div>
        )}
      </section>

      {/* Step 5: Work Descriptions */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">5. Work Descriptions</h2>
          <Button size="sm" variant="outline" disabled={!selectedCategoryId} onClick={() => setAddWorkItemOpen(true)}><Plus className="mr-1 size-4" /> Add Work Description</Button>
        </div>
        {!selectedCategoryId ? (
          <p className="text-sm text-muted-foreground">Select a category first.</p>
        ) : categoryItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No work descriptions for this category yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {categoryItems.map((w: any, idx: number) => (
              <Card key={w.id} className="p-3 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{idx + 1}. {w.name}</p>
                  <p className="text-xs text-muted-foreground">Sort: {w.sort_order}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => moveWorkItem(w.id, "up")} disabled={idx === 0}><ArrowUp className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => moveWorkItem(w.id, "down")} disabled={idx === categoryItems.length - 1}><ArrowDown className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-7" onClick={() => setEditItem({ type: "workItem", id: w.id, name: w.name })}>✎</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
        {selectedCategoryId && selectedBlockId && selectedFloorId && selectedFloor && (
          <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
            <div className="flex-1 text-sm">
              <span className="font-medium">Generate tracking cells:</span> create {categoryItems.length} work item(s) × {selectedFloor.default_cell_count ?? 1} unit(s) for {selectedFloor.name}.
            </div>
            <Button size="sm" onClick={generateCellsForCategory} disabled={categoryItems.length === 0 || generating}>
              {generating ? "Generating..." : "Generate Cells"}
            </Button>
          </div>
        )}
      </section>

      {addVentureOpen && (
        <AddVentureDialog open={addVentureOpen} onClose={() => setAddVentureOpen(false)} onCreated={(id) => setSelectedVentureId(id)} />
      )}
      {addBlockOpen && selectedVentureId && (
        <AddBlockDialog open={addBlockOpen} onClose={() => setAddBlockOpen(false)} ventureId={selectedVentureId} />
      )}
      {addFloorOpen && selectedBlockId && (
        <AddFloorDialog open={addFloorOpen} onClose={() => setAddFloorOpen(false)} blockId={selectedBlockId} />
      )}
      {addCategoryOpen && selectedVentureId && (
        <AddCategoryDialog open={addCategoryOpen} onClose={() => setAddCategoryOpen(false)} ventureId={selectedVentureId} />
      )}
      {addWorkItemOpen && selectedCategoryId && (
        <AddWorkItemDialog open={addWorkItemOpen} onClose={() => setAddWorkItemOpen(false)} onAdd={handleAddWorkItem} />
      )}
      {editItem && (
        <Dialog open onOpenChange={() => setEditItem(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Rename {editItem.type === "workItem" ? "Work Description" : editItem.type}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input value={editItem.name} onChange={(e) => setEditItem({ ...editItem, name: e.target.value })} />
              <div className="flex gap-2">
                <Button className="flex-1" onClick={handleRename}>Save</Button>
                <Button variant="outline" className="flex-1" onClick={() => setEditItem(null)}>Cancel</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AddVentureDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"flat" | "floor" | "block">("flat");
  const qc = useQueryClient();

  async function handleCreate() {
    if (!name.trim()) return;
    const result = await createWorkView({ name: name.trim(), scope, sort_order: 0 });
    if (result.success && result.data) {
      toast.success("Venture created");
      qc.invalidateQueries({ queryKey: ["hierarchy"] });
      onCreated(result.data.id);
      onClose();
    } else {
      toast.error(result.error || "Failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Venture</DialogTitle>
          <DialogDescription>Ventures are the top-level grouping for progress categories.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Hospital" />
          </div>
          <div>
            <Label>Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Unit/Room</SelectItem>
                <SelectItem value="floor">Floor</SelectItem>
                <SelectItem value="block">Block</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={!name.trim()}>Create Venture</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddBlockDialog({ open, onClose, ventureId }: { open: boolean; onClose: () => void; ventureId: string }) {
  const [name, setName] = useState("");
  const qc = useQueryClient();

  async function handleCreate() {
    if (!name.trim()) return;
    const result = await createBlock({ name: name.trim(), sort_order: 0, work_view_id: ventureId });
    if (result.success) {
      toast.success("Block created");
      qc.invalidateQueries({ queryKey: ["hierarchy"] });
      onClose();
    } else {
      toast.error(result.error || "Failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Block</DialogTitle>
          <DialogDescription>Create a new block under the selected venture.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. OT Block" />
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={!name.trim()}>Create Block</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddFloorDialog({ open, onClose, blockId }: { open: boolean; onClose: () => void; blockId: string }) {
  const [name, setName] = useState("");
  const [unitCount, setUnitCount] = useState("1");
  const qc = useQueryClient();

  async function handleCreate() {
    if (!name.trim()) return;
    const count = Math.max(1, Math.min(500, Math.floor(Number(unitCount) || 1)));
    const result = await createFloor({ block_id: blockId, name: name.trim(), sort_order: 0, default_cell_count: count });
    if (result.success) {
      toast.success("Floor created");
      qc.invalidateQueries({ queryKey: ["hierarchy"] });
      onClose();
    } else {
      toast.error(result.error || "Failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Floor</DialogTitle>
          <DialogDescription>Create a new floor under the selected block.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Level 1" />
          </div>
          <div>
            <Label>Default Unit Count</Label>
            <Input type="number" min={1} max={500} value={unitCount} onChange={(e) => setUnitCount(e.target.value)} />
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={!name.trim()}>Create Floor</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddCategoryDialog({ open, onClose, ventureId }: { open: boolean; onClose: () => void; ventureId: string }) {
  const [name, setName] = useState("");
  const qc = useQueryClient();

  async function handleCreate() {
    if (!name.trim()) return;
    const result = await createCategory({ name: name.trim(), work_view_id: ventureId, sort_order: 0 });
    if (result.success) {
      toast.success("Category created");
      qc.invalidateQueries({ queryKey: ["hierarchy"] });
      onClose();
    } else {
      toast.error(result.error || "Failed");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Category</DialogTitle>
          <DialogDescription>Create a category under the selected venture.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Civil" />
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={!name.trim()}>Create Category</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddWorkItemDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");

  async function handleCreate() {
    if (!name.trim()) return;
    onAdd(name.trim());
    setName("");
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Work Description</DialogTitle>
          <DialogDescription>Add a work item under the selected category.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Slab Reinforcement" />
          </div>
          <Button className="w-full" onClick={handleCreate} disabled={!name.trim()}>Add Work Description</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Supervisor assignments section (kept from original design, but accessible to admin only).
function SupervisorAssignments() {
  const { data: hier } = useQuery({ queryKey: ["hierarchy"], queryFn: () => fetchHierarchy() });
  const { data: supData } = useQuery({ queryKey: ["supervisors"], queryFn: () => fetchSupervisors() });
  const [open, setOpen] = useState(false);
  const [supervisorId, setSupervisorId] = useState("");
  const [blockId, setBlockId] = useState("");
  const [floorId, setFloorId] = useState("all");
  const qc = useQueryClient();

  const blocks = hier?.blocks ?? [];
  const floors = (hier?.floors ?? []).filter((f: any) => f.block_id === blockId);
  const supervisors = supData?.data ?? [];

  async function handleAssign() {
    if (!supervisorId || !blockId) {
      toast.error("Select supervisor and block");
      return;
    }
    const result = await assignSupervisor({ supervisor_id: supervisorId, block_id: blockId, floor_id: floorId === "all" ? null : floorId });
    if (result.success) {
      toast.success("Supervisor assigned");
      setOpen(false);
      setSupervisorId("");
      setBlockId("");
      setFloorId("all");
    } else {
      toast.error(result.error || "Failed");
    }
  }

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Supervisor Assignments</h2>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><UserCheck className="mr-1 size-4" /> Assign</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Assign supervisors to blocks (optionally limited to a floor). Supervisors can only update cells in their assigned areas.
      </p>
      {open && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Assign Supervisor</DialogTitle>
              <DialogDescription>Choose who can update cells in a block/floor</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Supervisor</Label>
                <Select value={supervisorId} onValueChange={setSupervisorId}>
                  <SelectTrigger><SelectValue placeholder="Select supervisor" /></SelectTrigger>
                  <SelectContent>
                    {supervisors.map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Block</Label>
                <Select value={blockId} onValueChange={(v) => { setBlockId(v); setFloorId("all"); }}>
                  <SelectTrigger><SelectValue placeholder="Select block" /></SelectTrigger>
                  <SelectContent>
                    {blocks.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Floor (optional — leave as All for whole block)</Label>
                <Select value={floorId} onValueChange={setFloorId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Floors</SelectItem>
                    {floors.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={handleAssign}>Assign</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}
