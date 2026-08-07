import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { fetchGatePasses, sendOtp, verifyOtp, recordExit, fetchGatePassTimeline, getGatePassSignedUrl } from "@/lib/api/gate-passes";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { QrCode, Truck, FileText, Share2, Clock, Send } from "lucide-react";

export const Route = createFileRoute("/gate-pass")({
  head: () => ({
    meta: [
      { title: "Gate Pass — OTP & QR Material Exit | Meditrust ERP" },
      {
        name: "description",
        content:
          "Issue gate passes, verify a 6-digit OTP, scan the QR at the gate and stamp material exit time.",
      },
      { property: "og:title", content: "Gate Pass — OTP & QR Material Exit" },
      {
        property: "og:description",
        content: "OTP verification and QR validation before any material leaves the hospital site.",
      },
    ],
  }),
  beforeLoad: async () => { await requireAuth(); },
  component: GatePassPage,
});

function GatePassPage() {
  const queryClient = useQueryClient();
  const { data: gpData } = useQuery({ queryKey: ["gatePasses"], queryFn: () => fetchGatePasses({ data: {} }) });
  const passes = gpData?.data ?? [];
  const [activeId, setActiveId] = useState<string | null>(passes[0]?.id ?? null);
  const [otp, setOtp] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const active = passes.find((p: any) => p.id === activeId) ?? null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["gatePasses"] });

  const handleSendOtp = async () => {
    if (!active) return;
    setSendingOtp(true);
    try {
      const result = await sendOtp({ data: { gatePassId: active.id } });
      if (result.success) {
        toast.success(result.message);
        if (result.otp) {
          toast.info(`OTP: ${result.otp}`, { duration: 10000 });
        }
        refresh();
      } else {
        toast.error(result.error ?? "Failed to send OTP");
      }
    } catch {
      toast.error("Failed to send OTP");
    }
    setSendingOtp(false);
  };

  const handleVerifyOtp = async () => {
    if (!active || otp.length !== 6) return;
    setVerifying(true);
    try {
      const result = await verifyOtp({ data: { gatePassId: active.id, otp } });
      if (result.success) {
        toast.success("OTP verified — QR unlocked");
        setOtp("");
        refresh();
      } else {
        toast.error(result.error ?? "Invalid OTP");
      }
    } catch {
      toast.error("Failed to verify OTP");
    }
    setVerifying(false);
    setOtp("");
  };

  const handleRecordExit = async () => {
    if (!active) return;
    setExiting(true);
    try {
      const result = await recordExit({ data: { gatePassId: active.id } });
      if (result.success) {
        toast.success("QR scanned — exit time stamped");
        refresh();
      } else {
        toast.error(result.error ?? "Failed to record exit");
      }
    } catch {
      toast.error("Failed to record exit");
    }
    setExiting(false);
  };

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

  const handleWhatsAppShare = () => {
    if (!active) return;
    const text = `Gate Pass ${active.gp_number}: ${active.material} (${active.qty}) — Status: ${active.status}`;
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  return (
    <AppShell
      title="Gate pass"
      subtitle="Gate Pass → OTP → QR scan → Material exit → Exit time"
    >
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-sm font-bold">Today's passes</h2>
          <div className="mt-4 space-y-3">
            {passes.length === 0 && (
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
                      g.status === "Exited" ? "success" : g.status === "OTP Verified" ? "info" : "warning"
                    }
                  >
                    {g.status}
                  </StatusPill>
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="text-sm font-bold">Gate terminal</h2>
          {active ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl bg-surface p-4 text-center">
                <QrCode className="mx-auto size-24 text-foreground" />
                <p className="mt-2 font-mono text-xs text-muted-foreground">{active.gp_number}</p>
              </div>

              {active.status === "Awaiting OTP" && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Enter OTP sent to the approver ({active.approver_phone ?? "—"})
                  </p>
                  <div className="mt-2">
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
                  <Button
                    variant="outline"
                    className="mt-2 w-full"
                    disabled={sendingOtp}
                    onClick={handleSendOtp}
                  >
                    <Send className="mr-2 size-4" />
                    {sendingOtp ? "Sending..." : "Resend OTP"}
                  </Button>
                </div>
              )}

              {active.status === "OTP Verified" && (
                <>
                  <Button
                    className="w-full"
                    disabled={exiting}
                    onClick={handleRecordExit}
                  >
                    <Truck className="size-4" /> {exiting ? "Recording..." : "Scan QR & record exit"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={handleWhatsAppShare}
                  >
                    <Share2 className="size-4" /> Share via WhatsApp
                  </Button>
                </>
              )}

              {active.status === "Exited" && (
                <div className="rounded-lg bg-success-soft p-3 text-sm text-success">
                  Material exited at {active.exit_time ? new Date(active.exit_time).toLocaleString("en-IN") : "—"}
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
                <Row k="Requested" v={active.requested_at ? new Date(active.requested_at).toLocaleString("en-IN") : "—"} />
                <Row k="Carrier" v={active.carrier ?? "—"} />
                <Row k="Vehicle" v={active.vehicle ?? "—"} />
                <Row k="Type" v={active.type} />
                <Row k="Exit time" v={active.exit_time ? new Date(active.exit_time).toLocaleString("en-IN") : "—"} />
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
            <DialogDescription>
              {active?.gp_number} — audit trail of all actions
            </DialogDescription>
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
            <iframe src={pdfUrl} className="h-[70vh] w-full rounded-lg border border-border" title="Gate Pass PDF" />
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function TimelineContent({ gatePassId }: { gatePassId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["gatePassTimeline", gatePassId],
    queryFn: () => fetchGatePassTimeline({ data: { gatePassId } }),
    enabled: !!gatePassId,
  });

  if (isLoading) return <p className="py-4 text-center text-sm text-muted-foreground">Loading...</p>;
  if (!data || data.length === 0) return <p className="py-4 text-center text-sm text-muted-foreground">No actions recorded.</p>;

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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right font-medium">{v}</dd>
    </div>
  );
}
