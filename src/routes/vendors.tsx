// Vendor management page for maintaining vendor master data, payments, outstanding tracking and proof of bill.
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
  fetchVendors,
  createVendor,
  updateVendor,
  fetchVendorPayments,
  fetchAllVendorPayments,
  addVendorPayment,
  fetchApprovableUsers,
  fetchMaterialCategories,
  createMaterialCategory,
} from "@/lib/api/vendors";
import { uploadFile, getSignedUrl } from "@/lib/api/storage";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { inr } from "@/lib/erp-data";
import { toast } from "sonner";
import { Plus, Search, Building2, Pencil, IndianRupee, FileText, Eye, Upload, X } from "lucide-react";

const PAYMENT_METHODS = ["Cash", "Cheque", "UPI", "NEFT", "RTGS", "IMPS"] as const;

export const Route = createFileRoute("/vendors")({
  head: () => ({
    meta: [
      { title: "Vendor Management — Meditrust ERP" },
      {
        name: "description",
        content: "Manage vendor master data with materials, payments, outstanding tracking and proof of bill.",
      },
    ],
  }),
  beforeLoad: async () => { await requireAuth(); },
  component: VendorsPage,
});

// Main vendor page with searchable vendor table, add/edit dialog, payment recording and history.
function VendorsPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({
    name: "",
    gst_number: "",
    address: "",
    city: "",
    state: "",
    pincode: "",
    phone: "",
    email: "",
    materials_purchased: "",
    total_amount: "",
    payment_method: "",
  });
  const [saving, setSaving] = useState(false);

  // Material category state
  const [newCategory, setNewCategory] = useState("");
  const [creatingCategory, setCreatingCategory] = useState(false);

  // Payment dialog state
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentVendor, setPaymentVendor] = useState<any | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_type: "",
    approved_by: "",
    notes: "",
  });
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofUploading, setProofUploading] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);

  // Payment history dialog state
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyVendor, setHistoryVendor] = useState<any | null>(null);

  // All payments view (admin+)
  const [allPaymentsOpen, setAllPaymentsOpen] = useState(false);

  const canManage = role !== "Supervisor";

  const { data: vendorData } = useQuery({
    queryKey: ["vendors", search],
    queryFn: () => fetchVendors({ data: search ? { search } : {} }),
  });
  const vendors = vendorData?.data ?? [];

  const { data: approversData } = useQuery({
    queryKey: ["approvable-users"],
    queryFn: () => fetchApprovableUsers({ data: {} }),
    enabled: canManage,
  });
  const approvers = approversData?.data ?? [];

  const { data: categoriesData } = useQuery({
    queryKey: ["material-categories"],
    queryFn: () => fetchMaterialCategories({ data: {} }),
    enabled: canManage,
  });
  const categories = categoriesData?.data ?? [];

  const { data: allPaymentsData } = useQuery({
    queryKey: ["all-vendor-payments"],
    queryFn: () => fetchAllVendorPayments({ data: {} }),
    enabled: allPaymentsOpen && canManage,
  });
  const allPayments = allPaymentsData?.data ?? [];

  const { data: historyData } = useQuery({
    queryKey: ["vendor-payments", historyVendor?.id],
    queryFn: () => fetchVendorPayments({ data: { vendorId: historyVendor.id } }),
    enabled: !!historyVendor && historyDialogOpen,
  });
  const historyPayments = historyData?.data ?? [];

// Opens the vendor create dialog with an empty form.
  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", gst_number: "", address: "", city: "", state: "", pincode: "", phone: "", email: "", materials_purchased: "", total_amount: "", payment_method: "" });
    setNewCategory("");
    setDialogOpen(true);
  };

// Opens the vendor edit dialog pre-filled with the selected vendor's data.
  const openEdit = (v: any) => {
    setEditing(v);
    setForm({
      name: v.name ?? "",
      gst_number: v.gst_number ?? "",
      address: v.address ?? "",
      city: v.city ?? "",
      state: v.state ?? "",
      pincode: v.pincode ?? "",
      phone: v.phone ?? "",
      email: v.email ?? "",
      materials_purchased: v.materials_purchased ?? "",
      total_amount: v.total_amount != null ? String(v.total_amount) : "",
      payment_method: v.payment_method ?? "",
    });
    setNewCategory("");
    setDialogOpen(true);
  };

