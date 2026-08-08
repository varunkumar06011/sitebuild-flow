// Medical gas pipeline tracker — pressure tests, leak tests, manifold installation, cross-connection verification.
import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { fetchGasPipelines, createGasPipeline, updateGasPipeline } from "@/lib/api/medical-gas";
import { uploadFile } from "@/lib/api/storage";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Plus, Pencil, Upload, Loader2, Camera, Search, Check, X, Flame } from "lucide-react";

export const Route = createFileRoute("/medical-gas")({
  head: () => ({
    meta: [
      { title: "Medical Gas Pipeline — Meditrust ERP" },
      {
        name: "description",
        content:
          "Track medical gas pipeline pressure tests, leak tests, manifold installation and cross-connection verification.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: MedicalGasPage,
});

const TEST_RESULT_TONE: Record<string, "success" | "danger" | "warning"> = {
  Pass: "success",
  Fail: "danger",
  Pending: "warning",
};

const GAS_COLORS: Record<string, string> = {
  Oxygen: "text-success",
  "Medical Air": "text-info",
  Vacuum: "text-warning",
  "Nitrous Oxide": "text-purple-600",
  "Carbon Dioxide": "text-gray-600",
};

// Main medical gas pipeline page with card grid and create/edit dialog.
function MedicalGasPage() {
  const queryClient = useQueryClient();
  const { data: gasData } = useQuery({
    queryKey: ["gas-pipelines"],
    queryFn: () => fetchGasPipelines({ data: {} }),
  });
  const records = gasData?.data ?? [];

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    gas_type: "",
    pipeline_segment: "",
    pressure_test_date: "",
    pressure_test_result: "Pending" as string,
    leak_test_date: "",
    leak_test_result: "Pending" as string,
    manifold_installed: false,
    cross_connection_verified: false,
    notes: "",
  });

  const today = new Date().toISOString().slice(0, 10);

  const openCreate = () => {
    setEditing(null);
    setForm({
      gas_type: "",
      pipeline_segment: "",
      pressure_test_date: "",
      pressure_test_result: "Pending",
      leak_test_date: "",
      leak_test_result: "Pending",
      manifold_installed: false,
      cross_connection_verified: false,
      notes: "",
    });
    setPhotoPaths([]);
    setDialogOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({
      gas_type: r.gas_type ?? "",
      pipeline_segment: r.pipeline_segment ?? "",
      pressure_test_date: r.pressure_test_date
        ? new Date(r.pressure_test_date).toISOString().slice(0, 10)
        : "",
      pressure_test_result: r.pressure_test_result ?? "Pending",
      leak_test_date: r.leak_test_date ? new Date(r.leak_test_date).toISOString().slice(0, 10) : "",
      leak_test_result: r.leak_test_result ?? "Pending",
      manifold_installed: r.manifold_installed ?? false,
      cross_connection_verified: r.cross_connection_verified ?? false,
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
        const path = `medical-gas/${Date.now()}-${file.name}`;
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
    if (!form.gas_type.trim() || !form.pipeline_segment.trim()) {
      toast.error("Gas type and pipeline segment are required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        gas_type: form.gas_type.trim(),
        pipeline_segment: form.pipeline_segment.trim(),
        pressure_test_date: form.pressure_test_date || undefined,
        pressure_test_result: form.pressure_test_result as "Pass" | "Fail" | "Pending",
        leak_test_date: form.leak_test_date || undefined,
        leak_test_result: form.leak_test_result as "Pass" | "Fail" | "Pending",
        manifold_installed: form.manifold_installed,
        cross_connection_verified: form.cross_connection_verified,
        notes: form.notes.trim() || undefined,
        photos: photoPaths,
      };

      if (editing) {
        const result = await updateGasPipeline({ data: { id: editing.id, ...payload } });
        if (result.success) {
          toast.success("Pipeline record updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["gas-pipelines"] });
        } else {
          toast.error(result.error ?? "Failed to update record");
        }
      } else {
        const result = await createGasPipeline({ data: payload });
        if (result.success) {
          toast.success("Pipeline record created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["gas-pipelines"] });
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
    return r.gas_type?.toLowerCase().includes(s) || r.pipeline_segment?.toLowerCase().includes(s);
  });

  const allTestsPassed = (r: any) =>
    r.pressure_test_result === "Pass" &&
    r.leak_test_result === "Pass" &&
    r.manifold_installed &&
    r.cross_connection_verified;

  return (
    <AppShell
      title="Medical gas pipeline"
      subtitle="Pressure tests, leak tests, manifold installation & cross-connection verification"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search gas / segment..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 pl-9"
          />
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 size-4" /> Add pipeline
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.length === 0 && (
          <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
            No pipeline records. Click "Add pipeline" to create one.
          </Card>
        )}
        {filtered.map((r: any) => (
          <Card key={r.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Flame className={`size-5 ${GAS_COLORS[r.gas_type] ?? "text-muted-foreground"}`} />
                <div>
                  <p className="font-semibold">{r.gas_type}</p>
                  <p className="text-xs text-muted-foreground">{r.pipeline_segment}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {allTestsPassed(r) ? (
                  <StatusPill tone="success">All clear</StatusPill>
                ) : (
                  <StatusPill tone="warning">In progress</StatusPill>
                )}
                <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Pressure test:</span>
                <StatusPill tone={TEST_RESULT_TONE[r.pressure_test_result] ?? "warning"}>
                  {r.pressure_test_result}
                </StatusPill>
                {r.pressure_test_date && (
                  <span className="text-muted-foreground">
                    {new Date(r.pressure_test_date).toLocaleDateString("en-IN")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Leak test:</span>
                <StatusPill tone={TEST_RESULT_TONE[r.leak_test_result] ?? "warning"}>
                  {r.leak_test_result}
                </StatusPill>
                {r.leak_test_date && (
                  <span className="text-muted-foreground">
                    {new Date(r.leak_test_date).toLocaleDateString("en-IN")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {r.manifold_installed ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <X className="size-3.5 text-destructive" />
                )}
                <span>Manifold installed</span>
              </div>
              <div className="flex items-center gap-1.5">
                {r.cross_connection_verified ? (
                  <Check className="size-3.5 text-success" />
                ) : (
                  <X className="size-3.5 text-destructive" />
                )}
                <span>Cross-connection verified</span>
              </div>
            </div>
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
            <DialogTitle>{editing ? "Edit pipeline record" : "Add pipeline"}</DialogTitle>
            <DialogDescription>
              Record medical gas pipeline test results and installation status.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="g-type">Gas type *</Label>
                <Select
                  value={form.gas_type}
                  onValueChange={(v) => setForm({ ...form, gas_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select gas type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Oxygen">Oxygen</SelectItem>
                    <SelectItem value="Medical Air">Medical Air</SelectItem>
                    <SelectItem value="Vacuum">Vacuum</SelectItem>
                    <SelectItem value="Nitrous Oxide">Nitrous Oxide</SelectItem>
                    <SelectItem value="Carbon Dioxide">Carbon Dioxide</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="g-seg">Pipeline segment *</Label>
                <Input
                  id="g-seg"
                  value={form.pipeline_segment}
                  onChange={(e) => setForm({ ...form, pipeline_segment: e.target.value })}
                  placeholder="e.g. Main to OT Block"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="g-ptd">Pressure test date</Label>
                <Input
                  id="g-ptd"
                  type="date"
                  value={form.pressure_test_date}
                  onChange={(e) => setForm({ ...form, pressure_test_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Pressure test result</Label>
                <Select
                  value={form.pressure_test_result}
                  onValueChange={(v) => setForm({ ...form, pressure_test_result: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Pass">Pass</SelectItem>
                    <SelectItem value="Fail">Fail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="g-ltd">Leak test date</Label>
                <Input
                  id="g-ltd"
                  type="date"
                  value={form.leak_test_date}
                  onChange={(e) => setForm({ ...form, leak_test_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Leak test result</Label>
                <Select
                  value={form.leak_test_result}
                  onValueChange={(v) => setForm({ ...form, leak_test_result: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Pass">Pass</SelectItem>
                    <SelectItem value="Fail">Fail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <Label htmlFor="g-manifold" className="text-sm">
                  Manifold installed
                </Label>
                <Switch
                  id="g-manifold"
                  checked={form.manifold_installed}
                  onCheckedChange={(v) => setForm({ ...form, manifold_installed: v })}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <Label htmlFor="g-cross" className="text-sm">
                  Cross-connection verified
                </Label>
                <Switch
                  id="g-cross"
                  checked={form.cross_connection_verified}
                  onCheckedChange={(v) => setForm({ ...form, cross_connection_verified: v })}
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
              <Label htmlFor="g-notes">Notes</Label>
              <Textarea
                id="g-notes"
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
