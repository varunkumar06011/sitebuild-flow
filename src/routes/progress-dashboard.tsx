// Progress dashboard page showing block-level roll-ups and a drill-down table of all tracked cells.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
import { fetchProgressDashboard, fetchCellHistory, fetchHierarchy } from "@/lib/api/progress-tracking";
import { CellEditDialog } from "@/routes/progress-tracking";
import { supabase } from "@/lib/supabase";
import { getSignedUrl } from "@/lib/api/storage";
import { TrendingUp, Camera, History } from "lucide-react";

export const Route = createFileRoute("/progress-dashboard")({
  head: () => ({
    meta: [{ title: "Progress Dashboard — Meditrust ERP" }],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: ProgressDashboardPage,
});

const STATUS_COLORS: Record<string, string> = {
  not_started: "bg-gray-100 text-gray-600",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-emerald-100 text-emerald-700",
  on_hold: "bg-amber-100 text-amber-700",
};

const STATUS_LABELS: Record<string, string> = {
  not_started: "Not Started",
  in_progress: "In Progress",
  completed: "Completed",
  on_hold: "On Hold",
};

const SCOPE_LABELS: Record<string, string> = {
  flat: "Unit/Room",
  floor: "Floor",
  block: "Block",
};

// Main dashboard page with work view selector, block roll-ups, and a scope-aware matrix grid.
function ProgressDashboardPage() {
  const { data: hier } = useQuery({ queryKey: ["hierarchy"], queryFn: fetchHierarchy });
  const workViews = hier?.workViews ?? [];
  const [selectedWorkViewId, setSelectedWorkViewId] = useState("");

  useEffect(() => {
    if (workViews.length > 0 && !selectedWorkViewId) {
      const general = workViews.find((wv: any) => wv.name === "General");
      setSelectedWorkViewId(general?.id ?? workViews[0]?.id ?? "");
    }
  }, [workViews, selectedWorkViewId]);

  const { data: dashData } = useQuery({
    queryKey: ["progressDashboard", selectedWorkViewId],
    queryFn: () => fetchProgressDashboard(selectedWorkViewId || undefined),
    enabled: !!selectedWorkViewId,
  });
  const [blockFilter, setBlockFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [historyCell, setHistoryCell] = useState<any | null>(null);
  const [editingCell, setEditingCell] = useState<any | null>(null);
  const queryClient = useQueryClient();

  // Reset filters when Work View changes to prevent stale filter state
  useEffect(() => {
    setBlockFilter("all");
    setStatusFilter("all");
  }, [selectedWorkViewId]);

  // Realtime: invalidate dashboard query when any cell changes.
  useEffect(() => {
    const channel = supabase
      .channel("progress-dashboard-cells")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "progress_cells" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["progressDashboard"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const blocks = dashData?.blocks ?? [];
  const allCells = dashData?.cells ?? [];
  const scope = workViews.find((wv: any) => wv.id === selectedWorkViewId)?.scope ?? "flat";

  // Build column structure: categories → work items scoped to the selected work view
  const categories = (hier?.categories ?? [])
    .filter((c: any) => c.work_view_id === selectedWorkViewId)
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const workItems = (hier?.workItems ?? [])
    .filter((wi: any) => categories.some((c: any) => c.id === wi.category_id))
    .sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const columnGroups = categories
    .map((cat: any) => ({
      category: cat,
      items: workItems.filter((wi: any) => wi.category_id === cat.id),
    }))
    .filter((cg: any) => cg.items.length > 0);

  // Filter cells by block/status filters
  const filteredCells = allCells.filter((c: any) => {
    if (blockFilter !== "all" && c.block_name !== blockFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    return true;
  });

  // Build cell lookup: rowKey/work_item_id → cell
  const cellMap = new Map<string, any>();
  for (const c of filteredCells) {
    let rowKey: string;
    if (scope === "flat") {
      const unitLabel = c.unit_number ?? `Unit ${c.cell_number}`;
      rowKey = `${c.block_id}/${c.floor_id}/${unitLabel}`;
    } else if (scope === "floor") {
      rowKey = `${c.block_id}/${c.floor_id}`;
    } else {
      rowKey = `${c.block_id}`;
    }
    const key = `${rowKey}/${c.work_item_id}`;
    const existing = cellMap.get(key);
    if (scope === "block" && existing && existing.completion_pct <= c.completion_pct) continue;
    cellMap.set(key, c);
  }

  // Build unique rows from cells
  const rowMap = new Map<string, any>();
  for (const c of filteredCells) {
    let rowKey: string;
    let rowData: any;
    if (scope === "flat") {
      const unitLabel = c.unit_number ?? `Unit ${c.cell_number}`;
      rowKey = `${c.block_id}/${c.floor_id}/${unitLabel}`;
      rowData = {
        rowKey,
        blockId: c.block_id,
        blockName: c.block_name,
        floorId: c.floor_id,
        floorName: c.floor_name,
        unitLabel,
        locationLabel: `${c.block_name} · ${c.floor_name} · ${unitLabel}`,
      };
    } else if (scope === "floor") {
      rowKey = `${c.block_id}/${c.floor_id}`;
      rowData = {
        rowKey,
        blockId: c.block_id,
        blockName: c.block_name,
        floorId: c.floor_id,
        floorName: c.floor_name,
        locationLabel: `${c.block_name} · ${c.floor_name}`,
      };
    } else {
      rowKey = `${c.block_id}`;
      rowData = {
        rowKey,
        blockId: c.block_id,
        blockName: c.block_name,
        locationLabel: c.block_name,
      };
    }
    if (!rowMap.has(rowKey)) rowMap.set(rowKey, rowData);
  }

  const rows = Array.from(rowMap.values()).sort((a, b) => {
    if (a.blockName !== b.blockName) return a.blockName.localeCompare(b.blockName);
    if (a.floorName && b.floorName && a.floorName !== b.floorName)
      return a.floorName.localeCompare(b.floorName);
    if (a.unitLabel && b.unitLabel) return a.unitLabel.localeCompare(b.unitLabel);
    return 0;
  });

  // Group consecutive rows by block for visual grouping
  const rowGroups: { blockName: string; rows: any[] }[] = [];
  for (const row of rows) {
    const last = rowGroups[rowGroups.length - 1];
    if (last && last.blockName === row.blockName) {
      last.rows.push(row);
    } else {
      rowGroups.push({ blockName: row.blockName, rows: [row] });
    }
  }

  return (
    <AppShell
      title="Progress Dashboard"
      subtitle="Live roll-up of construction progress across all blocks"
    >
      <div className="space-y-4">
        {/* Work View selector */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Work View:</span>
          <Select value={selectedWorkViewId} onValueChange={setSelectedWorkViewId}>
            <SelectTrigger className="w-56">
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
          <span className="text-xs text-muted-foreground">
            Scope: {SCOPE_LABELS[scope] ?? scope}
          </span>
        </div>

        {/* Block roll-up cards */}
        {blocks.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {blocks.map((b: any) => (
              <Card key={b.name} className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-bold">{b.name}</p>
                  <span className="text-2xl font-bold text-primary">{b.avgPct}%</span>
                </div>
                <Progress value={b.avgPct} className="h-2" />
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span className="text-emerald-600">{b.completed} done</span>
                  <span className="text-blue-600">{b.inProgress} active</span>
                  <span className="text-amber-600">{b.onHold} hold</span>
                  <span>{b.notStarted} pending</span>
                </div>
                <p className="text-xs text-muted-foreground">{b.total} cells total</p>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Filter:</span>
          <Select value={blockFilter} onValueChange={setBlockFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
              <span className="ml-1">Block</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Blocks</SelectItem>
              {blocks.map((b: any) => (
                <SelectItem key={b.name} value={b.name}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue />
              <span className="ml-1">Status</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="not_started">Not Started</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-auto">
            {filteredCells.length} cells
          </span>
        </div>

        {/* Matrix grid */}
        {columnGroups.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <TrendingUp className="mx-auto mb-3 size-10 opacity-30" />
            <p>No categories or work items configured for this work view yet.</p>
          </Card>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <TrendingUp className="mx-auto mb-3 size-10 opacity-30" />
            <p>No cells found. Create cell groups in Progress Config first.</p>
          </Card>
        ) : (
          <>
            {/* Mobile: card-per-item layout (reuses progress-tracking.tsx pattern) */}
            <div className="grid gap-3 sm:grid-cols-2 md:hidden">
              {filteredCells.map((cell: any) => (
                <Card key={cell.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{cell.work_item_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {cell.block_name} · {cell.floor_name} ·{" "}
                        {cell.work_view_scope === "flat"
                          ? (cell.unit_number ?? `Unit ${cell.cell_number}`)
                          : cell.work_view_scope === "floor"
                            ? "Floor"
                            : "Block"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{cell.category_name}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[cell.status] ?? ""}`}
                    >
                      {STATUS_LABELS[cell.status] ?? cell.status}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Completion</span>
                      <span className="font-medium">{cell.completion_pct}%</span>
                    </div>
                    <Progress value={cell.completion_pct} className="h-2" />
                  </div>
                  {cell.remarks && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{cell.remarks}</p>
                  )}
                  <div className="flex gap-2">
                    {cell.is_editable && (
                      <Button size="sm" variant="default" onClick={() => setEditingCell(cell)}>
                        Update
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setHistoryCell(cell)}>
                      <History className="mr-1 size-3.5" /> History
                    </Button>
                  </div>
                </Card>
              ))}
            </div>

            {/* Desktop: sticky-header + sticky-column matrix table */}
            <Card className="hidden md:block overflow-hidden">
              <div className="overflow-auto max-h-[70vh] relative">
                <table className="w-full text-sm border-collapse">
                  <thead className="text-xs uppercase text-muted-foreground">
                    {/* Category header row */}
                    <tr>
                      <th className="sticky top-0 left-0 z-30 bg-muted px-3 py-2 text-left whitespace-nowrap min-w-[12rem]">
                        Location
                      </th>
                      {columnGroups.map((cg: any) => (
                        <th
                          key={cg.category.id}
                          colSpan={cg.items.length}
                          className="sticky top-0 z-20 bg-muted px-3 py-2 text-center border-l whitespace-nowrap"
                        >
                          {cg.category.name}
                        </th>
                      ))}
                    </tr>
                    {/* Work item header row */}
                    <tr>
                      <th className="sticky top-[1.75rem] left-0 z-30 bg-muted px-3 py-2 text-left whitespace-nowrap min-w-[12rem] border-t">
                        {SCOPE_LABELS[scope] ?? scope}
                      </th>
                      {columnGroups.flatMap((cg: any) =>
                        cg.items.map((wi: any) => (
                          <th
                            key={wi.id}
                            className="sticky top-[1.75rem] z-20 bg-muted px-2 py-2 text-center border-l border-t whitespace-nowrap min-w-[80px]"
                          >
                            {wi.name}
                          </th>
                        )),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rowGroups.map((group: any) =>
                      group.rows.map((row: any) => (
                        <tr key={row.rowKey} className="border-b hover:bg-muted/30">
                          <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium whitespace-nowrap min-w-[12rem] border-r">
                            {row.locationLabel}
                          </td>
                          {columnGroups.flatMap((cg: any) =>
                            cg.items.map((wi: any) => {
                              const cell = cellMap.get(`${row.rowKey}/${wi.id}`);
                              return (
                                <td key={wi.id} className="px-2 py-2 border-l text-center">
                                  {cell ? (
                                    <StatusCell
                                      cell={cell}
                                      onEdit={() => setEditingCell(cell)}
                                      onHistory={() => setHistoryCell(cell)}
                                    />
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                              );
                            }),
                          )}
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {editingCell && (
        <CellEditDialog
          cell={editingCell}
          onClose={() => setEditingCell(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["progressDashboard"] });
            setEditingCell(null);
          }}
        />
      )}

      {historyCell && <CellHistoryDialog cell={historyCell} onClose={() => setHistoryCell(null)} />}
    </AppShell>
  );
}

// Compact status badge for a matrix cell — renders the 4-color status with edit/history actions.
function StatusCell({ cell, onEdit, onHistory }: { cell: any; onEdit: () => void; onHistory: () => void }) {
  return (
    <div className="flex items-center justify-center gap-1">
      <button
        onClick={onEdit}
        disabled={!cell.is_editable}
        className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_COLORS[cell.status] ?? ""} ${cell.is_editable ? "hover:ring-2 hover:ring-primary/30 cursor-pointer" : "cursor-default"}`}
        title={`${STATUS_LABELS[cell.status] ?? cell.status} — ${cell.completion_pct}%`}
      >
        {cell.completion_pct}%
      </button>
      <button onClick={onHistory} className="text-muted-foreground hover:text-primary" title="History">
        <History className="size-3" />
      </button>
    </div>
  );
}

// Dialog showing the change history and uploaded photos for a single cell.
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
        () => {
          queryClient.invalidateQueries({ queryKey: ["cellHistory", cell.id] });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "progress_cell_photos", filter: `cell_id=eq.${cell.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["cellHistory", cell.id] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [cell.id, queryClient]);

  const history = histData?.history ?? [];
  const photos = histData?.photos ?? [];

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {cell.work_view_scope === "flat"
              ? `${cell.unit_number ?? `Unit ${cell.cell_number}`} — History`
              : cell.work_view_scope === "floor"
                ? "Floor — History"
                : "Block — History"}
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
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {h.previous_status && STATUS_LABELS[h.previous_status]
                      ? STATUS_LABELS[h.previous_status]
                      : h.previous_status}{" "}
                    ({h.previous_pct}%) →{" "}
                    {h.new_status && STATUS_LABELS[h.new_status]
                      ? STATUS_LABELS[h.new_status]
                      : h.new_status}{" "}
                    ({h.new_pct}%)
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
                {photos.map((p: any) => (
                  <SignedPhoto key={p.id} path={p.storage_path} caption={p.caption} />
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Renders a single cell photo by fetching its signed URL from storage.
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
