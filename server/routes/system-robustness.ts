import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const systemRobustnessRouter = Router();

const SLA_HOURS = 48;

// GET /api/system-robustness/delegations
systemRobustnessRouter.get("/delegations", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const active = req.query["active"];

    let query = supabaseServer
      .from("approval_delegations")
      .select(
        `
        id, delegator_id, delegate_id, start_date, end_date, reason, active, created_at,
        delegator:users!approval_delegations_delegator_id_fkey(username, name, role),
        delegate:users!approval_delegations_delegate_id_fkey(username, name, role)
      `,
      )
      .or(`delegator_id.eq.${user.id},delegate_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    if (active === "true") query = query.eq("active", true);
    if (active === "false") query = query.eq("active", false);

    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: error.message });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchDelegations error:", err);
    res.status(500).json({ error: "Failed to fetch delegations" });
  }
});

// POST /api/system-robustness/delegations
const delegationSchema = z.object({
  delegate_id: z.string().uuid(),
  start_date: z.string(),
  end_date: z.string(),
  reason: z.string().optional(),
});

systemRobustnessRouter.post("/delegations", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role === "Supervisor") {
      res.json({ success: false, error: "Supervisors cannot delegate approval authority" });
      return;
    }
    const data = delegationSchema.parse(req.body);

    const { data: delegation, error } = await supabaseServer
      .from("approval_delegations")
      .insert({
        delegator_id: user.id,
        delegate_id: data.delegate_id,
        start_date: data.start_date,
        end_date: data.end_date,
        reason: data.reason ?? null,
        active: true,
      })
      .select("id")
      .single();

    if (error || !delegation) {
      res.json({ success: false, error: "Failed to create delegation" });
      return;
    }
    await logAction(user, "create_delegation", "approval_delegations", delegation.id, data);
    res.json({ success: true, id: delegation.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("createDelegation error:", err);
    res.status(500).json({ success: false, error: "Failed to create delegation" });
  }
});

// POST /api/system-robustness/delegations/revoke
systemRobustnessRouter.post("/delegations/revoke", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const { id } = req.body as { id: string };

    const { data: delegation } = await supabaseServer
      .from("approval_delegations")
      .select("delegator_id")
      .eq("id", id)
      .single();

    if (!delegation || delegation.delegator_id !== user.id) {
      res.json({ success: false, error: "You can only revoke your own delegations" });
      return;
    }

    const { error } = await supabaseServer
      .from("approval_delegations")
      .update({ active: false })
      .eq("id", id);

    if (error) {
      res.json({ success: false, error: "Failed to revoke delegation" });
      return;
    }
    await logAction(user, "revoke_delegation", "approval_delegations", id, {});
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("revokeDelegation error:", err);
    res.status(500).json({ success: false, error: "Failed to revoke delegation" });
  }
});

// GET /api/system-robustness/sla-pending
systemRobustnessRouter.get("/sla-pending", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);

    const { data: requisitions } = await supabaseServer
      .from("requisitions")
      .select(
        `id, pr_number, title, block, amount, stage, date, vendor:vendors(name)`,
      )
      .in("stage", ["Admin", "A1", "A1+"])
      .order("date", { ascending: true });

    const { data: escalations } = await supabaseServer
      .from("escalation_log")
      .select("requisition_id, escalated_at, sla_hours")
      .is("resolved_at", null);

    const escalationMap: Record<string, any> = {};
    (escalations ?? []).forEach((e: any) => {
      escalationMap[e.requisition_id] = e;
    });

    const now = Date.now();
    const enriched = (requisitions ?? []).map((r: any) => {
      const submittedAt = new Date(r.date).getTime();
      const hoursPending = Math.floor((now - submittedAt) / (1000 * 60 * 60));
      const slaRemaining = SLA_HOURS - hoursPending;
      const isOverSLA = hoursPending >= SLA_HOURS;
      const isEscalated = !!escalationMap[r.id];

      return {
        ...r,
        vendor_name: r.vendor?.name ?? "—",
        hours_pending: hoursPending,
        sla_remaining_hours: Math.max(slaRemaining, 0),
        is_over_sla: isOverSLA,
        is_escalated: isEscalated,
        escalation: escalationMap[r.id] ?? null,
      };
    });

    res.json({ data: enriched, sla_hours: SLA_HOURS });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchPendingWithSLA error:", err);
    res.status(500).json({ error: "Failed to fetch SLA pending" });
  }
});

// GET /api/system-robustness/escalation-log
systemRobustnessRouter.get("/escalation-log", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const unresolvedOnly = req.query["unresolved_only"] === "true";

    let query = supabaseServer
      .from("escalation_log")
      .select(
        `id, requisition_id, from_stage, to_stage, reason, sla_hours, escalated_at, resolved_at, resolved_by,
        requisition:requisitions(pr_number, title, amount)`,
      )
      .order("escalated_at", { ascending: false });

    if (unresolvedOnly) query = query.is("resolved_at", null);

    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: error.message });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchEscalationLog error:", err);
    res.status(500).json({ error: "Failed to fetch escalation log" });
  }
});

// POST /api/system-robustness/escalate
const escalateSchema = z.object({
  requisition_id: z.string().uuid(),
  reason: z.string().optional(),
});

systemRobustnessRouter.post("/escalate", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = escalateSchema.parse(req.body);

    const { data: reqRow } = await supabaseServer
      .from("requisitions")
      .select("id, pr_number, stage, amount, date")
      .eq("id", data.requisition_id)
      .single();

    if (!reqRow) {
      res.json({ success: false, error: "Requisition not found" });
      return;
    }

    const escalationMap: Record<string, string> = {
      Admin: "A1",
      A1: "A1+",
      "A1+": "A1+",
    };

    const targetStage = escalationMap[reqRow.stage];
    if (!targetStage || targetStage === reqRow.stage) {
      res.json({ success: false, error: "Cannot escalate — already at highest approval tier" });
      return;
    }

    const hoursPending = Math.floor(
      (Date.now() - new Date(reqRow.date).getTime()) / (1000 * 60 * 60),
    );

    const { error: logError } = await supabaseServer.from("escalation_log").insert({
      requisition_id: data.requisition_id,
      from_stage: reqRow.stage,
      to_stage: targetStage,
      reason: data.reason || `SLA exceeded (${hoursPending}h pending, limit ${SLA_HOURS}h)`,
      sla_hours: SLA_HOURS,
    });

    if (logError) {
      res.json({ success: false, error: "Failed to log escalation" });
      return;
    }

    const { error: updateError } = await supabaseServer
      .from("requisitions")
      .update({ stage: targetStage })
      .eq("id", data.requisition_id);

    if (updateError) {
      res.json({ success: false, error: "Failed to escalate requisition" });
      return;
    }

    await logAction(user, "escalate_requisition", "requisitions", data.requisition_id, {
      from_stage: reqRow.stage,
      to_stage: targetStage,
      reason: data.reason,
    });

    res.json({ success: true, new_stage: targetStage });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("escalateRequisition error:", err);
    res.status(500).json({ success: false, error: "Failed to escalate" });
  }
});

// POST /api/system-robustness/resolve-escalation
systemRobustnessRouter.post("/resolve-escalation", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const { requisition_id } = req.body as { requisition_id: string };

    const { error } = await supabaseServer
      .from("escalation_log")
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq("requisition_id", requisition_id)
      .is("resolved_at", null);

    if (error) {
      res.json({ success: false, error: "Failed to resolve escalation" });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("resolveEscalation error:", err);
    res.status(500).json({ success: false, error: "Failed to resolve escalation" });
  }
});

// GET /api/system-robustness/document-versions
systemRobustnessRouter.get("/document-versions", async (req: Request, res: Response) => {
  try {
    await requireSessionUser(req);
    const { entity_type, entity_id, field_name } = req.query as Record<string, string>;

    let query = supabaseServer
      .from("document_versions")
      .select(
        `id, entity_type, entity_id, field_name, version, file_path, file_name, uploaded_by, uploaded_at, superseded, notes,
        uploader:users!document_versions_uploaded_by_fkey(name)`,
      )
      .eq("entity_type", entity_type)
      .eq("entity_id", entity_id)
      .order("version", { ascending: false });

    if (field_name) query = query.eq("field_name", field_name);

    const { data, error } = await query;
    if (error) {
      res.json({ data: [], error: error.message });
      return;
    }
    res.json({ data: data ?? [] });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchDocumentVersions error:", err);
    res.status(500).json({ error: "Failed to fetch document versions" });
  }
});

// POST /api/system-robustness/document-versions
const documentVersionSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  field_name: z.string(),
  file_path: z.string(),
  file_name: z.string().optional(),
  notes: z.string().optional(),
});

systemRobustnessRouter.post("/document-versions", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = documentVersionSchema.parse(req.body);

    const { data: existing } = await supabaseServer
      .from("document_versions")
      .select("version")
      .eq("entity_type", data.entity_type)
      .eq("entity_id", data.entity_id)
      .eq("field_name", data.field_name)
      .order("version", { ascending: false })
      .limit(1);

    const nextVersion = (existing?.[0]?.version ?? 0) + 1;

    await supabaseServer
      .from("document_versions")
      .update({ superseded: true })
      .eq("entity_type", data.entity_type)
      .eq("entity_id", data.entity_id)
      .eq("field_name", data.field_name)
      .eq("superseded", false);

    const { data: newVersion, error } = await supabaseServer
      .from("document_versions")
      .insert({
        entity_type: data.entity_type,
        entity_id: data.entity_id,
        field_name: data.field_name,
        version: nextVersion,
        file_path: data.file_path,
        file_name: data.file_name || null,
        uploaded_by: user.id,
        notes: data.notes || null,
        superseded: false,
      })
      .select("id, version")
      .single();

    if (error || !newVersion) {
      res.json({ success: false, error: "Failed to record document version" });
      return;
    }

    await logAction(user, "upload_document_version", data.entity_type, data.entity_id, {
      field_name: data.field_name,
      version: nextVersion,
      file_name: data.file_name,
    });

    res.json({ success: true, id: newVersion.id, version: nextVersion });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("recordDocumentVersion error:", err);
    res.status(500).json({ success: false, error: "Failed to record document version" });
  }
});

// GET /api/system-robustness/backup-overview
systemRobustnessRouter.get("/backup-overview", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+" && user.role !== "Administrator") {
      res.json({ data: [], error: "Insufficient permissions" });
      return;
    }

    const tables = [
      "users", "vendors", "requisitions", "gate_passes", "batches", "inspections",
      "visitors", "vehicles", "labour", "progress", "notifications", "audit_log",
      "inventory_items", "inventory_transactions", "material_categories",
      "vendor_payments", "budgets", "tds_gst_records", "retention_records",
      "approval_delegations",
      "escalation_log", "document_versions",
    ];

    const results: Array<{ table: string; count: number }> = [];
    for (const table of tables) {
      const { count } = await supabaseServer
        .from(table)
        .select("*", { count: "exact", head: true });
      results.push({ table, count: count ?? 0 });
    }

    res.json({ data: results });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchBackupOverview error:", err);
    res.status(500).json({ error: "Failed to fetch backup overview" });
  }
});

// GET /api/system-robustness/export-table
systemRobustnessRouter.get("/export-table", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "A1+" && user.role !== "Administrator") {
      res.json({ data: [], error: "Insufficient permissions" });
      return;
    }

    const { table, dateFrom, dateTo } = req.query as Record<string, string>;

    const allowedTables: Record<string, string | null> = {
      vendors: null, requisitions: "date", gate_passes: "created_at",
      batches: "created_at", inspections: "inspection_date", visitors: "check_in_time",
      vehicles: "entry_time", labour: "date", progress: null,
      inventory_items: null, inventory_transactions: "created_at",
      material_categories: null, vendor_payments: "payment_date", budgets: null,
      tds_gst_records: "created_at", retention_records: "created_at",
      approval_delegations: "start_date", escalation_log: "created_at",
      document_versions: "created_at",
    };

    if (!(table in allowedTables)) {
      res.json({ data: [], error: "Table not exportable" });
      return;
    }

    let select = "*";
    if (table === "users") {
      select = "id, username, role, name, phone, created_at";
    }

    let query = supabaseServer.from(table).select(select);

    const dateColumn = allowedTables[table];
    if (dateColumn && dateFrom) {
      query = query.gte(dateColumn, dateFrom);
    }
    if (dateColumn && dateTo) {
      query = query.lte(dateColumn, `${dateTo}T23:59:59`);
    }

    const { data: rows, error } = await query;
    if (error) {
      res.json({ data: [], error: error.message });
      return;
    }
    res.json({ data: rows ?? [] });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("exportTableData error:", err);
    res.status(500).json({ error: "Failed to export table" });
  }
});
