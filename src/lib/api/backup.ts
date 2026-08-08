// Backup log API — tracks manual and scheduled backup verification.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import type { Role } from "../erp-data";

const ADMIN_ROLES: Role[] = ["Administrator", "A1+"];
function isAdmin(role: Role): boolean {
  return ADMIN_ROLES.includes(role);
}

// Tables that should be included in a backup verification
const BACKUP_TABLES = [
  "users",
  "sessions",
  "organization_settings",
  "vendors",
  "requisitions",
  "requisition_items",
  "approvals",
  "gate_passes",
  "batches",
  "material_tests",
  "inspections",
  "registers_visitor",
  "registers_vehicle",
  "registers_labour",
  "inventory_categories",
  "inventory_items",
  "inventory_transactions",
  "inventory_warehouses",
  "progress_blocks",
  "progress_floors",
  "progress_work_items",
  "progress_cells",
  "progress_cell_history",
  "budgets",
  "cash_flow_forecast",
  "tds_gst_records",
  "retention_money",
  "notifications",
  "audit_log",
  "error_log",
  "approval_delegations",
  "escalation_log",
  "document_versions",
  "portal_accounts",
  "portal_sessions",
  "anomaly_flags",
  "block_layout",
  "notification_queue",
  "notification_preferences",
  "backup_log",
];

// Fetches backup log entries (admin only).
export const fetchBackupLog = createServerFn({ method: "GET" })
  .validator((input: { limit?: number }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { data: [] };
    }

    const { data: entries } = await supabaseServer
      .from("backup_log")
      .select(
        "id, backup_type, tables_count, total_rows, file_size_bytes, status, triggered_by, notes, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);

    // Resolve triggered_by names
    const userIds = [...new Set((entries ?? []).map((e: any) => e.triggered_by).filter(Boolean))];
    const { data: users } = await supabaseServer.from("users").select("id, name").in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));

    return {
      data: (entries ?? []).map((e: any) => ({
        ...e,
        triggered_by_name: e.triggered_by ? (userMap.get(e.triggered_by) ?? "—") : "System",
      })),
    };
  });

// Runs a backup verification: counts rows in all critical tables and logs the result.
export const runBackupVerification = createServerFn({ method: "POST" })
  .validator(z.object({ notes: z.string().optional() }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    if (!isAdmin(user.role)) {
      return { success: false, error: "Only administrators can run backup verification" };
    }

    let totalRows = 0;
    let tablesCount = 0;
    let failedTables: string[] = [];

    for (const table of BACKUP_TABLES) {
      try {
        const { count, error } = await supabaseServer
          .from(table)
          .select("*", { count: "exact", head: true });
        if (error) {
          failedTables.push(table);
        } else {
          totalRows += count ?? 0;
          tablesCount++;
        }
      } catch {
        failedTables.push(table);
      }
    }

    const status = failedTables.length === 0 ? "verified" : "completed";
    const notes = [
      data.notes?.trim(),
      failedTables.length > 0 ? `Failed tables: ${failedTables.join(", ")}` : "All tables verified",
    ]
      .filter(Boolean)
      .join(" — ");

    const { data: logEntry, error: logErr } = await supabaseServer
      .from("backup_log")
      .insert({
        backup_type: "manual",
        tables_count: tablesCount,
        total_rows: totalRows,
        status,
        triggered_by: user.id,
        notes,
      })
      .select("id")
      .single();

    if (logErr) return { success: false, error: "Failed to log backup verification" };

    await logAction(user, "run_backup_verification", "backup_log", logEntry.id, {
      tables_count: tablesCount,
      total_rows: totalRows,
      failed_tables: failedTables,
    });

    return {
      success: true,
      tablesCount,
      totalRows,
      failedTables,
      logId: logEntry.id,
    };
  });
