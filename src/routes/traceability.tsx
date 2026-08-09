// Material traceability page showing each batch's full document chain from supplier to installed location.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { DocumentVersionHistory } from "@/components/DocumentVersionHistory";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { fetchBatches, createBatch, updateBatch } from "@/lib/api/batches";
import { uploadFile, getSignedUrl } from "@/lib/api/storage";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Camera, Plus, Upload, Loader2, Pencil, ExternalLink, Trash2 } from "lucide-react";

export const Route = createFileRoute("/traceability")({
  head: () => ({
    meta: [
      { title: "Material Traceability — Meditrust ERP" },
      {
        name: "description",
        content:
          "Trace every batch: supplier, manufacturer, purchase date, invoice, delivery challan, MTC, lab report and photos.",
      },
      { property: "og:title", content: "Material Traceability — Meditrust ERP" },
      {
        property: "og:description",
        content: "Supplier → Batch → Manufacturer → Invoice → Challan → MTC → Lab report → Photos.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: Traceability,
});

const CHAIN = [
  "Supplier",
  "Batch",
  "Manufacturer",
  "Purchase date",
  "Invoice",
  "Delivery challan",
  "MTC",
  "Lab report",
  "Photos",
];

const STATUS_TONE: Record<string, "success" | "danger" | "warning"> = {
  Verified: "success",
  "Pending MTC": "danger",
  "Under Test": "warning",
};

// Main traceability page rendering batch cards with create/edit dialog and photo management.
function Traceability() {
  const queryClient = useQueryClient();
  const { data: batchData } = useQuery({
    queryKey: ["batches"],
    queryFn: () => fetchBatches({}),
  });
  const batches = batchData?.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    batch_number: "",
    material: "",
    supplier: "",
    manufacturer: "",
    purchase_date: "",
    invoice: "",
    challan: "",
    mtc: "",
    lab_report: "",
    status: "Pending MTC" as "Verified" | "Pending MTC" | "Under Test",
  });

  const today = new Date().toISOString().slice(0, 10);
  const batchSuggest = `BAT/${new Date().toLocaleString("en-IN", { month: "short" }).toUpperCase()}/${String(batches.length + 1).padStart(4, "0")}`;

  const openCreate = () => {
    setEditing(null);
    setForm({
      batch_number: batchSuggest,
      material: "",
      supplier: "",
      manufacturer: "",
      purchase_date: today,
      invoice: "",
      challan: "",
      mtc: "",
      lab_report: "",
      status: "Pending MTC",
    });
    setPhotoPaths([]);
    setDialogOpen(true);
  };

  const openEdit = (b: any) => {
    setEditing(b);
    setForm({
      batch_number: b.batch_number ?? "",
      material: b.material ?? "",
      supplier: b.supplier ?? "",
      manufacturer: b.manufacturer ?? "",
      purchase_date: b.purchase_date ? new Date(b.purchase_date).toISOString().slice(0, 10) : "",
      invoice: b.invoice ?? "",
      challan: b.challan ?? "",
      mtc: b.mtc ?? "",
      lab_report: b.lab_report ?? "",
      status: b.status ?? "Pending MTC",
    });
    setPhotoPaths(Array.isArray(b.photos) ? b.photos : []);
    setDialogOpen(true);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploadingPhotos(true);
    try {
      const paths: string[] = [];
      for (const file of files) {
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(",")[1] ?? "");
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const path = `batches/${Date.now()}-${file.name}`;
        const result = await uploadFile({
            bucket: "photos",
            path,
            contentType: file.type || "image/jpeg",
            fileData: base64,
        });
        if (result.success) {
          paths.push(path);
        } else {
          toast.error(`Failed to upload ${file.name}`);
        }
      }
      setPhotoPaths([...photoPaths, ...paths]);
      if (paths.length > 0)
        toast.success(`${paths.length} photo${paths.length > 1 ? "s" : ""} uploaded`);
    } catch {
      toast.error("Photo upload failed");
    }
    setUploadingPhotos(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = (idx: number) => setPhotoPaths(photoPaths.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!form.batch_number.trim()) {
      toast.error("Batch number is required");
      return;
    }
    if (!form.material.trim()) {
      toast.error("Material is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        batch_number: form.batch_number.trim(),
        material: form.material.trim(),
        supplier: form.supplier.trim() || undefined,
        manufacturer: form.manufacturer.trim() || undefined,
        purchase_date: form.purchase_date || undefined,
        invoice: form.invoice.trim() || undefined,
        challan: form.challan.trim() || undefined,
        mtc: form.mtc.trim() || undefined,
        lab_report: form.lab_report.trim() || undefined,
        status: form.status,
        photos: photoPaths,
      };

      if (editing) {
        const result = await updateBatch({ id: editing.id, ...payload });
        if (result.success) {
          toast.success("Batch updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["batches"] });
        } else {
          toast.error(result.error ?? "Failed to update batch");
        }
      } else {
        const result = await createBatch(payload);
        if (result.success) {
          toast.success("Batch registered");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["batches"] });
        } else {
          toast.error(result.error ?? "Failed to register batch");
        }
      }
    } catch {
      toast.error("Failed to save batch");
    }
    setSaving(false);
  };

  const handleViewPhoto = async (path: string) => {
    const tab = window.open("", "_blank");
    const result = await getSignedUrl({ bucket: "photos", path });
    if (result.success && result.url) {
      if (tab) {
        tab.location.href = result.url;
      } else {
        toast.error("Popup blocked — tap to open", {
          action: { label: "Open", onClick: () => window.open(result.url!, "_blank") },
        });
      }
    } else {
      if (tab) tab.close();
      toast.error("Failed to load photo");
    }
  };

  return (
    <AppShell
      title="Material traceability"
      subtitle="Every batch carries its full document chain from supplier to installed location"
    >
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {CHAIN.map((c) => (
              <span key={c} className="rounded-md bg-surface px-2.5 py-1 text-xs font-medium">
                {c}
              </span>
            ))}
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 size-4" /> Register batch
          </Button>
        </div>
      </Card>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {batches.length === 0 && (
          <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
            No batches registered yet. Click "Register batch" to add one.
          </Card>
        )}
        {batches.map((b: any) => (
          <Card key={b.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{b.material}</p>
                <p className="font-mono text-xs text-muted-foreground">{b.batch_number}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={STATUS_TONE[b.status] ?? "warning"}>{b.status}</StatusPill>
                <DocumentVersionHistory entityType="batch" entityId={b.id} />
                <Button variant="ghost" size="sm" onClick={() => openEdit(b)} title="Edit batch">
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <Field k="Supplier" v={b.supplier ?? "—"} />
              <Field k="Manufacturer" v={b.manufacturer ?? "—"} />
              <Field
                k="Purchase date"
                v={b.purchase_date ? new Date(b.purchase_date).toLocaleDateString("en-IN") : "—"}
              />
              <Field k="Invoice" v={b.invoice ?? "—"} />
              <Field k="Delivery challan" v={b.challan ?? "—"} />
              <Field k="MTC" v={b.mtc ?? "—"} />
              <Field k="Lab report" v={b.lab_report ?? "—"} />
            </dl>
            {Array.isArray(b.photos) && b.photos.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {b.photos.map((p: string, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => handleViewPhoto(p)}
                    className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="size-3" /> Photo {idx + 1}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Camera className="size-3.5" /> {Array.isArray(b.photos) ? b.photos.length : 0} site
              photos attached
            </p>
          </Card>
        ))}
      </div>

      {/* Create / Edit batch dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit batch" : "Register batch"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update batch details, documents, status or photos."
                : "Register a new material batch with full document chain."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="b-num">Batch number *</Label>
                <Input
                  id="b-num"
                  value={form.batch_number}
                  onChange={(e) => setForm({ ...form, batch_number: e.target.value })}
                  placeholder="BAT/AUG/0001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-mat">Material *</Label>
                <Input
                  id="b-mat"
                  value={form.material}
                  onChange={(e) => setForm({ ...form, material: e.target.value })}
                  placeholder="e.g. TMT Steel Fe550D 16mm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="b-sup">Supplier</Label>
                <Input
                  id="b-sup"
                  value={form.supplier}
                  onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                  placeholder="Supplier name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-man">Manufacturer</Label>
                <Input
                  id="b-man"
                  value={form.manufacturer}
                  onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                  placeholder="Manufacturer name"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="b-date">Purchase date</Label>
                <Input
                  id="b-date"
                  type="date"
                  value={form.purchase_date}
                  onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm({ ...form, status: v as "Verified" | "Pending MTC" | "Under Test" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending MTC">Pending MTC</SelectItem>
                    <SelectItem value="Under Test">Under Test</SelectItem>
                    <SelectItem value="Verified">Verified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="b-inv">Invoice number</Label>
                <Input
                  id="b-inv"
                  value={form.invoice}
                  onChange={(e) => setForm({ ...form, invoice: e.target.value })}
                  placeholder="Invoice ref"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-ch">Delivery challan</Label>
                <Input
                  id="b-ch"
                  value={form.challan}
                  onChange={(e) => setForm({ ...form, challan: e.target.value })}
                  placeholder="Challan ref"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="b-mtc">MTC reference</Label>
                <Input
                  id="b-mtc"
                  value={form.mtc}
                  onChange={(e) => setForm({ ...form, mtc: e.target.value })}
                  placeholder="Mill Test Certificate ref"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="b-lab">Lab report</Label>
                <Input
                  id="b-lab"
                  value={form.lab_report}
                  onChange={(e) => setForm({ ...form, lab_report: e.target.value })}
                  placeholder="Lab test report ref"
                />
              </div>
            </div>

            {/* Photo upload */}
            <div className="space-y-2">
              <Label>Site photos</Label>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadingPhotos}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadingPhotos ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1.5 size-4" />
                  )}
                  Upload photos
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
                {photoPaths.length > 0 && (
                  <span className="text-xs text-success">
                    {photoPaths.length} photo{photoPaths.length > 1 ? "s" : ""} attached
                  </span>
                )}
              </div>
              {photoPaths.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {photoPaths.map((p, idx) => (
                    <div
                      key={idx}
                      className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-xs"
                    >
                      <button
                        onClick={() => handleViewPhoto(p)}
                        className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="size-3" /> Photo {idx + 1}
                      </button>
                      <button
                        onClick={() => removePhoto(idx)}
                        className="text-destructive hover:text-destructive/80"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || uploadingPhotos}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              {editing ? "Update batch" : "Register batch"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// Small label/value pair component used in the batch detail grid.
function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
