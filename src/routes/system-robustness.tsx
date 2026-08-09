// System Robustness — approval delegation, SLA escalation, and document versioning.
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
  resolveEscalation,
  fetchDocumentVersions,
} from "@/lib/api/system-robustness-client";
import { fetchUsers } from "@/lib/api/users-client";
import { useRole } from "@/lib/role-context";
import { requireAuth } from "@/lib/auth-guards";
import { toast } from "sonner";
import {
  ShieldCheck,
  Clock,
  AlertTriangle,
  ArrowUp,
  FileText,
  Plus,
  XCircle,
  CheckCircle2,
  Loader2,
  History,
  TrendingUp,
} from "lucide-react";

export const Route = createFileRoute("/system-robustness")({
  head: () => ({
    meta: [
      { title: "System Robustness — Meditrust ERP" },
      {
        name: "description",
        content:
          "Approval delegation, SLA escalation tracking, and document version history.",
      },
    ],
  }),
  beforeLoad: async () => {
    await requireAuth();
  },
  component: SystemRobustnessPage,
});

function SystemRobustnessPage() {
  return (
    <AppShell
      title="System Robustness"
      subtitle="Approval delegation, SLA escalation, and document versioning"
    >
      <Tabs defaultValue="delegation">
        <TabsList>
          <TabsTrigger value="delegation" className="gap-1.5">
            <ShieldCheck className="size-3.5" /> Delegation
          </TabsTrigger>
          <TabsTrigger value="escalation" className="gap-1.5">
            <Clock className="size-3.5" /> SLA Escalation
          </TabsTrigger>
          <TabsTrigger value="versions" className="gap-1.5">
            <History className="size-3.5" /> Doc Versions
          </TabsTrigger>
        </TabsList>

        <TabsContent value="delegation">
          <DelegationTab />
        </TabsContent>
        <TabsContent value="escalation">
          <EscalationTab />
        </TabsContent>
        <TabsContent value="versions">
          <DocumentVersionsTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

// ============================================================================
// Delegation Tab
// ============================================================================
function DelegationTab() {
  const { role } = useRole();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [delegateId, setDelegateId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: delegData, isLoading } = useQuery({
    queryKey: ["delegations"],
    queryFn: () => fetchDelegations({}),
  });
  const delegations = delegData?.data ?? [];

  const { data: usersData } = useQuery({
    queryKey: ["users-for-delegation"],
    queryFn: () => fetchUsers({}),
    enabled: role !== "Supervisor",
  });
  const users = usersData?.data ?? [];

  const handleCreate = async () => {
    if (!delegateId || !startDate || !endDate) {
      toast.error("Please fill all required fields");
      return;
    }
    setCreating(true);
    try {
      const result = await createDelegation({
        delegate_id: delegateId,
        start_date: startDate,
        end_date: endDate,
        ...(reason.trim() && { reason: reason.trim() }),
      });
      if (result.success) {
        toast.success("Delegation created successfully");
        setShowCreate(false);
        setDelegateId("");
        setStartDate("");
        setEndDate("");
        setReason("");
        queryClient.invalidateQueries({ queryKey: ["delegations"] });
      } else {
        toast.error(result.error ?? "Failed to create delegation");
      }
    } catch {
      toast.error("Failed to create delegation");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    const result = await revokeDelegation({ id });
    if (result.success) {
      toast.success("Delegation revoked");
      queryClient.invalidateQueries({ queryKey: ["delegations"] });
    } else {
      toast.error(result.error ?? "Failed to revoke delegation");
    }
  };

  const canDelegate = role !== "Supervisor";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
      Delegate approval authority to another user for a date range.
        </p>
        {canDelegate && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="mr-1.5 size-4" /> New Delegation
          </Button>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Delegator</th>
                <th className="px-4 py-3 font-medium">Delegate</th>
                <th className="px-4 py-3 font-medium">Start Date</th>
                <th className="px-4 py-3 font-medium">End Date</th>
                <th className="px-4 py-3 font-medium">Reason</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {canDelegate && <th className="px-4 py-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={canDelegate ? 7 : 6} className="px-4 py-8 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              )}
              {!isLoading && delegations.length === 0 && (
                <tr>
                  <td colSpan={canDelegate ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                    No delegations found.
                  </td>
                </tr>
              )}
              {delegations.map((d: any) => (
                <tr key={d.id} className="hover:bg-surface/50">
                  <td className="px-4 py-3 font-medium">
                    {d.delegator?.name ?? "—"}
                    <span className="block text-xs text-muted-foreground">{d.delegator?.role}</span>
                  </td>
                  <td className="px-4 py-3 font-medium">
                    {d.delegate?.name ?? "—"}
                    <span className="block text-xs text-muted-foreground">{d.delegate?.role}</span>
                  </td>
                  <td className="px-4 py-3 text-xs">{d.start_date}</td>
                  <td className="px-4 py-3 text-xs">{d.end_date}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{d.reason ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusPill tone={d.active ? "success" : "neutral"}>
                      {d.active ? "Active" : "Revoked"}
                    </StatusPill>
                  </td>
                  {canDelegate && (
                    <td className="px-4 py-3">
                      {d.active && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => handleRevoke(d.id)}
                        >
                          <XCircle className="mr-1 size-3.5" /> Revoke
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Approval Delegation</DialogTitle>
            <DialogDescription>
              Delegate your approval authority to another user for a specified date range.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Delegate To</Label>
              <Select value={delegateId} onValueChange={setDelegateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a user" />
                </SelectTrigger>
                <SelectContent>
                  {users
                    .filter((u: any) => u.role !== "Supervisor")
                    .map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. On leave for one week"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="mr-2 size-4 animate-spin" />}
              Create Delegation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Escalation Tab
// ============================================================================
function EscalationTab() {
  const queryClient = useQueryClient();
  const [showUnresolvedOnly, setShowUnresolvedOnly] = useState(false);

  const { data: slaData, isLoading: slaLoading } = useQuery({
    queryKey: ["pending-sla"],
    queryFn: () => fetchPendingWithSLA(),
  });
  const pendingItems = slaData?.data ?? [];
  const slaHours = slaData?.sla_hours ?? 48;

  const { data: escData, isLoading: escLoading } = useQuery({
    queryKey: ["escalation-log", { unresolvedOnly: showUnresolvedOnly }],
    queryFn: () => fetchEscalationLog({ unresolved_only: showUnresolvedOnly }),
  });
  const escalations = escData?.data ?? [];

  const handleEscalate = async (reqId: string) => {
    const result = await escalateRequisition({ requisition_id: reqId });
    if (result.success) {
      toast.success(`Requisition escalated to ${result.new_stage}`);
      queryClient.invalidateQueries({ queryKey: ["pending-sla"] });
      queryClient.invalidateQueries({ queryKey: ["escalation-log"] });
    } else {
      toast.error(result.error ?? "Failed to escalate");
    }
  };

  const handleResolve = async (reqId: string) => {
    const result = await resolveEscalation({ requisition_id: reqId });
    if (result.success) {
      toast.success("Escalation resolved");
      queryClient.invalidateQueries({ queryKey: ["escalation-log"] });
    } else {
      toast.error(result.error ?? "Failed to resolve escalation");
    }
  };

  return (
    <div className="space-y-4">
      {/* Pending approvals with SLA */}
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-muted-foreground" />
          <p className="font-semibold">Pending Approvals — SLA Tracker</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Auto-escalation threshold: {slaHours} hours. Items over SLA can be manually escalated.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">PR Number</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Stage</th>
                <th className="px-3 py-2 font-medium">Vendor</th>
                <th className="px-3 py-2 font-medium">Hours Pending</th>
                <th className="px-3 py-2 font-medium">SLA Remaining</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {slaLoading && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              )}
              {!slaLoading && pendingItems.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    No pending approvals.
                  </td>
                </tr>
              )}
              {pendingItems.map((r: any) => (
                <tr key={r.id} className="hover:bg-surface/50">
                  <td className="px-3 py-2 font-medium">{r.pr_number ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.title ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StatusPill tone="info">{r.stage}</StatusPill>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.vendor_name}</td>
                  <td className="px-3 py-2 text-xs">{r.hours_pending}h</td>
                  <td className="px-3 py-2 text-xs">
                    {r.is_over_sla ? (
                      <span className="font-semibold text-destructive">
                        {Math.abs(r.sla_remaining_hours)}h over
                      </span>
                    ) : (
                      <span>{r.sla_remaining_hours}h left</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.is_escalated ? (
                      <StatusPill tone="warning">Escalated</StatusPill>
                    ) : r.is_over_sla ? (
                      <StatusPill tone="danger">Over SLA</StatusPill>
                    ) : (
                      <StatusPill tone="success">On Track</StatusPill>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.is_over_sla && !r.is_escalated && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-warning-foreground"
                        onClick={() => handleEscalate(r.id)}
                      >
                        <ArrowUp className="mr-1 size-3.5" /> Escalate
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Escalation log */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-muted-foreground" />
            <p className="font-semibold">Escalation Log</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowUnresolvedOnly(!showUnresolvedOnly)}
          >
            {showUnresolvedOnly ? "Show All" : "Show Unresolved Only"}
          </Button>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">PR Number</th>
                <th className="px-3 py-2 font-medium">From</th>
                <th className="px-3 py-2 font-medium">To</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 font-medium">Escalated At</th>
                <th className="px-3 py-2 font-medium">Resolved</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {escLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center">
                    <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                  </td>
                </tr>
              )}
              {!escLoading && escalations.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No escalations recorded.
                  </td>
                </tr>
              )}
              {escalations.map((e: any) => (
                <tr key={e.id} className="hover:bg-surface/50">
                  <td className="px-3 py-2 font-medium">
                    {e.requisition?.pr_number ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone="info">{e.from_stage}</StatusPill>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone="warning">{e.to_stage}</StatusPill>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{e.reason}</td>
                  <td className="px-3 py-2 text-xs">
                    {new Date(e.escalated_at).toLocaleString("en-IN", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="px-3 py-2">
                    {e.resolved_at ? (
                      <span className="flex items-center gap-1 text-xs text-success">
                        <CheckCircle2 className="size-3" />
                        {new Date(e.resolved_at).toLocaleDateString("en-IN")}
                      </span>
                    ) : (
                      <span className="text-xs text-warning-foreground">Unresolved</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {!e.resolved_at && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResolve(e.requisition_id)}
                      >
                        Resolve
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
// Document Versions Tab
// ============================================================================
function DocumentVersionsTab() {
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [searched, setSearched] = useState(false);

  const { data: versionData, isLoading } = useQuery({
    queryKey: ["doc-versions", entityType, entityId],
    queryFn: () =>
      fetchDocumentVersions({ entity_type: entityType, entity_id: entityId }),
    enabled: searched && entityType.length > 0 && entityId.length > 0,
  });
  const versions = versionData?.data ?? [];

  const handleSearch = () => {
    if (!entityType || !entityId) {
      toast.error("Enter both entity type and entity ID");
      return;
    }
    setSearched(true);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center gap-2">
          <History className="size-4 text-muted-foreground" />
          <p className="font-semibold">Document Version History</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Search for version history of documents linked to any entity (requisition, batch, vendor, etc.).
        </p>
        <div className="mt-3 flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Entity Type</Label>
            <Select value={entityType} onValueChange={setEntityType}>
              <SelectTrigger>
                <SelectValue placeholder="e.g. requisition" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="requisition">Requisition</SelectItem>
                <SelectItem value="batch">Batch</SelectItem>
                <SelectItem value="vendor">Vendor</SelectItem>
                <SelectItem value="gate_pass">Gate Pass</SelectItem>
                <SelectItem value="inspection">Inspection</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 space-y-1.5">
            <Label className="text-xs">Entity ID</Label>
            <Input
              placeholder="UUID"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
            />
          </div>
          <Button onClick={handleSearch} size="sm">
            <TrendingUp className="mr-1.5 size-4" /> Search
          </Button>
        </div>
      </Card>

      {searched && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Version</th>
                  <th className="px-4 py-3 font-medium">Field</th>
                  <th className="px-4 py-3 font-medium">File</th>
                  <th className="px-4 py-3 font-medium">Uploaded By</th>
                  <th className="px-4 py-3 font-medium">Uploaded At</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center">
                      <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
                    </td>
                  </tr>
                )}
                {!isLoading && versions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No document versions found for this entity.
                    </td>
                  </tr>
                )}
                {versions.map((v: any) => (
                  <tr key={v.id} className="hover:bg-surface/50">
                    <td className="px-4 py-3">
                      <span className="font-semibold">v{v.version}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">{v.field_name}</td>
                    <td className="px-4 py-3 text-xs">
                      <span className="flex items-center gap-1">
                        <FileText className="size-3 text-muted-foreground" />
                        {v.file_name ?? v.file_path}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">{v.uploader?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      {new Date(v.uploaded_at).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={v.superseded ? "neutral" : "success"}>
                        {v.superseded ? "Superseded" : "Current"}
                      </StatusPill>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{v.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
