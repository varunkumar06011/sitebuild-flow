// Safety incidents — report form (Supervisor) + trend dashboard (Admin)
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchIncidents,
  reportIncident,
  updateIncidentStatus,
  getSafetyDashboardStats,
} from "@/lib/api/safety";
import { uploadFile } from "@/lib/api/storage";
import { requireAuth } from "@/lib/auth-guards";
import { useRole } from "@/lib/role-context";
import { useOfflineSync } from "@/lib/useOfflineSync";
import { SectionTour, type TourStep } from "@/components/SectionTour";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Loader2,
  Upload,
  AlertTriangle,
  ShieldAlert,
  TrendingDown,
  Camera,
} from "lucide-react";

export const Route = createFileRoute("/safety")({
  head: () => ({
    meta: [
      { title: "Safety — Meditrust ERP" },
      {
        name: "description",
        content: "Safety incident reporting and trend dashboard.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: SafetyPage,
});

const SEVERITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = {
  Low: "neutral",
  Medium: "info",
  High: "warning",
  Critical: "danger",
};

function SafetyPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const isAdmin = role === "Administrator" || role === "A1" || role === "A1+";
  const { withOfflineQueue } = useOfflineSync();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tourSteps: TourStep[] = isAdmin
    ? [
        {
          selector: '[data-tour="saf-total-reports"]',
          title: "Total Reports",
          description:
            "All safety reports filed — incidents and near-misses combined. Use this to monitor overall safety reporting activity.",
        },
        {
          selector: '[data-tour="saf-open"]',
          title: "Open Incidents",
          description:
            "Incidents still under investigation — if this number stays high, investigations are bottlenecking.",
        },
        {
          selector: '[data-tour="saf-critical"]',
          title: "Critical Incidents",
          description:
            "High-severity incidents requiring immediate attention — any number above zero needs urgent follow-up.",
        },
        {
          selector: '[data-tour="saf-trend"]',
          title: "Trend by Month",
          description:
            "Month-by-month incident and near-miss counts — use this to spot patterns and demonstrate safety improvement over time.",
        },
        {
          selector: '[data-tour="saf-search-input"]',
          title: "Search Incidents",
          description: "Type a contractor name to find incidents involving a specific contractor.",
        },
        {
          selector: '[data-tour="saf-type-filter"]',
          title: "Filter by Type",
          description:
            "Narrow to Incidents only or Near-miss only to analyze one category at a time.",
        },
        {
          selector: '[data-tour="saf-severity-filter"]',
          title: "Filter by Severity",
          description:
            "Show only Low, Medium, High, or Critical incidents to prioritize follow-up actions.",
        },
        {
          selector: '[data-tour="saf-create"]',
          title: "Report Incident",
          description:
            "Log a new safety incident or near-miss with photo evidence and severity rating — do this immediately after the event.",
        },
        {
          selector: '[data-tour="saf-status-change"]',
          title: "Update Incident Status",
          description:
            "Change an incident's status as you investigate and resolve it — keep this current so the dashboard reflects real-time safety posture.",
        },
      ]
    : [
        {
          selector: '[data-tour="saf-search-input"]',
          title: "Search Incidents",
          description: "Type a contractor name to find incidents involving a specific contractor.",
        },
        {
          selector: '[data-tour="saf-type-filter"]',
          title: "Filter by Type",
          description: "Narrow to Incidents only or Near-miss only.",
        },
        {
          selector: '[data-tour="saf-severity-filter"]',
          title: "Filter by Severity",
          description: "Show only Low, Medium, High, or Critical incidents.",
        },
        {
          selector: '[data-tour="saf-create"]',
          title: "Report Incident",
          description:
            "Log a new safety incident or near-miss with photo — works offline and syncs when reconnected. Report immediately after the event.",
        },
        {
          selector: '[data-tour="saf-status-change"]',
          title: "Update Incident Status",
          description:
            "Change an incident's status as you investigate — keep this current so admins can track resolution progress.",
        },
      ];

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoPath, setPhotoPath] = useState<string | null>(null);

  const [form, setForm] = useState({
    type: "Incident" as string,
    zone: "",
    contractor_name: "",
    description: "",
    severity: "Medium" as string,
  });

  const { data: incData, isLoading } = useQuery({
    queryKey: ["safetyIncidents", search, typeFilter, severityFilter],
    queryFn: () =>
      fetchIncidents({
        ...(typeFilter !== "all" && { type: typeFilter }),
        ...(severityFilter !== "all" && { severity: severityFilter }),
        ...(search && { contractorName: search }),
      }),
  });
  const incidents = incData?.data ?? [];

  const { data: dashData } = useQuery({
    queryKey: ["safetyDashboard"],
    queryFn: () => getSafetyDashboardStats(),
    enabled: isAdmin,
  });

  function openCreate() {
    setForm({
      type: "Incident",
      zone: "",
      contractor_name: "",
      description: "",
      severity: "Medium",
    });
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
      const path = `safety/${Date.now()}-${file.name}`;
      const result = await uploadFile({
          bucket: "photos",
          path,
          contentType: file.type || "image/jpeg",
          fileData: base64,
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
    if (!form.description.trim()) {
      toast.error("Description is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        type: form.type,
        zone: form.zone.trim() || undefined,
        contractor_name: form.contractor_name.trim() || undefined,
        description: form.description.trim(),
        photo_path: photoPath ?? undefined,
        severity: form.severity,
      };

      const result = await withOfflineQueue("safety-incident", payload, () =>
        reportIncident(payload as any),
      );

      if ("queued" in result) {
        setDialogOpen(false);
      } else if (result.success) {
        toast.success("Incident reported");
        setDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["safetyIncidents"] });
        queryClient.invalidateQueries({ queryKey: ["safetyDashboard"] });
      } else {
        toast.error(result.error ?? "Failed to report incident");
      }
    } catch {
      toast.error("Failed to report incident");
    }
    setSaving(false);
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      const result = await updateIncidentStatus({ id, status });
      if (result.success) {
        toast.success(`Status updated to ${status}`);
        queryClient.invalidateQueries({ queryKey: ["safetyIncidents"] });
        queryClient.invalidateQueries({ queryKey: ["safetyDashboard"] });
      } else {
        toast.error(result.error ?? "Failed to update status");
      }
    } catch {
      toast.error("Failed to update status");
    }
  }

  const dash = dashData as any;

  return (
    <AppShell title="Safety" subtitle="Incident reporting and safety trend dashboard">
      <div className="mb-4 flex items-center justify-end">
        <SectionTour sectionKey="safety" steps={tourSteps} />
      </div>
      {/* Admin: Dashboard stats */}
      {isAdmin && dash?.summary && (
        <div className="mb-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-4" data-tour="saf-total-reports">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ShieldAlert className="size-4" />
                <span className="text-xs font-medium">Total Reports</span>
              </div>
              <p className="mt-2 text-2xl font-bold">{dash.summary.total_reports}</p>
              <p className="text-xs text-muted-foreground">
                {dash.summary.total_incidents} incidents · {dash.summary.total_near_miss} near-miss
              </p>
            </Card>
            <Card className="p-4" data-tour="saf-open">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="size-4" />
                <span className="text-xs font-medium">Open</span>
              </div>
              <p className="mt-2 text-2xl font-bold">{dash.summary.open_count}</p>
              <p className="text-xs text-muted-foreground">{dash.summary.closed_count} closed</p>
            </Card>
            <Card className="p-4" data-tour="saf-critical">
              <div className="flex items-center gap-2 text-muted-foreground">
                <TrendingDown className="size-4" />
                <span className="text-xs font-medium">Critical</span>
              </div>
              <p className="mt-2 text-2xl font-bold text-destructive">
                {dash.summary.critical_count}
              </p>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Camera className="size-4" />
                <span className="text-xs font-medium">By Severity</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(dash.by_severity ?? {}).map(([sev, count]) => (
                  <StatusPill key={sev} tone={SEVERITY_TONE[sev] ?? "neutral"}>
                    {sev}: {count as number}
                  </StatusPill>
                ))}
              </div>
            </Card>
          </div>

          {/* Trend by month */}
          {Array.isArray(dash.by_month) && dash.by_month.length > 0 && (
            <Card className="p-4" data-tour="saf-trend">
              <p className="mb-3 text-sm font-semibold">Trend by Month</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Incidents</TableHead>
                    <TableHead className="text-right">Near-miss</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dash.by_month.map((m: any) => (
                    <TableRow key={m.month}>
                      <TableCell className="font-medium">{m.month}</TableCell>
                      <TableCell className="text-right">{m.incidents}</TableCell>
                      <TableCell className="text-right">{m.near_miss}</TableCell>
                      <TableCell className="text-right font-semibold">{m.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* By contractor */}
          {Array.isArray(dash.by_contractor) && dash.by_contractor.length > 0 && (
            <Card className="p-4">
              <p className="mb-3 text-sm font-semibold">By Contractor</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contractor</TableHead>
                    <TableHead className="text-right">Incidents</TableHead>
                    <TableHead className="text-right">Near-miss</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dash.by_contractor.map((c: any) => (
                    <TableRow key={c.contractor}>
                      <TableCell className="font-medium">{c.contractor}</TableCell>
                      <TableCell className="text-right">{c.incidents}</TableCell>
                      <TableCell className="text-right">{c.near_miss}</TableCell>
                      <TableCell className="text-right font-semibold">{c.total}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search contractor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-48 pl-9"
            data-tour="saf-search-input"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36" data-tour="saf-type-filter">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="Incident">Incident</SelectItem>
            <SelectItem value="Near-miss">Near-miss</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-36" data-tour="saf-severity-filter">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            <SelectItem value="Low">Low</SelectItem>
            <SelectItem value="Medium">Medium</SelectItem>
            <SelectItem value="High">High</SelectItem>
            <SelectItem value="Critical">Critical</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={openCreate} className="ml-auto" data-tour="saf-create">
          <Plus className="mr-1.5 size-4" /> Report incident
        </Button>
      </div>

      {/* Incident cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading && (
          <Card className="col-span-full p-8 text-center">
            <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
          </Card>
        )}
        {!isLoading && incidents.length === 0 && (
          <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
            No incidents reported. Click "Report incident" to add one.
          </Card>
        )}
        {incidents.map((inc: any) => (
          <Card key={inc.id} className="flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <StatusPill tone={inc.type === "Incident" ? "danger" : "warning"}>
                    {inc.type}
                  </StatusPill>
                  <StatusPill tone={SEVERITY_TONE[inc.severity] ?? "neutral"}>
                    {inc.severity}
                  </StatusPill>
                </div>
                <p className="mt-2 text-sm">{inc.description}</p>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div>
                <dt className="text-muted-foreground">Zone</dt>
                <dd className="font-medium">{inc.zone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Contractor</dt>
                <dd className="font-medium">{inc.contractor_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Reported by</dt>
                <dd className="font-medium">{inc.reported_by_name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Date</dt>
                <dd className="font-medium">
                  {new Date(inc.created_at).toLocaleDateString("en-IN")}
                </dd>
              </div>
            </dl>
            {inc.photo_path && (
              <div className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Camera className="size-3" /> Photo attached
              </div>
            )}
            <div className="mt-auto flex items-center gap-2 pt-3">
              <span className="text-xs text-muted-foreground">{inc.status}</span>
              {isAdmin && (
                <Select value={inc.status} onValueChange={(v) => handleStatusChange(inc.id, v)}>
                  <SelectTrigger className="ml-auto h-7 w-32 text-xs" data-tour="saf-status-change">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Open">Open</SelectItem>
                    <SelectItem value="Investigating">Investigating</SelectItem>
                    <SelectItem value="Resolved">Resolved</SelectItem>
                    <SelectItem value="Closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Report safety incident</DialogTitle>
            <DialogDescription>Record an incident or near-miss</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Incident">Incident</SelectItem>
                    <SelectItem value="Near-miss">Near-miss</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="saf-zone">Zone</Label>
                <Input
                  id="saf-zone"
                  value={form.zone}
                  onChange={(e) => setForm({ ...form, zone: e.target.value })}
                  placeholder="e.g. OT Block"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="saf-con">Contractor</Label>
                <Input
                  id="saf-con"
                  value={form.contractor_name}
                  onChange={(e) => setForm({ ...form, contractor_name: e.target.value })}
                  placeholder="Contractor name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="saf-desc">Description *</Label>
              <Textarea
                id="saf-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Describe what happened..."
                rows={4}
              />
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
                {photoPath && <span className="text-xs text-success">Attached</span>}
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
              Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
