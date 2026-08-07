import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { GATE_PASSES, type GatePass } from "@/lib/erp-data";
import { requireSection } from "@/lib/auth-guards";
import { toast } from "sonner";
import { QrCode, Truck } from "lucide-react";

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
  beforeLoad: () => requireSection("/gate-pass"),
  component: GatePassPage,
});

function GatePassPage() {
  const [passes, setPasses] = useState<GatePass[]>(GATE_PASSES);
  const [active, setActive] = useState<GatePass | null>(GATE_PASSES[0] ?? null);
  const [otp, setOtp] = useState("");

  const update = (id: string, patch: Partial<GatePass>) => {
    setPasses((p) => p.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    setActive((a) => (a && a.id === id ? { ...a, ...patch } : a));
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
            {passes.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  setActive(g);
                  setOtp("");
                }}
                className={`flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors ${
                  active?.id === g.id ? "border-primary bg-accent" : "border-border hover:bg-surface"
                }`}
              >
                <div className="min-w-0">
                  <p className="font-semibold">{g.material}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.id} · {g.qty} · {g.carrier} · {g.vehicle}
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
                <p className="mt-2 font-mono text-xs text-muted-foreground">{active.id}</p>
              </div>

              {active.status === "Awaiting OTP" && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Enter OTP sent to the approver (demo: {active.otp})
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
                    disabled={otp.length !== 6}
                    onClick={() => {
                      if (otp === active.otp) {
                        update(active.id, { status: "OTP Verified" });
                        toast.success("OTP verified — QR unlocked");
                      } else {
                        toast.error("Invalid OTP");
                      }
                      setOtp("");
                    }}
                  >
                    Verify OTP
                  </Button>
                </div>
              )}

              {active.status === "OTP Verified" && (
                <Button
                  className="w-full"
                  onClick={() => {
                    update(active.id, {
                      status: "Exited",
                      exitTime:
                        "06 Aug · " +
                        new Date().toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          hour12: false,
                        }),
                    });
                    toast.success("QR scanned — exit time stamped");
                  }}
                >
                  <Truck className="size-4" /> Scan QR & record exit
                </Button>
              )}

              {active.status === "Exited" && (
                <div className="rounded-lg bg-success-soft p-3 text-sm text-success">
                  Material exited at {active.exitTime}
                </div>
              )}

              <dl className="space-y-1.5 text-xs">
                <Row k="Requested" v={active.requestedAt} />
                <Row k="Carrier" v={active.carrier} />
                <Row k="Vehicle" v={active.vehicle} />
                <Row k="Type" v={active.type} />
                <Row k="Exit time" v={active.exitTime ?? "—"} />
              </dl>
            </div>
          ) : null}
        </Card>
      </div>
    </AppShell>
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
