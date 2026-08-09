// Progress dashboard page showing block-level roll-ups and a drill-down table of all tracked cells.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { fetchProgressDashboard, fetchCellHistory } from "@/lib/api/progress-tracking";
import { getSignedUrl } from "@/lib/api/storage";
import { toast } from "sonner";
import { TrendingUp, Camera, History, ChevronRight } from "lucide-react";

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

// Main dashboard page with block summary cards, filters and a cell-level drill-down table.
function ProgressDashboardPage() {
  const { data: dashData } = useQuery({
    queryKey: ["progressDashboard"],
    queryFn: () => fetchProgressDashboard(),
  });
  const [blockFilter, setBlockFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [historyCell, setHistoryCell] = useState<any | null>(null);

  const blocks = dashData?.blocks ?? [];
  const allCells = dashData?.cells ?? [];

  const filteredCells = allCells.filter((c: any) => {
    if (blockFilter !== "all" && c.block_name !== blockFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    return true;
  });

  return (
    <AppShell
      title="Progress Dashboard"
      subtitle="Live roll-up of construction progress across all blocks"
    >
      <div className="space-y-4">
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

        {/* Drill-down table */}
        {filteredCells.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <TrendingUp className="mx-auto mb-3 size-10 opacity-30" />
            <p>No cells found. Create cell groups in Progress Config first.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Block</th>
                    <th className="px-3 py-2">Floor</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Work Item</th>
                    <th className="px-3 py-2">Cell #</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Completion</th>
                    <th className="px-3 py-2">Updated</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCells.map((c: any) => (
                    <tr key={c.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 font-medium">{c.block_name}</td>
                      <td className="px-3 py-2">{c.floor_name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{c.category_name}</td>
                      <td className="px-3 py-2">{c.work_item_name}</td>
                      <td className="px-3 py-2">#{c.cell_number}</td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[c.status] ?? ""}`}
                        >
                          {STATUS_LABELS[c.status] ?? c.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Progress value={c.completion_pct} className="h-1.5 w-16" />
                          <span className="text-xs">{c.completion_pct}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Button size="sm" variant="ghost" onClick={() => setHistoryCell(c)}>
                          <History className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {historyCell && <CellHistoryDialog cell={historyCell} onClose={() => setHistoryCell(null)} />}
    </AppShell>
  );
}

// Dialog showing the change history and uploaded photos for a single cell.
function CellHistoryDialog({ cell, onClose }: { cell: any; onClose: () => void }) {
  const { data: histData } = useQuery({
    queryKey: ["cellHistory", cell.id],
    queryFn: () => fetchCellHistory({ cell_id: cell.id }),
  });

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
          <DialogTitle>Cell #{cell.cell_number} — History</DialogTitle>
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
