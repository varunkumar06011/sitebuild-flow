// Punch list — cards grouped by zone, readiness progress bar, raise + photo form
import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  fetchPunchItems,
  createPunchItem,
  updatePunchItemStatus,
  getZoneReadinessSummary,
} from "@/lib/api/punch-list";
import { uploadFile } from "@/lib/api/storage";
import { fetchVendors } from "@/lib/api/vendors";
import { requireAuth } from "@/lib/auth-guards";
import { useRole } from "@/lib/role-context";
import { useOfflineSync } from "@/lib/useOfflineSync";
import { SectionTour, type TourStep } from "@/components/SectionTour";
import { toast } from "sonner";
import { Plus, Search, Loader2, Camera, Upload, CheckCircle2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/punch-list")({
  head: () => ({
    meta: [
      { title: "Punch List — Meditrust ERP" },
      {
        name: "description",
        content: "Snag list with zone readiness tracking for handover dashboard.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: PunchListPage,
});

const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success"> = {
  Open: "warning",
  "In Progress": "info",
  Resolved: "success",
  Verified: "success",
};

const SEVERITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  Low: "neutral",
  Medium: "info",
  High: "warning",
  Critical: "danger",
};

function PunchListPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const isAdmin = role === "Administrator" || role === "A1" || role === "A1+";
  const { withOfflineQueue } = useOfflineSync();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tourSteps: TourStep[] = isAdmin
    ? [
        {
          selector: '[data-tour="pl-readiness"]',
          title: "Zone Readiness Summary",
          description:
            "Overall handover readiness percentage across all zones — each zone shows resolved vs total items with a progress bar.",
        },
        {
          selector: '[data-tour="pl-search-input"]',
          title: "Search Punch Items",
          description: "Type a description or room number to find a specific snag quickly.",
        },
        {
          selector: '[data-tour="pl-zone-filter"]',
          title: "Filter by Zone",
          description:
            "Narrow the list to a specific zone to focus on snags in one area of the building.",
        },
        {
          selector: '[data-tour="pl-status-filter"]',
          title: "Filter by Status",
          description:
            "Show only Open, In Progress, Resolved, or Verified items to focus on what needs your attention.",
        },
        {
          selector: '[data-tour="pl-create"]',
          title: "Raise Punch Item",
          description:
            "Log a new snag with photo, severity, and vendor assignment — use this during walkthroughs to capture defects.",
        },
        {
          selector: '[data-tour="pl-status-change"]',
          title: "Update Status",
          description:
            "Change an item's status as you work on it — mark Resolved when fixed, and admins can mark Verified after inspection.",
        },
      ]
    : [
        {
          selector: '[data-tour="pl-search-input"]',
          title: "Search Punch Items",
          description: "Type a description or room number to find a specific snag quickly.",
        },
        {
          selector: '[data-tour="pl-zone-filter"]',
          title: "Filter by Zone",
          description:
            "Narrow the list to a specific zone to focus on snags in one area of the building.",
        },
        {
          selector: '[data-tour="pl-status-filter"]',
          title: "Filter by Status",
          description:
            "Show only Open, In Progress, or Resolved items to focus on what needs your attention.",
        },
        {
          selector: '[data-tour="pl-create"]',
          title: "Raise Punch Item",
          description:
            "Log a new snag with photo and severity — works offline and syncs when reconnected. Use this during walkthroughs.",
        },
        {
          selector: '[data-tour="pl-status-change"]',
          title: "Update Status",
          description:
            "Change an item's status as you work on it — mark In Progress when you start fixing, Resolved when done.",
        },
      ];

  const [search, setSearch] = useState("");
  const [zoneFilter, setZoneFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);

  const [form, setForm] = useState({
    zone: "",
    room: "",
    description: "",
    severity: "Medium" as string,
    assigned_vendor_id: "",
  });

  const { data: punchData, isLoading } = useQuery({
    queryKey: ["punchItems", search, zoneFilter, statusFilter],
    queryFn: () =>
      fetchPunchItems({
        data: {
          zone: zoneFilter !== "all" ? zoneFilter : undefined,
          status: statusFilter !== "all" ? statusFilter : undefined,
        } as any,
      }),
  });
  const items = punchData?.data ?? [];

  const { data: readinessData } = useQuery({
    queryKey: ["zoneReadiness"],
    queryFn: () => getZoneReadinessSummary({ data: {} }),
    enabled: isAdmin,
  });

  const { data: vendorData } = useQuery({
    queryKey: ["vendors"],
    queryFn: () => fetchVendors({ data: { limit: 100 } as any }),
  });
  const vendors = vendorData?.data ?? [];

  // Group items by zone
  const zoneGroups: Record<string, any[]> = {};
  for (const item of items) {
    const zone = (item as any).zone ?? "Unspecified";
    if (!zoneGroups[zone]) zoneGroups[zone] = [];
    zoneGroups[zone].push(item);
  }

  function openCreate() {
    setForm({ zone: "", room: "", description: "", severity: "Medium", assigned_vendor_id: "" });
    setPhotoPath(null);
    setDialogOpen(true);
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const path = `punch/${Date.now()}-${file.name}`;
      const result = await uploadFile({
        data: {
          bucket: "photos",
          path,
          contentType: file.type || "image/jpeg",
          fileData: base64,
        },
      });
      if (result.success) {
        setPhotoPath(path);
        toast.success("Photo uploaded");
      } else {
        toast.error("Photo upload failed");
      }
    } catch {
      toast.error("Photo upload failed");
    }
    setUploadingPhoto(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSave() {
    if (!form.zone.trim() || !form.description.trim()) {
      toast.error("Zone and description are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        zone: form.zone.trim(),
        room: form.room.trim() || undefined,
        description: form.description.trim(),
        photo_path: photoPath ?? undefined,
        severity: form.severity,
        assigned_vendor_id: form.assigned_vendor_id || null,
      };

      const result = await withOfflineQueue("punch-item", payload, () =>
        createPunchItem({ data: payload as any }),
      );

      if ("queued" in result) {
        setDialogOpen(false);
      } else if (result.success) {
        toast.success("Punch item created");
        setDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["punchItems"] });
        queryClient.invalidateQueries({ queryKey: ["zoneReadiness"] });
      } else {
        toast.error(result.error ?? "Failed to create punch item");
      }
    } catch {
      toast.error("Failed to create punch item");
    }
    setSaving(false);
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      const result = await updatePunchItemStatus({ data: { id, status } as any });
      if (result.success) {
        toast.success(`Status updated to ${status}`);
        queryClient.invalidateQueries({ queryKey: ["punchItems"] });
        queryClient.invalidateQueries({ queryKey: ["zoneReadiness"] });
      } else {
        toast.error(result.error ?? "Failed to update status");
      }
    } catch {
      toast.error("Failed to update status");
    }
  }

  return (
    <AppShell title="Punch List" subtitle="Snag tracking with zone readiness for handover">
      <div className="mb-4 flex items-center justify-end">
        <SectionTour sectionKey="punch-list" steps={tourSteps} />
      </div>
      {/* Admin: Zone readiness progress bars */}
      {isAdmin && readinessData && (readinessData as any).zones && (
        <div className="mb-6 space-y-3" data-tour="pl-readiness">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Zone Readiness Summary</p>
            <div className="text-right">
              <span className="text-2xl font-bold">
                {(readinessData as any).overall?.overall_readiness_pct ?? 0}%
              </span>
              <span className="ml-2 text-xs text-muted-foreground">overall</span>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(readinessData as any).zones.map((z: any) => (
              <Card key={z.zone} className="p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{z.zone}</p>
                  <span className="text-xs text-muted-foreground">
                    {z.resolved_items}/{z.total_items} resolved
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-all ${
                      z.readiness_pct >= 80
                        ? "bg-success"
                        : z.readiness_pct >= 50
                          ? "bg-warning"
                          : "bg-destructive"
                    }`}
                    style={{ width: `${z.readiness_pct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {z.readiness_pct}% ready · {z.verified_items} verified
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 pl-9"
            data-tour="pl-search-input"
          />
        </div>
        <Select value={zoneFilter} onValueChange={setZoneFilter}>
          <SelectTrigger className="w-36" data-tour="pl-zone-filter">
            <SelectValue placeholder="Zone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All zones</SelectItem>
            {Object.keys(zoneGroups).map((z) => (
              <SelectItem key={z} value={z}>
                {z}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36" data-tour="pl-status-filter">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="Open">Open</SelectItem>
            <SelectItem value="In Progress">In Progress</SelectItem>
            <SelectItem value="Resolved">Resolved</SelectItem>
            <SelectItem value="Verified">Verified</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={openCreate} className="ml-auto" data-tour="pl-create">
          <Plus className="mr-1.5 size-4" /> Raise punch item
        </Button>
      </div>

      {/* Punch items grouped by zone */}
      {isLoading && (
        <Card className="p-8 text-center">
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        </Card>
      )}
      {!isLoading && items.length === 0 && (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          No punch items. Click "Raise punch item" to add one.
        </Card>
      )}

      {Object.entries(zoneGroups).map(([zone, zoneItems]) => (
        <div key={zone} className="mb-6">
          <p className="mb-2 text-sm font-semibold text-muted-foreground">
            {zone} <span className="text-xs">({zoneItems.length})</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {zoneItems.map((item: any) => (
              <Card key={item.id} className="flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.description}</p>
                    {item.room && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.room}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusPill tone={STATUS_TONE[item.status] ?? "neutral"}>
                      {item.status}
                    </StatusPill>
                    <StatusPill tone={SEVERITY_TONE[item.severity] ?? "neutral"}>
                      {item.severity}
                    </StatusPill>
                  </div>
                </div>

                {item.photo_path && (
                  <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Camera className="size-3" /> Photo attached
                  </div>
                )}

                <div className="mt-auto flex items-center gap-2 pt-3">
                  <span className="text-xs text-muted-foreground">
                    {new Date(item.created_at).toLocaleDateString("en-IN")}
                  </span>
                  <Select value={item.status} onValueChange={(v) => handleStatusChange(item.id, v)}>
                    <SelectTrigger
                      className="ml-auto h-7 w-32 text-xs"
                      data-tour="pl-status-change"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Open">Open</SelectItem>
                      <SelectItem value="In Progress">In Progress</SelectItem>
                      <SelectItem value="Resolved">Resolved</SelectItem>
                      {isAdmin && <SelectItem value="Verified">Verified</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Raise punch item</DialogTitle>
            <DialogDescription>Record a snag or defect for resolution</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pn-zone">Zone *</Label>
                <Input
                  id="pn-zone"
                  value={form.zone}
                  onChange={(e) => setForm({ ...form, zone: e.target.value })}
                  placeholder="e.g. ICU Wing"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pn-room">Room</Label>
                <Input
                  id="pn-room"
                  value={form.room}
                  onChange={(e) => setForm({ ...form, room: e.target.value })}
                  placeholder="Room number"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pn-desc">Description *</Label>
              <Textarea
                id="pn-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe the defect..."
                rows={3}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select
                  value={form.severity}
                  onValueChange={(v) => setForm({ ...form, severity: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Low">Low</SelectItem>
                    <SelectItem value="Medium">Medium</SelectItem>
                    <SelectItem value="High">High</SelectItem>
                    <SelectItem value="Critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Assign vendor</Label>
                <Select
                  value={form.assigned_vendor_id}
                  onValueChange={(v) => setForm({ ...form, assigned_vendor_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
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
            </div>
            <div className="space-y-2">
              <Label>Photo</Label>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadingPhoto}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingPhoto ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1.5 size-4" />
                  )}
                  Upload photo
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
                {photoPath && (
                  <span className="text-xs text-success">
                    <CheckCircle2 className="mr-1 inline size-3" /> Attached
                  </span>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || uploadingPhoto}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              Raise item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
