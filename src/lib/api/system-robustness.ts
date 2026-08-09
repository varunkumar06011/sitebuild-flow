import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser, type SessionUser } from "./session";
import { logAction } from "./audit";
import { canApprove, type Role } from "../erp-data";

// ============================================================================
// Approval Delegation API
// ============================================================================

// Fetches all delegations for the current user (as delegator or delegate).
export const fetchDelegations = createServerFn({ method: "GET" })
  .validator((input: { active?: boolean }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    let query = supabaseServer
      .from("approval_delegations")
      .select(
        `
        id,
        delegator_id,
        delegate_id,
        start_date,
        end_date,
        reason,
        active,
        created_at,
        delegator:users!approval_delegations_delegator_id_fkey(username, name, role),
        delegate:users!approval_delegations_delegate_id_fkey(username, name, role)
      `,
      )
      .or(`delegator_id.eq.${user.id},delegate_id.eq.${user.id}`)
      .order("created_at", { ascending: false });

    if (data.active !== undefined) {
      query = query.eq("active", data.active);
    }

    const { data: delegations, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: delegations ?? [] };
  });

const createDelegationSchema = z.object({
  delegate_id: z.string().uuid(),
  start_date: z.string(),
  end_date: z.string(),
  reason: z.string().optional(),
});

// Creates a new approval delegation.
export const createDelegation = createServerFn({ method: "POST" })
  .validator(createDelegationSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    // Only approvers (Admin, A1, A1+) can delegate
    if (user.role === "Supervisor") {
      return { success: false, error: "Only approvers can delegate approval authority" };
    }

    if (user.id === data.delegate_id) {
      return { success: false, error: "Cannot delegate to yourself" };
    }

    const { data: delegation, error } = await supabaseServer
      .from("approval_delegations")
      .insert({
        delegator_id: user.id,
        delegate_id: data.delegate_id,
        start_date: data.start_date,
        end_date: data.end_date,
        reason: data.reason || null,
        active: true,
      })
      .select("id")
      .single();

    if (error || !delegation) {
      return { success: false, error: "Failed to create delegation" };
    }

    await logAction(user, "create_delegation", "approval_delegations", delegation.id, {
      delegate_id: data.delegate_id,
      start_date: data.start_date,
      end_date: data.end_date,
    });
    return { success: true, id: delegation.id };
  });

// Revokes (deactivates) a delegation.
export const revokeDelegation = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    // Verify the user is the delegator
    const { data: delegation } = await supabaseServer
      .from("approval_delegations")
      .select("delegator_id")
      .eq("id", data.id)
      .single();

    if (!delegation || delegation.delegator_id !== user.id) {
      return { success: false, error: "You can only revoke your own delegations" };
    }

    const { error } = await supabaseServer
      .from("approval_delegations")
      .update({ active: false })
      .eq("id", data.id);

    if (error) return { success: false, error: "Failed to revoke delegation" };

    await logAction(user, "revoke_delegation", "approval_delegations", data.id, {});
    return { success: true };
  });

// Checks if a user has active delegation authority from another user.
// Returns the delegator's role if delegation is active, null otherwise.
export async function getActiveDelegation(
  delegateId: string,
  supabase: typeof supabaseServer,
): Promise<SessionUser | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: delegation } = await supabase
    .from("approval_delegations")
    .select(
      `
      delegator:users!approval_delegations_delegator_id_fkey(id, username, name, role)
    `,
    )
    .eq("delegate_id", delegateId)
    .eq("active", true)
    .lte("start_date", today)
    .gte("end_date", today)
    .single();

  if (!delegation?.delegator) return null;
  const delegator = Array.isArray(delegation.delegator)
    ? delegation.delegator[0]
    : delegation.delegator;
  return (delegator as unknown as SessionUser) ?? null;
}

// ============================================================================
// Approval Escalation & SLA API
// ============================================================================

const SLA_HOURS = 48; // Auto-escalate after 48 hours

// Fetches pending requisitions with SLA timer info.
export const fetchPendingWithSLA = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    const user = await requireSessionUser();

    // Get requisitions in approval stages
    const { data: requisitions } = await supabaseServer
      .from("requisitions")
      .select(
        `
        id,
        pr_number,
        title,
        block,
        amount,
        stage,
        date,
        vendor:vendors(name)
      `,
      )
      .in("stage", ["Admin", "A1", "A1+"])
      .order("date", { ascending: true });

    // Get existing unresolved escalations
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

    return { data: enriched, sla_hours: SLA_HOURS };
  });