// Creates a new material category via the API and selects it in the vendor form.
  const handleCreateCategory = async () => {
    if (!newCategory.trim()) {
      toast.error("Enter a category name");
      return;
    }
    setCreatingCategory(true);
    try {
      const result = await createMaterialCategory({ data: { name: newCategory.trim() } });
      if (result.success) {
        toast.success("Category created");
        setForm({ ...form, materials_purchased: result.name });
        setNewCategory("");
        queryClient.invalidateQueries({ queryKey: ["material-categories"] });
      } else {
        toast.error(result.error ?? "Failed to create category");
      }
    } catch (err: any) {
      console.error("createMaterialCategory client error:", err);
      const msg = err?.message || "Failed to create category";
      toast.error(msg);
    }
    setCreatingCategory(false);
  };

// Saves the vendor form, creating a new vendor or updating an existing one.
  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Vendor name is required");
      return;
    }
    setSaving(true);
    try {
      const payload: any = {
        name: form.name.trim(),
        gst_number: form.gst_number.trim() || undefined,
        address: form.address.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        materials_purchased: form.materials_purchased.trim() || undefined,
        total_amount: form.total_amount ? Number(form.total_amount) : 0,
        payment_method: form.payment_method || undefined,
      };

      if (editing) {
        const result = await updateVendor({ data: { id: editing.id, ...payload } });
        if (result.success) {
          toast.success("Vendor updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["vendors"] });
        } else {
          toast.error(result.error ?? "Failed to update vendor");
        }
      } else {
        const result = await createVendor({ data: payload });
        if (result.success) {
          toast.success("Vendor created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["vendors"] });
        } else {
          toast.error(result.error ?? "Failed to create vendor");
        }
      }
    } catch {
      toast.error("Failed to save vendor");
    }
    setSaving(false);
  };

// Opens the add-payment dialog for the selected vendor.
  const openAddPayment = (v: any) => {
    setPaymentVendor(v);
    setPaymentForm({ amount: "", payment_type: "", approved_by: "", notes: "" });
    setProofFile(null);
    setPaymentDialogOpen(true);
  };

// Opens the payment history dialog for the selected vendor.
  const openPaymentHistory = (v: any) => {
    setHistoryVendor(v);
    setHistoryDialogOpen(true);
  };

// Uploads payment proof, records the vendor payment and refreshes vendor/payment queries.
  const handlePaymentSave = async () => {
    if (!paymentVendor) return;
    if (!paymentForm.amount || Number(paymentForm.amount) <= 0) {
      toast.error("Enter a valid payment amount");
      return;
    }
    if (!paymentForm.payment_type) {
      toast.error("Select a payment type");
      return;
    }
    if (!paymentForm.approved_by) {
      toast.error("Select who approved this payment");
      return;
    }
    if (!proofFile) {
      toast.error("Proof of bill is mandatory — upload a file");
      return;
    }

    setProofUploading(true);
    try {
      const fileExt = proofFile.name.split(".").pop();
      const filePath = `vendor-payments/${paymentVendor.id}/${Date.now()}.${fileExt}`;
      const fileBuffer = await proofFile.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));

      const uploadResult = await uploadFile({
        data: {
          bucket: "documents",
          path: filePath,
          contentType: proofFile.type || "application/pdf",
          fileData: base64,
        },
      });

      if (!uploadResult.success) {
        toast.error(uploadResult.error ?? "Failed to upload proof");
        setProofUploading(false);
        return;
      }

      setProofUploading(false);
      setPaymentSaving(true);

      const result = await addVendorPayment({
        data: {
          vendor_id: paymentVendor.id,
          amount: Number(paymentForm.amount),
          payment_type: paymentForm.payment_type as typeof PAYMENT_METHODS[number],
          approved_by: paymentForm.approved_by,
          proof_path: filePath,
          notes: paymentForm.notes.trim() || undefined,
        },
      });

      if (result.success) {
        toast.success("Payment recorded successfully");
        setPaymentDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["vendors"] });
        queryClient.invalidateQueries({ queryKey: ["vendor-payments", paymentVendor.id] });
        queryClient.invalidateQueries({ queryKey: ["all-vendor-payments"] });
      } else {
        toast.error(result.error ?? "Failed to record payment");
      }
    } catch {
      toast.error("Failed to process payment");
      setProofUploading(false);
    }
    setPaymentSaving(false);
  };

