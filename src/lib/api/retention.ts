import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches retention records with vendor names and release eligibility computed.
export const fetchRetentionRecords = createServerFn({ method: "GET" })
  .validator((input: { releaseStatus?: string; search?: string }) => input)
  .handler(async ({ data }) => {
    await requireSessionUser();

    let query = supabaseServer
      .from("retention_records")
      .select(
        "id, vendor_id, contract_ref, total_contract_value, retention_percentage, retention_held, retention_released, defect_liability_start, defect_liability_end, release_status, released_date, notes, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (data.releaseStatus) query = query.eq("release_status", data.releaseStatus);
    if (data.search) {
      const s = data.search.replace(/[,.()\\]/g, " ").trim();
      if (s) {
        query = query.or(`contract_ref.ilike.%${s}%`);
      }
    }

    const { data: records, count } = await query;

    // Fetch vendor names
    const vendorIds = [...new Set((records ?? []).map((r: any) => r.vendor_id).filter(Boolean))];
    const { data: vendors } = await supabaseServer
      .from("vendors")
      .select("id, name")
      .in("id", vendorIds);

    const vendorMap = new Map((vendors ?? []).map((v: any) => [v.id, v.name]));

    const now = new Date();
    const enriched = (records ?? []).map((r: any) => {
      const dlpEnd = r.defect_liability_end ? new Date(r.defect_liability_end) : null;
      const isEligible = dlpEnd ? dlpEnd <= now && r.release_status === "Held" : false;
      const daysToRelease = dlpEnd
        ? Math.ceil((dlpEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      return {
        ...r,
        vendor_name: vendorMap.get(r.vendor_id) ?? "Unknown",
        is_eligible_for_release: isEligible,
        days_to_release: daysToRelease,
        balance_held: (r.retention_held ?? 0) - (r.retention_released ?? 0),
      };
    });

    const totalHeld = enriched.reduce((sum, r: any) => sum + (r.balance_held ?? 0), 0);
    const totalReleased = enriched.reduce((sum, r: any) => sum + (r.retention_released ?? 0), 0);
    const eligibleCount = enriched.filter((r: any) => r.is_eligible_for_release).length;

    return {
      data: enriched,
      total: count ?? 0,
      summary: {
        total_held: totalHeld,
        total_released: totalReleased,
        eligible_for_release: eligibleCount,
      },
    };
  });

const retentionSchema = z.object({
  vendor_id: z.string().uuid(),
  contract_ref: z.string().optional(),
  total_contract_value: z.number().min(0),
  retention_percentage: z.number().min(0).max(100),
  retention_held: z.number().min(0),
  retention_released: z.number().min(0).default(0),
  defect_liability_start: z.string().optional(),
  defect_liability_end: z.string().optional(),
  release_status: z.enum(["Held", "Eligible", "Released"]).default("Held"),
  released_date: z.string().optional(),
  notes: z.string().optional(),
});

// Creates a new retention record and logs the action.
export const createRetentionRecord = createServerFn({ method: "POST" })
  .validator(retentionSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { data: record, error } = await supabaseServer
      .from("retention_records")
      .insert(data)
      .select("id, contract_ref")
      .single();

    if (error || !record) return { success: false, error: "Failed to create retention record" };

    await logAction(user, "create_retention", "retention_records", record.id, {
      contract_ref: record.contract_ref,
    });
    return { success: true, id: record.id };
  });

// Updates an existing retention record and logs the change.
export const updateRetentionRecord = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().uuid(), ...retentionSchema.partial().shape }))
  .handler(async ({ data }) => {
    const user = await requireSessionUser();
    const { id, ...updates } = data;

    const { error } = await supabaseServer.from("retention_records").update(updates).eq("id", id);
    if (error) return { success: false, error: "Failed to update retention record" };

    await logAction(user, "update_retention", "retention_records", id, updates);
    return { success: true };
  });
