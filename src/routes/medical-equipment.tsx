// Medical equipment commissioning tracker — from delivery to clinical handover.
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
import { fetchEquipment, createEquipment, updateEquipment } from "@/lib/api/medical-equipment";
import { uploadFile, getSignedUrl } from "@/lib/api/storage";
import { requireAuth } from "@/lib/auth-guards";
import { SectionTour, type TourStep } from "@/components/SectionTour";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Upload,
  Loader2,
  Camera,
  Check,
  X,
  Trash2,
  ExternalLink,
  Search,
  ShieldCheck,
  Award,
  Calendar,
} from "lucide-react";

export const Route = createFileRoute("/medical-equipment")({
  head: () => ({
    meta: [
      { title: "Medical Equipment Commissioning — Meditrust ERP" },
      {
        name: "description",
        content:
          "Track medical equipment from delivery through installation, testing, commissioning and clinical handover with certificates and warranty.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: MedicalEquipmentPage,
});

const STATUS_TONE: Record<string, "info" | "warning" | "success" | "danger"> = {
  Ordered: "info",
  Delivered: "info",
  Installed: "warning",
  Testing: "warning",
  Commissioned: "success",
  "Handed Over": "success",
};

type ChecklistItem = { item: string; ok: boolean };
type Certificate = { type: string; number: string; issued_date: string; expiry_date: string };

// Main medical equipment page with card grid, create/edit dialog and commissioning checklist.
function MedicalEquipmentPage() {
  const queryClient = useQueryClient();
  const { data: eqData } = useQuery({
    queryKey: ["equipment"],
    queryFn: () => fetchEquipment({}),
  });
  const equipment = eqData?.data ?? [];

  const tourSteps: TourStep[] = [
    {
      selector: '[data-tour="me-search-input"]',
      title: "Search Equipment",
      description:
        "Type an equipment name, model, manufacturer, or category to find a specific asset quickly.",
    },
    {
      selector: '[data-tour="add-equipment"]',
      title: "+ Add Equipment",
      description:
        "Register a new medical equipment asset as soon as it's ordered — you'll track it through delivery, installation, testing, and handover from here.",
    },
    {
      selector: '[data-tour="equipment-status-badge"]',
      title: "Commissioning Status Badge",
      description:
        "Shows where this asset is in the commissioning pipeline — tap the pencil icon next to it to update the status.",
    },
    {
      selector: '[data-tour="me-edit-btn"]',
      title: "Edit Equipment",
      description:
        "Click this pencil icon to update status, add commissioning checklist items, record certificates, and upload installation photos.",
    },
    {
      selector: '[data-tour="me-status-dropdown"]',
      title: "Status Dropdown",
      description:
        "Move the asset through Ordered → Delivered → Installed → Testing → Commissioned → Handed Over as it progresses on site.",
    },
    {
      selector: '[data-tour="me-checklist-toggle"]',
      title: "Commissioning Checklist",
      description:
        "Tick each checklist item as it's completed on site — all items must be green before marking the equipment Commissioned.",
    },
    {
      selector: '[data-tour="me-add-checklist"]',
      title: "Add Checklist Item",
      description:
        "Add a new commissioning step specific to this equipment — e.g. 'Electrical safety test passed' or 'MRI quench test completed'.",
    },
    {
      selector: '[data-tour="me-add-certificate"]',
      title: "Add Certificate",
      description:
        "Record regulatory certificates (NABH, AERB, CE, FDA) with certificate number and expiry date for compliance tracking.",
    },
    {
      selector: '[data-tour="me-upload-photos"]',
      title: "Upload Photos",
      description:
        "Upload installation photos as evidence — these are visible on the equipment card and useful for handover documentation.",
    },
    {
      selector: '[data-tour="me-save"]',
      title: "Save Equipment",
      description:
        "Save all changes — status updates, checklist, certificates, and photos are stored against this equipment record.",
    },
  ];

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    eq_number: "",
    name: "",
    model: "",
    serial_number: "",
    manufacturer: "",
    category: "",
    location: "",
    status: "Ordered" as string,
    warranty_start: "",
    warranty_end: "",
    amc_expiry: "",
    handover_date: "",
    handover_department: "",
    notes: "",
  });
  const [checklist, setChecklist] = useState<ChecklistItem[]>([{ item: "", ok: false }]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);

  const eqSuggest = `EQ/${new Date().toLocaleString("en-IN", { month: "short" }).toUpperCase()}/${String(equipment.length + 1).padStart(4, "0")}`;

  const openCreate = () => {
    setEditing(null);
    setForm({
      eq_number: eqSuggest,
      name: "",
      model: "",
      serial_number: "",
      manufacturer: "",
      category: "",
      location: "",
      status: "Ordered",
      warranty_start: "",
      warranty_end: "",
      amc_expiry: "",
      handover_date: "",
      handover_department: "",
      notes: "",
    });
    setChecklist([{ item: "", ok: false }]);
    setCertificates([]);
    setPhotoPaths([]);
    setDialogOpen(true);
  };

  const openEdit = (eq: any) => {
    setEditing(eq);
    setForm({
      eq_number: eq.eq_number ?? "",
      name: eq.name ?? "",
      model: eq.model ?? "",
      serial_number: eq.serial_number ?? "",
      manufacturer: eq.manufacturer ?? "",
      category: eq.category ?? "",
      location: eq.location ?? "",
      status: eq.status ?? "Ordered",
      warranty_start: eq.warranty_start
        ? new Date(eq.warranty_start).toISOString().slice(0, 10)
        : "",
      warranty_end: eq.warranty_end ? new Date(eq.warranty_end).toISOString().slice(0, 10) : "",
      amc_expiry: eq.amc_expiry ? new Date(eq.amc_expiry).toISOString().slice(0, 10) : "",
      handover_date: eq.handover_date ? new Date(eq.handover_date).toISOString().slice(0, 10) : "",
      handover_department: eq.handover_department ?? "",
      notes: eq.notes ?? "",
    });
    setChecklist(
      Array.isArray(eq.commissioning_checklist) && eq.commissioning_checklist.length > 0
        ? eq.commissioning_checklist
        : [{ item: "", ok: false }],
    );
    setCertificates(Array.isArray(eq.certificates) ? eq.certificates : []);
    setPhotoPaths(Array.isArray(eq.photos) ? eq.photos : []);
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
        const path = `equipment/${Date.now()}-${file.name}`;
        const result = await uploadFile({
            bucket: "photos",
            path,
            contentType: file.type || "image/jpeg",
            fileData: base64,
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
    if (!form.eq_number.trim() || !form.name.trim()) {
      toast.error("Equipment number and name are required");
      return;
    }
    setSaving(true);
    try {
      const cleanChecklist = checklist
        .filter((c) => c.item.trim())
        .map((c) => ({ item: c.item.trim(), ok: c.ok }));
      const payload = {
        eq_number: form.eq_number.trim(),
        name: form.name.trim(),
        model: form.model.trim() || undefined,
        serial_number: form.serial_number.trim() || undefined,
        manufacturer: form.manufacturer.trim() || undefined,
        category: form.category.trim() || undefined,
        location: form.location.trim() || undefined,
        status: form.status as
          "Ordered" | "Delivered" | "Installed" | "Testing" | "Commissioned" | "Handed Over",
        warranty_start: form.warranty_start || undefined,
        warranty_end: form.warranty_end || undefined,
        amc_expiry: form.amc_expiry || undefined,
        handover_date: form.handover_date || undefined,
        handover_department: form.handover_department.trim() || undefined,
        commissioning_checklist: cleanChecklist,
        certificates: certificates.filter((c) => c.type.trim()),
        photos: photoPaths,
        notes: form.notes.trim() || undefined,
      };

      if (editing) {
        const result = await updateEquipment({ id: editing.id, ...payload });
        if (result.success) {
          toast.success("Equipment updated");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["equipment"] });
        } else {
          toast.error(result.error ?? "Failed to update equipment");
        }
      } else {
        const result = await createEquipment(payload);
        if (result.success) {
          toast.success("Equipment created");
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ["equipment"] });
        } else {
          toast.error(result.error ?? "Failed to create equipment");
        }
      }
    } catch {
      toast.error("Failed to save equipment");
    }
    setSaving(false);
  };

  const filtered = equipment.filter((eq: any) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      eq.eq_number?.toLowerCase().includes(s) ||
      eq.name?.toLowerCase().includes(s) ||
      eq.model?.toLowerCase().includes(s) ||
      eq.manufacturer?.toLowerCase().includes(s) ||
      eq.category?.toLowerCase().includes(s)
    );
  });

  return (
    <AppShell
      title="Medical equipment"
      subtitle="Equipment commissioning — delivery → installation → testing → handover"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search equipment..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64 pl-9"
              data-tour="me-search-input"
            />
          </div>
          <SectionTour sectionKey="medical-equipment" steps={tourSteps} />
        </div>
        <Button size="sm" onClick={openCreate} data-tour="add-equipment">
          <Plus className="mr-1.5 size-4" /> Add equipment
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {filtered.length === 0 && (
          <Card className="col-span-full p-8 text-center text-sm text-muted-foreground">
            No equipment registered. Click "Add equipment" to track a new asset.
          </Card>
        )}
        {filtered.map((eq: any) => (
          <Card key={eq.id} className="flex flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{eq.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{eq.eq_number}</p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill
                  tone={STATUS_TONE[eq.status] ?? "info"}
                  data-tour="equipment-status-badge"
                >
                  {eq.status}
                </StatusPill>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => openEdit(eq)}
                  data-tour="me-edit-btn"
                >
                  <Pencil className="size-3.5" />
                </Button>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Field k="Model" v={eq.model ?? "—"} />
              <Field k="Serial" v={eq.serial_number ?? "—"} />
              <Field k="Manufacturer" v={eq.manufacturer ?? "—"} />
              <Field k="Category" v={eq.category ?? "—"} />
              <Field k="Location" v={eq.location ?? "—"} />
              <Field
                k="Warranty"
                v={
                  eq.warranty_end
                    ? `till ${new Date(eq.warranty_end).toLocaleDateString("en-IN")}`
                    : "—"
                }
              />
            </dl>

            {Array.isArray(eq.commissioning_checklist) && eq.commissioning_checklist.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-semibold text-muted-foreground">
                  Commissioning checklist
                </p>
                <ul className="space-y-1 text-xs">
                  {eq.commissioning_checklist.map((c: any, idx: number) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      {c.ok ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                      ) : (
                        <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                      )}
                      <span className={c.ok ? "" : "text-destructive"}>{c.item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Array.isArray(eq.certificates) && eq.certificates.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {eq.certificates.map((cert: any, idx: number) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-xs text-success"
                  >
                    <Award className="size-3" /> {cert.type}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-auto flex items-center justify-between pt-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Camera className="size-3" /> {Array.isArray(eq.photos) ? eq.photos.length : 0}
              </span>
              {eq.handover_date && (
                <span className="inline-flex items-center gap-1 text-success">
                  <Check className="size-3" /> Handed over{" "}
                  {new Date(eq.handover_date).toLocaleDateString("en-IN")}
                </span>
              )}
            </div>
          </Card>
        ))}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit equipment" : "Add equipment"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Update equipment details, commissioning checklist, certificates and photos."
                : "Register a new medical equipment asset."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="eq-num">Equipment number *</Label>
                <Input
                  id="eq-num"
                  value={form.eq_number}
                  onChange={(e) => setForm({ ...form, eq_number: e.target.value })}
                  placeholder="EQ/AUG/0001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eq-name">Name *</Label>
                <Input
                  id="eq-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. MRI Scanner 1.5T"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="eq-model">Model</Label>
                <Input
                  id="eq-model"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="Model number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eq-serial">Serial number</Label>
                <Input
                  id="eq-serial"
                  value={form.serial_number}
                  onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  placeholder="Serial number"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="eq-manuf">Manufacturer</Label>
                <Input
                  id="eq-manuf"
                  value={form.manufacturer}
                  onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                  placeholder="Manufacturer"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eq-cat">Category</Label>
                <Input
                  id="eq-cat"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="e.g. Radiology, Surgery, ICU"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="eq-loc">Location</Label>
                <Input
                  id="eq-loc"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  placeholder="e.g. Radiology · MRI Room"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger data-tour="me-status-dropdown">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Ordered">Ordered</SelectItem>
                    <SelectItem value="Delivered">Delivered</SelectItem>
                    <SelectItem value="Installed">Installed</SelectItem>
                    <SelectItem value="Testing">Testing</SelectItem>
                    <SelectItem value="Commissioned">Commissioned</SelectItem>
                    <SelectItem value="Handed Over">Handed Over</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="eq-ws">Warranty start</Label>
                <Input
                  id="eq-ws"
                  type="date"
                  value={form.warranty_start}
                  onChange={(e) => setForm({ ...form, warranty_start: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eq-we">Warranty end</Label>
                <Input
                  id="eq-we"
                  type="date"
                  value={form.warranty_end}
                  onChange={(e) => setForm({ ...form, warranty_end: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="eq-amc">AMC expiry</Label>
                <Input
                  id="eq-amc"
                  type="date"
                  value={form.amc_expiry}
                  onChange={(e) => setForm({ ...form, amc_expiry: e.target.value })}
                />
              </div>
            </div>
            {form.status === "Handed Over" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="eq-hd">Handover date</Label>
                  <Input
                    id="eq-hd"
                    type="date"
                    value={form.handover_date}
                    onChange={(e) => setForm({ ...form, handover_date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="eq-hdep">Handover department</Label>
                  <Input
                    id="eq-hdep"
                    value={form.handover_department}
                    onChange={(e) => setForm({ ...form, handover_department: e.target.value })}
                    placeholder="e.g. Radiology"
                  />
                </div>
              </div>
            )}

            {/* Commissioning checklist builder */}
            <div className="space-y-2">
              <Label>Commissioning checklist</Label>
              <div className="space-y-2">
                {checklist.map((c, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setChecklist(
                          checklist.map((ci, i) => (i === idx ? { ...ci, ok: !ci.ok } : ci)),
                        )
                      }
                      data-tour="me-checklist-toggle"
                      className={`flex size-8 shrink-0 items-center justify-center rounded-md border ${c.ok ? "border-success bg-success/10 text-success" : "border-destructive bg-destructive/10 text-destructive"}`}
                    >
                      {c.ok ? <Check className="size-4" /> : <X className="size-4" />}
                    </button>
                    <Input
                      value={c.item}
                      onChange={(e) =>
                        setChecklist(
                          checklist.map((ci, i) =>
                            i === idx ? { ...ci, item: e.target.value } : ci,
                          ),
                        )
                      }
                      placeholder={`Checklist item ${idx + 1}`}
                      className="flex-1"
                    />
                    {checklist.length > 1 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setChecklist(checklist.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setChecklist([...checklist, { item: "", ok: false }])}
                data-tour="me-add-checklist"
              >
                <Plus className="mr-1.5 size-3.5" /> Add checklist item
              </Button>
            </div>

            {/* Certificates */}
            <div className="space-y-2">
              <Label>Certificates (NABH, AERB, CE, FDA)</Label>
              <div className="space-y-2">
                {certificates.map((cert, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      value={cert.type}
                      onChange={(e) =>
                        setCertificates(
                          certificates.map((c, i) =>
                            i === idx ? { ...c, type: e.target.value } : c,
                          ),
                        )
                      }
                      placeholder="Type (NABH/AERB)"
                      className="w-32"
                    />
                    <Input
                      value={cert.number}
                      onChange={(e) =>
                        setCertificates(
                          certificates.map((c, i) =>
                            i === idx ? { ...c, number: e.target.value } : c,
                          ),
                        )
                      }
                      placeholder="Certificate number"
                      className="flex-1"
                    />
                    <Input
                      type="date"
                      value={cert.expiry_date}
                      onChange={(e) =>
                        setCertificates(
                          certificates.map((c, i) =>
                            i === idx ? { ...c, expiry_date: e.target.value } : c,
                          ),
                        )
                      }
                      className="w-40"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setCertificates(certificates.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCertificates([
                    ...certificates,
                    { type: "", number: "", issued_date: "", expiry_date: "" },
                  ])
                }
                data-tour="me-add-certificate"
              >
                <Plus className="mr-1.5 size-3.5" /> Add certificate
              </Button>
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
                  data-tour="me-upload-photos"
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
              <Label htmlFor="eq-notes">Notes</Label>
              <Textarea
                id="eq-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Any additional notes"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || uploadingPhotos} data-tour="me-save">
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              {editing ? "Update equipment" : "Create equipment"}
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
