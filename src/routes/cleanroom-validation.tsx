// Cleanroom & HVAC validation tracker — particle counts, ACH, pressure differentials, filter schedules.
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
  fetchCleanroomRecords,
  createCleanroomRecord,
  updateCleanroomRecord,
} from "@/lib/api/cleanroom-validation";
import { uploadFile } from "@/lib/api/storage";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Plus, Pencil, Upload, Loader2, Camera, Search, Wind } from "lucide-react";

export const Route = createFileRoute("/cleanroom-validation")({
  head: () => ({
    meta: [
      { title: "Cleanroom & HVAC Validation — Meditrust ERP" },
      {
        name: "description",
        content:
          "Particle counts, air change rates, pressure differentials, HEPA/ULPA filter schedules and validation reports.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: CleanroomValidationPage,
});

const RESULT_TONE: Record<string, "success" | "danger" | "warning"> = {
  Pass: "success",
  Fail: "danger",
  "Re-test": "warning",
};

// Main cleanroom validation page with card grid and create/edit dialog.
function CleanroomValidationPage() {
  const queryClient = useQueryClient();
  const { data: clData } = useQuery({
    queryKey: ["cleanroom"],
    queryFn: () => fetchCleanroomRecords({ data: {} }),
  });
  const records = clData?.data ?? [];

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    area: "",
    test_type: "",
    iso_class: "",
    particle_count: "",
    ach_value: "",
    pressure_diff: "",
    filter_type: "",
    filter_install_date: "",
    filter_replacement_date: "",
    test_date: "",
    result: "Pass" as string,
    notes: "",
  });

  const today = new Date().toISOString().slice(0, 10);

  const openCreate = () => {
    setEditing(null);
    setForm({
      area: "",
      test_type: "",
      iso_class: "",
      particle_count: "",
      ach_value: "",
      pressure_diff: "",
      filter_type: "",
      filter_install_date: "",
      filter_replacement_date: "",
      test_date: today,
      result: "Pass",
      notes: "",
    });
    setPhotoPaths([]);
    setDialogOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      area: r.area ?? "",
      test_type: r.test_type ?? "",
      iso_class: r.iso_class ?? "",
      particle_count: r.particle_count != null ? String(r.particle_count) : "",
      ach_value: r.ach_value != null ? String(r.ach_value) : "",
      pressure_diff: r.pressure_diff != null ? String(r.pressure_diff) : "",
      filter_type: r.filter_type ?? "",
      filter_install_date: r.filter_install_date
        ? new Date(r.filter_install_date).toISOString().slice(0, 10)
        : "",
      filter_replacement_date: r.filter_replacement_date
        ? new Date(r.filter_replacement_date).toISOString().slice(0, 10)
        : "",
      test_date: r.test_date ? new Date(r.test_date).toISOString().slice(0, 10) : "",
      result: r.result ?? "Pass",
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
        const path = `cleanroom/${Date.now()}-${file.name}`;
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
    if (!form.area.trim() || !form.test_type.trim()) {
      toast.error("Area and test type are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        area: form.area.trim(),
        test_type: form.test_type.trim(),
        iso_class: form.iso_class.trim() || undefined,
        particle_count: form.particle_count ? Number(form.particle_count) : undefined,
        ach_value: form.ach_value ? Number(form.ach_value) : undefined,
        pressure_diff: form.pressure_diff ? Number(form.pressure_diff) : undefined,
        filter_type: form.filter_type.trim() || undefined,
        filter_install_date: form.filter_install_date || undefined,
        filter_replacement_date: form.filter_replacement_date || undefined,
        test_date: form.test_date || undefined,
        result: form.result as "Pass" | "Fail" | "Re-test",
        notes: form.notes.trim() || undefined,
        photos: photoPaths,
      };

      if (editing) {
        const result = await updateCleanroomRecord({ data: { id: editing.id, ...payload } });
        if (result.success) {
          toast.success("Record updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["cleanroom"] });
        } else {
          toast.error(result.error ?? "Failed to update record");
        }
      } else {
        const result = await createCleanroomRecord({ data: payload });
        if (result.success) {
          toast.success("Record created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["cleanroom"] });
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
      r.test_type?.toLowerCase().includes(s) ||
      r.filter_type?.toLowerCase().includes(s)
    );
  });

  return (
    <AppShell
      title="Cleanroom & HVAC validation"
      subtitle="Particle counts, air change rates, pressure differentials & filter schedules"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search area / test..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 pl-9"
          />
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 size-4" /> Add test
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.length === 0 && (
          <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
            No validation records. Click "Add test" to create one.
          </Card>
        )}
        {filtered.map((r: any) => (
          <Card key={r.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{r.area}</p>
                <p className="text-xs text-muted-foreground">{r.test_type}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={RESULT_TONE[r.result] ?? "warning"}>{r.result}</StatusPill>
                <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Field k="ISO class" v={r.iso_class ?? "—"} />
              <Field
                k="Test date"
                v={r.test_date ? new Date(r.test_date).toLocaleDateString("en-IN") : "—"}
              />
              <Field
                k="Particle count"
                v={r.particle_count != null ? r.particle_count.toLocaleString("en-IN") : "—"}
              />
              <Field k="ACH" v={r.ach_value != null ? `${r.ach_value}/hr` : "—"} />
              <Field
                k="Pressure diff"
                v={r.pressure_diff != null ? `${r.pressure_diff} Pa` : "—"}
              />
              <Field k="Filter type" v={r.filter_type ?? "—"} />
              <Field
                k="Filter installed"
                v={
                  r.filter_install_date
                    ? new Date(r.filter_install_date).toLocaleDateString("en-IN")
                    : "—"
                }
              />
              <Field
                k="Filter replacement"
                v={
                  r.filter_replacement_date
                    ? new Date(r.filter_replacement_date).toLocaleDateString("en-IN")
                    : "—"
                }
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
            <DialogTitle>{editing ? "Edit validation record" : "Add validation test"}</DialogTitle>
            <DialogDescription>Record cleanroom or HVAC validation test results.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cl-area">Area *</Label>
                <Input
                  id="cl-area"
                  value={form.area}
                  onChange={(e) => setForm({ ...form, area: e.target.value })}
                  placeholder="e.g. OT-1, ICU, Lab"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cl-test">Test type *</Label>
                <Input
                  id="cl-test"
                  value={form.test_type}
                  onChange={(e) => setForm({ ...form, test_type: e.target.value })}
                  placeholder="e.g. Particle Count, ACH, Pressure"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cl-iso">ISO class</Label>
                <Input
                  id="cl-iso"
                  value={form.iso_class}
                  onChange={(e) => setForm({ ...form, iso_class: e.target.value })}
                  placeholder="ISO Class 5"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cl-date">Test date</Label>
                <Input
                  id="cl-date"
                  type="date"
                  value={form.test_date}
                  onChange={(e) => setForm({ ...form, test_date: e.target.value })}
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
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cl-pc">Particle count</Label>
                <Input
                  id="cl-pc"
                  type="number"
                  value={form.particle_count}
                  onChange={(e) => setForm({ ...form, particle_count: e.target.value })}
                  placeholder="3520"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cl-ach">ACH value</Label>
                <Input
                  id="cl-ach"
                  type="number"
                  value={form.ach_value}
                  onChange={(e) => setForm({ ...form, ach_value: e.target.value })}
                  placeholder="25"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cl-pd">Pressure diff (Pa)</Label>
                <Input
                  id="cl-pd"
                  type="number"
                  value={form.pressure_diff}
                  onChange={(e) => setForm({ ...form, pressure_diff: e.target.value })}
                  placeholder="8"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cl-ft">Filter type</Label>
                <Input
                  id="cl-ft"
                  value={form.filter_type}
                  onChange={(e) => setForm({ ...form, filter_type: e.target.value })}
                  placeholder="HEPA H14"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cl-fi">Filter installed</Label>
                <Input
                  id="cl-fi"
                  type="date"
                  value={form.filter_install_date}
                  onChange={(e) => setForm({ ...form, filter_install_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cl-fr">Filter replacement</Label>
                <Input
                  id="cl-fr"
                  type="date"
                  value={form.filter_replacement_date}
                  onChange={(e) => setForm({ ...form, filter_replacement_date: e.target.value })}
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
              <Label htmlFor="cl-notes">Notes</Label>
              <Textarea
                id="cl-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Test notes"
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
