// Retention money tracking — retention held per vendor/contract with DLP expiry and release alerts.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
  fetchRetentionRecords,
  createRetentionRecord,
  updateRetentionRecord,
} from "@/lib/api/retention";
import { fetchVendors } from "@/lib/api/vendors";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Loader2,
  Search,
  Lock,
  Unlock,
  AlertCircle,
  IndianRupee,
} from "lucide-react";

export const Route = createFileRoute("/retention")({
  head: () => ({
    meta: [
      { title: "Retention Money — Meditrust ERP" },
      {
        name: "description",
        content:
          "Retention money held per vendor/contract with defect liability period tracking and release alerts.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: RetentionPage,
});

const STATUS_TONE: Record<string, "warning" | "success" | "info"> = {
  Held: "warning",
  Eligible: "info",
  Released: "success",
};

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

// Main retention page with summary, release alerts, records table and create/edit dialog.
function RetentionPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["retention"],
    queryFn: () => fetchRetentionRecords({}),
  });
  const records = (data?.data ?? []) as any[];
  const summary = (data as any)?.summary;

  const { data: vendorData } = useQuery({
    queryKey: ["vendors-list"],
    queryFn: () => fetchVendors({}),
  });
  const vendors = (vendorData?.data ?? []) as any[];

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    vendor_id: "",
    contract_ref: "",
    total_contract_value: "",
    retention_percentage: "5",
    retention_held: "",
    retention_released: "0",
    defect_liability_start: "",
    defect_liability_end: "",
    release_status: "Held" as string,
    released_date: "",
    notes: "",
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      vendor_id: "",
      contract_ref: "",
      total_contract_value: "",
      retention_percentage: "5",
      retention_held: "",
      retention_released: "0",
      defect_liability_start: "",
      defect_liability_end: "",
      release_status: "Held",
      released_date: "",
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      vendor_id: r.vendor_id ?? "",
      contract_ref: r.contract_ref ?? "",
      total_contract_value: r.total_contract_value != null ? String(r.total_contract_value) : "",
      retention_percentage: r.retention_percentage != null ? String(r.retention_percentage) : "5",
      retention_held: r.retention_held != null ? String(r.retention_held) : "",
      retention_released: r.retention_released != null ? String(r.retention_released) : "0",
      defect_liability_start: r.defect_liability_start
        ? new Date(r.defect_liability_start).toISOString().slice(0, 10)
        : "",
      defect_liability_end: r.defect_liability_end
        ? new Date(r.defect_liability_end).toISOString().slice(0, 10)
        : "",
      release_status: r.release_status ?? "Held",
      released_date: r.released_date ? new Date(r.released_date).toISOString().slice(0, 10) : "",
      notes: r.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.vendor_id) {
      toast.error("Vendor is required");
      return;
    }
    if (!form.total_contract_value || !form.retention_held) {
      toast.error("Contract value and retention held are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        vendor_id: form.vendor_id,
        contract_ref: form.contract_ref.trim() || undefined,
        total_contract_value: Number(form.total_contract_value),
        retention_percentage: Number(form.retention_percentage),
        retention_held: Number(form.retention_held),
        retention_released: Number(form.retention_released || 0),
        defect_liability_start: form.defect_liability_start || undefined,
        defect_liability_end: form.defect_liability_end || undefined,
        release_status: form.release_status as "Held" | "Eligible" | "Released",
        released_date:
          form.release_status === "Released"
            ? form.released_date || new Date().toISOString()
            : form.released_date || undefined,
        notes: form.notes.trim() || undefined,
      };

      if (editing) {
        const result = await updateRetentionRecord({ id: editing.id, ...payload });
        if (result.success) {
          toast.success("Retention record updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["retention"] });
        } else {
          toast.error(result.error ?? "Failed to update record");
        }
      } else {
        const result = await createRetentionRecord(payload);
        if (result.success) {
          toast.success("Retention record created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["retention"] });
        } else {
          toast.error(result.error ?? "Failed to create record");
        }
      }
    } catch {
      toast.error("Failed to save record");
    }
    setSaving(false);
  };

  const filtered = records.filter((r: any) => {
    if (filterStatus !== "all" && r.release_status !== filterStatus) return false;
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return r.vendor_name?.toLowerCase().includes(s) || r.contract_ref?.toLowerCase().includes(s);
  });

  const eligibleRecords = records.filter((r: any) => r.is_eligible_for_release);

  return (
    <AppShell
      title="Retention money"
      subtitle="Retention held per vendor with defect liability period and release tracking"
    >
      {/* Summary cards */}
      {summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Lock className="size-4" />
              <p className="text-xs font-medium">Balance held</p>
            </div>
            <p className="mt-2 text-2xl font-bold text-warning">₹{formatINR(summary.total_held)}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Unlock className="size-4" />
              <p className="text-xs font-medium">Released</p>
            </div>
            <p className="mt-2 text-2xl font-bold text-success">
              ₹{formatINR(summary.total_released)}
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <AlertCircle className="size-4" />
              <p className="text-xs font-medium">Eligible for release</p>
            </div>
            <p className="mt-2 text-2xl font-bold text-info">{summary.eligible_for_release}</p>
            <p className="text-xs text-muted-foreground">DLP expired</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <IndianRupee className="size-4" />
              <p className="text-xs font-medium">Total retention</p>
            </div>
            <p className="mt-2 text-2xl font-bold">
              ₹{formatINR(summary.total_held + summary.total_released)}
            </p>
          </Card>
        </div>
      )}

      {/* Release alerts */}
      {eligibleRecords.length > 0 && (
        <Card className="mb-4 border-info p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-info">
            <AlertCircle className="size-4" /> {eligibleRecords.length} retention
            {eligibleRecords.length > 1 ? "s" : ""} eligible for release (DLP expired)
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {eligibleRecords.map((r: any) => (
              <span key={r.id} className="rounded-md bg-info/10 px-2 py-1 text-xs">
                {r.vendor_name} — ₹{formatINR(r.balance_held)} · DLP ended{" "}
                {r.defect_liability_end
                  ? new Date(r.defect_liability_end).toLocaleDateString("en-IN")
                  : "—"}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search vendor / contract..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-9"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="Held">Held</SelectItem>
              <SelectItem value="Eligible">Eligible</SelectItem>
              <SelectItem value="Released">Released</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 size-4" /> Add record
        </Button>
      </div>

      {/* Records table */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Vendor</th>
                <th className="px-4 py-3 font-medium">Contract</th>
                <th className="px-4 py-3 text-right font-medium">Contract ₹</th>
                <th className="px-4 py-3 text-right font-medium">Retention %</th>
                <th className="px-4 py-3 text-right font-medium">Held</th>
                <th className="px-4 py-3 text-right font-medium">Released</th>
                <th className="px-4 py-3 text-right font-medium">Balance</th>
                <th className="px-4 py-3 font-medium">DLP end</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    No retention records. Click "Add record" to create one.
                  </td>
                </tr>
              )}
              {filtered.map((r: any) => (
                <tr key={r.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3 font-medium">{r.vendor_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.contract_ref ?? "—"}</td>
                  <td className="px-4 py-3 text-right">
                    ₹{formatINR(r.total_contract_value ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right">{r.retention_percentage}%</td>
                  <td className="px-4 py-3 text-right">₹{formatINR(r.retention_held ?? 0)}</td>
                  <td className="px-4 py-3 text-right text-success">
                    ₹{formatINR(r.retention_released ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-warning">
                    ₹{formatINR(r.balance_held ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.defect_liability_end
                      ? new Date(r.defect_liability_end).toLocaleDateString("en-IN")
                      : "—"}
                    {r.is_eligible_for_release && <span className="ml-1 text-info">●</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill tone={STATUS_TONE[r.release_status] ?? "warning"}>
                      {r.release_status}
                    </StatusPill>
                  </td>
                  <td className="px-4 py-3">
                    <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                      <Pencil className="size-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit retention record" : "Add retention record"}</DialogTitle>
            <DialogDescription>
              Track retention money held per vendor/contract with DLP and release status.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="r-vendor">Vendor *</Label>
                <Select
                  value={form.vendor_id}
                  onValueChange={(v) => setForm({ ...form, vendor_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select vendor" />
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
              <div className="space-y-2">
                <Label htmlFor="r-contract">Contract reference</Label>
                <Input
                  id="r-contract"
                  value={form.contract_ref}
                  onChange={(e) => setForm({ ...form, contract_ref: e.target.value })}
                  placeholder="CON/2026/001"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="r-cv">Contract value (₹) *</Label>
                <Input
                  id="r-cv"
                  type="number"
                  value={form.total_contract_value}
                  onChange={(e) => setForm({ ...form, total_contract_value: e.target.value })}
                  placeholder="1840000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="r-pct">Retention %</Label>
                <Input
                  id="r-pct"
                  type="number"
                  step="0.5"
                  value={form.retention_percentage}
                  onChange={(e) => setForm({ ...form, retention_percentage: e.target.value })}
                  placeholder="5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="r-held">Held (₹) *</Label>
                <Input
                  id="r-held"
                  type="number"
                  value={form.retention_held}
                  onChange={(e) => setForm({ ...form, retention_held: e.target.value })}
                  placeholder="92000"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="r-rel">Released (₹)</Label>
                <Input
                  id="r-rel"
                  type="number"
                  value={form.retention_released}
                  onChange={(e) => setForm({ ...form, retention_released: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Release status</Label>
                <Select
                  value={form.release_status}
                  onValueChange={(v) => setForm({ ...form, release_status: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Held">Held</SelectItem>
                    <SelectItem value="Eligible">Eligible</SelectItem>
                    <SelectItem value="Released">Released</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="r-dls">DLP start</Label>
                <Input
                  id="r-dls"
                  type="date"
                  value={form.defect_liability_start}
                  onChange={(e) => setForm({ ...form, defect_liability_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="r-dle">DLP end</Label>
                <Input
                  id="r-dle"
                  type="date"
                  value={form.defect_liability_end}
                  onChange={(e) => setForm({ ...form, defect_liability_end: e.target.value })}
                />
              </div>
            </div>
            {form.release_status === "Released" && (
              <div className="space-y-2">
                <Label htmlFor="r-rd">Released date</Label>
                <Input
                  id="r-rd"
                  type="date"
                  value={form.released_date}
                  onChange={(e) => setForm({ ...form, released_date: e.target.value })}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="r-notes">Notes</Label>
              <Textarea
                id="r-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Additional notes"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              {editing ? "Update record" : "Create record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
