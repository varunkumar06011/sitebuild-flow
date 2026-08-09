import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseServer } from "../supabase-server";
import { requireSessionUser } from "./session";

// ---------------------------------------------------------------------------
// getCompletedSections — returns all completed section_keys for the current user
// ---------------------------------------------------------------------------
export const getCompletedSections = createServerFn({ method: "GET" })
  .validator((input: Record<string, never>) => input)
  .handler(async () => {
    const user = await requireSessionUser();

    const { data, error } = await supabaseServer
      .from("user_onboarding")
      .select("section_key")
      .eq("user_id", user.id);

    if (error) {
      return { data: [] as string[] };
    }

    return { data: (data ?? []).map((r: any) => r.section_key as string) };
  });

// ---------------------------------------------------------------------------
// markSectionComplete — records that the user has completed a section's tour
// ---------------------------------------------------------------------------
const markSectionCompleteSchema = z.object({
  section_key: z.string().min(1),
});

export const markSectionComplete = createServerFn({ method: "POST" })
  .validator(markSectionCompleteSchema)
  .handler(async ({ data }) => {
    const user = await requireSessionUser();

    const { error } = await supabaseServer.from("user_onboarding").upsert(
      {
        user_id: user.id,
        section_key: data.section_key,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,section_key" },
    );

    if (error) {
      return { success: false, error: "Failed to mark section complete" };
    }

    return { success: true };
  });
