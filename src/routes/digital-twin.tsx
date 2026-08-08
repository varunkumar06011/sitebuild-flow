// Digital Twin — 2D interactive site map with blocks color-coded by completion percentage.
// Click a block to drill down into floor-level and work-item-level progress.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchBlockOverlay, fetchBlockDetail, updateBlockLayout } from "@/lib/api/digital-twin";
import { requireAuth } from "@/lib/auth-guards";
import { useRole } from "@/lib/role-context";
import { toast } from "sonner";
import { Box, TrendingUp, Layers, Grid3x3, Loader2, Move } from "lucide-react";

export const Route = createFileRoute("/digital-twin")({
  head: () => ({
    meta: [
      { title: "Digital Twin — Meditrust ERP" },
      { name: "description", content: "2D site map with color-coded block completion overlay." },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: DigitalTwinPage,
});

// Color based on completion percentage.
function completionColor(pct: number): string {
  if (pct >= 90) return "bg-emerald-500 text-white";
  if (pct >= 70) return "bg-emerald-400 text-white";
  if (pct >= 50) return "bg-amber-400 text-white";
  if (pct >= 25) return "bg-orange-400 text-white";
  if (pct > 0) return "bg-red-400 text-white";
  return "bg-slate-300 text-slate-700";
}

function statusColor(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-100 text-emerald-700";
    case "in_progress":
      return "bg-blue-100 text-blue-700";
    case "not_started":
      return "bg-slate-100 text-slate-600";
    case "on_hold":
      return "bg-amber-100 text-amber-700";
    default:
      return "bg-slate-100 text-slate-600";
  }
}

function DigitalTwinPage() {
  const { role } = useRole();
  const canEdit = role !== "Supervisor";
  const [selectedBlock, setSelectedBlock] = useState<any | null>(null);

  const { data: overlayData, isLoading } = useQuery({
    queryKey: ["block-overlay"],
    queryFn: () => fetchBlockOverlay({ data: {} }),
  });
  const blocks = (overlayData?.data ?? []) as any[];

  const { data: detailData, isLoading: detailLoading } = useQuery({
    queryKey: ["block-detail", selectedBlock?.id],
    queryFn: () => fetchBlockDetail({ data: { block_id: selectedBlock.id } }),
    enabled: !!selectedBlock,
  });
  const detail = detailData?.data;

  const overallPct =
    blocks.length > 0
      ? Math.round(
          blocks.reduce((s: number, b: any) => s + (b.completion_pct ?? 0), 0) / blocks.length,
        )
      : 0;

  const completedBlocks = blocks.filter((b: any) => b.completion_pct >= 100).length;
  const inProgressBlocks = blocks.filter(
    (b: any) => b.completion_pct > 0 && b.completion_pct < 100,
  ).length;
  const notStartedBlocks = blocks.filter((b: any) => b.completion_pct === 0).length;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Digital Twin</h1>
            <p className="text-sm text-muted-foreground">
              2D site map with real-time progress overlay — click a block to drill down
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2">
            <TrendingUp className="size-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Overall Progress</p>
              <p className="text-xl font-bold">{overallPct}%</p>
            </div>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Box className="size-4" />
              <p className="text-xs font-medium">Total Blocks</p>
            </div>
            <p className="mt-2 text-2xl font-bold">{blocks.length}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="size-3 rounded bg-emerald-500" />
              <p className="text-xs font-medium">Completed</p>
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-600">{completedBlocks}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="size-3 rounded bg-amber-400" />
              <p className="text-xs font-medium">In Progress</p>
            </div>
            <p className="mt-2 text-2xl font-bold text-amber-600">{inProgressBlocks}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <div className="size-3 rounded bg-slate-300" />
              <p className="text-xs font-medium">Not Started</p>
            </div>
            <p className="mt-2 text-2xl font-bold text-slate-500">{notStartedBlocks}</p>
          </Card>
        </div>

        {/* Site map grid */}
        <Card className="overflow-hidden p-0">
          <div className="border-b border-border p-4">
            <p className="font-semibold">Site Layout</p>
            <p className="text-xs text-muted-foreground">
              Blocks are color-coded by completion percentage.{" "}
              {canEdit && "Drag to reposition (coming soon)."}
            </p>
          </div>
          <div className="relative bg-surface/30 p-8" style={{ minHeight: "400px" }}>
            {isLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              </div>
            ) : blocks.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                No blocks configured. Set up progress tracking blocks first.
              </div>
            ) : (
              <div
                className="grid gap-4"
                style={{
                  gridTemplateColumns: "repeat(4, 1fr)",
                  gridAutoRows: "120px",
                }}
              >
                {blocks.map((b: any) => (
                  <button
                    key={b.id}
                    onClick={() => setSelectedBlock(b)}
                    className={`group relative flex flex-col items-center justify-center rounded-xl border-2 border-white/20 p-4 shadow-lg transition-all hover:scale-105 hover:shadow-xl ${completionColor(b.completion_pct)}`}
                    style={{
                      gridColumn: `span ${b.width}`,
                      gridRow: `span ${b.height}`,
                    }}
                  >
                    <p className="text-lg font-bold">{b.name}</p>
                    <p className="text-3xl font-black">{b.completion_pct}%</p>
                    <p className="mt-1 text-xs opacity-80">
                      {b.completed_cells}/{b.total_cells} cells done
                    </p>
                    {canEdit && (
                      <Move className="absolute right-2 top-2 size-3.5 opacity-0 transition-opacity group-hover:opacity-60" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 border-t border-border p-4 text-xs">
            <span className="font-medium text-muted-foreground">Legend:</span>
            {[
              { label: "Not Started", color: "bg-slate-300" },
              { label: "1-25%", color: "bg-red-400" },
              { label: "25-50%", color: "bg-orange-400" },
              { label: "50-70%", color: "bg-amber-400" },
              { label: "70-90%", color: "bg-emerald-400" },
              { label: "90-100%", color: "bg-emerald-500" },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className={`size-3 rounded ${l.color}`} />
                <span className="text-muted-foreground">{l.label}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Block detail dialog */}
      <Dialog open={!!selectedBlock} onOpenChange={(open) => !open && setSelectedBlock(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Box className="size-5" />
              {selectedBlock?.name} — {selectedBlock?.completion_pct}% Complete
            </DialogTitle>
            <DialogDescription>
              {selectedBlock?.completed_cells} of {selectedBlock?.total_cells} cells completed
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : detail ? (
            <div className="space-y-4">
              {/* Floor breakdown */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Layers className="size-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Floor Breakdown</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {detail.floors.map((f: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border border-border p-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{f.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {f.completed}/{f.total} cells done
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">{f.avgPct}%</p>
                        <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${f.avgPct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Work item breakdown */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Grid3x3 className="size-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Work Item Breakdown</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="pb-2 font-medium">Work Item</th>
                        <th className="pb-2 font-medium">Category</th>
                        <th className="pb-2 text-right font-medium">Cells</th>
                        <th className="pb-2 text-right font-medium">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.work_items.map((w: any, i: number) => (
                        <tr key={i} className="border-t border-border">
                          <td className="py-2 font-medium">{w.name}</td>
                          <td className="py-2 text-xs text-muted-foreground">{w.category}</td>
                          <td className="py-2 text-right text-xs">
                            {w.completed}/{w.total}
                          </td>
                          <td className="py-2 text-right">
                            <span className="font-bold">{w.avgPct}%</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cell-level details */}
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Grid3x3 className="size-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">
                    Cell Details ({detail.cells?.length ?? 0})
                  </p>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <div className="grid gap-1.5 sm:grid-cols-3">
                    {(detail.cells ?? []).map((c: any) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between rounded border border-border px-2 py-1.5 text-xs"
                      >
                        <span className="font-mono">{c.cell_number}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusColor(c.status)}`}
                        >
                          {c.completion_pct}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
