// Progress tracking page for supervisors to update status, completion and photos of assigned cells.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { requireAuth } from "@/lib/auth-guards";
import {
  fetchMyCells,
  updateCell,
  uploadCellPhoto,
  fetchCellHistory,
} from "@/lib/api/progress-tracking";
import { getSignedUrl } from "@/lib/api/storage";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { TrendingUp, Camera, History } from "lucide-react";
import { PROGRESS_STATUS_KEYS, statusLabel, statusClasses } from "@/lib/progress-status";

export const Route = createFileRoute("/progress-tracking")({
  head: () => ({
    meta: [{ title: "Progress Tracking — Meditrust ERP" }],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: ProgressTrackingPage,
});

// Main progress tracking page showing assigned cells with filter, edit and history actions.
function ProgressTrackingPage() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editingCell, setEditingCell] = useState<any | null>(null);
  const [historyCell, setHistoryCell] = useState<any | null>(null);
  const queryClient = useQueryClient();

  // Realtime: invalidate myCells query when any cell changes.
  useEffect(() => {
    const channel = supabase
      .channel("progress-tracking-cells")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "progress_cells" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["myCells"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const { data: cellsData } = useQuery({
    queryKey: ["myCells", statusFilter],
    queryFn: () => fetchMyCells(statusFilter !== "all" ? { status: statusFilter } : undefined),
  });

  const cells = cellsData?.data ?? [];

  return (
    <AppShell
      title="Progress Tracking"
      subtitle="Update status and completion for your assigned cells"
    >
      <div className="space-y-4">
        {/* Filter bar */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Filter:</span>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {PROGRESS_STATUS_KEYS.map((key) => (
                <SelectItem key={key} value={key}>{statusLabel(key)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground ml-auto">{cells.length} cells</span>
        </div>

        {/* Cell cards */}
        {cells.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            <TrendingUp className="mx-auto mb-3 size-10 opacity-30" />
            <p>No cells assigned to you yet.</p>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cells.map((cell: any) => (
              <Card key={cell.id} className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold">{cell.work_item_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {cell.block_name} · {cell.floor_name} · {cell.work_view_scope === "flat" ? (cell.unit_number ?? `Unit ${cell.cell_number}`) : cell.work_view_scope === "floor" ? "Floor" : "Block"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">{cell.category_name}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClasses(cell.status)}`}>
                    {statusLabel(cell.status)}
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
                  <Button size="sm" variant="default" onClick={() => setEditingCell(cell)}>
                    Update
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setHistoryCell(cell)}>
                    <History className="mr-1 size-3.5" /> History
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Edit dialog */}
      {editingCell && (
        <CellEditDialog
          cell={editingCell}
          onClose={() => setEditingCell(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["myCells"] });
            setEditingCell(null);
          }}
        />
      )}

      {/* History dialog */}
      {historyCell && <CellHistoryDialog cell={historyCell} onClose={() => setHistoryCell(null)} />}
    </AppShell>
  );
}

// Dialog for editing a cell's status, completion percentage, remarks and photo upload.
export function CellEditDialog({
  cell,
  onClose,
  onSaved,
}: {
  cell: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(cell.status);
  const [pct, setPct] = useState(cell.completion_pct);
  const [remarks, setRemarks] = useState(cell.remarks ?? "");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Persists the updated cell status, completion and remarks via the API.
  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await updateCell({
        cell_id: cell.id,
        status,
        completion_pct: pct,
        remarks: remarks || null,
      });
      if (result.success) {
        toast.success("Cell updated");
        onSaved();
      } else {
        toast.error(result.error || "Failed to update");
      }
    } catch {
      toast.error("Failed to update cell");
    } finally {
      setSaving(false);
    }
  };

  // Reads a photo file as base64 and uploads it as evidence for the cell.
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1] ?? "";
        const result = await uploadCellPhoto({
          cell_id: cell.id,
          contentType: file.type || "image/jpeg",
          fileData: base64,
        });
        if (result.success) {
          toast.success("Photo uploaded");
        } else {
          toast.error(result.error || "Upload failed");
        }
        setUploading(false);
        if (fileRef.current) fileRef.current.value = "";
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error("Failed to upload photo");
      setUploading(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Update {cell.work_view_scope === "flat" ? (cell.unit_number ?? `Unit ${cell.cell_number}`) : cell.work_view_scope === "floor" ? "Floor" : "Block"}</DialogTitle>
          <DialogDescription>
            {cell.block_name} · {cell.floor_name} · {cell.work_item_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROGRESS_STATUS_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>{statusLabel(key)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Completion: {pct}%</Label>
            <input
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => setPct(Number(e.target.value))}
              className="w-full"
            />
            <Progress value={pct} className="h-2" />
          </div>

          <div className="space-y-2">
            <Label>Remarks</Label>
            <Textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Add notes about this cell..."
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label>Photo</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              <Camera className="mr-2 size-4" />
              {uploading ? "Uploading..." : "Upload Photo"}
            </Button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
          <DialogTitle>{cell.work_view_scope === "flat" ? `${cell.unit_number ?? `Unit ${cell.cell_number}`} History` : cell.work_view_scope === "floor" ? "Floor History" : "Block History"}</DialogTitle>
          <DialogDescription>
            {cell.block_name} · {cell.floor_name} · {cell.work_item_name}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* History entries */}
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
                    {statusLabel(h.previous_status)} ({h.previous_pct}%) → {statusLabel(h.new_status)} ({h.new_pct}%)
                  </div>
                  {h.remarks && <p className="mt-1 text-xs">{h.remarks}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Photos */}
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
