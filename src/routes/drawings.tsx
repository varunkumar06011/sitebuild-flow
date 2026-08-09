// Drawings list + RFI thread view with SLA countdown badge
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
  fetchDrawings,
  uploadDrawingRevision,
  fetchRfis,
  raiseRfi,
  respondToRfi,
  closeRfi,
} from "@/lib/api/drawings";
import { uploadFile } from "@/lib/api/storage";
import { requireAuth } from "@/lib/auth-guards";
import { useRole } from "@/lib/role-context";
import { SectionTour, type TourStep } from "@/components/SectionTour";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Loader2,
  FileText,
  Upload,
  MessageSquare,
  Send,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/drawings")({
  head: () => ({
    meta: [
      { title: "Drawings & RFIs — Meditrust ERP" },
      {
        name: "description",
        content: "Engineering drawing register with RFI thread view and SLA tracking.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: DrawingsPage,
});

const RFI_STATUS_TONE: Record<string, "info" | "success" | "warning" | "danger"> = {
  Open: "warning",
  Answered: "info",
  Closed: "success",
};

function slaBadge(slaDueDate: string | null | undefined): {
  icon: typeof Clock;
  tone: "success" | "warning" | "danger";
  label: string;
} {
  if (!slaDueDate) return { icon: Clock, tone: "info" as any, label: "No SLA" };
  const due = new Date(slaDueDate);
  const now = new Date();
  const diffH = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60));
  if (diffH < 0) return { icon: XCircle, tone: "danger", label: `Overdue ${Math.abs(diffH)}h` };
  if (diffH <= 24) return { icon: AlertTriangle, tone: "warning", label: `${diffH}h left` };
  return { icon: Clock, tone: "success", label: `${Math.ceil(diffH / 24)}d left` };
}

