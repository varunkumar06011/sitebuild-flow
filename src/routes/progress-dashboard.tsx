// Progress dashboard page — redesigned around Venture → Block → Floor → Flat/Unit → Category → Work Description.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
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
  fetchProgressDashboard,
  fetchCellHistory,
  fetchHierarchy,
  updateCell,
} from "@/lib/api/progress-tracking";
import { getSignedUrl } from "@/lib/api/storage";
import { supabase } from "@/lib/supabase";
import { useRole } from "@/lib/role-context";
import { PROGRESS_STATUS_KEYS, getStatusInfo, statusLabel } from "@/lib/progress-status";
import { toast } from "sonner";
import { Camera, History, ChevronLeft, ChevronRight, ArrowLeft, X } from "lucide-react";
import type { ProgressStatusKey } from "@/lib/progress-status";

export const Route = createFileRoute("/progress-dashboard")({
  head: () => ({
    meta: [{ title: "Progress Dashboard — Meditrust ERP" }],
  }),
  beforeLoad: () => {
    requireAuth();
  },
  component: ProgressDashboardPage,
});

const STATUS_KEYS: ProgressStatusKey[] = PROGRESS_STATUS_KEYS;

function ProgressDashboardPage() {
  const { role } = useRole();
  const isAdmin = role === "Administrator" || role === "A1" || role === "A1+";

  const { data: hier } = useQuery({ queryKey: ["hierarchy"], queryFn: fetchHierarchy });
  const queryClient = useQueryClient();

  const workViews = hier?.workViews ?? [];
  const blocks = hier?.blocks ?? [];
  const floors = hier?.floors ?? [];
  const categories = hier?.categories ?? [];
  const workItems = hier?.workItems ?? [];

  const [selectedVentureId, setSelectedVentureId] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState("");
  const [selectedFloorId, setSelectedFloorId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<ProgressStatusKey>("not_started");
  const [selectedCellIds, setSelectedCellIds] = useState<Set<string>>(new Set());
  const [historyCell, setHistoryCell] = useState<any | null>(null);
  const [editCell, setEditCell] = useState<any | null>(null);
  const [mobileUnitIndex, setMobileUnitIndex] = useState(0);

  // Default to first venture.
  useEffect(() => {
    if (workViews.length > 0 && !selectedVentureId) {
      setSelectedVentureId(workViews[0].id);
    }
  }, [workViews, selectedVentureId]);

  // When venture changes, reset dependent selections.
  useEffect(() => {
    setSelectedBlockId("");
    setSelectedFloorId("");
    setSelectedCategoryId("all");
    setMobileUnitIndex(0);
  }, [selectedVentureId]);

  // When block changes, reset floor.
  useEffect(() => {
    setSelectedFloorId("");
    setMobileUnitIndex(0);
  }, [selectedBlockId]);

  // When floor changes, reset unit index.
  useEffect(() => {
    setMobileUnitIndex(0);
  }, [selectedFloorId]);

  // Reset bulk mode when filters change.
  useEffect(() => {
    setBulkMode(false);
    setSelectedCellIds(new Set());
  }, [selectedVentureId, selectedBlockId, selectedFloorId, selectedCategoryId]);

  // Fetch dashboard cells for the selected venture.
  const { data: dashData } = useQuery({
    queryKey: ["progressDashboard", selectedVentureId],
    queryFn: () => fetchProgressDashboard(selectedVentureId || undefined),
    enabled: !!selectedVentureId,
  });
  const allCells = dashData?.cells ?? [];

  // Realtime updates.
  useEffect(() => {
    const channel = supabase
      .channel("progress-dashboard-cells")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "progress_cells" },
        () => queryClient.invalidateQueries({ queryKey: ["progressDashboard"] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Filter cells for the selected block + floor.
  const floorCells = useMemo(() => {
    return allCells.filter((c: any) => {
      if (selectedBlockId && c.block_id !== selectedBlockId) return false;
      if (selectedFloorId && c.floor_id !== selectedFloorId) return false;
      return true;
    });
  }, [allCells, selectedBlockId, selectedFloorId]);

  // Available blocks for this venture (those that have cells in this venture).
  const availableBlocks = useMemo(() => {
    const blockIds = new Set(allCells.map((c: any) => c.block_id));
    return blocks.filter((b: any) => blockIds.has(b.id)).sort((a: any, b: any) => a.sort_order - b.sort_order);
  }, [allCells, blocks]);

  // Available floors for selected block.
  const availableFloors = useMemo(() => {
    if (!selectedBlockId) return [];
    const floorIds = new Set(allCells.filter((c: any) => c.block_id === selectedBlockId).map((c: any) => c.floor_id));
    return floors.filter((f: any) => f.block_id === selectedBlockId && floorIds.has(f.id)).sort((a: any, b: any) => a.sort_order - b.sort_order);
  }, [allCells, floors, selectedBlockId]);

  // Units for the selected floor.
  const units = useMemo(() => {
    const unitMap = new Map<string, { id: string; label: string; cellId: string; blockId: string; floorId: string }>();
    for (const c of floorCells) {
      const label = c.unit_number ?? `Unit ${c.cell_number}`;
      if (!unitMap.has(label)) {
        unitMap.set(label, { id: label, label, cellId: c.id, blockId: c.block_id, floorId: c.floor_id });
      }
    }
    return Array.from(unitMap.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [floorCells]);

  // Categories for selected venture.
  const ventureCategories = useMemo(
    () => categories.filter((c: any) => c.work_view_id === selectedVentureId).sort((a: any, b: any) => a.sort_order - b.sort_order),
    [categories, selectedVentureId],
  );

  // Work items for the selected venture + optional category.
  const visibleWorkItems = useMemo(() => {
    const catIds = new Set(ventureCategories.map((c: any) => c.id));
    return workItems
      .filter((w: any) => catIds.has(w.category_id))
      .filter((w: any) => selectedCategoryId === "all" || w.category_id === selectedCategoryId)
      .sort((a: any, b: any) => a.sort_order - b.sort_order);
  }, [workItems, ventureCategories, selectedCategoryId]);

  // Build matrix: for each work item, map unit label → cell.
  const matrix = useMemo(() => {
    const cellByWorkItemAndUnit = new Map<string, any>();
    for (const c of floorCells) {
      const unitLabel = c.unit_number ?? `Unit ${c.cell_number}`;
      const key = `${c.work_item_id}|${unitLabel}`;
      cellByWorkItemAndUnit.set(key, c);
    }
    return visibleWorkItems.map((wi: any) => {
      const cat = ventureCategories.find((c: any) => c.id === wi.category_id);
      return {
        workItem: wi,
        category: cat,
        cells: units.map((u) => cellByWorkItemAndUnit.get(`${wi.id}|${u.label}`) ?? null),
      };
    });
  }, [floorCells, visibleWorkItems, units, ventureCategories]);

  // Category progress percentages.
  const categoryProgress = useMemo(() => {
    const result = new Map<string, { total: number; completed: number }>();
    for (const row of matrix) {
      const catId = row.category?.id ?? "none";
      if (!result.has(catId)) result.set(catId, { total: 0, completed: 0 });
      const agg = result.get(catId)!;
      for (const cell of row.cells) {
        if (cell) {
          agg.total++;
          if (cell.status === "completed") agg.completed++;
        }
      }
    }
    return result;
  }, [matrix]);

  function getCategoryProgressPct(catId: string) {
    const agg = categoryProgress.get(catId);
    if (!agg || agg.total === 0) return 0;
    return Math.round((agg.completed / agg.total) * 100);
  }

  // Overall block/floor progress.
  const overallProgress = useMemo(() => {
    const total = floorCells.length;
    const completed = floorCells.filter((c: any) => c.status === "completed").length;
    return total === 0 ? 0 : Math.round((completed / total) * 100);
  }, [floorCells]);

  // Bulk save.
  async function handleBulkSave() {
    if (selectedCellIds.size === 0) {
      toast.error("Select at least one cell");
      return;
    }
    const pct = bulkStatus === "completed" ? 100 : bulkStatus === "not_started" ? 0 : 50;
    try {
      await Promise.all(
        Array.from(selectedCellIds).map((cellId) =>
          updateCell({ cell_id: cellId, status: bulkStatus, completion_pct: pct, remarks: null }),
        ),
      );
      toast.success(`Updated ${selectedCellIds.size} cells`);
      queryClient.invalidateQueries({ queryKey: ["progressDashboard"] });
      setSelectedCellIds(new Set());
      setBulkMode(false);
    } catch (err) {
      toast.error("Bulk update failed");
    }
  }

  function toggleCellSelection(cellId: string) {
    const next = new Set(selectedCellIds);
    if (next.has(cellId)) next.delete(cellId);
    else next.add(cellId);
    setSelectedCellIds(next);
  }

  const selectedUnit = units[mobileUnitIndex];

  return (
    <AppShell title="Progress Dashboard" subtitle="Track construction progress by venture, block, floor and unit">
      <div className="space-y-4">
        {/* Hierarchy selectors */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selectedVentureId} onValueChange={setSelectedVentureId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Select Venture" />
            </SelectTrigger>
            <SelectContent>
              {workViews.map((wv: any) => (
                <SelectItem key={wv.id} value={wv.id}>
                  {wv.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedBlockId} onValueChange={setSelectedBlockId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Select Block" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Blocks</SelectItem>
              {availableBlocks.map((b: any) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedFloorId} onValueChange={setSelectedFloorId}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Select Floor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Floors</SelectItem>
              {availableFloors.map((f: any) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="ml-auto flex items-center gap-2">
            {bulkMode ? (
              <>
                <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as ProgressStatusKey)}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {statusLabel(k)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleBulkSave}>
                  Save ({selectedCellIds.size})
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setBulkMode(false); setSelectedCellIds(new Set()); }}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setBulkMode(true)}>
                Bulk Select
              </Button>
            )}
          </div>
        </div>

        {/* Overall progress */}
        {selectedBlockId && selectedFloorId && (
          <Card className="p-3 flex items-center gap-4">
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">Overall Progress</span>
                <span>{overallProgress}%</span>
              </div>
              <Progress value={overallProgress} className="h-2" />
            </div>
          </Card>
        )}

        {/* Category tabs */}
        {ventureCategories.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedCategoryId("all")}
              className={`px-3 py-1.5 text-sm rounded-full font-medium ${selectedCategoryId === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              All
            </button>
            {ventureCategories.map((cat: any) => {
              const pct = getCategoryProgressPct(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategoryId(cat.id)}
                  className={`px-3 py-1.5 text-sm rounded-full font-medium ${selectedCategoryId === cat.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
                >
                  {cat.name} {pct > 0 && <span className="ml-1 opacity-80">{pct}%</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Empty states */}
        {ventureCategories.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            <p>No categories configured for this venture yet.</p>
          </Card>
        )}

        {visibleWorkItems.length === 0 && ventureCategories.length > 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            <p>No work descriptions configured for this category yet.</p>
          </Card>
        )}

        {visibleWorkItems.length > 0 && units.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            <p>No units found for the selected block/floor. Configure them in Progress Configuration.</p>
          </Card>
        )}

        {visibleWorkItems.length > 0 && units.length > 0 && (
          <>
            {/* Mobile layout: flat selector + work item cards */}
            <div className="md:hidden space-y-3">
              <div className="flex items-center gap-2">
                <Button size="icon" variant="outline" disabled={mobileUnitIndex <= 0} onClick={() => setMobileUnitIndex((i) => Math.max(0, i - 1))}>
                  <ChevronLeft className="size-4" />
                </Button>
                <div className="flex-1 text-center font-medium text-sm">
                  {selectedUnit?.label}
                  <span className="text-muted-foreground ml-1">({mobileUnitIndex + 1}/{units.length})</span>
                </div>
                <Button size="icon" variant="outline" disabled={mobileUnitIndex >= units.length - 1} onClick={() => setMobileUnitIndex((i) => Math.min(units.length - 1, i + 1))}>
                  <ChevronRight className="size-4" />
                </Button>
              </div>

              {matrix.map((row, idx) => {
                const cell = row.cells[mobileUnitIndex];
                if (!cell) return null;
                const info = getStatusInfo(cell.status);
                return (
                  <Card key={row.workItem.id} className="p-3 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-sm">{idx + 1}. {row.workItem.name}</p>
                        <p className="text-xs text-muted-foreground">{row.category?.name}</p>
                      </div>
                      <button
                        onClick={() => {
                          if (bulkMode) toggleCellSelection(cell.id);
                          else if (cell.is_editable) setEditCell(cell);
                          else setHistoryCell(cell);
                        }}
                        className={`rounded px-2 py-1 text-xs font-medium ${info.bg} ${info.text} ${bulkMode ? "ring-2 ring-offset-1 ring-primary" : ""}`}
                      >
                        {info.label}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => setHistoryCell(cell)}>
                        <History className="mr-1 size-3.5" /> History
                      </Button>
                      {cell.is_editable && !bulkMode && (
                        <Button size="sm" className="flex-1" onClick={() => setEditCell(cell)}>
                          Update
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>

            {/* Desktop layout: sticky-header matrix table */}
            <Card className="hidden md:block overflow-hidden">
              <div className="overflow-auto max-h-[70vh] relative">
                <table className="w-full text-sm border-collapse">
                  <thead className="text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="sticky top-0 left-0 z-30 bg-muted px-3 py-2 text-left whitespace-nowrap min-w-[12rem] border-r">
                        S.No / Work Description
                      </th>
                      {units.map((u) => (
                        <th key={u.id} className="sticky top-0 z-20 bg-muted px-2 py-2 text-center border-l whitespace-nowrap min-w-[72px]">
                          {u.label}
                        </th>
                      ))}
                      {selectedCategoryId === "all" && <th className="sticky top-0 z-20 bg-muted px-3 py-2 text-center border-l">Category</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map((row, idx) => {
                      const catProgress = getCategoryProgressPct(row.category?.id ?? "none");
                      return (
                        <tr key={row.workItem.id} className="border-b hover:bg-muted/30">
                          <td className="sticky left-0 z-10 bg-card px-3 py-2 border-r">
                            <div className="font-medium whitespace-nowrap">{idx + 1}. {row.workItem.name}</div>
                            <div className="text-xs text-muted-foreground">{row.category?.name} {catProgress > 0 && `(${catProgress}%)`}</div>
                          </td>
                          {row.cells.map((cell, cellIdx) => {
                            if (!cell) return <td key={cellIdx} className="px-2 py-2 border-l text-center text-muted-foreground">—</td>;
                            const info = getStatusInfo(cell.status);
                            const isSelected = selectedCellIds.has(cell.id);
                            return (
                              <td key={cellIdx} className="px-2 py-2 border-l text-center">
                                <button
                                  onClick={() => {
                                    if (bulkMode) toggleCellSelection(cell.id);
                                    else if (cell.is_editable) setEditCell(cell);
                                    else setHistoryCell(cell);
                                  }}
                                  className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${info.bg} ${info.text} ${bulkMode && isSelected ? "ring-2 ring-offset-2 ring-primary" : ""} ${!bulkMode && cell.is_editable ? "hover:opacity-90 cursor-pointer" : ""}`}
                                  title={cell.remarks ?? `${statusLabel(cell.status)} — ${cell.completion_pct}%`}
                                >
                                  {info.label}
                                  {cell.remarks && <span className="ml-0.5">•</span>}
                                </button>
                              </td>
                            );
                          })}
                          {selectedCategoryId === "all" && (
                            <td className="px-3 py-2 border-l text-xs text-muted-foreground text-center">
                              {row.category?.name}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {editCell && (
        <CellEditDialog
          cell={editCell}
          onClose={() => setEditCell(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["progressDashboard"] });
            setEditCell(null);
          }}
        />
      )}

      {historyCell && <CellHistoryDialog cell={historyCell} onClose={() => setHistoryCell(null)} />}
    </AppShell>
  );
}

// Status update dialog with the 4-color scheme.
function CellEditDialog({ cell, onClose, onSaved }: { cell: any; onClose: () => void; onSaved: () => void }) {
  const [status, setStatus] = useState<ProgressStatusKey>(cell.status);
  const [pct, setPct] = useState<number>(cell.completion_pct);
  const [remarks, setRemarks] = useState<string>(cell.remarks ?? "");
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

  async function save() {
    setSaving(true);
    try {
      await updateCell({ cell_id: cell.id, status, completion_pct: pct, remarks: remarks || null });
      toast.success("Status updated");
      queryClient.invalidateQueries({ queryKey: ["progressDashboard"] });
      onSaved();
    } catch (err) {
      toast.error("Failed to update status");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{cell.unit_number ?? `Unit ${cell.cell_number}`} — {cell.work_item_name}</DialogTitle>
          <DialogDescription>Current status: {statusLabel(cell.status)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {STATUS_KEYS.map((k) => {
              const info = getStatusInfo(k);
              return (
                <button
                  key={k}
                  onClick={() => {
                    setStatus(k);
                    setPct(k === "completed" ? 100 : k === "not_started" ? 0 : pct);
                  }}
                  className={`rounded-md px-3 py-2 text-sm font-medium ${info.bg} ${info.text} ${status === k ? "ring-2 ring-offset-2 ring-primary" : ""}`}
                >
                  {info.label}
                </button>
              );
            })}
          </div>
          <div>
            <label className="text-sm font-medium">Completion %</label>
            <Input
              type="number"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => setPct(Math.min(100, Math.max(0, Number(e.target.value))))}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Remarks</label>
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional note" />
          </div>
          <div className="flex gap-2">
            <Button className="flex-1" onClick={save} disabled={saving}>
              Save
            </Button>
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// History dialog (reused from original, adapted to new status labels).
function CellHistoryDialog({ cell, onClose }: { cell: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: histData } = useQuery({
    queryKey: ["cellHistory", cell.id],
    queryFn: () => fetchCellHistory({ cell_id: cell.id }),
  });

  useEffect(() => {
    const channel = supabase
      .channel(`cell-history-${cell.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "progress_cell_history", filter: `cell_id=eq.${cell.id}` },
        () => queryClient.invalidateQueries({ queryKey: ["cellHistory", cell.id] }),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "progress_cell_photos", filter: `cell_id=eq.${cell.id}` },
        () => queryClient.invalidateQueries({ queryKey: ["cellHistory", cell.id] }),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [cell.id, queryClient]);

  const history = histData?.history ?? [];
  const photos = histData?.photos ?? [];

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {cell.unit_number ?? `Unit ${cell.cell_number}`} — History
          </DialogTitle>
          <DialogDescription>
            {cell.block_name} · {cell.floor_name} · {cell.work_item_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No updates yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((h: any) => (
                <div key={h.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="font-medium">{h.changed_by_name}</span>
                    <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {statusLabel(h.previous_status)} ({h.previous_pct}%) → {statusLabel(h.new_status)} ({h.new_pct}%)
                  </div>
                  {h.remarks && <p className="mt-1 text-xs">{h.remarks}</p>}
                </div>
              ))}
            </div>
          )}

          {photos.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Photos</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {photos.map((p: any) => <SignedPhoto key={p.id} path={p.storage_path} caption={p.caption} />)}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignedPhoto({ path, caption }: { path: string; caption?: string | null }) {
  const { data } = useQuery({
    queryKey: ["signedUrl", path],
    queryFn: () => getSignedUrl({ bucket: "photos", path }),
    staleTime: 300000,
  });
  const url = data?.success ? data.url : null;

  return (
    <div className="relative aspect-square overflow-hidden rounded-lg border">
      {url ? (
        <img src={url} alt={caption ?? ""} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center bg-muted">
          <Camera className="size-5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
