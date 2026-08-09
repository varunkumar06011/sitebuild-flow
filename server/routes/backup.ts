import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const backupRouter = Router();

const BACKUP_TABLES = [
  "users", "sessions", "organization_settings", "vendors", "requisitions",
  "requisition_items", "approvals", "gate_passes", "batches", "material_tests",
  "inspections", "registers_visitor", "registers_vehicle", "registers_labour",
  "inventory_categories", "inventory_items", "inventory_transactions", "inventory_warehouses",
  "progress_blocks", "progress_floors", "progress_work_items", "progress_cells", "progress_cell_history",
  "budgets", "cash_flow_forecast", "tds_gst_records", "retention_money", "notifications",
  "audit_log", "error_log", "approval_delegations", "escalation_log", "document_versions",
  "portal_accounts", "portal_sessions", "anomaly_flags", "block_layout",
  "notification_queue", "notification_preferences", "backup_log",
];

// GET /api/backup/log
backupRouter.get("/log", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "Administrator" && user.role !== "A1+") {
      res.json({ data: [] });
      return;
    }

    const limit = parseInt((req.query["limit"] as string) ?? "50", 10);
    const { data: entries } = await supabaseServer
      .from("backup_log")
      .select("id, backup_type, tables_count, total_rows, file_size_bytes, status, triggered_by, notes, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    const userIds = [...new Set((entries ?? []).map((e: any) => e.triggered_by).filter(Boolean))];
    const { data: users } = await supabaseServer.from("users").select("id, name").in("id", userIds);
    const userMap = new Map((users ?? []).map((u: any) => [u.id, u.name]));

    res.json({
      data: (entries ?? []).map((e: any) => ({
        ...e,
        triggered_by_name: e.triggered_by ? (userMap.get(e.triggered_by) ?? "—") : "System",
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ data: [], error: err.message });
      return;
    }
    console.error("fetchBackupLog error:", err);
    res.status(500).json({ data: [], error: "Failed to fetch backup log" });
  }
});

// POST /api/backup/run-verification
backupRouter.post("/run-verification", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    if (user.role !== "Administrator" && user.role !== "A1+") {
      res.json({ success: false, error: "Only administrators can run backup verification" });
      return;
    }
    const { notes } = z.object({ notes: z.string().optional() }).parse(req.body);

    let totalRows = 0;
    let tablesCount = 0;
    const failedTables: string[] = [];

    for (const table of BACKUP_TABLES) {
      try {
        const { count, error } = await supabaseServer.from(table).select("*", { count: "exact", head: true });
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
    const notesStr = [
      notes?.trim(),
      failedTables.length > 0 ? `Failed tables: ${failedTables.join(", ")}` : "All tables verified",
    ].filter(Boolean).join(" — ");

    const { data: logEntry, error: logErr } = await supabaseServer
      .from("backup_log")
      .insert({
        backup_type: "manual",
        tables_count: tablesCount,
        total_rows: totalRows,
        status,
        triggered_by: user.id,
        notes: notesStr,
      })
      .select("id")
      .single();

    if (logErr) {
      res.json({ success: false, error: "Failed to log backup verification" });
      return;
    }

    await logAction(user, "run_backup_verification", "backup_log", logEntry.id, {
      tables_count: tablesCount,
      total_rows: totalRows,
      failed_tables: failedTables,
    });

    res.json({ success: true, tablesCount, totalRows, failedTables, logId: logEntry.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("runBackupVerification error:", err);
    res.status(500).json({ success: false, error: "Failed to run backup verification" });
  }
});