// Fetches the escalation log (all entries or unresolved only).
export const fetchEscalationLog = createServerFn({ method: "GET" })
  .validator((input: { unresolved_only?: boolean }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();

    let query = supabaseServer
      .from("escalation_log")
      .select(
        `
        id,
        requisition_id,
        from_stage,
        to_stage,
        reason,
        sla_hours,
        escalated_at,
        resolved_at,
        resolved_by,
        requisition:requisitions(pr_number, title, amount)
      `,
      )
      .order("escalated_at", { ascending: false });

    if (data.unresolved_only) {
      query = query.is("resolved_at", null);
    }

    const { data: logs, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: logs ?? [] };
  });

// Manually escalates a requisition to the next approval tier.
export const escalateRequisition = createServerFn({ method: "POST" })
  .validator(z.object({ requisition_id: z.string().uuid(), reason: z.string().optional() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    // Get the requisition
    const { data: req } = await supabaseServer
      .from("requisitions")
      .select("id, pr_number, stage, amount, date")
      .eq("id", data.requisition_id)
      .single();

    if (!req) return { success: false, error: "Requisition not found" };

    // Determine escalation target
    const escalationMap: Record<string, string> = {
      Admin: "A1",
      A1: "A1+",
      "A1+": "A1+", // A1+ is the highest — can't escalate further
    };

    const targetStage = escalationMap[req.stage];
    if (!targetStage || targetStage === req.stage) {
      return { success: false, error: "Cannot escalate — already at highest approval tier" };
    }

    const hoursPending = Math.floor((Date.now() - new Date(req.date).getTime()) / (1000 * 60 * 60));

    // Log the escalation
    const { error: logError } = await supabaseServer.from("escalation_log").insert({
      requisition_id: data.requisition_id,
      from_stage: req.stage,
      to_stage: targetStage,
      reason: data.reason || `SLA exceeded (${hoursPending}h pending, limit ${SLA_HOURS}h)`,
      sla_hours: SLA_HOURS,
    });

    if (logError) return { success: false, error: "Failed to log escalation" };

    // Update the requisition stage
    const { error: updateError } = await supabaseServer
      .from("requisitions")
      .update({ stage: targetStage })
      .eq("id", data.requisition_id);

    if (updateError) return { success: false, error: "Failed to escalate requisition" };

    await logAction(user, "escalate_requisition", "requisitions", data.requisition_id, {
      from_stage: req.stage,
      to_stage: targetStage,
      reason: data.reason,
    });

    return { success: true, new_stage: targetStage };
  });

// Resolves an escalation (marks it as resolved when the approval is processed).
export const resolveEscalation = createServerFn({ method: "POST" })
  .validator(z.object({ requisition_id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const { error } = await supabaseServer
      .from("escalation_log")
      .update({ resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq("requisition_id", data.requisition_id)
      .is("resolved_at", null);

    if (error) return { success: false, error: "Failed to resolve escalation" };
    return { success: true };
  });

// ============================================================================
// Document Versioning API
// ============================================================================

// Fetches version history for a specific entity + field.
export const fetchDocumentVersions = createServerFn({ method: "GET" })
  .validator((input: { entity_type: string; entity_id: string; field_name?: string }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();

    let query = supabaseServer
      .from("document_versions")
      .select(
        `
        id,
        entity_type,
        entity_id,
        field_name,
        version,
        file_path,
        file_name,
        uploaded_by,
        uploaded_at,
        superseded,
        notes,
        uploader:users!document_versions_uploaded_by_fkey(name)
      `,
      )
      .eq("entity_type", data.entity_type)
      .eq("entity_id", data.entity_id)
      .order("version", { ascending: false });

    if (data.field_name) {
      query = query.eq("field_name", data.field_name);
    }

    const { data: versions, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: versions ?? [] };
  });

// Records a new document version and marks previous versions as superseded.
export const recordDocumentVersion = createServerFn({ method: "POST" })
  .validator(
    z.object({
      entity_type: z.string(),
      entity_id: z.string().uuid(),
      field_name: z.string(),
      file_path: z.string(),
      file_name: z.string().optional(),
      notes: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    // Get the current max version
    const { data: existing } = await supabaseServer
      .from("document_versions")
      .select("version")
      .eq("entity_type", data.entity_type)
      .eq("entity_id", data.entity_id)
      .eq("field_name", data.field_name)
      .order("version", { ascending: false })
      .limit(1);

    const nextVersion = (existing?.[0]?.version ?? 0) + 1;

    // Mark all previous versions as superseded
    await supabaseServer
      .from("document_versions")
      .update({ superseded: true })
      .eq("entity_type", data.entity_type)
      .eq("entity_id", data.entity_id)
      .eq("field_name", data.field_name)
      .eq("superseded", false);

    // Insert the new version
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
      return { success: false, error: "Failed to record document version" };
    }

    await logAction(user, "upload_document_version", data.entity_type, data.entity_id, {
      field_name: data.field_name,
      version: nextVersion,
      file_name: data.file_name,
    });

    return { success: true, id: newVersion.id, version: nextVersion };
  });

// ============================================================================
// Data Backup & Export API
// ============================================================================

// Fetches row counts for all major tables (for backup overview).
export const fetchBackupOverview = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    const user = await requireSessionUser();
    if (user.role !== "A1+" && user.role !== "Administrator") {
      return { data: [], error: "Insufficient permissions" };
    }

    const tables = [
      "users",
      "vendors",
      "requisitions",
      "gate_passes",
      "batches",
      "inspections",
      "visitors",
      "vehicles",
      "labour",
      "progress",
      "notifications",
      "audit_log",
      "inventory_items",
      "inventory_transactions",
      "material_categories",
      "vendor_payments",
      "budgets",
      "tds_gst_records",
      "retention_records",
      "medical_equipment",
      "aerb_compliance",
      "cleanroom_validation",
      "medical_gas_pipeline",
      "nabh_checklist",
      "approval_delegations",
      "escalation_log",
      "document_versions",
    ];

    const results: Array<{ table: string; count: number }> = [];
    for (const table of tables) {
      const { count } = await supabaseServer
        .from(table)
        .select("*", { count: "exact", head: true });
      results.push({ table, count: count ?? 0 });
    }

    return { data: results };
  });

// Exports rows from a specific table with optional date-range filtering.
// Supports CSV and Excel (HTML-based .xls) downloads.
// Tables with a date column can be filtered by dateFrom/dateTo.
export const exportTableData = createServerFn({ method: "GET" })
  .validator(
    (input: { table: string; dateFrom?: string; dateTo?: string; format?: "csv" | "excel" }) =>
      input,
  )
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (user.role !== "A1+" && user.role !== "Administrator") {
      return { data: [], error: "Insufficient permissions" };
    }

    // Whitelist of exportable tables with their date column for filtering
    const allowedTables: Record<string, string | null> = {
      vendors: null,
      requisitions: "date",
      gate_passes: "created_at",
      batches: "created_at",
      inspections: "inspection_date",
      visitors: "check_in_time",
      vehicles: "entry_time",
      labour: "date",
      progress: null,
      inventory_items: null,
      inventory_transactions: "created_at",
      material_categories: null,
      vendor_payments: "payment_date",
      budgets: null,
      tds_gst_records: "created_at",
      retention_records: "created_at",
      medical_equipment: null,
      aerb_compliance: null,
      cleanroom_validation: null,
      medical_gas_pipeline: null,
      nabh_checklist: null,
      approval_delegations: "start_date",
      escalation_log: "created_at",
      document_versions: "created_at",
    };

    if (!(data.table in allowedTables)) {
      return { data: [], error: "Table not exportable" };
    }

    // Exclude password_hash from users table
    let select = "*";
    if (data.table === "users") {
      select = "id, username, role, name, phone, created_at";
    }

    let query = supabaseServer.from(data.table).select(select);

    // Apply date-range filter if the table has a date column and dates are provided
    const dateColumn = allowedTables[data.table];
    if (dateColumn && data.dateFrom) {
      query = query.gte(dateColumn, data.dateFrom);
    }
    if (dateColumn && data.dateTo) {
      query = query.lte(dateColumn, `${data.dateTo}T23:59:59`);
    }

    const { data: rows, error } = await query;
    if (error) return { data: [], error: error.message };
    return { data: rows ?? [] };
  });
