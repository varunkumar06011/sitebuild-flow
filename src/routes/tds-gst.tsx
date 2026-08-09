// TDS / GST compliance tracker — tax deduction records, input credit, e-way bills and filing status.
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
import { fetchTdsGstRecords, createTdsGstRecord, updateTdsGstRecord } from "@/lib/api/tds-gst";
import { fetchVendors } from "@/lib/api/vendors";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Plus, Pencil, Loader2, Search, FileText, Receipt, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/tds-gst")({
  head: () => ({
    meta: [
      { title: "TDS & GST Compliance — Meditrust ERP" },
      {
        name: "description",
        content:
          "TDS deduction records, GST input credit tracking, e-way bills and filing status by period.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: TdsGstPage,
});

const STATUS_TONE: Record<string, "warning" | "success" | "info"> = {
  Pending: "warning",
  Filed: "info",
  Reconciled: "success",
};

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

// Main TDS/GST page with summary, filterable records table and create/edit dialog.
function TdsGstPage() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["tds-gst"],
    queryFn: () => fetchTdsGstRecords({}),
  });
  const records = (data?.data ?? []) as any[];
  const summary = (data as any)?.summary;

  const { data: vendorData } = useQuery({
    queryKey: ["vendors-list"],
    queryFn: () => fetchVendors({}),
  });
  const vendors = (vendorData?.data ?? []) as any[];

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    vendor_id: "",
    record_type: "TDS" as string,
    invoice_number: "",
    invoice_amount: "",
    tds_section: "194C" as string,
    tds_rate: "",
    tds_amount: "",
    gst_rate: "",
    gst_input_credit: "",
    eway_bill_number: "",
    eway_bill_date: "",
    period: `${new Date().getFullYear()}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}`,
    status: "Pending" as string,
    notes: "",
  });

  const openCreate = () => {
    setEditing(null);
    setForm({
      vendor_id: "",
      record_type: "TDS",
      invoice_number: "",
      invoice_amount: "",
      tds_section: "194C",
      tds_rate: "",
      tds_amount: "",
      gst_rate: "",
      gst_input_credit: "",
      eway_bill_number: "",
      eway_bill_date: "",
      period: `${new Date().getFullYear()}-Q${Math.ceil((new Date().getMonth() + 1) / 3)}`,
      status: "Pending",
      notes: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      vendor_id: r.vendor_id ?? "",
      record_type: r.record_type ?? "TDS",
      invoice_number: r.invoice_number ?? "",
      invoice_amount: r.invoice_amount != null ? String(r.invoice_amount) : "",
      tds_section: r.tds_section ?? "194C",
      tds_rate: r.tds_rate != null ? String(r.tds_rate) : "",
      tds_amount: r.tds_amount != null ? String(r.tds_amount) : "",
      gst_rate: r.gst_rate != null ? String(r.gst_rate) : "",
      gst_input_credit: r.gst_input_credit != null ? String(r.gst_input_credit) : "",
      eway_bill_number: r.eway_bill_number ?? "",
      eway_bill_date: r.eway_bill_date ? new Date(r.eway_bill_date).toISOString().slice(0, 10) : "",
      period: r.period ?? "",
      status: r.status ?? "Pending",
      notes: r.notes ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.vendor_id) {
      toast.error("Vendor is required");
      return;
    }
    if (!form.invoice_amount) {
      toast.error("Invoice amount is required");
      return;
    }
    setSaving(true);
    try {
      const isTds = form.record_type === "TDS";
      const payload = {
        vendor_id: form.vendor_id,
        record_type: form.record_type as "TDS" | "GST",
        invoice_number: form.invoice_number.trim() || undefined,
        invoice_amount: Number(form.invoice_amount),
        tds_section: isTds
          ? (form.tds_section as "194C" | "194J" | "194Q" | "194I" | "Other")
          : undefined,
        tds_rate: isTds && form.tds_rate ? Number(form.tds_rate) : undefined,
        tds_amount: isTds ? Number(form.tds_amount || 0) : 0,
        gst_rate: !isTds && form.gst_rate ? Number(form.gst_rate) : undefined,
        gst_input_credit: !isTds ? Number(form.gst_input_credit || 0) : 0,
        eway_bill_number: form.eway_bill_number.trim() || undefined,
        eway_bill_date: form.eway_bill_date || undefined,
        period: form.period,
        status: form.status as "Pending" | "Filed" | "Reconciled",
        notes: form.notes.trim() || undefined,
      };

      if (editing) {
        const result = await updateTdsGstRecord({ id: editing.id, ...payload });
        if (result.success) {
          toast.success("Record updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["tds-gst"] });
        } else {
          toast.error(result.error ?? "Failed to update record");
        }
      } else {
        const result = await createTdsGstRecord(payload);
        if (result.success) {
          toast.success("Record created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["tds-gst"] });
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
    if (filterType !== "all" && r.record_type !== filterType) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      r.invoice_number?.toLowerCase().includes(s) ||
      r.eway_bill_number?.toLowerCase().includes(s) ||
      r.vendor_name?.toLowerCase().includes(s) ||
      r.period?.toLowerCase().includes(s)
    );
  });

  return (
    <AppShell
      title="TDS & GST compliance"
      subtitle="Tax deduction, input credit, e-way bills and filing status"
    >
      {/* Summary cards */}
      {summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Receipt className="size-4" />
              <p className="text-xs font-medium">TDS deducted</p>
            </div>
            <p className="mt-2 text-2xl font-bold">₹{formatINR(summary.tds_total)}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <FileText className="size-4" />
              <p className="text-xs font-medium">GST input credit</p>
            </div>
            <p className="mt-2 text-2xl font-bold">₹{formatINR(summary.gst_input_credit_total)}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ShieldCheck className="size-4" />
              <p className="text-xs font-medium">Filed / Reconciled</p>
            </div>
            <p className="mt-2 text-2xl font-bold">
              {summary.filed + summary.reconciled}
              <span className="text-sm text-muted-foreground"> / {records.length}</span>
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4" />
              <p className="text-xs font-medium">Pending filing</p>
            </div>
            <p className="mt-2 text-2xl font-bold text-warning">{summary.pending}</p>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search invoice / e-way bill..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56 pl-9"
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="TDS">TDS</SelectItem>
              <SelectItem value="GST">GST</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All status</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Filed">Filed</SelectItem>
              <SelectItem value="Reconciled">Reconciled</SelectItem>
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
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Vendor</th>
                <th className="px-4 py-3 font-medium">Invoice</th>
                <th className="px-4 py-3 text-right font-medium">Invoice ₹</th>
                <th className="px-4 py-3 font-medium">TDS / GST</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">E-way bill</th>
                <th className="px-4 py-3 font-medium">Period</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    No records. Click "Add record" to create one.
                  </td>
                </tr>
              )}
              {filtered.map((r: any) => (
                <tr key={r.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${r.record_type === "TDS" ? "bg-info/10 text-info" : "bg-success/10 text-success"}`}
                    >
                      {r.record_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{r.vendor_name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.invoice_number ?? "—"}</td>
                  <td className="px-4 py-3 text-right">₹{formatINR(r.invoice_amount ?? 0)}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.record_type === "TDS" ? (
                      <span>
                        {r.tds_section} @ {r.tds_rate}%
                      </span>
                    ) : (
                      <span>GST @ {r.gst_rate}%</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    ₹{formatINR(r.record_type === "TDS" ? r.tds_amount : r.gst_input_credit)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {r.eway_bill_number ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">{r.period}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={STATUS_TONE[r.status] ?? "warning"}>{r.status}</StatusPill>
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
            <DialogTitle>{editing ? "Edit record" : "Add TDS/GST record"}</DialogTitle>
            <DialogDescription>Record a TDS deduction or GST input credit entry.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Record type</Label>
                <Select
                  value={form.record_type}
                  onValueChange={(v) => setForm({ ...form, record_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TDS">TDS</SelectItem>
                    <SelectItem value="GST">GST</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-vendor">Vendor *</Label>
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
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="t-inv">Invoice number</Label>
                <Input
                  id="t-inv"
                  value={form.invoice_number}
                  onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                  placeholder="Invoice ref"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-amt">Invoice amount (₹) *</Label>
                <Input
                  id="t-amt"
                  type="number"
                  value={form.invoice_amount}
                  onChange={(e) => setForm({ ...form, invoice_amount: e.target.value })}
                  placeholder="1840000"
                />
              </div>
            </div>

            {form.record_type === "TDS" ? (
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>TDS section</Label>
                  <Select
                    value={form.tds_section}
                    onValueChange={(v) => setForm({ ...form, tds_section: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="194C">194C (Works)</SelectItem>
                      <SelectItem value="194J">194J (Professional)</SelectItem>
                      <SelectItem value="194Q">194Q (Purchase)</SelectItem>
                      <SelectItem value="194I">194I (Rent)</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="t-rate">TDS rate (%)</Label>
                  <Input
                    id="t-rate"
                    type="number"
                    step="0.1"
                    value={form.tds_rate}
                    onChange={(e) => setForm({ ...form, tds_rate: e.target.value })}
                    placeholder="1.5"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="t-tds">TDS amount (₹)</Label>
                  <Input
                    id="t-tds"
                    type="number"
                    value={form.tds_amount}
                    onChange={(e) => setForm({ ...form, tds_amount: e.target.value })}
                    placeholder="27600"
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="t-gstr">GST rate (%)</Label>
                  <Input
                    id="t-gstr"
                    type="number"
                    step="0.1"
                    value={form.gst_rate}
                    onChange={(e) => setForm({ ...form, gst_rate: e.target.value })}
                    placeholder="18"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="t-gst">Input credit (₹)</Label>
                  <Input
                    id="t-gst"
                    type="number"
                    value={form.gst_input_credit}
                    onChange={(e) => setForm({ ...form, gst_input_credit: e.target.value })}
                    placeholder="331200"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="t-eway">E-way bill number</Label>
                <Input
                  id="t-eway"
                  value={form.eway_bill_number}
                  onChange={(e) => setForm({ ...form, eway_bill_number: e.target.value })}
                  placeholder="EWB-381000123"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-ewayd">E-way bill date</Label>
                <Input
                  id="t-ewayd"
                  type="date"
                  value={form.eway_bill_date}
                  onChange={(e) => setForm({ ...form, eway_bill_date: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="t-period">Period</Label>
                <Input
                  id="t-period"
                  value={form.period}
                  onChange={(e) => setForm({ ...form, period: e.target.value })}
                  placeholder="2026-Q1"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Filed">Filed</SelectItem>
                    <SelectItem value="Reconciled">Reconciled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="t-notes">Notes</Label>
              <Textarea
                id="t-notes"
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
