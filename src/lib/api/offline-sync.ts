import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";
import type { SessionUser } from "./session";

// Entity types that can be queued for offline sync
const VALID_ENTITY_TYPES = [
  "daily-diary",
  "punch-item",
  "safety-incident",
  "inspection",
  "labour-attendance",
] as const;

// ---------------------------------------------------------------------------
// enqueueOfflineWrite — queues a write operation for later replay
// ---------------------------------------------------------------------------
const enqueueSchema = z.object({
  entity_type: z.enum(VALID_ENTITY_TYPES),
  payload: z.record(z.unknown()),
  device_id: z.string().optional(),
});

export const enqueueOfflineWrite = createServerFn({ method: "POST" })
  .validator(enqueueSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

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
      return { success: false, error: "Failed to enqueue offline write" };
    }

    await logAction(user, "enqueue_sync", "sync_queue", queueItem.id, {
      entity_type: data.entity_type,
    });

    return { success: true, id: queueItem.id };
  });

// ---------------------------------------------------------------------------
// Dispatch a single payload to the right existing create function per entity_type.
// Returns { success, error? } for each item.
// ---------------------------------------------------------------------------
async function dispatchEntity(
  user: SessionUser,
  entityType: string,
  payload: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  try {
    switch (entityType) {
      case "punch-item": {
        const { createPunchItem } = await import("./punch-list");
        const result = await createPunchItem({ data: payload as any });
        return result as any;
      }
      case "safety-incident": {
        const { reportIncident } = await import("./safety");
        const result = await reportIncident({ data: payload as any });
        return result as any;
      }
      case "inspection": {
        const { createInspection } = await import("./inspections");
        const result = await createInspection({ data: payload as any });
        return result as any;
      }
      case "labour-attendance": {
        const { markAttendance } = await import("./labour");
        const result = await markAttendance({ data: payload as any });
        return result as any;
      }
      case "daily-diary": {
        // Daily diary is read-only (auto-generated); no create function to dispatch.
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

// ---------------------------------------------------------------------------
// processSyncQueue — replays all pending items, dispatching each to the right create function
// ---------------------------------------------------------------------------
export const processSyncQueue = createServerFn({ method: "POST" })
  .validator((input: { batchSize?: number }) => input)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const batchSize = data.batchSize ?? 50;

    // Fetch pending items for this user
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
      // Mark as Processing
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

    return {
      success: true,
      processed: items.length,
      succeeded: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  });

// ---------------------------------------------------------------------------
// getPendingSyncCount — returns the count of pending sync items for the current user
// ---------------------------------------------------------------------------
export const getPendingSyncCount = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    const user = await requireSessionUser();

    const { count } = await supabaseServer
      .from("sync_queue")
      .select("id", { count: "exact" })
      .eq("status", "Pending")
      .eq("created_by", user.id);

    return { pending_count: count ?? 0 };
  });
