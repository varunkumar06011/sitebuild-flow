// Approval Delegation & SLA — delegate approval authority, view pending approvals with SLA timers,
// escalate overdue approvals, and view the escalation log.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  fetchDelegations,
  createDelegation,
  revokeDelegation,
  fetchPendingWithSLA,
  fetchEscalationLog,
  escalateRequisition,
} from "@/lib/api/system-robustness";
import { fetchUsers } from "@/lib/api/users";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  Plus,
  Loader2,
  ArrowUpCircle,
  Clock,
  AlertTriangle,
  UserCheck,
  History,
  Ban,
  IndianRupee,
} from "lucide-react";

export const Route = createFileRoute("/approvals-delegation")({
  head: () => ({
    meta: [
      { title: "Delegation & SLA — Meditrust ERP" },
      {
        name: "description",
        content: "Approval delegation, SLA tracking, escalation management and escalation log.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: DelegationSLAPage,
});

function formatINR(n: number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
}

const STAGE_TONE: Record<string, "warning" | "info" | "danger"> = {
  Admin: "warning",
  A1: "info",
  "A1+": "danger",
};

// Main page with 3 tabs: Delegations, SLA & Escalation, Escalation Log.
function DelegationSLAPage() {
  const { role } = useRole();
  const canDelegate = role !== "Supervisor";

  return (
    <AppShell
      title="Delegation & SLA"
      subtitle="Approval delegation, SLA tracking and escalation management"
    >
      <Tabs defaultValue="delegations" className="w-full">
        <TabsList className="mb-4 flex h-auto flex-wrap gap-1">
          <TabsTrigger value="delegations" className="gap-1.5">
            <UserCheck className="size-3.5" /> Delegations
          </TabsTrigger>
          <TabsTrigger value="sla" className="gap-1.5">
            <Clock className="size-3.5" /> SLA & Pending
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-1.5">
            <History className="size-3.5" /> Escalation Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="delegations">
          <DelegationsTab canDelegate={canDelegate} />
        </TabsContent>
        <TabsContent value="sla">
          <SLATab />
        </TabsContent>
        <TabsContent value="log">
          <EscalationLogTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

// ============================================================================
// Delegations Tab
// ============================================================================

function DelegationsTab({ canDelegate }: { canDelegate: boolean }) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["delegations"],
    queryFn: () => fetchDelegations({ data: {} }),
  });
  const delegations = (data?.data ?? []) as any[];

  const { data: userData } = useQuery({
    queryKey: ["users-list"],
    queryFn: () => fetchUsers({ data: {} }),
  });
  const users = ((userData?.data ?? []) as any[]).filter((u) => u.role !== "Supervisor");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    delegate_id: "",
    start_date: today,
    end_date: "",
    reason: "",
  });

  const handleCreate = async () => {
    if (!form.delegate_id) {
      toast.error("Select a delegate");
      return;
    }
    if (!form.end_date) {
      toast.error("End date is required");
      return;
    }
    setSaving(true);
    try {
      const result = await createDelegation({
        data: {
          delegate_id: form.delegate_id,
          start_date: form.start_date,
          end_date: form.end_date,
          reason: form.reason.trim() || undefined,
        },
      });
      if (result.success) {
        toast.success("Delegation created");
        setDialogOpen(false);
        setForm({ delegate_id: "", start_date: today, end_date: "", reason: "" });
        queryClient.invalidateQueries({ queryKey: ["delegations"] });
      } else {
        toast.error(result.error ?? "Failed to create delegation");
      }
    } catch {
      toast.error("Failed to create delegation");
    }
    setSaving(false);
  };

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      const result = await revokeDelegation({ data: { id } });
      if (result.success) {
        toast.success("Delegation revoked");
        queryClient.invalidateQueries({ queryKey: ["delegations"] });
      } else {
        toast.error(result.error ?? "Failed to revoke delegation");
      }
    } catch {
      toast.error("Failed to revoke delegation");
    }
    setRevoking(null);
  };

  const now = new Date();

  return (
    <div className="space-y-4">
      {canDelegate && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 size-4" /> Delegate authority
          </Button>
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Delegator</th>
                <th className="px-4 py-3 font-medium">Delegate</th>
                <th className="px-4 py-3 font-medium">Start</th>
                <th className="px-4 py-3 font-medium">End</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {delegations.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No delegations. {canDelegate && 'Click "Delegate authority" to create one.'}
                  </td>
                </tr>
              )}
              {delegations.map((d: any) => {
                const isActive =
                  d.active && new Date(d.start_date) <= now && new Date(d.end_date) >= now;
                const isExpired = new Date(d.end_date) < now;
                return (
                  <tr key={d.id} className="hover:bg-surface/50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{d.delegator?.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{d.delegator?.role}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{d.delegate?.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{d.delegate?.role}</p>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {new Date(d.start_date).toLocaleDateString("en-IN")}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {new Date(d.end_date).toLocaleDateString("en-IN")}
                    </td>
                    <td className="px-4 py-3">
                      {isActive ? (
                        <StatusPill tone="success">Active</StatusPill>
                      ) : isExpired ? (
                        <StatusPill tone="neutral">Expired</StatusPill>
                      ) : (
                        <StatusPill tone="warning">Revoked</StatusPill>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{d.reason ?? "—"}</td>
                    <td className="px-4 py-3">
                      {d.active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevoke(d.id)}
                          disabled={revoking === d.id}
                        >
                          {revoking === d.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Ban className="size-3.5 text-destructive" />
                          )}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create delegation dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delegate approval authority</DialogTitle>
            <DialogDescription>
              Temporarily transfer your approval authority to another user. They can approve
              requisitions on your behalf until the end date.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Delegate to *</Label>
              <Select
                value={form.delegate_id}
                onValueChange={(v) => setForm({ ...form, delegate_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="d-start">Start date *</Label>
                <Input
                  id="d-start"
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="d-end">End date *</Label>
                <Input
                  id="d-end"
                  type="date"
                  value={form.end_date}
                  onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="d-reason">Reason</Label>
              <Textarea
                id="d-reason"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="e.g. On leave for one week"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Plus className="mr-2 size-4" />
              )}
              Create delegation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// SLA & Pending Tab
// ============================================================================

function SLATab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["pending-sla"],
    queryFn: () => fetchPendingWithSLA({ data: {} }),
  });
  const pending = (data?.data ?? []) as any[];
  const slaHours = (data as any)?.sla_hours ?? 48;

  const [escalating, setEscalating] = useState<string | null>(null);

  const handleEscalate = async (id: string) => {
    setEscalating(id);
    try {
      const result = await escalateRequisition({ data: { requisition_id: id } });
      if (result.success) {
        toast.success(`Escalated to ${result.new_stage}`);
        queryClient.invalidateQueries({ queryKey: ["pending-sla"] });
        queryClient.invalidateQueries({ queryKey: ["escalation-log"] });
      } else {
        toast.error(result.error ?? "Failed to escalate");
      }
    } catch {
      toast.error("Failed to escalate");
    }
    setEscalating(null);
  };

  const overSLA = pending.filter((p) => p.is_over_sla);
  const nearSLA = pending.filter((p) => !p.is_over_sla && p.sla_remaining_hours <= 12);
  const onTrack = pending.filter((p) => p.sla_remaining_hours > 12);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="size-4" />
            <p className="text-xs font-medium">SLA limit</p>
          </div>
          <p className="mt-2 text-2xl font-bold">{slaHours}h</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <AlertTriangle className="size-4 text-destructive" />
            <p className="text-xs font-medium">Over SLA</p>
          </div>
          <p className="mt-2 text-2xl font-bold text-destructive">{overSLA.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="size-4 text-warning" />
            <p className="text-xs font-medium">Near SLA (≤12h)</p>
          </div>
          <p className="mt-2 text-2xl font-bold text-warning">{nearSLA.length}</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="size-4 text-success" />
            <p className="text-xs font-medium">On track</p>
          </div>
          <p className="mt-2 text-2xl font-bold text-success">{onTrack.length}</p>
        </Card>
      </div>

      {/* Pending approvals table */}
      <Card className="overflow-hidden p-0">
        <div className="border-b border-border p-4">
          <p className="font-semibold">Pending approvals with SLA</p>
          <p className="text-xs text-muted-foreground">Auto-escalate after {slaHours} hours</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">PR Number</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Vendor</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 text-right font-medium">Pending</th>
                <th className="px-4 py-3 font-medium">SLA Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pending.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    {isLoading ? "Loading..." : "No pending approvals."}
                  </td>
                </tr>
              )}
              {pending.map((p: any) => (
                <tr
                  key={p.id}
                  className={`hover:bg-surface/50 ${p.is_over_sla ? "bg-destructive/5" : ""}`}
                >
                  <td className="px-4 py-3 font-mono font-medium">{p.pr_number}</td>
                  <td className="px-4 py-3 text-muted-foreground">{p.title}</td>
                  <td className="px-4 py-3 text-xs">{p.vendor_name}</td>
                  <td className="px-4 py-3 text-right font-medium">₹{formatINR(p.amount)}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={STAGE_TONE[p.stage] ?? "info"}>{p.stage}</StatusPill>
                  </td>
                  <td className="px-4 py-3 text-right text-xs">{p.hours_pending}h</td>
                  <td className="px-4 py-3">
                    {p.is_escalated ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-info">
                        <ArrowUpCircle className="size-3" /> Escalated
                      </span>
                    ) : p.is_over_sla ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                        <AlertTriangle className="size-3" /> {Math.abs(p.sla_remaining_hours)}h over
                      </span>
                    ) : p.sla_remaining_hours <= 12 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-warning">
                        <Clock className="size-3" /> {p.sla_remaining_hours}h left
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" /> {p.sla_remaining_hours}h left
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {p.is_over_sla && !p.is_escalated && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleEscalate(p.id)}
                        disabled={escalating === p.id}
                      >
                        {escalating === p.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <ArrowUpCircle className="mr-1 size-3.5" />
                        )}
                        Escalate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// Escalation Log Tab
// ============================================================================

function EscalationLogTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["escalation-log"],
    queryFn: () => fetchEscalationLog({ data: {} }),
  });
  const logs = (data?.data ?? []) as any[];

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-4">
        <p className="font-semibold">Escalation log</p>
        <p className="text-xs text-muted-foreground">
          All approval escalations — resolved and unresolved
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">PR Number</th>
              <th className="px-4 py-3 font-medium">Title</th>
              <th className="px-4 py-3 text-right font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">From → To</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Escalated at</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {logs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  {isLoading ? "Loading..." : "No escalations recorded."}
                </td>
              </tr>
            )}
            {logs.map((e: any) => (
              <tr key={e.id} className="hover:bg-surface/50">
                <td className="px-4 py-3 font-mono font-medium">
                  {e.requisition?.pr_number ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{e.requisition?.title ?? "—"}</td>
                <td className="px-4 py-3 text-right">₹{formatINR(e.requisition?.amount ?? 0)}</td>
                <td className="px-4 py-3 text-xs">
                  <span className="font-medium">{e.from_stage}</span> →{" "}
                  <span className="font-medium text-info">{e.to_stage}</span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">{e.reason}</td>
                <td className="px-4 py-3 text-xs">
                  {e.escalated_at
                    ? new Date(e.escalated_at).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })
                    : "—"}
                </td>
                <td className="px-4 py-3">
                  {e.resolved_at ? (
                    <StatusPill tone="success">Resolved</StatusPill>
                  ) : (
                    <StatusPill tone="warning">Pending</StatusPill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
