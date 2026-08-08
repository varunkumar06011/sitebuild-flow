// Gate pass management page for issuing, OTP-verifying and tracking material exit passes.
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
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
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
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Separator } from "@/components/ui/separator";
import {
  fetchGatePasses,
  createGatePass,
  precheckOtpSend,
  verifyPhoneOtp,
  recordExit,
  fetchGatePassTimeline,
  getGatePassSignedUrl,
  fetchAdminContacts,
  fetchGatePassById,
} from "@/lib/api/gate-passes";
import { fetchBatches } from "@/lib/api/batches";
import { fetchRequisitions } from "@/lib/api/requisitions";
import { sendPhoneOtp, confirmPhoneOtp, type PhoneConfirmationResult } from "@/lib/firebase";
import { uploadFile } from "@/lib/api/storage";
import { requireAuth } from "@/lib/auth-guards";
import { useRole } from "@/lib/role-context";
import { toast } from "sonner";
import {
  Truck,
  FileText,
  Share2,
  Clock,
  Send,
  Plus,
  Search,
  Contact,
  Camera,
  Printer,
  CheckCircle2,
  Loader2,
  X,
  ChevronRight,
  ChevronLeft,
  Boxes,
  ClipboardList,
} from "lucide-react";

export const Route = createFileRoute("/gate-pass")({
  head: () => ({
    meta: [
      { title: "Gate Pass — OTP Material Exit | Meditrust ERP" },
      {
        name: "description",
        content:
          "Issue gate passes, verify approval via Firebase Phone Auth OTP, and stamp material exit time.",
      },
      { property: "og:title", content: "Gate Pass — OTP Material Exit" },
      {
        property: "og:description",
        content: "Phone-OTP verification before any material leaves the hospital site.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: GatePassPage,
});

const PAGE_SIZE = 20;

// Main gate pass page component showing pass list, OTP terminal and exit workflow.
function GatePassPage() {
  const queryClient = useQueryClient();
  const { role } = useRole();
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState("");
  const [page, setPage] = useState(1);

  const { data: gpData, isLoading } = useQuery({
    queryKey: ["gatePasses", statusFilter, searchTerm, page],
    queryFn: () =>
      fetchGatePasses({
        data: {
          page,
          limit: PAGE_SIZE,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(searchTerm ? { search: searchTerm } : {}),
        },
      }),
  });
  const passes = gpData?.data ?? [];
  const total = gpData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const [activeId, setActiveId] = useState<string | null>(null);
  const [otp, setOtp] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [printPreviewId, setPrintPreviewId] = useState<string | null>(null);
  const confirmationRef = useRef<PhoneConfirmationResult | null>(null);

  const active = passes.find((p: any) => p.id === activeId) ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["gatePasses"] });

  const canCreate =
    role === "Supervisor" || role === "Administrator" || role === "A1" || role === "A1+";

  // Sends an OTP SMS to the approver via Firebase Phone Auth (rate-limited server-side).
  const handleSendOtp = async () => {
    if (!active) return;
    setSendingOtp(true);
    try {
      const precheck = await precheckOtpSend({ data: { gatePassId: active.id } });
      if (!precheck.allowed) {
        toast.error(precheck.error ?? "OTP send not allowed");
        setSendingOtp(false);
        return;
      }
      confirmationRef.current = await sendPhoneOtp(precheck.phone ?? active.approver_phone!);
      toast.success(`OTP sent to ${precheck.phone ?? active.approver_phone}`);
    } catch (e) {
      toast.error((e as Error)?.message ?? "Failed to send OTP");
    }
    setSendingOtp(false);
  };

  // Verifies the entered 6-digit OTP via Firebase, then confirms with the server.
  const handleVerifyOtp = async () => {
    if (!active || otp.length !== 6 || !confirmationRef.current) return;
    setVerifying(true);
    try {
      const idToken = await confirmPhoneOtp(confirmationRef.current, otp);
      const result = await verifyPhoneOtp({ data: { gatePassId: active.id, idToken } });
      if (result.success) {
        toast.success("OTP verified — gate pass approved");
        setOtp("");
        confirmationRef.current = null;
        refresh();
      } else {
        toast.error(result.error ?? "Invalid OTP");
      }
    } catch (e) {
      toast.error((e as Error)?.message ?? "Failed to verify OTP");
    }
    setVerifying(false);
    setOtp("");
  };

  // Records the material exit time at the gate.
  const handleRecordExit = async () => {
    if (!active) return;
    setExiting(true);
    try {
      const result = await recordExit({ data: { gatePassId: active.id } });
      if (result.success) {
        toast.success("Exit time stamped");
        refresh();
      } else {
        toast.error(result.error ?? "Failed to record exit");
      }
    } catch {
      toast.error("Failed to record exit");
    }
    setExiting(false);
  };

  // Fetches and displays the signed PDF URL for the selected gate pass.
  const handleViewPdf = async () => {
    if (!active) return;
    setLoadingPdf(true);
    try {
      const result = await getGatePassSignedUrl({ data: { gatePassId: active.id } });
      if (result.success && result.url) {
        setPdfUrl(result.url);
      } else {
        toast.error(result.error ?? "No PDF available for this gate pass");
      }
    } catch {
      toast.error("Failed to load PDF");
    }
    setLoadingPdf(false);
  };

  // Opens WhatsApp with a pre-filled summary of the active gate pass for sharing.
  const handleWhatsAppShare = () => {
    if (!active) return;
    const text = `Gate Pass ${active.gp_number}: ${active.material} (${active.qty}) — Status: ${active.status}`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  return (
    <AppShell title="Gate pass" subtitle="Gate Pass → OTP → Material exit → Exit time">
      {/* Invisible reCAPTCHA container required by Firebase Phone Auth */}
      <div id="recaptcha-container" />

      {canCreate && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 size-4" /> Create Gate Pass
          </Button>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold">Gate passes</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search GP no / person / material"
                  className="h-8 w-48 pl-7 text-xs"
                />
              </div>
              <Select
                value={statusFilter || "all"}
                onValueChange={(v) => {
                  setStatusFilter(v === "all" ? "" : v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="Awaiting OTP">Awaiting OTP</SelectItem>
                  <SelectItem value="OTP Verified">OTP Verified</SelectItem>
                  <SelectItem value="Exited">Exited</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {isLoading && (
              <div className="flex justify-center py-6">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && passes.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No gate passes found.
              </p>
            )}
            {passes.map((g: any) => (
              <button
                key={g.id}
                onClick={() => {
                  setActiveId(g.id);
                  setOtp("");
                  confirmationRef.current = null;
                }}
                className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors ${
                  activeId === g.id ? "border-primary bg-accent" : "border-border hover:bg-surface"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-semibold">{g.material}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.gp_number} · {g.qty} · {g.carrier ?? "—"} · {g.vehicle ?? "—"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">{g.type}</span>
                  <StatusPill
                    tone={
                      g.status === "Exited"
                        ? "success"
                        : g.status === "OTP Verified"
                          ? "info"
                          : "warning"
                    }
                  >
                    {g.status}
                  </StatusPill>
                </div>
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Page {page} of {totalPages} · {total} total
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="size-3.5" /> Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Next <ChevronRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold">Gate terminal</h2>
          {active ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl bg-surface p-4 text-center">
                <p className="font-mono text-xs text-muted-foreground">{active.gp_number}</p>
                <p className="mt-1 text-sm font-semibold">
                  {active.person_name ?? active.material}
                </p>
              </div>

              {active.status === "Awaiting OTP" && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Send an OTP to the approver ({active.approver_phone ?? "—"})
                  </p>
                  <Button
                    variant="outline"
                    className="mt-2 w-full"
                    disabled={sendingOtp}
                    onClick={handleSendOtp}
                  >
                    <Send className="mr-2 size-4" />
                    {sendingOtp ? "Sending..." : "Send OTP"}
                  </Button>
                  {confirmationRef.current && (
                    <>
                      <div className="mt-3">
                        <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                          <InputOTPGroup>
                            {[0, 1, 2, 3, 4, 5].map((i) => (
                              <InputOTPSlot key={i} index={i} />
                            ))}
                          </InputOTPGroup>
                        </InputOTP>
                      </div>
                      <Button
                        className="mt-3 w-full"
                        disabled={otp.length !== 6 || verifying}
                        onClick={handleVerifyOtp}
                      >
                        {verifying ? "Verifying..." : "Verify OTP"}
                      </Button>
                    </>
                  )}
                </div>
              )}

              {active.status === "OTP Verified" && (
                <>
                  <Button className="w-full" disabled={exiting} onClick={handleRecordExit}>
                    <Truck className="size-4" /> {exiting ? "Recording..." : "Record exit"}
                  </Button>
                  <Button variant="outline" className="w-full" onClick={handleWhatsAppShare}>
                    <Share2 className="size-4" /> Share via WhatsApp
                  </Button>
                </>
              )}

              {active.status === "Exited" && (
                <div className="rounded-lg bg-success-soft p-3 text-sm text-success">
                  Material exited at{" "}
                  {active.exit_time ? new Date(active.exit_time).toLocaleString("en-IN") : "—"}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  disabled={loadingPdf}
                  onClick={handleViewPdf}
                >
                  <FileText className="mr-1.5 size-3.5" /> {loadingPdf ? "Loading..." : "View PDF"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setTimelineOpen(true)}
                >
                  <Clock className="mr-1.5 size-3.5" /> Timeline
                </Button>
              </div>

              <dl className="space-y-1.5 text-xs">
                <Row
                  k="Requested"
                  v={
                    active.requested_at
                      ? new Date(active.requested_at).toLocaleString("en-IN")
                      : "—"
                  }
                />
                <Row k="Carrier" v={active.carrier ?? "—"} />
                <Row k="Vehicle" v={active.vehicle ?? "—"} />
                <Row k="Type" v={active.type} />
                <Row
                  k="Exit time"
                  v={active.exit_time ? new Date(active.exit_time).toLocaleString("en-IN") : "—"}
                />
                <Row k="Vendor" v={active.vendor_name ?? "—"} />
                <Row k="From" v={active.from_location ?? "—"} />
                <Row k="To" v={active.to_location ?? "—"} />
              </dl>
            </div>
          ) : (
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Select a gate pass to view details.
            </p>
          )}
        </Card>
      </div>

      <Dialog open={timelineOpen} onOpenChange={setTimelineOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Gate pass timeline</DialogTitle>
            <DialogDescription>{active?.gp_number} — audit trail of all actions</DialogDescription>
          </DialogHeader>
          <TimelineContent gatePassId={active?.id ?? ""} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!pdfUrl} onOpenChange={(v) => !v && setPdfUrl(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Gate pass PDF</DialogTitle>
            <DialogDescription>{active?.gp_number}</DialogDescription>
          </DialogHeader>
          {pdfUrl && (
            <iframe
              src={pdfUrl}
              className="h-[70vh] w-full rounded-lg border border-border"
              title="Gate Pass PDF"
            />
          )}
        </DialogContent>
      </Dialog>

      <CreateGatePassDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          refresh();
          setPrintPreviewId(id);
        }}
      />

      <PrintPreviewDialog
        gatePassId={printPreviewId}
        onOpenChange={(v) => !v && setPrintPreviewId(null)}
      />
    </AppShell>
  );
}

// Renders the audit timeline entries for a single gate pass.
function TimelineContent({ gatePassId }: { gatePassId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["gatePassTimeline", gatePassId],
    queryFn: () => fetchGatePassTimeline({ data: { gatePassId } }),
    enabled: !!gatePassId,
  });

  if (isLoading)
    return <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>;
  if (!data || data.length === 0)
    return <p className="py-4 text-center text-sm text-muted-foreground">No actions recorded.</p>;

  return (
    <div className="space-y-3">
      {data.map((entry: any, i: number) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="size-2 rounded-full bg-primary" />
            {i < data.length - 1 && <div className="w-px flex-1 bg-border" />}
          </div>
          <div className="pb-3">
            <p className="text-sm font-medium">{entry.action.replace(/_/g, " ")}</p>
            <p className="text-xs text-muted-foreground">
              {entry.user_name} · {new Date(entry.created_at).toLocaleString("en-IN")}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// Small label/value row used in the gate pass detail panel.
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}

// ===========================================================================
// Create Gate Pass Dialog — multi-step: Form → OTP → Success
// ===========================================================================
type CreateStep = "form" | "otp" | "success";

// Multi-step dialog for creating a gate pass: form entry, OTP approval, then success confirmation.
function CreateGatePassDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const [step, setStep] = useState<CreateStep>("form");
  const [submitting, setSubmitting] = useState(false);
  const [gatePassId, setGatePassId] = useState<string | null>(null);
  const [gpNumber, setGpNumber] = useState<string>("");
  const [otp, setOtp] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // form fields
  const today = new Date();
  const [personName, setPersonName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverMobile, setDriverMobile] = useState("");
  const [materialMovement, setMaterialMovement] = useState(false);
  const [materialList, setMaterialList] = useState<{ name: string; qty: string }[]>([
    { name: "", qty: "" },
  ]);
  const [remarks, setRemarks] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [gpDate, setGpDate] = useState(today.toISOString().split("T")[0]);
  const [gpTime, setGpTime] = useState((today.toTimeString().split(" ")[0] ?? "").slice(0, 5));
  const [approverPhone, setApproverPhone] = useState("");
  const [gpType, setGpType] = useState<"Returnable" | "Non-returnable">("Non-returnable");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [requisitionId, setRequisitionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const confirmationRef = useRef<PhoneConfirmationResult | null>(null);

  // Resets all form fields and wizard step back to the initial state.
  const resetForm = () => {
    setStep("form");
    setGatePassId(null);
    setGpNumber("");
    setOtp("");
    setPersonName("");
    setPurpose("");
    setVehicleType("");
    setVehicleNumber("");
    setDriverName("");
    setDriverMobile("");
    setMaterialMovement(false);
    setMaterialList([{ name: "", qty: "" }]);
    setRemarks("");
    setPhotoFile(null);
    setPhotoPreview(null);
    setApproverPhone("");
    setGpType("Non-returnable");
    setBatchId(null);
    setRequisitionId(null);
    confirmationRef.current = null;
    const now = new Date();
    setGpDate(now.toISOString().split("T")[0]);
    setGpTime((now.toTimeString().split(" ")[0] ?? "").slice(0, 5));
  };

  // Reads the selected photo file and generates a local preview thumbnail.
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Photo must be under 5MB");
      return;
    }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  // Appends a new empty material row to the material list.
  const handleAddMaterial = () => {
    setMaterialList([...materialList, { name: "", qty: "" }]);
  };

  // Removes a material row from the list by index.
  const handleRemoveMaterial = (idx: number) => {
    setMaterialList(materialList.filter((_, i) => i !== idx));
  };

  // Updates a single field of a material row in the list.
  const handleMaterialChange = (idx: number, field: "name" | "qty", value: string) => {
    const updated = [...materialList];
    if (updated[idx]) updated[idx][field] = value;
    setMaterialList(updated);
  };

  // Submits the gate pass form, uploads photo proof and advances to the OTP step.
  const handleSubmit = async () => {
    if (!personName.trim()) {
      toast.error("Person/Visitor name is required");
      return;
    }
    if (!approverPhone.trim()) {
      toast.error("Admin mobile number is required for OTP approval");
      return;
    }

    setSubmitting(true);
    try {
      let photoPath: string | null = null;

      // Upload photo if provided
      if (photoFile) {
        const reader = new FileReader();
        const fileData = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1];
            resolve(base64 ?? "");
          };
          reader.onerror = reject;
          reader.readAsDataURL(photoFile);
        });

        photoPath = `gate-pass/${Date.now()}-${photoFile.name}`;
        const uploadResult = await uploadFile({
          data: {
            bucket: "photos",
            path: photoPath,
            contentType: photoFile.type,
            fileData,
          },
        });

        if (!uploadResult.success) {
          toast.error("Photo upload failed — continuing without photo");
          photoPath = null;
        }
      }

      const cleanMaterialList = materialList.filter((m) => m.name.trim());

      const result = await createGatePass({
        data: {
          person_name: personName,
          purpose: purpose || undefined,
          vehicle_type: vehicleType || undefined,
          vehicle: vehicleNumber || undefined,
          driver_name: driverName || undefined,
          driver_mobile: driverMobile || undefined,
          material_movement: materialMovement,
          material_list: cleanMaterialList,
          remarks: remarks || undefined,
          photo_proof_path: photoPath,
          gp_date: gpDate,
          gp_time: gpTime,
          approver_phone: approverPhone,
          type: gpType,
          batch_id: batchId,
          requisition_id: requisitionId,
        },
      });

      if (result.success && result.id) {
        setGatePassId(result.id);
        setGpNumber(result.gp_number);
        setStep("otp");
        toast.success(`Gate Pass ${result.gp_number} created — send OTP for approval`);
      } else {
        toast.error(result.error ?? "Failed to create gate pass");
      }
    } catch {
      toast.error("Failed to create gate pass");
    }
    setSubmitting(false);
  };

  // Sends an OTP SMS to the approver via Firebase Phone Auth (rate-limited server-side).
  const handleSendOtp = async () => {
    if (!gatePassId || !approverPhone.trim()) return;
    setSendingOtp(true);
    try {
      const precheck = await precheckOtpSend({ data: { gatePassId } });
      if (!precheck.allowed) {
        toast.error(precheck.error ?? "OTP send not allowed");
        setSendingOtp(false);
        return;
      }
      confirmationRef.current = await sendPhoneOtp(approverPhone);
      toast.success(`OTP sent to ${approverPhone}`);
    } catch (e) {
      toast.error((e as Error)?.message ?? "Failed to send OTP");
    }
    setSendingOtp(false);
  };

  // Verifies the OTP via Firebase, confirms with the server, advances to success.
  const handleVerifyOtp = async () => {
    if (!gatePassId || otp.length !== 6 || !confirmationRef.current) return;
    setVerifying(true);
    try {
      const idToken = await confirmPhoneOtp(confirmationRef.current, otp);
      const result = await verifyPhoneOtp({ data: { gatePassId, idToken } });
      if (result.success) {
        toast.success("OTP verified — Gate Pass approved");
        setStep("success");
        onCreated(gatePassId);
      } else {
        toast.error(result.error ?? "Invalid OTP");
      }
    } catch (e) {
      toast.error((e as Error)?.message ?? "Failed to verify OTP");
    }
    setVerifying(false);
    setOtp("");
  };

  // Handles dialog close, resetting the form when leaving the success step.
  const handleClose = (v: boolean) => {
    if (!v) {
      if (step === "success") resetForm();
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === "form" && "Create Gate Pass"}
            {step === "otp" && `OTP Approval — ${gpNumber}`}
            {step === "success" && "Gate Pass Approved"}
          </DialogTitle>
          <DialogDescription>
            {step === "form" &&
              "Fill in the details below. Date & time are editable now but locked after submission."}
            {step === "otp" && `Enter the OTP sent to ${approverPhone}`}
            {step === "success" && `Gate Pass ${gpNumber} is ready to print`}
          </DialogDescription>
        </DialogHeader>

        {step === "form" && (
          <div className="space-y-4">
            {/* Date & Time — editable only while creating */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={gpDate}
                  onChange={(e) => setGpDate(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Time</Label>
                <Input
                  type="time"
                  value={gpTime}
                  onChange={(e) => setGpTime(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">
                Visitor / Person Name <span className="text-destructive">*</span>
              </Label>
              <Input
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder="Full name of the person"
                className="mt-1"
              />
            </div>

            <div>
              <Label className="text-xs">Purpose</Label>
              <Input
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Reason for gate pass"
                className="mt-1"
              />
            </div>

            <Separator />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Vehicle Type</Label>
                <Select value={vehicleType} onValueChange={setVehicleType}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Truck">Truck</SelectItem>
                    <SelectItem value="Tempo">Tempo</SelectItem>
                    <SelectItem value="Pickup">Pickup</SelectItem>
                    <SelectItem value="Car">Car</SelectItem>
                    <SelectItem value="Bike">Bike</SelectItem>
                    <SelectItem value="Auto">Auto</SelectItem>
                    <SelectItem value="On Foot">On Foot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Vehicle Number</Label>
                <Input
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  placeholder="e.g. TN-09-CQ-4412"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">Driver Name</Label>
                <Input
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  placeholder="Driver's full name"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Driver Mobile</Label>
                <Input
                  value={driverMobile}
                  onChange={(e) => setDriverMobile(e.target.value)}
                  placeholder="+91..."
                  className="mt-1"
                />
              </div>
            </div>

            <Separator />

            {/* Material Movement */}
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <Label className="text-sm font-medium">Material Movement</Label>
                <p className="text-xs text-muted-foreground">Toggle if materials are being moved</p>
              </div>
              <Switch checked={materialMovement} onCheckedChange={setMaterialMovement} />
            </div>

            {materialMovement && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">Material List</Label>
                  <Button size="sm" variant="outline" onClick={handleAddMaterial}>
                    <Plus className="mr-1 size-3" /> Add
                  </Button>
                </div>
                {materialList.map((m, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input
                      value={m.name}
                      onChange={(e) => handleMaterialChange(idx, "name", e.target.value)}
                      placeholder="Material name"
                      className="flex-1"
                    />
                    <Input
                      value={m.qty}
                      onChange={(e) => handleMaterialChange(idx, "qty", e.target.value)}
                      placeholder="Qty"
                      className="w-28"
                    />
                    {materialList.length > 1 && (
                      <Button size="icon" variant="ghost" onClick={() => handleRemoveMaterial(idx)}>
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div>
              <Label className="text-xs">Remarks</Label>
              <Textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Any additional notes..."
                className="mt-1"
                rows={2}
              />
            </div>

            {/* Photo Proof */}
            <div>
              <Label className="text-xs">
                Photo Proof {materialMovement && <span className="text-destructive">*</span>}
              </Label>
              <div className="mt-1 flex items-center gap-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Camera className="mr-2 size-4" /> Upload Photo
                </Button>
                {photoPreview && (
                  <img
                    src={photoPreview}
                    alt="Preview"
                    className="h-16 w-16 rounded-lg border border-border object-cover"
                  />
                )}
              </div>
            </div>

            <Separator />

            {/* Gate Pass Type */}
            <div>
              <Label className="text-xs">Gate Pass Type</Label>
              <Select
                value={gpType}
                onValueChange={(v) => setGpType(v as "Returnable" | "Non-returnable")}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Returnable">Returnable</SelectItem>
                  <SelectItem value="Non-returnable">Non-returnable</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Document linking — procurement pipeline */}
            <div>
              <Label className="text-xs">Link Requisition (PR / PO / Invoice)</Label>
              <p className="mb-1 text-[11px] text-muted-foreground">
                Optional — ties this pass to the procurement document chain
              </p>
              <RequisitionPicker value={requisitionId} onChange={setRequisitionId} />
            </div>

            {/* Traceability linking — material batch */}
            <div>
              <Label className="text-xs">Link Batch (Traceability)</Label>
              <p className="mb-1 text-[11px] text-muted-foreground">
                Optional — Supplier → Batch → Manufacturer → MTC → Lab Report
              </p>
              <BatchPicker value={batchId} onChange={setBatchId} />
            </div>

            <Separator />

            {/* Admin Mobile for OTP */}
            <div>
              <Label className="text-xs">
                Admin Mobile Number <span className="text-destructive">*</span>
              </Label>
              <p className="mb-1 text-[11px] text-muted-foreground">
                OTP will be sent to this admin for approval
              </p>
              <AdminContactPicker value={approverPhone} onChange={setApproverPhone} />
            </div>

            <Button
              className="w-full"
              disabled={submitting || (materialMovement && !photoFile)}
              onClick={handleSubmit}
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" /> Creating...
                </>
              ) : (
                <>
                  Create & Send for Approval <ChevronRight className="ml-1 size-4" />
                </>
              )}
            </Button>
          </div>
        )}

        {step === "otp" && (
          <div className="space-y-4">
            <div className="rounded-lg bg-info-soft p-4 text-center">
              <p className="text-sm font-medium">
                Gate Pass <span className="font-bold">{gpNumber}</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Created for {personName}</p>
            </div>

            <div className="text-center">
              <p className="text-sm text-muted-foreground">Send OTP to approver</p>
              <p className="font-bold">{approverPhone}</p>
            </div>

            <Button
              variant="outline"
              className="w-full"
              disabled={sendingOtp}
              onClick={handleSendOtp}
            >
              <Send className="mr-2 size-4" />
              {sendingOtp ? "Sending..." : confirmationRef.current ? "Resend OTP" : "Send OTP"}
            </Button>

            {confirmationRef.current && (
              <>
                <div className="flex justify-center">
                  <InputOTP maxLength={6} value={otp} onChange={setOtp}>
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>

                <Button
                  className="w-full"
                  disabled={otp.length !== 6 || verifying}
                  onClick={handleVerifyOtp}
                >
                  {verifying ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" /> Verifying...
                    </>
                  ) : (
                    <>Verify OTP & Continue</>
                  )}
                </Button>
              </>
            )}
          </div>
        )}

        {step === "success" && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-success-soft">
              <CheckCircle2 className="size-8 text-success" />
            </div>
            <div>
              <p className="text-lg font-bold">{gpNumber}</p>
              <p className="text-sm text-muted-foreground">Gate Pass approved and ready</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  handleClose(false);
                  resetForm();
                }}
              >
                Close
              </Button>
              <Button className="flex-1" onClick={() => window.print()}>
                <Printer className="mr-2 size-4" /> Print
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Admin Contact Picker — searchable popover with admin list
// ===========================================================================
// Searchable popover that lets the user pick an admin contact for OTP approval.
function AdminContactPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["adminContacts", search],
    queryFn: () =>
      fetchAdminContacts({ data: { search: search || undefined } as { search?: string } }),
    enabled: open,
  });

  const admins = data?.data ?? [];

  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="+91..."
        className="flex-1"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon">
            <Contact className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search admin by name or phone..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No admin found</CommandEmpty>
              <CommandGroup heading="Admins">
                {admins.map((admin: any) => (
                  <CommandItem
                    key={admin.id}
                    onSelect={() => {
                      onChange(admin.phone);
                      setOpen(false);
                    }}
                  >
                    <div className="flex w-full items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{admin.name}</p>
                        <p className="text-xs text-muted-foreground">{admin.role}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">{admin.phone}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ===========================================================================
// Batch Picker — searchable popover listing material batches (traceability)
// ===========================================================================
// Searchable popover that lets the user link a gate pass to a traceability batch.
function BatchPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["batchesForGatePass", search],
    queryFn: () => fetchBatches({ data: { search: search || undefined } as { search?: string } }),
    enabled: open,
  });

  const batches = data?.data ?? [];
  const selected = batches.find((b: any) => b.id === value);

  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={selected ? `${selected.batch_number} — ${selected.material}` : ""}
        placeholder="Select a batch (optional)"
        className="flex-1"
      />
      {value && (
        <Button variant="ghost" size="icon" onClick={() => onChange(null)}>
          <X className="size-4" />
        </Button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon">
            <Boxes className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search batch no / material / supplier..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No batch found</CommandEmpty>
              <CommandGroup heading="Batches">
                {batches.map((b: any) => (
                  <CommandItem
                    key={b.id}
                    onSelect={() => {
                      onChange(b.id);
                      setOpen(false);
                    }}
                  >
                    <div className="flex w-full items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{b.batch_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {b.material} · {b.supplier ?? "—"}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">{b.status}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ===========================================================================
// Requisition Picker — searchable popover listing PRs (document chain)
// ===========================================================================
// Searchable popover that lets the user link a gate pass to a procurement requisition.
function RequisitionPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const { data } = useQuery({
    queryKey: ["requisitionsForGatePass", search],
    queryFn: () =>
      fetchRequisitions({ data: { search: search || undefined } as { search?: string } }),
    enabled: open,
  });

  const reqs = data?.data ?? [];
  const selected = reqs.find((r: any) => r.id === value);

  return (
    <div className="flex gap-2">
      <Input
        readOnly
        value={selected ? `${selected.pr_number} — ${selected.title}` : ""}
        placeholder="Select a requisition (optional)"
        className="flex-1"
      />
      {value && (
        <Button variant="ghost" size="icon" onClick={() => onChange(null)}>
          <X className="size-4" />
        </Button>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon">
            <ClipboardList className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search PR no / title / block..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>No requisition found</CommandEmpty>
              <CommandGroup heading="Requisitions">
                {reqs.map((r: any) => (
                  <CommandItem
                    key={r.id}
                    onSelect={() => {
                      onChange(r.id);
                      setOpen(false);
                    }}
                  >
                    <div className="flex w-full items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">{r.pr_number}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.title} · {r.stage}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">{r.vendor_name ?? "—"}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ===========================================================================
// Print Preview Dialog — compact printable gate pass
// ===========================================================================
// Dialog showing a compact, printable gate pass layout with signature blocks.
function PrintPreviewDialog({
  gatePassId,
  onOpenChange,
}: {
  gatePassId: string | null;
  onOpenChange: (v: boolean) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["gatePassPrint", gatePassId],
    queryFn: () => fetchGatePassById({ data: { gatePassId: gatePassId! } }),
    enabled: !!gatePassId,
  });

  const gp = data?.data;

  return (
    <Dialog open={!!gatePassId} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Print Preview</DialogTitle>
          <DialogDescription>
            {gp?.gp_number ? `Gate Pass ${gp.gp_number}` : "Loading..."}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {gp && (
          <div className="space-y-4">
            {/* Printable Gate Pass */}
            <div className="print-area rounded-xl border-2 border-border p-5 print:border-0 print:shadow-none">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <p className="text-sm font-bold">Meditrust Hospitals</p>
                  <p className="text-[10px] text-muted-foreground">Hospital Construction Site</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-muted-foreground">Gate Pass No.</p>
                  <p className="font-mono text-lg font-bold">{gp.gp_number}</p>
                </div>
              </div>

              {/* Date & Time */}
              <div className="mt-3 flex justify-between text-xs">
                <span>
                  <span className="text-muted-foreground">Date:</span>{" "}
                  <strong>{gp.gp_date ?? "—"}</strong>
                </span>
                <span>
                  <span className="text-muted-foreground">Time:</span>{" "}
                  <strong>{gp.gp_time ?? "—"}</strong>
                </span>
              </div>

              {/* Person Details */}
              <div className="mt-3 space-y-1.5 text-xs">
                <PrintRow k="Person / Visitor" v={gp.person_name ?? "—"} />
                <PrintRow k="Purpose" v={gp.purpose ?? "—"} />
                <PrintRow k="Driver Name" v={gp.driver_name ?? "—"} />
                <PrintRow k="Driver Mobile" v={gp.driver_mobile ?? "—"} />
              </div>

              {/* Vehicle Details */}
              <div className="mt-3 space-y-1.5 text-xs">
                <PrintRow k="Vehicle Type" v={gp.vehicle_type ?? "—"} />
                <PrintRow k="Vehicle Number" v={gp.vehicle ?? "—"} />
              </div>

              {/* Material Details */}
              <div className="mt-3">
                <p className="text-xs font-semibold">
                  Material Movement: {gp.material_movement ? "Yes" : "No"}
                </p>
                {gp.material_movement && gp.material_list.length > 0 && (
                  <div className="mt-1 space-y-0.5 text-xs">
                    {gp.material_list.map((m: { name: string; qty: string }, i: number) => (
                      <div key={i} className="flex justify-between">
                        <span>{m.name}</span>
                        <span className="font-medium">{m.qty}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Remarks */}
              {gp.remarks && (
                <div className="mt-3 text-xs">
                  <span className="text-muted-foreground">Remarks: </span>
                  <span>{gp.remarks}</span>
                </div>
              )}

              {/* Photo Proof */}
              {(gp as any).photo_url && (
                <div className="mt-3">
                  <p className="text-xs font-semibold">Photo Proof</p>
                  <img
                    src={(gp as any).photo_url}
                    alt="Photo proof"
                    className="mt-1 h-24 w-24 rounded-lg border border-border object-cover"
                  />
                </div>
              )}

              {/* Linked Requisition (document chain) */}
              {(gp as any).requisition && (
                <div className="mt-3 border-t border-border pt-2 text-xs">
                  <p className="font-semibold">Linked Requisition</p>
                  <div className="mt-1 space-y-0.5">
                    <PrintRow k="PR Number" v={(gp as any).requisition.pr_number ?? "—"} />
                    <PrintRow k="PO Number" v={(gp as any).requisition.po_number ?? "—"} />
                    <PrintRow k="Title" v={(gp as any).requisition.title ?? "—"} />
                    <PrintRow k="Stage" v={(gp as any).requisition.stage ?? "—"} />
                    <PrintRow k="Vendor" v={(gp as any).requisition.vendor_name ?? "—"} />
                  </div>
                </div>
              )}

              {/* Linked Batch (traceability chain) */}
              {(gp as any).batch && (
                <div className="mt-3 border-t border-border pt-2 text-xs">
                  <p className="font-semibold">Traceability — Batch</p>
                  <div className="mt-1 space-y-0.5">
                    <PrintRow k="Batch Number" v={(gp as any).batch.batch_number ?? "—"} />
                    <PrintRow k="Material" v={(gp as any).batch.material ?? "—"} />
                    <PrintRow k="Supplier" v={(gp as any).batch.supplier ?? "—"} />
                    <PrintRow k="Manufacturer" v={(gp as any).batch.manufacturer ?? "—"} />
                    <PrintRow k="Invoice" v={(gp as any).batch.invoice ?? "—"} />
                    <PrintRow k="Challan" v={(gp as any).batch.challan ?? "—"} />
                    <PrintRow k="MTC" v={(gp as any).batch.mtc ?? "—"} />
                    <PrintRow k="Lab Report" v={(gp as any).batch.lab_report ?? "—"} />
                    <PrintRow k="Status" v={(gp as any).batch.status ?? "—"} />
                  </div>
                </div>
              )}

              {/* Signatures */}
              <div className="mt-4 flex justify-between text-[10px] text-muted-foreground">
                <div className="text-center">
                  <div className="border-t border-muted-foreground pt-1 w-24">Issued by</div>
                  <p className="mt-0.5 font-medium text-foreground">
                    {gp.requested_by_name ?? "—"}
                  </p>
                </div>
                <div className="text-center">
                  <div className="border-t border-muted-foreground pt-1 w-24">Approved by</div>
                  <p className="mt-0.5 font-medium text-foreground">{gp.approved_by_name ?? "—"}</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 no-print">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button className="flex-1" onClick={() => window.print()}>
                <Printer className="mr-2 size-4" /> Print Gate Pass
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Small label/value row used inside the printable gate pass layout.
function PrintRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}
