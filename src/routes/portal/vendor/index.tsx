// Vendor Portal Dashboard — vendor self-service for POs, payments, document uploads, and delivery updates.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { verifyPortalSession, logoutPortal, PORTAL_COOKIE } from "@/lib/api/portal-auth";
import {
  fetchVendorProfile,
  fetchVendorPOs,
  fetchVendorPayments,
  fetchVendorOutstanding,
  updateDeliveryStatus,
  uploadVendorDocument,
} from "@/lib/api/vendor-portal";
import { uploadFile } from "@/lib/api/storage";
import { toast } from "sonner";
import {
  Building2,
  Package,
  IndianRupee,
  FileUp,
  Truck,
  LogOut,
  Loader2,
  Clock,
  AlertCircle,
} from "lucide-react";

export const Route = createFileRoute("/portal/vendor/")({
  head: () => ({
    meta: [{ title: "Vendor Portal — Meditrust ERP" }],
  }),
  beforeLoad: async () => {
    try {
      const result = await verifyPortalSession();
      if (!result.authenticated || result.account?.account_type !== "vendor") {
        throw redirect({ to: "/portal/vendor/login" });
      }
    } catch (err: any) {
      if (err?.status === 307 || err?.name === "RedirectError") throw err;
      throw redirect({ to: "/portal/vendor/login" });
    }
  },
  component: VendorPortalPage,
});

const STAGE_TONE: Record<string, "info" | "warning" | "success" | "danger" | "neutral"> = {
  PR: "neutral",
  Quotation: "neutral",
  Admin: "warning",
  A1: "warning",
  "A1+": "warning",
  PO: "info",
  "Material Received": "info",
  Invoice: "warning",
  Payment: "success",
  Completed: "success",
  Cancelled: "danger",
};

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

function VendorPortalPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("pos");

  const { data: sessionData } = useQuery({
    queryKey: ["portal-session"],
    queryFn: () => verifyPortalSession() as any,
  });
  const account = sessionData?.account;

  const { data: profileData } = useQuery({
    queryKey: ["vendor-profile"],
    queryFn: () => fetchVendorProfile(),
  });
  const profile = profileData?.data;

  const { data: outstandingData } = useQuery({
    queryKey: ["vendor-outstanding"],
    queryFn: () => fetchVendorOutstanding(),
  });
  const outstanding = outstandingData?.data;

  const handleLogout = async () => {
    await logoutPortal();
    document.cookie = `${PORTAL_COOKIE}=; path=/; max-age=0`;
    window.location.href = "/portal/vendor/login";
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-border bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Building2 className="size-6" />
            <div>
              <p className="font-bold">Vendor Portal</p>
              <p className="text-xs text-primary-foreground/70">{profile?.name ?? "Vendor"}</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="text-primary-foreground hover:bg-primary-foreground/10"
          >
            <LogOut className="mr-1.5 size-4" /> Logout
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 p-6">
        {/* Summary cards */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <IndianRupee className="size-4" />
              <p className="text-xs font-medium">Total Committed</p>
            </div>
            <p className="mt-2 text-xl font-bold">₹{formatINR(outstanding?.total_amount ?? 0)}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <IndianRupee className="size-4 text-success" />
              <p className="text-xs font-medium">Paid</p>
            </div>
            <p className="mt-2 text-xl font-bold text-success">
              ₹{formatINR(outstanding?.amount_paid ?? 0)}
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <IndianRupee className="size-4 text-warning" />
              <p className="text-xs font-medium">Outstanding</p>
            </div>
            <p className="mt-2 text-xl font-bold text-warning">
              ₹{formatINR(outstanding?.outstanding_amount ?? 0)}
            </p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="size-4" />
              <p className="text-xs font-medium">Aging (30+ days)</p>
            </div>
            <p className="mt-2 text-xl font-bold">
              ₹
              {formatINR(
                (outstanding?.aging?.days_60 ?? 0) +
                  (outstanding?.aging?.days_90 ?? 0) +
                  (outstanding?.aging?.over_90 ?? 0),
              )}
            </p>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex h-auto flex-wrap gap-1">
            <TabsTrigger value="pos" className="gap-1.5">
              <Package className="size-3.5" /> Purchase Orders
            </TabsTrigger>
            <TabsTrigger value="payments" className="gap-1.5">
              <IndianRupee className="size-3.5" /> Payments
            </TabsTrigger>
            <TabsTrigger value="outstanding" className="gap-1.5">
              <AlertCircle className="size-3.5" /> Outstanding & Aging
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pos">
            <VendorPOsTab />
          </TabsContent>
          <TabsContent value="payments">
            <VendorPaymentsTab />
          </TabsContent>
          <TabsContent value="outstanding">
            <VendorOutstandingTab outstanding={outstanding} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// ============================================================================
// POs Tab
// ============================================================================
function VendorPOsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["vendor-pos"],
    queryFn: () => fetchVendorPOs(),
  });
  const pos = (data?.data ?? []) as any[];

  const [deliveryDialog, setDeliveryDialog] = useState<any | null>(null);
  const [uploadDialog, setUploadDialog] = useState<any | null>(null);

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-4">
        <p className="font-semibold">Your Purchase Orders</p>
        <p className="text-xs text-muted-foreground">
          Update delivery status and upload invoices/challans
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">PR Number</th>
              <th className="px-4 py-3 font-medium">PO Number</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 font-medium">Block</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Stage</th>
              <th className="px-4 py-3 font-medium">Delivery Date</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                </td>
              </tr>
            )}
            {!isLoading && pos.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No purchase orders assigned to you.
                </td>
              </tr>
            )}
            {pos.map((p: any) => (
              <tr key={p.id} className="hover:bg-surface/50">
                <td className="px-4 py-3 font-mono text-xs font-medium">{p.pr_number}</td>
                <td className="px-4 py-3 font-mono text-xs">{p.po_number ?? "—"}</td>
                <td className="px-4 py-3">{p.title}</td>
                <td className="px-4 py-3 text-xs">{p.block ?? "—"}</td>
                <td className="px-4 py-3 text-right font-medium">₹{formatINR(p.amount)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      STAGE_TONE[p.stage] === "success"
                        ? "bg-emerald-100 text-emerald-700"
                        : STAGE_TONE[p.stage] === "warning"
                          ? "bg-amber-100 text-amber-700"
                          : STAGE_TONE[p.stage] === "danger"
                            ? "bg-red-100 text-red-700"
                            : STAGE_TONE[p.stage] === "info"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {p.stage}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">
                  {p.delivery_date ? new Date(p.delivery_date).toLocaleDateString("en-IN") : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {(p.stage === "PO" || p.stage === "Material Received") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeliveryDialog(p)}
                        title="Update delivery"
                      >
                        <Truck className="size-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setUploadDialog(p)}
                      title="Upload document"
                    >
                      <FileUp className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deliveryDialog && (
        <DeliveryDialog po={deliveryDialog} onClose={() => setDeliveryDialog(null)} />
      )}
      {uploadDialog && <UploadDialog po={uploadDialog} onClose={() => setUploadDialog(null)} />}
    </Card>
  );
}

function DeliveryDialog({ po, onClose }: { po: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    delivery_date: po.delivery_date?.slice(0, 10) ?? "",
    quantity_received: po.quantity_received ?? 0,
    notes: "",
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await updateDeliveryStatus({
        requisition_id: po.id,
        delivery_date: form.delivery_date || undefined,
        quantity_received: form.quantity_received || undefined,
      });
      if (result.success) {
        toast.success("Delivery status updated");
        queryClient.invalidateQueries({ queryKey: ["vendor-pos"] });
        onClose();
      } else {
        toast.error(result.error ?? "Failed to update");
      }
    } catch {
      toast.error("Failed to update delivery status");
    }
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Update delivery status — {po.pr_number}</DialogTitle>
          <DialogDescription>
            Update the expected delivery date and quantity received.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Delivery date</Label>
            <Input
              type="date"
              value={form.delivery_date}
              onChange={(e) => setForm({ ...form, delivery_date: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Quantity received</Label>
            <Input
              type="number"
              min="0"
              value={form.quantity_received}
              onChange={(e) => setForm({ ...form, quantity_received: Number(e.target.value) })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Truck className="mr-2 size-4" />
            )}
            Update delivery
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({ po, onClose }: { po: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [docType, setDocType] = useState("invoice");
  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setFileName(file.name);
  };

  const handleUpload = async () => {
    const input = fileInputRef.current;
    const file = input?.files?.[0];
    if (!file) {
      toast.error("Select a file first");
      return;
    }

    setSaving(true);
    try {
      // Convert to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = (reader.result as string).split(",")[1] ?? "";
        const filePath = `vendor-uploads/${po.id}/${docType}-${Date.now()}-${file.name}`;

        const uploadResult = await uploadFile({
            bucket: "documents",
            path: filePath,
            contentType: file.type,
            fileData: base64,
        });

        if (!uploadResult.success) {
          toast.error(uploadResult.error ?? "Upload failed");
          setSaving(false);
          return;
        }

        const result = await uploadVendorDocument({
            requisition_id: po.id,
            doc_type: docType as any,
            file_path: filePath,
            file_name: file.name,
        });

        if (result.success) {
          toast.success("Document uploaded");
          queryClient.invalidateQueries({ queryKey: ["vendor-pos"] });
          onClose();
        } else {
          toast.error(result.error ?? "Failed to link document");
        }
        setSaving(false);
      };
      reader.readAsDataURL(file);
    } catch {
      toast.error("Upload failed");
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document — {po.pr_number}</DialogTitle>
          <DialogDescription>Upload invoices, challans, or MTC for this PO.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Document type</Label>
            <Select value={docType} onValueChange={setDocType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">Invoice</SelectItem>
                <SelectItem value="challan">Challan / Delivery Note</SelectItem>
                <SelectItem value="mtc">Material Test Certificate (MTC)</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>File (PDF, JPG, PNG — max 10MB)</Label>
            <Input
              type="file"
              accept=".pdf,.jpg,.jpeg,.png"
              onChange={handleFileChange}
              ref={fileInputRef}
            />
            {fileName && <p className="text-xs text-muted-foreground">Selected: {fileName}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <FileUp className="mr-2 size-4" />
            )}
            Upload document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Payments Tab
// ============================================================================
function VendorPaymentsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["vendor-payments"],
    queryFn: () => fetchVendorPayments(),
  });
  const payments = (data?.data ?? []) as any[];

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-4">
        <p className="font-semibold">Payment History</p>
        <p className="text-xs text-muted-foreground">All payments made to your account</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Date</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                </td>
              </tr>
            )}
            {!isLoading && payments.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                  No payments recorded yet.
                </td>
              </tr>
            )}
            {payments.map((p: any) => (
              <tr key={p.id} className="hover:bg-surface/50">
                <td className="px-4 py-3 text-xs">
                  {new Date(p.payment_date).toLocaleDateString("en-IN")}
                </td>
                <td className="px-4 py-3 text-right font-medium text-success">
                  ₹{formatINR(p.amount)}
                </td>
                <td className="px-4 py-3 text-xs">{p.payment_type}</td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{p.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ============================================================================
// Outstanding Tab
// ============================================================================
function VendorOutstandingTab({ outstanding }: { outstanding: any }) {
  if (!outstanding) {
    return (
      <Card className="p-8 text-center">
        <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  const aging = outstanding.aging;
  const invoices = outstanding.invoices ?? [];

  return (
    <div className="space-y-4">
      {/* Aging analysis cards */}
      <div className="grid gap-4 sm:grid-cols-5">
        {[
          { label: "Current", amount: aging?.current ?? 0, color: "text-success" },
          { label: "1-30 days", amount: aging?.days_30 ?? 0, color: "text-info" },
          { label: "31-60 days", amount: aging?.days_60 ?? 0, color: "text-warning" },
          { label: "61-90 days", amount: aging?.days_90 ?? 0, color: "text-warning" },
          { label: "90+ days", amount: aging?.over_90 ?? 0, color: "text-destructive" },
        ].map((a) => (
          <Card key={a.label} className="p-4">
            <p className="text-xs font-medium text-muted-foreground">{a.label}</p>
            <p className={`mt-2 text-lg font-bold ${a.color}`}>₹{formatINR(a.amount)}</p>
          </Card>
        ))}
      </div>

      {/* Invoice list */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border p-4">
          <p className="font-semibold">Invoice Aging</p>
          <p className="text-xs text-muted-foreground">Outstanding invoices with aging analysis</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">PR Number</th>
                <th className="px-4 py-3 font-medium">Invoice #</th>
                <th className="px-4 py-3 font-medium">Invoice Date</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Stage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    No outstanding invoices.
                  </td>
                </tr>
              )}
              {invoices.map((inv: any) => (
                <tr key={inv.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3 font-mono text-xs">{inv.pr_number}</td>
                  <td className="px-4 py-3 font-mono text-xs">{inv.invoice_number ?? "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {inv.invoice_date
                      ? new Date(inv.invoice_date).toLocaleDateString("en-IN")
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-medium">
                    ₹{formatINR(inv.invoice_amount ?? inv.amount ?? 0)}
                  </td>
                  <td className="px-4 py-3 text-xs">{inv.stage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
