// AERB / Radiation Safety Compliance — shielding inspections, dose surveys, license tracking.
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
import { fetchAerbCompliance, createAerbRecord, updateAerbRecord } from "@/lib/api/aerb-compliance";
import { uploadFile } from "@/lib/api/storage";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Plus, Pencil, Upload, Loader2, Camera, Search, Shield, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/aerb-compliance")({
  head: () => ({
    meta: [
      { title: "AERB & Radiation Safety — Meditrust ERP" },
      {
        name: "description",
        content:
          "Lead shielding inspections, radiation dose surveys, AERB license tracking with expiry alerts.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: AerbCompliancePage,
});

const RESULT_TONE: Record<string, "success" | "danger" | "warning"> = {
  Pass: "success",
  Fail: "danger",
  "Re-test": "warning",
};

// Main AERB compliance page with card grid, create/edit dialog and license expiry alerts.
function AerbCompliancePage() {
  const queryClient = useQueryClient();
  const { data: aerbData } = useQuery({
    queryKey: ["aerb"],
    queryFn: () => fetchAerbCompliance({ data: {} }),
  });
  const records = aerbData?.data ?? [];

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    area: "",
    shielding_type: "",
    material: "",
    thickness: "",
    inspection_date: "",
    result: "Pass" as string,
    dose_survey_value: "",
    dose_survey_unit: "",
    license_number: "",
    license_expiry: "",
    notes: "",
  });

  const today = new Date().toISOString().slice(0, 10);

  const openCreate = () => {
    setEditing(null);
    setForm({
      area: "",
      shielding_type: "",
      material: "",
      thickness: "",
      inspection_date: today,
      result: "Pass",
      dose_survey_value: "",
      dose_survey_unit: "mSv/hr",
      license_number: "",
      license_expiry: "",
      notes: "",
    });
    setPhotoPaths([]);
    setDialogOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      area: r.area ?? "",
      shielding_type: r.shielding_type ?? "",
      material: r.material ?? "",
      thickness: r.thickness ?? "",
      inspection_date: r.inspection_date
        ? new Date(r.inspection_date).toISOString().slice(0, 10)
        : "",
      result: r.result ?? "Pass",
      dose_survey_value: r.dose_survey_value != null ? String(r.dose_survey_value) : "",
      dose_survey_unit: r.dose_survey_unit ?? "",
      license_number: r.license_number ?? "",
      license_expiry: r.license_expiry ? new Date(r.license_expiry).toISOString().slice(0, 10) : "",
      notes: r.notes ?? "",
    });
    setPhotoPaths(Array.isArray(r.photos) ? r.photos : []);
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
          reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        const path = `aerb/${Date.now()}-${file.name}`;
        const result = await uploadFile({
          data: {
            bucket: "photos",
            path,
            contentType: file.type || "image/jpeg",
            fileData: base64,
          },
        });
        if (result.success) paths.push(path);
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

  const handleSave = async () => {
    if (!form.area.trim()) {
      toast.error("Area is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        area: form.area.trim(),
        shielding_type: form.shielding_type.trim() || undefined,
        material: form.material.trim() || undefined,
        thickness: form.thickness.trim() || undefined,
        inspection_date: form.inspection_date || undefined,
        result: form.result as "Pass" | "Fail" | "Re-test",
        dose_survey_value: form.dose_survey_value ? Number(form.dose_survey_value) : undefined,
        dose_survey_unit: form.dose_survey_unit.trim() || undefined,
        license_number: form.license_number.trim() || undefined,
        license_expiry: form.license_expiry || undefined,
        notes: form.notes.trim() || undefined,
        photos: photoPaths,
      };

      if (editing) {
        const result = await updateAerbRecord({ data: { id: editing.id, ...payload } });
        if (result.success) {
          toast.success("AERB record updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["aerb"] });
        } else {
          toast.error(result.error ?? "Failed to update record");
        }
      } else {
        const result = await createAerbRecord({ data: payload });
        if (result.success) {
          toast.success("AERB record created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["aerb"] });
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
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      r.area?.toLowerCase().includes(s) ||
      r.shielding_type?.toLowerCase().includes(s) ||
      r.license_number?.toLowerCase().includes(s)
    );
  });

  // Check for expiring licenses (within 90 days)
  const now = new Date();
  const expiringLicenses = records.filter((r: any) => {
    if (!r.license_expiry) return false;
    const expiry = new Date(r.license_expiry);
    const days = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days <= 90 && days >= 0;
  });

  return (
    <AppShell
      title="AERB & radiation safety"
      subtitle="Shielding inspections, dose surveys & AERB license tracking"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search area / license..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 pl-9"
          />
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 size-4" /> Add record
        </Button>
      </div>

      {expiringLicenses.length > 0 && (
        <Card className="mb-4 border-warning p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" /> {expiringLicenses.length} license
            {expiringLicenses.length > 1 ? "s" : ""} expiring within 90 days
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {expiringLicenses.map((r: any) => (
              <span key={r.id} className="rounded-md bg-warning/10 px-2 py-1 text-xs">
                {r.area} — {r.license_number} expires{" "}
                {new Date(r.license_expiry).toLocaleDateString("en-IN")}
              </span>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.length === 0 && (
          <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
            No AERB compliance records. Click "Add record" to create one.
          </Card>
        )}
        {filtered.map((r: any) => (
          <Card key={r.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{r.area}</p>
                <p className="text-xs text-muted-foreground">
                  {r.shielding_type ?? "—"} · {r.material ?? "—"} · {r.thickness ?? "—"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={RESULT_TONE[r.result] ?? "warning"}>{r.result}</StatusPill>
                <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Field
                k="Inspection date"
                v={
                  r.inspection_date ? new Date(r.inspection_date).toLocaleDateString("en-IN") : "—"
                }
              />
              <Field
                k="Dose survey"
                v={
                  r.dose_survey_value != null
                    ? `${r.dose_survey_value} ${r.dose_survey_unit ?? ""}`
                    : "—"
                }
              />
              <Field k="License number" v={r.license_number ?? "—"} />
              <Field
                k="License expiry"
                v={r.license_expiry ? new Date(r.license_expiry).toLocaleDateString("en-IN") : "—"}
              />
            </dl>
            {r.notes && <p className="mt-3 text-xs text-muted-foreground">{r.notes}</p>}
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Camera className="size-3" /> {Array.isArray(r.photos) ? r.photos.length : 0} photos
            </p>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit AERB record" : "Add AERB record"}</DialogTitle>
            <DialogDescription>
              Record shielding inspection, dose survey and license details.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="a-area">Area *</Label>
                <Input
                  id="a-area"
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })}
                  placeholder="e.g. CT Room, MRI Room"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="a-stype">Shielding type</Label>
                <Input
                  id="a-stype"
                  value={form.shielding_type}
                  onChange={(e) => setForm({ ...form, shielding_type: e.target.value })}
                  placeholder="Wall, Door, Viewing Window"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="a-mat">Material</Label>
                <Input
                  id="a-mat"
                  value={form.material}
                  onChange={(e) => setForm({ ...form, material: e.target.value })}
                  placeholder="e.g. Lead lining"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="a-thick">Thickness</Label>
                <Input
                  id="a-thick"
                  value={form.thickness}
                  onChange={(e) => setForm({ ...form, thickness: e.target.value })}
                  placeholder="e.g. 2mm Pb"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="a-date">Inspection date</Label>
                <Input
                  id="a-date"
                  type="date"
                  value={form.inspection_date}
                  onChange={(e) => setForm({ ...form, inspection_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Result</Label>
                <Select value={form.result} onValueChange={(v) => setForm({ ...form, result: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pass">Pass</SelectItem>
                    <SelectItem value="Fail">Fail</SelectItem>
                    <SelectItem value="Re-test">Re-test</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="a-dose">Dose survey value</Label>
                <Input
                  id="a-dose"
                  type="number"
                  step="0.001"
                  value={form.dose_survey_value}
                  onChange={(e) => setForm({ ...form, dose_survey_value: e.target.value })}
                  placeholder="0.02"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="a-unit">Dose unit</Label>
                <Input
                  id="a-unit"
                  value={form.dose_survey_unit}
                  onChange={(e) => setForm({ ...form, dose_survey_unit: e.target.value })}
                  placeholder="mSv/hr"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="a-lic">License number</Label>
                <Input
                  id="a-lic"
                  value={form.license_number}
                  onChange={(e) => setForm({ ...form, license_number: e.target.value })}
                  placeholder="AERB-XXX-2024-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="a-lexp">License expiry</Label>
                <Input
                  id="a-lexp"
                  type="date"
                  value={form.license_expiry}
                  onChange={(e) => setForm({ ...form, license_expiry: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Photos</Label>
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
                  <span className="text-xs text-success">{photoPaths.length} attached</span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="a-notes">Notes</Label>
              <Textarea
                id="a-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Inspection notes"
                rows={2}
              />
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
              {editing ? "Update record" : "Create record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
