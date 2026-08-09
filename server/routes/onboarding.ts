import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { supabaseServer } from "../lib/supabase-server.js";
import { requireSessionUser } from "../lib/session.js";

export const onboardingRouter = Router();

// GET /api/onboarding/completed
onboardingRouter.get("/completed", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);

    const { data, error } = await supabaseServer
      .from("user_onboarding")
      .select("section_key")
      .eq("user_id", user.id);

    if (error) {
      res.json({ data: [] as string[] });
      return;
    }

    res.json({ data: (data ?? []).map((r: any) => r.section_key as string) });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("getCompletedSections error:", err);
    res.status(500).json({ data: [] as string[] });
  }
});

// POST /api/onboarding/mark-complete
const markSectionCompleteSchema = z.object({
  section_key: z.string().min(1),
});

onboardingRouter.post("/mark-complete", async (req: Request, res: Response) => {
  try {
    const user = await requireSessionUser(req);
    const data = markSectionCompleteSchema.parse(req.body);

    const { error } = await supabaseServer.from("user_onboarding").upsert(
      {
        user_id: user.id,
        section_key: data.section_key,
        completed_at: new Date().toISOString(),
      },
      { onConflict: "user_id,section_key" },
    );

    if (error) {
      res.json({ success: false, error: "Failed to mark section complete" });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: "Invalid input" });
      return;
    }
    if (err instanceof Error && err.message.startsWith("Unauthorized")) {
      res.status(401).json({ success: false, error: err.message });
      return;
    }
    console.error("markSectionComplete error:", err);
    res.status(500).json({ success: false, error: "Failed to mark section complete" });
  }
});
