import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser, type SessionUser } from "../lib/session.js";
import { logAction } from "../lib/audit.js";

export const offlineSyncRouter = Router();

const VALID_ENTITY_TYPES = [
  "daily-diary",
  "punch-item",
  "safety-incident",
  "inspection",
  "labour-attendance",
] as const;

const enqueueSchema = z.object({
  entity_type: z.enum(VALID_ENTITY_TYPES),
  payload: z.record(z.unknown()),
  device_id: z.string().optional(),
});

// POST /api/offline-sync/enqueue
offlineSyncRouter.post("/enqueue", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = enqueueSchema.parse(req.body);

    const { data: queueItem, error } = await supabaseServer
      .from("sync_queue")
      .insert({
        entity_type: data.entity_type,
        payload: data.payload,
        created_by: user.id,
        device_id: data.device_id ?? null,
        status: "Pending",
      })
      .select("id, entity_type")
      .single();

    if (error || !queueItem) {
      res.json({ success: false, error: "Failed to enqueue offline write" });
      return;
    }

    await logAction(user, "enqueue_sync", "sync_queue", queueItem.id, {
      entity_type: data.entity_type,
    });

    res.json({ success: true, id: queueItem.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("enqueueOfflineWrite error:", err);
    res.status(500).json({ success: false, error: "Failed to enqueue" });
  }
});

async function dispatchEntity(
  user: SessionUser,
  entityType: string,
  payload: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (entityType) {
      case "punch-item": {
        const { data: punchItem, error } = await supabaseServer
          .from("punch_items")
          .insert({ ...payload, created_by: user.id })
          .select("id")
          .single();
        if (error) return { success: false, error: error.message };
        return { success: true };
      }
      case "safety-incident": {
        const { error } = await supabaseServer
          .from("safety_incidents")
          .insert({ ...payload, reported_by: user.id });
        if (error) return { success: false, error: error.message };
        return { success: true };
      }
      case "inspection": {
        const { error } = await supabaseServer
          .from("inspections")
          .insert({ ...payload, inspector_id: user.id });
        if (error) return { success: false, error: error.message };
        return { success: true };
      }
      case "labour-attendance": {
        const { error } = await supabaseServer
          .from("labour")
          .insert({ ...payload, recorded_by: user.id });
        if (error) return { success: false, error: error.message };
        return { success: true };
      }
      case "daily-diary": {
        return { success: false, error: "daily-diary is read-only and cannot be synced" };
      }
      default:
        return { success: false, error: `Unknown entity type: ${entityType}` };
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// POST /api/offline-sync/process
offlineSyncRouter.post("/process", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const batchSize = (req.body as { batchSize?: number })?.batchSize ?? 50;

    const { data: pendingItems } = await supabaseServer
      .from("sync_queue")
      .select("id, entity_type, payload, created_at")
      .eq("status", "Pending")
      .eq("created_by", user.id)
      .order("created_at", { ascending: true })
      .limit(batchSize);

    const items = (pendingItems ?? []) as any[];
    const results: Array<{ id: string; entity_type: string; success: boolean; error?: string }> =
      [];

    for (const item of items) {
      await supabaseServer.from("sync_queue").update({ status: "Processing" }).eq("id", item.id);

      const result = await dispatchEntity(user, item.entity_type, item.payload);

      if (result.success) {
        await supabaseServer
          .from("sync_queue")
          .update({ status: "Synced", synced_at: new Date().toISOString() })
          .eq("id", item.id);
      } else {
        await supabaseServer.from("sync_queue").update({ status: "Failed" }).eq("id", item.id);
      }

      const entry: { id: string; entity_type: string; success: boolean; error?: string } = {
        id: item.id,
        entity_type: item.entity_type,
        success: result.success,
      };
      if (result.error) entry.error = result.error;
      results.push(entry);
    }

    await logAction(user, "process_sync_queue", "sync_queue", "batch", {
      total: items.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
    });

    res.json({
      success: true,
      processed: items.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("processSyncQueue error:", err);
    res.status(500).json({ success: false, error: "Failed to process sync queue" });
  }
});

// GET /api/offline-sync/pending-count
offlineSyncRouter.get("/pending-count", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);

    const { count } = await supabaseServer
      .from("sync_queue")
      .select("id", { count: "exact" })
      .eq("status", "Pending")
      .eq("created_by", user.id);

    res.json({ pending_count: count ?? 0 });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("getPendingSyncCount error:", err);
    res.status(500).json({ error: "Failed to get pending count" });
  }
});

// GET /api/offline-sync/queue
offlineSyncRouter.get("/queue", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const status = req.query["status"] as string | undefined;
    const limit = parseInt((req.query["limit"] as string) ?? "100", 10);

    let query = supabaseServer
      .from("sync_queue")
      .select("id, entity_type, payload, status, device_id, created_at, synced_at, created_by")
      .eq("created_by", user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) query = query.eq("status", status);

    const { data: items, count } = await query;

    res.json({ data: items ?? [], total_count: count ?? 0 });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ error: err.message });
      return;
    }
    console.error("fetchSyncQueue error:", err);
    res.status(500).json({ error: "Failed to fetch sync queue" });
  }
});
