import { createServerFn } from "@tanstack/react-start";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";
import { logAction } from "./audit";

// Fetches all block-level progress percentages ordered by block name.
export const fetchProgress = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  await requireSessionUser();

  const { data, error } = await supabaseServer
    .from("progress")
    .select("id, block, pct, updated_at")
    .order("block", { ascending: true });

  if (error) return { data: [] };

  return { data: data ?? [] };
});

// Creates or updates a block's progress percentage (admin and above only).
export const updateProgress = createServerFn({ method: "POST" })
  .validator((input: { block: string; pct: number }) => input)
  .handler(async ({ data, context }) => {
    const user = await requireSessionUser();
    if (user.role === "Supervisor") {
      return { success: false, error: "Only administrators and above can update progress" };
    }

    const { data: existing } = await supabaseServer
      .from("progress")
      .select("id")
      .eq("block", data.block)
      .limit(1)
      .single();

    const now = new Date().toISOString();

    if (existing) {
      const { error } = await supabaseServer
        .from("progress")
        .update({ pct: data.pct, updated_at: now })
        .eq("id", existing.id);

      if (error) return { success: false, error: "Failed to update progress" };
      await logAction(user, "update_progress", "progress", existing.id, {
        block: data.block,
        pct: data.pct,
      });
      return { success: true };
    }

    const { data: created, error } = await supabaseServer
      .from("progress")
      .insert({ block: data.block, pct: data.pct, updated_at: now })
      .select("id")
      .single();

    if (error || !created) return { success: false, error: "Failed to create progress" };
    await logAction(user, "create_progress", "progress", created.id, {
      block: data.block,
      pct: data.pct,
    });
    return { success: true };
  });