// Generates a signed URL and opens the payment proof file in a new tab.
  const handleViewProof = async (proofPath: string) => {
    const result = await getSignedUrl({ data: { bucket: "documents", path: proofPath } });
    if (result.success && result.url) {
      window.open(result.url, "_blank");
    } else {
      toast.error("Failed to generate file URL");
    }
  };

  return (
    <AppShell title="Vendor management" subtitle="Vendor master data with materials, payments & outstanding tracking">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search vendors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64 pl-9"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canManage && (
              <Button variant="outline" size="sm" onClick={() => setAllPaymentsOpen(true)}>
                <Eye className="mr-1.5 size-4" /> All payments
              </Button>
            )}
            {canManage && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="mr-1.5 size-4" /> Add vendor
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4">
          {/* Desktop table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 font-semibold">Name</th>
                  <th className="pb-2 font-semibold">Materials</th>
                  <th className="pb-2 text-right font-semibold">Total</th>
                  <th className="pb-2 text-right font-semibold">Paid</th>
                  <th className="pb-2 text-right font-semibold">Outstanding</th>
                  <th className="pb-2 font-semibold">Method</th>
                  {canManage && <th className="pb-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {vendors.length === 0 && (
                  <tr>
                    <td colSpan={canManage ? 7 : 6} className="py-8 text-center text-muted-foreground">
                      No vendors found.
                    </td>
                  </tr>
                )}
                {vendors.map((v: any) => (
                  <tr key={v.id} className="align-middle">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <Building2 className="size-4 text-muted-foreground" />
                        <div>
                          <span className="font-medium">{v.name}</span>
                          {v.gst_number && (
                            <p className="font-mono text-xs text-muted-foreground">{v.gst_number}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 text-muted-foreground">{v.materials_purchased ?? "—"}</td>
                    <td className="py-3 text-right font-mono font-semibold">{inr(v.total_amount ?? 0)}</td>
                    <td className="py-3 text-right font-mono text-success">{inr(v.amount_paid ?? 0)}</td>
                    <td className="py-3 text-right font-mono">
                      <span className={(v.outstanding_amount ?? 0) > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}>
                        {inr(v.outstanding_amount ?? 0)}
                      </span>
                    </td>
                    <td className="py-3 text-muted-foreground">{v.payment_method ?? "—"}</td>
                    {canManage && (
                      <td className="py-3">
                        <div className="flex items-center justify-end gap-1">
                          {(v.outstanding_amount ?? 0) > 0 && (
                            <Button variant="ghost" size="sm" onClick={() => openAddPayment(v)} title="Add payment">
                              <IndianRupee className="size-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => openPaymentHistory(v)} title="Payment history">
                            <FileText className="size-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(v)} title="Edit vendor">
                            <Pencil className="size-3.5" />
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {vendors.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">No vendors found.</p>
            )}
            {vendors.map((v: any) => (
              <div key={v.id} className="rounded-xl border border-border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="size-4 text-muted-foreground" />
                    <div>
                      <span className="font-medium">{v.name}</span>
                      {v.gst_number && (
                        <p className="font-mono text-xs text-muted-foreground">{v.gst_number}</p>
                      )}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1">
                      {(v.outstanding_amount ?? 0) > 0 && (
                        <Button variant="ghost" size="sm" className="size-8 p-0" onClick={() => openAddPayment(v)} aria-label="Add payment">
                          <IndianRupee className="size-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" className="size-8 p-0" onClick={() => openPaymentHistory(v)} aria-label="Payment history">
                        <FileText className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="size-8 p-0" onClick={() => openEdit(v)} aria-label="Edit vendor">
                        <Pencil className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
                {v.materials_purchased && (
                  <p className="mb-2 text-xs text-muted-foreground">{v.materials_purchased}</p>
                )}
                <div className="grid grid-cols-3 gap-2 border-t border-border pt-2 text-center text-xs">
                  <div><p className="text-muted-foreground">Total</p><p className="font-mono font-semibold">{inr(v.total_amount ?? 0)}</p></div>
                  <div><p className="text-muted-foreground">Paid</p><p className="font-mono text-success">{inr(v.amount_paid ?? 0)}</p></div>
                  <div>
                    <p className="text-muted-foreground">Outstanding</p>
                    <p className={`font-mono ${(v.outstanding_amount ?? 0) > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                      {inr(v.outstanding_amount ?? 0)}
                    </p>
                  </div>
                </div>
                {v.payment_method && (
                  <p className="mt-2 text-xs text-muted-foreground">Method: {v.payment_method}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Add/Edit Vendor Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit vendor" : "Add vendor"}</DialogTitle>
            <DialogDescription>
              {editing ? "Update vendor details" : "Enter vendor master data with materials & payment info"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="vname">Name *</Label>
              <Input id="vname" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vmat">Materials purchased (category) *</Label>
              <div className="flex items-center gap-2">
                <Select value={form.materials_purchased} onValueChange={(val) => setForm({ ...form, materials_purchased: val })}>
                  <SelectTrigger id="vmat" className="flex-1">
                    <SelectValue placeholder="Select material category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c: any) => (
                      <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="...or type a new category and click Add"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={creatingCategory || !newCategory.trim()}
                  onClick={handleCreateCategory}
                >
                  <Plus className="mr-1 size-3.5" /> Add
                </Button>
              </div>
              {form.materials_purchased && (
                <p className="text-xs text-muted-foreground">
                  Selected: <span className="font-medium text-foreground">{form.materials_purchased}</span>
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vamt">Total amount (₹)</Label>
                <Input id="vamt" type="number" value={form.total_amount} onChange={(e) => setForm({ ...form, total_amount: e.target.value })} placeholder="0" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vpm">Payment method</Label>
                <Select value={form.payment_method} onValueChange={(val) => setForm({ ...form, payment_method: val })}>
                  <SelectTrigger id="vpm">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vgst">GST number</Label>
                <Input id="vgst" value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vphone">Phone</Label>
                <Input id="vphone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vaddr">Address</Label>
              <Input id="vaddr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vcity">City</Label>
                <Input id="vcity" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vstate">State</Label>
                <Input id="vstate" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vpin">Pincode</Label>
                <Input id="vpin" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vemail">Email</Label>
              <Input id="vemail" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button disabled={saving} onClick={handleSave}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record payment — {paymentVendor?.name}</DialogTitle>
            <DialogDescription>
              Outstanding: {inr(paymentVendor?.outstanding_amount ?? 0)} · All fields including proof of bill are mandatory
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="pamt">Amount paid (₹) *</Label>
              <Input id="pamt" type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} placeholder="Enter amount" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ptype">Payment type *</Label>
                <Select value={paymentForm.payment_type} onValueChange={(val) => setPaymentForm({ ...paymentForm, payment_type: val })}>
                  <SelectTrigger id="ptype">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pappr">Approved by *</Label>
                <Select value={paymentForm.approved_by} onValueChange={(val) => setPaymentForm({ ...paymentForm, approved_by: val })}>
                  <SelectTrigger id="pappr">
                    <SelectValue placeholder="Select approver" />
                  </SelectTrigger>
                  <SelectContent>
                    {approvers.map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({a.role})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pproof">Proof of bill *</Label>
              {!proofFile ? (
                <label
                  htmlFor="pproof"
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input bg-muted/30 px-4 py-6 text-center transition-colors hover:border-primary hover:bg-muted/50"
                >
                  <Upload className="size-6 text-muted-foreground" />
                  <span className="text-sm font-medium">Click to upload proof</span>
                  <span className="text-xs text-muted-foreground">PDF, JPG, PNG or WebP (max 10 MB)</span>
                  <input
                    id="pproof"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp"
                    className="hidden"
                    onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                  />
                </label>
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="size-5 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{proofFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(proofFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setProofFile(null)}
                  >
                    <X className="size-4 text-destructive" />
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="pnotes">Notes</Label>
              <Textarea id="pnotes" value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} placeholder="Optional notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>Cancel</Button>
            <Button disabled={proofUploading || paymentSaving} onClick={handlePaymentSave}>
              {proofUploading ? "Uploading proof..." : paymentSaving ? "Saving..." : "Record payment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment History Dialog */}
      <Dialog open={historyDialogOpen} onOpenChange={(v) => { setHistoryDialogOpen(v); if (!v) setHistoryVendor(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment history — {historyVendor?.name}</DialogTitle>
            <DialogDescription>
              Total: {inr(historyVendor?.total_amount ?? 0)} · Paid: {inr(historyVendor?.amount_paid ?? 0)} · Outstanding: {inr(historyVendor?.outstanding_amount ?? 0)}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            {historyPayments.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 font-semibold">Date</th>
                        <th className="pb-2 text-right font-semibold">Amount</th>
                        <th className="pb-2 font-semibold">Type</th>
                        <th className="pb-2 font-semibold">Approved by</th>
                        <th className="pb-2 font-semibold">Proof</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {historyPayments.map((p: any) => (
                        <tr key={p.id} className="align-middle">
                          <td className="py-2.5 text-xs text-muted-foreground">
                            {new Date(p.payment_date).toLocaleDateString("en-IN")}
                          </td>
                          <td className="py-2.5 text-right font-mono font-semibold">{inr(p.amount)}</td>
                          <td className="py-2.5">
                            <StatusPill tone="info">{p.payment_type}</StatusPill>
                          </td>
                          <td className="py-2.5 text-xs">
                            <span className="font-medium">{p.approved_by_name}</span>
                            <span className="text-muted-foreground"> ({p.approved_by_role})</span>
                          </td>
                          <td className="py-2.5">
                            <Button variant="ghost" size="sm" onClick={() => handleViewProof(p.proof_path)}>
                              <FileText className="size-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile cards */}
                <div className="space-y-3 sm:hidden">
                  {historyPayments.map((p: any) => (
                    <div key={p.id} className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold">{inr(p.amount)}</span>
                        <StatusPill tone="info">{p.payment_type}</StatusPill>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.payment_date).toLocaleDateString("en-IN")} · {p.approved_by_name} ({p.approved_by_role})
                      </p>
                      <Button variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs" onClick={() => handleViewProof(p.proof_path)}>
                        <FileText className="mr-1 size-3" /> View proof
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* All Payments Dialog (admin+) */}
      <Dialog open={allPaymentsOpen} onOpenChange={setAllPaymentsOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>All vendor payments</DialogTitle>
            <DialogDescription>
              Complete payment log across all vendors — admins can audit here
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            {allPayments.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2 font-semibold">Vendor</th>
                        <th className="pb-2 font-semibold">Date</th>
                        <th className="pb-2 text-right font-semibold">Amount</th>
                        <th className="pb-2 font-semibold">Type</th>
                        <th className="pb-2 font-semibold">Approved by</th>
                        <th className="pb-2 font-semibold">Recorded by</th>
                        <th className="pb-2 font-semibold">Proof</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {allPayments.map((p: any) => (
                        <tr key={p.id} className="align-middle">
                          <td className="py-2.5 font-medium">{p.vendor_name}</td>
                          <td className="py-2.5 text-xs text-muted-foreground">
                            {new Date(p.payment_date).toLocaleDateString("en-IN")}
                          </td>
                          <td className="py-2.5 text-right font-mono font-semibold">{inr(p.amount)}</td>
                          <td className="py-2.5">
                            <StatusPill tone="info">{p.payment_type}</StatusPill>
                          </td>
                          <td className="py-2.5 text-xs">
                            <span className="font-medium">{p.approved_by_name}</span>
                            <span className="text-muted-foreground"> ({p.approved_by_role})</span>
                          </td>
                          <td className="py-2.5 text-xs text-muted-foreground">{p.created_by_name}</td>
                          <td className="py-2.5">
                            <Button variant="ghost" size="sm" onClick={() => handleViewProof(p.proof_path)}>
                              <FileText className="size-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Mobile cards */}
                <div className="space-y-3 sm:hidden">
                  {allPayments.map((p: any) => (
                    <div key={p.id} className="rounded-lg border border-border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="font-medium">{p.vendor_name}</span>
                        <span className="font-mono text-sm font-semibold">{inr(p.amount)}</span>
                      </div>
                      <div className="mb-2 flex items-center gap-2">
                        <StatusPill tone="info">{p.payment_type}</StatusPill>
                        <span className="text-xs text-muted-foreground">
                          {new Date(p.payment_date).toLocaleDateString("en-IN")}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Approved by {p.approved_by_name} ({p.approved_by_role}) · Recorded by {p.created_by_name}
                      </p>
                      <Button variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs" onClick={() => handleViewProof(p.proof_path)}>
                        <FileText className="mr-1 size-3" /> View proof
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
