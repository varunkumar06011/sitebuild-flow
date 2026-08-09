// Quality control page displaying inspection checklists, pass/fail results, rectification notes and photo evidence.
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
import { fetchInspections, createInspection, updateInspection } from "@/lib/api/inspections";
import { uploadFile, getSignedUrl } from "@/lib/api/storage";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  Camera,
  Check,
  X,
  Plus,
  Trash2,
  Upload,
  Loader2,
  Pencil,
  ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/quality")({
  head: () => ({
    meta: [
      { title: "Quality Control & Inspections — Meditrust ERP" },
      {
        name: "description",
        content:
          "Inspection checklists, pass/fail results, rectification notes, re-inspection tracking and photo evidence.",
      },
      { property: "og:title", content: "Quality Control & Inspections — Meditrust ERP" },
      {
        property: "og:description",
        content:
          "Inspection → Checklist → Test result → Pass/Fail → Rectification → Re-inspection → Photos.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: Quality,
});

type ChecklistItem = { item: string; ok: boolean };

// Main quality page rendering inspection cards with create dialog and re-inspect action.
function Quality() {
  const queryClient = useQueryClient();
  const { data: inspData } = useQuery({
    queryKey: ["inspections"],
    queryFn: () => fetchInspections({}),
  });
  const inspections = inspData?.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    qc_number: "",
    activity: "",
    location: "",
    inspector: "",
    date: "",
    result: "Pass" as "Pass" | "Fail" | "Re-inspection",
    rectification: "",
  });
  const [checklist, setChecklist] = useState<ChecklistItem[]>([{ item: "", ok: true }]);

  const today = new Date().toISOString().slice(0, 10);
  const qcSuggest = `QC/${new Date().toLocaleString("en-IN", { month: "short" }).toUpperCase()}/${String(inspections.length + 1).padStart(4, "0")}`;

  const openCreate = () => {
    setEditing(null);
    setForm({
      qc_number: qcSuggest,
      activity: "",
      location: "",
      inspector: "",
      date: today,
      result: "Pass",
      rectification: "",
    });
    setChecklist([{ item: "", ok: true }]);
    setPhotoPaths([]);
    setDialogOpen(true);
  };

  const openEdit = (i: any) => {
    setEditing(i);
    setForm({
      qc_number: i.qc_number ?? "",
      activity: i.activity ?? "",
      location: i.location ?? "",
      inspector: i.inspector ?? "",
      date: i.date ? new Date(i.date).toISOString().slice(0, 10) : today,
      result: i.result ?? "Pass",
      rectification: i.rectification ?? "",
    });
    setChecklist(
      Array.isArray(i.checklist) && i.checklist.length > 0 ? i.checklist : [{ item: "", ok: true }],
    );
    setPhotoPaths(Array.isArray(i.photos) ? i.photos : []);
    setDialogOpen(true);
  };

  const addChecklistItem = () => setChecklist([...checklist, { item: "", ok: true }]);
  const removeChecklistItem = (idx: number) => setChecklist(checklist.filter((_, i) => i !== idx));
  const updateChecklistItem = (idx: number, field: "item" | "ok", value: string | boolean) =>
    setChecklist(checklist.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));

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
        const path = `inspections/${Date.now()}-${file.name}`;
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

  const handleSave = async () => {
    if (!form.qc_number.trim()) {
      toast.error("QC number is required");
      return;
    }
    if (!form.activity.trim()) {
      toast.error("Activity is required");
      return;
    }
    setSaving(true);
    try {
      const cleanChecklist = checklist
        .filter((c) => c.item.trim())
        .map((c) => ({ item: c.item.trim(), ok: c.ok }));
      const payload = {
        qc_number: form.qc_number.trim(),
        activity: form.activity.trim(),
        location: form.location.trim() || undefined,
        inspector: form.inspector.trim() || undefined,
        date: form.date || undefined,
        result: form.result,
        checklist: cleanChecklist,
        rectification: form.rectification.trim() || null,
        photos: photoPaths,
      };

      if (editing) {
        const result = await updateInspection({ id: editing.id, ...payload });
        if (result.success) {
          toast.success("Inspection updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["inspections"] });
        } else {
          toast.error(result.error ?? "Failed to update inspection");
        }
      } else {
        const result = await createInspection(payload);
        if (result.success) {
          toast.success("Inspection created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["inspections"] });
        } else {
          toast.error(result.error ?? "Failed to create inspection");
        }
      }
    } catch {
      toast.error("Failed to save inspection");
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
      title="Quality control"
      subtitle="Inspection → Checklist → Test result → Pass/Fail → Rectification → Re-inspection"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {inspections.length} inspection{inspections.length !== 1 ? "s" : ""}
        </p>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1.5 size-4" /> Raise inspection
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {inspections.length === 0 && (
          <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
            No inspections recorded yet. Click "Raise inspection" to create one.
          </Card>
        )}
        {inspections.map((i: any) => (
          <Card key={i.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{i.activity}</p>
                <p className="text-xs text-muted-foreground">
                  {i.qc_number} · {i.location ?? "—"}
                </p>
              </div>
              <StatusPill
                tone={i.result === "Pass" ? "success" : i.result === "Fail" ? "danger" : "warning"}
              >
                {i.result}
              </StatusPill>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {i.inspector ?? "—"} · {i.date ? new Date(i.date).toLocaleDateString("en-IN") : "—"}
            </p>

            {Array.isArray(i.checklist) && i.checklist.length > 0 && (
              <ul className="mt-4 space-y-2 text-sm">
                {i.checklist.map((c: any, idx: number) => (
                  <li key={idx} className="flex items-start gap-2">
                    {c.ok ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-destructive" />
                    )}
                    <span className={c.ok ? "" : "text-destructive"}>{c.item}</span>
                  </li>
                ))}
              </ul>
            )}

            {i.rectification && (
              <div className="mt-4 rounded-lg bg-warning-soft p-3 text-xs text-warning-foreground">
                <p className="font-semibold">Rectification</p>
                <p className="mt-1">{i.rectification}</p>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between">
              <p className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Camera className="size-3.5" /> {Array.isArray(i.photos) ? i.photos.length : 0}{" "}
                photos
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openEdit(i)}
                title="Edit / re-inspect"
              >
                <Pencil className="mr-1 size-3.5" />
                {i.result === "Fail" ? "Re-inspect" : "Edit"}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Create / Edit inspection dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit inspection" : "Raise inspection"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update checklist, result, rectification or photos."
                : "Record a new QC inspection with checklist and result."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qc-num">QC number *</Label>
                <Input
                  id="qc-num"
                  value={form.qc_number}
                  onChange={(e) => setForm({ ...form, qc_number: e.target.value })}
                  placeholder="QC/AUG/0001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qc-activity">Activity *</Label>
                <Input
                  id="qc-activity"
                  value={form.activity}
                  onChange={(e) => setForm({ ...form, activity: e.target.value })}
                  placeholder="e.g. TMT Steel batch inspection"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qc-loc">Location</Label>
                <Input
                  id="qc-loc"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. OT Block · Level 3"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qc-inspector">Inspector</Label>
                <Input
                  id="qc-inspector"
                  value={form.inspector}
                  onChange={(e) => setForm({ ...form, inspector: e.target.value })}
                  placeholder="Inspector name"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="qc-date">Date</Label>
                <Input
                  id="qc-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Result</Label>
                <Select
                  value={form.result}
                  onValueChange={(v) =>
                    setForm({ ...form, result: v as "Pass" | "Fail" | "Re-inspection" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pass">Pass</SelectItem>
                    <SelectItem value="Fail">Fail</SelectItem>
                    <SelectItem value="Re-inspection">Re-inspection</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Checklist builder */}
            <div className="space-y-2">
              <Label>Checklist</Label>
              <div className="space-y-2">
                {checklist.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => updateChecklistItem(idx, "ok", !c.ok)}
                      className={`flex size-8 shrink-0 items-center justify-center rounded-md border ${c.ok ? "border-success bg-success/10 text-success" : "border-destructive bg-destructive/10 text-destructive"}`}
                      title={c.ok ? "Mark as failed" : "Mark as passed"}
                    >
                      {c.ok ? <Check className="size-4" /> : <X className="size-4" />}
                    </button>
                    <Input
                      value={c.item}
                      onChange={(e) => updateChecklistItem(idx, "item", e.target.value)}
                      placeholder={`Checklist item ${idx + 1}`}
                      className="flex-1"
                    />
                    {checklist.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeChecklistItem(idx)}
                        title="Remove"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={addChecklistItem}>
                <Plus className="mr-1.5 size-3.5" /> Add checklist item
              </Button>
            </div>

            {/* Rectification */}
            <div className="space-y-2">
              <Label htmlFor="qc-rect">Rectification notes</Label>
              <Textarea
                id="qc-rect"
                value={form.rectification}
                onChange={(e) => setForm({ ...form, rectification: e.target.value })}
                placeholder="Describe rectification work needed (if any)"
                rows={2}
              />
            </div>

            {/* Photo upload */}
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
                  <span className="text-xs text-success">
                    {photoPaths.length} photo{photoPaths.length > 1 ? "s" : ""} attached
                  </span>
                )}
              </div>
              {photoPaths.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {photoPaths.map((p, idx) => (
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
              {editing ? "Update inspection" : "Create inspection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
