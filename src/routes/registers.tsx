// Site registers page with tabbed visitor and vehicle logs for daily gate-level tracking.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, StatusPill } from "@/components/AppShell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  fetchVisitors,
  fetchVehicles,
  createVisitor,
  createVehicle,
  checkOutVisitor,
  checkOutVehicle,
} from "@/lib/api/registers";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import { Plus, LogOut, Loader2, UserPlus, CarFront } from "lucide-react";

export const Route = createFileRoute("/registers")({
  head: () => ({
    meta: [
      { title: "Visitor & Vehicle Registers — Meditrust ERP" },
      {
        name: "description",
        content:
          "Daily site registers: visitor in/out log and vehicle movement with material carried.",
      },
      { property: "og:title", content: "Visitor & Vehicle Registers" },
      {
        property: "og:description",
        content:
          "Gate-level visitor and vehicle logs for the day.",
      },
    ],
  }),
  beforeLoad: () => {
    requireAuth();
  },
  component: Registers,
});

// Formats a timestamp for display in the registers tables.
function fmtTime(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

// Main registers component with tabs for visitor, vehicle and labour attendance data.
function Registers() {
  const queryClient = useQueryClient();
  const { data: visData } = useQuery({
    queryKey: ["visitors"],
    queryFn: () => fetchVisitors({}),
  });
  const { data: vehData } = useQuery({
    queryKey: ["vehicles"],
    queryFn: () => fetchVehicles({}),
  });
  const visitors = visData?.data ?? [];
  const vehicles = vehData?.data ?? [];

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <AppShell title="Registers" subtitle={`${today} · Main gate`}>
      <Tabs defaultValue="visitors">
        <TabsList>
          <TabsTrigger value="visitors">Visitors</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
        </TabsList>

        <TabsContent value="visitors">
          <VisitorTab
            visitors={visitors}
            onCheckout={async (id) => {
              const result = await checkOutVisitor({ id });
              if (result.success) {
                toast.success("Visitor checked out");
                queryClient.invalidateQueries({ queryKey: ["visitors"] });
              } else {
                toast.error(result.error ?? "Failed to check out visitor");
              }
            }}
            onCreated={() => {
              queryClient.invalidateQueries({ queryKey: ["visitors"] });
            }}
          />
        </TabsContent>

        <TabsContent value="vehicles">
          <VehicleTab
            vehicles={vehicles}
            onCheckout={async (id) => {
              const result = await checkOutVehicle({ id });
              if (result.success) {
                toast.success("Vehicle checked out");
                queryClient.invalidateQueries({ queryKey: ["vehicles"] });
              } else {
                toast.error(result.error ?? "Failed to check out vehicle");
              }
            }}
            onCreated={() => {
              queryClient.invalidateQueries({ queryKey: ["vehicles"] });
            }}
          />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

// --- Visitor tab with check-in dialog and checkout action ---

function VisitorTab({
  visitors,
  onCheckout,
  onCreated,
}: {
  visitors: any[];
  onCheckout: (id: string) => Promise<void>;
  onCreated: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", org: "", purpose: "", host: "" });

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Visitor name is required");
      return;
    }
    setSaving(true);
    try {
      const result = await createVisitor({
        name: form.name.trim(),
        org: form.org.trim() || undefined,
        purpose: form.purpose.trim() || undefined,
        host: form.host.trim() || undefined,
      });
      if (result.success) {
        toast.success("Visitor checked in");
        setDialogOpen(false);
        setForm({ name: "", org: "", purpose: "", host: "" });
        onCreated();
      } else {
        toast.error(result.error ?? "Failed to check in visitor");
      }
    } catch {
      toast.error("Failed to check in visitor");
    }
    setSaving(false);
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {visitors.length} visitor{visitors.length !== 1 ? "s" : ""} today
        </p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <UserPlus className="mr-1.5 size-4" /> Check in visitor
        </Button>
      </div>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-sm">
          <Head cols={["Pass", "Visitor", "Organisation", "Purpose", "In", "Out", "Host", ""]} />
          <tbody className="divide-y divide-border">
            {visitors.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-muted-foreground">
                  No visitors logged.
                </td>
              </tr>
            )}
            {visitors.map((v: any) => (
              <tr key={v.id}>
                <td className="py-3 font-mono text-xs text-muted-foreground">{v.id.slice(0, 8)}</td>
                <td className="py-3 font-medium">{v.name}</td>
                <td className="py-3 text-muted-foreground">{v.org ?? "—"}</td>
                <td className="py-3 text-muted-foreground">{v.purpose ?? "—"}</td>
                <td className="py-3 font-mono text-xs">{fmtTime(v.in_time)}</td>
                <td className="py-3">
                  {v.out_time ? (
                    <span className="font-mono text-xs">{fmtTime(v.out_time)}</span>
                  ) : (
                    <StatusPill tone="info">On site</StatusPill>
                  )}
                </td>
                <td className="py-3 text-muted-foreground">{v.host ?? "—"}</td>
                <td className="py-3 text-right">
                  {!v.out_time && (
                    <Button variant="ghost" size="sm" onClick={() => onCheckout(v.id)}>
                      <LogOut className="mr-1 size-3.5" /> Exit
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {visitors.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No visitors logged.</p>
        )}
        {visitors.map((v: any) => (
          <div key={v.id} className="rounded-xl border border-border p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-medium">{v.name}</span>
              {v.out_time ? (
                <span className="font-mono text-xs text-muted-foreground">
                  Out: {fmtTime(v.out_time)}
                </span>
              ) : (
                <StatusPill tone="info">On site</StatusPill>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {v.org ?? "—"} · {v.purpose ?? "—"}
            </p>
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
              <span>In: {fmtTime(v.in_time)}</span>
              <span>Host: {v.host ?? "—"}</span>
            </div>
            {!v.out_time && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => onCheckout(v.id)}
              >
                <LogOut className="mr-1.5 size-3.5" /> Check out
              </Button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check in visitor</DialogTitle>
            <DialogDescription>Record a new visitor entry at the main gate.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="vname">Visitor name *</Label>
              <Input
                id="vname"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Full name"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vorg">Organisation</Label>
                <Input
                  id="vorg"
                  value={form.org}
                  onChange={(e) => setForm({ ...form, org: e.target.value })}
                  placeholder="Company / agency"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vhost">Host</Label>
                <Input
                  id="vhost"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="Whom visiting"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vpurpose">Purpose</Label>
              <Input
                id="vpurpose"
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="Reason for visit"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              Check in
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// --- Vehicle tab with entry dialog and checkout action ---

function VehicleTab({
  vehicles,
  onCheckout,
  onCreated,
}: {
  vehicles: any[];
  onCheckout: (id: string) => Promise<void>;
  onCreated: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ number: "", type: "", driver: "", material: "" });

  const handleSave = async () => {
    if (!form.number.trim()) {
      toast.error("Vehicle number is required");
      return;
    }
    setSaving(true);
    try {
      const result = await createVehicle({
        number: form.number.trim(),
        type: form.type.trim() || undefined,
        driver: form.driver.trim() || undefined,
        material: form.material.trim() || undefined,
      });
      if (result.success) {
        toast.success("Vehicle entry logged");
        setDialogOpen(false);
        setForm({ number: "", type: "", driver: "", material: "" });
        onCreated();
      } else {
        toast.error(result.error ?? "Failed to log vehicle entry");
      }
    } catch {
      toast.error("Failed to log vehicle entry");
    }
    setSaving(false);
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {vehicles.length} vehicle{vehicles.length !== 1 ? "s" : ""} logged
        </p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <CarFront className="mr-1.5 size-4" /> Log vehicle entry
        </Button>
      </div>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-sm">
          <Head cols={["Entry", "Vehicle", "Type", "Driver", "Material", "In", "Out", ""]} />
          <tbody className="divide-y divide-border">
            {vehicles.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-muted-foreground">
                  No vehicles logged.
                </td>
              </tr>
            )}
            {vehicles.map((v: any) => (
              <tr key={v.id}>
                <td className="py-3 font-mono text-xs text-muted-foreground">{v.id.slice(0, 8)}</td>
                <td className="py-3 font-mono font-medium">{v.number}</td>
                <td className="py-3 text-muted-foreground">{v.type ?? "—"}</td>
                <td className="py-3 text-muted-foreground">{v.driver ?? "—"}</td>
                <td className="py-3">{v.material ?? "—"}</td>
                <td className="py-3 font-mono text-xs">{fmtTime(v.in_time)}</td>
                <td className="py-3">
                  {v.out_time ? (
                    <span className="font-mono text-xs">{fmtTime(v.out_time)}</span>
                  ) : (
                    <StatusPill tone="warning">Inside</StatusPill>
                  )}
                </td>
                <td className="py-3 text-right">
                  {!v.out_time && (
                    <Button variant="ghost" size="sm" onClick={() => onCheckout(v.id)}>
                      <LogOut className="mr-1 size-3.5" /> Exit
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {vehicles.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No vehicles logged.</p>
        )}
        {vehicles.map((v: any) => (
          <div key={v.id} className="rounded-xl border border-border p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-mono font-medium">{v.number}</span>
              {v.out_time ? (
                <span className="font-mono text-xs text-muted-foreground">
                  Out: {fmtTime(v.out_time)}
                </span>
              ) : (
                <StatusPill tone="warning">Inside</StatusPill>
              )}
            </div>
            <p className="text-sm">
              {v.type ?? "—"} · {v.driver ?? "—"}
            </p>
            {v.material && <p className="text-xs text-muted-foreground">Material: {v.material}</p>}
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs text-muted-foreground">
              <span>In: {fmtTime(v.in_time)}</span>
            </div>
            {!v.out_time && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={() => onCheckout(v.id)}
              >
                <LogOut className="mr-1.5 size-3.5" /> Check out
              </Button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log vehicle entry</DialogTitle>
            <DialogDescription>Record a vehicle entering the site.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="vnum">Vehicle number *</Label>
              <Input
                id="vnum"
                value={form.number}
                onChange={(e) => setForm({ ...form, number: e.target.value })}
                placeholder="e.g. TN-09-CQ-4412"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vtype">Type</Label>
                <Input
                  id="vtype"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  placeholder="Truck / Car / Bike"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vdriver">Driver</Label>
                <Input
                  id="vdriver"
                  value={form.driver}
                  onChange={(e) => setForm({ ...form, driver: e.target.value })}
                  placeholder="Driver name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vmat">Material carried</Label>
              <Input
                id="vmat"
                value={form.material}
                onChange={(e) => setForm({ ...form, material: e.target.value })}
                placeholder="What's being transported"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              Log entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Reusable table header component rendering column titles for register tables.
function Head({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
        {cols.map((c) => (
          <th key={c} className="pb-2 font-semibold">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}