function DrawingsPage() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const isAdmin = role === "Administrator" || role === "A1" || role === "A1+";
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tourSteps: TourStep[] = [
    {
      selector: '[data-tour="drw-search-input"]',
      title: "Search Drawings",
      description: "Type a drawing number or title to find a specific drawing quickly.",
    },
    {
      selector: '[data-tour="drw-discipline-filter"]',
      title: "Filter by Discipline",
      description:
        "Narrow drawings to Civil, Structural, MEP, Architectural, or Medical Gas to focus on your discipline.",
    },
    {
      selector: '[data-tour="drw-upload"]',
      title: "Upload Drawing",
      description:
        "Register a new drawing or revision with file upload — each revision is tracked separately for version control.",
    },
    {
      selector: '[data-tour="drw-list-item"]',
      title: "Drawing Card",
      description:
        "Click any drawing card to load its RFI thread and revision history on the right panel.",
    },
    {
      selector: '[data-tour="drw-raise"]',
      title: "Raise RFI",
      description:
        "Submit a request-for-information about this drawing — set an SLA due date so the consultant's response is tracked automatically.",
    },
    {
      selector: '[data-tour="drw-rfi-thread"]',
      title: "RFI Thread Panel",
      description:
        "View all RFIs for the selected drawing here — each RFI shows its status and SLA countdown badge so you can chase overdue responses.",
    },
  ];

  const [search, setSearch] = useState("");
  const [disciplineFilter, setDisciplineFilter] = useState("all");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [rfiDialogOpen, setRfiDialogOpen] = useState(false);
  const [respondDialogOpen, setRespondDialogOpen] = useState(false);
  const [selectedDrawing, setSelectedDrawing] = useState<any | null>(null);
  const [activeRfi, setActiveRfi] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [drawForm, setDrawForm] = useState({
    drawing_no: "",
    title: "",
    discipline: "",
    revision: "R0",
  });
  const [fileData, setFileData] = useState<{ base64: string; name: string; type: string } | null>(
    null,
  );

  const [rfiForm, setRfiForm] = useState({
    question: "",
    sla_due_date: "",
  });

  const [responseText, setResponseText] = useState("");

  const { data: drawData, isLoading } = useQuery({
    queryKey: ["drawings", search, disciplineFilter],
    queryFn: () =>
      fetchDrawings({
        data: {
          search: search || undefined,
          discipline: disciplineFilter !== "all" ? disciplineFilter : undefined,
        } as any,
      }),
  });
  const drawings = drawData?.data ?? [];

  const { data: rfiData } = useQuery({
    queryKey: ["rfis", selectedDrawing?.id],
    queryFn: () =>
      fetchRfis({
        data: { drawingId: selectedDrawing?.id } as any,
      }),
    enabled: !!selectedDrawing,
  });
  const rfis = rfiData?.data ?? [];

  function openUpload() {
    setDrawForm({ drawing_no: "", title: "", discipline: "", revision: "R0" });
    setFileData(null);
    setUploadDialogOpen(true);
  }

  function openRfiDialog(drawing: any) {
    setSelectedDrawing(drawing);
    setRfiForm({ question: "", sla_due_date: "" });
    setRfiDialogOpen(true);
  }

  function openRespondDialog(rfi: any) {
    setActiveRfi(rfi);
    setResponseText("");
    setRespondDialogOpen(true);
  }

  function openDrawingDetail(drawing: any) {
    setSelectedDrawing(drawing);
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      setFileData({ base64, name: file.name, type: file.type || "application/octet-stream" });
    } catch {
      toast.error("Failed to read file");
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleUploadDrawing() {
    if (!drawForm.drawing_no.trim() || !drawForm.title.trim() || !fileData) {
      toast.error("Drawing number, title, and file are required");
      return;
    }
    setSaving(true);
    try {
      const result = await uploadDrawingRevision({
        data: {
          drawing_no: drawForm.drawing_no.trim(),
          title: drawForm.title.trim(),
          discipline: drawForm.discipline.trim() || undefined,
          revision: drawForm.revision.trim() || "R0",
          fileData: fileData.base64,
          contentType: fileData.type,
          fileName: fileData.name,
        } as any,
      });
      if (result.success) {
        toast.success("Drawing uploaded");
        setUploadDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["drawings"] });
      } else {
        toast.error(result.error ?? "Failed to upload drawing");
      }
    } catch {
      toast.error("Failed to upload drawing");
    }
    setSaving(false);
  }

  async function handleRaiseRfi() {
    if (!rfiForm.question.trim()) {
      toast.error("Question is required");
      return;
    }
    setSaving(true);
    try {
      const result = await raiseRfi({
        data: {
          drawing_id: selectedDrawing?.id ?? null,
          question: rfiForm.question.trim(),
          sla_due_date: rfiForm.sla_due_date || null,
        } as any,
      });
      if (result.success) {
        toast.success(`RFI ${result.rfi_no ?? ""} raised`);
        setRfiDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["rfis"] });
      } else {
        toast.error(result.error ?? "Failed to raise RFI");
      }
    } catch {
      toast.error("Failed to raise RFI");
    }
    setSaving(false);
  }

  async function handleRespondRfi() {
    if (!responseText.trim() || !activeRfi) {
      toast.error("Response is required");
      return;
    }
    setSaving(true);
    try {
      const result = await respondToRfi({
        data: { id: activeRfi.id, response: responseText.trim() } as any,
      });
      if (result.success) {
        toast.success("RFI responded");
        setRespondDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: ["rfis"] });
      } else {
        toast.error(result.error ?? "Failed to respond to RFI");
      }
    } catch {
      toast.error("Failed to respond to RFI");
    }
    setSaving(false);
  }

  async function handleCloseRfi(rfiId: string) {
    try {
      const result = await closeRfi({ data: { id: rfiId } as any });
      if (result.success) {
        toast.success("RFI closed");
        queryClient.invalidateQueries({ queryKey: ["rfis"] });
      } else {
        toast.error(result.error ?? "Failed to close RFI");
      }
    } catch {
      toast.error("Failed to close RFI");
    }
  }

  return (
    <AppShell
      title="Drawings & RFIs"
      subtitle="Engineering drawing register with request-for-information tracking"
    >
      <div className="mb-4 flex items-center justify-end">
        <SectionTour sectionKey="drawings" steps={tourSteps} />
      </div>
      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search drawings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 pl-9"
            data-tour="drw-search-input"
          />
        </div>
        <Select value={disciplineFilter} onValueChange={setDisciplineFilter}>
          <SelectTrigger className="w-40" data-tour="drw-discipline-filter">
            <SelectValue placeholder="Discipline" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All disciplines</SelectItem>
            <SelectItem value="Civil">Civil</SelectItem>
            <SelectItem value="Structural">Structural</SelectItem>
            <SelectItem value="MEP">MEP</SelectItem>
            <SelectItem value="Architectural">Architectural</SelectItem>
            <SelectItem value="Medical Gas">Medical Gas</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={openUpload} className="ml-auto" data-tour="drw-upload">
          <Plus className="mr-1.5 size-4" /> Upload drawing
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Drawings list */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-muted-foreground">Drawings</p>
          {isLoading && (
            <Card className="p-8 text-center">
              <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
            </Card>
          )}
          {!isLoading && drawings.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No drawings registered. Click "Upload drawing" to add one.
            </Card>
          )}
          {drawings.map((d: any) => (
            <Card
              key={d.id}
              data-tour={drawings.indexOf(d) === 0 ? "drw-list-item" : undefined}
              className={`cursor-pointer p-4 transition-colors hover:bg-accent/50 ${
                selectedDrawing?.id === d.id ? "ring-2 ring-primary" : ""
              }`}
              onClick={() => openDrawingDetail(d)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{d.title}</p>
                  <p className="font-mono text-xs text-muted-foreground">{d.drawing_no}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill tone="info">{d.revision}</StatusPill>
                  {d.discipline && <StatusPill tone="neutral">{d.discipline}</StatusPill>}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <FileText className="size-3" />
                  {new Date(d.created_at).toLocaleDateString("en-IN")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  data-tour="drw-raise"
                  onClick={(e) => {
                    e.stopPropagation();
                    openRfiDialog(d);
                  }}
                >
                  <MessageSquare className="mr-1 size-3" /> Raise RFI
                </Button>
              </div>
            </Card>
          ))}
        </div>

        {/* RFI thread view */}
        <div className="space-y-3" data-tour="drw-rfi-thread">
          <p className="text-sm font-semibold text-muted-foreground">
            RFIs {selectedDrawing ? `· ${selectedDrawing.drawing_no}` : ""}
          </p>
          {!selectedDrawing && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Select a drawing to view its RFI thread
            </Card>
          )}
          {selectedDrawing && rfis.length === 0 && (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No RFIs for this drawing yet
            </Card>
          )}
          {rfis.map((rfi: any) => {
            const sla = slaBadge(rfi.sla_due_date);
            const SlaIcon = sla.icon;
            return (
              <Card key={rfi.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-semibold text-muted-foreground">
                      {rfi.rfi_no}
                    </p>
                    <p className="mt-1 text-sm">{rfi.question}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <StatusPill tone={RFI_STATUS_TONE[rfi.status] ?? "neutral"}>
                      {rfi.status}
                    </StatusPill>
                    {rfi.status !== "Closed" && (
                      <span
                        className={`inline-flex items-center gap-1 text-xs ${sla.tone === "danger" ? "text-destructive" : sla.tone === "warning" ? "text-warning-foreground" : "text-muted-foreground"}`}
                      >
                        <SlaIcon className="size-3" /> {sla.label}
                      </span>
                    )}
                  </div>
                </div>

                {rfi.response && (
                  <div className="mt-3 rounded-lg bg-muted p-3 text-sm">
                    <p className="mb-1 text-xs font-semibold text-muted-foreground">Response</p>
                    <p>{rfi.response}</p>
                    {rfi.responded_at && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(rfi.responded_at).toLocaleString("en-IN")}
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>by {rfi.raised_by_name ?? "—"}</span>
                  <span>·</span>
                  <span>{new Date(rfi.created_at).toLocaleDateString("en-IN")}</span>
                  {rfi.status === "Open" && isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      onClick={() => openRespondDialog(rfi)}
                    >
                      <Send className="mr-1 size-3" /> Respond
                    </Button>
                  )}
                  {rfi.status === "Answered" && isAdmin && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="ml-auto"
                      onClick={() => handleCloseRfi(rfi.id)}
                    >
                      <CheckCircle2 className="mr-1 size-3" /> Close
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Upload drawing dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload drawing revision</DialogTitle>
            <DialogDescription>Upload a drawing file with revision tracking</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="dwg-no">Drawing number *</Label>
                <Input
                  id="dwg-no"
                  value={drawForm.drawing_no}
                  onChange={(e) => setDrawForm({ ...drawForm, drawing_no: e.target.value })}
                  placeholder="DWG-001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dwg-rev">Revision</Label>
                <Input
                  id="dwg-rev"
                  value={drawForm.revision}
                  onChange={(e) => setDrawForm({ ...drawForm, revision: e.target.value })}
                  placeholder="R0"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dwg-title">Title *</Label>
              <Input
                id="dwg-title"
                value={drawForm.title}
                onChange={(e) => setDrawForm({ ...drawForm, title: e.target.value })}
                placeholder="Drawing title"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dwg-disc">Discipline</Label>
              <Input
                id="dwg-disc"
                value={drawForm.discipline}
                onChange={(e) => setDrawForm({ ...drawForm, discipline: e.target.value })}
                placeholder="Civil, Structural, MEP..."
              />
            </div>
            <div className="space-y-2">
              <Label>Drawing file *</Label>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-1.5 size-4 animate-spin" />
                  ) : (
                    <Upload className="mr-1.5 size-4" />
                  )}
                  Choose file
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.dwg,.dxf,image/jpeg,image/png"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                {fileData && <span className="text-xs text-success">{fileData.name}</span>}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUploadDrawing} disabled={saving || uploading}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Upload className="mr-2 size-4" />
              )}
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raise RFI dialog */}
      <Dialog open={rfiDialogOpen} onOpenChange={setRfiDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Raise RFI</DialogTitle>
            <DialogDescription>
              {selectedDrawing ? `For drawing ${selectedDrawing.drawing_no}` : "General RFI"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="rfi-q">Question *</Label>
              <Textarea
                id="rfi-q"
                value={rfiForm.question}
                onChange={(e) => setRfiForm({ ...rfiForm, question: e.target.value })}
                placeholder="Describe the clarification needed..."
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rfi-sla">SLA due date</Label>
              <Input
                id="rfi-sla"
                type="date"
                value={rfiForm.sla_due_date}
                onChange={(e) => setRfiForm({ ...rfiForm, sla_due_date: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRfiDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRaiseRfi} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              Raise RFI
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Respond to RFI dialog */}
      <Dialog open={respondDialogOpen} onOpenChange={setRespondDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Respond to RFI</DialogTitle>
            <DialogDescription>{activeRfi?.rfi_no}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="rounded-lg bg-muted p-3 text-sm">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Question</p>
              <p>{activeRfi?.question}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="rfi-resp">Response *</Label>
              <Textarea
                id="rfi-resp"
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                placeholder="Enter your response..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRespondDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleRespondRfi} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}
              Send response
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
